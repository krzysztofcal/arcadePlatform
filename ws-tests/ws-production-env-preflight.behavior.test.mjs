import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  runPreflight,
  PreflightError,
  parseEnv,
  parseDbUrl,
  sanitizeOutput,
  PSQL_BIN,
  defaultQuerySystemIdentifier
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

test("parseDbUrl parses pooler and direct connection strings correctly", () => {
  const pooler = parseDbUrl(
    "postgresql://postgres.otbqfijerkieoxwpxjnm:my%20secret%40pass@aws-1-eu-west-3.pooler.supabase.com:6543/postgres?sslmode=require"
  );
  assert.equal(pooler.host, "aws-1-eu-west-3.pooler.supabase.com");
  assert.equal(pooler.port, "6543");
  assert.equal(pooler.user, "postgres.otbqfijerkieoxwpxjnm");
  assert.equal(pooler.password, "my secret@pass");
  assert.equal(pooler.database, "postgres");
  assert.equal(pooler.sslmode, "require");

  const direct = parseDbUrl(
    "postgresql://postgres:secret%23pass@db.otbqfijerkieoxwpxjnm.supabase.co:5432/postgres"
  );
  assert.equal(direct.host, "db.otbqfijerkieoxwpxjnm.supabase.co");
  assert.equal(direct.port, "5432");
  assert.equal(direct.user, "postgres");
  assert.equal(direct.password, "secret#pass");
  assert.equal(direct.database, "postgres");
  assert.equal(direct.sslmode, "");

  assert.throws(() => parseDbUrl("not-a-valid-url"), (err) => err instanceof PreflightError);
  assert.throws(() => parseDbUrl("postgresql://:mypass@localhost/postgres"), (err) => err instanceof PreflightError);
});

test("sanitizeOutput redacts secret passwords and connection URI credentials", () => {
  const password = "super-secret-password-xyz";
  const raw = `FATAL: password authentication failed for user "postgres" with password "${password}"`;
  const sanitized = sanitizeOutput(raw, [password]);
  assert.ok(!sanitized.includes(password), "must not include raw password");
  assert.ok(sanitized.includes("[REDACTED]"), "must include [REDACTED]");

  const uriRaw = "error connecting to postgresql://postgres:mysecret123@aws-1.supabase.com:5432/postgres";
  const uriSanitized = sanitizeOutput(uriRaw);
  assert.ok(!uriSanitized.includes("mysecret123"), "must not include URI password");
  assert.ok(uriSanitized.includes("postgresql://postgres:[REDACTED]@aws-1.supabase.com:5432/postgres"));
});

