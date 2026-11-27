import { createPlaySupportAckStore } from './play-support-ack-worker.mjs';

export function createPlaySupportWorkStore(beginSupportSql) {
  const query = (statement, args) => beginSupportSql(async tx => {
    const [row] = await tx.unsafe(statement, args);
    return row;
  });
  return {
    ...createPlaySupportAckStore(beginSupportSql),

    async enqueue(packageName, tokenHash, envelope, { messageId = null, eventAt = null } = {}) {
      const row = await query(
        'select arcade_play_api.play_support_enqueue_inbox($1,$2,$3,$4,$5,$6,$7,$8) as result',
        [packageName, tokenHash, envelope.keyVersion, envelope.nonce, envelope.ciphertext, envelope.tag, messageId, eventAt]
      );
      return row?.result === true;
    },

    async claim(packageName, tokenHash) {
      const row = await query('select * from arcade_play_api.play_support_claim_inbox($1,$2)', [packageName, tokenHash]);
      if (!row?.token_hash) return null;
      return {
        packageName,
        tokenHash: row.token_hash,
        generation: row.generation,
        failureCount: Number(row.failure_count),
        envelope: {
          keyVersion: row.token_key_version, nonce: row.token_nonce,
          ciphertext: row.token_ciphertext, tag: row.token_tag
        }
      };
    },

    async applyPurchase(purchase) {
      const row = await query('select * from arcade_play_api.play_support_apply_purchase($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
        purchase.packageName, purchase.tokenHash, purchase.generation, purchase.accountBinding,
        purchase.sku, purchase.state, purchase.isTest, purchase.orderId, purchase.completedAt, purchase.acknowledged
      ]);
      if (typeof row?.outcome !== 'string') throw new Error('play_support_purchase_result_missing');
      return { outcome: row.outcome, receiptId: row.receipt_id };
    },

    async complete(receiptId, generation) {
      const row = await query('select arcade_play_api.play_support_complete_inbox($1,$2) as result', [receiptId, generation]);
      return row?.result === true;
    },

    async isComplete(packageName, tokenHash, messageId) {
      const row = await query('select arcade_play_api.play_support_inbox_is_complete($1,$2,$3) as result',
        [packageName, tokenHash, messageId]);
      return row?.result === true;
    },

    async reschedule(claim, nextCheckAt, failed) {
      const row = await query('select arcade_play_api.play_support_reschedule_inbox($1,$2,$3,$4,$5) as result',
        [claim.packageName, claim.tokenHash, claim.generation, nextCheckAt, failed]);
      return row?.result === true;
    }
  };
}
