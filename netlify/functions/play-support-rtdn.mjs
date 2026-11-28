import postgres from 'postgres';
import {
  BUILD_DEPLOY_CONTEXT, BUILD_DEPLOY_ID, BUILD_IMMUTABLE_ORIGIN, BUILD_SOURCE_SHA
} from './_generated/deploy-context.mjs';
import { playSupportStageConnection } from './_shared/play-support-db.mjs';
import { createPlaySupportPublisher } from './_shared/play-support-publisher.mjs';
import { createPlaySupportPushVerifier } from './_shared/play-support-rtdn-auth.mjs';
import { createPlaySupportRtdnRuntime } from './_shared/play-support-rtdn-runtime.mjs';
import { createPlaySupportTokenCodec } from './_shared/play-support-token.mjs';
import { createPlaySupportWorkStore } from './_shared/play-support-work-store.mjs';

const SITE_ID = 'f7e19a84-28f7-41f7-978a-f3b4552a404d';
const STAGE = { environment: 'stage', packageName: 'pl.kcswh.arcadepoker.stage' };
const PATH = '/.netlify/functions/play-support-rtdn';

export function createStageRtdnEntry(build, env, connect = postgres) {
  let handler;
  return async (request, context) => {
    const target = new URL(request.url);
    if (build.context !== 'deploy-preview' || context?.deploy?.context !== 'deploy-preview' ||
        context?.site?.id !== SITE_ID || typeof build.deployId !== 'string' || !build.deployId ||
        context.deploy.id !== build.deployId || !/^[a-f0-9]{40}$/.test(build.sha ?? '') ||
        env.PLAY_SUPPORT_STAGE_SOURCE_SHA !== build.sha ||
        target.protocol !== 'https:' || target.origin !== build.origin || target.pathname !== PATH) {
      return new Response(null, { status: 404 });
    }
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    try {
      if (!handler) {
        const connection = playSupportStageConnection(env.PLAY_SUPPORT_DB_URL, env.PLAY_SUPPORT_DB_CA);
        const credentials = JSON.parse(env.PLAY_SUPPORT_PUBLISHER_CREDENTIALS);
        const keyring = JSON.parse(env.PLAY_SUPPORT_TOKEN_KEYRING);
        const codec = createPlaySupportTokenCodec({
          activeVersion: keyring.activeVersion,
          keys: new Map(Object.entries(keyring.keys).map(([version, key]) => [Number(version), Buffer.from(key, 'base64')]))
        });
        const publisher = createPlaySupportPublisher({ ...STAGE, credentials });
        const verifyAuthorization = createPlaySupportPushVerifier({
          audience: build.origin + PATH, serviceAccountEmail: env.PLAY_SUPPORT_PUSH_SERVICE_ACCOUNT
        });
        let sql;
        const store = createPlaySupportWorkStore(fn => {
          sql ??= connect(connection);
          return sql.begin(fn);
        });
        handler = createPlaySupportRtdnRuntime({
          ...STAGE, subscription: env.PLAY_SUPPORT_PUSH_SUBSCRIPTION, verifyAuthorization, codec, store, publisher
        });
      }
      return await handler(request);
    } catch {
      return new Response(null, { status: 503 });
    }
  };
}

export default createStageRtdnEntry({
  context: BUILD_DEPLOY_CONTEXT, deployId: BUILD_DEPLOY_ID, origin: BUILD_IMMUTABLE_ORIGIN, sha: BUILD_SOURCE_SHA
}, process.env);
