with wanted(name,product_id,stock_per_sale) as (values
 ('Fig Cheesecake','sheet-39cdeb9512',0.1::numeric),('Fig Cheese Cake','sheet-39cdeb9512',0.1),
 ('Yuzu Cheesecake','sheet-04562b9807',0.1),('Yuza Cheesecake','sheet-04562b9807',0.1),('Yuzu Cheese Cake','sheet-04562b9807',0.1),
 ('Chestnut Cheesecake','sheet-9fbb33a000',0.1),('Chestnut Cheese Cake','sheet-9fbb33a000',0.1),('Chestnust Cheese Cake','sheet-9fbb33a000',0.1),('Chesnut Cheesecake','sheet-9fbb33a000',0.1),
 ('Tiramisu Cheesecake','sheet-08ea6b9890',0.1),('Tiramisu Cheese Cake','sheet-08ea6b9890',0.1),
 ('Rare Cheese Cake · Oreo Rare Cheese Cake','sheet-de03fcb009',1),('Rare Cheese Cake · Oreo','sheet-de03fcb009',1)
), changed as (
 update public.kream_clover_items i set product_id=w.product_id,stock_per_sale=w.stock_per_sale,enabled=true,updated_at=clock_timestamp()
 from wanted w join public.kream_catalog p on p.id=w.product_id and p.active
 where lower(trim(i.name))=lower(w.name) and (i.product_id is null or i.product_id=w.product_id)
 returning i.store_id,i.name,i.product_id,i.stock_per_sale
) select * from changed order by store_id,name;
