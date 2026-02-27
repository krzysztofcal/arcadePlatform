import { test, expect } from "@playwright/test";
import fs from "fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-deploy.yml", "utf8");
}

test("verify step discovers WS container instead of hardcoded name", async () => {
  const text = workflowText();
  expect(text).not.toContain("docker inspect ws");
  expect(text).not.toContain("docker logs ws");
  expect(text).not.toContain("grep '^ws$'");
  expect(text).toContain('label=com.docker.compose.service=ws');
  expect(text).toContain('WS_CID="$(docker ps --filter "label=com.docker.compose.service=ws" --format');
  expect(text).toContain('docker inspect "$WS_CID"');
  expect(text).toContain('docker logs "$WS_CID"');
});

test("workflow runs ws behavior test before build", async () => {
  const text = workflowText();
  expect(text).toContain("npm install --prefix ws-server");
  expect(text).toContain("node --test ws-server/server.behavior.test.mjs");
});

test("verify step enforces bounded smoke check, retries and strict shell", async () => {
  const text = workflowText();
  expect(text).toContain("set -euo pipefail");
  expect(text).toContain("for i in 1 2 3 4 5; do");
  expect(text).toContain("sleep 2");
  expect(text).toContain("timeout 12s docker run --rm --network host node:20-alpine");
  expect(text).toContain('test "$WSCAT_OK" = "1"');
});
