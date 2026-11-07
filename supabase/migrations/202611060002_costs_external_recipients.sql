
create table public.kream_cost_recipes (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 160),
 product_id text references public.kream_catalog(id), yield_quantity numeric not null check(yield_quantity>0 and yield_quantity<=1000000), yield_unit text not null check(length(yield_unit) between 1 and 40),
 ingredients jsonb not null default '[]' check(jsonb_typeof(ingredients)='array' and jsonb_array_length(ingredients)<=200),
 packaging numeric not null default 0 check(packaging>=0), labor numeric not null default 0 check(labor>=0), overhead numeric not null default 0 check(overhead>=0),
 note text not null default '' check(length(note)<=2000), revision bigint not null default 1, updated_at timestamptz not null default now(), updated_by uuid references auth.users(id)
);
create table public.kream_external_recipients (
 destination text primary key check(length(destination) between 1 and 160), product_ids jsonb not null check(jsonb_typeof(product_ids)='array' and jsonb_array_length(product_ids)<=1000), revision bigint not null default 1, updated_at timestamptz not null default now()
);
create table public.kream_external_prices (
 destination text not null references public.kream_external_recipients(destination), product_id text not null references public.kream_catalog(id), price_cad numeric check(price_cad>=0 and price_cad<=10000000), quantity_factor numeric not null check(quantity_factor in (1,64)), primary key(destination,product_id)
);
create table public.kream_external_price_snapshots (
 dispatch_id uuid primary key references public.kream_external_dispatches(id) on delete cascade, prices jsonb not null, created_at timestamptz not null default now()
);
alter table public.kream_cost_recipes enable row level security;
revoke all on public.kream_cost_recipes from anon, authenticated;
grant select on public.kream_cost_recipes to authenticated;
create policy read_authorized on public.kream_cost_recipes for select to authenticated using (exists(select 1 from public.kream_profiles p where p.user_id=auth.uid() and p.active and not p.access_blocked and (p.role='owner' or p.role='factory' and p.factory_manager)));
alter table public.kream_external_recipients enable row level security;
revoke all on public.kream_external_recipients from anon, authenticated;
grant select on public.kream_external_recipients to authenticated;
create policy read_authorized on public.kream_external_recipients for select to authenticated using (exists(select 1 from public.kream_profiles p where p.user_id=auth.uid() and p.active and not p.access_blocked and p.role in ('owner','factory')));
alter table public.kream_external_prices enable row level security;
revoke all on public.kream_external_prices from anon, authenticated;
grant select on public.kream_external_prices to authenticated;
create policy read_authorized on public.kream_external_prices for select to authenticated using (exists(select 1 from public.kream_profiles p where p.user_id=auth.uid() and p.active and not p.access_blocked and (p.role='owner' or p.role='factory' and p.factory_manager)));
alter table public.kream_external_price_snapshots enable row level security;
revoke all on public.kream_external_price_snapshots from anon, authenticated;
grant select on public.kream_external_price_snapshots to authenticated;
create policy read_authorized on public.kream_external_price_snapshots for select to authenticated using (exists(select 1 from public.kream_profiles p where p.user_id=auth.uid() and p.active and not p.access_blocked and (p.role='owner' or p.role='factory' and p.factory_manager)));

