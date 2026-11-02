begin;
create table public.kream_dispatches(id uuid primary key,order_id uuid not null references public.kream_orders(id),store_id text not null references public.kream_stores(id),dispatched_by uuid not null references public.kream_profiles(user_id),note text not null default '' check(char_length(note)<=2000),created_at timestamptz not null default now());
create table public.kream_dispatch_items(dispatch_id uuid not null references public.kream_dispatches(id),product_id text not null references public.kream_catalog(id),quantity numeric(12,3) not null check(quantity>0 and quantity<=100000),primary key(dispatch_id,product_id));
create index kream_dispatch_order_idx on public.kream_dispatches(order_id);
alter table public.kream_dispatches enable row level security;
alter table public.kream_dispatch_items enable row level security;
revoke all on public.kream_dispatches,public.kream_dispatch_items from public,anon,authenticated;
grant select on public.kream_dispatches,public.kream_dispatch_items to authenticated;
create policy dispatch_read on public.kream_dispatches for select to authenticated using(kream_private.can_read_store(store_id));
create policy dispatch_items_read on public.kream_dispatch_items for select to authenticated using(exists(select 1 from public.kream_dispatches d where d.id=dispatch_id and kream_private.can_read_store(d.store_id)));
create function public.kream_dispatch_order(target_order uuid,request_id uuid,dispatch_items jsonb,dispatch_note text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare o public.kream_orders%rowtype; existing public.kream_dispatches%rowtype; item jsonb; pid text; qty numeric; ordered numeric; prior numeric; received numeric; seen text[]:=array[]::text[];
begin
 if auth.uid() is null or coalesce(kream_private.current_role(),'') not in ('owner','factory') or request_id is null then raise exception 'Factory access required' using errcode='42501';end if;
 select * into o from public.kream_orders where id=target_order for update;
 if not found then raise exception 'Unknown order' using errcode='22023';end if;
 select * into existing from public.kream_dispatches where id=request_id;
 if found then
  if existing.order_id<>target_order or existing.dispatched_by<>auth.uid() then raise exception 'Dispatch conflict' using errcode='42501';end if;
  if existing.note is distinct from dispatch_note or
   (select jsonb_agg(jsonb_build_object('product_id',di.product_id,'quantity',di.quantity) order by di.product_id) from public.kream_dispatch_items di where di.dispatch_id=request_id) is distinct from
   (select jsonb_agg(jsonb_build_object('product_id',x->>'product_id','quantity',(x->>'quantity')::numeric) order by x->>'product_id') from jsonb_array_elements(dispatch_items) x)
  then raise exception 'Dispatch retry payload changed' using errcode='22023';end if;
  return existing.id;
 end if;
 if o.status in ('cancelled','received','dispatched') then raise exception 'Order not dispatchable' using errcode='40001';end if;
 if dispatch_note is null or char_length(dispatch_note)>2000 or jsonb_typeof(dispatch_items) is distinct from 'array' or jsonb_array_length(dispatch_items) not between 1 and 1000 then raise exception 'Invalid dispatch' using errcode='22023';end if;
 -- Legacy receipts created before dispatch tracking must not be shipped twice.
 if not exists(select 1 from public.kream_dispatches d where d.order_id=o.id) and exists(select 1 from public.kream_receipts r where r.order_id=o.id) then raise exception 'Legacy receipt requires review' using errcode='40001';end if;
 insert into public.kream_dispatches(id,order_id,store_id,dispatched_by,note) values(request_id,o.id,o.store_id,auth.uid(),dispatch_note);
 for item in select value from jsonb_array_elements(dispatch_items) loop
  pid:=item->>'product_id';qty:=(item->>'quantity')::numeric;
  if pid is null or pid=any(seen) or qty is null or qty<=0 or qty>100000 or qty<>round(qty,3) or qty::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid dispatch item' using errcode='22023';end if;
  seen:=array_append(seen,pid);
  select quantity into ordered from public.kream_order_items where order_id=o.id and product_id=pid;
  if not found then raise exception 'Unknown dispatch item' using errcode='22023';end if;
  select coalesce(sum(i.quantity),0) into prior from public.kream_dispatch_items i join public.kream_dispatches d on d.id=i.dispatch_id where d.order_id=o.id and i.product_id=pid;
  if prior+qty>ordered then raise exception 'Dispatch exceeds outstanding' using errcode='40001';end if;
  insert into public.kream_dispatch_items(dispatch_id,product_id,quantity) values(request_id,pid,qty);
 end loop;
 if not exists(select 1 from public.kream_order_items oi where oi.order_id=o.id and oi.quantity>(select coalesce(sum(di.quantity),0) from public.kream_dispatch_items di join public.kream_dispatches d on d.id=di.dispatch_id where d.order_id=o.id and di.product_id=oi.product_id)) then
 update public.kream_orders set status='dispatched' where id=o.id;
 else update public.kream_orders set status='confirmed' where id=o.id;end if;
 return request_id;
end;$$;
revoke all on function public.kream_dispatch_order(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.kream_dispatch_order(uuid,uuid,jsonb,text) to authenticated;
create or replace function public.kream_receive_order(target_order uuid,request_id uuid,received_items jsonb,receipt_note text default '') returns uuid
language plpgsql security definer set search_path='' as $$
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
  -- Same lock namespace as stock count RPC; unknown counts remain unknown.
  perform pg_advisory_xact_lock(hashtextextended(o.store_id||':'||pid,0));
  update public.kream_stock set on_hand=on_hand+qty where store_id=o.store_id and product_id=pid and on_hand is not null;
  n:=n+1;
 end loop;
 if n=0 then raise exception 'Empty receipt' using errcode='22023'; end if;
 if not exists(select 1 from public.kream_order_items oi where oi.order_id=target_order and oi.quantity>(select coalesce(sum(ri.quantity),0) from public.kream_receipt_items ri join public.kream_receipts r on r.id=ri.receipt_id where r.order_id=target_order and ri.product_id=oi.product_id)) then
  update public.kream_orders set status='received' where id=target_order;
 end if;
 return request_id;
end $$;

commit;
