begin;
create table public.kream_receipts (
 id uuid primary key,
 order_id uuid not null references public.kream_orders(id),
 store_id text not null references public.kream_stores(id),
 received_by uuid not null references public.kream_profiles(user_id),
 note text not null default '' check(char_length(note)<=2000),
 created_at timestamptz not null default now()
);
create table public.kream_receipt_items (
 receipt_id uuid not null references public.kream_receipts(id),
 product_id text not null references public.kream_catalog(id),
 quantity numeric(12,3) not null check(quantity>0 and quantity<=100000),
 primary key(receipt_id,product_id)
);
create index kream_receipts_order_idx on public.kream_receipts(order_id);
create index kream_receipts_store_idx on public.kream_receipts(store_id,created_at);
create table public.kream_guides (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('sop','manual')),
 store_id text references public.kream_stores(id),
 title_ko text not null check(char_length(title_ko) between 1 and 160),
 title_en text not null default '' check(char_length(title_en)<=160),
 category text not null default '' check(char_length(category)<=80),
 body_ko text not null default '' check(char_length(body_ko)<=100000),
 body_en text not null default '' check(char_length(body_en)<=100000),
 published boolean not null default false,
 archived boolean not null default false,
 created_by uuid not null default auth.uid() references public.kream_profiles(user_id),
 revision bigint not null default 1,
 updated_at timestamptz not null default now()
);
create trigger guide_revision before update on public.kream_guides for each row execute function kream_private.bump_revision();
alter table public.kream_receipts enable row level security;
alter table public.kream_receipt_items enable row level security;
alter table public.kream_guides enable row level security;
revoke all on public.kream_receipts,public.kream_receipt_items,public.kream_guides from public,anon,authenticated;
grant select on public.kream_receipts,public.kream_receipt_items,public.kream_guides to authenticated;
create policy receipts_read on public.kream_receipts for select to authenticated using(kream_private.can_read_store(store_id));
create policy receipt_items_read on public.kream_receipt_items for select to authenticated using(exists(select 1 from public.kream_receipts r where r.id=receipt_id and kream_private.can_read_store(r.store_id)));
create policy guides_read on public.kream_guides for select to authenticated using(
 kream_private.current_role()='owner'
 or (kream_private.current_role()='manager' and store_id is not null and kream_private.can_order_store(store_id))
 or (published and not archived and kream_private.current_role() is not null and (store_id is null or kream_private.can_read_store(store_id)))
);
grant insert(kind,store_id,title_ko,title_en,category,body_ko,body_en,published,archived) on public.kream_guides to authenticated;
grant update(title_ko,title_en,category,body_ko,body_en,published,archived) on public.kream_guides to authenticated;
create policy guides_insert on public.kream_guides for insert to authenticated with check(created_by=auth.uid() and (
 kream_private.current_role()='owner' or (kream_private.current_role()='manager' and store_id is not null and kream_private.can_order_store(store_id))));
create policy guides_update on public.kream_guides for update to authenticated using(
 kream_private.current_role()='owner' or (kream_private.current_role()='manager' and store_id is not null and kream_private.can_order_store(store_id))) with check(
 kream_private.current_role()='owner' or (kream_private.current_role()='manager' and store_id is not null and kream_private.can_order_store(store_id)));
-- Receipt ledger is append-only. Order lock serializes deliveries and checks totals.
-- Request UUID makes a retry after a lost response idempotent.
create function public.kream_receive_order(target_order uuid,request_id uuid,received_items jsonb,receipt_note text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare o public.kream_orders%rowtype; existing public.kream_receipts%rowtype; item jsonb; pid text; qty numeric; ordered numeric; prior numeric; seen text[]:=array[]::text[]; n integer:=0;
begin
 if auth.uid() is null or request_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into o from public.kream_orders where id=target_order for update;
 if not found or not kream_private.can_order_store(o.store_id) then raise exception 'Store access denied' using errcode='42501'; end if;
 select * into existing from public.kream_receipts where id=request_id;
 if found then
  if existing.order_id<>target_order or existing.received_by<>auth.uid() then raise exception 'Receipt request conflict' using errcode='42501'; end if;
  return existing.id;
 end if;
 if o.status='cancelled' then raise exception 'Cancelled order' using errcode='22023'; end if;
 if receipt_note is null or char_length(receipt_note)>2000 or jsonb_typeof(received_items)<>'array' or jsonb_array_length(received_items)>500 then raise exception 'Invalid receipt' using errcode='22023'; end if;
 insert into public.kream_receipts(id,order_id,store_id,received_by,note) values(request_id,target_order,o.store_id,auth.uid(),receipt_note);
 for item in select value from jsonb_array_elements(received_items) loop
  if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'quantity')<>'number' then raise exception 'Invalid quantity' using errcode='22023'; end if;
  pid:=item->>'product_id';qty:=(item->>'quantity')::numeric;
  if qty is null or not(qty>0 and qty<=100000) or qty<>round(qty,3) or pid=any(seen) then raise exception 'Invalid quantity' using errcode='22023'; end if;
  seen:=array_append(seen,pid);
  select quantity into ordered from public.kream_order_items where order_id=target_order and product_id=pid;
  if not found then raise exception 'Item not in order' using errcode='22023'; end if;
  select coalesce(sum(i.quantity),0) into prior from public.kream_receipt_items i join public.kream_receipts r on r.id=i.receipt_id where r.order_id=target_order and i.product_id=pid;
  if prior+qty>ordered then raise exception 'Receipt exceeds outstanding quantity' using errcode='40001'; end if;
  insert into public.kream_receipt_items(receipt_id,product_id,quantity) values(request_id,pid,qty);
  -- Same lock namespace as stock count RPC; unknown counts remain unknown.
  perform pg_advisory_xact_lock(hashtextextended(o.store_id||':'||pid,0));
  update public.kream_stock set on_hand=on_hand+qty where store_id=o.store_id and product_id=pid and on_hand is not null;
  n:=n+1;
 end loop;
 if n=0 then raise exception 'Empty receipt' using errcode='22023'; end if;
 if not exists(select 1 from public.kream_order_items oi where oi.order_id=target_order and oi.quantity>(select coalesce(sum(ri.quantity),0) from public.kream_receipt_items ri join public.kream_receipts r on r.id=ri.receipt_id where r.order_id=target_order and ri.product_id=oi.product_id)) then
  update public.kream_orders set status='received' where id=target_order;
 end if;
 return request_id;
end $$;
revoke all on function public.kream_receive_order(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.kream_receive_order(uuid,uuid,jsonb,text) to authenticated;
commit;
select tablename,rowsecurity from pg_tables where schemaname='public' and tablename in('kream_receipts','kream_receipt_items','kream_guides');
