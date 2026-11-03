begin;
insert into auth.users(id,email) values('90000000-0000-4000-8000-000000000099','general-manager-rollback@example.invalid');
insert into public.kream_profiles(user_id,display_name,role,general_manager,active) values('90000000-0000-4000-8000-000000000099','Rollback-only test','manager',true,true);
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000099',true);
set local role authenticated;
do $test$
declare s record; cnt int; expected int;
begin
select count(*) into expected from public.kream_stores where active;
if expected<>6 then raise exception 'Expected six accessible stores, got %',expected;end if;
for s in select id from public.kream_stores where active loop
 if not kream_private.can_manage_store(s.id) then raise exception 'Cannot manage %',s.id;end if;
 perform public.kream_save_checklist_item(gen_random_uuid(),s.id,'opening','권한 검증 · 롤백','Permission test',true,9999,0);
 perform public.kream_save_stock(s.id,'milk',null,null,0);
end loop;
select count(*) into cnt from public.kream_delivery_prices;
if cnt<>0 or kream_private.can_read_midland_money() then raise exception 'Wholesale prices exposed';end if;
select count(*) into cnt from public.kream_statements;
if cnt<>0 then raise exception 'Statements exposed';end if;
begin perform public.kream_midland_report('2026-11-01'); raise exception 'Financial report allowed'; exception when insufficient_privilege then null;end;
begin update public.kream_profiles set general_manager=false where user_id=auth.uid(); raise exception 'Can change own permissions'; exception when insufficient_privilege then null;end;
end $test$;
reset role;
rollback;
