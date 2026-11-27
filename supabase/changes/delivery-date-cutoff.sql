-- Preserve the existing access checks and idempotent retry path.
do $patch$
declare definition text; marker text := ' if jsonb_array_length(b.items)=0 then';
begin
 select pg_get_functiondef('public.kream_submit_store_basket(uuid,bigint)'::regprocedure) into definition;
 if position('DELIVERY_DATE_CUTOFF' in definition)=0 then
  if position(marker in definition)=0 then raise exception 'Unexpected submit function'; end if;
  definition := replace(definition,marker,$guard$
 -- DELIVERY_DATE_CUTOFF: Toronto business day changes at 03:00.
 -- The existing postgres cron runs at 03:05 to submit the just-closed day's baskets.
 if b.delivery_date < (((clock_timestamp() at time zone 'America/Toronto') - interval '3 hours')::date + 1)
    and not (session_user = 'postgres'
      and extract(hour from clock_timestamp() at time zone 'America/Toronto') = 3
      and b.delivery_date = (clock_timestamp() at time zone 'America/Toronto')::date)
 then raise exception 'DATE_PAST' using errcode='22023'; end if;
$guard$ || marker);
  execute definition;
 end if;
end $patch$;

do $patch$
declare definition text; marker text := ' merged:=b.items;';
begin
 select pg_get_functiondef('public.kream_save_store_basket(text,uuid,jsonb,jsonb,text,text,date,date)'::regprocedure) into definition;
 if position('EMPTY_BASKET_DATE_ROLLOVER' in definition)=0 then
  if position(marker in definition)=0 then raise exception 'Unexpected save function'; end if;
  definition:=replace(definition,marker,$guard$
 -- EMPTY_BASKET_DATE_ROLLOVER: also protect clients with an older cached page.
 if jsonb_array_length(b.items)=0 and b.note='' and
    new_date < (((clock_timestamp() at time zone 'America/Toronto') - interval '3 hours')::date + 1)
 then new_date:=(((clock_timestamp() at time zone 'America/Toronto') - interval '3 hours')::date + 1); end if;
$guard$ || marker);
  execute definition;
 end if;
end $patch$;
