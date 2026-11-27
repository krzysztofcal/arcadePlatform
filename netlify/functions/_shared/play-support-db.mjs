import { X509Certificate } from 'node:crypto';

const STAGE_PROJECT = 'krydukthwdvccggbyjfw';
const STAGE_DIRECT = `db.${STAGE_PROJECT}.supabase.co`;
const STAGE_POOLER = 'aws-0-eu-west-3.pooler.supabase.com';
const STAGE_WRITER = 'play_support_writer';

// Pass explicit options to postgres.js. URI options cannot override TLS,
// database, role or pool limits.
export function playSupportStageConnection(value, ca) {
  try {
    if (typeof value !== 'string' || /[?#]/.test(value) || typeof ca !== 'string' ||
        !new X509Certificate(ca).ca) throw new Error();
    const url = new URL(value);
    const username = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const direct = url.hostname === STAGE_DIRECT && (!url.port || url.port === '5432') &&
      username === STAGE_WRITER;
    const pooled = url.hostname === STAGE_POOLER && url.port === '6543' &&
      username === `${STAGE_WRITER}.${STAGE_PROJECT}`;
    if (!['postgresql:', 'postgres:'].includes(url.protocol) || url.pathname !== '/postgres' ||
        !password || password.includes('\u0000') || (!direct && !pooled)) {
      throw new Error();
    }

    return {
      host: url.hostname, port: pooled ? 6543 : 5432, username, database: 'postgres', password,
      ssl: { ca, rejectUnauthorized: true }, max: 1, prepare: false, idle_timeout: 20, connect_timeout: 5
    };
  } catch {
    throw new Error('play_support_stage_db_config');
  }
}
