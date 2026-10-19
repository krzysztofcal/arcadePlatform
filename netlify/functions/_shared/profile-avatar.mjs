import { accountDeletionEnabled, assertAccountActive } from "../../../shared/account-deletion.mjs";
import crypto from "node:crypto";
import sharp from "sharp";
import { beginSql, executeSql } from "./supabase-admin.mjs";
import { ensureUserProfile, updateUserAvatarKey } from "./user-profile.mjs";

const UPLOAD_BUCKET = "profile-avatar-uploads";
const PUBLIC_BUCKET = "profile-avatars";
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_DIMENSION = 1024;
const PENDING_TTL_MS = 5 * 60 * 1000;
const CAPABILITY_MS = 2 * 60 * 60 * 1000;
// Tracking must be deployed before deletion acceptance; it is not activation.
function enabled(deps) {
  const env = deps.env || process.env;
  return env.ACCOUNT_DELETION_AVATAR_TRACKING_ENABLED === "1" || accountDeletionEnabled(env);
}
function capabilityGrace(deps) {
  const seconds = Number((deps.env || process.env).ACCOUNT_DELETION_AVATAR_GRACE_SECONDS);
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 86400) throw avatarError('avatar_tracking_unavailable', 503);
  return seconds * 1000;
}
async function activeTransaction(userId, deps, fn) {
  return (deps.beginSql || beginSql)(async (tx) => {
    await assertAccountActive(tx, userId);
    return fn(tx);
  });
}
async function finishSigning(userId, id, deps) {
  const grace = capabilityGrace(deps);
  const rows = await (deps.executeSql || executeSql)(`update public.profile_avatar_uploads
set signing_finished_at=clock_timestamp(), capability_until=clock_timestamp()+($3::bigint * interval '1 millisecond')
where id=$1 and user_id=$2 and signing_finished_at is null returning id;`, [id,userId,CAPABILITY_MS + grace]);
  if (rows?.length !== 1) throw avatarError('avatar_tracking_unavailable',503);
}
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const FORMAT_MIME = Object.freeze({ jpeg: "image/jpeg", png: "image/png", webp: "image/webp" });
const MIME_ALIASES = Object.freeze({ "image/jpg": "image/jpeg", "image/pjpeg": "image/jpeg", "image/x-png": "image/png" });

function avatarError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function storageConfig(env = process.env) {
  const baseUrl = String(env.SUPABASE_URL || env.SUPABASE_URL_V2 || "").replace(/\/$/, "");
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!/^https:\/\/[^/]+\.supabase\.co$/i.test(baseUrl) || !serviceKey) throw avatarError("storage_unavailable", 503);
  return { baseUrl, serviceKey };
}

