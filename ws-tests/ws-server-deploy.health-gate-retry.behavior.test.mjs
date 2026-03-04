import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function workflowText() {
  return fs.readFileSync(".github/workflows/ws-server-deploy.yml", "utf8");
}

test("ws-server deploy health gate uses retry constants and accepts normalized ok", () => {
  const text = workflowText();

  assert.match(text, /HEALTH_RETRIES=30/);
  assert.match(text, /HEALTH_SLEEP_SEC=1/);
  assert.match(text, /tr -d '\\r\\n'/);
  assert.match(text, /\[ "\$LOCAL_HEALTHZ_BODY" = "ok" \]/);
  assert.match(text, /\[ "\$HEALTHZ_BODY" = "ok" \]/);
  assert.match(text, /for i in \$\(seq 1 "\$HEALTH_RETRIES"\); do/);
  assert.match(text, /\/healthz/);
  assert.doesNotMatch(text, /healthz failed after retries"\s*\n\s*exit 1/);
  assert.match(text, /local healthz failed after retries[\s\S]*false/);
  assert.match(text, /public healthz failed after retries[\s\S]*false/);

  const normalizationMatches = text.match(/tr -d '\\r\\n'/g) || [];
  assert.ok(normalizationMatches.length >= 2);

  assert.doesNotMatch(
    text,
    /HEALTHZ_BODY="\$\(curl -fsS https:\/\/ws\.kcswh\.pl[^"\n]* \| tr -d '\\r\\n'\)"\s*test "\$HEALTHZ_BODY" = "ok"/
  );
});
