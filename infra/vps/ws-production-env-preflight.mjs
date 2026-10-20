#!/usr/bin/node

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_ENV_FILE = "/etc/arcadeplatform/ws-server.env";
const CANONICAL_PROD_PROJECT_REF = "otbqfijerkieoxwpxjnm";
const CANONICAL_PROD_SYSTEM_IDENTIFIER = "7575202818581710058";
const STAGE_PROJECT_REF = "krydukthwdvccggbyjfw";
export const PSQL_BIN = "/usr/bin/psql";

const REQUIRED_NON_EMPTY = [
  "SUPABASE_DB_URL",
  "SUPABASE_URL",
  "POKER_WS_INTERNAL_TOKEN"
];

export class PreflightError extends Error {}

export function reject(reason) {
  throw new PreflightError(reason);
}

export function sanitizeOutput(rawText, sensitiveValues = []) {
  let text = String(rawText || "");
  for (const secret of sensitiveValues) {
    if (secret && typeof secret === "string" && secret.length >= 2) {
      text = text.split(secret).join("[REDACTED]");
    }
  }
  text = text.replace(/:\/\/([^:]+):([^@]+)@/g, "://$1:[REDACTED]@");
  return text.trim();
}

export function parseEnv(source) {
  const values = Object.create(null);

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) reject("production env file contains an invalid assignment");

    let value = match[2].trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }

  return values;
}

export function parseDbUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    reject("invalid database connection URL format");
  }

  const host = parsed.hostname;
  const port = parsed.port || "5432";
  const user = decodeURIComponent(parsed.username || "");
  const password = decodeURIComponent(parsed.password || "");
  const database = parsed.pathname ? parsed.pathname.replace(/^\//, "") : "postgres";

  if (!host || !user) {
    reject("database connection URL must specify host and user");
  }

  const sslmode = parsed.searchParams.get("sslmode") || "";

  return { host, port, user, password, database, sslmode };
}

export function defaultQuerySystemIdentifier(dbUrl) {
  const { host, port, user, password, database, sslmode } = parseDbUrl(dbUrl);

  const args = [
    "-h", host,
    "-p", String(port),
    "-U", user,
    "-d", database,
    "-X",
    "-Atq",
    "-v", "ON_ERROR_STOP=1",
    "-c", "select system_identifier from pg_control_system();"
  ];

  const env = {
    ...process.env,
    PGPASSWORD: password
  };
  if (sslmode) {
    env.PGSSLMODE = sslmode;
  }

  const result = spawnSync(PSQL_BIN, args, {
    env,
    timeout: 15000,
    encoding: "utf8"
  });

  if (result.error) {
    const sanitizedError = sanitizeOutput(result.error.message, [password]);
    reject(`failed to execute DB identity check: ${sanitizedError}`);
  }

  if (result.status !== 0) {
    const stderr = sanitizeOutput(result.stderr || "", [password]);
    reject(`DB identity check failed with exit code ${result.status}${stderr ? `: ${stderr}` : ""}`);
  }

  return (result.stdout || "").trim();
}

// Secrets go only to a child stdin, never argv, stdout or diagnostics.
export function defaultQueryRedisV3(values) {
  const script = `import fs from 'node:fs';
    const v=JSON.parse(fs.readFileSync(0,'utf8'));
    try {
      const r=await fetch(v.url,{method:'POST',signal:AbortSignal.timeout(5000),headers:{Authorization:'Bearer '+v.token,'content-type':'application/json'},body:JSON.stringify(['PING'])});
      const b=await r.json(); if(!r.ok || b.error || b.result!=='PONG') process.exit(1);
      process.stdout.write('PASS');
    } catch {process.exit(1);}`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{
    input:JSON.stringify({url:values.UPSTASH_REDIS_REST_URL,token:values.UPSTASH_REDIS_REST_TOKEN}),
    encoding:'utf8',timeout:8000,env:{PATH:process.env.PATH}});
  return !result.error && result.status===0 && result.stdout==='PASS';
}

