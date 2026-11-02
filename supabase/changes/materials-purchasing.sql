begin;
alter table public.kream_profiles add column factory_manager boolean not null default false;
create function kream_private.can_manage_purchases() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.kream_profiles p where p.user_id=auth.uid() and p.active and (p.role='owner' or p.role='factory' and p.factory_manager)) $$;
revoke all on function kream_private.can_manage_purchases() from public,anon;
grant execute on function kream_private.can_manage_purchases() to authenticated;
create table public.kream_suppliers(id uuid primary key,name text not null check(char_length(btrim(name)) between 1 and 160),active boolean not null default true,revision bigint not null default 1);
create table public.kream_materials (
 id uuid primary key,name_ko text not null,name_en text not null,category text not null,unit text not null,unit_confirmed boolean not null default false,active boolean not null default true,
 supplier_id uuid references public.kream_suppliers(id),on_hand numeric(12,3),minimum numeric(12,3),base_stock numeric(12,3),revision bigint not null default 1,
 updated_by uuid not null references public.kream_profiles(user_id),updated_name text not null,updated_at timestamptz not null default clock_timestamp(),
 check(on_hand between 0 and 100000000 and minimum between 0 and 100000 and base_stock between 0 and 100000)
);
create table public.kream_purchases (
 id uuid primary key,material_id uuid not null references public.kream_materials(id),name_ko text not null,name_en text not null,unit text not null,supplier_id uuid not null references public.kream_suppliers(id),supplier_name text not null,
 quantity numeric(12,3) not null check(quantity>0 and quantity<=100000),status text not null default 'requested' check(status in ('requested','purchased','received','cancelled')),
 recorded_by uuid not null references public.kream_profiles(user_id),recorded_name text not null,created_at timestamptz not null default clock_timestamp(),
 purchased_by uuid references public.kream_profiles(user_id),purchased_name text,purchased_at timestamptz
);
create table public.kream_purchase_receipts(id uuid primary key,purchase_id uuid not null references public.kream_purchases(id),quantity numeric(12,3) not null check(quantity>0 and quantity<=100000),recorded_by uuid not null references public.kream_profiles(user_id),recorded_name text not null,created_at timestamptz not null default clock_timestamp());
create index purchases_created on public.kream_purchases(created_at desc);
alter table public.kream_suppliers enable row level security;
alter table public.kream_materials enable row level security;
alter table public.kream_purchases enable row level security;
alter table public.kream_purchase_receipts enable row level security;
revoke all on public.kream_suppliers,public.kream_materials,public.kream_purchases,public.kream_purchase_receipts from public,anon,authenticated;
grant select on public.kream_suppliers,public.kream_materials,public.kream_purchases,public.kream_purchase_receipts to authenticated;
create policy supplier_read on public.kream_suppliers for select to authenticated using(kream_private.current_role() in ('owner','factory'));
create policy material_read on public.kream_materials for select to authenticated using(kream_private.current_role() in ('owner','factory'));
create policy purchase_read on public.kream_purchases for select to authenticated using(kream_private.can_manage_purchases());
create policy purchase_receipts_read on public.kream_purchase_receipts for select to authenticated using(kream_private.can_manage_purchases());
create function public.kream_save_supplier(supplier_key uuid,supplier_name text,is_active boolean,expected_revision bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare r bigint;
begin
 if not kream_private.can_manage_purchases() then raise exception 'Supplier denied' using errcode='42501';end if;
 if supplier_key is null or supplier_name is null or char_length(btrim(supplier_name)) not between 1 and 160 or is_active is null then raise exception 'Invalid supplier' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('kream-supplier:'||supplier_key::text,0));select revision into r from public.kream_suppliers where id=supplier_key;
 if coalesce(r,0) is distinct from expected_revision then raise exception 'Supplier conflict' using errcode='40001';end if;
 insert into public.kream_suppliers(id,name,active) values(supplier_key,btrim(supplier_name),is_active) on conflict(id) do update set name=excluded.name,active=excluded.active,revision=kream_suppliers.revision+1;return supplier_key;
