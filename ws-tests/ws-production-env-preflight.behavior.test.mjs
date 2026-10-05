import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  runPreflight,
  PreflightError,
  parseEnv
} from "../infra/vps/ws-production-env-preflight.mjs";

const CANONICAL_PROD_PROJECT_REF = "otbqfijerkieoxwpxjnm";
const CANONICAL_PROD_SYSTEM_IDENTIFIER = "7575202818581710058";
const STAGE_PROJECT_REF = "krydukthwdvccggbyjfw";
const STAGE_SYSTEM_IDENTIFIER = "7656985631720456337";

function withTempEnvFile(content, callback, { mode = 0o600 } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-prod-preflight-test-"));
  const envPath = path.join(tempDir, "ws-server.env");
  try {
    fs.writeFileSync(envPath, content, { mode });
    fs.chmodSync(envPath, mode);
    return callback(envPath, tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function validEnvContent(overrides = {}) {
  const base = {
    PORT: "3000",
    WS_AUTHORITATIVE_JOIN_ENABLED: "1",
    POKER_WS_INTERNAL_TOKEN: "valid-production-internal-token",
    SUPABASE_URL: `https://${CANONICAL_PROD_PROJECT_REF}.supabase.co`,
    SUPABASE_DB_URL: `postgresql://postgres.${CANONICAL_PROD_PROJECT_REF}:secret-pass@aws-1-eu-west-3.pooler.supabase.com:6543/postgres`,
    ...overrides
  };
  return Object.entries(base)
    .filter(([_, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";
}

test("parseEnv parses assignments and trims quotes", () => {
  const env = parseEnv(`
    # A comment
    FOO=bar
    QUOTED="hello world"
    SINGLE='single quoted'
  `);
  assert.equal(env.FOO, "bar");
  assert.equal(env.QUOTED, "hello world");
  assert.equal(env.SINGLE, "single quoted");
});

test("canonical Production env + correct DB system identifier passes", () => {
  withTempEnvFile(validEnvContent(), (envFile) => {
    const result = runPreflight({
      envFile,
      allowTestUid: true,
      querySystemIdentifier: () => CANONICAL_PROD_SYSTEM_IDENTIFIER
    });
    assert.equal(result, "PASS");
  });
});

test("canonical Production env with direct database URL passes", () => {
  const directDbUrl = `postgresql://postgres:secret-pass@db.${CANONICAL_PROD_PROJECT_REF}.supabase.co:5432/postgres`;
  withTempEnvFile(validEnvContent({ SUPABASE_DB_URL: directDbUrl }), (envFile) => {
    const result = runPreflight({
      envFile,
      allowTestUid: true,
      querySystemIdentifier: () => CANONICAL_PROD_SYSTEM_IDENTIFIER
    });
    assert.equal(result, "PASS");
  });
});

test("Stage SUPABASE_URL fails", () => {
  const stageUrl = `https://${STAGE_PROJECT_REF}.supabase.co`;
  withTempEnvFile(validEnvContent({ SUPABASE_URL: stageUrl }), (envFile) => {
    assert.throws(
      () => runPreflight({
        envFile,
        allowTestUid: true,
        querySystemIdentifier: () => CANONICAL_PROD_SYSTEM_IDENTIFIER
      }),
      (err) => err instanceof PreflightError && err.message.includes("otbqfijerkieoxwpxjnm")
    );
  });
});

test("Stage SUPABASE_DB_URL fails", () => {
  const stageDbUrl = `postgresql://postgres.${STAGE_PROJECT_REF}:secret@aws-0-eu.pooler.supabase.com:6543/postgres`;
  withTempEnvFile(validEnvContent({ SUPABASE_DB_URL: stageDbUrl }), (envFile) => {
    assert.throws(
      () => runPreflight({
        envFile,
        allowTestUid: true,
        querySystemIdentifier: () => CANONICAL_PROD_SYSTEM_IDENTIFIER
      }),
      (err) => err instanceof PreflightError && (err.message.includes("otbqfijerkieoxwpxjnm") || err.message.includes("Stage"))
    );
  });
});

test("mixed Production URL + Stage DB fails", () => {
  const mixedContent = validEnvContent({
    SUPABASE_URL: `https://${CANONICAL_PROD_PROJECT_REF}.supabase.co`,
    SUPABASE_DB_URL: `postgresql://postgres.${STAGE_PROJECT_REF}:secret@aws-0-eu.pooler.supabase.com:6543/postgres`
  });
  withTempEnvFile(mixedContent, (envFile) => {
    assert.throws(
      () => runPreflight({
        envFile,
        allowTestUid: true,
        querySystemIdentifier: () => CANONICAL_PROD_SYSTEM_IDENTIFIER
      }),
      (err) => err instanceof PreflightError
    );
  });
});

test("mixed Stage URL + Production DB fails", () => {
  const mixedContent = validEnvContent({
    SUPABASE_URL: `https://${STAGE_PROJECT_REF}.supabase.co`,
    SUPABASE_DB_URL: `postgresql://postgres.${CANONICAL_PROD_PROJECT_REF}:secret@aws-1-eu-west-3.pooler.supabase.com:6543/postgres`
  });
  withTempEnvFile(mixedContent, (envFile) => {
    assert.throws(
      () => runPreflight({
        envFile,
        allowTestUid: true,
        querySystemIdentifier: () => CANONICAL_PROD_SYSTEM_IDENTIFIER
      }),
      (err) => err instanceof PreflightError
    );
  });
});

test("missing required variables or bad ports fail", () => {
  for (const override of [
    { SUPABASE_DB_URL: undefined },
    { SUPABASE_URL: undefined },
    { POKER_WS_INTERNAL_TOKEN: undefined },
    { PORT: "3001" },
    { WS_AUTHORITATIVE_JOIN_ENABLED: "0" },
    { WS_BOT_REACTION_MIN_MS: "100" }
  ]) {
    withTempEnvFile(validEnvContent(override), (envFile) => {
      assert.throws(
        () => runPreflight({
          envFile,
          allowTestUid: true,
          querySystemIdentifier: () => CANONICAL_PROD_SYSTEM_IDENTIFIER
        }),
        (err) => err instanceof PreflightError
      );
    });
  }
});

test("symlink / wrong owner / wrong mode fails", () => {
  // Wrong mode (0644 instead of 0600)
  withTempEnvFile(validEnvContent(), (envFile) => {
    assert.throws(
      () => runPreflight({
        envFile,
        allowTestUid: true,
        querySystemIdentifier: () => CANONICAL_PROD_SYSTEM_IDENTIFIER
      }),
      /mode 0600 and must not be a symlink/
    );
  }, { mode: 0o644 });

  // Symlink
  withTempEnvFile(validEnvContent(), (realFile, tempDir) => {
    const symlinkPath = path.join(tempDir, "symlink.env");
    fs.symlinkSync(realFile, symlinkPath);
    assert.throws(
      () => runPreflight({
        envFile: symlinkPath,
        allowTestUid: true,
        querySystemIdentifier: () => CANONICAL_PROD_SYSTEM_IDENTIFIER
      })
    );
  });

  // Non-root ownership check when allowTestUid is false
  withTempEnvFile(validEnvContent(), (envFile) => {
    if (process.getuid() !== 0) {
      assert.throws(
        () => runPreflight({
          envFile,
          allowTestUid: false,
          querySystemIdentifier: () => CANONICAL_PROD_SYSTEM_IDENTIFIER
        }),
        /owned by root:root/
      );
    }
  });
});

test("DB responds with different system_identifier (e.g. Stage) fails", () => {
  withTempEnvFile(validEnvContent(), (envFile) => {
    assert.throws(
      () => runPreflight({
        envFile,
        allowTestUid: true,
        querySystemIdentifier: () => STAGE_SYSTEM_IDENTIFIER
      }),
      (err) => err instanceof PreflightError && err.message.includes("system identifier mismatch")
    );
  });
});

test("DB identity check error or empty response fails", () => {
  withTempEnvFile(validEnvContent(), (envFile) => {
    // Empty result
    assert.throws(
      () => runPreflight({
        envFile,
        allowTestUid: true,
        querySystemIdentifier: () => ""
      }),
      /empty system identifier/
    );

    // Query error
    assert.throws(
      () => runPreflight({
        envFile,
        allowTestUid: true,
        querySystemIdentifier: () => { throw new Error("connection timeout"); }
      }),
      /connection timeout/
    );
  });
});

test("CLI execution passes with valid env and fails with invalid identifier", () => {
  withTempEnvFile(validEnvContent(), (envFile) => {
    // PASS case
    const passResult = spawnSync(
      process.execPath,
      ["infra/vps/ws-production-env-preflight.mjs"],
      {
        env: {
          ...process.env,
          WS_PREFLIGHT_TEST_ENV_FILE: envFile,
          WS_PREFLIGHT_ALLOW_TEST_UID: "1",
          WS_PREFLIGHT_MOCK_SYSTEM_IDENTIFIER: CANONICAL_PROD_SYSTEM_IDENTIFIER
        },
        encoding: "utf8"
      }
    );
    assert.equal(passResult.status, 0, `expected 0, got stdout: ${passResult.stdout}, stderr: ${passResult.stderr}`);
    assert.equal(passResult.stdout.trim(), "PASS");

    // FAIL case (wrong identifier)
    const failResult = spawnSync(
      process.execPath,
      ["infra/vps/ws-production-env-preflight.mjs"],
      {
        env: {
          ...process.env,
          WS_PREFLIGHT_TEST_ENV_FILE: envFile,
          WS_PREFLIGHT_ALLOW_TEST_UID: "1",
          WS_PREFLIGHT_MOCK_SYSTEM_IDENTIFIER: STAGE_SYSTEM_IDENTIFIER
        },
        encoding: "utf8"
      }
    );
    assert.equal(failResult.status, 1);
    assert.match(failResult.stderr, /system identifier mismatch/);
  });
});

test("workflow guard confirms Production preflight is executed before current switch and restart in ws-server-deploy.yml", () => {
  const workflowText = fs.readFileSync(".github/workflows/ws-server-deploy.yml", "utf8");

  const deployStepIdx = workflowText.indexOf("- name: Atomic release switch + restart + health gate on VPS");
  assert.ok(deployStepIdx > 0, "deploy step must exist in ws-server-deploy.yml");
  const deployScript = workflowText.slice(deployStepIdx);

  const preflightCall = "sudo -n /usr/local/sbin/arcade-ws-production-env-preflight";
  const currentSwitch = 'ln -sfn "$NEW_RELEASE_APP_DIR" "$CURRENT_LINK.tmp"';
  const serviceRestart = "sudo -n /usr/bin/systemctl restart ws-server.service";

  const preflightIdx = deployScript.indexOf(preflightCall);
  const currentSwitchIdx = deployScript.indexOf(currentSwitch);
  const haveSwitchedIdx = deployScript.indexOf("HAVE_SWITCHED=1");
  const serviceRestartIdx = deployScript.indexOf(serviceRestart, haveSwitchedIdx);

  assert.ok(preflightIdx > 0, "preflight call must exist in ws-server-deploy.yml");
  assert.ok(currentSwitchIdx > 0, "current switch must exist in ws-server-deploy.yml");
  assert.ok(serviceRestartIdx > 0, "service restart must exist in ws-server-deploy.yml");

  assert.ok(
    preflightIdx < currentSwitchIdx,
    `preflight (idx: ${preflightIdx}) must execute before current switch (idx: ${currentSwitchIdx})`
  );
  assert.ok(
    currentSwitchIdx < haveSwitchedIdx,
    `current switch (idx: ${currentSwitchIdx}) must execute before HAVE_SWITCHED=1 (idx: ${haveSwitchedIdx})`
  );
  assert.ok(
    haveSwitchedIdx < serviceRestartIdx,
    `HAVE_SWITCHED=1 (idx: ${haveSwitchedIdx}) must execute before service restart (idx: ${serviceRestartIdx})`
  );
});
