# First activation of the Stage billing writer

Owner runs a reviewed Termux command to activate the already migrated NOLOGIN play_support_writer and install its first branch-scoped Netlify credential for #1285. Rotation and live agent operations are excluded.

- FR1 Pin Stage physical database, admin identity, writer role, TLS CA and hostname, approved PR head/branch, Netlify site/account and Functions scope.
- FR2 Require initial NOLOGIN and no existing key at site or inherited account level. Refuse existing state, wrong targets and unavailable verification before writing.
- FR3 Generate password in memory. Admin password and existing Netlify access token enter through hidden prompts. No credentials in command arguments, persistent files, logs or output. PostgreSQL receives a SCRAM verifier rather than plaintext in ALTER ROLE.
- FR4 Validate exact Netlify secret placement before allowing login. Change only LOGIN and PASSWORD; preserve role membership and grants. Recheck NOLOGIN under serialization on activation.
- FR5 Verify fresh authenticated writer connection using a read-only query and narrow role privilege checks, plus metadata readback. No data mutations, deployment or Pub/Sub.
- FR6 On partial/ambiguous failure stop with sanitized recovery instructions. No overwrite, rotation, or automatic rollback.
