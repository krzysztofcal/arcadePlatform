#!/usr/bin/node

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_ENV_FILE = "/etc/arcadeplatform/ws-server.env";
const CANONICAL_PROD_PROJECT_REF = "otbqfijerkieoxwpxjnm";
const CANONICAL_PROD_SYSTEM_IDENTIFIER = "7575202818581710058";
const STAGE_PROJECT_REF = "krydukthwdvccggbyjfw";

const REQUIRED_NON_EMPTY = [
  "SUPABASE_DB_URL",
  "SUPABASE_URL",
  "POKER_WS_INTERNAL_TOKEN"
];

export class PreflightError extends Error {}

export function reject(reason) {
  throw new PreflightError(reason);
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

export function defaultQuerySystemIdentifier(dbUrl) {
  if (process.env.WS_PREFLIGHT_MOCK_SYSTEM_IDENTIFIER !== undefined) {
    return process.env.WS_PREFLIGHT_MOCK_SYSTEM_IDENTIFIER;
  }

  const result = spawnSync(
    "psql",
    [dbUrl, "-X", "-Atq", "-v", "ON_ERROR_STOP=1", "-c", "select system_identifier from pg_control_system();"],
    { timeout: 15000, encoding: "utf8" }
  );

  if (result.error) {
    reject(`failed to execute DB identity check: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    reject(`DB identity check failed with exit code ${result.status}${stderr ? `: ${stderr}` : ""}`);
  }

  return (result.stdout || "").trim();
}

export function runPreflight({
  envFile = process.env.WS_PREFLIGHT_TEST_ENV_FILE || DEFAULT_ENV_FILE,
  allowTestUid = process.env.WS_PREFLIGHT_ALLOW_TEST_UID === "1",
  querySystemIdentifier = defaultQuerySystemIdentifier
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

    if (values.PORT !== "3000") reject("production env file must define PORT=3000");
    if (values.WS_AUTHORITATIVE_JOIN_ENABLED !== "1") {
      reject("production env file must define WS_AUTHORITATIVE_JOIN_ENABLED=1");
    }
    if ("WS_BOT_REACTION_MIN_MS" in values || "WS_BOT_REACTION_MAX_MS" in values) {
      reject("production env file must not define legacy WS_BOT_REACTION_MIN_MS or WS_BOT_REACTION_MAX_MS");
    }

    const supabaseUrl = values.SUPABASE_URL || values.SUPABASE_URL_V2 || "";
    if (!supabaseUrl.includes(`://${CANONICAL_PROD_PROJECT_REF}.supabase.co`)) {
      reject("production env SUPABASE_URL must target canonical production project ref otbqfijerkieoxwpxjnm");
    }
    if (supabaseUrl.includes(STAGE_PROJECT_REF)) {
      reject("production env SUPABASE_URL must not target Stage project ref");
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

    return "PASS";
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (isMainModule) {
  try {
    if (process.argv.length !== 2) reject("unexpected arguments");
    const result = runPreflight();
    process.stdout.write(`${result}\n`);
  } catch (error) {
    const reason = error instanceof PreflightError
      ? error.message
      : `production env preflight failed: ${error?.message || error}`;
    process.stderr.write(`${reason}\n`);
    process.exitCode = 1;
  }
}
