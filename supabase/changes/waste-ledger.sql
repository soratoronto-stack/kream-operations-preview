begin;
create table public.kream_waste (
 id uuid primary key,
 location_kind text not null check(location_kind in ('store','factory')),
 store_id text references public.kream_stores(id),
 waste_date date not null,
 item_name text not null check(char_length(btrim(item_name)) between 1 and 160),
 quantity numeric(12,3) not null check(quantity>0 and quantity<=100000),
 unit text not null check(unit in ('ea','pack','bag','box','batch','g','kg','ml','l')),
 reason text not null check(reason in ('production_error','spoilage','sampling','unsold','damage','other')),
 note text not null default '' check(char_length(note)<=2000),
 recorded_by uuid not null references public.kream_profiles(user_id),
 recorded_name text not null,
 created_at timestamptz not null default now(),
 check((location_kind='factory' and store_id is null) or (location_kind='store' and store_id is not null)),
 check(unit not in ('ea','pack','bag','box','batch') or quantity=trunc(quantity)),
 check(reason<>'other' or char_length(btrim(note))>0)
);
create index kream_waste_location_date_idx on public.kream_waste(location_kind,store_id,waste_date desc);
alter table public.kream_waste enable row level security;
revoke all on public.kream_waste from public,anon,authenticated;
grant select on public.kream_waste to authenticated;
create policy waste_read on public.kream_waste for select to authenticated using(
 kream_private.current_role()='owner'
 or (location_kind='factory' and kream_private.current_role()='factory')
 or (location_kind='store' and kream_private.can_order_store(store_id))
);
-- Append-only, author set by the server, no prices or guessed stock movements.
create function public.kream_record_waste(request_id uuid,target_location text,target_store text,record_date date,item_label text,amount numeric,amount_unit text,waste_reason text,record_note text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare r text:=kream_private.current_role(); prior public.kream_waste%rowtype; author text;
begin
 if auth.uid() is null or r is null or request_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if target_location is null or target_location not in ('store','factory')
 or (target_location='factory' and (target_store is not null or r not in ('owner','factory')))
 or (target_location='store' and (target_store is null or not kream_private.can_order_store(target_store))) then raise exception 'Waste location denied' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kream-waste:'||request_id::text,0));
 select * into prior from public.kream_waste where id=request_id;
 if found then
  if prior.recorded_by<>auth.uid() or prior.location_kind is distinct from target_location or prior.store_id is distinct from target_store
   or prior.waste_date is distinct from record_date or prior.item_name is distinct from btrim(item_label) or prior.quantity is distinct from amount
   or prior.unit is distinct from amount_unit or prior.reason is distinct from waste_reason or prior.note is distinct from btrim(record_note)
   then raise exception 'Waste request conflict' using errcode='22023'; end if;
  return prior.id;
 end if;
 if record_date is null or record_date>(now() at time zone 'America/Toronto')::date or item_label is null or char_length(btrim(item_label)) not between 1 and 160
 or amount is null or amount<=0 or amount>100000 or amount<>round(amount,3) or amount::text in ('NaN','Infinity','-Infinity')
 or amount_unit is null or amount_unit not in ('ea','pack','bag','box','batch','g','kg','ml','l')
 or (amount_unit in ('ea','pack','bag','box','batch') and amount<>trunc(amount))
 or waste_reason is null or waste_reason not in ('production_error','spoilage','sampling','unsold','damage','other')
 or record_note is null or char_length(btrim(record_note))>2000 or (waste_reason='other' and char_length(btrim(record_note))=0)
 then raise exception 'Invalid waste record' using errcode='22023'; end if;
 select coalesce(nullif(display_name,''),r) into author from public.kream_profiles where user_id=auth.uid();
 insert into public.kream_waste(id,location_kind,store_id,waste_date,item_name,quantity,unit,reason,note,recorded_by,recorded_name)
 values(request_id,target_location,target_store,record_date,btrim(item_label),amount,amount_unit,waste_reason,btrim(record_note),auth.uid(),author);
 return request_id;
end;$$;
revoke all on function public.kream_record_waste(uuid,text,text,date,text,numeric,text,text,text) from public,anon;
grant execute on function public.kream_record_waste(uuid,text,text,date,text,numeric,text,text,text) to authenticated;
commit;
