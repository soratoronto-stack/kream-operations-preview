create or replace function kream_private.galleria_access(manage boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.kream_profiles p where p.user_id=auth.uid() and p.active and not p.access_blocked and (
 p.role='owner' or p.role='factory' and (not manage or p.factory_manager) or
 p.role='manager' and p.general_manager or
 (not manage or p.role='manager') and p.role in ('employee','manager') and exists(select 1 from public.kream_memberships m join public.kream_stores s on s.id=m.store_id and s.active where m.user_id=p.user_id and m.store_id='galleria-ktown')));
$$;
revoke all on function kream_private.galleria_access(boolean) from public,anon;
grant execute on function kream_private.galleria_access(boolean) to authenticated;
create table public.kream_galleria_products(
 barcode text primary key check(barcode ~ '^[0-9]{12,14}$'),name_ko text not null,name_en text not null default '',category text not null,subgroup text not null,
 price_cents integer check(price_cents>=0),price_source text not null default '',price_month date,
 shelf_life_days integer check(shelf_life_days between 1 and 3650),name_label_sop text not null default '',barcode_label_sop text not null default '',
 catalog_id text references public.kream_catalog(id),stock_units_per_retail numeric check(stock_units_per_retail>0 and stock_units_per_retail<=100000),
 active boolean not null default true,revision bigint not null default 1,updated_at timestamptz not null default now(),updated_by uuid references public.kream_profiles(user_id),
 check((catalog_id is null)=(stock_units_per_retail is null)));
create index on public.kream_galleria_products(catalog_id);
create index on public.kream_galleria_products(updated_by);
create table public.kream_galleria_shipments(
 id uuid primary key,store_id text not null references public.kream_stores(id),dispatch_date date not null,note text not null default '',items jsonb not null,
 request_payload jsonb not null,recorded_by uuid not null references public.kream_profiles(user_id),recorded_name text not null,created_at timestamptz not null default now());
create index on public.kream_galleria_shipments(dispatch_date);
create index on public.kream_galleria_shipments(store_id);
create index on public.kream_galleria_shipments(recorded_by);
create table public.kream_galleria_retail_reports(
 store_id text not null references public.kream_stores(id),report_month date not null,sales_cents bigint not null check(sales_cents>=0),source text not null,note text not null default '',primary key(store_id,report_month),check(extract(day from report_month)=1));
alter table public.kream_galleria_products enable row level security;
alter table public.kream_galleria_shipments enable row level security;
alter table public.kream_galleria_retail_reports enable row level security;
revoke all on public.kream_galleria_products,public.kream_galleria_shipments,public.kream_galleria_retail_reports from anon,authenticated;
grant select on public.kream_galleria_products,public.kream_galleria_shipments,public.kream_galleria_retail_reports to authenticated;
create policy galleria_product_read on public.kream_galleria_products for select to authenticated using((select kream_private.galleria_access(false)));
create policy galleria_shipment_read on public.kream_galleria_shipments for select to authenticated using((select kream_private.galleria_access(false)));
create policy galleria_report_owner on public.kream_galleria_retail_reports for select to authenticated using((select kream_private.current_role())='owner');
create or replace function kream_private.save_galleria_product(code text,changes jsonb,expected_revision bigint)
returns void language plpgsql security definer set search_path='' as $$
declare p public.kream_galleria_products; price integer;days integer;
begin
 if not kream_private.galleria_access(true) then raise exception 'Not allowed' using errcode='42501';end if;
 select * into p from public.kream_galleria_products where barcode=code for update;
 if not found or p.revision<>expected_revision then raise exception 'Item changed. Reload first.' using errcode='40001';end if;
 price=nullif(changes->>'price_cents','')::integer;days=nullif(changes->>'shelf_life_days','')::integer;
 if length(coalesce(changes->>'name_label_sop',''))>5000 or length(coalesce(changes->>'barcode_label_sop',''))>5000 then raise exception 'Instructions too long';end if;
 update public.kream_galleria_products set price_cents=price,shelf_life_days=days,name_label_sop=coalesce(changes->>'name_label_sop',''),barcode_label_sop=coalesce(changes->>'barcode_label_sop',''),price_source=case when price is distinct from p.price_cents then 'Manager verified entry' else p.price_source end,revision=revision+1,updated_at=now(),updated_by=auth.uid() where barcode=code;
