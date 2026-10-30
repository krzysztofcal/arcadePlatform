import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-server-deploy.yml", "utf8");
}

test("ws-server deploy workflow has guarded triggers, secrets and concurrency", () => {
  const text = workflowText();

  assert.match(text, /scripts\/ci-impact\.mjs/);
  assert.match(text, /needs\.impact\.outputs\.ws_poker == 'true'/);
  assert.match(text, /cp -R ws-server\/observability "\$STAGE_WS_DIR"\/observability/);
  assert.match(text, /concurrency:\n\s+group: ws-server-\$\{\{ github\.ref \}\}/);
  assert.match(text, /permissions:\n\s+contents: read/);
  assert.match(text, /RELEASE_ENVIRONMENT: production/);
  assert.match(text, /release-metadata\.json/);
  assert.match(text, /releaseSha: process\.env\.RELEASE_SHA/);
  assert.match(text, /deployRef: process\.env\.DEPLOY_REF/);

  assert.match(text, /host: \$\{\{ secrets\.WS_HOST \}\}/);
  assert.match(text, /username: \$\{\{ secrets\.WS_USER \}\}/);
  assert.match(text, /key: \$\{\{ secrets\.WS_SSH_KEY \}\}/);
});

test("workflow separates validate and deploy with dependency gating", () => {
  const text = workflowText();

  assert.match(text, /validate:/);
  assert.match(text, /deploy:/);
  assert.doesNotMatch(text, /validate:\n\s+if: github\.event_name == 'pull_request'/);
  assert.match(text, /deploy:\n\s+needs: \[impact, validate\]/);
  assert.match(text, /needs\.impact\.outputs\.deploy_ws == 'true'/);
  assert.match(text, /\n  push:\n\s+branches: \[ main \]/);
  assert.match(text, /\n  workflow_dispatch:\n\s+inputs:\n\s+releaseSha:[\s\S]*?required: true[\s\S]*?confirmation:[\s\S]*?required: true/);
});

test("ordinary main push or merge never deploys WS Production; only an OWNER main dispatch can", () => {
  const text = workflowText();
  const deploy = text.slice(text.indexOf("  deploy:"));
  const condition = deploy.match(/\n    if: \$\{\{ (.+) \}\}\n/)[1];
  assert.doesNotMatch(condition, /'push'|\|\|/, "deploy condition must be a pure conjunction without push");
  for (const clause of [
    "needs.impact.outputs.deploy_ws == 'true'",
    "github.event_name == 'workflow_dispatch'",
    "github.ref == 'refs/heads/main'",
    "github.actor == 'krzysztofcal'",
    "github.triggering_actor == 'krzysztofcal'",
  ]) assert.ok(condition.split(' && ').includes(clause), clause);
});

test("deploy authorizes the exact current main SHA before any VPS mutation", () => {
  const text = workflowText();
  const deploy = text.slice(text.indexOf("  deploy:"));
  const authorize = deploy.indexOf("name: Authorize exact approved main release");
  assert.ok(authorize > 0);
  for (const marker of ["Pre-stage shared deploy/maintenance lock on VPS", "uses: appleboy/scp-action@v0.1.7", "Atomic release switch + restart + health gate on VPS"]) {
    assert.ok(authorize < deploy.indexOf(marker), marker);
  }
  const step = deploy.slice(authorize, deploy.indexOf("name: Setup Node", authorize));
  // Inputs reach bash only through env, never by expression interpolation into the script.
  assert.match(step, /RELEASE_SHA_INPUT: \$\{\{ inputs\.releaseSha \}\}/);
  assert.match(step, /RELEASE_CONFIRMATION: \$\{\{ inputs\.confirmation \}\}/);
  assert.doesNotMatch(step.slice(step.indexOf("run: |")), /\$\{\{/);
  assert.match(step, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(step, /"\$RELEASE_SHA_INPUT" == "\$GITHUB_SHA"/);
  assert.match(step, /"\$\(git rev-parse HEAD\)" == "\$RELEASE_SHA_INPUT"/);
  assert.match(step, /"\$RELEASE_CONFIRMATION" == "DEPLOY WS PRODUCTION \$RELEASE_SHA_INPUT"/);
  assert.match(step, /git ls-remote origin refs\/heads\/main/);
  assert.match(step, /"\$MAIN_HEAD" == "\$RELEASE_SHA_INPUT"/);
  // main can advance during packaging/upload: recheck directly before the release switch.
  const revalidate = deploy.indexOf("name: Revalidate current main HEAD before release switch");
  assert.ok(deploy.indexOf("uses: appleboy/scp-action@v0.1.7") < revalidate, "recheck after upload");
  const recheck = deploy.slice(revalidate, deploy.indexOf("- name:", revalidate + 1));
  assert.match(recheck, /git ls-remote origin refs\/heads\/main/);
  assert.match(recheck, /"\$MAIN_HEAD" == "\$GITHUB_SHA"/);
  assert.equal(deploy.indexOf("- name:", revalidate + 1), deploy.indexOf("- name: Atomic release switch + restart + health gate on VPS"), "no step between recheck and switch");
  // The released artifact and VPS release id stay bound to the authorized revision.
  assert.equal((deploy.match(/RELEASE_SHA: \$\{\{ github\.sha \}\}/g) || []).length, 2);
});

test("main push with WS deploy surface reports that Production was not deployed", () => {
  const text = workflowText();
  const validate = text.slice(text.indexOf("  validate:"), text.indexOf("  deploy:"));
  assert.match(validate, /if: \$\{\{ github\.event_name == 'push' && needs\.impact\.outputs\.deploy_ws == 'true' \}\}[\s\S]*?WS Production was NOT deployed/);
});

test("workflow includes rollback discipline and atomic current switch markers", () => {
  const text = workflowText();

  assert.match(text, /trap 'on_error' ERR/);
  assert.match(text, /rollback\(\)/);
  assert.match(text, /NEW_RELEASE_APP_DIR="\$NEW_RELEASE_DIR\/ws-server"/);
  assert.match(text, /ln -sfn "\$NEW_RELEASE_APP_DIR" "\$CURRENT_LINK\.tmp"/);
  assert.match(text, /mv -Tf "\$CURRENT_LINK\.tmp" "\$CURRENT_LINK"/);
});
