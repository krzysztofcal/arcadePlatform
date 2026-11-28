import { runPlaySupportAcknowledgement } from './play-support-ack-worker.mjs';
import { inspectPlaySupportPurchase } from './play-support-purchase.mjs';

const PACKAGE_NAMES = new Map([
  ['stage', 'pl.kcswh.arcadepoker.stage'],
  ['production', 'pl.kcswh.arcadepoker']
]);
const SUPPORT_OUTCOMES = new Set(['UNBOUND', 'MISMATCH', 'ACCOUNT_INACTIVE', 'DUPLICATE_SKU', 'INELIGIBLE']);

function retryDelay(failureCount, retryAfter, random) {
  const next = Math.min(900_000, 30_000 * (2 ** Math.min(failureCount, 5)));
  const jittered = next + Math.floor(next * 0.2 * random());
  // Unexpectedly large throttling values need operator monitoring, not overflow.
  const throttled = Number.isFinite(retryAfter) ? Math.min(86_400_000, retryAfter) : 0;
  return Math.max(jittered, throttled);
}

export async function runPlaySupportWork({
  packageName, environment, tokenHash = null, store, publisher, codec,
  now = Date.now, random = Math.random
}) {
  if (PACKAGE_NAMES.get(environment) !== packageName || typeof packageName !== 'string') {
    throw new Error('play_support_work_target');
  }
  const claim = await store.claim(packageName, tokenHash);
  if (!claim) return { state: 'NO_WORK' };

  async function reschedule(state, delay, failed, reason) {
    const saved = await store.reschedule(claim, new Date(now() + delay), failed);
    if (!saved) return { state: 'STALE' };
    return reason ? { state, reason } : { state };
  }

  let applied;
  let token;
  let observed;
  let accountBinding;
  try {
    token = codec.decrypt(claim.envelope, {
      environment, packageName, tokenHash: claim.tokenHash.toString('hex')
    });
    const purchase = await publisher.readPurchase(token);
    // Resolve the provider's stable ID against the locally scoped SQL
    // binding; UNKNOWN or conflicting mappings never create ownership.
    accountBinding = purchase?.obfuscatedExternalAccountId;
    observed = inspectPlaySupportPurchase(purchase, { accountBinding, environment });
    if (observed.state === 'REJECTED') {
      return reschedule('SUPPORT_REQUIRED', retryDelay(claim.failureCount, null, random), true, observed.reason);
    }

    applied = await store.applyPurchase({
      ...observed, accountBinding, packageName, generation: claim.generation,
      tokenHash: claim.tokenHash, isTest: environment === 'stage'
    });

    if (applied.outcome === 'STALE') return { state: 'STALE' };
    if (!applied.receiptId && !SUPPORT_OUTCOMES.has(applied.outcome)) {
      return reschedule('RETRY', retryDelay(claim.failureCount, null, random), true, 'missing_receipt');
    }
    if (applied.outcome === 'PENDING') {
      return reschedule('PENDING', environment === 'stage' ? 10_000 : 300_000, false);
    }
    if (SUPPORT_OUTCOMES.has(applied.outcome)) {
      return reschedule('SUPPORT_REQUIRED', retryDelay(claim.failureCount, null, random), true, applied.outcome);
    }

    if (applied.outcome === 'GRANTED' || applied.outcome === 'ALREADY_GRANTED') {
      const ack = await runPlaySupportAcknowledgement({
        receipt: { id: applied.receiptId, generation: claim.generation, sku: observed.sku, accountBinding, environment },
        token, store, publisher
      });
      if (ack.state === 'STALE') return ack;
      if (ack.state !== 'CONFIRMED' && !(ack.state === 'NO_ATTEMPT' && observed.acknowledged)) {
        return reschedule('RETRY', retryDelay(claim.failureCount, ack.retryAfterMs, random), true);
      }
    } else if (!['REVOKED', 'ALREADY_ABSENT', 'TERMINAL'].includes(applied.outcome)) {
      return reschedule('RETRY', retryDelay(claim.failureCount, null, random), true);
    }

    if (await store.complete(applied.receiptId, claim.generation)) return { state: 'COMPLETE' };
    // Completion can lose to a newer notification. Keep due work durable.
    return reschedule('RETRY', retryDelay(claim.failureCount, null, random), true);
  } catch (error) {
    return reschedule('RETRY', retryDelay(claim.failureCount, error?.retryAfterMs, random), true, 'processing_failed');
  }
}
