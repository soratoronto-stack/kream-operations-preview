begin;
create function kream_private.can_manage_store(s text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and coalesce(kream_private.current_role(),'') in ('owner','manager','midland_owner') and kream_private.can_order_store(s)
$$;
revoke all on function kream_private.can_manage_store(text) from public,anon;
grant execute on function kream_private.can_manage_store(text) to authenticated;
create table public.kream_order_layout (
 store_id text primary key references public.kream_stores(id),
 category_order text[] not null default '{}',subgroup_order text[] not null default '{}',product_order text[] not null default '{}',
 revision bigint not null default 1,updated_by uuid not null references public.kream_profiles(user_id),updated_at timestamptz not null default now()
);
alter table public.kream_order_layout enable row level security;
revoke all on public.kream_order_layout from public,anon,authenticated;
grant select on public.kream_order_layout to authenticated;
create policy layout_read on public.kream_order_layout for select to authenticated using(kream_private.can_order_store(store_id));
create function public.kream_save_order_layout(target_store text,categories text[],subgroups text[],products text[],expected_revision bigint) returns bigint language plpgsql security definer set search_path='' as $$
declare oldrev bigint; nextrev bigint;
begin
 if not coalesce(kream_private.can_manage_store(target_store),false) then raise exception 'Layout denied' using errcode='42501';end if;
 if categories is null or subgroups is null or products is null or cardinality(categories)>1000 or cardinality(subgroups)>1000 or cardinality(products)>1000 then raise exception 'Invalid layout' using errcode='22023';end if;
 if exists(select 1 from unnest(categories||subgroups||products) v where v is null or char_length(v)>500)
 or cardinality(categories)<>(select count(distinct v) from unnest(categories) v)
 or cardinality(subgroups)<>(select count(distinct v) from unnest(subgroups) v)
 or cardinality(products)<>(select count(distinct v) from unnest(products) v)
 or exists(select 1 from unnest(products) v where not exists(select 1 from public.kream_catalog p where p.id=v)) then raise exception 'Invalid layout entries' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('kream-layout:'||target_store,0));
 select revision into oldrev from public.kream_order_layout where store_id=target_store;
 if coalesce(oldrev,0) is distinct from expected_revision then raise exception 'LAYOUT_CONFLICT' using errcode='40001';end if;
 nextrev:=coalesce(oldrev,0)+1;
 insert into public.kream_order_layout(store_id,category_order,subgroup_order,product_order,revision,updated_by)
 values(target_store,categories,subgroups,products,nextrev,auth.uid())
 on conflict(store_id) do update set category_order=excluded.category_order,subgroup_order=excluded.subgroup_order,product_order=excluded.product_order,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 return nextrev;
end;$$;
revoke all on function public.kream_save_order_layout(text,text[],text[],text[],bigint) from public,anon;
grant execute on function public.kream_save_order_layout(text,text[],text[],text[],bigint) to authenticated;

-- Names are an account preference only. This never changes role, membership or activation.
create function public.kream_set_display_name(new_name text) returns text language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or kream_private.current_role() is null then raise exception 'Authentication required' using errcode='42501';end if;
 if new_name is null or char_length(btrim(new_name)) not between 1 and 120 then raise exception 'Invalid name' using errcode='22023';end if;
 update public.kream_profiles set display_name=btrim(new_name) where user_id=auth.uid();return btrim(new_name);
end;$$;
revoke all on function public.kream_set_display_name(text) from public,anon;
grant execute on function public.kream_set_display_name(text) to authenticated;

