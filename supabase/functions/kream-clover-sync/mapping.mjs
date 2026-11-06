// Only unambiguous finished items. A flavourless menu, mixed set or unknown
// pack size must be reviewed by the owner instead of guessed.
export function safeMapping(name,catalog){
 const n=String(name).toLowerCase().replace(/\s+/g,' ').trim();
 const aliases={
  'sausage bread':'sausage-bread','susage bread':'sausage-bread','suasage bread':'sausage-bread',
  'protein banana pudding':'sheet-9e339b09aa',
  'tiramisu · classic':'tiramisu','classic tiramisu':'tiramisu',
  'tiramisu · mango':'sheet-c42f92202d','classic tiramisu · mango':'sheet-c42f92202d',
  'tiramisu · chestnut':'sheet-52e962d056',
  'chia seed pudding · coconut':'sheet-57897357d2','chia seed pudding · mango':'sheet-1e9121afc2','chia seed pudding · strawberry':'sheet-64fa084fc2','chia seed pudding · blueberry':'sheet-e35b099b4e',
  'rare cheese cake · mango':'sheet-fc126433db','rare cheese cake · mango rare cheese cake':'sheet-fc126433db',
  'rare cheese cake · strawberry':'sheet-5e65459382','rare cheese cake · strawberry rare cheese cake':'sheet-5e65459382',
  'rare cheese cake · oreo':'sheet-de03fcb009','rare cheese cake · choco':'sheet-790ead2a5b',
  'sour dough · plain':'sourdough-plain','whole cake · 4 inch / strawberry':'whole-strawberry-4'
 };
 const normal=s=>String(s||'').toLowerCase().replace(/[^a-z0-9가-힣]/g,'');
 const candidates=catalog.filter(p=>p.active&&!p.archived&&p.category==='디저트'&&/^(EA|개)$/.test(p.order_unit));
 const exact=candidates.filter(p=>[p.name_ko,p.name_en].some(s=>normal(s)===normal(name)));
 const product=candidates.find(p=>p.id===aliases[n])||(exact.length===1?exact[0]:null);
 return product?{product_id:product.id,stock_per_sale:1,enabled:true}:{};
}