end;$$;
create or replace function public.kream_save_galleria_product(code text,changes jsonb,expected_revision bigint)
returns void language sql security invoker set search_path='' as $$select kream_private.save_galleria_product(code,changes,expected_revision);$$;
revoke all on function kream_private.save_galleria_product(text,jsonb,bigint),public.kream_save_galleria_product(text,jsonb,bigint) from public,anon;
grant execute on function kream_private.save_galleria_product(text,jsonb,bigint),public.kream_save_galleria_product(text,jsonb,bigint) to authenticated;
create or replace function kream_private.record_galleria_shipment(request_id uuid,payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor public.kream_profiles;prior public.kream_galleria_shipments;p public.kream_galleria_products;cat public.kream_catalog;i jsonb;q numeric;snap jsonb='[]';code text;seen text[]='{}';used text[]='{}';amt numeric;dt date;
begin
 if not kream_private.galleria_access(false) then raise exception 'Not allowed' using errcode='42501';end if;
 if request_id is null or payload is null then raise exception 'Invalid request';end if;
 perform pg_advisory_xact_lock(hashtextextended('galleria-shipment:'||request_id::text,0));
 select * into prior from public.kream_galleria_shipments where id=request_id;
 if found then
 if prior.recorded_by<>auth.uid() or prior.request_payload<>payload then raise exception 'Request conflict';end if;return request_id;end if;
 if payload->>'store_id'<>'galleria-ktown' or not exists(select 1 from public.kream_stores where id='galleria-ktown' and active) then raise exception 'Inactive location';end if;
 dt=(payload->>'date')::date;
 if dt is null or dt>(now() at time zone 'America/Toronto')::date then raise exception 'Enter the actual dispatch date';end if;
 if length(coalesce(payload->>'note',''))>2000 or jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 200 then raise exception 'Invalid items';end if;
 select * into actor from public.kream_profiles where user_id=auth.uid();
 for i in select value from jsonb_array_elements(payload->'items') order by value->>'barcode' loop
 code=i->>'barcode';q=(i->>'quantity')::numeric;
 if q is null or q::text in ('NaN','Infinity','-Infinity') or q<=0 or q>100000 or trunc(q)<>q or code=any(seen) then raise exception 'Invalid quantity';end if;
 select * into p from public.kream_galleria_products where barcode=code and active for share;
 if not found then raise exception 'Unknown item';end if;
 seen=array_append(seen,code);
 snap=snap||jsonb_build_array(jsonb_build_object('barcode',code,'name_ko',p.name_ko,'name_en',p.name_en,'quantity',q,'price_cents',p.price_cents,'unit','EA','catalog_id',p.catalog_id,'stock_units_per_retail',p.stock_units_per_retail));
 if p.catalog_id is not null then
 if p.catalog_id=any(used) then raise exception 'Duplicate stock link';end if;used=array_append(used,p.catalog_id);
 select * into cat from public.kream_catalog where id=p.catalog_id and active and not archived for share;
 if not found then raise exception 'Linked stock item unavailable';end if;
 amt=q*p.stock_units_per_retail;
 insert into public.kream_finished_movements(product_id,order_unit,kind,source_id,delta,recorded_by) values(cat.id,cat.order_unit,'dispatch',request_id,-amt,auth.uid());
 insert into public.kream_finished_stock(product_id,order_unit,quantity) values(cat.id,cat.order_unit,-amt) on conflict(product_id,order_unit) do update set quantity=kream_finished_stock.quantity+excluded.quantity,revision=kream_finished_stock.revision+1,updated_at=now();
 end if;
 end loop;
 insert into public.kream_galleria_shipments(id,store_id,dispatch_date,note,items,request_payload,recorded_by,recorded_name) values(request_id,'galleria-ktown',dt,coalesce(payload->>'note',''),snap,payload,auth.uid(),actor.display_name);
 return request_id;
end;$$;
create or replace function public.kream_record_galleria_shipment(request_id uuid,payload jsonb)
returns uuid language sql security invoker set search_path='' as $$select kream_private.record_galleria_shipment(request_id,payload);$$;
revoke all on function kream_private.record_galleria_shipment(uuid,jsonb),public.kream_record_galleria_shipment(uuid,jsonb) from public,anon;
grant execute on function kream_private.record_galleria_shipment(uuid,jsonb),public.kream_record_galleria_shipment(uuid,jsonb) to authenticated;
