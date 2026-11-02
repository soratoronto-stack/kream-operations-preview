begin;
alter table public.kream_catalog add column photo_path text,add column archived boolean not null default false,add column production_team text check(production_team in ('breads','desserts','cookies','other'));
create table public.kream_catalog_audit(id bigint generated always as identity primary key,product_id text not null,previous_data jsonb,new_data jsonb not null,recorded_by uuid not null references public.kream_profiles(user_id),recorded_name text not null,created_at timestamptz not null default clock_timestamp());
alter table public.kream_catalog_audit enable row level security;
revoke all on public.kream_catalog_audit from public,anon,authenticated;
grant select on public.kream_catalog_audit to authenticated;
create policy catalog_audit_read on public.kream_catalog_audit for select to authenticated using(kream_private.current_role() in ('owner','manager'));
create function public.kream_save_product(product_key text,korean_name text,english_name text,main_category text,sub_category text,unit_label text,unit_verified boolean,is_active boolean,is_archived boolean,image_path text,team_key text,expected_revision bigint) returns text language plpgsql security definer set search_path='' as $$
declare old public.kream_catalog%rowtype;saved public.kream_catalog%rowtype;author text;
begin
 if auth.uid() is null or coalesce(kream_private.current_role(),'') not in ('owner','manager') then raise exception 'Product management denied' using errcode='42501';end if;
 if product_key is null or char_length(product_key) not between 1 and 100 or korean_name is null or char_length(btrim(korean_name)) not between 1 and 160 or english_name is null or char_length(btrim(english_name)) not between 1 and 160 or main_category is null or char_length(main_category)>80 or sub_category is null or char_length(sub_category)>80 or unit_label is null or char_length(btrim(unit_label)) not between 1 and 80 or unit_verified is null or is_active is null or is_archived is null or is_active and is_archived or (team_key is not null and team_key not in ('breads','desserts','cookies','other')) then raise exception 'Invalid product' using errcode='22023';end if;
 if image_path is not null and (char_length(image_path)>250 or not exists(select 1 from storage.objects o where o.bucket_id='kream-product-photos' and o.name=image_path)) then raise exception 'Invalid product photo' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('kream-product:'||product_key,0));
 select * into old from public.kream_catalog where id=product_key for update;
 if coalesce(old.revision,0) is distinct from expected_revision then raise exception 'PRODUCT_CONFLICT' using errcode='40001';end if;
 if old.id is not null and old.order_unit<>btrim(unit_label) and (exists(select 1 from public.kream_order_items where product_id=product_key) or exists(select 1 from public.kream_stock where product_id=product_key) or exists(select 1 from public.kream_production_logs where product_id=product_key)) then raise exception 'UNIT_IN_USE' using errcode='22023';end if;
 insert into public.kream_catalog(id,name_ko,name_en,category,subgroup,order_unit,unit_confirmed,active,archived,photo_path,production_team)
 values(product_key,btrim(korean_name),btrim(english_name),btrim(main_category),btrim(sub_category),btrim(unit_label),unit_verified,is_active,is_archived,image_path,team_key)
 on conflict(id) do update set name_ko=excluded.name_ko,name_en=excluded.name_en,category=excluded.category,subgroup=excluded.subgroup,order_unit=excluded.order_unit,unit_confirmed=excluded.unit_confirmed,active=excluded.active,archived=excluded.archived,photo_path=excluded.photo_path,production_team=excluded.production_team
 returning * into saved;
 select display_name into author from public.kream_profiles where user_id=auth.uid();
 insert into public.kream_catalog_audit(product_id,previous_data,new_data,recorded_by,recorded_name) values(product_key,case when old.id is null then null else to_jsonb(old) end,to_jsonb(saved),auth.uid(),author);
 return product_key;
