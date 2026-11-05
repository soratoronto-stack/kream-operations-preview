-- User authorized zero opening balances for all stores; preserve any known counts.
lock table public.kream_receipts,public.kream_receipt_items,public.kream_stock in share row exclusive mode;
alter table public.kream_stock alter column on_hand set default 0;
CREATE OR REPLACE FUNCTION public.kream_receive_order(target_order uuid, request_id uuid, received_items jsonb, receipt_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.kream_orders%rowtype; existing public.kream_receipts%rowtype; item jsonb; pid text; qty numeric; ordered numeric; prior numeric; shipped numeric; seen text[]:=array[]::text[]; n integer:=0;
begin
 if auth.uid() is null or request_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into o from public.kream_orders where id=target_order for update;
 if not found or not kream_private.can_order_store(o.store_id) then raise exception 'Store access denied' using errcode='42501'; end if;
 select * into existing from public.kream_receipts where id=request_id;
 if found then
  if existing.order_id<>target_order or existing.received_by<>auth.uid() then raise exception 'Receipt request conflict' using errcode='42501'; end if;
  return existing.id;
 end if;
 if o.status='cancelled' then raise exception 'Cancelled order' using errcode='22023'; end if;
 if receipt_note is null or char_length(receipt_note)>2000 or jsonb_typeof(received_items)<>'array' or jsonb_array_length(received_items)>500 then raise exception 'Invalid receipt' using errcode='22023'; end if;
 insert into public.kream_receipts(id,order_id,store_id,received_by,note) values(request_id,target_order,o.store_id,auth.uid(),receipt_note);
 for item in select value from jsonb_array_elements(received_items) loop
  if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'quantity')<>'number' then raise exception 'Invalid quantity' using errcode='22023'; end if;
  pid:=item->>'product_id';qty:=(item->>'quantity')::numeric;
  if qty is null or not(qty>0 and qty<=100000) or qty<>round(qty,3) or pid=any(seen) then raise exception 'Invalid quantity' using errcode='22023'; end if;
  seen:=array_append(seen,pid);
  select quantity into ordered from public.kream_order_items where order_id=target_order and product_id=pid;
  if not found then raise exception 'Item not in order' using errcode='22023'; end if;
  select coalesce(sum(i.quantity),0) into prior from public.kream_receipt_items i join public.kream_receipts r on r.id=i.receipt_id where r.order_id=target_order and i.product_id=pid;
  if exists(select 1 from public.kream_dispatches d where d.order_id=target_order) then
   select coalesce(sum(di.quantity),0) into shipped from public.kream_dispatch_items di join public.kream_dispatches d on d.id=di.dispatch_id where d.order_id=target_order and di.product_id=pid;
   if prior+qty>shipped then raise exception 'Receipt exceeds dispatched quantity' using errcode='40001';end if;
  end if;
  if prior+qty>ordered then raise exception 'Receipt exceeds outstanding quantity' using errcode='40001'; end if;
  insert into public.kream_receipt_items(receipt_id,product_id,quantity) values(request_id,pid,qty);
  -- Same lock namespace as stock count RPC; missing counts start at zero.
  perform pg_advisory_xact_lock(hashtextextended(o.store_id||':'||pid,0));
  insert into public.kream_stock(store_id,product_id,on_hand,counted_by)
 values(o.store_id,pid,qty,auth.uid())
 on conflict(store_id,product_id) do update
 set on_hand=coalesce(public.kream_stock.on_hand,0)+excluded.on_hand;
  n:=n+1;
 end loop;
 if n=0 then raise exception 'Empty receipt' using errcode='22023'; end if;
 if not exists(select 1 from public.kream_order_items oi where oi.order_id=target_order and oi.quantity>(select coalesce(sum(ri.quantity),0) from public.kream_receipt_items ri join public.kream_receipts r on r.id=ri.receipt_id where r.order_id=target_order and ri.product_id=oi.product_id)) then
  update public.kream_orders set status='received' where id=target_order;
 end if;
 return request_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.kream_receive_with_review(target_order uuid, request_id uuid, expected_items jsonb, actual_items jsonb, receipt_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.kream_orders%rowtype;old public.kream_receiving_reviews%rowtype;expected jsonb;actual jsonb;item jsonb;pid text;qty numeric;positive boolean:=false;diff boolean;author text;
begin
 if auth.uid() is null or request_id is null then raise exception 'Receipt denied' using errcode='42501';end if;
 select * into o from public.kream_orders where id=target_order for update;
 if o.id is null or not coalesce(kream_private.can_order_store(o.store_id),false) then raise exception 'Receipt denied' using errcode='42501';end if;
 select * into old from public.kream_receiving_reviews where id=request_id;
 if found then if old.order_id<>target_order or old.recorded_by<>auth.uid() or old.actual_items<>actual_items or old.expected_items<>expected_items or old.note<>receipt_note then raise exception 'Receipt retry changed' using errcode='22023';end if;return request_id;end if;
 if o.status='cancelled' or receipt_note is null or char_length(receipt_note)>2000 or jsonb_typeof(actual_items) is distinct from 'array' or jsonb_typeof(expected_items) is distinct from 'array' then raise exception 'Invalid receipt' using errcode='22023';end if;
 if o.store_id='midland' and not exists(select 1 from public.kream_dispatches where order_id=o.id) then raise exception 'Dispatch record required for Midland' using errcode='22023';end if;
 with quantities as(select oi.product_id,greatest(0,(case when exists(select 1 from public.kream_dispatches where order_id=o.id) then (select coalesce(sum(di.quantity),0) from public.kream_dispatch_items di join public.kream_dispatches d on d.id=di.dispatch_id where d.order_id=o.id and di.product_id=oi.product_id) else oi.quantity end)-(select coalesce(sum(ri.quantity),0) from public.kream_receipt_items ri join public.kream_receipts r on r.id=ri.receipt_id where r.order_id=o.id and ri.product_id=oi.product_id)) quantity from public.kream_order_items oi where oi.order_id=o.id)
 select coalesce(jsonb_agg(jsonb_build_object('product_id',product_id,'quantity',quantity) order by product_id),'[]') into expected from quantities where quantity>0;
 if expected='[]'::jsonb or expected<>expected_items then raise exception 'Receipt reference changed' using errcode='40001';end if;
 if jsonb_array_length(actual_items)<>jsonb_array_length(expected) then raise exception 'Enter every item, including zero for missing' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(actual_items) loop
 pid:=item->>'product_id';qty:=(item->>'quantity')::numeric;
 if pid is null or not exists(select 1 from jsonb_array_elements(expected) e where e->>'product_id'=pid) or qty is null or qty::text in('NaN','Infinity','-Infinity') or qty<0 or qty>100000 or qty<>round(qty,3) then raise exception 'Invalid actual quantity' using errcode='22023';end if;
 end loop;
 if (select count(distinct x->>'product_id') from jsonb_array_elements(actual_items) x)<>jsonb_array_length(actual_items) then raise exception 'Duplicate item' using errcode='22023';end if;
 select jsonb_agg(jsonb_build_object('product_id',x->>'product_id','quantity',(x->>'quantity')::numeric) order by x->>'product_id') into actual from jsonb_array_elements(actual_items) x;
 diff:=actual<>expected;
 if diff and char_length(trim(receipt_note))=0 then raise exception 'Difference requires reason' using errcode='22023';end if;
 select display_name into author from public.kream_profiles where user_id=auth.uid();
 insert into public.kream_receiving_reviews(id,order_id,store_id,expected_items,actual_items,note,status,recorded_by,recorded_name) values(request_id,o.id,o.store_id,expected_items,actual_items,receipt_note,case when diff then 'open' else 'matched' end,auth.uid(),author);
 if exists(select 1 from jsonb_array_elements(actual) x where (x->>'quantity')::numeric>0) then
 insert into public.kream_receipts(id,order_id,store_id,received_by,note) values(request_id,o.id,o.store_id,auth.uid(),receipt_note);
 for item in select value from jsonb_array_elements(actual) order by value->>'product_id' loop
 pid:=item->>'product_id';qty:=(item->>'quantity')::numeric;
 if qty>0 then
 insert into public.kream_receipt_items values(request_id,pid,qty);
 perform pg_advisory_xact_lock(hashtextextended(o.store_id||':'||pid,0));
 insert into public.kream_stock(store_id,product_id,on_hand,counted_by)
 values(o.store_id,pid,qty,auth.uid())
 on conflict(store_id,product_id) do update
 set on_hand=coalesce(public.kream_stock.on_hand,0)+excluded.on_hand;
 end if;end loop;end if;
 if not exists(select 1 from public.kream_order_items oi where oi.order_id=o.id and oi.quantity>(select coalesce(sum(ri.quantity),0) from public.kream_receipt_items ri join public.kream_receipts r on r.id=ri.receipt_id where r.order_id=o.id and ri.product_id=oi.product_id)) then update public.kream_orders set status='received' where id=o.id;end if;
 return request_id;
end$function$
;
do $opening$ declare actor uuid; begin
 select user_id into actor from public.kream_profiles where role='owner' and active order by user_id limit 1;
 if actor is null then raise exception 'Owner missing';end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into public.kream_stock(store_id,product_id,on_hand,minimum,counted_by)
 select s.id,c.id,coalesce(r.quantity,0),null,actor
 from public.kream_stores s cross join public.kream_catalog c
 left join (select r.store_id,i.product_id,sum(i.quantity) quantity from public.kream_receipts r join public.kream_receipt_items i on i.receipt_id=r.id group by r.store_id,i.product_id) r on r.store_id=s.id and r.product_id=c.id
 where s.active
 on conflict(store_id,product_id) do update set on_hand=excluded.on_hand
 where public.kream_stock.on_hand is null;
 end $opening$;