create table public.kream_checklist_items (
 id uuid primary key,store_id text not null references public.kream_stores(id),phase text not null check(phase in ('opening','midday','closing')),
 title_ko text not null check(char_length(btrim(title_ko)) between 1 and 300), title_en text not null default '' check(char_length(title_en)<=300),
 active boolean not null default true,position integer not null default 0 check(position between 0 and 10000),revision bigint not null default 1,
 updated_by uuid not null references public.kream_profiles(user_id),updated_at timestamptz not null default now()
);
create table public.kream_checklist_events (
 id uuid primary key,sequence bigint generated always as identity unique,
 item_id uuid not null references public.kream_checklist_items(id),store_id text not null references public.kream_stores(id),check_date date not null,
 phase text not null,title_ko text not null,title_en text not null,is_checked boolean not null,
 recorded_by uuid not null references public.kream_profiles(user_id),recorded_name text not null,created_at timestamptz not null default clock_timestamp()
);
create index checklist_events_day on public.kream_checklist_events(store_id,check_date,sequence desc);
alter table public.kream_checklist_items enable row level security;
alter table public.kream_checklist_events enable row level security;
revoke all on public.kream_checklist_items,public.kream_checklist_events from public,anon,authenticated;
grant select on public.kream_checklist_items,public.kream_checklist_events to authenticated;
create policy checklist_items_read on public.kream_checklist_items for select to authenticated using(kream_private.can_read_store(store_id));
create policy checklist_events_read on public.kream_checklist_events for select to authenticated using(kream_private.can_read_store(store_id));
create function public.kream_save_checklist_item(item_uuid uuid,target_store text,item_phase text,korean_title text,english_title text,is_active boolean,item_position integer,expected_revision bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare old public.kream_checklist_items%rowtype;
begin
 if not coalesce(kream_private.can_manage_store(target_store),false) then raise exception 'Checklist management denied' using errcode='42501';end if;
 if item_uuid is null or item_phase is null or item_phase not in ('opening','midday','closing') or korean_title is null or char_length(btrim(korean_title)) not between 1 and 300 or english_title is null or char_length(english_title)>300 or is_active is null or item_position is null or item_position not between 0 and 10000 then raise exception 'Invalid checklist item' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('kream-checklist-item:'||item_uuid::text,0));
 select * into old from public.kream_checklist_items where id=item_uuid;
 if found and old.store_id<>target_store then raise exception 'Checklist denied' using errcode='42501';end if;
 if coalesce(old.revision,0) is distinct from expected_revision then
 if expected_revision=0 and old.revision=1 and old.updated_by=auth.uid() and old.phase=item_phase and old.title_ko=btrim(korean_title) and old.title_en=btrim(english_title) and old.active=is_active and old.position=item_position then return item_uuid;end if;
 raise exception 'CHECKLIST_CONFLICT' using errcode='40001';end if;
 insert into public.kream_checklist_items(id,store_id,phase,title_ko,title_en,active,position,updated_by)
 values(item_uuid,target_store,item_phase,btrim(korean_title),btrim(english_title),is_active,item_position,auth.uid())
 on conflict(id) do update set phase=excluded.phase,title_ko=excluded.title_ko,title_en=excluded.title_en,active=excluded.active,position=excluded.position,revision=kream_checklist_items.revision+1,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 return item_uuid;
end;$$;
revoke all on function public.kream_save_checklist_item(uuid,text,text,text,text,boolean,integer,bigint) from public,anon;
grant execute on function public.kream_save_checklist_item(uuid,text,text,text,text,boolean,integer,bigint) to authenticated;
create function public.kream_check_item(request_id uuid,target_item uuid,checked boolean,expected_event uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare item public.kream_checklist_items%rowtype; prior public.kream_checklist_events%rowtype; last_id uuid; author text; day date:=(now() at time zone 'America/Toronto')::date;
begin
 select * into item from public.kream_checklist_items where id=target_item;
 if auth.uid() is null or not coalesce(kream_private.can_order_store(item.store_id),false) then raise exception 'Checklist check denied' using errcode='42501';end if;
 if request_id is null or checked is null then raise exception 'Invalid check' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('kream-check-request:'||request_id::text,0));
 select * into prior from public.kream_checklist_events where id=request_id;
 if found then
 if prior.item_id<>target_item or prior.is_checked<>checked or prior.recorded_by<>auth.uid() then raise exception 'Check request conflict' using errcode='22023';end if;return request_id;end if;
 perform pg_advisory_xact_lock(hashtextextended('kream-check:'||target_item::text||day::text,0));
 if not item.active then raise exception 'Checklist inactive' using errcode='22023';end if;
 select id into last_id from public.kream_checklist_events where item_id=target_item and check_date=day order by sequence desc limit 1;
 if last_id is distinct from expected_event then raise exception 'CHECKLIST_CONFLICT' using errcode='40001';end if;
 select display_name into author from public.kream_profiles where user_id=auth.uid();
 insert into public.kream_checklist_events(id,item_id,store_id,check_date,phase,title_ko,title_en,is_checked,recorded_by,recorded_name)
 values(request_id,item.id,item.store_id,day,item.phase,item.title_ko,item.title_en,checked,auth.uid(),author);
 return request_id;
end;$$;
revoke all on function public.kream_check_item(uuid,uuid,boolean,uuid) from public,anon;
grant execute on function public.kream_check_item(uuid,uuid,boolean,uuid) to authenticated;

