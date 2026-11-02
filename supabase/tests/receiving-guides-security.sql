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
do $$ begin
 begin perform count(*) from public.kream_guides;raise exception 'FAIL anon guides';exception when insufficient_privilege then null;end;
 begin perform public.kream_receive_order(null,null,'[]','');raise exception 'FAIL anon RPC';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ declare receipt_uuid uuid;begin
 receipt_uuid:=public.kream_receive_order('31000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','[{"product_id":"receipt-known","quantity":3}]','partial');
 perform public.kream_receive_order('31000000-0000-4000-8000-000000000001',receipt_uuid,'[{"product_id":"receipt-known","quantity":3}]','retry');
 if(select on_hand from public.kream_stock where store_id='receipt-test' and product_id='receipt-known')<>9 then raise exception 'FAIL duplicate stock increment';end if;
 if(select status from public.kream_orders where id='31000000-0000-4000-8000-000000000001')='received' then raise exception 'FAIL partial marked received';end if;
 begin perform public.kream_receive_order('31000000-0000-4000-8000-000000000002',gen_random_uuid(),'[]','');raise exception 'FAIL other store';exception when insufficient_privilege then null;end;
 begin perform public.kream_receive_order('31000000-0000-4000-8000-000000000001',gen_random_uuid(),'[{"product_id":"receipt-known","quantity":3}]','');raise exception 'FAIL excess receipt';exception when serialization_failure then null;end;
 begin insert into public.kream_guides(kind,title_ko) values('sop','staff forbidden');raise exception 'FAIL employee publishes';exception when insufficient_privilege then null;end;
 perform public.kream_receive_order('31000000-0000-4000-8000-000000000001',gen_random_uuid(),'[{"product_id":"receipt-known","quantity":2},{"product_id":"receipt-unknown","quantity":2}]','complete');
 if(select on_hand from public.kream_stock where store_id='receipt-test' and product_id='receipt-known')<>11 then raise exception 'FAIL stock total';end if;
 if exists(select 1 from public.kream_stock where store_id='receipt-test' and product_id='receipt-unknown' and on_hand is not null) then raise exception 'FAIL unknown stock invented';end if;
 if(select status from public.kream_orders where id='31000000-0000-4000-8000-000000000001')<>'received' then raise exception 'FAIL complete not received';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin
 insert into public.kream_guides(kind,store_id,title_ko,published) values('sop','receipt-test','Published test',true),('manual','receipt-test','Draft test',false);
 begin insert into public.kream_guides(kind,title_ko,published) values('sop','Global forbidden',true);raise exception 'FAIL manager global write';exception when insufficient_privilege then null;end;
 begin insert into public.kream_guides(kind,store_id,title_ko) values('sop','receipt-other','Other forbidden');raise exception 'FAIL manager other-store write';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
 if not exists(select 1 from public.kream_guides where title_ko='Published test') then raise exception 'FAIL employee cannot read published';end if;
 if exists(select 1 from public.kream_guides where title_ko='Draft test') then raise exception 'FAIL employee sees draft';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$ begin
 begin perform public.kream_receive_order('31000000-0000-4000-8000-000000000001',gen_random_uuid(),'[]','');raise exception 'FAIL factory confirms store receipt';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: receiving idempotency, partials, stock, store scope, guide publishing and draft visibility; fixtures rolled back' as verification;
