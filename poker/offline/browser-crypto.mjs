// Browser-only build adapter. Hash bytes come from Web Crypto, never a second shuffle.
const digests = new Map();
export async function prepareSeed(seed) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  digests.set(seed, new DataView(bytes));
}
export function createHash(algorithm) {
  if (algorithm !== 'sha256') throw new Error('Unsupported offline digest');
  let seed;
  return {
    update(value) { seed = value; return this; },
    digest() {
      const view = digests.get(seed);
      if (!view) throw new Error('Offline seed must be prepared before dealing');
      return { readUInt32BE(offset) { return view.getUint32(offset, false); } };
    }
  };
}
export default { createHash };