function storagePath(bucket, path, mode = "authenticated") {
  const accessSegment = mode ? `/${mode}` : "";
  return `/storage/v1/object${accessSegment}/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function storageRequest(path, options = {}, deps = {}) {
  const config = deps.storageConfig || storageConfig(deps.env);
  const fetchImpl = deps.fetch || fetch;
  const headers = { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, ...(options.headers || {}) };
  const response = await fetchImpl(config.baseUrl + path, { ...options, headers, ...(enabled(deps) ? { signal: AbortSignal.timeout(30000) } : {}) });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    const error = avatarError("storage_error", response.status >= 500 ? 503 : 400);
    error.detail = message.slice(0, 200);
    throw error;
  }
  return { response, config };
}

function validateUploadRequest(payload) {
  const suppliedMime = typeof payload?.mimeType === "string" ? payload.mimeType.trim().toLowerCase() : "";
  const mimeType = MIME_ALIASES[suppliedMime] || suppliedMime;
  const size = Number(payload?.size);
  if (!ALLOWED_MIME.has(mimeType)) throw avatarError("unsupported_avatar_type");
  if (!Number.isInteger(size) || size < 1 || size > MAX_SOURCE_BYTES) throw avatarError("avatar_too_large");
  return { mimeType, size };
}

async function cleanupExpiredUploads(deps = {}) {
  // Tracking manifests survive finalize/expiry, including failed or uncertain I/O.
  // Account deletion does the final exact-path rescan after the capability horizon.
  if (enabled(deps)) return;
  const runSql = deps.executeSql || executeSql;
  const rows = await runSql(
    `select id::text, user_id::text, source_path
     from public.profile_avatar_uploads
     where expires_at <= timezone('utc', now())
     order by expires_at asc limit 10;`,
  );
  await Promise.allSettled((rows || []).map(async (row) => {
    await deleteStorageObject(UPLOAD_BUCKET, row.source_path, deps);
    await runSql(
      `delete from public.profile_avatar_uploads where id = $1 and user_id = $2 and source_path = $3;`,
      [row.id, row.user_id, row.source_path],
    );
  }));
}

async function createPendingUpload(userId, payload, deps = {}) {
  const { mimeType, size } = validateUploadRequest(payload);
  await (deps.ensureUserProfile || ensureUserProfile)(userId, deps);
  await cleanupExpiredUploads(deps).catch(() => {});
  const id = crypto.randomUUID();
  const sourcePath = `pending/${id}`;
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS).toISOString();
  const runSql = deps.executeSql || executeSql;
  if (enabled(deps)) {
    capabilityGrace(deps);
    await activeTransaction(userId, deps, (tx) => tx.unsafe(`insert into public.profile_avatar_uploads
      (id,user_id,source_path,declared_mime_type,declared_size,expires_at,tracking_version)
      values ($1,$2,$3,$4,$5,$6::timestamptz,3);`, [id,userId,sourcePath,mimeType,size,expiresAt]));
  } else await runSql(
    `insert into public.profile_avatar_uploads
       (id, user_id, source_path, declared_mime_type, declared_size, expires_at)
     values ($1, $2, $3, $4, $5, $6::timestamptz);`,
    [id, userId, sourcePath, mimeType, size, expiresAt],
  );
  const signPath = `/storage/v1/object/upload/sign/${encodeURIComponent(UPLOAD_BUCKET)}/${sourcePath.split("/").map(encodeURIComponent).join("/")}`;
  try {
    const { response, config } = await storageRequest(signPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ upsert: false }),
    }, deps);
    const body = await response.json();
    const relative = body.url || body.signedURL || body.signedUrl;
    if (typeof relative !== "string" || !relative) throw avatarError("storage_error", 503);
    const uploadUrl = relative.startsWith("http")
      ? relative
      : relative.startsWith("/storage/v1/")
        ? config.baseUrl + relative
        : `${config.baseUrl}/storage/v1${relative.startsWith("/") ? relative : `/${relative}`}`;
    if (enabled(deps)) {
      await finishSigning(userId, id, deps);
      await activeTransaction(userId, deps, async () => {});
    }
    return {
      uploadId: id,
      uploadUrl,
      token: typeof body.token === "string" ? body.token : null,
      expiresAt,
    };
  } catch (error) {
    if (!enabled(deps)) await runSql(`delete from public.profile_avatar_uploads where id = $1 and user_id = $2;`, [id, userId]).catch(() => {});
    throw error;
  }
}

async function consumePendingUpload(userId, uploadId, deps = {}) {
  const outputPath = `${crypto.randomUUID()}.webp`;
  if (!/^[0-9a-f-]{36}$/i.test(String(uploadId || ""))) throw avatarError("invalid_upload");
  const runSql = deps.executeSql || executeSql;
  const consume = (sql) => sql(
    `update public.profile_avatar_uploads
     set consumed_at = timezone('utc', now())${enabled(deps) ? ', output_path=$3, output_write_started_at=clock_timestamp()' : ''}
     where id = $1 and user_id = $2 and consumed_at is null and expires_at > timezone('utc', now())${enabled(deps) ? ' and tracking_version=3' : ''}
     returning id::text, source_path, declared_mime_type, declared_size, output_path;`,
    enabled(deps) ? [uploadId, userId, outputPath] : [uploadId, userId],
  );
  const rows = enabled(deps)
    ? await activeTransaction(userId, deps, (tx) => consume((q,p) => tx.unsafe(q,p)))
    : await consume(runSql);
  if (!rows?.[0]) throw avatarError("upload_expired", 404);
  return rows[0];
}

async function deleteStorageObject(bucket, path, deps = {}) {
  if (!path) return;
  await storageRequest(`/storage/v1/object/${encodeURIComponent(bucket)}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prefixes: [path] }),
  }, deps);
}

