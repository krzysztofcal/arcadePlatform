import crypto from "node:crypto";
import { atomicRateLimitIncr, xpStoreUnavailableResponse } from "./_shared/store-upstash.mjs";
import { baseHeaders, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { googlePhotoEnabled, googlePhotoStatus, importGooglePhoto, withdrawGooglePhoto, selectGooglePhoto, ownerGooglePhotoPreview } from "./_shared/profile-google-photo.mjs";

// #1140 UGC phase D, signed-in accounts only, 404 unless GOOGLE_PHOTO_IMPORT_ENABLED=1:
// GET -> { noticeVersion, googleLinked, consent, photoInUse }
// POST { action: "import", consent: true, noticeVersion, providerToken } (at most 5 imports per account and hour)
// POST { action: "select", expectedRevision } reuses the owned consented copy; no Google proof/download.
// POST { action: "withdraw" }
// The request body carries a Google provider token: it is never logged.
const IMPORT_LIMIT_PER_HOUR = 5;
const MAX_BODY = 8192;

function json(statusCode, headers, body) {
  return { statusCode, headers: { ...headers, "cache-control": "no-store" }, body: JSON.stringify(body) };
}

async function allowImport(userId) {
  const hash = crypto.createHash("sha256").update(`photo:${userId}`).digest("hex").slice(0, 32);
  const { count } = await atomicRateLimitIncr(`kcswh:profile:google-photo:${hash}:${Math.floor(Date.now() / 3600000)}`, 3600);
  return count <= IMPORT_LIMIT_PER_HOUR;
}

function createProfileGooglePhotoHandler(deps = {}) {
  const env = deps.env || process.env;
  const verifyJwt = deps.verifySupabaseJwt || verifySupabaseJwt;
  const status = deps.googlePhotoStatus || googlePhotoStatus;
  const importPhoto = deps.importGooglePhoto || importGooglePhoto;
  const withdraw = deps.withdrawGooglePhoto || withdrawGooglePhoto;
  const selectPhoto = deps.selectGooglePhoto || selectGooglePhoto;
  const preview = deps.ownerGooglePhotoPreview || ownerGooglePhotoPreview;
  const allow = deps.allowImport || allowImport;
  const storeUnavailable = deps.xpStoreUnavailableResponse || xpStoreUnavailableResponse;
  return async function handler(event) {
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = corsHeaders(origin, { methods: "GET, POST, OPTIONS" });
    if (!cors) return json(403, baseHeaders(), { error: "forbidden_origin" });
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return json(405, cors, { error: "method_not_allowed" });
    const auth = await verifyJwt(extractBearerToken(event.headers));
    if (!auth?.valid || !auth.userId) return json(401, cors, { error: "unauthorized" });
    const importEnabled = googlePhotoEnabled(env);
    try {
      if (event.httpMethod === "GET") {
        // Disabling new imports must not hide an existing user's withdrawal controls.
        let current;
        try { current = await status(auth.userId); }
        catch (error) { if (!importEnabled && error?.code === '42P01') return json(404, cors, {error:'not_found'}); throw error; }
        if (!importEnabled && !current.consent && !current.copyStored) return json(404, cors, {error:'not_found'});
        let ownPreview = {};
        if (importEnabled && current.consent?.decision === 'granted' && current.copyStored) {
          try { ownPreview = await preview(auth.userId); } catch { /* Status/withdrawal remain available; no preview on uncertain eligibility. */ }
        }
        return json(200, cors, {...current, ...ownPreview, photoInUse: importEnabled && (ownPreview.photoInUse ?? current.photoInUse) === true, importEnabled});
      }
      if (typeof event.body === "string" && event.body.length > MAX_BODY) return json(413, cors, { error: "invalid_request" });
      let body;
      try {
        body = JSON.parse(event.body || "null");
      } catch {
        return json(400, cors, { error: "invalid_json" });
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, cors, { error: "invalid_request" });
      if (body.action === "withdraw") {
        if (Object.keys(body).length !== 1) return json(400, cors, { error: "invalid_request" });
        const result = await withdraw(auth.userId);
        klog("google_photo_withdrawn", {});
        return json(200, cors, {...result,importEnabled});
      }
      if (!importEnabled) return json(404, cors, { error: "not_found" });
      if (body.action === "select") {
        const result = await selectPhoto(auth.userId, body);
        klog('google_photo_selected', {});
        return json(200, cors, {...result, importEnabled});
      }
      if (body.action !== "import") return json(400, cors, { error: "invalid_request" });
      const unavailable = storeUnavailable(cors);
      if (unavailable) return unavailable;
      let allowed;
      try {
        allowed = await allow(auth.userId);
      } catch (error) {
        klog("google_photo_rate_limit_failed", { code: error?.code || "rate_limit_unavailable" });
        return json(503, cors, { error: "rate_limit_unavailable" });
      }
      if (!allowed) return json(429, cors, { error: "rate_limit_exceeded" });
      const result = await importPhoto(auth.userId, body);
      klog("google_photo_imported", {});
      return json(200, cors, {...result,importEnabled});
    } catch (error) {
      if (error?.code==='account_not_active') return json(409,cors,{error:'account_not_active'});
      if (error?.status && error.status < 500) return json(error.status, cors, { error: error.code });
      klog("google_photo_failed", { code: error?.status === 503 ? error.code : "server_error" });
      return json(error?.status === 503 ? 503 : 500, cors, { error: error?.status === 503 ? error.code : "server_error" });
    }
  };
}

const handler = createProfileGooglePhotoHandler();

export { createProfileGooglePhotoHandler, handler };
