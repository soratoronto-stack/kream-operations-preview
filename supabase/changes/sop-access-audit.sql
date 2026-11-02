begin;
alter table public.kream_guides add column audience text not null default 'all' check(audience in ('all','store','factory'));
revoke select on public.kream_guides from authenticated;
grant select(id,kind,store_id,title_ko,title_en,category,published,archived,revision,updated_at,created_by,audience) on public.kream_guides to authenticated;
grant insert(audience),update(audience) on public.kream_guides to authenticated;
-- Restrict body access to this account-checked, audited open operation.
create table public.kream_guide_views(guide_id uuid not null references public.kream_guides(id),viewer_id uuid not null references public.kream_profiles(user_id),minute_bucket timestamptz not null,recorded_name text not null,created_at timestamptz not null default clock_timestamp(),primary key(guide_id,viewer_id,minute_bucket));
alter table public.kream_guide_views enable row level security;
revoke all on public.kream_guide_views from public,anon,authenticated;
grant select on public.kream_guide_views to authenticated;
create policy guide_views_read on public.kream_guide_views for select to authenticated using(kream_private.current_role()='owner' or viewer_id=auth.uid());
create function public.kream_open_guide(target_guide uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.kream_guides%rowtype;r text:=kream_private.current_role();author text;
begin
 if auth.uid() is null or r is null then raise exception 'Guide denied' using errcode='42501';end if;
 select * into g from public.kream_guides where id=target_guide;
 if g.id is null or not (r='owner' or r='manager' and g.store_id is not null and kream_private.can_order_store(g.store_id) or g.published and not g.archived and (g.store_id is null or kream_private.can_read_store(g.store_id)) and (g.audience='all' or g.audience='factory' and r='factory' or g.audience='store' and r in ('employee','manager','midland_owner'))) then raise exception 'Guide denied' using errcode='42501';end if;
 if g.kind='sop' then
 select display_name into author from public.kream_profiles where user_id=auth.uid();
 insert into public.kream_guide_views(guide_id,viewer_id,minute_bucket,recorded_name) values(g.id,auth.uid(),date_trunc('minute',clock_timestamp()),author) on conflict do nothing;end if;
 return to_jsonb(g);
end;$$;
revoke all on function public.kream_open_guide(uuid) from public,anon;
grant execute on function public.kream_open_guide(uuid) to authenticated;
drop policy guides_read on public.kream_guides;
create policy guides_read on public.kream_guides for select to authenticated using(kream_private.current_role()='owner' or kream_private.current_role()='manager' and store_id is not null and kream_private.can_order_store(store_id) or published and not archived and kream_private.current_role() is not null and (store_id is null or kream_private.can_read_store(store_id)) and (audience='all' or audience='factory' and kream_private.current_role()='factory' or audience='store' and kream_private.current_role() in ('employee','manager','midland_owner')));
commit;
-- Managers may publish only store-facing documents for assigned stores.
begin;
drop policy guides_insert on public.kream_guides;
create policy guides_insert on public.kream_guides for insert to authenticated with check(created_by=auth.uid() and (kream_private.current_role()='owner' or kream_private.current_role()='manager' and audience='store' and store_id is not null and kream_private.can_order_store(store_id)));
drop policy guides_update on public.kream_guides;
create policy guides_update on public.kream_guides for update to authenticated using(kream_private.current_role()='owner' or kream_private.current_role()='manager' and store_id is not null and kream_private.can_order_store(store_id)) with check(kream_private.current_role()='owner' or kream_private.current_role()='manager' and audience='store' and store_id is not null and kream_private.can_order_store(store_id));
commit;
