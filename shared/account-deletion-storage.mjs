// Storage deletion adapter shared by Netlify and WS. No image or DB-driver imports.
function unavailable() { return Object.assign(new Error('dependency_unavailable'), { code: 'dependency_unavailable' }); }
const UPLOAD = 'profile-avatar-uploads';
const OUTPUT = 'profile-avatars';
const SOURCE = /^pending\/[0-9a-f-]{36}$/i;
const AVATAR = /^[0-9a-f-]{36}\.webp$/i;

export async function cleanupDeletionAvatars({ userId, requestId, beginSql, assertLease, env = process.env, fetch: fetchImpl = globalThis.fetch }) {
  const marker = env.ACCOUNT_DELETION_AVATAR_TRACKING_MARKER;
  const grace = Number(env.ACCOUNT_DELETION_AVATAR_GRACE_SECONDS);
  const base = String(env.SUPABASE_URL || env.SUPABASE_URL_V2 || '').replace(/\/$/,'');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (env.ACCOUNT_DELETION_ENABLED !== '1' || !marker || !Number.isSafeInteger(grace) || grace < 60 || grace > 86400
    || !/^https:\/\/[^/]+\.supabase\.co$/i.test(base) || !key || !assertLease || !beginSql) throw unavailable();
  const snapshot = () => beginSql(async (tx) => {
    await assertLease(tx);
    const [cutover] = await tx.unsafe(`select *, clock_timestamp() as server_now,
cutover_at + (($2::bigint + 7200) * interval '1 second') as safe_after
from private.avatar_tracking_cutover where marker=$1;`, [marker,grace]);
    if (!cutover?.legacy_inventory_verified || cutover.upload_bucket !== UPLOAD || cutover.public_bucket !== OUTPUT) throw unavailable();
    const [safety] = await tx.unsafe(`select count(*) filter (where tracking_version is distinct from 2
or signing_finished_at is null or capability_until is null
or (output_write_started_at is not null and output_write_finished_at is null))::int as uncertain,
max(capability_until) as capability_until from public.profile_avatar_uploads where user_id=$1;`, [userId]);
    if (Number(safety?.uncertain || 0)) throw unavailable();
    const wait = Math.max(Date.parse(cutover.safe_after), safety?.capability_until ? Date.parse(safety.capability_until) : 0);
    if (!Number.isFinite(wait)) throw unavailable();
    if (wait > Date.parse(cutover.server_now)) return { waitUntil: new Date(wait).toISOString() };
    // Preserve current selected key before a later profile/Auth cascade. Never list
    // or sweep either bucket; historical orphan ownership needs operator evidence.
    await tx.unsafe(`insert into private.account_avatar_objects(user_id,output_path)
select user_id,avatar_key from public.user_profiles where user_id=$1 and avatar_key is not null
on conflict(user_id,output_path) do nothing;`, [userId]);
    const rows = await tx.unsafe(`select id,source_path,output_path,source_deleted_at,output_deleted_at
from public.profile_avatar_uploads where user_id=$1 and (source_deleted_at is null or (output_path is not null and output_deleted_at is null))
order by id limit 5;`, [userId]);
    const objects = await tx.unsafe(`select output_path from private.account_avatar_objects where user_id=$1 and deleted_at is null order by output_path limit 5;`, [userId]);
    return { rows, objects };
  });
  const current = await snapshot();
  if (current.waitUntil) return current;
  const remove = async (bucket,path) => {
    if (!(bucket === UPLOAD ? SOURCE : AVATAR).test(path || '')) throw unavailable();
    const response = await fetchImpl(`${base}/storage/v1/object/${bucket}`, { method: 'DELETE',
      headers: { apikey:key, Authorization:`Bearer ${key}`, 'content-type':'application/json' },
      body: JSON.stringify({ prefixes:[path] }), signal:AbortSignal.timeout(15000) });
    if (!response.ok) throw unavailable();
  };
  // Bounded batch: persisted deletion receipts let the next worker invocation resume.
  await Promise.all([
    ...current.rows.map(async (row) => {
      await Promise.all([
        !row.source_deleted_at ? remove(UPLOAD,row.source_path) : undefined,
        row.output_path && !row.output_deleted_at ? remove(OUTPUT,row.output_path) : undefined,
      ]);
      await beginSql(async (tx) => {
        await assertLease(tx);
        await tx.unsafe(`update public.profile_avatar_uploads set source_deleted_at=clock_timestamp(),
output_deleted_at=case when output_path is not null then clock_timestamp() else null end where id=$1 and user_id=$2;`, [row.id,userId]);
      });
    }),
    ...current.objects.map(async (row) => {
      await remove(OUTPUT,row.output_path);
      await beginSql(async (tx) => {
        await assertLease(tx);
        await tx.unsafe('update private.account_avatar_objects set deleted_at=clock_timestamp() where user_id=$1 and output_path=$2;', [userId,row.output_path]);
      });
    }),
  ]);
  const final = await snapshot();
  if (final.waitUntil) return final;
  if (final.rows.length || final.objects.length) return { waitUntil: new Date(Date.now()+1000).toISOString() };
  // Retain manifests until owner's subsequent durable SQL cleanup/Auth cascade.
  // requestId stays in the caller's durable job; no client-controlled cleanup API.
  return { done:true };
}
