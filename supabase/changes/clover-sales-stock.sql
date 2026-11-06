alter table public.kream_clover_connections add column inventory_started_at timestamptz not null default clock_timestamp(), add column inventory_cursor timestamptz, add column inventory_last_success_at timestamptz, add column inventory_last_error text;
alter table public.kream_stock add column physical_count_at timestamptz;
create table public.kream_clover_items (
 store_id text not null references public.kream_clover_connections(store_id), clover_item_id text not null,
 name text not null, product_id text references public.kream_catalog(id), stock_per_sale numeric not null default 1 check(stock_per_sale>0 and stock_per_sale<=100000 and stock_per_sale=round(stock_per_sale,3)),
 enabled boolean not null default false, updated_at timestamptz not null default now(), primary key(store_id,clover_item_id));
create table public.kream_clover_stock_sales (
 store_id text not null references public.kream_clover_connections(store_id), line_id text not null, order_id text not null, clover_item_id text, name text not null,
 sold_at timestamptz not null, quantity numeric not null check(quantity>0 and quantity<=100000), product_id text references public.kream_catalog(id),
 stock_quantity numeric, deducted numeric not null default 0, shortage numeric not null default 0,
 status text not null default 'waiting' check(status in ('waiting','applied','baseline','review')), observed_at timestamptz not null default now(), primary key(store_id,line_id));
