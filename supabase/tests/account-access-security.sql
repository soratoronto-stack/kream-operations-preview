begin;
insert into auth.users(id,email) values
 ('90000000-0000-4000-8000-000000000091','owner-rollback@example.invalid'),
 ('90000000-0000-4000-8000-000000000092','pending-rollback@example.invalid');
insert into public.kream_profiles(user_id,display_name,role,active) values('90000000-0000-4000-8000-000000000091','Rollback owner','owner',true);
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000091',true);
set local role authenticated;
do $test$
declare target uuid='90000000-0000-4000-8000-000000000092';n int;
begin
 if not exists(select 1 from jsonb_array_elements(public.kream_list_accounts()) a where a->>'user_id'=target::text and (a->>'permission_revision')::bigint=0) then raise exception 'Pending user missing';end if;
 perform public.kream_assign_access(target,'employee',array['finch'],true,0);
 if not exists(select 1 from public.kream_profiles where user_id=target and role='employee' and active and permission_revision=1) then raise exception 'Assignment failed';end if;
 begin perform public.kream_assign_access(target,'manager',array['midland'],true,0);raise exception 'Stale assignment allowed';exception when serialization_failure then null;end;
 begin perform public.kream_assign_access(target,'manager',array['invalid-store'],true,1);raise exception 'Invalid store allowed';exception when invalid_parameter_value then null;end;
 begin perform public.kream_assign_access(target,'owner',array[]::text[],true,1);raise exception 'Owner promotion allowed';exception when invalid_parameter_value then null;end;
 begin perform public.kream_assign_access(auth.uid(),'employee',array['finch'],false,1);raise exception 'Owner demotion allowed';exception when insufficient_privilege then null;end;
 perform public.kream_assign_access(target,'general_manager',array[]::text[],true,1);
 if exists(select 1 from public.kream_memberships where user_id=target) then raise exception 'Stale memberships retained';end if;
 select count(*) into n from public.kream_access_audit where target_user=target;
 if n<>2 then raise exception 'Audit count wrong %',n;end if;
end $test$;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000092',true);
do $test$
begin
 if not kream_private.can_manage_store('finch') or not kream_private.can_manage_store('midland') then raise exception 'General access missing';end if;
 if kream_private.can_read_midland_money() then raise exception 'General financial access';end if;
 begin perform public.kream_list_accounts();raise exception 'Non-owner listed users';exception when insufficient_privilege then null;end;
 begin perform public.kream_assign_access(auth.uid(),'manager',array['finch'],true,2);raise exception 'Non-owner assigned permissions';exception when insufficient_privilege then null;end;
 if exists(select 1 from public.kream_access_audit) then raise exception 'Audit leaked';end if;
end $test$;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000091',true);
select public.kream_assign_access('90000000-0000-4000-8000-000000000092','factory_manager',array[]::text[],true,2);
select public.kream_assign_access('90000000-0000-4000-8000-000000000092','midland_owner',array[]::text[],true,3);
select public.kream_assign_access('90000000-0000-4000-8000-000000000092','employee',array[]::text[],false,4);
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000092',true);
do $test$
begin
 if kream_private.current_role() is not null or kream_private.can_order_store('midland') then raise exception 'Disabled access retained';end if;
end $test$;
reset role;
select 'account access tests passed; all synthetic records rolled back' as result;
rollback;
