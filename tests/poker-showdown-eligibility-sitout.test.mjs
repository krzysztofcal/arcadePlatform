import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (filePath) => fs.readFileSync(path.join(root, filePath), "utf8");

const actSrc = read("netlify/functions/poker-act.mjs");

assert.ok(
  /eligibleUserIds[\s\S]*?leftTableByUserId[\s\S]*?sitOutByUserId/.test(actSrc),
  "showdown eligibility should exclude sitOutByUserId"
);