create index clover_sales_recent on public.kream_clover_stock_sales(store_id,sold_at desc);
alter table public.kream_clover_items enable row level security;
alter table public.kream_clover_stock_sales enable row level security;
revoke all on public.kream_clover_items, public.kream_clover_stock_sales from anon,authenticated;
grant select,update on public.kream_clover_items to authenticated;
grant select on public.kream_clover_stock_sales to authenticated;
grant all on public.kream_clover_items, public.kream_clover_stock_sales to service_role;
create policy clover_items_owner on public.kream_clover_items for all to authenticated using (exists(select 1 from public.kream_profiles p where p.user_id=(select auth.uid()) and p.active and not coalesce(p.access_blocked,false) and p.role='owner')) with check (exists(select 1 from public.kream_profiles p where p.user_id=(select auth.uid()) and p.active and not coalesce(p.access_blocked,false) and p.role='owner'));
create policy clover_sales_owner on public.kream_clover_stock_sales for select to authenticated using (exists(select 1 from public.kream_profiles p where p.user_id=(select auth.uid()) and p.active and not coalesce(p.access_blocked,false) and p.role='owner'));
-- Only the server can ingest Clover observations; stock changes and event keys commit together.
create or replace function public.kream_apply_clover_sales(target_store text, sales jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare e jsonb; m public.kream_clover_items%rowtype; old public.kream_clover_stock_sales%rowtype; s public.kream_stock%rowtype; cutoff timestamptz; needed numeric; actual numeric; n integer:=0;
begin
 if jsonb_typeof(sales)<>'array' or jsonb_array_length(sales)>2000 then raise exception 'Invalid sale batch';end if;
 select inventory_started_at into strict cutoff from public.kream_clover_connections where store_id=target_store;
 -- Same ordering in every batch avoids deadlocks between overlapping collectors.
 for e in select value from jsonb_array_elements(sales) order by value->>'item_id',value->>'line_id' loop
  if nullif(e->>'line_id','') is null or (e->>'quantity')::numeric<=0 then raise exception 'Invalid sale';end if;
  perform pg_advisory_xact_lock(hashtextextended('clover:'||target_store||':'||(e->>'line_id'),0));
  select * into old from public.kream_clover_stock_sales where store_id=target_store and line_id=e->>'line_id' for update;
  if found then
   -- An edited paid line needs review; never silently reverse a food sale.
   if old.quantity is distinct from (e->>'quantity')::numeric or old.clover_item_id is distinct from e->>'item_id' then update public.kream_clover_stock_sales set status='review' where store_id=target_store and line_id=old.line_id; end if;
   continue;
  end if;
  insert into public.kream_clover_items(store_id,clover_item_id,name) values(target_store,e->>'item_id',e->>'name') on conflict do nothing;
  select * into m from public.kream_clover_items where store_id=target_store and clover_item_id=e->>'item_id';
  insert into public.kream_clover_stock_sales(store_id,line_id,order_id,clover_item_id,name,sold_at,quantity) values(target_store,e->>'line_id',e->>'order_id',e->>'item_id',e->>'name',(e->>'sold_at')::timestamptz,(e->>'quantity')::numeric);
  if (e->>'sold_at')::timestamptz<cutoff then
   update public.kream_clover_stock_sales set status='baseline' where store_id=target_store and line_id=e->>'line_id';continue;
  end if;
  if not m.enabled or m.product_id is null then continue;end if;
  perform pg_advisory_xact_lock(hashtextextended(target_store||':'||m.product_id,0));
  select * into s from public.kream_stock where store_id=target_store and product_id=m.product_id for update;
  needed:=round((e->>'quantity')::numeric*m.stock_per_sale,3);
  if s.physical_count_at is not null and (e->>'sold_at')::timestamptz<=s.physical_count_at then
   update public.kream_clover_stock_sales set status='baseline',product_id=m.product_id,stock_quantity=needed where store_id=target_store and line_id=e->>'line_id';continue;
  end if;
  actual:=least(needed,coalesce(s.on_hand,0));
  if s.on_hand is not null then update public.kream_stock set on_hand=on_hand-actual where store_id=target_store and product_id=m.product_id;end if;
  update public.kream_clover_stock_sales set status=case when actual<needed then 'review' else 'applied' end,product_id=m.product_id,stock_quantity=needed,deducted=actual,shortage=needed-actual where store_id=target_store and line_id=e->>'line_id';n:=n+1;
 end loop;
 return n;
end;$$;
revoke all on function public.kream_apply_clover_sales(text,jsonb) from public,anon,authenticated;
grant execute on function public.kream_apply_clover_sales(text,jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.kream_save_stock(target_store text, target_product text, new_on_hand numeric, new_minimum numeric, expected_revision bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_revision bigint; result_revision bigint;
begin
  if auth.uid() is null or not kream_private.can_order_store(target_store) then
    raise exception 'Stock access denied' using errcode = '42501';
  end if;
  if (new_on_hand is not null and not (new_on_hand >= 0 and new_on_hand <= 100000000 and new_on_hand = round(new_on_hand,3)))
    or (new_minimum is not null and not (new_minimum >= 0 and new_minimum <= 100000000 and new_minimum = round(new_minimum,3))) then
    raise exception 'Invalid stock quantity' using errcode = '22023';
  end if;
  -- Serialize the absent-row case as well as updates for this store/product.
  perform pg_advisory_xact_lock(hashtextextended(target_store || ':' || target_product, 0));
  select s.revision into current_revision from public.kream_stock s
    where s.store_id = target_store and s.product_id = target_product for update;
  if expected_revision is null or coalesce(current_revision,0) <> expected_revision then
    raise exception 'Stock changed; refresh before saving' using errcode = '40001';
  end if;
  if current_revision is null then
    insert into public.kream_stock(store_id,product_id,on_hand,minimum,counted_by,physical_count_at)
      values(target_store,target_product,new_on_hand,new_minimum,auth.uid(),clock_timestamp()) returning revision into result_revision;
  else
    update public.kream_stock set on_hand = new_on_hand, minimum = new_minimum, physical_count_at=clock_timestamp()
      where store_id = target_store and product_id = target_product returning revision into result_revision;
  end if;
  return result_revision;
end $function$
;
update public.kream_clover_items set product_id='sausage-bread',stock_per_sale=1,enabled=true where store_id='downtown' and clover_item_id='EQ80B85G8FC3R' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sheet-9e339b09aa',stock_per_sale=1,enabled=true where store_id='finch' and clover_item_id='19V02TTDN0YH8' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sausage-bread',stock_per_sale=1,enabled=true where store_id='finch' and clover_item_id='E2RXT3F2HNX60' and product_id is null and not enabled;
update public.kream_clover_items set product_id='tiramisu',stock_per_sale=1,enabled=true where store_id='midland' and clover_item_id='ZHMZ46RE33BD8' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sheet-9e339b09aa',stock_per_sale=1,enabled=true where store_id='midland' and clover_item_id='K6KPT7ET2044R' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sheet-9e339b09aa',stock_per_sale=1,enabled=true where store_id='richmond-hill' and clover_item_id='08WVRSJNY4GXY' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sausage-bread',stock_per_sale=1,enabled=true where store_id='richmond-hill' and clover_item_id='S7PG9V5QDSMZY' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sheet-c42f92202d',stock_per_sale=1,enabled=true where store_id='midland' and clover_item_id='ZHMZ46RE33BD8:PG9ED4XW3AWHM' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sheet-52e962d056',stock_per_sale=1,enabled=true where store_id='richmond-hill' and clover_item_id='NP27GZD8VS2W2:2D9Y0SBSQ8B4R' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sheet-790ead2a5b',stock_per_sale=1,enabled=true where store_id='finch' and clover_item_id='3YXNNB37WZVXE:73ZSMX81FCPF4' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sheet-fc126433db',stock_per_sale=1,enabled=true where store_id='finch' and clover_item_id='3YXNNB37WZVXE:GTDS2GN42SN86' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sheet-57897357d2',stock_per_sale=1,enabled=true where store_id='finch' and clover_item_id='JV83X62916HE6:02TRQCEEQNVFE' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sheet-64fa084fc2',stock_per_sale=1,enabled=true where store_id='finch' and clover_item_id='JV83X62916HE6:G3FMGTH06GNW4' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sheet-1e9121afc2',stock_per_sale=1,enabled=true where store_id='finch' and clover_item_id='JV83X62916HE6:V9HYCXWMN21EP' and product_id is null and not enabled;
update public.kream_clover_items set product_id='whole-strawberry-4',stock_per_sale=1,enabled=true where store_id='downtown' and clover_item_id='4VHK8HWTW12K8:80Z9330HHDZS2,DTERG65JSSE76' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sheet-5e65459382',stock_per_sale=1,enabled=true where store_id='finch' and clover_item_id='3YXNNB37WZVXE:4MZR3KVV9B06T' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sheet-de03fcb009',stock_per_sale=1,enabled=true where store_id='finch' and clover_item_id='3YXNNB37WZVXE:NM2J5BRHYGRZ6' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sheet-5e65459382',stock_per_sale=1,enabled=true where store_id='downtown' and clover_item_id='PEZ7GCHZKY4MP:BNVSYMZWTKQP2' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sheet-c42f92202d',stock_per_sale=1,enabled=true where store_id='finch' and clover_item_id='6J03VD6Q4B5G2:14NXJEEMAG1W4' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sheet-fc126433db',stock_per_sale=1,enabled=true where store_id='downtown' and clover_item_id='PEZ7GCHZKY4MP:T8GZ1G7S7CZ46' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sheet-c42f92202d',stock_per_sale=1,enabled=true where store_id='downtown' and clover_item_id='27BD4GSYFEDEJ:99VN2TSPY7274' and product_id is null and not enabled;
update public.kream_clover_items set product_id='sourdough-plain',stock_per_sale=1,enabled=true where store_id='finch' and clover_item_id='BHYWS6RZZ3D14:F4G5MB0ZN99CA' and product_id is null and not enabled;
update public.kream_clover_items set product_id='tiramisu',stock_per_sale=1,enabled=true where store_id='finch' and clover_item_id='6J03VD6Q4B5G2:FG2D6G88V2QSP' and product_id is null and not enabled;
update public.kream_clover_items set product_id='tiramisu',stock_per_sale=1,enabled=true where store_id='downtown' and clover_item_id='27BD4GSYFEDEJ:VWY6269YN8898' and product_id is null and not enabled;

create or replace function kream_private.stock_revision() returns trigger language plpgsql set search_path='' as $$begin new.revision:=old.revision+1;new.updated_at:=clock_timestamp();new.counted_by:=coalesce(auth.uid(),old.counted_by);return new;end;$$;
grant select on public.kream_catalog to service_role;
grant select,update on public.kream_stock to service_role;
