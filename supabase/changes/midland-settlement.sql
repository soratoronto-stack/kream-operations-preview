begin;
create function kream_private.can_read_midland_money() returns boolean language sql stable security definer set search_path='' as $$select coalesce(kream_private.current_role()='owner' or kream_private.current_role()='midland_owner' and kream_private.can_order_store('midland'),false)$$;
revoke all on function kream_private.can_read_midland_money() from public,anon;
grant execute on function kream_private.can_read_midland_money() to authenticated;
create table public.kream_delivery_prices(product_id text not null references public.kream_catalog(id),effective_date date not null,unit_price numeric(12,2) not null check(unit_price>=0 and unit_price<=100000),revision bigint not null default 1,updated_by uuid not null default auth.uid(),updated_at timestamptz not null default now(),primary key(product_id,effective_date));
create table public.kream_monthly_royalty(month date primary key check(extract(day from month)=1),sales numeric(14,2) not null check(sales>=0 and sales<=100000000),rate numeric not null default 0.04 check(rate=0.04),revision bigint not null default 1,recorded_by uuid not null default auth.uid(),recorded_at timestamptz not null default now());
create table public.kream_statement_adjustments(id uuid primary key,period_start date not null,amount numeric(14,2) not null check(amount<>0 and abs(amount)<=100000000),reason text not null check(char_length(reason) between 1 and 500),recorded_by uuid not null default auth.uid(),created_at timestamptz not null default now());
create table public.kream_statements(period_start date primary key,period_end date not null,due_date date not null,subtotal numeric(14,2) not null,royalty numeric(14,2) not null,adjustments numeric(14,2) not null,total numeric(14,2) not null check(total>=0),snapshot jsonb not null,confirmed_by uuid not null default auth.uid(),confirmed_at timestamptz not null default now());
create table public.kream_statement_payments(id uuid primary key,period_start date not null references public.kream_statements(period_start),amount numeric(14,2) not null check(amount>0 and amount<=100000000),payment_date date not null,note text not null default '' check(char_length(note)<=500),recorded_by uuid not null default auth.uid(),created_at timestamptz not null default now());
create table public.kream_money_audit(id bigint generated always as identity primary key,record_kind text not null,record_key text not null,old_value jsonb,new_value jsonb,recorded_by uuid not null default auth.uid(),created_at timestamptz not null default now());
do $$declare tab text;begin foreach tab in array array['kream_delivery_prices','kream_monthly_royalty','kream_statement_adjustments','kream_statements','kream_statement_payments','kream_money_audit'] loop execute format('alter table public.%I enable row level security',tab);execute format('revoke all on public.%I from public,anon,authenticated',tab);execute format('grant select on public.%I to authenticated',tab);execute format('create policy money_read on public.%I for select to authenticated using(kream_private.can_read_midland_money())',tab);end loop;end$$;
create function public.kream_save_delivery_price(target_product text,starts date,price numeric,expected_revision bigint) returns void language plpgsql security definer set search_path='' as $$
declare old public.kream_delivery_prices%rowtype;fresh public.kream_delivery_prices%rowtype;
begin
 if auth.uid() is null or kream_private.current_role() is distinct from 'owner' then raise exception 'Price denied' using errcode='42501';end if;
 if starts is null or price is null or price::text in ('NaN','Infinity','-Infinity') or price<0 or price>100000 or price<>round(price,2) then raise exception 'Invalid price' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('midland-money',0));
 select * into old from public.kream_delivery_prices where product_id=target_product and effective_date=starts for update;
 if coalesce(old.revision,0)<>expected_revision then raise exception 'Price changed' using errcode='40001';end if;
 insert into public.kream_delivery_prices(product_id,effective_date,unit_price) values(target_product,starts,price) on conflict(product_id,effective_date) do update set unit_price=excluded.unit_price,revision=kream_delivery_prices.revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() returning * into fresh;
 insert into public.kream_money_audit(record_kind,record_key,old_value,new_value) values('price',target_product||':'||starts,to_jsonb(old),to_jsonb(fresh));
