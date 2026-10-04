import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const workflowText = () => fs.readFileSync('.github/workflows/ws-server-deploy.yml', 'utf8');
const fileText = path => fs.readFileSync(path, 'utf8');
const repoRootDockerArgsPattern = /wsDockerBuildArgs\(imageTag\)/;

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


test("ws image tests and deploy workflow use the same repo-root Docker build contract", () => {
  const workflow = workflowText();
  const imageTest = fileText("ws-tests/ws-image-contains-protocol.behavior.test.mjs");
  const containerStartsTest = fileText("ws-tests/ws-container-starts.behavior.test.mjs");
  const helper = fileText("ws-tests/ws-docker-build-contract.mjs");

  assert.match(workflow, /docker build[^\n]*-f "\$WS_DOCKERFILE_PATH" "\$WS_DOCKER_BUILD_CONTEXT"/);
  assert.doesNotMatch(workflow, /docker\/build-push-action@|docker\/login-action@/);
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