end;$$;
create function public.kream_save_material(material_key uuid,korean_name text,english_name text,item_category text,unit_label text,unit_verified boolean,is_active boolean,supplier_key uuid,current_stock numeric,minimum_stock numeric,target_stock numeric,expected_revision bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare old public.kream_materials%rowtype;author text;
begin
 if auth.uid() is null or coalesce(kream_private.current_role(),'') not in ('owner','factory') then raise exception 'Material denied' using errcode='42501';end if;
 if material_key is null or korean_name is null or char_length(btrim(korean_name)) not between 1 and 160 or english_name is null or char_length(btrim(english_name)) not between 1 and 160 or item_category is null or char_length(item_category)>80 or unit_label is null or char_length(btrim(unit_label)) not between 1 and 80 or unit_verified is null or is_active is null then raise exception 'Invalid material' using errcode='22023';end if;
 if exists(select 1 from unnest(array[current_stock,minimum_stock,target_stock]) q where q::text in ('NaN','Infinity','-Infinity') or q<0 or q>100000000 or q<>round(q,3)) or minimum_stock>100000 or target_stock>100000 or target_stock<minimum_stock then raise exception 'Invalid material stock' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('kream-material:'||material_key::text,0));select * into old from public.kream_materials where id=material_key for update;
 if coalesce(old.revision,0) is distinct from expected_revision then raise exception 'Material conflict' using errcode='40001';end if;
 if not kream_private.can_manage_purchases() and (old.id is null or old.name_ko<>btrim(korean_name) or old.name_en<>btrim(english_name) or old.category<>btrim(item_category) or old.unit<>btrim(unit_label) or old.unit_confirmed<>unit_verified or old.active<>is_active or old.supplier_id is distinct from supplier_key or old.minimum is distinct from minimum_stock or old.base_stock is distinct from target_stock) then raise exception 'Only managers edit material settings' using errcode='42501';end if;
 if old.id is not null and old.unit<>btrim(unit_label) and (old.on_hand is not null or exists(select 1 from public.kream_purchases where material_id=material_key)) then raise exception 'UNIT_IN_USE' using errcode='22023';end if;
 select display_name into author from public.kream_profiles where user_id=auth.uid();
 insert into public.kream_materials(id,name_ko,name_en,category,unit,unit_confirmed,active,supplier_id,on_hand,minimum,base_stock,updated_by,updated_name)
 values(material_key,btrim(korean_name),btrim(english_name),btrim(item_category),btrim(unit_label),unit_verified,is_active,supplier_key,current_stock,minimum_stock,target_stock,auth.uid(),author)
 on conflict(id) do update set name_ko=excluded.name_ko,name_en=excluded.name_en,category=excluded.category,unit=excluded.unit,unit_confirmed=excluded.unit_confirmed,active=excluded.active,supplier_id=excluded.supplier_id,on_hand=excluded.on_hand,minimum=excluded.minimum,base_stock=excluded.base_stock,revision=kream_materials.revision+1,updated_by=excluded.updated_by,updated_name=excluded.updated_name,updated_at=clock_timestamp();return material_key;
end;$$;
create function public.kream_request_purchase(request_id uuid,target_material uuid,amount numeric) returns uuid language plpgsql security definer set search_path='' as $$
declare old public.kream_purchases%rowtype;m public.kream_materials%rowtype;s public.kream_suppliers%rowtype;author text;
begin
 if not kream_private.can_manage_purchases() then raise exception 'Purchase denied' using errcode='42501';end if;
 if request_id is null or amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<=0 or amount>100000 or amount<>round(amount,3) then raise exception 'Invalid purchase' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('kream-purchase:'||request_id::text,0));select * into old from public.kream_purchases where id=request_id;
 if found then if old.recorded_by<>auth.uid() or old.material_id<>target_material or old.quantity<>amount then raise exception 'Purchase retry conflict' using errcode='22023';end if;return request_id;end if;
 select * into m from public.kream_materials where id=target_material and active and unit_confirmed for share;
 select * into s from public.kream_suppliers where id=m.supplier_id and active;
 if m.id is null or s.id is null then raise exception 'Material or supplier setup needed' using errcode='22023';end if;
 select display_name into author from public.kream_profiles where user_id=auth.uid();
 insert into public.kream_purchases(id,material_id,name_ko,name_en,unit,supplier_id,supplier_name,quantity,recorded_by,recorded_name) values(request_id,m.id,m.name_ko,m.name_en,m.unit,s.id,s.name,amount,auth.uid(),author);return request_id;
