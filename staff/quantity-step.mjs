// Counted packages step by one; measured weights/volumes retain precision.
export function quantityStep(unit='') {
  return /(^|[\s·/])(kg|g|mg|l|ml|oz|lb|lbs)(?=$|[\s·/])|킬로|그램|리터/i.test(unit.trim()) ? '0.001' : '1';
}
