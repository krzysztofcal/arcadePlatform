# Stage secrets: OWNER on Android / Termux (#1159, #1193)

Run only in the official Termux app's private home, not shared `/sdcard` storage, a recorded terminal, a VPS, root shell or an agent session. This standalone Node.js script has no project/npm dependencies. It deliberately stops outside Android/Termux. No merge or workflow dispatch is part of this operation.

## Dependencies and compatibility

If missing, install:

```sh
pkg update && pkg install nodejs-lts npm gh curl
npm install -g netlify-cli@26.2.0
```

Node.js and `gh` are maintained [Termux packages](https://github.com/termux/termux-packages/tree/master/packages). Netlify CLI is an npm application; **Android support is not guaranteed**. Version 26.2.0's API/login implementation was inspected on Linux with Node 22.23.1; its `getSite`, `getEnvVar` and stdin-compatible GitHub CLI paths are used here. The script requires Netlify CLI exactly 26.2.0, GitHub CLI 2.45+ and exact API methods; checks CLI execution on the phone before reading source values. Netlify install/start failure is STOP, not permission to use a VPS, another binary distribution, root, or transfer tokens to an agent. No physical Android test has been performed. Node 22+ is required; current Termux `nodejs-lts` satisfies that requirement. No `npm install` in the arcadePlatform repository is needed.

## Owner authentication

- GitHub: an existing local `gh` login must identify `krzysztofcal`. Otherwise the script asks for a **fine-grained PAT using hidden local input**, scoped only to `krzysztofcal/arcadePlatform`, **Environments: read/write** and **Actions: read** (required for branch-policy inspection), short expiry, no account permissions. Create it in GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens. The script supplies it through child-process `GH_TOKEN` in memory, following [GitHub CLI guidance](https://cli.github.com/manual/gh_auth_login), without `gh auth login --with-token`, files, argv or persistence. It never requests classic PATs, additional OAuth scopes or changes to `arcade-code-agent`. Existing CLI sessions remain untouched.
- Netlify: `netlify login --new` opens browser authorization on the phone (or prints a local authorization link). Sign in as OWNER with access to `playkcswh`. Standard Netlify CLI credentials may persist in its **private local user configuration**, outside the repository; the script does not print or export them. A fresh Netlify authorization is required even if another local session exists; choose OWNER in the browser. No agent receives this authorization.
- Supabase: in [Account → Access Tokens](https://supabase.com/dashboard/account/tokens), create a **scoped** PAT selecting only Stage `krydukthwdvccggbyjfw`, **Logs: Read** and **Disk Config: Read**, with an expiry. Paste it only at the script's hidden prompt. Disable clipboard sync/history for this operation and clear the Android and keyboard clipboard after each token paste (or type the token). Do not use a legacy/full-account token or paste anything into chat. Permission scope and project selection must be checked in the UI: successful read probes cannot prove the absence of extra privileges. If scoped tokens are unavailable, STOP.

## One launch command

Use the immutable commit URL from the handoff, replacing `<reviewed-sha>` below with that exact SHA:

```sh
curl --fail --silent --show-error 'https://raw.githubusercontent.com/krzysztofcal/arcadePlatform/<reviewed-sha>/scripts/ops/stage-secrets-termux.mjs' -o "$HOME/stage-secrets-termux.mjs" && node "$HOME/stage-secrets-termux.mjs"
```

This saves public reviewed **code only**, not secret values. Download must finish successfully before execution. Do not pipe the program into `node`: stdin must remain the local terminal for hidden input. The script handles the remaining prompts and prints a PASS/STOP for each of the three secret names. Missing dependencies use the installation above; login approvals and creating scoped tokens remain OWNER actions in their respective UIs.

## Checks and effects

Before any writes: OWNER identity, existing Environment, custom branch policy containing exactly the `main` branch and no tags, public-key read access, exact pinned Netlify site and exact `deploy-preview` values. No fallback to production, `all`, branch contexts, shared variables or secret-marked unreadable values. The source is `SUPABASE_DB_URL`, cross-checked against `SUPABASE_URL` and `SUPABASE_STAGE_PROJECT_REF`.

The original transaction-pooler URL's password is preserved and used to build session pooler port 5432 and Direct `db.krydukthwdvccggbyjfw.supabase.co:5432`, user `postgres`, database `postgres`, `sslmode=require`. Session URL has no query parameters, matching the resource-health reader; its consumers enforce TLS. Direct shape matches `scripts/stage-db-migrate.mjs::connectionEnv()`. Both connections were verified in the preceding authorized read-only operation against pinned database system identifier `7656985631720456337`. **This script validates current source configuration, not live database connectivity or unchanged credentials**; it has no PostgreSQL client and does not claim a fresh DB test on Android.

The Supabase PAT is tested with only three GETs: metrics, disk configuration and disk utilization for Stage. Bodies are cancelled and never printed. This is a one-time bounded control-plane operation, with no history/table reads, polling, cron or automatic retries; any transfer estimate would not be measured billed egress.

`gh secret set NAME --repo krzysztofcal/arcadePlatform --env stage-automation` receives each value over stdin, encrypts locally and sends it to GitHub. Child output/errors are captured/discarded, never forwarded. No secret values go into process arguments or temporary files. All three inputs are prepared before the first write. Each successful write must be followed by changed secret metadata (name and GitHub `updated_at` strictly newer than before the write, or newly created metadata); values cannot be read back. Verification uses GitHub timestamps, not the phone clock. Two writes in the same timestamp second can conservatively produce STOP; do not immediately repeat a partial run. Public-key access proves read permission, not guaranteed write permission. Writes are sequential and non-atomic: STOP can leave earlier PASS writes in place, and an unconfirmed write may already have succeeded. No automatic rollback or retry. Inspect the reported phase and Environment metadata before repeating; a repeated successful run overwrites these three Environment secrets.

Repository secrets and the three Environment secrets already added by OWNER remain unchanged. No database password reset, rotation, data/schema change, Production configuration, deployment or workflow dispatch occurs. The two recovered DB URLs and Supabase token exist only in process memory until exit; JavaScript/CLI memory is not guaranteed to be securely zeroed. Netlify's ordinary local login configuration is the exception described above.

After OWNER later merges #1193, observe the normal scheduled Stage resource-health job (no manual dispatch). A green run alone cannot prove Environment-secret provenance because Repository secrets remain available. The monitor exercises session DB URL and management token; it does not test the Direct URL. Do not invoke migration or destructive automation just to test it.
