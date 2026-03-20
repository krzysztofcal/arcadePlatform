import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-deploy.yml", "utf8");
}

function fileText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

const repoRootDockerArgsPattern = /wsDockerBuildArgs\(imageTag\)/;

function requiredStep(text, stepName) {
  const marker = `- name: ${stepName}`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `Missing required workflow step: ${stepName}`);
  const remainder = text.slice(start);
  const next = remainder.indexOf("\n      - name:", marker.length);
  return next === -1 ? remainder : remainder.slice(0, next);
}

function assertHarnessBuildContract(text) {
  assert.match(text, /WS_DOCKER_BUILD_CONTEXT: "\."/);
  assert.match(text, /WS_DOCKERFILE_PATH: "ws-server\/Dockerfile"/);
  assert.doesNotMatch(text, /context:\s*\.\/ws-server/);

  const stepText = requiredStep(text, "Validate shared WS Docker build contract (repo-root context)");
  assert.match(stepText, /docker build[^\n]*arcadeplatform-ws-contract:\$\{\{ github\.sha \}\}[^\n]*-f "\$WS_DOCKERFILE_PATH" "\$WS_DOCKER_BUILD_CONTEXT"/);
  assert.doesNotMatch(stepText, /docker build[^\n]*-f ws-server\/Dockerfile \.\/ws-server/);
}

function assertNoSyntheticProductionImageStep(text) {
  assert.doesNotMatch(text, /- name: Build & Push Docker Image/);
  assert.doesNotMatch(text, /docker build[^\n]*arcadeplatform-ws-prod:/);
}

test("ws-deploy keeps ws-tests trigger surface and runs harness checks", () => {
  const text = workflowText();

  assert.match(text, /"ws-tests\/\*\*"/);
  assert.match(text, /"shared\/\*\*"/);
  assert.match(text, /"poker\/\*\*"/);
  assert.match(text, /"tests\/\*\*"/);
  assert.match(text, /"netlify\/functions\/_shared\/\*\*"/);
  assert.match(text, /"docs\/ws-poker-protocol\.md"/);
  assert.match(text, /"\.github\/workflows\/ws-pr-checks\.yml"/);
  assert.match(text, /"\.github\/workflows\/ws-deploy\.yml"/);

  const pushBlockMatch = text.match(/on:\n[\s\S]*?push:\n([\s\S]*?)\njobs:/);
  const pushBlock = pushBlockMatch ? pushBlockMatch[1] : "";
  assert.match(pushBlock, /"ws-server\/\*\*"/);
  assert.match(pushBlock, /"shared\/\*\*"/);
  assert.match(pushBlock, /"poker\/\*\*"/);
  assert.match(pushBlock, /"tests\/\*\*"/);
  assert.match(pushBlock, /"netlify\/functions\/_shared\/\*\*"/);
  assert.match(pushBlock, /"docs\/ws-poker-protocol\.md"/);

  assert.match(text, /node --test ws-tests\/ws-deploy-workflow\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-tests-suite-completeness\.guard\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-production-deploy-collision\.guard\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-deploy\.no-prod-mutation-on-ws-tests\.guard\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-server-deploy-artifact-path\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-server-deploy-rollout\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-docker-leave-runtime\.guard\.test\.mjs/);
  assert.match(text, /node --test shared\/poker-domain\/join\.behavior\.test\.mjs/);
  assert.match(text, /Run poker ws client behavior test/);
  assert.match(text, /node --test tests\/poker-ws-client\.test\.mjs/);
  assert.match(text, /Run poker UI ws join smoke test/);
  assert.match(text, /node --test tests\/poker-ui-ws-join-smoke\.behavior\.test\.mjs/);
  assert.match(text, /Run poker UI ws act smoke test/);
  assert.match(text, /node --test tests\/poker-ui-ws-act-smoke\.behavior\.test\.mjs/);
  assert.match(text, /Run poker UI ws write-path guard test/);
  assert.match(text, /node --test tests\/poker-ui-ws-write-path\.guard\.test\.mjs/);
  assert.match(text, /Run poker UI ws leave smoke test/);
  assert.match(text, /node --test tests\/poker-ui-ws-leave-smoke\.behavior\.test\.mjs/);
  assert.doesNotMatch(text, /node --test tests\/poker-ui-ws-health-fallback\.behavior\.test\.mjs/);
  assert.doesNotMatch(text, /node --test tests\/poker-ui-ws-startup-order\.behavior\.test\.mjs/);
  assert.doesNotMatch(text, /node --test tests\/poker-ui-ws-snapshot-equal-version\.behavior\.test\.mjs/);
  assert.doesNotMatch(text, /node --test tests\/poker-ui-ws-auth-watch-order\.behavior\.test\.mjs/);
  assert.doesNotMatch(text, /node --test tests\/poker-ui-ws-visibility\.behavior\.test\.mjs/);
  assert.match(text, /Run ws join runtime behavior test/);
  assert.match(text, /node --test ws-tests\/ws-join-runtime\.behavior\.test\.mjs/);
  assertHarnessBuildContract(text);
  assertNoSyntheticProductionImageStep(text);
  assert.match(text, /Run state-patch behavior test/);
  assert.match(text, /node --test ws-server\/poker\/read-model\/state-patch\.behavior\.test\.mjs/);
  assert.match(text, /Run stream-log behavior test/);
  assert.match(text, /node --test ws-server\/poker\/runtime\/stream-log\.behavior\.test\.mjs/);
  assert.match(text, /Run ws table behavior test/);
  assert.match(text, /node --test ws-server\/poker\/table\/table\.behavior\.test\.mjs/);
  assert.match(text, /Run ws table snapshot behavior test/);
  assert.match(text, /node --test ws-server\/poker\/table\/table-snapshot\.behavior\.test\.mjs/);
  assert.match(text, /Run ws poker engine bootstrap behavior test/);
  assert.match(text, /node --test ws-server\/poker\/engine\/engine-bootstrap\.behavior\.test\.mjs/);
  assert.match(text, /Run ws poker engine act behavior test/);
  assert.match(text, /node --test ws-server\/poker\/engine\/engine-act\.behavior\.test\.mjs/);
  assert.match(text, /Run ws poker engine rollover behavior test/);
  assert.match(text, /node --test ws-server\/poker\/engine\/engine-rollover\.behavior\.test\.mjs/);
  assert.match(text, /Run ws poker engine timeout behavior test/);
  assert.match(text, /node --test ws-server\/poker\/engine\/engine-timeout\.behavior\.test\.mjs/);
  assert.match(text, /Run ws join handler behavior test/);
  assert.match(text, /node --test ws-server\/poker\/handlers\/join\.behavior\.test\.mjs/);
  assert.match(text, /Run ws start-hand handler behavior test/);
  assert.match(text, /node --test ws-server\/poker\/handlers\/start-hand\.behavior\.test\.mjs/);
  assert.match(text, /Run ws act handler behavior test/);
  assert.match(text, /node --test ws-server\/poker\/handlers\/act\.behavior\.test\.mjs/);

  assert.match(text, /npm ci --prefix ws-server/);
  assert.doesNotMatch(text, /\n\s*run:\s*npm ci\n/);
});

