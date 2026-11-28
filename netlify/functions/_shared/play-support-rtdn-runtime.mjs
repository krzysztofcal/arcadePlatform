import { createHash } from 'node:crypto';
import { createPlaySupportRtdnHandler } from './play-support-rtdn.mjs';
import { runPlaySupportWork } from './play-support-work.mjs';

export function createPlaySupportRtdnRuntime({
  environment, packageName, subscription, verifyAuthorization, codec, store, publisher
}) {
  const hash = token => createHash('sha256').update(token).digest();
  return createPlaySupportRtdnHandler({
    environment, packageName, subscription, verifyAuthorization,
    enqueue({ token, messageId, eventAt }) {
      const tokenHash = hash(token);
      const envelope = codec.encrypt(token, { environment, packageName, tokenHash: tokenHash.toString('hex') });
      return store.enqueue(packageName, tokenHash, envelope, { messageId, eventAt });
    },
    process({ token }) {
      return runPlaySupportWork({ environment, packageName, tokenHash: hash(token), store, publisher, codec });
    },
    isComplete({ token, messageId }) {
      return store.isComplete(packageName, hash(token), messageId);
    }
  });
}
