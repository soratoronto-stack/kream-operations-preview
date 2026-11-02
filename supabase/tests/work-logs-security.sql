begin;
insert into auth.users(id,email) values
('60000000-0000-4000-8000-000000000001','work-employee@example.invalid'),
('60000000-0000-4000-8000-000000000002','work-manager@example.invalid'),
('60000000-0000-4000-8000-000000000003','work-factory@example.invalid'),
('60000000-0000-4000-8000-000000000004','work-owner@example.invalid');
insert into public.kream_profiles(user_id,display_name,role,active) values
('60000000-0000-4000-8000-000000000001','Work employee','employee',true),
('60000000-0000-4000-8000-000000000002','Work manager','manager',true),
('60000000-0000-4000-8000-000000000003','Work factory','factory',true),
('60000000-0000-4000-8000-000000000004','Work owner','owner',true);
insert into public.kream_stores(id,name) values('work-test','Work test'),('work-other','Other');
insert into public.kream_memberships(user_id,store_id) values('60000000-0000-4000-8000-000000000001','work-test'),('60000000-0000-4000-8000-000000000002','work-test');
insert into public.kream_catalog(id,name_ko,name_en,order_unit,unit_confirmed) values('work-product','생산 시험','Work product','EA',true);
set local role anon;
do $$ begin
 begin perform count(*) from public.kream_checklist_events;raise exception 'FAIL anonymous read';exception when insufficient_privilege then null;end;
 begin perform public.kream_check_item(gen_random_uuid(),gen_random_uuid(),true,null);raise exception 'FAIL anonymous RPC';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','60000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin
 if public.kream_save_order_layout('work-test',array['Dessert'],array['group'],array['work-product'],0)<>1 then raise exception 'FAIL layout save';end if;
 begin perform public.kream_save_order_layout('work-test','{}','{}','{}',0);raise exception 'FAIL stale layout';exception when serialization_failure then null;end;
 begin perform public.kream_save_order_layout('work-other','{}','{}','{}',0);raise exception 'FAIL other layout';exception when insufficient_privilege then null;end;
 perform public.kream_save_checklist_item('61000000-0000-4000-8000-000000000001','work-test','opening','문 열기','Open',true,0,0);
 perform public.kream_save_checklist_item('61000000-0000-4000-8000-000000000001','work-test','opening','문 열기','Open',true,0,0);
 begin perform public.kream_save_checklist_item('61000000-0000-4000-8000-000000000002','work-other','opening','x','',true,0,0);raise exception 'FAIL other template';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','60000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
 if(select category_order[1] from public.kream_order_layout where store_id='work-test')<>'Dessert' then raise exception 'FAIL employee layout read';end if;
 begin perform public.kream_save_order_layout('work-test','{}','{}','{}',1);raise exception 'FAIL employee layout edit';exception when insufficient_privilege then null;end;
 begin perform public.kream_save_checklist_item(gen_random_uuid(),'work-test','opening','x','',true,0,0);raise exception 'FAIL employee template edit';exception when insufficient_privilege then null;end;
 perform public.kream_set_display_name('My chosen name');
 perform public.kream_check_item('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',true,null);
 perform public.kream_check_item('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',true,null);
 if(select count(*) from public.kream_checklist_events where item_id='61000000-0000-4000-8000-000000000001')<>1 then raise exception 'FAIL retry duplicate';end if;
 if not exists(select 1 from public.kream_checklist_events where id='62000000-0000-4000-8000-000000000001' and recorded_name='My chosen name' and check_date=(now() at time zone 'America/Toronto')::date and created_at>=transaction_timestamp()) then raise exception 'FAIL author/time';end if;
 begin perform public.kream_check_item(gen_random_uuid(),'61000000-0000-4000-8000-000000000001',false,null);raise exception 'FAIL stale check';exception when serialization_failure then null;end;
 perform public.kream_check_item('62000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001',false,'62000000-0000-4000-8000-000000000001');
 perform public.kream_set_display_name('Changed later');
 if not exists(select 1 from public.kream_checklist_events where id='62000000-0000-4000-8000-000000000001' and recorded_name='My chosen name') then raise exception 'FAIL historical name changed';end if;
 if(select role from public.kream_profiles where user_id=auth.uid())<>'employee' then raise exception 'FAIL name changes role';end if;
 begin update public.kream_checklist_events set is_checked=true;raise exception 'FAIL overwrite event';exception when insufficient_privilege then null;end;
 begin perform public.kream_record_production(gen_random_uuid(),current_date,'work-product',2,array[auth.uid()],'');raise exception 'FAIL store production';exception when insufficient_privilege then null;end;
 begin perform public.kream_production_team();raise exception 'FAIL store roster';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','60000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select public.kream_save_checklist_item('61000000-0000-4000-8000-000000000002','work-other','closing','Close','',true,0,0);
reset role;
select set_config('request.jwt.claim.sub','60000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.kream_checklist_items where store_id='work-other') then raise exception 'FAIL other store read';end if;
 begin perform public.kream_check_item(gen_random_uuid(),'61000000-0000-4000-8000-000000000002',true,null);raise exception 'FAIL other store check';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','60000000-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$ begin
 perform public.kream_record_production('63000000-0000-4000-8000-000000000001',(now() at time zone 'America/Toronto')::date,'work-product',2,array[auth.uid(),'60000000-0000-4000-8000-000000000004'::uuid],'Together');
 perform public.kream_record_production('63000000-0000-4000-8000-000000000001',(now() at time zone 'America/Toronto')::date,'work-product',2,array['60000000-0000-4000-8000-000000000004'::uuid,auth.uid()],'Together');
 if(select count(*) from public.kream_production_logs where id='63000000-0000-4000-8000-000000000001')<>1 then raise exception 'FAIL production retry';end if;
 if not exists(select 1 from public.kream_production_logs where id='63000000-0000-4000-8000-000000000001' and cardinality(worker_names)=2 and recorded_name='Work factory' and order_unit='EA') then raise exception 'FAIL production authors';end if;
 begin perform public.kream_record_production(gen_random_uuid(),current_date+2,'work-product',2,array[auth.uid()],'');raise exception 'FAIL future production';exception when invalid_parameter_value then null;end;
 begin perform public.kream_record_production(gen_random_uuid(),(now() at time zone 'America/Toronto')::date,'work-product',2,array['60000000-0000-4000-8000-000000000001'::uuid],'');raise exception 'FAIL invalid crew';exception when invalid_parameter_value then null;end;
 begin perform public.kream_record_production('63000000-0000-4000-8000-000000000001',(now() at time zone 'America/Toronto')::date,'work-product',3,array[auth.uid()],'');raise exception 'FAIL changed production retry';exception when invalid_parameter_value then null;end;
 begin update public.kream_production_logs set quantity=100;raise exception 'FAIL production overwrite';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.kream_profiles set active=false where user_id='60000000-0000-4000-8000-000000000003';
set local role authenticated;
do $$ begin
 begin perform public.kream_record_production(gen_random_uuid(),current_date,'work-product',2,array[auth.uid()],'');raise exception 'FAIL inactive production';exception when insufficient_privilege then null;end;
 if exists(select 1 from public.kream_production_logs) then raise exception 'FAIL inactive read';end if;
end $$;
reset role;
rollback;
select 'PASS: manager layout, store scope, checklist history/time/names, retries, production crew and permissions; fixtures rolled back' as verification;
