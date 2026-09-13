const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const SYSTEM_IDENTIFIER_RE = /^[0-9]+$/;
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/i;

export const RETENTION_TARGETS = Object.freeze({
  stage: Object.freeze({
    target: "stage",
    label: "Stage",
    projectRef: "krydukthwdvccggbyjfw",
    systemIdentifier: "7656985631720456337",
    dbEnv: "SUPABASE_STAGE_DB_URL",
    urlEnv: "SUPABASE_STAGE_URL",
    serviceRoleEnv: "SUPABASE_STAGE_SERVICE_ROLE_KEY",
    expectedRefEnv: "EXPECTED_SUPABASE_STAGE_PROJECT_REF",
    automationEnv: "CHIPS_LEDGER_STAGE_AUTOMATION_ENABLED",
    lockKey: "chips-ledger-stage-automation-v1:krydukthwdvccggbyjfw",
    maxBatchSize: 5000,
    maxCanaryBatchSize: 5000,
    maxEscrowAccounts: 20,
    policies: Object.freeze({
      existing30d: "stage-ledger-auto-retention-30d-v1",
      botOnly7d: "stage-ledger-bot-only-retention-7d-v1",
      closedHuman30d: "stage-ledger-closed-human-table-retention-30d-v1",
      escrow: "stage-ledger-escrow-account-retention-v1",
    }),
  }),
  production: Object.freeze({
    target: "production",
    label: "Production",
    projectRef: "otbqfijerkieoxwpxjnm",
    systemIdentifier: "7575202818581710058",
    dbEnv: "SUPABASE_PROD_DB_URL",
    urlEnv: "SUPABASE_PROD_URL",
    serviceRoleEnv: "SUPABASE_PROD_SERVICE_ROLE_KEY",
    expectedRefEnv: "EXPECTED_SUPABASE_PROD_PROJECT_REF",
    automationEnv: "CHIPS_LEDGER_PRODUCTION_AUTOMATION_ENABLED",
    lockKey: "chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm",
    maxBatchSize: 2,
    maxCanaryBatchSize: 2,
    maxEscrowAccounts: 2,
    policies: Object.freeze({
      existing30d: "production-ledger-auto-retention-30d-v1",
      botOnly7d: "production-ledger-bot-only-retention-7d-v1",
      closedHuman30d: "production-ledger-closed-human-table-retention-30d-v1",
      escrow: "production-ledger-escrow-account-retention-v1",
    }),
  }),
});

export const PRODUCTION_PROJECT_REF = RETENTION_TARGETS.production.projectRef;
export const PRODUCTION_SYSTEM_IDENTIFIER = RETENTION_TARGETS.production.systemIdentifier;
export const PRODUCTION_LOCK_KEY = RETENTION_TARGETS.production.lockKey;
export const PRODUCTION_AUTOMATION_ENV = RETENTION_TARGETS.production.automationEnv;

const TARGET_ALIASES = Object.freeze({
  stage: "stage",
  prod: "production",
  production: "production",
});

function text(value) {
  return value == null ? "" : String(value).trim();
}
function fail(message) {
  throw new Error(message);
}

function projectRefFromUrl(rawUrl, label) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail(`${label} must be a valid URL`);
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    fail(`${label} must be an HTTPS origin`);
  }
  const match = /^([a-z0-9]{20})\.supabase\.co$/i.exec(url.hostname);
  if (!match) fail(`${label} must expose a supported Supabase project ref`);
  return match[1].toLowerCase();
}

function projectRefFromDbUrl(rawUrl, label) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail(`${label} must be a valid PostgreSQL URL`);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) fail(`${label} must be a PostgreSQL URL`);
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/i.exec(url.hostname);
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/i.test(url.hostname);
  const user = /^postgres\.([a-z0-9]{20})$/i.exec(decodeURIComponent(url.username || ""));
  const ref = direct?.[1] || (pooler ? user?.[1] : null);
  if (!ref) fail(`${label} does not expose a supported Supabase project ref`);
  if (url.port === "6543") fail(`${label} must use a session PostgreSQL connection, not the transaction pooler`);
  return ref.toLowerCase();
}