end;$$;
revoke all on function public.kream_save_product(text,text,text,text,text,text,boolean,boolean,boolean,text,text,bigint) from public,anon;
grant execute on function public.kream_save_product(text,text,text,text,text,text,boolean,boolean,boolean,text,text,bigint) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('kream-product-photos','kream-product-photos',false,524288,array['image/jpeg','image/png','image/webp']);
create policy kream_photo_read on storage.objects for select to authenticated using(bucket_id='kream-product-photos' and kream_private.current_role() is not null);
create policy kream_photo_upload on storage.objects for insert to authenticated with check(bucket_id='kream-product-photos' and kream_private.current_role() in ('owner','manager') and (storage.foldername(name))[1]=auth.uid()::text);

create table public.kream_daily_logs (
 id uuid primary key,sequence bigint generated always as identity unique,store_id text not null references public.kream_stores(id),log_date date not null,
 no_exceptions boolean not null,stockout text not null default '',incident text not null default '',request text not null default '',
 recorded_by uuid not null references public.kream_profiles(user_id),recorded_name text not null,created_at timestamptz not null default clock_timestamp(),
 check(char_length(stockout)<=2000 and char_length(incident)<=2000 and char_length(request)<=2000),check(no_exceptions or char_length(btrim(stockout||incident||request))>0)
);
create index daily_logs_store_day on public.kream_daily_logs(store_id,log_date,sequence desc);
alter table public.kream_daily_logs enable row level security;
revoke all on public.kream_daily_logs from public,anon,authenticated;
grant select on public.kream_daily_logs to authenticated;
create policy daily_logs_read on public.kream_daily_logs for select to authenticated using(kream_private.can_manage_store(store_id));
create function public.kream_save_daily_log(request_id uuid,target_store text,record_date date,all_clear boolean,stockout_note text,incident_note text,request_note text,expected_entry uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare old public.kream_daily_logs%rowtype;last_id uuid;author text;
begin
 if auth.uid() is null or not coalesce(kream_private.can_manage_store(target_store),false) then raise exception 'Daily log denied' using errcode='42501';end if;
 if request_id is null or record_date is null or record_date>(now() at time zone 'America/Toronto')::date or all_clear is null or stockout_note is null or incident_note is null or request_note is null or char_length(stockout_note)>2000 or char_length(incident_note)>2000 or char_length(request_note)>2000 or (not all_clear and char_length(btrim(stockout_note||incident_note||request_note))=0) or (all_clear and char_length(btrim(stockout_note||incident_note||request_note))>0) then raise exception 'Invalid daily log' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('kream-daily-id:'||request_id::text,0));
 select * into old from public.kream_daily_logs where id=request_id;
 if found then
 if old.store_id<>target_store or old.log_date<>record_date or old.no_exceptions<>all_clear or old.stockout<>btrim(stockout_note) or old.incident<>btrim(incident_note) or old.request<>btrim(request_note) or old.recorded_by<>auth.uid() then raise exception 'Daily retry conflict' using errcode='22023';end if;return request_id;end if;
 perform pg_advisory_xact_lock(hashtextextended('kream-daily:'||target_store||record_date::text,0));
 select id into last_id from public.kream_daily_logs where store_id=target_store and log_date=record_date order by sequence desc limit 1;
 if last_id is distinct from expected_entry then raise exception 'DAILY_CONFLICT' using errcode='40001';end if;
 select display_name into author from public.kream_profiles where user_id=auth.uid();
 insert into public.kream_daily_logs(id,store_id,log_date,no_exceptions,stockout,incident,request,recorded_by,recorded_name) values(request_id,target_store,record_date,all_clear,btrim(stockout_note),btrim(incident_note),btrim(request_note),auth.uid(),author);
 return request_id;
