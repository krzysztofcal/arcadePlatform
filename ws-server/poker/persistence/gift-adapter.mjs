import { beginSqlWs } from '../bootstrap/persisted-bootstrap-db.mjs';
import { executePokerGiftPurchase, loadActiveGiftSummary } from '../../../shared/poker-domain/gift-purchase.mjs';

const REASONS = new Set(['gift_invalid', 'gift_target_unavailable', 'gift_rate_limited', 'gift_shop_unavailable',
  'gift_idempotency_conflict', 'gift_purchase_failed', 'not_seated', 'invalid_sender']);
export function createGiftAdapter({ env = process.env, beginSql = beginSqlWs, postTransactionFn = null, klog = () => {} } = {}) {
  const available = () => Boolean(String(env.SUPABASE_DB_URL || '').trim());
  return {
    async purchase(input) {
      if (!available()) return { ok: false, code: 'gift_shop_unavailable' };
      try {
        const post = postTransactionFn || (await import('../../../netlify/functions/_shared/chips-ledger.mjs')).postTransaction;
        return await executePokerGiftPurchase({ ...input, beginSql: (fn) => beginSql(fn, { env }), postTransaction: post });
      } catch (error) {
        const code = error?.code === 'insufficient_funds' || (error?.code === 'P0001' && error?.message === 'insufficient_funds')
          ? 'gift_insufficient_chips' : REASONS.has(error?.code) ? error.code
            : error?.code === '42P01' ? 'gift_shop_unavailable' : 'gift_purchase_failed';
        klog('ws_gift_purchase_rejected', { tableId: input.tableId, code });
        return { ok: false, code };
      }
    },
    async loadActiveGiftSummary(tableId) {
      if (!available()) return null;
      try { return await beginSql((tx) => loadActiveGiftSummary(tx, tableId), { env }); }
      catch { klog('ws_gift_state_unavailable', { tableId }); return null; }
    }
  };
}
