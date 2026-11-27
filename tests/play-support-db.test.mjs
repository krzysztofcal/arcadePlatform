import test from 'node:test';
import { rootCertificates } from 'node:tls';
import assert from 'node:assert/strict';
import { playSupportStageConnection } from '../netlify/functions/_shared/play-support-db.mjs';

const ca = rootCertificates[0];
const ref = 'krydukthwdvccggbyjfw';
const role = 'play_support_writer';
const direct = `postgresql://${role}:fake%40secret@db.${ref}.supabase.co:5432/postgres`;
const pooler = `postgresql://${role}.${ref}:fake%40secret@aws-0-eu-west-3.pooler.supabase.com:6543/postgres`;

test('only the dedicated Stage writer can use the direct or transaction pooler address', () => {
  assert.deepEqual(playSupportStageConnection(direct, ca), {
    host: `db.${ref}.supabase.co`, port: 5432, username: role,
    database: 'postgres', password: 'fake@secret',
    ssl: { ca, rejectUnauthorized: true }, max: 1, prepare: false, idle_timeout: 20, connect_timeout: 5
  });
  const pooled = playSupportStageConnection(pooler, ca);
  assert.equal(pooled.port, 6543);
  assert.equal(pooled.username, `${role}.${ref}`);
});

test('rejects the privileged fallback, wrong project and URL-level connection overrides', () => {
  for (const url of [
    '', direct.replace(role, 'postgres'), pooler.replace(role, 'postgres'),
    direct.replace(ref, 'otbqfijerkieoxwpxjnm'), pooler.replace(ref, 'otbqfijerkieoxwpxjnm'),
    pooler.replace('aws-0-eu-west-3.pooler.supabase.com', 'unapproved.pooler.supabase.com'),
    pooler.replace('6543', '5432'),
    direct + '?sslmode=disable', direct + '#override', direct + '?', direct + '#', direct.replace('/postgres', '/otherdb')
  ]) {
    assert.throws(() => playSupportStageConnection(url, ca), { message: 'play_support_stage_db_config' });
  }
});

test('requires a configured CA for certificate and hostname verification', () => {
  for (const invalidCa of [undefined, '', 'invalid certificate']) {
    assert.throws(() => playSupportStageConnection(direct, invalidCa), { message: 'play_support_stage_db_config' });
  }
});