end;$$;
revoke all on function public.kream_save_daily_log(uuid,text,date,boolean,text,text,text,uuid) from public,anon;
grant execute on function public.kream_save_daily_log(uuid,text,date,boolean,text,text,text,uuid) to authenticated;
update public.kream_catalog set production_team='cookies' where id='sheet-c4bd38d984';
update public.kream_catalog set production_team='cookies' where id='cookie';
update public.kream_catalog set production_team='cookies' where id='sheet-4c1b6660cd';
update public.kream_catalog set production_team='cookies' where id='sheet-5910a46312';
update public.kream_catalog set production_team='desserts' where id='chewy';
update public.kream_catalog set production_team='desserts' where id='sheet-70441a15e7';
update public.kream_catalog set production_team='desserts' where id='sheet-9ea75322e4';
update public.kream_catalog set production_team='desserts' where id='sheet-1f39626328';
update public.kream_catalog set production_team='desserts' where id='tiramisu';
update public.kream_catalog set production_team='desserts' where id='sheet-52e962d056';
update public.kream_catalog set production_team='desserts' where id='sheet-c42f92202d';
update public.kream_catalog set production_team='desserts' where id='cheesecake';
update public.kream_catalog set production_team='desserts' where id='sheet-9fad2225f6';
update public.kream_catalog set production_team='desserts' where id='sheet-e7cab97855';
update public.kream_catalog set production_team='desserts' where id='sheet-04562b9807';
update public.kream_catalog set production_team='desserts' where id='sheet-9fbb33a000';
update public.kream_catalog set production_team='desserts' where id='sheet-08ea6b9890';
update public.kream_catalog set production_team='desserts' where id='sheet-39cdeb9512';
update public.kream_catalog set production_team='desserts' where id='sheet-5e65459382';
update public.kream_catalog set production_team='desserts' where id='sheet-fc126433db';
update public.kream_catalog set production_team='desserts' where id='sheet-de03fcb009';
update public.kream_catalog set production_team='desserts' where id='sheet-790ead2a5b';
update public.kream_catalog set production_team='desserts' where id='sheet-1e9121afc2';
update public.kream_catalog set production_team='desserts' where id='sheet-64fa084fc2';
update public.kream_catalog set production_team='desserts' where id='sheet-e35b099b4e';
update public.kream_catalog set production_team='desserts' where id='sheet-57897357d2';
update public.kream_catalog set production_team='desserts' where id='sheet-81132cad4c';
update public.kream_catalog set production_team='desserts' where id='sheet-8beb781129';
update public.kream_catalog set production_team='desserts' where id='sheet-9e339b09aa';
update public.kream_catalog set production_team='breads' where id='sheet-d4673975bb';
update public.kream_catalog set production_team='breads' where id='sheet-eff3f8ae0f';
update public.kream_catalog set production_team='breads' where id='sheet-eaba7a48b5';
update public.kream_catalog set production_team='desserts' where id='sheet-84dd8c64a5';
update public.kream_catalog set production_team='desserts' where id='sheet-48cab960c4';
update public.kream_catalog set production_team='desserts' where id='sheet-a5510527f8';
update public.kream_catalog set production_team='desserts' where id='sheet-b3beaa8199';
update public.kream_catalog set production_team='desserts' where id='sheet-62128bbcbd';
update public.kream_catalog set production_team='desserts' where id='sheet-ef72a19d78';
update public.kream_catalog set production_team='desserts' where id='sheet-6628ff7e9d';
update public.kream_catalog set production_team='desserts' where id='sheet-e5c4aff346';
update public.kream_catalog set production_team='desserts' where id='sheet-a50303e24b';
update public.kream_catalog set production_team='desserts' where id='sheet-ad545671f9';
update public.kream_catalog set production_team='desserts' where id='sheet-c099d91460';
update public.kream_catalog set production_team='desserts' where id='sheet-3a6b5af67a';
update public.kream_catalog set production_team='desserts' where id='sheet-cc12679fbf';
update public.kream_catalog set production_team='desserts' where id='sheet-ebf82e7213';
update public.kream_catalog set production_team='desserts' where id='sheet-af6370a88b';
update public.kream_catalog set production_team='breads' where id='sheet-2a614f0f8e';
update public.kream_catalog set production_team='breads' where id='sheet-43435b9f88';
update public.kream_catalog set production_team='breads' where id='sheet-4fac4070a1';
update public.kream_catalog set production_team='breads' where id='sheet-c3c6e12f1d';
update public.kream_catalog set production_team='breads' where id='sheet-5827ce1c7f';
update public.kream_catalog set production_team='breads' where id='sheet-2acde78450';
commit;