async function finalizeAvatar(userId, uploadId, deps = {}) {
  const pending = await consumePendingUpload(userId, uploadId, deps);
  const runSql = deps.executeSql || executeSql;
  let newAvatarKey = null;
  let profileUpdated = false;
  let outputWriteConfirmed = false;
  let outputAttempted = false;
  try {
    const { response } = await storageRequest(storagePath(UPLOAD_BUCKET, pending.source_path), { method: "GET" }, deps);
    const source = Buffer.from(await response.arrayBuffer());
    if (!source.length || source.length > MAX_SOURCE_BYTES || source.length > Number(pending.declared_size)) {
      throw avatarError("invalid_avatar_file");
    }
    const image = (deps.sharp || sharp)(source, { failOn: "error", limitInputPixels: MAX_DIMENSION * MAX_DIMENSION });
    const metadata = await image.metadata();
    const actualMime = FORMAT_MIME[metadata.format];
    if (!actualMime || !ALLOWED_MIME.has(actualMime)) throw avatarError("invalid_avatar_file");
    if (!metadata.width || !metadata.height || metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
      throw avatarError("avatar_dimensions_too_large");
    }
    const processed = await image.rotate().resize(256, 256, { fit: "cover", position: "centre" }).webp({ quality: 82 }).toBuffer();
    newAvatarKey = enabled(deps) ? pending.output_path : `${crypto.randomUUID()}.webp`;
    outputAttempted = true;
    await storageRequest(storagePath(PUBLIC_BUCKET, newAvatarKey, null), {
      method: "POST",
      headers: { "content-type": "image/webp", "cache-control": "31536000", "x-upsert": "false" },
      body: processed,
    }, deps);
    outputWriteConfirmed = true;
    const { profile, previousAvatarKey } = await (deps.updateUserAvatarKey || updateUserAvatarKey)(userId, newAvatarKey, deps);
    profileUpdated = true;
    if (previousAvatarKey) await deleteStorageObject(PUBLIC_BUCKET, previousAvatarKey, deps).catch(() => {});
    return profile;
  } catch (error) {
    if (newAvatarKey && !profileUpdated) await deleteStorageObject(PUBLIC_BUCKET, newAvatarKey, deps).catch(() => {});
    throw error;
  } finally {
    // A confirmed POST or an attempt never made is terminal. A lost POST
    // response remains uncertain even if compensating deletion appeared to work.
    if (enabled(deps) && (outputWriteConfirmed || !outputAttempted)) {
      const rows = await runSql(`update public.profile_avatar_uploads
set output_write_finished_at=clock_timestamp() where id=$1 and user_id=$2 and output_write_started_at is not null
and output_write_finished_at is null returning id;`, [uploadId,userId]);
      if (rows?.length !== 1) throw avatarError('avatar_tracking_unavailable',503);
    }
    try {
      await deleteStorageObject(UPLOAD_BUCKET, pending.source_path, deps);
      if (!enabled(deps)) await runSql(`delete from public.profile_avatar_uploads where id = $1 and user_id = $2;`, [uploadId, userId]);
    } catch {}
  }
}

async function removeAvatar(userId, deps = {}) {
  const { profile, previousAvatarKey } = await (deps.updateUserAvatarKey || updateUserAvatarKey)(userId, null, deps);
  if (previousAvatarKey) await deleteStorageObject(PUBLIC_BUCKET, previousAvatarKey, deps).catch(() => {});
  return profile;
}

export {
  MAX_SOURCE_BYTES,
  cleanupExpiredUploads,
  createPendingUpload,
  finalizeAvatar,
  removeAvatar,
  validateUploadRequest,
};
