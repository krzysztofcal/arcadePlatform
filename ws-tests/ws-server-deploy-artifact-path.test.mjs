import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WORKFLOW_PATH = ".github/workflows/ws-server-deploy.yml";

function readWorkflow() {
  return fs.readFileSync(WORKFLOW_PATH, "utf8");
}

test("artifact path after scp-action untar is supported by remote script", async () => {
  const text = readWorkflow();
  const match = text.match(/TMP_ARCHIVE="([^"]+)"/);
  assert.ok(match, "workflow should define TMP_ARCHIVE");
  const configuredArchivePath = match[1];

  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ws-deploy-artifact-"));
  const targetDir = path.join(tmpRoot, "tmpTarget");
  const expectedRelative = path.join(".artifacts", "ws-server", "ws-server-dist.tgz");
  const finalPath = path.join(targetDir, expectedRelative);

  await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });
  await fs.promises.writeFile(finalPath, "fake-archive");

  const simulatedRemoteArchivePath = path.join("/tmp/arcadeplatform-ws", expectedRelative).replaceAll("\\", "/");

  assert.equal(configuredArchivePath, simulatedRemoteArchivePath);
  assert.ok(fs.existsSync(finalPath), "simulated SCP output archive should exist");
  assert.notEqual(configuredArchivePath, "/tmp/arcadeplatform-ws/ws-server-dist.tgz");
});
