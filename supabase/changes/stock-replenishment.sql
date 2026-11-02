begin;
create table public.kream_stock_rules (
 store_id text not null references public.kream_stores(id),product_id text not null references public.kream_catalog(id),
 weekday_base numeric(12,3),weekend_base numeric(12,3),weekend_days integer[] not null default array[5,6,0],
 revision bigint not null default 1,updated_by uuid not null references public.kream_profiles(user_id),updated_at timestamptz not null default now(),
 primary key(store_id,product_id),check(weekday_base between 0 and 100000),check(weekend_base between 0 and 100000)
);
alter table public.kream_stock_rules enable row level security;
revoke all on public.kream_stock_rules from public,anon,authenticated;
grant select on public.kream_stock_rules to authenticated;
create policy stock_rules_read on public.kream_stock_rules for select to authenticated using(kream_private.can_read_store(store_id));
create function public.kream_save_stock_plan(target_store text,target_product text,new_on_hand numeric,new_minimum numeric,weekday_base numeric,weekend_base numeric,weekend_days integer[],expected_stock_revision bigint,expected_rule_revision bigint) returns bigint language plpgsql security definer set search_path='' as $$
declare old public.kream_stock_rules%rowtype; old_min numeric; stockrev bigint; rule_changed boolean;
begin
 if auth.uid() is null or not coalesce(kream_private.can_order_store(target_store),false) then raise exception 'Stock plan denied' using errcode='42501';end if;
 if not exists(select 1 from public.kream_catalog p where p.id=target_product and p.active and p.unit_confirmed) then raise exception 'Product unit pending' using errcode='22023';end if;
 if (weekday_base is not null and (weekday_base::text in ('NaN','Infinity','-Infinity') or weekday_base<0 or weekday_base>100000 or weekday_base<>round(weekday_base,3))) or (weekend_base is not null and (weekend_base::text in ('NaN','Infinity','-Infinity') or weekend_base<0 or weekend_base>100000 or weekend_base<>round(weekend_base,3))) or weekend_days is null or cardinality(weekend_days)>7 or exists(select 1 from unnest(weekend_days) d where d is null or d not between 0 and 6) or cardinality(weekend_days)<>(select count(distinct d) from unnest(weekend_days) d) then raise exception 'Invalid stock base' using errcode='22023';end if;
 if new_minimum is not null and (weekday_base<new_minimum or weekend_base<new_minimum) then raise exception 'Base below minimum' using errcode='22023';end if;
 -- Same lock as receipts and stock counts: a receipt cannot be silently overwritten by a stale count.
 perform pg_advisory_xact_lock(hashtextextended(target_store||':'||target_product,0));
 select * into old from public.kream_stock_rules r where r.store_id=target_store and r.product_id=target_product for update;
 select s.minimum into old_min from public.kream_stock s where s.store_id=target_store and s.product_id=target_product;
 if coalesce(old.revision,0) is distinct from expected_rule_revision then raise exception 'Stock rule changed' using errcode='40001';end if;
 rule_changed:=weekday_base is distinct from old.weekday_base or weekend_base is distinct from old.weekend_base or weekend_days is distinct from coalesce(old.weekend_days,array[5,6,0]);
 if not coalesce(kream_private.can_manage_store(target_store),false) and (rule_changed or new_minimum is distinct from old_min) then raise exception 'Only managers can set stock bases' using errcode='42501';end if;
 stockrev:=public.kream_save_stock(target_store,target_product,new_on_hand,new_minimum,expected_stock_revision);
 if rule_changed or old.revision is null then
 insert into public.kream_stock_rules(store_id,product_id,weekday_base,weekend_base,weekend_days,updated_by)
 values(target_store,target_product,weekday_base,weekend_base,weekend_days,auth.uid())
 on conflict(store_id,product_id) do update set weekday_base=excluded.weekday_base,weekend_base=excluded.weekend_base,weekend_days=excluded.weekend_days,revision=kream_stock_rules.revision+1,updated_by=excluded.updated_by,updated_at=clock_timestamp();end if;
 return stockrev;
end;$$;
revoke all on function public.kream_save_stock_plan(text,text,numeric,numeric,numeric,numeric,integer[],bigint,bigint) from public,anon;
grant execute on function public.kream_save_stock_plan(text,text,numeric,numeric,numeric,numeric,integer[],bigint,bigint) to authenticated;
commit;
