import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);

function wsAvailability({ hasGlobalWebSocket = typeof globalThis.WebSocket === "function", resolveAttempts = null } = {}) {
  const attempts = resolveAttempts ?? [
    { name: "ws-server", resolve: () => require.resolve("ws", { paths: ["./ws-server"] }) },
    { name: "root", resolve: () => require.resolve("ws") }
  ];

  const resolved = [];
  const failures = [];

  for (const attempt of attempts) {
    const name = typeof attempt === "function" ? "custom" : attempt.name;
    const resolve = typeof attempt === "function" ? attempt : attempt.resolve;

    try {
      resolved.push({ name, path: resolve() });
    } catch (error) {
      failures.push({ name, message: error?.message ?? String(error) });
    }
  }

  return { hasGlobalWebSocket, resolved, failures };
}

function assertWsAvailable(availability) {
  const ok = availability.hasGlobalWebSocket || availability.resolved.length > 0;
  assert.equal(
    ok,
    true,
    `Unable to resolve a WebSocket implementation. hasGlobalWebSocket=${availability.hasGlobalWebSocket}; failures=${JSON.stringify(availability.failures)}`
  );
}

test("ws dependency resolves from global WebSocket or root/ws-server dependency graph", () => {
  assertWsAvailable(wsAvailability());
});

test("guard passes when globalThis.WebSocket exists even if ws resolve fails", () => {
  const availability = wsAvailability({
    hasGlobalWebSocket: true,
    resolveAttempts: [
      { name: "root", resolve: () => { throw new Error("forced resolve failure"); } },
      { name: "ws-server", resolve: () => { throw new Error("forced resolve failure"); } }
    ]
  });

  assertWsAvailable(availability);
  assert.equal(availability.resolved.length, 0);
  assert.equal(availability.failures.length, 2);
  assert.match(availability.failures[0].message, /forced resolve failure/);
});

test("guard reports explicit diagnostics when neither globalThis.WebSocket nor ws is available", () => {
  const availability = wsAvailability({
    hasGlobalWebSocket: false,
    resolveAttempts: [
      { name: "root", resolve: () => { throw new Error("forced resolve failure"); } },
      { name: "ws-server", resolve: () => { throw new Error("forced resolve failure"); } }
    ]
  });

  assert.throws(
    () => assertWsAvailable(availability),
    /Unable to resolve a WebSocket implementation\. hasGlobalWebSocket=false;.*forced resolve failure/
  );
});


test("persisted bootstrap repository stays within ws-server runtime boundary", () => {
  const repositoryText = fs.readFileSync("ws-server/poker/bootstrap/persisted-bootstrap-repository.mjs", "utf8");
  assert.doesNotMatch(repositoryText, /netlify\/functions\/_shared\/supabase-admin\.mjs/);
  assert.match(repositoryText, /import\("\.\/persisted-bootstrap-db\.mjs"\)/);
});

