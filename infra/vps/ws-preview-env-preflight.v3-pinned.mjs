#!/usr/bin/node

import fs from "node:fs";
import { createHash } from "node:crypto";

const ENV_FILE = "/opt/arcade-ws-preview/.env.preview";
const REQUIRED_NON_EMPTY = [
  "SUPABASE_DB_URL",
  "SUPABASE_STAGE_PROJECT_REF",
  "POKER_WS_INTERNAL_TOKEN"
];

class PreflightError extends Error {}

function reject(reason) {
  throw new PreflightError(reason);
}

function parseEnv(source) {
  const values = Object.create(null);

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) reject("preview env file contains an invalid assignment");

    let value = match[2].trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (Object.hasOwn(values, match[1])) reject("duplicate preview environment key");
    values[match[1]] = value;
  }

  return values;
}

function protectedRecord(directory, name) {
  for (const path of ["/var", "/var/backups", directory]) {
    const metadata = fs.lstatSync(path);
    if (!metadata.isDirectory() || metadata.uid !== 0 || metadata.gid !== 0 || (metadata.mode & 0o022)
      || (path === directory && (metadata.mode & 0o7777) !== 0o700)) reject("protected Preview record is required");
  }
  const fd = fs.openSync(directory + "/" + name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const metadata = fs.fstatSync(fd);
    if (!metadata.isFile() || metadata.uid !== 0 || metadata.gid !== 0 || metadata.nlink !== 1
      || (metadata.mode & 0o7777) !== 0o600 || metadata.size > 1048576) reject("protected Preview record is required");
    return fs.readFileSync(fd, "utf8");
  } finally { fs.closeSync(fd); }
}

function assertApprovedSource(source) {
  const sha = value => createHash("sha256").update(value).digest("hex");
  const preparation = protectedRecord("/var/backups/arcade-ws-preview-v3", "manifest.json");
  const record = JSON.parse(preparation);
  if (record.version !== 1 || record.phase !== "complete") reject("Preview preparation incomplete");
  const windowDirectory = "/var/backups/arcade-stage-deletion-window";
  if (!fs.existsSync(windowDirectory)) {
    if (record.desired?.env !== sha(source) || parseEnv(source).ACCOUNT_DELETION_ENABLED !== "0") {
      reject("Preview environment differs from approved preparation");
    }
    return;
  }
  const window = JSON.parse(protectedRecord(windowDirectory, "manifest.json"));
  const baseline = protectedRecord(windowDirectory, "env.before");
  const values = parseEnv(baseline);
  if (window.version !== 1 || window.baseline_record !== sha(preparation)
    || window.off !== sha(baseline) || record.desired?.env !== sha(baseline)
    || values.ACCOUNT_DELETION_ENABLED !== "0"
    || ![undefined, "", "stage-avatar-authority-20261021"].includes(values.ACCOUNT_DELETION_AVATAR_TRACKING_MARKER)) {
    reject("Preview window baseline is invalid");
  }
  // Derive the only allowed ON bytes independently; never trust an arbitrary supplied hash.
  let on = baseline.split(/(?<=\n)/).filter(line => !["ACCOUNT_DELETION_ENABLED", "ACCOUNT_DELETION_AVATAR_TRACKING_MARKER"]
    .includes(line.split("=", 1)[0].trim())).join("");
  if (on && !on.endsWith("\n")) on += "\n";
  on += "ACCOUNT_DELETION_ENABLED=1\nACCOUNT_DELETION_AVATAR_TRACKING_MARKER=stage-avatar-authority-20261021\n";
  if (window.on !== sha(on) || !((window.phase === "on" && source === on)
    || (["prepared", "off"].includes(window.phase) && source === baseline))) {
    reject("Preview window is incomplete or environment drifted");
  }
}

function assertProtectedParents() {
  for (const directory of ["/opt", "/opt/arcade-ws-preview"]) {
    const parent = fs.lstatSync(directory);
    if (!parent.isDirectory() || parent.uid !== 0 || parent.gid !== 0 || (parent.mode & 0o022)) {
      reject("preview env parent directory must be root-owned and not writable by other users");
    }
  }
}

