alter table public.kream_profiles add column access_blocked boolean not null default false;
create table public.kream_access_requests(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 location_key text not null, status text not null default 'pending' check(status in ('pending','approved','rejected','revoked')),
 requested_at timestamptz not null default now(), reviewed_by uuid references auth.users(id),reviewed_at timestamptz
);
create unique index kream_pending_access_unique on public.kream_access_requests(user_id,location_key) where status='pending';
alter table public.kream_access_requests enable row level security;
revoke all on public.kream_access_requests from public,anon,authenticated;
create function public.kream_signup_locations() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]'::jsonb) from public.kream_stores where active
$$;
revoke all on function public.kream_signup_locations() from public;
grant execute on function public.kream_signup_locations() to anon,authenticated;
create function kream_private.capture_signup_locations() returns trigger language plpgsql security definer set search_path='' as $$
declare k text;
begin
 insert into public.kream_profiles(user_id,display_name,role,active) values(new.id,left(coalesce(nullif(new.raw_user_meta_data->>'display_name',''),split_part(new.email,'@',1),'Staff'),120),'employee',false) on conflict do nothing;
 if jsonb_typeof(new.raw_user_meta_data->'workplaces')='array' then
 if jsonb_array_length(new.raw_user_meta_data->'workplaces') between 1 and 20 then
 for k in select distinct jsonb_array_elements_text(new.raw_user_meta_data->'workplaces') loop
 if k='factory' or exists(select 1 from public.kream_stores where id=k and active) then
 insert into public.kream_access_requests(user_id,location_key) values(new.id,k) on conflict do nothing;
 end if;end loop;end if;end if;
 return new;
end $$;
revoke all on function kream_private.capture_signup_locations() from public,anon,authenticated;
create trigger kream_signup_requests after insert on auth.users for each row execute function kream_private.capture_signup_locations();
create function public.kream_my_workplaces() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 return jsonb_build_object('blocked',coalesce((select access_blocked from public.kream_profiles where user_id=auth.uid()),false),'memberships',coalesce((select jsonb_agg(store_id) from public.kream_memberships where user_id=auth.uid()),'[]'::jsonb),'requests',coalesce((select jsonb_agg(to_jsonb(r) order by requested_at desc) from public.kream_access_requests r where user_id=auth.uid()),'[]'::jsonb));
end $$;
create function public.kream_request_workplaces(locations text[]) returns void language plpgsql security definer set search_path='' as $$
declare k text;
begin
 if auth.uid() is null or exists(select 1 from public.kream_profiles where user_id=auth.uid() and access_blocked) then raise exception 'Access blocked' using errcode='42501';end if;
 if cardinality(locations) is null or cardinality(locations)<1 or cardinality(locations)>20 then raise exception 'Select workplaces' using errcode='22023';end if;
 insert into public.kream_profiles(user_id,display_name,role,active) select id,left(coalesce(split_part(email,'@',1),'Staff'),120),'employee',false from auth.users where id=auth.uid() on conflict do nothing;
 for k in select distinct unnest(locations) loop
 if k is null or (k<>'factory' and not exists(select 1 from public.kream_stores where id=k and active)) then raise exception 'Invalid workplace' using errcode='22023';end if;
 if not exists(select 1 from public.kream_memberships where user_id=auth.uid() and store_id=k) then
 insert into public.kream_access_requests(user_id,location_key) values(auth.uid(),k) on conflict do nothing;
 end if;end loop;
end $$;
create function public.kream_review_workplace(request_key uuid,approve boolean) returns void language plpgsql security definer set search_path='' as $$
declare r public.kream_access_requests; p public.kream_profiles; actor_role text=kream_private.current_role();before_json jsonb;
begin
 if auth.uid() is null or actor_role not in ('owner','manager') or actor_role is null then raise exception 'Manager required' using errcode='42501';end if;
 select * into r from public.kream_access_requests where id=request_key for update;
 if not found or r.status<>'pending' or approve is null then raise exception 'Request changed' using errcode='40001';end if;
 select * into p from public.kream_profiles where user_id=r.user_id for update;
 if r.user_id=auth.uid() or p.access_blocked or p.role='owner' then raise exception 'Protected account' using errcode='42501';end if;
 if actor_role<>'owner' and (r.location_key='factory' or p.role<>'employee' or not kream_private.can_manage_store(r.location_key)) then raise exception 'Outside managed stores' using errcode='42501';end if;
 if approve and not exists(select 1 from auth.users where id=r.user_id and email_confirmed_at is not null) then raise exception 'Email verification required' using errcode='22023';end if;
 if approve and r.location_key<>'factory' and not exists(select 1 from public.kream_stores where id=r.location_key and active) then raise exception 'Inactive store' using errcode='22023';end if;
 before_json=to_jsonb(p);
 if approve then
 if r.location_key='factory' then
 if exists(select 1 from public.kream_memberships where user_id=r.user_id) then raise exception 'Use owner role editor for mixed factory access' using errcode='22023';end if;
 update public.kream_profiles set role='factory',active=true,permission_revision=permission_revision+1 where user_id=r.user_id;
 else
 if p.role not in ('employee','manager','midland_owner') or (p.role='midland_owner' and r.location_key<>'midland') then raise exception 'Role does not allow store assignment' using errcode='22023';end if;
 insert into public.kream_memberships(user_id,store_id) values(r.user_id,r.location_key) on conflict do nothing;
 update public.kream_profiles set active=true,permission_revision=permission_revision+1 where user_id=r.user_id;
 end if;end if;
 update public.kream_access_requests set status=case when approve then 'approved' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now() where id=r.id;
 insert into public.kream_access_audit(target_user,changed_by,before_access,after_access) values(r.user_id,auth.uid(),before_json,jsonb_build_object('action',case when approve then 'approve_workplace' else 'reject_workplace' end,'location',r.location_key));
