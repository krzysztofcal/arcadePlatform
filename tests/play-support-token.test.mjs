import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPlaySupportTokenCodec } from '../netlify/functions/_shared/play-support-token.mjs';

const token = 'synthetic-play-purchase-token';
const tokenHash = createHash('sha256').update(token).digest('hex');
const binding = { environment: 'stage', packageName: 'pl.kcswh.arcadepoker.stage', tokenHash };
const oldKey = Buffer.alloc(32, 1);
const newKey = Buffer.alloc(32, 2);

test('encrypts opaque tokens with fresh nonces and retains key-version recovery', () => {
  const old = createPlaySupportTokenCodec({ activeVersion: 1, keys: new Map([[1, oldKey]]) });
  const current = createPlaySupportTokenCodec({
    activeVersion: 2, keys: new Map([[1, oldKey], [2, newKey]])
  });
  const previous = old.encrypt(token, binding);
  const next = current.encrypt(token, binding);
  assert.equal(next.keyVersion, 2);
  assert.notDeepEqual(next.nonce, current.encrypt(token, binding).nonce);
  assert.equal(current.decrypt(previous, binding), token);
  assert.equal(current.decrypt(next, binding), token);
  assert.ok(!next.ciphertext.includes(Buffer.from(token)));
  assert.throws(() => old.decrypt(next, binding), /^Error: play_support_token_unavailable$/);
});

test('rejects wrong binding, modified data and invalid keys without leaking tokens', () => {
  const codec = createPlaySupportTokenCodec({ activeVersion: 1, keys: new Map([[1, oldKey]]) });
  const sealed = codec.encrypt(token, binding);
  for (const changed of [
    { ...binding, environment: 'production' },
    { ...binding, packageName: 'pl.kcswh.arcadepoker' },
    { ...binding, tokenHash: '0'.repeat(64) }
  ]) {
    assert.throws(() => codec.decrypt(sealed, changed), /^Error: play_support_token_unavailable$/);
  }
  const tampered = Buffer.from(sealed.ciphertext);
  tampered[0] ^= 1;
  assert.throws(() => codec.decrypt({ ...sealed, ciphertext: tampered }, binding),
    /^Error: play_support_token_unavailable$/);
  assert.throws(() => codec.encrypt(token, { ...binding, tokenHash: '0'.repeat(64) }),
    /^Error: play_support_token_unavailable$/);
  assert.throws(() => createPlaySupportTokenCodec({ activeVersion: 1, keys: new Map([[1, Buffer.alloc(31)]]) }),
    /^Error: play_support_token_unavailable$/);
});
