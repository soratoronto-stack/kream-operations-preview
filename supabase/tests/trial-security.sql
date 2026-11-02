-- Run ONLY as postgres in a dedicated Supabase test database after migration.
-- The transaction rolls back every fixture. This file does not test Auth email delivery.
begin;
insert into auth.users(id,email) values
('10000000-0000-4000-8000-000000000001','employee-kream-test@example.invalid'),
('10000000-0000-4000-8000-000000000002','factory-kream-test@example.invalid'),
('10000000-0000-4000-8000-000000000003','unassigned-kream-test@example.invalid'),
('10000000-0000-4000-8000-000000000004','manager-kream-test@example.invalid');
insert into public.kream_profiles(user_id,display_name,role,active) values
('10000000-0000-4000-8000-000000000001','Test employee','employee',true),
('10000000-0000-4000-8000-000000000002','Test factory','factory',true),
('10000000-0000-4000-8000-000000000003','Test unassigned','employee',true),
('10000000-0000-4000-8000-000000000004','Test manager','manager',true);
insert into public.kream_stores(id,name) values ('test-finch','Test Finch'),('test-other','Test Other');
insert into public.kream_memberships(user_id,store_id) values
('10000000-0000-4000-8000-000000000001','test-finch'),
('10000000-0000-4000-8000-000000000004','test-finch');
insert into public.kream_catalog(id,name_ko,name_en,order_unit,unit_confirmed) values
('test-milk','테스트 우유','Test Milk','Bag',true),
('test-unknown','단위 미확인','Unknown unit','Unknown',false);
insert into public.kream_orders(id,source_draft_id,source_revision,created_by,store_id,delivery_date,note)
values ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',1,
'10000000-0000-4000-8000-000000000001','test-other',current_date+2,'Other-store test');

set local role anon;
do $$ begin
  begin perform count(*) from public.kream_catalog; raise exception 'FAIL anon can read catalog';
  exception when insufficient_privilege then null; end;
  begin perform public.kream_submit_order('00000000-0000-4000-8000-000000000000',1); raise exception 'FAIL anon can invoke submit';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ declare d uuid; o uuid; again uuid; v bigint;
begin
  if exists(select 1 from public.kream_orders where store_id='test-other') then raise exception 'FAIL cross-store orders'; end if;
  if kream_private.can_read_store('test-other') then raise exception 'FAIL cross-store helper'; end if;
  begin update public.kream_profiles set role='owner' where user_id=auth.uid(); raise exception 'FAIL self role escalation';
  exception when insufficient_privilege then null; end;
  begin insert into public.kream_memberships values(auth.uid(),'test-other'); raise exception 'FAIL self store escalation';
  exception when insufficient_privilege then null; end;
  begin insert into public.kream_drafts(store_id,delivery_date) values('test-other',current_date+2); raise exception 'FAIL cross-store draft';
  exception when insufficient_privilege then null; end;
  insert into public.kream_drafts(store_id,delivery_date,items)
    values('test-finch',(current_timestamp at time zone 'America/Toronto')::date+1,
    '[{"product_id":"test-milk","quantity":2}]') returning id into d;
  begin perform public.kream_submit_order(d,99); raise exception 'FAIL stale draft revision';
  exception when serialization_failure then null; end;
  o := public.kream_submit_order(d,1);
  again := public.kream_submit_order(d,1);
  if o <> again or (select count(*) from public.kream_orders where source_draft_id=d) <> 1 then raise exception 'FAIL repeated submit'; end if;
  if not exists(select 1 from public.kream_order_items where order_id=o and quantity=2 and order_unit='Bag' and name_en='Test Milk') then
    raise exception 'FAIL snapshot'; end if;
  begin update public.kream_orders set status='received' where id=o; raise exception 'FAIL client can alter order state';
  exception when insufficient_privilege then null; end;
  delete from public.kream_drafts where id=d;
  insert into public.kream_drafts(store_id,delivery_date,items) values('test-finch',current_date+2,
    '[{"product_id":"test-milk","quantity":2},{"product_id":"test-unknown","quantity":1}]') returning id into d;
  begin perform public.kream_submit_order(d,1); raise exception 'FAIL unknown unit accepted';
  exception when invalid_parameter_value then null; end;
  if exists(select 1 from public.kream_orders where source_draft_id=d) then raise exception 'FAIL partial order persisted'; end if;
  update public.kream_drafts set items='[{"product_id":"test-milk","quantity":0}]' where id=d;
  begin perform public.kream_submit_order(d,2); raise exception 'FAIL zero quantity accepted';
  exception when invalid_parameter_value then null; end;
  update public.kream_drafts set items='[{"product_id":"test-milk","quantity":1}]',delivery_date=(current_timestamp at time zone 'America/Toronto')::date where id=d;
  begin perform public.kream_submit_order(d,3); raise exception 'FAIL same-day delivery accepted';
  exception when invalid_parameter_value then null; end;
  v := public.kream_save_stock('test-finch','test-milk',6,6,0);
  if v <> 1 then raise exception 'FAIL initial stock revision'; end if;
  v := public.kream_save_stock('test-finch','test-milk',5,6,1);
  if v <> 2 then raise exception 'FAIL stock revision increment'; end if;
  begin perform public.kream_save_stock('test-finch','test-milk',99,6,1); raise exception 'FAIL stale stock revision';
  exception when serialization_failure then null; end;
  begin perform public.kream_save_stock('test-other','test-milk',1,6,0); raise exception 'FAIL cross-store stock';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin
  if not exists(select 1 from public.kream_orders where store_id='test-other') then raise exception 'FAIL factory needs all orders'; end if;
  if exists(select 1 from public.kream_drafts) then raise exception 'FAIL factory can see private drafts'; end if;
  begin perform public.kream_save_stock('test-finch','test-milk',1,6,2); raise exception 'FAIL factory can count store inventory';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.kream_stores) or exists(select 1 from public.kream_orders) then raise exception 'FAIL unassigned store data'; end if;
  begin insert into public.kream_drafts(store_id,delivery_date) values('test-finch',current_date+2); raise exception 'FAIL unassigned can order';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
set local role authenticated;
do $$ begin
  if not kream_private.can_order_store('test-finch') or kream_private.can_order_store('test-other') then
    raise exception 'FAIL manager must use explicit store memberships'; end if;
end $$;
reset role;
rollback;