test("shared authoritative join core avoids static netlify adapter imports", () => {
  const joinText = fs.readFileSync("shared/poker-domain/join.mjs", "utf8");
  assert.doesNotMatch(joinText, /from\s+["']\.\.\/\.\.\/netlify\/functions\/_shared\//);
  assert.match(joinText, /await\s+import\(["']\.\.\/\.\.\/netlify\/functions\/_shared\/chips-ledger\.mjs["']\)/);
});

test("shared inactive cleanup deps wrapper exists for production ws release layout", () => {
  const depsText = fs.readFileSync("shared/poker-domain/inactive-cleanup-deps.mjs", "utf8");
  assert.match(depsText, /netlify\/functions\/_shared\/chips-ledger\.mjs/);
  assert.match(depsText, /netlify\/functions\/_shared\/poker-hole-cards-store\.mjs/);
});

test("ws server defaults authoritative join only for db-backed runtime when env flag is missing", () => {
  const serverText = fs.readFileSync("ws-server/server.mjs", "utf8");
  assert.match(serverText, /const hasSupabaseDbUrl = Boolean\(process\.env\.SUPABASE_DB_URL\)/);
  assert.match(serverText, /return Boolean\(hasSupabaseDbUrl && !observeOnlyJoinEnabled\)/);
});

test("ws-server package declares postgres dependency for db-backed bootstrap runtime", () => {
  const packageJson = JSON.parse(fs.readFileSync("ws-server/package.json", "utf8"));
  assert.equal(packageJson.dependencies?.postgres, "^3.4.5");
});


test("ws snapshot runtime helper chain stays within ws-server boundary", () => {
  const runtimeFiles = [
    "ws-server/poker/table/table-snapshot.mjs",
    "ws-server/poker/snapshot-runtime/poker-deal-deterministic.mjs",
    "ws-server/poker/snapshot-runtime/poker-cards-utils.mjs",
    "ws-server/poker/snapshot-runtime/poker-hole-cards-store.mjs",
    "ws-server/poker/snapshot-runtime/poker-legal-actions.mjs",
    "ws-server/poker/snapshot-runtime/poker-state-utils.mjs",
    "ws-server/poker/snapshot-runtime/poker-state-write.mjs",
    "ws-server/poker/snapshot-runtime/poker-turn-timeout.mjs",
    "ws-server/poker/snapshot-runtime/poker-reducer.mjs",
    "ws-server/poker/snapshot-runtime/poker-payout.mjs",
    "ws-server/poker/snapshot-runtime/poker-materialize-showdown.mjs",
    "ws-server/poker/snapshot-runtime/poker-showdown.mjs",
    "ws-server/poker/snapshot-runtime/poker-inactivity-policy.mjs",
    "ws-server/poker/snapshot-runtime/poker-engine.mjs",
    "ws-server/poker/snapshot-runtime/poker-eval.mjs",
    "ws-server/poker/snapshot-runtime/poker-side-pots.mjs"
  ];

  for (const runtimeFile of runtimeFiles) {
    const text = fs.readFileSync(runtimeFile, "utf8");
    assert.doesNotMatch(
      text,
      /netlify\/functions\/_shared\//,
      `WS runtime boundary: ${runtimeFile} must not import repo-root netlify/functions/_shared modules`
    );
  }
});


test("ws server leave path avoids static shared/netlify runtime imports", () => {
  const serverText = fs.readFileSync("ws-server/server.mjs", "utf8");
  const adapterText = fs.readFileSync("ws-server/poker/persistence/authoritative-leave-adapter.mjs", "utf8");

  assert.doesNotMatch(serverText, /from\s+["']\.\.\/shared\/poker-domain\/leave\.mjs["']/);
  assert.doesNotMatch(serverText, /from\s+["']\.\/poker\/persistence\/authoritative-leave-adapter\.mjs["']/);
  assert.match(serverText, /import\(["']\.\/poker\/persistence\/authoritative-leave-adapter\.mjs["']\)/);

  assert.doesNotMatch(adapterText, /from\s+["']\.\.\.\/\.\.\.\/netlify\/functions\/_shared\//);
  assert.doesNotMatch(adapterText, /from\s+["']\.\.\.\/\.\.\.\/shared\/poker-domain\/leave\.mjs["']/);
  assert.match(adapterText, /modulePath\s*=\s*configuredPath\s*\|\|\s*["']\.\.\/\.\.\/shared\/poker-domain\/leave\.mjs["']/);
  assert.doesNotMatch(adapterText, /import\(["']\.\.\/\.\.\/\.\.\/shared\/poker-domain\/leave\.mjs["']\)/);
  assert.doesNotMatch(adapterText, /try\s*\{[\s\S]*import\(["']\.\.\/\.\.\/shared\/poker-domain\/leave\.mjs["']\)[\s\S]*\}\s*catch/);
});

test("ws authoritative leave adapter imports with ws-server dependency graph", () => {
  const output = execFileSync(
    process.execPath,
    ["-e", "import('./ws-server/poker/persistence/authoritative-leave-adapter.mjs').then(() => process.stdout.write('ok'))"],
    { encoding: "utf8" }
  );
  assert.equal(output.trim(), "ok");
});


test("ws deploy artifact contract includes authoritative leave runtime files", () => {
  const deployWorkflow = fs.readFileSync(".github/workflows/ws-server-deploy.yml", "utf8");
  assert.match(deployWorkflow, /cp -R shared\/poker-domain "\$STAGE_DIR"\/shared\/poker-domain/);
  assert.match(deployWorkflow, /cp netlify\/functions\/_shared\/chips-ledger\.mjs "\$STAGE_DIR"\/netlify\/functions\/_shared\//);
  assert.match(deployWorkflow, /cp netlify\/functions\/_shared\/poker-\*\.mjs "\$STAGE_DIR"\/netlify\/functions\/_shared\//);
  assert.match(deployWorkflow, /cp netlify\/functions\/_shared\/supabase-admin\.mjs "\$STAGE_DIR"\/netlify\/functions\/_shared\//);
  assert.doesNotMatch(deployWorkflow, /cp -R netlify\/functions\/_shared "\$STAGE_DIR"\/netlify\/functions\/_shared/);
});

test("ws authoritative leave executor non-override path resolves real module loader contract", async () => {
  const { createAuthoritativeLeaveExecutor } = await import("../ws-server/poker/persistence/authoritative-leave-adapter.mjs");
  let loaderCalled = 0;
  let beginCalled = 0;
  const executor = createAuthoritativeLeaveExecutor({
    env: {},
    loadAuthoritativeLeaveModule: async () => {
      loaderCalled += 1;
      return {
        executePokerLeave: async ({ beginSql, tableId, userId, requestId, includeState }) => {
          const txResult = await beginSql(async () => ({ ok: true }));
          return {
            ok: true,
            tableId,
            userId,
            requestId,
            includeState,
            txOk: txResult.ok,
            state: {
              version: 1,
              state: {
                tableId,
                seats: [{ seatNo: 2, userId: "u2" }]
              }
            }
          };
        }
      };
    },
    beginSql: async (fn) => {
      beginCalled += 1;
      return fn({});
    }
  });

  const result = await executor({ tableId: "t1", userId: "u1", requestId: "r1" });
  assert.equal(loaderCalled, 1);
  assert.equal(beginCalled, 1);
  assert.equal(result.ok, true);
  assert.equal(result.includeState, true);
  assert.notEqual(result.code, "temporarily_unavailable");
  assert.equal(result.state.state.seats.some((seat) => seat.userId === "u1"), false);
});


test("ws authoritative leave adapter default loader resolves in artifact-shaped layout", async () => {
  const stageDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ws-artifact-leave-"));
  const srcAdapter = "ws-server/poker/persistence/authoritative-leave-adapter.mjs";

  try {
    const stagedAdapter = path.join(stageDir, "poker/persistence/authoritative-leave-adapter.mjs");
    const stagedBootstrap = path.join(stageDir, "poker/bootstrap/persisted-bootstrap-db.mjs");
    const stagedLeave = path.join(stageDir, "shared/poker-domain/leave.mjs");

    await fsp.mkdir(path.dirname(stagedAdapter), { recursive: true });
    await fsp.mkdir(path.dirname(stagedBootstrap), { recursive: true });
    await fsp.mkdir(path.dirname(stagedLeave), { recursive: true });

    await fsp.copyFile(srcAdapter, stagedAdapter);
    await fsp.writeFile(stagedBootstrap, "export async function beginSqlWs(fn) { return fn({}); }\n", "utf8");
    await fsp.writeFile(
      stagedLeave,
      "export async function executePokerLeave() { return { ok: true, tableId: 'artifact_table', state: { version: 1, state: { tableId: 'artifact_table', seats: [{ seatNo: 2, userId: 'u2' }] } } }; }\n",
      "utf8"
    );

    const adapterModule = await import(pathToFileURL(stagedAdapter).href);
    const execute = adapterModule.createAuthoritativeLeaveExecutor({
      env: {},
      beginSql: async (fn) => fn({}),
      klog: () => {}
    });

    const result = await execute({ tableId: "artifact_table", userId: "u1", requestId: "r1" });
    assert.equal(result.ok, true);
    assert.notEqual(result.code, "temporarily_unavailable");
    assert.equal(result.state.state.seats.some((seat) => seat.userId === "u1"), false);
  } finally {
    await fsp.rm(stageDir, { recursive: true, force: true });
  }
});


test("ws-local leave wrapper is the only allowed bridge to repo-root shared leave module", () => {
  const wrapperFile = "ws-server/shared/poker-domain/leave.mjs";
  const wrapperText = fs.readFileSync(wrapperFile, "utf8");
  assert.match(wrapperText, /export\s*\{\s*executePokerLeave\s*\}\s*from\s*["']\.\.\/\.\.\/\.\.\/shared\/poker-domain\/leave\.mjs["']/);

  const wsFiles = fs.readdirSync("ws-server", { recursive: true })
    .filter((entry) => typeof entry === "string" && entry.endsWith('.mjs'))
    .map((entry) => `ws-server/${entry.replaceAll('\\', '/')}`);

  for (const file of wsFiles) {
    if (file === wrapperFile) continue;
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /\.\.\/\.\.\/\.\.\/shared\/poker-domain\/leave\.mjs/, `Only ${wrapperFile} may bridge to repo-root shared leave module`);
  }
});

test("ws-local join wrapper is the only allowed bridge to repo-root shared join module", () => {
  const wrapperFile = "ws-server/shared/poker-domain/join.mjs";
  const wrapperText = fs.readFileSync(wrapperFile, "utf8");
  assert.match(wrapperText, /export\s*\{\s*executePokerJoinAuthoritative\s*\}\s*from\s*["']\.\.\/\.\.\/\.\.\/shared\/poker-domain\/join\.mjs["']/);

  const wsFiles = fs.readdirSync("ws-server", { recursive: true })
    .filter((entry) => typeof entry === "string" && entry.endsWith('.mjs'))
    .map((entry) => `ws-server/${entry.replaceAll('\\', '/')}`);

  for (const file of wsFiles) {
    if (file === wrapperFile) continue;
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /\.\.\/\.\.\/\.\.\/shared\/poker-domain\/join\.mjs/, `Only ${wrapperFile} may bridge to repo-root shared join module`);
  }
});


test("ws dependency guard detects forbidden bridge import", async () => {
  const forbiddenFile = "ws-server/tmp-forbidden-import.mjs";
  await fsp.writeFile(forbiddenFile, 'import { executePokerLeave } from "../../../shared/poker-domain/leave.mjs";\n', "utf8");

  try {
    const wrapperFile = "ws-server/shared/poker-domain/leave.mjs";
    const wsFiles = fs.readdirSync("ws-server", { recursive: true })
      .filter((entry) => typeof entry === "string" && entry.endsWith('.mjs'))
      .map((entry) => `ws-server/${entry.replaceAll('\\', '/')}`);

    const violators = wsFiles
      .filter((file) => file !== wrapperFile)
      .filter((file) => /\.\.\/\.\.\/\.\.\/shared\/poker-domain\/leave\.mjs/.test(fs.readFileSync(file, "utf8")));

    assert.ok(violators.includes(forbiddenFile));
  } finally {
    await fsp.rm(forbiddenFile, { force: true });
  }
});


test("workflow trigger boundary includes shared join and netlify helper surfaces", () => {
  const prWorkflow = fs.readFileSync(".github/workflows/ws-pr-checks.yml", "utf8");
  const deployWorkflow = fs.readFileSync(".github/workflows/ws-deploy.yml", "utf8");

  for (const text of [prWorkflow, deployWorkflow]) {
    assert.match(text, /"shared\/\*\*"/);
    assert.match(text, /"netlify\/functions\/_shared\/\*\*"/);
    assert.match(text, /"docs\/ws-poker-protocol\.md"/);
  }
});
