import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const MAX_TOKEN_BYTES = 8192;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const PACKAGES = new Map([
  ['stage', 'pl.kcswh.arcadepoker.stage'],
  ['production', 'pl.kcswh.arcadepoker']
]);

function unavailable() {
  return new Error('play_support_token_unavailable');
}

function associatedData(version, { environment, packageName, tokenHash }) {
  if (PACKAGES.get(environment) !== packageName || typeof packageName !== 'string' ||
      typeof tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(tokenHash)) {
    throw unavailable();
  }
  return Buffer.from(JSON.stringify(['arcade-play-support-token', version, environment, packageName, tokenHash]));
}

function matchesHash(bytes, tokenHash) {
  return bytes.length > 0 && bytes.length <= MAX_TOKEN_BYTES &&
    createHash('sha256').update(bytes).digest('hex') === tokenHash;
}

export function createPlaySupportTokenCodec({ activeVersion, keys }) {
  if (!(keys instanceof Map) || !keys.has(activeVersion)) throw unavailable();
  const keyring = new Map();
  for (const [version, key] of keys) {
    if (!Number.isSafeInteger(version) || version < 1 || !Buffer.isBuffer(key) || key.length !== 32) {
      throw unavailable();
    }
    keyring.set(version, Buffer.from(key));
  }

  return {
    encrypt(token, binding) {
      try {
        if (typeof token !== 'string' || Buffer.byteLength(token) > MAX_TOKEN_BYTES) throw unavailable();
        const bytes = Buffer.from(token);
        if (!matchesHash(bytes, binding.tokenHash)) throw unavailable();
        const nonce = randomBytes(NONCE_BYTES);
        const cipher = createCipheriv('aes-256-gcm', keyring.get(activeVersion), nonce);
        cipher.setAAD(associatedData(activeVersion, binding));
        const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
        return { keyVersion: activeVersion, nonce, ciphertext, tag: cipher.getAuthTag() };
      } catch {
        throw unavailable();
      }
    },

    decrypt({ keyVersion, nonce, ciphertext, tag }, binding) {
      try {
        const key = keyring.get(keyVersion);
        if (!key || !Buffer.isBuffer(nonce) || nonce.length !== NONCE_BYTES ||
            !Buffer.isBuffer(tag) || tag.length !== TAG_BYTES ||
            !Buffer.isBuffer(ciphertext) || ciphertext.length < 1 || ciphertext.length > MAX_TOKEN_BYTES) {
          throw unavailable();
        }
        const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
        decipher.setAAD(associatedData(keyVersion, binding));
        decipher.setAuthTag(tag);
        const bytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        if (!matchesHash(bytes, binding.tokenHash)) throw unavailable();
        return bytes.toString('utf8');
      } catch {
        throw unavailable();
      }
    }
  };
}
