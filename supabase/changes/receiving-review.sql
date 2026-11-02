begin;
create table public.kream_receiving_reviews(id uuid primary key,order_id uuid not null references public.kream_orders(id),store_id text not null references public.kream_stores(id),expected_items jsonb not null,actual_items jsonb not null,note text not null default '',status text not null check(status in('matched','open','resolved')),recorded_by uuid not null references public.kream_profiles(user_id),recorded_name text not null,created_at timestamptz not null default now(),resolution text,resolution_note text,resolved_by uuid references public.kream_profiles(user_id),resolved_at timestamptz,adjustment_id uuid references public.kream_statement_adjustments(id));
alter table public.kream_receiving_reviews enable row level security;
revoke all on public.kream_receiving_reviews from public,anon,authenticated;
grant select on public.kream_receiving_reviews to authenticated;
create policy receipt_review_read on public.kream_receiving_reviews for select to authenticated using(kream_private.can_read_store(store_id));
create or replace function public.kream_receive_with_review(target_order uuid,request_id uuid,expected_items jsonb,actual_items jsonb,receipt_note text) returns uuid language plpgsql security definer set search_path='' as $$
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
 update public.kream_stock set on_hand=on_hand+qty where store_id=o.store_id and product_id=pid and on_hand is not null;
 end if;end loop;end if;
 if not exists(select 1 from public.kream_order_items oi where oi.order_id=o.id and oi.quantity>(select coalesce(sum(ri.quantity),0) from public.kream_receipt_items ri join public.kream_receipts r on r.id=ri.receipt_id where r.order_id=o.id and ri.product_id=oi.product_id)) then update public.kream_orders set status='received' where id=o.id;end if;
 return request_id;
end$$;
create or replace function public.kream_resolve_receiving_review(review_id uuid,decision text,reason_text text,credit_amount numeric default 0,credit_period date default null) returns void language plpgsql security definer set search_path='' as $$declare old public.kream_receiving_reviews%rowtype;aid uuid;begin
 if auth.uid() is null or kream_private.current_role() is distinct from 'owner' then raise exception 'Owner review required' using errcode='42501';end if;
 if decision is null or reason_text is null or decision not in('credit','resend','no_credit') or char_length(trim(reason_text)) not between 1 and 500 or credit_amount is null or credit_amount::text in('NaN','Infinity','-Infinity') or credit_amount<0 or credit_amount>100000000 or credit_amount<>round(credit_amount,2) then raise exception 'Invalid review' using errcode='22023';end if;
 select * into old from public.kream_receiving_reviews where id=review_id for update;
 if old.id is null then raise exception 'Unknown review' using errcode='22023';end if;
 if old.status='resolved' then if old.resolution<>decision or old.resolution_note<>trim(reason_text) then raise exception 'Review already resolved' using errcode='40001';end if;return;end if;
 if old.status<>'open' then raise exception 'Not an open difference' using errcode='22023';end if;
 if decision='credit' then
 if old.store_id<>'midland' or credit_amount<=0 or credit_period is null then raise exception 'Credit details required' using errcode='22023';end if;
 aid:=gen_random_uuid();perform public.kream_add_statement_adjustment(aid,credit_period,-credit_amount,'입고 차이 승인 '||review_id::text||' · '||trim(reason_text));
 elsif credit_amount<>0 then raise exception 'Credit only for approved credits' using errcode='22023';end if;
 update public.kream_receiving_reviews set status='resolved',resolution=decision,resolution_note=trim(reason_text),resolved_by=auth.uid(),resolved_at=clock_timestamp(),adjustment_id=aid where id=review_id;
end$$;
revoke all on function public.kream_receive_with_review(uuid,uuid,jsonb,jsonb,text),public.kream_resolve_receiving_review(uuid,text,text,numeric,date) from public,anon;
grant execute on function public.kream_receive_with_review(uuid,uuid,jsonb,jsonb,text),public.kream_resolve_receiving_review(uuid,text,text,numeric,date) to authenticated;
commit;
