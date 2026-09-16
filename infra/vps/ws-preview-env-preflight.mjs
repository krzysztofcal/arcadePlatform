#!/usr/bin/env node

import fs from "node:fs";

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
    values[match[1]] = value;
  }

  return values;
}

let fd;
try {
  if (process.argv.length !== 2) reject("unexpected arguments");
  if (
    typeof fs.constants.O_NOFOLLOW !== "number"
    || typeof fs.constants.O_NONBLOCK !== "number"
  ) {
    reject("required open flags are unavailable");
  }

  fd = fs.openSync(
    ENV_FILE,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
  );
  const metadata = fs.fstatSync(fd);
  if (
    !metadata.isFile()
    || metadata.uid !== 0
    || metadata.gid !== 0
    || (metadata.mode & 0o7777) !== 0o600
  ) {
    reject("preview env file must be a regular file owned by root:root with mode 0600 and must not be a symlink");
  }

  const values = parseEnv(fs.readFileSync(fd, "utf8"));
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
  if (!/^[a-z0-9-]+$/.test(stageRef)) reject("preview env stage project ref is invalid");

  const supabaseUrl = values.SUPABASE_URL || values.SUPABASE_URL_V2;
  if (!supabaseUrl) reject("preview env file must define stage Supabase URL and DB URL");
  if (!supabaseUrl.includes(`://${stageRef}.supabase.co`)) {
    reject("preview env SUPABASE_URL must target SUPABASE_STAGE_PROJECT_REF");
  }

  const dbUrl = values.SUPABASE_DB_URL;
  if (
    !dbUrl.includes(`postgres.${stageRef}`)
    && !dbUrl.includes(`//${stageRef}.`)
    && !dbUrl.includes(`.${stageRef}.`)
  ) {
    reject("preview env SUPABASE_DB_URL must target SUPABASE_STAGE_PROJECT_REF");
  }

  process.stdout.write("PASS\n");
} catch (error) {
  const reason = error instanceof PreflightError
    ? error.message
    : "preview env preflight failed";
  process.stderr.write(`${reason}\n`);
  process.exitCode = 1;
} finally {
  if (fd !== undefined) fs.closeSync(fd);
}