end$$;
create function public.kream_save_monthly_sales(target_month date,sales_amount numeric,expected_revision bigint) returns void language plpgsql security definer set search_path='' as $$
declare old public.kream_monthly_royalty%rowtype;fresh public.kream_monthly_royalty%rowtype;
begin
 if auth.uid() is null or kream_private.current_role() is distinct from 'owner' then raise exception 'Sales denied' using errcode='42501';end if;
 if target_month is null or extract(day from target_month)<>1 or sales_amount is null or sales_amount::text in ('NaN','Infinity','-Infinity') or sales_amount<0 or sales_amount>100000000 or sales_amount<>round(sales_amount,2) then raise exception 'Invalid sales' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('midland-money',0));
 if exists(select 1 from public.kream_statements where period_start=target_month+15) then raise exception 'Statement already confirmed' using errcode='22023';end if;
 select * into old from public.kream_monthly_royalty where month=target_month for update;
 if coalesce(old.revision,0)<>expected_revision then raise exception 'Sales changed' using errcode='40001';end if;
 insert into public.kream_monthly_royalty(month,sales) values(target_month,sales_amount) on conflict(month) do update set sales=excluded.sales,revision=kream_monthly_royalty.revision+1,recorded_by=auth.uid(),recorded_at=clock_timestamp() returning * into fresh;
 insert into public.kream_money_audit(record_kind,record_key,old_value,new_value) values('monthly_sales',target_month::text,to_jsonb(old),to_jsonb(fresh));
end$$;
create function public.kream_add_statement_adjustment(request_id uuid,starts date,value numeric,reason_text text) returns void language plpgsql security definer set search_path='' as $$declare old public.kream_statement_adjustments%rowtype;begin
 if auth.uid() is null or kream_private.current_role() is distinct from 'owner' then raise exception 'Adjustment denied' using errcode='42501';end if;
 if request_id is null or starts is null or extract(day from starts) not in (1,16) or value is null or value::text in ('NaN','Infinity','-Infinity') or value=0 or abs(value)>100000000 or value<>round(value,2) or char_length(trim(reason_text)) not between 1 and 500 then raise exception 'Invalid adjustment' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('midland-money',0));select * into old from public.kream_statement_adjustments where id=request_id;
 if found then if old.period_start<>starts or old.amount<>value or old.reason<>trim(reason_text) or old.recorded_by<>auth.uid() then raise exception 'Adjustment retry conflict' using errcode='22023';end if;return;end if;
 if exists(select 1 from public.kream_statements where period_start=starts) then raise exception 'Statement confirmed' using errcode='22023';end if;
 insert into public.kream_statement_adjustments(id,period_start,amount,reason) values(request_id,starts,value,trim(reason_text));
end$$;
create function public.kream_midland_report(starts date) returns jsonb language plpgsql security definer set search_path='' as $$
declare ends date;lines jsonb;ordered jsonb;adjust jsonb;sub numeric;missing int;roy numeric;monthly public.kream_monthly_royalty%rowtype;saved public.kream_statements%rowtype;paid numeric;result jsonb;
begin
 if auth.uid() is null or not kream_private.can_read_midland_money() then raise exception 'Settlement denied' using errcode='42501';end if;
 if starts is null or extract(day from starts) not in(1,16) then raise exception 'Invalid period' using errcode='22023';end if;
 ends:=case when extract(day from starts)=1 then starts+14 else (date_trunc('month',starts)+interval '1 month - 1 day')::date end;
 select * into saved from public.kream_statements where period_start=starts;
 select coalesce(sum(amount),0) into paid from public.kream_statement_payments where period_start=starts;
 if saved.period_start is not null then return saved.snapshot||jsonb_build_object('confirmed',true,'confirmed_at',saved.confirmed_at,'paid',paid,'balance',saved.total-paid);end if;
 with rows as(select d.id dispatch_id,d.order_id,(d.created_at at time zone 'America/Toronto')::date as "day",d.recorded_name,di.product_id,oi.name_ko,oi.name_en,oi.order_unit,di.quantity,pr.unit_price,case when pr.unit_price is null then null else round(di.quantity*pr.unit_price,2) end amount from public.kream_dispatches d join public.kream_dispatch_items di on di.dispatch_id=d.id join public.kream_order_items oi on oi.order_id=d.order_id and oi.product_id=di.product_id left join lateral(select p.unit_price from public.kream_delivery_prices p where p.product_id=di.product_id and p.effective_date<=(d.created_at at time zone 'America/Toronto')::date order by p.effective_date desc limit 1) pr on true where d.store_id='midland' and (d.created_at at time zone 'America/Toronto')::date between starts and ends)
 select coalesce(jsonb_agg(to_jsonb(rows) order by "day",order_id,product_id),'[]'),coalesce(sum(amount),0),count(*) filter(where unit_price is null) into lines,sub,missing from rows;
 select coalesce(jsonb_agg(to_jsonb(o) order by delivery_date,id),'[]') into ordered from(select id,delivery_date,status,note,(select jsonb_agg(jsonb_build_object('product_id',i.product_id,'name_ko',i.name_ko,'name_en',i.name_en,'quantity',i.quantity,'order_unit',i.order_unit) order by i.product_id) from public.kream_order_items i where i.order_id=kream_orders.id) items from public.kream_orders where store_id='midland' and delivery_date between starts and ends) o;
 select * into monthly from public.kream_monthly_royalty where month=date_trunc('month',starts)::date;
 roy:=case when extract(day from starts)=1 then 0 when monthly.month is null then null else round(monthly.sales*0.04,2) end;
 select coalesce(jsonb_agg(to_jsonb(a) order by created_at),'[]') into adjust from public.kream_statement_adjustments a where period_start=starts;
 result:=jsonb_build_object('start',starts,'end',ends,'due',ends+7,'lines',lines,'orders',ordered,'adjustment_lines',adjust,'subtotal',case when missing=0 then sub else null end,'known_subtotal',sub,'missing_prices',missing,'monthly_sales',monthly.sales,'royalty',roy,'adjustments',(select coalesce(sum(amount),0) from public.kream_statement_adjustments where period_start=starts),'confirmed',false,'paid',paid);
 result:=result||jsonb_build_object('total',case when missing=0 and roy is not null then sub+roy+(result->>'adjustments')::numeric else null end);
 return result||jsonb_build_object('balance',(result->>'total')::numeric-paid);
