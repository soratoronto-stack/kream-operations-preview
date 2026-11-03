alter table public.kream_profiles add column if not exists general_manager boolean not null default false;
comment on column public.kream_profiles.general_manager is 'All-store operational manager; valid only with manager role. No wholesale or settlement access.';
CREATE OR REPLACE FUNCTION kream_private.can_order_store(target_store text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.kream_profiles p
    join public.kream_stores s on s.id = target_store and s.active
    where p.user_id = auth.uid() and p.active and (
      (p.role = 'owner' or p.role = 'manager' and p.general_manager) or (
        p.role in ('employee','manager','midland_owner')
        and (p.role <> 'midland_owner' or target_store = 'midland')
        and exists (select 1 from public.kream_memberships m where m.user_id = p.user_id and m.store_id = target_store)
      )
    )
  )
$function$;
CREATE OR REPLACE FUNCTION kream_private.can_read_store(target_store text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.kream_profiles p
    join public.kream_stores s on s.id = target_store
    where p.user_id = auth.uid() and p.active and (
      (p.role in ('owner','factory') or p.role = 'manager' and p.general_manager) or (
        p.role in ('employee','manager','midland_owner')
        and (p.role <> 'midland_owner' or target_store = 'midland')
        and exists (select 1 from public.kream_memberships m where m.user_id = p.user_id and m.store_id = target_store)
      )
    )
  )
$function$;