create function public.kream_save_cost_recipe(recipe_id uuid, previous_revision bigint, value jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare ingredient jsonb; result_id uuid; old_revision bigint;
begin
 if not kream_private.can_manage_purchases() or not exists(select 1 from public.kream_profiles where user_id=auth.uid() and not access_blocked) then raise exception 'Not authorized' using errcode='42501';end if;
 if jsonb_typeof(value->'ingredients') is distinct from 'array' then raise exception 'Invalid ingredients';end if;
 for ingredient in select jsonb_array_elements(value->'ingredients') loop
  if not exists(select 1 from public.kream_materials where id=(ingredient->>'material_id')::uuid) or (ingredient->>'quantity')::numeric<=0 or (ingredient->>'quantity')::numeric>100000000 or ingredient->>'basis' not in ('purchase','content') then raise exception 'Invalid ingredient';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('recipe:'||recipe_id::text,0));
 select revision into old_revision from public.kream_cost_recipes where id=recipe_id for update;
 if coalesce(old_revision,0)<>previous_revision then raise exception 'Changed; reload' using errcode='40001';end if;
 insert into public.kream_cost_recipes(id,name,product_id,yield_quantity,yield_unit,ingredients,packaging,labor,overhead,note,updated_by)
 values(recipe_id,btrim(value->>'name'),nullif(value->>'product_id',''),(value->>'yield_quantity')::numeric,btrim(value->>'yield_unit'),value->'ingredients',(value->>'packaging')::numeric,(value->>'labor')::numeric,(value->>'overhead')::numeric,coalesce(value->>'note',''),auth.uid())
 on conflict(id) do update set name=excluded.name,product_id=excluded.product_id,yield_quantity=excluded.yield_quantity,yield_unit=excluded.yield_unit,ingredients=excluded.ingredients,packaging=excluded.packaging,labor=excluded.labor,overhead=excluded.overhead,note=excluded.note,updated_by=auth.uid(),updated_at=now(),revision=kream_cost_recipes.revision+1 returning id into result_id;
 return result_id;
end $$;
create function public.kream_save_external_recipient(destination_name text, previous_revision bigint, settings jsonb) returns bigint language plpgsql security definer set search_path='' as $$
declare old_revision bigint; entry jsonb; ids jsonb:='[]'; rev bigint; dest text:=btrim(destination_name); factor numeric;
begin
 if not kream_private.can_manage_purchases() or not exists(select 1 from public.kream_profiles where user_id=auth.uid() and not access_blocked) then raise exception 'Not authorized' using errcode='42501';end if;
 if dest is null or length(dest) not between 1 and 160 or jsonb_typeof(settings) is distinct from 'array' or jsonb_array_length(settings)>1000 then raise exception 'Invalid settings';end if;
 perform pg_advisory_xact_lock(hashtextextended('recipient:'||dest,0));
 select revision into old_revision from public.kream_external_recipients where destination=dest for update;
 if coalesce(old_revision,0)<>previous_revision then raise exception 'Changed; reload' using errcode='40001';end if;
 for entry in select jsonb_array_elements(settings) loop
  if not exists(select 1 from public.kream_catalog where id=entry->>'product_id' and active and unit_confirmed and production_team is not null) or ids ? (entry->>'product_id') then raise exception 'Invalid product';end if;
  ids:=ids||jsonb_build_array(entry->>'product_id');
 end loop;
 insert into public.kream_external_recipients(destination,product_ids) values(dest,ids) on conflict(destination) do update set product_ids=excluded.product_ids,revision=kream_external_recipients.revision+1,updated_at=now() returning revision into rev;
 delete from public.kream_external_prices where destination=dest;
 for entry in select jsonb_array_elements(settings) loop
  select case when id in ('chewy','sheet-70441a15e7','sheet-9ea75322e4','sheet-1f39626328') and lower(order_unit) in ('ea','개','낱개') then 64 else 1 end into factor from public.kream_catalog where id=entry->>'product_id';
  insert into public.kream_external_prices(destination,product_id,price_cad,quantity_factor) values(dest,entry->>'product_id',nullif(entry->>'price_cad','')::numeric,factor);
 end loop;
 return rev;
end $$;
create function kream_private.snapshot_external_prices() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.kream_external_price_snapshots(dispatch_id,prices)
 select new.id,coalesce(jsonb_agg(jsonb_build_object('product_id',i->>'product_id','price_cad',p.price_cad,'quantity_factor',coalesce(p.quantity_factor,1))),'[]') from jsonb_array_elements(new.items) i left join public.kream_external_prices p on p.destination=new.destination and p.product_id=i->>'product_id';
 return new;
end $$;
create trigger snapshot_prices after insert on public.kream_external_dispatches for each row execute function kream_private.snapshot_external_prices();
revoke all on function public.kream_save_cost_recipe(uuid,bigint,jsonb) from public,anon;
revoke all on function public.kream_save_external_recipient(text,bigint,jsonb) from public,anon;
grant execute on function public.kream_save_cost_recipe(uuid,bigint,jsonb),public.kream_save_external_recipient(text,bigint,jsonb) to authenticated;
revoke all on function kream_private.snapshot_external_prices() from public,anon,authenticated;