export function runPreflight({
  envFile = DEFAULT_ENV_FILE,
  allowTestUid = false,
  querySystemIdentifier = defaultQuerySystemIdentifier,
  requireRedisV3 = false,
  queryRedisV3 = defaultQueryRedisV3
} = {}) {
  let fd;
  try {
    if (
      typeof fs.constants.O_NOFOLLOW !== "number"
      || typeof fs.constants.O_NONBLOCK !== "number"
    ) {
      reject("required open flags are unavailable");
    }

    fd = fs.openSync(
      envFile,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
    );
    const metadata = fs.fstatSync(fd);

    const isFile = metadata.isFile();
    const isRootOwned = allowTestUid
      ? (metadata.uid === process.getuid() && metadata.gid === process.getgid()) || (metadata.uid === 0 && metadata.gid === 0)
      : metadata.uid === 0 && metadata.gid === 0;
    const isMode0600 = (metadata.mode & 0o7777) === 0o600;

    if (!isFile || !isRootOwned || !isMode0600) {
      reject("production env file must be a regular file owned by root:root with mode 0600 and must not be a symlink");
    }

    const values = parseEnv(fs.readFileSync(fd, "utf8"));
    for (const key of REQUIRED_NON_EMPTY) {
      if (!values[key]) reject(`production env file must define ${key}`);
    }

    if (values.WS_AUTHORITATIVE_JOIN_ENABLED !== "1") {
      reject("production env file must define WS_AUTHORITATIVE_JOIN_ENABLED=1");
    }
    if ("WS_BOT_REACTION_MIN_MS" in values || "WS_BOT_REACTION_MAX_MS" in values) {
      reject("production env file must not define legacy WS_BOT_REACTION_MIN_MS or WS_BOT_REACTION_MAX_MS");
    }

    const rawSupabaseUrl = values.SUPABASE_URL || values.SUPABASE_URL_V2 || "";
    let parsedSupabaseUrl;
    try {
      parsedSupabaseUrl = new URL(rawSupabaseUrl);
    } catch {
      reject("production env SUPABASE_URL must be a valid URL");
    }
    if (parsedSupabaseUrl.protocol !== "https:") {
      reject("production env SUPABASE_URL must use https: protocol");
    }
    if (parsedSupabaseUrl.hostname !== `${CANONICAL_PROD_PROJECT_REF}.supabase.co`) {
      reject("production env SUPABASE_URL must target canonical production project ref otbqfijerkieoxwpxjnm");
    }

    const dbUrl = values.SUPABASE_DB_URL;
    const targetsProd = dbUrl.includes(`postgres.${CANONICAL_PROD_PROJECT_REF}`)
      || dbUrl.includes(`//${CANONICAL_PROD_PROJECT_REF}.`)
      || dbUrl.includes(`.${CANONICAL_PROD_PROJECT_REF}.`);

    if (!targetsProd) {
      reject("production env SUPABASE_DB_URL must target canonical production project ref otbqfijerkieoxwpxjnm");
    }
    if (dbUrl.includes(STAGE_PROJECT_REF) || dbUrl.includes(`postgres.${STAGE_PROJECT_REF}`)) {
      reject("production env SUPABASE_DB_URL must not target Stage project ref");
    }

    const systemIdentifier = querySystemIdentifier(dbUrl);
    if (!systemIdentifier) {
      reject("DB identity check returned an empty system identifier");
    }
    if (systemIdentifier !== CANONICAL_PROD_SYSTEM_IDENTIFIER) {
      reject(`DB system identifier mismatch: expected ${CANONICAL_PROD_SYSTEM_IDENTIFIER}, got ${systemIdentifier}`);
    }

    if (requireRedisV3) {
      if (values.XP_REDIS_VERSION!=='3' || values.XP_REDIS_ENV!=='prod' || values.XP_KEY_NS!=='kcswh:prod:xp:v3' ||
          values.ACCOUNT_DELETION_ENABLED!=='0' || values.XP_TEST_MODE==='1' || !values.UPSTASH_REDIS_REST_TOKEN?.trim()) reject('production Redis V3 configuration mismatch');
      let endpoint; try { endpoint=new URL(values.UPSTASH_REDIS_REST_URL); } catch { reject('production Redis endpoint missing'); }
      if (endpoint.protocol!=='https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname!=='/' || !endpoint.hostname.endsWith('.upstash.io')) reject('production Redis endpoint invalid');
      if (!queryRedisV3(values)) reject('production Redis V3 LIVE failed');
      return 'PASS LIVE Redis V3 prod';
    }
    return "PASS";
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (isMainModule) {
  try {
    if (process.argv.length !== 2) reject("unexpected arguments");
    const result = runPreflight({requireRedisV3:true});
    process.stdout.write(`${result}\n`);
  } catch (error) {
    const reason = error instanceof PreflightError
      ? error.message
      : `production env preflight failed: ${error?.message || error}`;
    process.stderr.write(`${reason}\n`);
    process.exitCode = 1;
  }
}
