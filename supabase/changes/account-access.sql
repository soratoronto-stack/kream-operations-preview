alter table public.kream_profiles add column permission_revision bigint not null default 1;
create table public.kream_access_audit (
 id uuid primary key default gen_random_uuid(),
 target_user uuid not null references auth.users(id),
 changed_by uuid not null references auth.users(id),
 changed_at timestamptz not null default now(),
 before_access jsonb not null,
 after_access jsonb not null
);
alter table public.kream_access_audit enable row level security;
revoke all on public.kream_access_audit from public,anon,authenticated;
grant select on public.kream_access_audit to authenticated;
create policy owner_read_access_audit on public.kream_access_audit for select to authenticated using ((select kream_private.current_role())='owner');
create index kream_access_audit_target_time on public.kream_access_audit(target_user,changed_at desc);
create function public.kream_list_accounts() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or kream_private.current_role() is distinct from 'owner' then raise exception 'Owner access required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb) from (
 select u.id as user_id,u.email,coalesce(p.display_name,split_part(u.email,'@',1)) as display_name,
 coalesce(p.role,'employee') as role,coalesce(p.active,false) as active,coalesce(p.general_manager,false) as general_manager,
 coalesce(p.factory_manager,false) as factory_manager,coalesce(p.permission_revision,0) as permission_revision,
 u.created_at,u.email_confirmed_at is not null as email_confirmed,
 coalesce((select jsonb_agg(m.store_id order by m.store_id) from public.kream_memberships m where m.user_id=u.id),'[]'::jsonb) as store_ids,
 (select jsonb_build_object('at',a.changed_at,'by',coalesce(actor.display_name,'Administrator')) from public.kream_access_audit a left join public.kream_profiles actor on actor.user_id=a.changed_by where a.target_user=u.id order by a.changed_at desc limit 1) as last_change
 from auth.users u left join public.kream_profiles p on p.user_id=u.id where u.deleted_at is null
 ) x);
end $$;
create function public.kream_assign_access(target_user uuid,access_kind text,store_keys text[],enabled boolean,expected_revision bigint) returns void language plpgsql security definer set search_path='' as $$
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
 on conflict(user_id) do update set role=excluded.role,active=excluded.active,general_manager=excluded.general_manager,factory_manager=excluded.factory_manager,permission_revision=kream_profiles.permission_revision+1;
 delete from public.kream_memberships where user_id=target_user;
 insert into public.kream_memberships(user_id,store_id) select target_user,k from unnest(selected_stores) k;
 insert into public.kream_access_audit(target_user,changed_by,before_access,after_access)
 values(target_user,auth.uid(),old_access,jsonb_build_object('kind',access_kind,'enabled',enabled,'stores',to_jsonb(selected_stores)));
end $$;
revoke all on function public.kream_list_accounts() from public,anon;
revoke all on function public.kream_assign_access(uuid,text,text[],boolean,bigint) from public,anon;
grant execute on function public.kream_list_accounts() to authenticated;
grant execute on function public.kream_assign_access(uuid,text,text[],boolean,bigint) to authenticated;