end$$;
create function public.kream_confirm_statement(starts date) returns void language plpgsql security definer set search_path='' as $$declare report jsonb;begin
 if auth.uid() is null or kream_private.current_role() is distinct from 'owner' then raise exception 'Confirmation denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('midland-money',0));
 if exists(select 1 from public.kream_statements where period_start=starts) then return;end if;
 report:=public.kream_midland_report(starts);
 if (report->>'end')::date>=(clock_timestamp() at time zone 'America/Toronto')::date or report->>'total' is null or (report->>'total')::numeric<0 then raise exception 'Incomplete or unclosed statement' using errcode='22023';end if;
 insert into public.kream_statements(period_start,period_end,due_date,subtotal,royalty,adjustments,total,snapshot) values(starts,(report->>'end')::date,(report->>'due')::date,(report->>'subtotal')::numeric,(report->>'royalty')::numeric,(report->>'adjustments')::numeric,(report->>'total')::numeric,report);
end$$;
create function public.kream_record_statement_payment(request_id uuid,starts date,value numeric,paid_on date,payment_note text) returns void language plpgsql security definer set search_path='' as $$declare old public.kream_statement_payments%rowtype;s public.kream_statements%rowtype;paid numeric;begin
 if auth.uid() is null or kream_private.current_role() is distinct from 'owner' then raise exception 'Payment record denied' using errcode='42501';end if;
 if request_id is null or value is null or value::text in('NaN','Infinity','-Infinity') or value<=0 or value<>round(value,2) or paid_on is null or paid_on>(clock_timestamp() at time zone 'America/Toronto')::date or payment_note is null or char_length(payment_note)>500 then raise exception 'Invalid payment record' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('midland-money',0));select * into old from public.kream_statement_payments where id=request_id;
 if found then if old.period_start<>starts or old.amount<>value or old.payment_date<>paid_on or old.note<>payment_note or old.recorded_by<>auth.uid() then raise exception 'Payment retry conflict' using errcode='22023';end if;return;end if;
 select * into s from public.kream_statements where period_start=starts for update;select coalesce(sum(amount),0) into paid from public.kream_statement_payments where period_start=starts;
 if s.period_start is null or value>s.total-paid then raise exception 'Payment exceeds balance or statement unconfirmed' using errcode='22023';end if;
 insert into public.kream_statement_payments(id,period_start,amount,payment_date,note) values(request_id,starts,value,paid_on,payment_note);
end$$;
do $$declare f regprocedure;begin for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('kream_save_delivery_price','kream_save_monthly_sales','kream_add_statement_adjustment','kream_midland_report','kream_confirm_statement','kream_record_statement_payment') loop execute format('revoke all on function %s from public,anon',f);execute format('grant execute on function %s to authenticated',f);end loop;end$$;
commit;