end $$;
create function public.kream_block_access(target_user uuid,expected_revision bigint) returns void language plpgsql security definer set search_path='' as $$
declare p public.kream_profiles; actor public.kream_profiles; before_json jsonb; affected text[];
begin
 select * into actor from public.kream_profiles where user_id=auth.uid() and active;
 if actor.user_id is null or actor.role not in ('owner','manager') then raise exception 'Manager required' using errcode='42501';end if;
 select * into p from public.kream_profiles where user_id=target_user for update;
 if p.user_id is null or p.role='owner' or p.user_id=auth.uid() or (actor.role<>'owner' and (p.role not in ('employee','manager') or p.general_manager or (not actor.general_manager and p.role<>'employee'))) then raise exception 'Protected account' using errcode='42501';end if;
 if expected_revision is null or p.permission_revision<>expected_revision then raise exception 'ACCESS_CONFLICT' using errcode='40001';end if;
 before_json=to_jsonb(p);
 if actor.role='owner' or actor.general_manager then
 update public.kream_profiles set active=false,access_blocked=true,permission_revision=permission_revision+1 where user_id=target_user;
 update public.kream_access_requests set status='revoked',reviewed_by=auth.uid(),reviewed_at=now() where user_id=target_user and status='pending';
 else
 select coalesce(array_agg(id),array[]::text[]) into affected from public.kream_stores where kream_private.can_manage_store(id);
 if not exists(select 1 from public.kream_memberships where user_id=target_user and store_id=any(affected)) and not exists(select 1 from public.kream_access_requests where user_id=target_user and status='pending' and location_key=any(affected)) then raise exception 'Outside managed stores' using errcode='42501';end if;
 delete from public.kream_memberships where user_id=target_user and store_id=any(affected);
 update public.kream_access_requests set status='revoked',reviewed_by=auth.uid(),reviewed_at=now() where user_id=target_user and location_key=any(affected) and status in ('pending','approved');
 update public.kream_profiles set active=exists(select 1 from public.kream_memberships where user_id=target_user),permission_revision=permission_revision+1 where user_id=target_user;
 end if;
 insert into public.kream_access_audit(target_user,changed_by,before_access,after_access) values(target_user,auth.uid(),before_json,jsonb_build_object('action','block_access','global',actor.role='owner' or actor.general_manager,'stores',to_jsonb(affected)));
end $$;
create or replace function public.kream_list_accounts() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(kream_private.current_role(),'') not in ('owner','manager') then raise exception 'Owner access required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb) from (
 select u.id as user_id,u.email,coalesce(p.display_name,split_part(u.email,'@',1)) as display_name,
 coalesce(p.role,'employee') as role,coalesce(p.active,false) as active,coalesce(p.general_manager,false) as general_manager,
 coalesce(p.factory_manager,false) as factory_manager,coalesce(p.permission_revision,0) as permission_revision,
 coalesce(p.access_blocked,false) as access_blocked,
 coalesce((select jsonb_agg(to_jsonb(r)) from public.kream_access_requests r where r.user_id=u.id and (kream_private.current_role()='owner' or (r.location_key<>'factory' and kream_private.can_manage_store(r.location_key)))),'[]'::jsonb) as requests,
 u.created_at,u.email_confirmed_at is not null as email_confirmed,
 coalesce((select jsonb_agg(m.store_id order by m.store_id) from public.kream_memberships m where m.user_id=u.id and (kream_private.current_role()='owner' or kream_private.can_manage_store(m.store_id))),'[]'::jsonb) as store_ids,
 (select jsonb_build_object('at',a.changed_at,'by',coalesce(actor.display_name,'Administrator')) from public.kream_access_audit a left join public.kream_profiles actor on actor.user_id=a.changed_by where a.target_user=u.id order by a.changed_at desc limit 1) as last_change
 from auth.users u left join public.kream_profiles p on p.user_id=u.id where u.deleted_at is null and (kream_private.current_role()='owner' or (coalesce(p.role,'employee')='employee' and (exists(select 1 from public.kream_memberships m where m.user_id=u.id and kream_private.can_manage_store(m.store_id)) or exists(select 1 from public.kream_access_requests r where r.user_id=u.id and r.location_key<>'factory' and kream_private.can_manage_store(r.location_key)))) or (exists(select 1 from public.kream_profiles me where me.user_id=auth.uid() and me.general_manager) and p.role='manager' and not p.general_manager))
 ) x);
