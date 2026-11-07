#!/usr/bin/node
// Compatibility entry point. No private key, old-provider fallback or caller-selected scope.
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--info")) {
  process.stderr.write("arcade-agent-token: unexpected arguments\n");
  process.exit(1);
}
const result = spawnSync("/usr/bin/sudo", ["-n", "-u", "arcade-github-token", "--", "/usr/local/sbin/arcade-github-app-token", ...args], {
  stdio: ["ignore", "inherit", "inherit"], env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 30000
});
process.exit(result.status === 0 ? 0 : 1);