test("defaultQuerySystemIdentifier uses PSQL_BIN /usr/bin/psql directly", () => {
  assert.equal(PSQL_BIN, "/usr/bin/psql");

  const fnSource = defaultQuerySystemIdentifier.toString();
  assert.ok(fnSource.includes("spawnSync(PSQL_BIN, args,"), "defaultQuerySystemIdentifier must execute PSQL_BIN");

  const preflightSource = fs.readFileSync("infra/vps/ws-production-env-preflight.mjs", "utf8");
  assert.ok(!preflightSource.includes('spawnSync("psql"'), "must not invoke unanchored psql from PATH");
  assert.ok(!preflightSource.includes("spawnSync('psql'"), "must not invoke unanchored psql from PATH");
  assert.ok(preflightSource.includes("spawnSync(PSQL_BIN,"), "source must use PSQL_BIN in spawnSync");
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

test("SUPABASE_URL requires exact canonical hostname and https protocol", () => {
  // Valid canonical Production URL passes
  withTempEnvFile(
    validEnvContent({ SUPABASE_URL: `https://${CANONICAL_PROD_PROJECT_REF}.supabase.co` }),
    (envFile) => {
      const result = runPreflight({
        envFile,
        allowTestUid: true,
        querySystemIdentifier: () => CANONICAL_PROD_SYSTEM_IDENTIFIER
      });
      assert.equal(result, "PASS");
    }
  );

  // Subdomain / suffix spoof (fail-open prevention) fails
  withTempEnvFile(
    validEnvContent({ SUPABASE_URL: `https://${CANONICAL_PROD_PROJECT_REF}.supabase.co.evil.example` }),
    (envFile) => {
      assert.throws(
        () => runPreflight({
          envFile,
          allowTestUid: true,
          querySystemIdentifier: () => CANONICAL_PROD_SYSTEM_IDENTIFIER
        }),
        (err) => err instanceof PreflightError && err.message.includes("otbqfijerkieoxwpxjnm")
      );
    }
  );

  // Other hostname fails
  withTempEnvFile(
    validEnvContent({ SUPABASE_URL: "https://some-other-host.supabase.co" }),
    (envFile) => {
      assert.throws(
        () => runPreflight({
          envFile,
          allowTestUid: true,
          querySystemIdentifier: () => CANONICAL_PROD_SYSTEM_IDENTIFIER
        }),
        (err) => err instanceof PreflightError && err.message.includes("otbqfijerkieoxwpxjnm")
      );
    }
  );

  // http protocol fails
  withTempEnvFile(
    validEnvContent({ SUPABASE_URL: `http://${CANONICAL_PROD_PROJECT_REF}.supabase.co` }),
    (envFile) => {
      assert.throws(
        () => runPreflight({
          envFile,
          allowTestUid: true,
          querySystemIdentifier: () => CANONICAL_PROD_SYSTEM_IDENTIFIER
        }),
        (err) => err instanceof PreflightError && err.message.includes("https:")
      );
    }
  );

  // Malformed URL fails
  withTempEnvFile(
    validEnvContent({ SUPABASE_URL: "not-a-valid-url" }),
    (envFile) => {
      assert.throws(
        () => runPreflight({
          envFile,
          allowTestUid: true,
          querySystemIdentifier: () => CANONICAL_PROD_SYSTEM_IDENTIFIER
        }),
        (err) => err instanceof PreflightError && err.message.includes("valid URL")
      );
    }
  );
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

test("CLI execution ignores WS_PREFLIGHT_* test env vars and rejects extra arguments", () => {
  // When running CLI directly, it must not allow test overrides through environment variables
  const result = spawnSync(
    process.execPath,
    ["infra/vps/ws-production-env-preflight.mjs"],
    {
      env: {
        ...process.env,
        WS_PREFLIGHT_TEST_ENV_FILE: "/tmp/some-file",
        WS_PREFLIGHT_ALLOW_TEST_UID: "1",
        WS_PREFLIGHT_MOCK_SYSTEM_IDENTIFIER: CANONICAL_PROD_SYSTEM_IDENTIFIER
      },
      encoding: "utf8"
    }
  );
  // In an unprivileged test environment, accessing /etc/arcadeplatform/ws-server.env fails closed
  if (process.getuid() !== 0) {
    assert.equal(result.status, 1, "CLI must exit with code 1 when unprivileged");
    assert.ok(
      result.stderr.includes("EACCES") || result.stderr.includes("owned by root:root") || result.stderr.includes("ENOENT"),
      `stderr should indicate permission/path failure, got: ${result.stderr}`
    );
  }

  // CLI rejects extra arguments
  const extraArgResult = spawnSync(
    process.execPath,
    ["infra/vps/ws-production-env-preflight.mjs", "--unexpected-arg"],
    { encoding: "utf8" }
  );
  assert.equal(extraArgResult.status, 1);
  assert.match(extraArgResult.stderr, /unexpected arguments/);
});

test("stage-production-env-preflight.sh has valid syntax and strictly verifies without restarts", () => {
  const scriptPath = "infra/vps/stage-production-env-preflight.sh";
  assert.ok(fs.existsSync(scriptPath), "staging script must exist");

  const syntaxCheck = spawnSync("bash", ["-n", scriptPath], { encoding: "utf8" });
  assert.equal(syntaxCheck.status, 0, `bash syntax error: ${syntaxCheck.stderr}`);

  const scriptContent = fs.readFileSync(scriptPath, "utf8");
  assert.ok(scriptContent.includes('if [[ "$EUID" -ne 0 ]]; then'), "must enforce root execution");
  assert.ok(scriptContent.includes("visudo -cf"), "must validate sudoers file syntax");
  assert.ok(
    scriptContent.includes("sudo -u copilot sudo -n"),
    "must verify preflight via unprivileged sudo caller"
  );
  assert.ok(
    !scriptContent.includes("systemctl restart"),
    "staging script must NOT restart services"
  );
  assert.ok(
    !scriptContent.includes("systemctl reload"),
    "staging script must NOT reload services"
  );
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
