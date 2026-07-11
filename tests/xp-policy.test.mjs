import assert from "node:assert/strict";
import { getXpPolicy } from "../netlify/functions/_shared/xp-identity.mjs";

const defaults = getXpPolicy({});
assert.equal(defaults.dailyCap, 3000);
assert.equal(defaults.sessionCap, 300);

const configuredDaily = getXpPolicy({ XP_DAILY_CAP: "4500" });
assert.equal(configuredDaily.dailyCap, 4500);
assert.equal(configuredDaily.sessionCap, 300);

const explicitSession = getXpPolicy({ XP_DAILY_CAP: "3000", XP_SESSION_CAP: "500" });
assert.equal(explicitSession.sessionCap, 500);

const higherSession = getXpPolicy({ XP_DAILY_CAP: "3000", XP_SESSION_CAP: "5000" });
assert.equal(higherSession.sessionCap, 5000);

console.log("xp policy tests passed");
