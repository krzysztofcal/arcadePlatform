import { createHmac } from 'node:crypto';

const enabled = (env = process.env) => env.ACCOUNT_DELETION_ENABLED === '1';

function rewardKeyConfig(env = process.env) {
  const key = env.ACCOUNT_DELETION_REWARD_HMAC_KEY;
  const version = env.ACCOUNT_DELETION_REWARD_HMAC_VERSION;
  if (typeof key !== 'string' || Buffer.byteLength(key) < 32 || !/^[a-zA-Z0-9_-]{1,32}$/.test(version || '')) {
    throw Object.assign(new Error('reward_identity_unavailable'), { code: 'reward_identity_unavailable', status: 503 });
  }
  return { key, version };
}

// Fixed domain-separated key check contains no email and does not expose the key.
function rewardKeyCheck(env = process.env) {
  const { key } = rewardKeyConfig(env);
  return createHmac('sha256', key).update('arcade:reward-key-check:v1').digest('hex');
}

function rewardIdentityFromUser(user, env = process.env) {
  const { key, version } = rewardKeyConfig(env);
  if (!user?.email_confirmed_at || user.is_anonymous !== false || typeof user.email !== 'string' || !user.email.trim()) {
    throw Object.assign(new Error('verified_email_required'), { code: 'verified_email_required', status: 403 });
  }
  // Match Auth email case normalization; do not strip aliases or provider-specific dots.
  const email = user.email.trim().toLowerCase();
  return `${version}:${createHmac('sha256', key).update('arcade:reward-email:v1\0').update(email).digest('hex')}`;
}

async function resolveRewardIdentity(userId, runSql, env, lock = false) {
  const { version } = rewardKeyConfig(env);
  const keyCheck = rewardKeyCheck(env);
  // Keep approval stable throughout the caller's payout transaction. A deployment
  // changing either secret or version cannot silently start an empty namespace.
  const [approval] = await runSql(`select active_version, key_check, history_ready
from private.account_reward_config where id=true for share;`, []);
  if (approval?.history_ready !== true || approval.active_version !== version || approval.key_check !== keyCheck) {
    throw Object.assign(new Error('reward_identity_unavailable'), { code: 'reward_identity_unavailable', status: 503 });
  }
  const rows = await runSql(`select email, email_confirmed_at, is_anonymous from auth.users where id = $1${lock ? ' for update' : ''};`, [userId]);
  return rewardIdentityFromUser(rows?.[0], env);
}

async function lockRewardIdentity(identity, runSql) {
  await runSql('insert into private.account_reward_identities (identity_key) values ($1) on conflict do nothing;', [identity]);
  await runSql('select identity_key from private.account_reward_identities where identity_key = $1 for update;', [identity]);
}

async function rewardPaidCount(identity, scope, period, runSql) {
  const rows = await runSql(`select count(*)::integer as paid_count from private.account_reward_payouts
where identity_key = $1 and reward_scope = $2 and ($3::text is null or period_key = $3);`, [identity, scope, period]);
  return Number(rows?.[0]?.paid_count || 0);
}

async function recordRewardPayout(identity, scope, period, transactionId, runSql) {
  // No conflict suppression: proof failure must roll back the ledger and bonus_claims too.
  const rows = await runSql(`insert into private.account_reward_payouts (identity_key, reward_scope, period_key, transaction_id)
values ($1, $2, $3, $4) returning transaction_id;`, [identity, scope, period, transactionId]);
  if (rows?.[0]?.transaction_id !== transactionId) throw new Error('reward_proof_write_failed');
}

export { enabled as rewardProtectionEnabled, rewardIdentityFromUser, rewardKeyCheck, resolveRewardIdentity, lockRewardIdentity, rewardPaidCount, recordRewardPayout };