function normalizeTarget(target) {
  const key = TARGET_ALIASES[text(target).toLowerCase()];
  if (!key) fail("retention target must be exactly stage or production");
  return RETENTION_TARGETS[key];
}

export function resolveRetentionProfile(target, env = process.env, { requireCommitSha = false } = {}) {
  const profile = normalizeTarget(target);
  const expectedRef = text(env[profile.expectedRefEnv]).toLowerCase();
  if (!PROJECT_REF_RE.test(expectedRef) || expectedRef !== profile.projectRef) {
    fail(`${profile.expectedRefEnv} must equal the canonical ${profile.label} project ref`);
  }

  const dbUrl = text(env[profile.dbEnv]);
  const apiUrl = text(env[profile.urlEnv]);
  const serviceRoleKey = text(env[profile.serviceRoleEnv]);
  if (!dbUrl) fail(`${profile.dbEnv} is required for ${profile.label}`);
  if (!apiUrl) fail(`${profile.urlEnv} is required for ${profile.label}`);
  if (!serviceRoleKey) fail(`${profile.serviceRoleEnv} is required for ${profile.label}`);
  if (text(env.SUPABASE_DB_URL) || text(env.SUPABASE_URL) || text(env.SUPABASE_SERVICE_ROLE_KEY)) {
    fail("generic Supabase credentials are not accepted by a target-bound retention process");
  }

  const dbProjectRef = projectRefFromDbUrl(dbUrl, profile.dbEnv);
  const apiProjectRef = projectRefFromUrl(apiUrl, profile.urlEnv);
  if (dbProjectRef !== profile.projectRef || apiProjectRef !== profile.projectRef) {
    fail(`${profile.label} database and API URL must match the canonical project ref`);
  }

  const deployedCommitSha = text(env.DEPLOYED_COMMIT_SHA || env.GITHUB_SHA).toLowerCase();
  if (requireCommitSha && !COMMIT_SHA_RE.test(deployedCommitSha)) {
    fail("a 40-character deployed commit SHA is required");
  }

  return Object.freeze({
    ...profile,
    dbUrl,
    apiUrl,
    serviceRoleKey,
    expectedRef,
    deployedCommitSha: deployedCommitSha || null,
    automationEnabled: env[profile.automationEnv] === "1",
  });
}

export function validateRetentionEnvironment(target, env = process.env, options = {}) {
  const profile = resolveRetentionProfile(target, env, options);
  if (profile.target === "production") {
    if (env.SUPABASE_STAGE_DB_URL || env.SUPABASE_STAGE_URL || env.SUPABASE_STAGE_SERVICE_ROLE_KEY) {
      fail("Production retention cannot receive Stage credentials");
    }
  } else if (env.SUPABASE_PROD_DB_URL || env.SUPABASE_PROD_URL || env.SUPABASE_PROD_SERVICE_ROLE_KEY) {
    fail("Stage retention cannot receive Production credentials");
  }
  return profile;
}

export function policyIdFor(profileOrTarget, policy) {
  const profile = profileOrTarget?.policies ? profileOrTarget : normalizeTarget(profileOrTarget);
  const policyId = profile.policies?.[policy];
  if (!policyId) fail(`unsupported retention policy: ${policy}`);
  return policyId;
}

export function policyKeyForId(profileOrTarget, policyId) {
  const profile = profileOrTarget?.policies ? profileOrTarget : normalizeTarget(profileOrTarget);
  const entry = Object.entries(profile.policies).find(([, value]) => value === policyId);
  if (!entry) fail(`policy is not bound to ${profile.label}: ${policyId}`);
  return entry[0];
}

export function assertProfileIdentity(profile, { projectRef, systemIdentifier } = {}) {
  if (!profile?.projectRef || !profile?.systemIdentifier) fail("retention profile is required");
  if (projectRef !== undefined && projectRef !== profile.projectRef) fail(`${profile.label} project identity mismatch`);
  if (systemIdentifier !== undefined && String(systemIdentifier) !== profile.systemIdentifier) fail(`${profile.label} system identity mismatch`);
  if (!PROJECT_REF_RE.test(profile.projectRef) || !SYSTEM_IDENTIFIER_RE.test(profile.systemIdentifier)) {
    fail(`${profile.label} retention profile has invalid canonical identity`);
  }
  return profile;
}
