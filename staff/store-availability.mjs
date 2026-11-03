// Ordering visibility only. Keep the full catalog for production and history.
export function availableForStore(product, store) {
  const creamBomb = product.id?.startsWith('bomb-') || product.subgroup === '크림밤' || /크림밤/.test(product.name_ko || '');
  return !creamBomb || store === 'midland';
}
export function storeCatalog(catalog, store) {
  return catalog.filter(product => availableForStore(product, store));
}
