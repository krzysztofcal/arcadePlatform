import { createHash, timingSafeEqual } from 'node:crypto';
import postgres from 'postgres';
import {
  BUILD_DEPLOY_CONTEXT, BUILD_DEPLOY_ID, BUILD_IMMUTABLE_ORIGIN, BUILD_SOURCE_SHA
} from './_generated/deploy-context.mjs';
import { playSupportStageConnection } from './_shared/play-support-db.mjs';

const SITE_ID = 'f7e19a84-28f7-41f7-978a-f3b4552a404d';
const PATH = '/.netlify/functions/play-support-db-proof';
const PUBLIC_RESPONSE = { 'cache-control': 'no-store' };

export function createStageDbProof(build, env, connect = postgres) {
  let sql;
  return async (request, context) => {
    const refuse = status => new Response(null, { status, headers: PUBLIC_RESPONSE });
    const target = new URL(request.url);
    const digest = env.PLAY_SUPPORT_STAGE_PROBE_TOKEN_SHA256;
    if (build.context !== 'deploy-preview' || context?.deploy?.context !== 'deploy-preview' ||
        context?.site?.id !== SITE_ID || typeof build.deployId !== 'string' || !build.deployId ||
        context.deploy.id !== build.deployId || !/^[a-f0-9]{40}$/.test(build.sha ?? '') ||
        env.PLAY_SUPPORT_STAGE_PROBE_SOURCE_SHA !== build.sha ||
        target.protocol !== 'https:' || target.origin !== build.origin || target.pathname !== PATH ||
        target.search || !/^[a-f0-9]{64}$/.test(digest ?? '')) return refuse(404);

    if (request.method !== 'POST') return refuse(405);
    const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token || !timingSafeEqual(createHash('sha256').update(token).digest(), Buffer.from(digest, 'hex'))) {
      return refuse(401);
    }

    try {
      sql ??= connect(playSupportStageConnection(env.PLAY_SUPPORT_DB_URL, env.PLAY_SUPPORT_DB_CA));
      const ok = await sql.begin('read only', async tx => {
        await tx`set local statement_timeout = '3s'`;
        const [proof] = await tx`
          select current_user = 'play_support_writer' and session_user = 'play_support_writer'
            and current_database() = 'postgres' and current_setting('transaction_read_only') = 'on'
            and not (r.rolsuper or r.rolbypassrls)
            and not has_schema_privilege(current_user, 'private', 'USAGE,CREATE')
            and not has_schema_privilege(current_user, 'auth', 'USAGE,CREATE')
            and not arcade_play_api.play_support_inbox_is_complete(
              'pl.kcswh.arcadepoker.stage', decode(repeat('00', 32), 'hex'), 'fixture-netlify-db-proof'
            ) as ok
          from pg_catalog.pg_roles r where r.rolname = current_user
        `;
        return proof?.ok === true;
      });
      if (ok) return Response.json({ verified: true, role: 'play_support_writer' }, { headers: PUBLIC_RESPONSE });
    } catch {
      // Keep connection details, permissions errors and provider responses private.
    }
    return refuse(503);
  };
}

export default createStageDbProof({
  context: BUILD_DEPLOY_CONTEXT, deployId: BUILD_DEPLOY_ID, origin: BUILD_IMMUTABLE_ORIGIN, sha: BUILD_SOURCE_SHA
}, process.env);
