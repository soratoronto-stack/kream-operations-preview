begin;
insert into auth.users(id,email) values
('30000000-0000-4000-8000-000000000001','receipt-employee@example.invalid'),
('30000000-0000-4000-8000-000000000002','receipt-manager@example.invalid'),
('30000000-0000-4000-8000-000000000003','receipt-factory@example.invalid');
insert into public.kream_profiles(user_id,display_name,role,active) values
('30000000-0000-4000-8000-000000000001','Test employee','employee',true),
('30000000-0000-4000-8000-000000000002','Test manager','manager',true),
('30000000-0000-4000-8000-000000000003','Test factory','factory',true);
insert into public.kream_stores(id,name) values('receipt-test','Receipt test'),('receipt-other','Other test');
insert into public.kream_memberships(user_id,store_id) values
('30000000-0000-4000-8000-000000000001','receipt-test'),('30000000-0000-4000-8000-000000000002','receipt-test');
insert into public.kream_catalog(id,name_ko,name_en,order_unit,unit_confirmed) values('receipt-known','테스트','Test','EA',true),('receipt-unknown','미확인','Unknown','EA',true);
insert into public.kream_orders(id,source_draft_id,source_revision,created_by,store_id,delivery_date,note) values
('31000000-0000-4000-8000-000000000001',gen_random_uuid(),1,'30000000-0000-4000-8000-000000000001','receipt-test',current_date,'test'),
('31000000-0000-4000-8000-000000000002',gen_random_uuid(),1,'30000000-0000-4000-8000-000000000001','receipt-other',current_date,'test');
insert into public.kream_order_items(order_id,product_id,name_ko,name_en,order_unit,quantity) values
('31000000-0000-4000-8000-000000000001','receipt-known','테스트','Test','EA',5),
('31000000-0000-4000-8000-000000000001','receipt-unknown','미확인','Unknown','EA',2);
insert into public.kream_stock(store_id,product_id,on_hand,minimum,counted_by) values('receipt-test','receipt-known',6,6,'30000000-0000-4000-8000-000000000001');
set local role anon;
do $$ begin begin perform count(*) from public.kream_dispatches;raise exception 'FAIL anon';exception when insufficient_privilege then null;end;end $$;
reset role;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$ begin
 perform public.kream_dispatch_order('31000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','[{"product_id":"receipt-known","quantity":3}]','partial');
 perform public.kream_dispatch_order('31000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','[{"product_id":"receipt-known","quantity":3}]','partial');
 begin perform public.kream_dispatch_order('31000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','[{"product_id":"receipt-known","quantity":2}]','partial');raise exception 'FAIL changed retry';exception when invalid_parameter_value then null;end;
 if not exists(select 1 from public.kream_dispatches where id='33000000-0000-4000-8000-000000000001' and recorded_name='Test factory') then raise exception 'FAIL dispatch author snapshot';end if;
 if(select count(*) from public.kream_dispatches where id='33000000-0000-4000-8000-000000000001')<>1 then raise exception 'FAIL retry';end if;
 if(select status from public.kream_orders where id='31000000-0000-4000-8000-000000000001')<>'confirmed' then raise exception 'FAIL partial';end if;
 begin perform public.kream_dispatch_order('31000000-0000-4000-8000-000000000001',gen_random_uuid(),'[{"product_id":"receipt-known","quantity":3}]','');raise exception 'FAIL over';exception when serialization_failure then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
 begin perform public.kream_dispatch_order('31000000-0000-4000-8000-000000000001',gen_random_uuid(),'[{"product_id":"receipt-known","quantity":1}]','');raise exception 'FAIL employee dispatch';exception when insufficient_privilege then null;end;
 begin perform public.kream_receive_order('31000000-0000-4000-8000-000000000001',gen_random_uuid(),'[{"product_id":"receipt-known","quantity":4}]','');raise exception 'FAIL receive unsent';exception when serialization_failure then null;end;
 perform public.kream_receive_order('31000000-0000-4000-8000-000000000001',gen_random_uuid(),'[{"product_id":"receipt-known","quantity":3}]','');
 if not exists(select 1 from public.kream_receipts where order_id='31000000-0000-4000-8000-000000000001' and recorded_name='Test employee') then raise exception 'FAIL receipt author snapshot';end if;
 if(select on_hand from public.kream_stock where store_id='receipt-test' and product_id='receipt-known')<>9 then raise exception 'FAIL received stock';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$ begin
 perform public.kream_dispatch_order('31000000-0000-4000-8000-000000000001',gen_random_uuid(),'[{"product_id":"receipt-known","quantity":2},{"product_id":"receipt-unknown","quantity":2}]','');
 if(select status from public.kream_orders where id='31000000-0000-4000-8000-000000000001')<>'dispatched' then raise exception 'FAIL full';end if;
end $$;
reset role;
update public.kream_profiles set active=false where user_id='30000000-0000-4000-8000-000000000003';
set local role authenticated;
do $$ begin begin perform public.kream_dispatch_order('31000000-0000-4000-8000-000000000002',gen_random_uuid(),'[]','');raise exception 'FAIL inactive factory';exception when insufficient_privilege then null;end;end $$;
reset role;
rollback;
select 'PASS: dispatch permissions, partial/full, retry, over-dispatch, receipt caps and stock; fixtures rolled back' as verification;
