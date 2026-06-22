# npm dependency attribution

The authoritative package/version inventory is in `package-lock.json` and `ws-server/package-lock.json`. Package tarballs are sourced from `https://registry.npmjs.org/` through the exact `resolved` URLs in those files.

This repository does not vendor `node_modules`. Installed packages carry their own package metadata and license/NOTICE files. The consolidated human-readable inventory is [../../docs/third-party-notices.md](../../docs/third-party-notices.md).

Direct dependencies:

| Package | Role | Upstream / author | License |
|---|---|---|---|
| `postgres` | production | https://github.com/porsager/postgres — Rasmus Porsager | Unlicense |
| `ws` | production (WS server) | https://github.com/websockets/ws — Einar Otto Stangvik and contributors | MIT |
| `@playwright/test` | development/test | https://github.com/microsoft/playwright — Microsoft Corporation and contributors | Apache-2.0 |
| `acorn` | development | https://github.com/acornjs/acorn — Acorn contributors | MIT |
| `husky` | development | https://github.com/typicode/husky — typicode and contributors | MIT |
| `lint-staged` | development | https://github.com/lint-staged/lint-staged — lint-staged contributors | MIT |

Transitive package authorship is not duplicated here because it changes with lockfile resolution. Do not infer authors from package names; use the exact package manifests and licenses in the registry tarballs when regenerating notices.
