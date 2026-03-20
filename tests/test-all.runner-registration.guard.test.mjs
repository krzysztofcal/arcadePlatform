import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = await readFile(path.join(root, "scripts", "test-all.mjs"), "utf8");

assert.match(source, /run\("node", \["tests\/poker-ui\.behavior\.test\.mjs"\],/, "runner should include poker-ui.behavior test");
assert.match(source, /run\("node", \["tests\/poker-ui-ws-join-smoke\.behavior\.test\.mjs"\],/, "runner should include poker-ui ws join smoke test");
assert.match(source, /run\("node", \["tests\/poker-ui-ws-act-smoke\.behavior\.test\.mjs"\],/, "runner should include poker-ui ws act smoke test");
assert.match(source, /run\("node", \["tests\/poker-ui-ws-write-path\.guard\.test\.mjs"\],/, "runner should include poker-ui ws write-path guard test");
assert.doesNotMatch(source, /run\("node", \["tests\/poker-ui-ws-health-fallback\.behavior\.test\.mjs"\],/, "runner should not include removed poker-ui ws health fallback test");
assert.doesNotMatch(source, /run\("node", \["tests\/poker-ui-ws-startup-order\.behavior\.test\.mjs"\],/, "runner should not include removed poker-ui ws startup order test");
assert.doesNotMatch(source, /run\("node", \["tests\/poker-ui-ws-snapshot-equal-version\.behavior\.test\.mjs"\],/, "runner should not include removed poker-ui ws equal-version snapshot test");
assert.doesNotMatch(source, /run\("node", \["tests\/poker-ui-ws-auth-watch-order\.behavior\.test\.mjs"\],/, "runner should not include removed poker-ui ws auth-watch order test");
assert.doesNotMatch(source, /run\("node", \["tests\/poker-ui-ws-visibility\.behavior\.test\.mjs"\],/, "runner should not include removed poker-ui ws visibility test");
assert.doesNotMatch(source, /run\("node", \["tests\/poker-ui-ws-join-authoritative\.behavior\.test\.mjs"\],/, "runner should not include removed poker-ui ws join-authoritative test");
assert.match(source, /run\("node", \["ws-tests\/ws-lobby-join-public-snapshot\.behavior\.test\.mjs"\],/, "runner should include ws lobby join public snapshot test");
assert.match(source, /run\("node", \["tests\/i18n\.behavior\.test\.mjs"\],/, "runner should include i18n.behavior test");
assert.match(source, /run\("node", \["tests\/static-html\.behavior\.test\.mjs"\],/, "runner should include static-html.behavior test");
