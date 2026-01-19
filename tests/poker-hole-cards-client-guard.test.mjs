import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const CLIENT_DIRS = ["js", "poker", "games", "games-open", "public"];
const FILE_EXTENSIONS = new Set([".js", ".mjs", ".html", ".css"]);

const walkFiles = (dir, results = []) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, results);
    } else if (FILE_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
};

describe("client guardrails", () => {
  it("does not reference poker_hole_cards from client code", () => {
    const files = CLIENT_DIRS.flatMap((dir) => {
      const fullPath = path.join(ROOT, dir);
      return fs.existsSync(fullPath) ? walkFiles(fullPath) : [];
    });

    const offenders = files.filter((file) => {
      const contents = fs.readFileSync(file, "utf8");
      return contents.includes("poker_hole_cards");
    });

    expect(offenders).toEqual([]);
  });
});
