// Walk each shared object once. Recreated for every frame: no stale validation cache.
export function validateFinitePacket(packet: unknown) {
 const stack: any[] = [packet], seen = new WeakSet<object>();
 while (stack.length) {
  const value = stack.pop();
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw Error('non-finite evaluation'); continue; }
  if (!value || typeof value !== 'object' || seen.has(value)) continue;
  seen.add(value);
  for (const key in value) {
   if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
   const item = value[key];
   if (typeof item === 'number') { if (!Number.isFinite(item)) throw Error('non-finite evaluation'); }
   else if (item && typeof item === 'object') stack.push(item);
  }
 }
}
