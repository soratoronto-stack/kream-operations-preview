begin;
do $test$
declare actor uuid; prod public.kream_catalog%rowtype; oid uuid;rid uuid;did uuid; expected jsonb;actual jsonb;kind text;got numeric;before_count bigint;
begin
 select user_id into actor from public.kream_profiles where role='owner' and active order by user_id limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select * into prod from public.kream_catalog where active order by id limit 1;
 foreach kind in array array['missing','null','known'] loop
 oid:=gen_random_uuid();rid:=gen_random_uuid();did:=gen_random_uuid();
 insert into public.kream_orders(id,source_draft_id,source_revision,created_by,store_id,delivery_date,note)
 values(oid,gen_random_uuid(),1,actor,'finch',(now() at time zone 'America/Toronto')::date,'rollback stock test');
 insert into public.kream_order_items(order_id,product_id,name_ko,name_en,order_unit,quantity) values(oid,prod.id,prod.name_ko,prod.name_en,prod.order_unit,4);
 insert into public.kream_dispatches(id,order_id,store_id,dispatched_by) values(did,oid,'finch',actor);
 insert into public.kream_dispatch_items(dispatch_id,product_id,quantity) values(did,prod.id,4);
 if kind='missing' then delete from public.kream_stock where store_id='finch' and product_id=prod.id;
 elsif kind='null' then update public.kream_stock set on_hand=null where store_id='finch' and product_id=prod.id;
 else update public.kream_stock set on_hand=10 where store_id='finch' and product_id=prod.id;end if;
 expected:=jsonb_build_array(jsonb_build_object('product_id',prod.id,'quantity',4));actual:=jsonb_build_array(jsonb_build_object('product_id',prod.id,'quantity',3));
 perform public.kream_receive_with_review(oid,rid,expected,actual,'rollback partial test');
 perform public.kream_receive_with_review(oid,rid,expected,actual,'rollback partial test');
 select on_hand into got from public.kream_stock where store_id='finch' and product_id=prod.id;
 if got is distinct from (case when kind='known' then 13 else 3 end) then raise exception 'Stock mismatch: % = %',kind,got;end if;
 if (select count(*) from public.kream_receipts where id=rid)<>1 then raise exception 'Duplicate receipt';end if;
 if (select quantity from public.kream_dispatch_items where dispatch_id=did and product_id=prod.id)<>4 then raise exception 'Dispatch changed';end if;
 end loop;
end $test$;
rollback;
select 'PASS: absent and null stock start at zero; known stock increments; partial receipts count actual quantities; retry increments once; dispatch unchanged; all test changes rolled back.' as verification;