test("ws-deploy is non-mutating for production", () => {
  const text = workflowText();

  assert.doesNotMatch(text, /docker\/login-action@/);
  assert.doesNotMatch(text, /docker\/build-push-action@/);
  assert.doesNotMatch(text, /appleboy\/ssh-action@/);
  assert.doesNotMatch(text, /appleboy\/scp-action@/);
  assert.doesNotMatch(text, /dorny\/paths-filter@/);
});


test("ws Dockerfile keeps ws-server deploy context-compatible copy contract", () => {
  const dockerfile = fs.readFileSync("ws-server/Dockerfile", "utf8");
  assert.match(dockerfile, /COPY ws-server\/package\.json ws-server\/package-lock\.json \.\//);
  assert.match(dockerfile, /COPY ws-server \.\//);
  assert.match(dockerfile, /COPY shared\/poker-domain \.\/shared\/poker-domain/);
  assert.match(dockerfile, /COPY netlify\/functions\/_shared\/chips-ledger\.mjs \.\/netlify\/functions\/_shared\//);
  assert.match(dockerfile, /COPY netlify\/functions\/_shared\/poker-\*\.mjs \.\/netlify\/functions\/_shared\//);
  assert.match(dockerfile, /COPY netlify\/functions\/_shared\/supabase-admin\.mjs \.\/netlify\/functions\/_shared\//);
  assert.doesNotMatch(dockerfile, /COPY shared \.\/shared/);
  assert.doesNotMatch(dockerfile, /COPY netlify\/functions\/_shared \.\/netlify\/functions\/_shared/);
  assert.match(dockerfile, /CMD \["node", "ws-server\/server\.mjs"\]/);
  assert.doesNotMatch(dockerfile, /COPY package\.json package-lock\.json \.\//);
  assert.doesNotMatch(dockerfile, /npm ci --omit=dev --ignore-scripts/);
});

test("repo-root docker build contract excludes host ws-server/node_modules artifacts", () => {
  const dockerignore = fs.readFileSync(".dockerignore", "utf8");
  assert.match(dockerignore, /ws-server\/node_modules/);
  assert.match(dockerignore, /\*\*\/node_modules/);
});


test("ws-deploy trigger surface includes ws-server runtime changes", () => {
  const text = workflowText();
  const pushBlockMatch = text.match(/on:\n[\s\S]*?push:\n([\s\S]*?)\njobs:/);
  const pushBlock = pushBlockMatch ? pushBlockMatch[1] : "";
  assert.match(pushBlock, /"ws-server\/\*\*"/);
  assert.match(pushBlock, /"shared\/\*\*"/);
  assert.match(pushBlock, /"poker\/\*\*"/);
  assert.match(pushBlock, /"tests\/\*\*"/);
  assert.match(pushBlock, /"netlify\/functions\/_shared\/\*\*"/);
  assert.match(pushBlock, /"docs\/ws-poker-protocol\.md"/);
});


test("ws-deploy keeps Docker artifact contract parity with repo-root context", () => {
  const text = workflowText();

  assertHarnessBuildContract(text);
  assertNoSyntheticProductionImageStep(text);
});


test("ws-deploy runs runtime deps guard test and shared join behavior test before ws behavior test", () => {
  const text = workflowText();
  const guardIndex = text.indexOf("node --test ws-tests/ws-server-package-runtime-deps.guard.test.mjs");
  const sharedJoinBehaviorIndex = text.indexOf("node --test shared/poker-domain/join.behavior.test.mjs");
  const behaviorIndex = text.indexOf("node --test ws-server/server.behavior.test.mjs");
  assert.notEqual(guardIndex, -1);
  assert.notEqual(sharedJoinBehaviorIndex, -1);
  assert.notEqual(behaviorIndex, -1);
  assert.equal(guardIndex < sharedJoinBehaviorIndex, true);
  assert.equal(sharedJoinBehaviorIndex < behaviorIndex, true);
});


test("ws-deploy shared authoritative join dependency is trigger-covered and artifact-covered", () => {
  const text = workflowText();
  const pushBlockMatch = text.match(/on:\n[\s\S]*?push:\n([\s\S]*?)\njobs:/);
  const pushBlock = pushBlockMatch ? pushBlockMatch[1] : "";

  assert.match(pushBlock, /"shared\/\*\*"/);
  assertHarnessBuildContract(text);
  assertNoSyntheticProductionImageStep(text);
  assert.match(text, /node --test shared\/poker-domain\/join\.behavior\.test\.mjs/);
  assert.match(text, /Run poker ws client behavior test/);
  assert.match(text, /node --test tests\/poker-ws-client\.test\.mjs/);
  assert.match(text, /Run poker UI ws join smoke test/);
  assert.match(text, /node --test tests\/poker-ui-ws-join-smoke\.behavior\.test\.mjs/);
  assert.match(text, /Run poker UI ws act smoke test/);
  assert.match(text, /node --test tests\/poker-ui-ws-act-smoke\.behavior\.test\.mjs/);
  assert.match(text, /Run poker UI ws write-path guard test/);
  assert.match(text, /node --test tests\/poker-ui-ws-write-path\.guard\.test\.mjs/);
  assert.match(text, /Run poker UI ws leave smoke test/);
  assert.match(text, /node --test tests\/poker-ui-ws-leave-smoke\.behavior\.test\.mjs/);
  assert.doesNotMatch(text, /node --test tests\/poker-ui-ws-health-fallback\.behavior\.test\.mjs/);
  assert.doesNotMatch(text, /node --test tests\/poker-ui-ws-startup-order\.behavior\.test\.mjs/);
  assert.doesNotMatch(text, /node --test tests\/poker-ui-ws-snapshot-equal-version\.behavior\.test\.mjs/);
  assert.doesNotMatch(text, /node --test tests\/poker-ui-ws-auth-watch-order\.behavior\.test\.mjs/);
  assert.doesNotMatch(text, /node --test tests\/poker-ui-ws-visibility\.behavior\.test\.mjs/);
  assert.match(text, /node --test ws-tests\/ws-image-contains-protocol\.behavior\.test\.mjs/);
});

test("ws image tests and deploy workflow use the same repo-root Docker build contract", () => {
  const workflow = workflowText();
  const imageTest = fileText("ws-tests/ws-image-contains-protocol.behavior.test.mjs");
  const containerStartsTest = fileText("ws-tests/ws-container-starts.behavior.test.mjs");
  const helper = fileText("ws-tests/ws-docker-build-contract.mjs");

  assertHarnessBuildContract(workflow);
  assertNoSyntheticProductionImageStep(workflow);
  assert.match(helper, /const WS_DOCKERFILE_PATH = "ws-server\/Dockerfile"/);
  assert.match(helper, /const WS_DOCKER_BUILD_CONTEXT = "\."/);
  assert.match(helper, /function wsDockerBuildArgs\(imageTag\)/);
  assert.match(imageTest, /import \{ wsDockerBuildArgs \} from "\.\/ws-docker-build-contract\.mjs"/);
  assert.match(containerStartsTest, /import \{ wsDockerBuildArgs \} from "\.\/ws-docker-build-contract\.mjs"/);
  assert.match(imageTest, repoRootDockerArgsPattern);
  assert.match(containerStartsTest, repoRootDockerArgsPattern);
  assert.doesNotMatch(imageTest, /docker", \["build", "-t", imageTag, "-f", "ws-server\/Dockerfile", "\.\/ws-server"\]/);
  assert.doesNotMatch(containerStartsTest, /docker", \["build", "-t", imageTag, "-f", "ws-server\/Dockerfile", "\.\/ws-server"\]/);
});
