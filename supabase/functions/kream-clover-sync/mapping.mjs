// Only unambiguous finished items. A flavourless menu, mixed set or unknown
// pack size must be reviewed by the owner instead of guessed.
export function safeMapping(name,catalog,storeId=''){
 const n=String(name).toLowerCase().replace(/\s+/g,' ').trim();
 // Owner confirmed these are counted manually, rather than by POS sales.
 if(/(?:kream|cream)\s*bomb|크림밤/.test(n))return {};
 if(storeId==='finch'&&(/^(mini croissant)( · .*)?$/.test(n)||/^financiers · 2ea( \/ 2ea)*$/.test(n)||n==='garlic bagel'))return {};
 if(storeId==='midland'&&n==='croissant cookie · sweet')return {};
 if(storeId==='richmond-hill'&&['bagel · basil tomato','bagel · blueberry','bagel · strawberry','scones · plain','short cake'].includes(n))return {};
 if(storeId==='downtown'&&['financier · choco','mini scone'].includes(n))return {};
 const confirmed={finch:{'cookie · cookie set':'pantry-cookie-set','crumble rice cake · injeolmi':'sheet-84dd8c64a5'},'richmond-hill':{'chestnut crumble · mugwort':'sheet-48cab960c4'}};
 const confirmedId=confirmed[storeId]?.[n];
 if(confirmedId){const p=catalog.find(p=>p.id===confirmedId&&p.active&&!p.archived&&/^(EA|개|Set)$/.test(p.order_unit));return p?{product_id:p.id,stock_per_sale:1,enabled:true}:{};}
 const aliases={
  'sausage bread':'sausage-bread','susage bread':'sausage-bread','suasage bread':'sausage-bread',
  'protein banana pudding':'sheet-9e339b09aa',
  'tiramisu · classic':'tiramisu','classic tiramisu':'tiramisu',
  'tiramisu · mango':'sheet-c42f92202d','classic tiramisu · mango':'sheet-c42f92202d',
  'tiramisu · chestnut':'sheet-52e962d056',
  'chia seed pudding · coconut':'sheet-57897357d2','chia seed pudding · mango':'sheet-1e9121afc2','chia seed pudding · strawberry':'sheet-64fa084fc2','chia seed pudding · blueberry':'sheet-e35b099b4e',
  'rare cheese cake · mango':'sheet-fc126433db','rare cheese cake · mango rare cheese cake':'sheet-fc126433db',
  'rare cheese cake · strawberry':'sheet-5e65459382','rare cheese cake · strawberry rare cheese cake':'sheet-5e65459382',
  'rare cheese cake · oreo':'sheet-de03fcb009','rare cheese cake · oreo rare cheese cake':'sheet-de03fcb009','rare cheese cake · choco':'sheet-790ead2a5b',
  'sour dough · plain':'sourdough-plain','whole cake · 4 inch / strawberry':'whole-strawberry-4'
 };
 const normal=s=>String(s||'').toLowerCase().replace(/[^a-z0-9가-힣]/g,'');
 const trays={'fig cheesecake':'sheet-39cdeb9512','fig cheese cake':'sheet-39cdeb9512','yuzu cheesecake':'sheet-04562b9807','yuza cheesecake':'sheet-04562b9807','yuzu cheese cake':'sheet-04562b9807','chestnut cheesecake':'sheet-9fbb33a000','chestnut cheese cake':'sheet-9fbb33a000','chestnust cheese cake':'sheet-9fbb33a000','chesnut cheesecake':'sheet-9fbb33a000','tiramisu cheesecake':'sheet-08ea6b9890','tiramisu cheese cake':'sheet-08ea6b9890'};
 const tray=catalog.find(p=>p.id===trays[n]&&p.active&&!p.archived&&p.order_unit==='Tray');
 if(tray)return {product_id:tray.id,stock_per_sale:0.1,enabled:true};
 const candidates=catalog.filter(p=>p.active&&!p.archived&&p.category==='디저트'&&/^(EA|개)$/.test(p.order_unit));
 const exact=candidates.filter(p=>[p.name_ko,p.name_en].some(s=>normal(s)===normal(name)));
 const product=candidates.find(p=>p.id===aliases[n])||(exact.length===1?exact[0]:null);
 return product?{product_id:product.id,stock_per_sale:1,enabled:true}:{};
}
