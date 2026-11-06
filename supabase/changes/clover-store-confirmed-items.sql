begin;
insert into public.kream_catalog(id,name_ko,name_en,category,subgroup,order_unit,unit_confirmed,active,production_team)
values('pantry-cookie-set','쿠키세트','Cookie Set','디저트','쿠키','Set',true,true,'cookies')
on conflict(id) do nothing;
update public.kream_clover_items set product_id='pantry-cookie-set',stock_per_sale=1,enabled=true,updated_at=clock_timestamp()
where store_id='finch' and name='Cookie · Cookie Set' and (product_id is null or product_id='pantry-cookie-set');
update public.kream_clover_items set product_id='sheet-84dd8c64a5',stock_per_sale=1,enabled=true,updated_at=clock_timestamp()
where store_id='finch' and name='Crumble Rice Cake · Injeolmi' and (product_id is null or product_id='sheet-84dd8c64a5');
update public.kream_clover_items set product_id='sheet-48cab960c4',stock_per_sale=1,enabled=true,updated_at=clock_timestamp()
where store_id='richmond-hill' and name='Chestnut Crumble · Mugwort' and (product_id is null or product_id='sheet-48cab960c4');
update public.kream_clover_items set enabled=false,updated_at=clock_timestamp()
where (store_id='finch' and (name ~ '^Financiers · 2ea( / 2ea)*$' or name='Garlic Bagel' or name ~ '^Mini Croissant( · .*)?$'))
or (store_id='midland' and name='Croissant Cookie · Sweet')
or (store_id='richmond-hill' and name in ('Bagel · Basil Tomato','Bagel · Blueberry','Bagel · Strawberry','Scones · Plain','Short Cake'))
or (store_id='downtown' and name in ('Financier · Choco','Mini scone'));
commit;
select store_id,name,product_id,stock_per_sale,enabled from public.kream_clover_items where (store_id='finch' and name in ('Cookie · Cookie Set','Crumble Rice Cake · Injeolmi','Garlic Bagel','Financiers · 2ea','Mini Croissant · Sweet','Mini Croissant · Spicy'))
or (store_id='midland' and name='Croissant Cookie · Sweet')
or (store_id='richmond-hill' and name in ('Chestnut Crumble · Mugwort','Tiramisu Cheesecake','Bagel · Basil Tomato','Bagel · Blueberry','Bagel · Strawberry','Scones · Plain','Short Cake')) order by store_id,name;
