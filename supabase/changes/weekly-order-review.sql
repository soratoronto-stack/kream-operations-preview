-- Shared weekly review. Saves no inventory values and never places an order.
create table public.kream_weekly_order_reviews (
 store_id text not null references public.kream_stores(id),
 product_id text not null references public.kream_catalog(id),
 checked_at timestamptz not null default clock_timestamp(),
 checked_by uuid not null references public.kream_profiles(user_id),
 next_review_date date not null,
 primary key(store_id,product_id)
);
alter table public.kream_weekly_order_reviews enable row level security;
revoke all on public.kream_weekly_order_reviews from public,anon,authenticated;
grant select on public.kream_weekly_order_reviews to authenticated;
grant insert(store_id,product_id),update(store_id,product_id) on public.kream_weekly_order_reviews to authenticated;
create policy weekly_review_read on public.kream_weekly_order_reviews for select to authenticated using(kream_private.can_order_store(store_id));
create policy weekly_review_insert on public.kream_weekly_order_reviews for insert to authenticated with check(kream_private.can_order_store(store_id) and checked_by=(select auth.uid()));
create policy weekly_review_update on public.kream_weekly_order_reviews for update to authenticated using(kream_private.can_order_store(store_id)) with check(kream_private.can_order_store(store_id) and checked_by=(select auth.uid()));
create function kream_private.stamp_weekly_order_review() returns trigger language plpgsql security invoker set search_path='' as $$begin
 new.checked_by:=auth.uid();new.checked_at:=clock_timestamp();new.next_review_date:=(new.checked_at at time zone 'America/Toronto')::date+7;return new;
end$$;
create trigger weekly_review_stamp before insert or update on public.kream_weekly_order_reviews for each row execute function kream_private.stamp_weekly_order_review();
revoke all on function kream_private.stamp_weekly_order_review() from public,anon,authenticated;