end $$;
create or replace function public.kream_assign_access(target_user uuid,access_kind text,store_keys text[],enabled boolean,expected_revision bigint) returns void language plpgsql security definer set search_path='' as $$
declare old_profile public.kream_profiles; old_access jsonb; email_name text; selected_stores text[]; new_role text;
begin
 if auth.uid() is null or kream_private.current_role() is distinct from 'owner' then raise exception 'Owner access required' using errcode='42501';end if;
 if access_kind is null or access_kind not in ('employee','manager','general_manager','factory_staff','factory_manager','midland_owner') or enabled is null then raise exception 'Invalid access kind' using errcode='22023';end if;
 select split_part(u.email,'@',1) into email_name from auth.users u where u.id=target_user and u.deleted_at is null for update;
 if not found then raise exception 'Account not found' using errcode='22023';end if;
 select * into old_profile from public.kream_profiles where user_id=target_user for update;
 if old_profile.role='owner' then raise exception 'Owner account is protected' using errcode='42501';end if;
 if expected_revision is null or coalesce(old_profile.permission_revision,0)<>expected_revision then raise exception 'ACCESS_CONFLICT' using errcode='40001';end if;
 old_access=jsonb_build_object('profile',to_jsonb(old_profile),'stores',coalesce((select jsonb_agg(store_id order by store_id) from public.kream_memberships where user_id=target_user),'[]'::jsonb));
 select coalesce(array_agg(distinct k order by k),array[]::text[]) into selected_stores from unnest(coalesce(store_keys,array[]::text[])) k;
 if access_kind='midland_owner' then selected_stores=array['midland'];
 elsif access_kind in ('factory_staff','factory_manager','general_manager') then selected_stores=array[]::text[];end if;
 if exists(select 1 from unnest(selected_stores) k where k is null or not exists(select 1 from public.kream_stores s where s.id=k and s.active)) or (enabled and access_kind in ('employee','manager') and cardinality(selected_stores)=0) then raise exception 'Select active stores' using errcode='22023';end if;
 new_role=case when access_kind='general_manager' then 'manager' when access_kind in ('factory_staff','factory_manager') then 'factory' else access_kind end;
 insert into public.kream_profiles(user_id,display_name,role,active,general_manager,factory_manager,permission_revision)
 values(target_user,coalesce(nullif(email_name,''),'Staff'),new_role,enabled,access_kind='general_manager',access_kind='factory_manager',1)
 on conflict(user_id) do update set role=excluded.role,active=excluded.active,access_blocked=case when excluded.active then false else kream_profiles.access_blocked end,general_manager=excluded.general_manager,factory_manager=excluded.factory_manager,permission_revision=kream_profiles.permission_revision+1;
 delete from public.kream_memberships where user_id=target_user;
 insert into public.kream_memberships(user_id,store_id) select target_user,k from unnest(selected_stores) k;
 insert into public.kream_access_audit(target_user,changed_by,before_access,after_access)
 values(target_user,auth.uid(),old_access,jsonb_build_object('kind',access_kind,'enabled',enabled,'stores',to_jsonb(selected_stores)));
end $$;
revoke all on function public.kream_my_workplaces() from public,anon;
grant execute on function public.kream_my_workplaces() to authenticated;
revoke all on function public.kream_request_workplaces(text[]) from public,anon;
grant execute on function public.kream_request_workplaces(text[]) to authenticated;
revoke all on function public.kream_review_workplace(uuid,boolean) from public,anon;
grant execute on function public.kream_review_workplace(uuid,boolean) to authenticated;
revoke all on function public.kream_block_access(uuid,bigint) from public,anon;
grant execute on function public.kream_block_access(uuid,bigint) to authenticated;
