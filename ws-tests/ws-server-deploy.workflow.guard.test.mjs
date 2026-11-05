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

  // #1159 T004: the Production VPS key exists only in the approved ws-production environment.
  const deploy = text.slice(text.indexOf("  deploy:"));
  assert.match(deploy, /\n    environment: ws-production\n/);
  assert.equal((deploy.match(/host: \$\{\{ secrets\.WS_PRODUCTION_HOST \}\}/g) || []).length, 6);
  assert.equal((deploy.match(/username: \$\{\{ secrets\.WS_PRODUCTION_USER \}\}/g) || []).length, 6);
  assert.equal((deploy.match(/key: \$\{\{ secrets\.WS_PRODUCTION_SSH_KEY \}\}/g) || []).length, 6);
  assert.doesNotMatch(text, /secrets\.WS_(?:HOST|USER|SSH_KEY)\b/);
  assert.doesNotMatch(deploy, /copilot/);
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

test("ordinary main push or merge never deploys WS Production; only an owner or release-agent main dispatch can", () => {
  const text = workflowText();
  const deploy = text.slice(text.indexOf("  deploy:"));
  const condition = deploy.match(/\n    if: \$\{\{ (.+) \}\}\n/)[1];
  assert.doesNotMatch(condition, /'push'/);
  // Evaluate the real expression: only the same identity may dispatch and re-run (owner/owner or agent/agent).
  const evaluate = ({ actor, triggeringActor, agent, event = "workflow_dispatch", ref = "refs/heads/main", deployWs = "true" }) => {
    const js = condition
      .replaceAll("needs.impact.outputs.deploy_ws", JSON.stringify(deployWs))
      .replaceAll("github.event_name", JSON.stringify(event))
      .replaceAll("github.ref", JSON.stringify(ref))
      .replaceAll("github.triggering_actor", JSON.stringify(triggeringActor))
      .replaceAll("github.actor", JSON.stringify(actor))
      .replaceAll("github.repository_owner", JSON.stringify("krzysztofcal"))
      .replaceAll("vars.WS_RELEASE_AGENT", JSON.stringify(agent))
      .replaceAll("'", "\"")
      .replaceAll(" == ", " === ")
      .replaceAll(" != ", " !== ");
    assert.match(js, /^[\s"a-z0-9_\-/[\].()|&=!]+$/i, js);
    return Function(`return (${js});`)();
  };
  const owner = "krzysztofcal";
  const bot = "arcade-release-agent[bot]";
  assert.equal(evaluate({ actor: owner, triggeringActor: owner, agent: bot }), true);
  assert.equal(evaluate({ actor: bot, triggeringActor: bot, agent: bot }), true);
  assert.equal(evaluate({ actor: owner, triggeringActor: bot, agent: bot }), false, "agent re-run of an owner run");
  assert.equal(evaluate({ actor: bot, triggeringActor: owner, agent: bot }), false, "owner re-run of an agent run");
  assert.equal(evaluate({ actor: owner, triggeringActor: owner, agent: "" }), true);
  assert.equal(evaluate({ actor: "", triggeringActor: "", agent: "" }), false, "an unset agent variable never matches");
  assert.equal(evaluate({ actor: "someone", triggeringActor: "someone", agent: bot }), false);
  assert.equal(evaluate({ actor: bot, triggeringActor: bot, agent: bot, ref: "refs/heads/feature" }), false);
  assert.equal(evaluate({ actor: owner, triggeringActor: owner, agent: bot, event: "push" }), false);
  assert.equal(evaluate({ actor: owner, triggeringActor: owner, agent: bot, deployWs: "false" }), false);
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
  assert.ok(deploy.indexOf("name: Prepare running WS for the release on VPS") < revalidate, "prepare before the final recheck");
  // The released artifact, the VPS release id, the resumed release and the release receipt stay bound to the
  // authorized revision.
  assert.equal((deploy.match(/RELEASE_SHA: \$\{\{ github\.sha \}\}/g) || []).length, 4);
});

test("the WS release receipt is recorded last, only after a verified release, and holds no secret (#1159 Addendum B)", () => {
  const text = workflowText();
  const deploy = text.slice(text.indexOf("  deploy:"));
  const steps = [...deploy.matchAll(/\n      - name: ([^\n]+)/g)].map((m) => m[1]);
  assert.deepEqual(steps.slice(-4), ["Resume new hands after the verified release on VPS", "Abort the release before the switch on VPS", "Record the WS release receipt", "Upload the WS release receipt"]);
  const receipt = deploy.slice(deploy.indexOf("- name: Record the WS release receipt"));
  assert.equal((receipt.match(/if: \$\{\{ success\(\) \}\}/g) || []).length, 2);
  assert.match(receipt, /sha256sum \.artifacts\/ws-server\/ws-server-dist\.tgz/, "the digest of the archive that was uploaded to the VPS");
  assert.match(receipt, /releaseSha: process\.env\.RELEASE_SHA, runId: process\.env\.RELEASE_RUN_ID, environment: "ws-production", distSha256: process\.env\.DIST_SHA256/);
  assert.match(receipt, /name: ws-release-receipt\n\s+path: \.artifacts\/ws-release-receipt\/ws-release-receipt\.json/);
  assert.doesNotMatch(receipt, /secrets\.|appleboy|ssh|gh release|contents: write/);
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

test("approved release runs prepare → switching → gated restart → resume only on success, abort only before the switch", () => {
  const text = workflowText();
  const deploy = text.slice(text.indexOf("  deploy:"));
  const step = (name) => {
    const start = deploy.indexOf(`- name: ${name}`);
    assert.ok(start > 0, name);
    const next = deploy.indexOf("\n      - name:", start + 1);
    return { start, body: deploy.slice(start, next === -1 ? undefined : next) };
  };
  const prepare = step("Prepare running WS for the release on VPS");
  const atomic = step("Atomic release switch + restart + health gate on VPS");
  const smoke = step("Smoke-check ws.kcswh.pl WebSocket handshake from runner");
  const resume = step("Resume new hands after the verified release on VPS");
  const abort = step("Abort the release before the switch on VPS");
  assert.ok(step("Upload ws-server artifact to VPS").start < prepare.start && prepare.start < atomic.start && atomic.start < smoke.start && smoke.start < resume.start && resume.start < abort.start);

  assert.match(prepare.body, /\n        id: prepare\n/);
  assert.match(prepare.body, /RELEASE_RUN_ID: \$\{\{ github\.run_id \}\}/);
  assert.match(prepare.body, /sudo -n \/usr\/local\/sbin\/arcade-ws-restart-gate prepare "\$RELEASE_RUN_ID"/);
  assert.match(prepare.body, /\[ "\$PREPARE_RESULT" = "PREPARED" \] \|\| \{[^}]*exit 1; \}/);

  // The point of no return is marked by root after the gate check and before the link changes.
  const gateIdx = atomic.body.indexOf('RESTART_GATE="$(sudo -n /usr/local/sbin/arcade-ws-restart-gate check || true)"');
  const switchMarkIdx = atomic.body.indexOf('SWITCH_RESULT="$(sudo -n /usr/local/sbin/arcade-ws-restart-gate switching "$RELEASE_RUN_ID" || true)"');
  const linkIdx = atomic.body.indexOf('ln -sfn "$NEW_RELEASE_APP_DIR" "$CURRENT_LINK.tmp"');
  assert.ok(gateIdx !== -1 && gateIdx < switchMarkIdx && switchMarkIdx < linkIdx);
  assert.match(atomic.body.slice(switchMarkIdx, linkIdx), /!= "SWITCH_MARKED"[\s\S]*STOP: switch not marked; nothing switched[\s\S]*exit 1/);
  assert.match(atomic.body, /envs: RELEASE_SHA,RELEASE_RUN_ID,WS_REMOTE_TMP_DIR/);

  assert.match(resume.body, /\n        if: \$\{\{ success\(\) \}\}\n/);
  assert.match(resume.body, /arcade-ws-restart-gate resume "\$RELEASE_RUN_ID" "\$RELEASE_SHA"/);
  assert.match(resume.body, /RELEASE_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(resume.body, /\[ "\$RESUME_RESULT" = "RESUMED" \] \|\| \{[^}]*exit 1; \}/);
  assert.match(abort.body, /\n        if: \$\{\{ failure\(\) && steps\.prepare\.outcome == 'success' \}\}\n/);
  assert.match(abort.body, /arcade-ws-restart-gate abort "\$RELEASE_RUN_ID"/);
  assert.match(abort.body, /ABORTED\*\)[^\n]*\n\s+\*\) echo "STOP: hold kept; owner decision \(C7\)"; exit 1 ;;/);
  // Play never reopens unconditionally.
  assert.doesNotMatch(deploy, /always\(\)|continue-on-error/);
});