let fd;
try {
  const explicitLive = process.argv.length === 3 && process.argv[2] === "--verify-redis";
  const configOnly = process.argv.length === 3 && process.argv[2] === "--config-only";
  if (process.argv.length !== 2 && !explicitLive && !configOnly) reject("unexpected arguments");
  if (
    typeof fs.constants.O_NOFOLLOW !== "number"
    || typeof fs.constants.O_NONBLOCK !== "number"
  ) {
    reject("required open flags are unavailable");
  }

  assertProtectedParents();

  fd = fs.openSync(
    ENV_FILE,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
  );
  const metadata = fs.fstatSync(fd);
  if (
    !metadata.isFile()
    || metadata.uid !== 0
    || metadata.gid !== 0
    || metadata.nlink !== 1
    || (metadata.mode & 0o7777) !== 0o600
  ) {
    reject("preview env file must be a regular file owned by root:root with mode 0600 and must not be a symlink");
  }

  const originalSource = fs.readFileSync(fd, "utf8");
  const values = parseEnv(originalSource);
  for (const key of REQUIRED_NON_EMPTY) {
    if (!values[key]) reject(`preview env file must define ${key}`);
  }
  if (values.PORT !== "3001") reject("preview env file must define PORT=3001");
  if (values.WS_AUTHORITATIVE_JOIN_ENABLED !== "1") {
    reject("preview env file must define WS_AUTHORITATIVE_JOIN_ENABLED=1");
  }
  if ("WS_BOT_REACTION_MIN_MS" in values || "WS_BOT_REACTION_MAX_MS" in values) {
    reject("preview env file must not define legacy WS_BOT_REACTION_MIN_MS or WS_BOT_REACTION_MAX_MS");
  }

  const stageRef = values.SUPABASE_STAGE_PROJECT_REF;
  if (stageRef !== "krydukthwdvccggbyjfw") reject("preview env stage project ref is invalid");

  const supabaseUrl = values.SUPABASE_URL || values.SUPABASE_URL_V2;
  if (!supabaseUrl) reject("preview env file must define stage Supabase URL and DB URL");
  if (supabaseUrl.replace(/\/$/, "") !== `https://${stageRef}.supabase.co`) {
    reject("preview env SUPABASE_URL must target SUPABASE_STAGE_PROJECT_REF");
  }

  const dbUrl = new URL(values.SUPABASE_DB_URL);
  const dbUser = decodeURIComponent(dbUrl.username);
  const directStage = dbUrl.hostname === `db.${stageRef}.supabase.co` && dbUser === "postgres";
  const pooledStage = dbUrl.hostname.endsWith(".pooler.supabase.com") && dbUser === `postgres.${stageRef}`;
  if (!["postgres:", "postgresql:"].includes(dbUrl.protocol) || (!directStage && !pooledStage)) {
    reject("preview env SUPABASE_DB_URL must target SUPABASE_STAGE_PROJECT_REF");
  }

  const v3 = values.XP_REDIS_VERSION === "3" || !!values.XP_REDIS_ENV || /:v3(?:$|:)/.test(values.XP_KEY_NS || "");
  if (v3) {
    if (values.XP_REDIS_VERSION !== "3" || values.XP_REDIS_ENV !== "stage"
      || values.XP_KEY_NS !== "kcswh:stage:xp:v3" || values.XP_TEST_MODE === "1") {
      reject("preview env Redis V3 configuration is invalid");
    }
    for (const key of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) {
      if (!values[key]?.trim()) reject(`preview env file must define ${key}`);
    }
    for (const key of ["ARCADE_DEPLOY_TARGET", "CONTEXT", "NETLIFY_CONTEXT"]) {
      if (values[key] && !["deploy-preview", "branch-deploy", "development", "dev"].includes(values[key])) {
        reject("preview env Redis deployment context is invalid");
      }
    }
  }
  if (v3) {
    const endpoint = new URL(values.UPSTASH_REDIS_REST_URL);
    if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".upstash.io")
      || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || !["", "/"].includes(endpoint.pathname) || !["", "443"].includes(endpoint.port)
      || !/^[A-Za-z0-9._~-]+$/.test(values.UPSTASH_REDIS_REST_TOKEN)) {
      reject("preview Redis endpoint or credential format is invalid");
    }
  }
  if (values.ACCOUNT_DELETION_ENABLED === "1" && !v3) reject("deletion window requires Stage V3");
  if (v3) assertApprovedSource(originalSource);
  // The existing exact no-argument sudo contract must authenticate V3 on every deploy.
  if (explicitLive || (v3 && !configOnly)) {
    if (!v3) reject("Redis V3 is required for live verification");
    // Explicit read-only mode: no redirects, key values, SCAN, V2 commands or writes.
    fetch(values.UPSTASH_REDIS_REST_URL.replace(/\/$/, "") + "/pipeline", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { Authorization: "Bearer " + values.UPSTASH_REDIS_REST_TOKEN, "content-type": "application/json" },
      body: JSON.stringify([["PING"], ["EXISTS", "kcswh:stage:xp:v3:lifecycle:epoch"]])
    }).then(async (response) => {
      if (!response.ok) throw new Error();
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length !== 2 || rows.some(row => row.error)
        || rows[0].result !== "PONG" || ![0, 1].includes(rows[1].result)) throw new Error();
      let verificationFd;
      try {
        assertProtectedParents();
        verificationFd = fs.openSync(ENV_FILE, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        const current = fs.fstatSync(verificationFd);
        assertApprovedSource(originalSource);
        if (!current.isFile() || current.uid !== 0 || current.gid !== 0 || current.nlink !== 1
          || (current.mode & 0o7777) !== 0o600 || fs.readFileSync(verificationFd, "utf8") !== originalSource) throw new Error();
      } finally {
        if (verificationFd !== undefined) fs.closeSync(verificationFd);
      }
      process.stdout.write(`PASS LIVE Redis V3 stage; epochPresent=${rows[1].result}; cutover NOT attested\n`);
    }).catch(() => {
      process.stderr.write("preview Redis live verification failed; no credentials printed\n");
      process.exitCode = 1;
    });
  } else {
    process.stdout.write(v3 ? "PASS CONFIG ONLY Redis V3 stage; live verification required\n" : "PASS legacy Redis; V3 not verified\n");
  }
} catch (error) {
  const reason = error instanceof PreflightError
    ? error.message
    : "preview env preflight failed";
  process.stderr.write(`${reason}\n`);
  process.exitCode = 1;
} finally {
  if (fd !== undefined) fs.closeSync(fd);
}
