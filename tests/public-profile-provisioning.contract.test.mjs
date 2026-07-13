import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20260713090000_user_profile_provisioning_visibility.sql", import.meta.url), "utf8");
const accountHtml = await readFile(new URL("../account.html", import.meta.url), "utf8");
const accountController = await readFile(new URL("../js/account-page.js", import.meta.url), "utf8");

test("auth signup creates an idempotent default-visible profile in the database", () => {
  assert.match(migration, /leaderboard_visible boolean not null default true/i);
  assert.match(migration, /create or replace function public\.ensure_user_profile\(target_user_id uuid\)/i);
  assert.match(migration, /on conflict do nothing/i);
  assert.match(migration, /after insert on auth\.users/i);
  assert.match(migration, /perform public\.ensure_user_profile\(new\.id\)/i);
  assert.match(migration, /left join public\.user_profiles[\s\S]*where profiles\.user_id is null/i);
  assert.match(migration, /pg_catalog\.uuid_send\(pg_catalog\.gen_random_uuid\(\)\)/i);
  assert.doesNotMatch(migration, /email|raw_user_meta_data|ip_address/i);
});

test("account Settings exposes an unchecked leaderboard opt-out through profile-me", () => {
  assert.match(accountHtml, /id="hideFromLeaderboard"[^>]*type="checkbox"/);
  assert.doesNotMatch(accountHtml, /id="hideFromLeaderboard"[^>]*checked/);
  assert.match(accountController, /payload\.leaderboardVisible\s*=\s*leaderboardVisible/);
  assert.match(accountController, /profile\.leaderboardVisible\s*===\s*false/);
});
