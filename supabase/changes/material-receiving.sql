begin;
drop policy purchase_read on public.kream_purchases;
create policy purchase_read on public.kream_purchases for select to authenticated using(kream_private.can_manage_purchases() or kream_private.current_role()='factory' and status in ('purchased','received'));
drop policy purchase_receipts_read on public.kream_purchase_receipts;
create policy purchase_receipts_read on public.kream_purchase_receipts for select to authenticated using(kream_private.can_manage_purchases() or kream_private.current_role()='factory');
create or replace function public.kream_receive_purchase(request_id uuid,target_purchase uuid,amount numeric) returns uuid language plpgsql security definer set search_path='' as $$
declare old public.kream_purchase_receipts%rowtype;p public.kream_purchases%rowtype;received numeric;author text;
begin
 if auth.uid() is null or coalesce(kream_private.current_role(),'') not in ('owner','factory') then raise exception 'Purchase receipt denied' using errcode='42501';end if;
 if request_id is null or amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<=0 or amount>100000 or amount<>round(amount,3) then raise exception 'Invalid receipt' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('kream-purchase-receipt:'||request_id::text,0));select * into old from public.kream_purchase_receipts where id=request_id;
 if found then if old.recorded_by<>auth.uid() or old.purchase_id<>target_purchase or old.quantity<>amount then raise exception 'Receipt retry conflict' using errcode='22023';end if;return request_id;end if;
 select * into p from public.kream_purchases where id=target_purchase for update;
 if p.id is null or p.status<>'purchased' then raise exception 'Purchase not ready' using errcode='22023';end if;
 select coalesce(sum(quantity),0) into received from public.kream_purchase_receipts where purchase_id=p.id;
 if received+amount>p.quantity then raise exception 'Receipt exceeds purchase' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('kream-material:'||p.material_id::text,0));
 select display_name into author from public.kream_profiles where user_id=auth.uid();
 insert into public.kream_purchase_receipts(id,purchase_id,quantity,recorded_by,recorded_name) values(request_id,p.id,amount,auth.uid(),author);
 update public.kream_materials set on_hand=case when on_hand is null then null else on_hand+amount end,revision=revision+1,updated_by=auth.uid(),updated_name=author,updated_at=clock_timestamp() where id=p.material_id;
 if received+amount=p.quantity then update public.kream_purchases set status='received' where id=p.id;end if;return request_id;
end;$$;

commit;
