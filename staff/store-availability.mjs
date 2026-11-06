// Ordering visibility only. Keep the full catalog for production and history.
export function availableForStore(product, store) {
  if(product.id==='pantry-cookie-set'&&store!=='finch')return false;
  if(product.category==='키친 발주'&&store!=='finch')return false;
  const creamBomb = product.id?.startsWith('bomb-') || product.subgroup === '크림밤' || /크림밤/.test(product.name_ko || '');
  return !creamBomb || store === 'midland';
}
export function storeCatalog(catalog, store) {
  return catalog.filter(product => availableForStore(product, store));
}