-- Store the name at the time of receipt/dispatch; existing rows are deliberately not backfilled with guessed historical names.
alter table public.kream_receipts add column recorded_name text;
alter table public.kream_dispatches add column recorded_name text;
create function kream_private.stamp_work_name() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select display_name into new.recorded_name from public.kream_profiles where user_id=case when tg_table_name='kream_receipts' then (to_jsonb(new)->>'received_by')::uuid else (to_jsonb(new)->>'dispatched_by')::uuid end;
 return new;
end;$$;
revoke all on function kream_private.stamp_work_name() from public,anon,authenticated;
create trigger receipt_work_name before insert on public.kream_receipts for each row execute function kream_private.stamp_work_name();
create trigger dispatch_work_name before insert on public.kream_dispatches for each row execute function kream_private.stamp_work_name();

create table public.kream_production_logs (
 id uuid primary key,production_date date not null,product_id text not null references public.kream_catalog(id),name_ko text not null,name_en text not null,
 quantity numeric(12,3) not null check(quantity>0 and quantity<=100000),order_unit text not null,
 worker_ids uuid[] not null,worker_names text[] not null,note text not null default '' check(char_length(note)<=2000),
 recorded_by uuid not null references public.kream_profiles(user_id),recorded_name text not null,created_at timestamptz not null default clock_timestamp()
);
create index production_logs_date on public.kream_production_logs(production_date,created_at);
alter table public.kream_production_logs enable row level security;
revoke all on public.kream_production_logs from public,anon,authenticated;
grant select on public.kream_production_logs to authenticated;
create policy production_logs_read on public.kream_production_logs for select to authenticated using(kream_private.current_role() in ('owner','factory'));
create function public.kream_production_team() returns table(user_id uuid,display_name text) language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(kream_private.current_role(),'') not in ('owner','factory') then raise exception 'Production team denied' using errcode='42501';end if;
 return query select p.user_id,p.display_name from public.kream_profiles p where p.active and p.role in ('owner','factory') order by p.display_name,p.user_id;
end;$$;
revoke all on function public.kream_production_team() from public,anon;
grant execute on function public.kream_production_team() to authenticated;
create function public.kream_record_production(request_id uuid,record_date date,target_product text,amount numeric,workers uuid[],record_note text) returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.kream_production_logs%rowtype;p public.kream_catalog%rowtype;ids uuid[];names text[];author text;
begin
 if auth.uid() is null or coalesce(kream_private.current_role(),'') not in ('owner','factory') then raise exception 'Production denied' using errcode='42501';end if;
 if request_id is null or record_date is null or record_date>(now() at time zone 'America/Toronto')::date or amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<=0 or amount>100000 or amount<>round(amount,3) or workers is null or cardinality(workers) not between 1 and 30 or exists(select 1 from unnest(workers) w where w is null) or cardinality(workers)<>(select count(distinct w) from unnest(workers) w) or record_note is null or char_length(record_note)>2000 then raise exception 'Invalid production record' using errcode='22023';end if;
 select array_agg(w order by w) into ids from unnest(workers) w;
 perform pg_advisory_xact_lock(hashtextextended('kream-production:'||request_id::text,0));
 select * into prior from public.kream_production_logs where id=request_id;
 if found then
 if prior.recorded_by<>auth.uid() or prior.production_date<>record_date or prior.product_id<>target_product or prior.quantity<>amount or prior.worker_ids<>ids or prior.note<>btrim(record_note) then raise exception 'Production request conflict' using errcode='22023';end if;return request_id;end if;
 select * into p from public.kream_catalog where id=target_product and active and unit_confirmed;
 if not found then raise exception 'Unknown or unconfirmed product' using errcode='22023';end if;
 if exists(select 1 from unnest(ids) w where not exists(select 1 from public.kream_profiles f where f.user_id=w and f.active and f.role in ('owner','factory'))) then raise exception 'Invalid production team' using errcode='22023';end if;
 select array_agg(f.display_name order by f.user_id) into names from public.kream_profiles f where f.user_id=any(ids);
 select display_name into author from public.kream_profiles where user_id=auth.uid();
 insert into public.kream_production_logs(id,production_date,product_id,name_ko,name_en,quantity,order_unit,worker_ids,worker_names,note,recorded_by,recorded_name)
 values(request_id,record_date,p.id,p.name_ko,p.name_en,amount,p.order_unit,ids,names,btrim(record_note),auth.uid(),author);
 return request_id;
end;$$;
revoke all on function public.kream_record_production(uuid,date,text,numeric,uuid[],text) from public,anon;
grant execute on function public.kream_record_production(uuid,date,text,numeric,uuid[],text) to authenticated;
commit;