end;$$;
create function public.kream_mark_purchase(target_purchase uuid,new_status text) returns uuid language plpgsql security definer set search_path='' as $$
declare old public.kream_purchases%rowtype;author text;
begin
 if not kream_private.can_manage_purchases() then raise exception 'Purchase denied' using errcode='42501';end if;
 select * into old from public.kream_purchases where id=target_purchase for update;
 if old.id is null or new_status is null or new_status not in ('purchased','cancelled') then raise exception 'Invalid purchase status' using errcode='22023';end if;
 if old.status=new_status then return old.id;end if;
 if old.status<>'requested' then raise exception 'Purchase status conflict' using errcode='40001';end if;
 select display_name into author from public.kream_profiles where user_id=auth.uid();
 update public.kream_purchases set status=new_status,purchased_by=auth.uid(),purchased_name=author,purchased_at=clock_timestamp() where id=target_purchase;return target_purchase;
end;$$;
create function public.kream_receive_purchase(request_id uuid,target_purchase uuid,amount numeric) returns uuid language plpgsql security definer set search_path='' as $$
declare old public.kream_purchase_receipts%rowtype;p public.kream_purchases%rowtype;received numeric;author text;
begin
 if not kream_private.can_manage_purchases() then raise exception 'Purchase receipt denied' using errcode='42501';end if;
 if request_id is null or amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<=0 or amount>100000 or amount<>round(amount,3) then raise exception 'Invalid receipt' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('kream-purchase-receipt:'||request_id::text,0));select * into old from public.kream_purchase_receipts where id=request_id;
 if found then if old.recorded_by<>auth.uid() or old.purchase_id<>target_purchase or old.quantity<>amount then raise exception 'Receipt retry conflict' using errcode='22023';end if;return request_id;end if;
 select * into p from public.kream_purchases where id=target_purchase for update;
 if p.id is null or p.status<>'purchased' then raise exception 'Purchase not ready' using errcode='22023';end if;
 select coalesce(sum(quantity),0) into received from public.kream_purchase_receipts where purchase_id=p.id;
 if received+amount>p.quantity then raise exception 'Receipt exceeds purchase' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('kream-material:'||p.material_id::text,0));
 select display_name into author from public.kream_profiles where user_id=auth.uid();
 insert into public.kream_purchase_receipts(id,purchase_id,quantity,recorded_by,recorded_name) values(request_id,p.id,amount,auth.uid(),author);
 update public.kream_materials set on_hand=case when on_hand is null then null else on_hand+amount end,revision=revision+1,updated_by=auth.uid(),updated_name=author,updated_at=clock_timestamp() where id=p.material_id;
 if received+amount=p.quantity then update public.kream_purchases set status='received' where id=p.id;end if;return request_id;
end;$$;
revoke all on function public.kream_save_supplier(uuid,text,boolean,bigint),public.kream_save_material(uuid,text,text,text,text,boolean,boolean,uuid,numeric,numeric,numeric,bigint),public.kream_request_purchase(uuid,uuid,numeric),public.kream_mark_purchase(uuid,text),public.kream_receive_purchase(uuid,uuid,numeric) from public,anon;
grant execute on function public.kream_save_supplier(uuid,text,boolean,bigint),public.kream_save_material(uuid,text,text,text,text,boolean,boolean,uuid,numeric,numeric,numeric,bigint),public.kream_request_purchase(uuid,uuid,numeric),public.kream_mark_purchase(uuid,text),public.kream_receive_purchase(uuid,uuid,numeric) to authenticated;
insert into public.kream_suppliers(id,name) values('90000000-0000-4000-8000-000000000001','Costco'),('90000000-0000-4000-8000-000000000002','MVR'),('90000000-0000-4000-8000-000000000003','마트');
commit;
