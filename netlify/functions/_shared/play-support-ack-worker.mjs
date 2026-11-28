import { inspectPlaySupportPurchase } from './play-support-purchase.mjs';

export function createPlaySupportAckStore(beginSupportSql) {
  const run = (statement, args) => beginSupportSql(async tx => {
    const [row] = await tx.unsafe(statement, args);
    return row?.result ?? null;
  });
  return {
    recoverAck: (id, generation) => run(
      'select arcade_play_api.play_support_recover_ack($1::uuid, $2::bigint) as result', [id, generation]
    ),
    beginAck: (id, generation) => run(
      'select arcade_play_api.play_support_begin_ack($1::uuid, $2::bigint) as result', [id, generation]
    ),
    finishAck: (id, generation, attemptId, outcome) => run(
      'select arcade_play_api.play_support_finish_ack($1::uuid, $2::bigint, $3::uuid, $4::text) as result',
      [id, generation, attemptId, outcome]
    )
  };
}

// The caller owns the inbox lease and has durably applied provider evidence
// and grant. Store operations return only after their transaction commits.
export async function runPlaySupportAcknowledgement({ receipt, token, store, publisher }) {
  const { id, generation, sku } = receipt;
  const previous = await store.recoverAck(id, generation);
  if (previous) {
    const observed = inspectPlaySupportPurchase(await publisher.readPurchase(token), receipt);
    if (observed.state !== 'PURCHASED') return { state: 'RECHECK_RECEIPT' };
    const state = await store.finishAck(id, generation, previous,
      observed.acknowledged ? 'CONFIRMED' : 'NOT_ACKNOWLEDGED');
    if (state !== 'DUE') return { state };
  }

  const attemptId = await store.beginAck(id, generation);
  if (!attemptId) return { state: 'NO_ATTEMPT' };

  try {
    await publisher.acknowledge(sku, token);
  } catch (error) {
    const state = await store.finishAck(id, generation, attemptId, 'UNCERTAIN');
    // Preserve provider throttling for the scheduler without retaining errors.
    if (Number.isFinite(error?.retryAfterMs) && error.retryAfterMs >= 0) {
      return { state, retryAfterMs: error.retryAfterMs };
    }
    return { state };
  }
  return { state: await store.finishAck(id, generation, attemptId, 'CONFIRMED') };
}
