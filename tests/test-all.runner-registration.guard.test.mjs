import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = await readFile(path.join(root, "scripts", "test-all.mjs"), "utf8");

assert.match(source, /run\("node", \["tests\/poker-ui\.behavior\.test\.mjs"\],/, "runner should include poker-ui.behavior test");
assert.match(source, /run\("node", \["tests\/poker-ui-turn-actions\.test\.mjs"\],/, "runner should include poker-ui turn-actions test");
assert.doesNotMatch(
  source,
  /tests\/poker-ui-amount-actions-dom\.behavior\.test\.mjs/,
  "runner should not include legacy poker-ui amount-actions DOM behavior test"
);
assert.doesNotMatch(source, /run\("node", \["tests\/poker-ui-bet-raise-contract\.behavior\.test\.mjs"\],/, "runner should not include redundant poker-ui bet/raise contract behavior test");
assert.doesNotMatch(source, /run\("node", \["tests\/poker-ui-amount-actions-sanitization\.test\.mjs"\],/, "runner should not include redundant poker-ui amount-actions sanitization test");
assert.match(source, /run\("node", \["tests\/poker-ui-ws-join-smoke\.behavior\.test\.mjs"\],/, "runner should include poker-ui ws join smoke test");
assert.doesNotMatch(source, /run\("node", \["tests\/poker-ui-ws-act-smoke\.behavior\.test\.mjs"\],/, "runner should not include poker-ui ws act smoke test after canonical coverage trim");
assert.match(source, /run\("node", \["tests\/poker-ui-ws-write-path\.guard\.test\.mjs"\],/, "runner should include poker-ui ws write-path guard test");
assert.match(source, /run\("node", \["tests\/poker-ui-ws-leave-smoke\.behavior\.test\.mjs"\],/, "runner should include poker-ui ws leave smoke test");
assert.doesNotMatch(source, /run\("node", \["tests\/poker-ui-ws-health-fallback\.behavior\.test\.mjs"\],/, "runner should not include removed poker-ui ws health fallback test");
assert.doesNotMatch(source, /run\("node", \["tests\/poker-ui-ws-startup-order\.behavior\.test\.mjs"\],/, "runner should not include removed poker-ui ws startup order test");
assert.doesNotMatch(source, /run\("node", \["tests\/poker-ui-ws-snapshot-equal-version\.behavior\.test\.mjs"\],/, "runner should not include removed poker-ui ws equal-version snapshot test");
assert.doesNotMatch(source, /run\("node", \["tests\/poker-ui-ws-auth-watch-order\.behavior\.test\.mjs"\],/, "runner should not include removed poker-ui ws auth-watch order test");
assert.doesNotMatch(source, /run\("node", \["tests\/poker-ui-ws-visibility\.behavior\.test\.mjs"\],/, "runner should not include removed poker-ui ws visibility test");
assert.doesNotMatch(source, /run\("node", \["tests\/poker-ui-ws-join-authoritative\.behavior\.test\.mjs"\],/, "runner should not include removed poker-ui ws join-authoritative test");
assert.match(source, /run\("node", \["tests\/poker-ui-no-heartbeat\.guard\.test\.mjs"\],/, "runner should include poker-ui no-heartbeat guard test");
assert.match(source, /run\("node", \["ws-server\/poker\/persistence\/inactive-cleanup-adapter\.behavior\.test\.mjs"\],/, "runner should include ws inactive cleanup adapter behavior test");
assert.match(source, /run\("node", \["ws-server\/poker\/runtime\/disconnect-cleanup\.behavior\.test\.mjs"\],/, "runner should include ws disconnect cleanup runtime behavior test");
assert.match(source, /run\("node", \["ws-server\/poker\/runtime\/accepted-bot-autoplay-adapter\.behavior\.test\.mjs"\],/, "runner should include ws accepted bot autoplay adapter behavior test");
assert.match(source, /run\("node", \["shared\/poker-domain\/inactive-cleanup\.behavior\.test\.mjs"\],/, "runner should include shared poker-domain inactive cleanup behavior test");
assert.doesNotMatch(source, /poker-heartbeat\.behavior\.test\.mjs/, "runner should not include removed heartbeat behavior tests");
assert.doesNotMatch(source, /tests\/poker-sweep\.behavior\.test\.mjs/, "runner should not include removed legacy sweep behavior test");
assert.doesNotMatch(source, /tests\/poker-sweep\..*\.behavior\.test\.mjs/, "runner should not include removed sweep behavior tests");
assert.doesNotMatch(
  source,
  /tests\/poker-sweep\.timeout-zero-amount-inactivates-seat\.behavior\.test\.mjs/,
  "runner should not include removed legacy human timeout sweep test"
);
assert.doesNotMatch(source, /tests\/poker-sweep\.cashout-authoritative\.behavior\.test\.mjs/, "runner should not include removed legacy authoritative timeout sweep test");
assert.doesNotMatch(source, /tests\/poker-contract\.phase1\.test\.mjs/, "runner should not include legacy phase1 contract test");
assert.doesNotMatch(source, /tests\/poker-bots\.leave-after-hand-evicted-on-settle\.behavior\.test\.mjs/, "runner should not include legacy HTTP poker-act settle flow test");
assert.doesNotMatch(source, /tests\/poker-invariants\.test\.mjs/, "runner should not include retired HTTP sweep invariant source checks");
assert.doesNotMatch(source, /tests\/poker-lifecycle\.invariants\.sweep-guards\.behavior\.test\.mjs/, "runner should not include retired HTTP sweep guard behavior test");
assert.doesNotMatch(source, /tests\/poker-lifecycle\.invariants\.sweep-idle-cutoff\.behavior\.test\.mjs/, "runner should not include retired HTTP sweep idle cutoff behavior test");
assert.doesNotMatch(source, /tests\/poker-realtime-fallback\.behavior\.test\.mjs/, "runner should not include legacy HTTP table reload fallback behavior test");
assert.doesNotMatch(source, /tests\/poker-showdown-eligibility-sitout\.test\.mjs/, "runner should not include retired HTTP poker-act source contract test");
assert.match(source, /run\("node", \["ws-tests\/ws-lobby-join-public-snapshot\.behavior\.test\.mjs"\],/, "runner should include ws lobby join public snapshot test");
assert.match(source, /run\("node", \["tests\/i18n\.behavior\.test\.mjs"\],/, "runner should include i18n.behavior test");
assert.match(source, /run\("node", \["tests\/static-html\.behavior\.test\.mjs"\],/, "runner should include static-html.behavior test");

assert.match(source, /run\("node", \["tests\/poker-runtime-docs\.behavior\.test\.mjs"\],/, "runner should include poker runtime docs behavior test");

assert.match(source, /run\("node", \["tests\/poker-ui-requestid-retry\.guard\.test\.mjs"\],/, "runner should include poker ui requestid retry guard test");
assert.match(source, /run\("node", \["tests\/poker-requestid-helper\.guard\.test\.mjs"\],/, "runner should include poker requestid helper guard test");
assert.match(source, /run\("node", \["tests\/poker-idempotency-scope\.guard\.test\.mjs"\],/, "runner should include poker idempotency scope guard test");
assert.match(source, /run\("node", \["tests\/poker-http-retired-contract\.guard\.test\.mjs"\],/, "runner should include retired HTTP gameplay contract guard test");
assert.doesNotMatch(source, /tests\/poker-get-table-nonmutation\.guard\.test\.mjs/, "runner should not include legacy get-table nonmutation guard after retirement");
assert.doesNotMatch(source, /tests\/poker-start-hand-storage\.guard\.test\.mjs/, "runner should not include legacy start-hand storage guard after retirement");
assert.match(source, /run\("node", \["tests\/poker-workflows\.playwright-install\.guard\.test\.mjs"\],/, "runner should include poker workflow playwright-install guard test");
assert.match(source, /run\("node", \["tests\/poker-workflows\.no-http-sweep\.guard\.test\.mjs"\],/, "runner should include poker workflow no-http-sweep guard test");
