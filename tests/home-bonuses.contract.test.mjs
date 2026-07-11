import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("home page exposes claimable campaigns through the shared chips client", async () => {
  const [html, source, css] = await Promise.all([read("index.html"), read("js/home-bonuses.js"), read("css/portal.css")]);
  assert.match(html, /id="homeBonuses"[^>]*hidden/);
  assert.match(html, /src="js\/home-bonuses\.js"/);
  assert.ok(html.indexOf('js/chips/client.js') < html.indexOf('js/home-bonuses.js'));
  assert.match(source, /fetchBonusCampaigns/);
  assert.match(source, /claimBonusCampaign/);
  assert.match(source, /item && item\.code && item\.eligible && !item\.alreadyClaimed/);
  assert.match(css, /\.home-bonuses\[hidden\]\{ display:none; \}/);
});
