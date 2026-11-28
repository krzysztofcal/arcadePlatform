# Operator acceptance

Use Termux Node and psql with verified Stage CA downloaded from the Supabase dashboard. Run the final, reviewed script checkout. Prompts take the existing Stage postgres password and the existing Netlify token. Never copy either value to output. Use only one operator/session. The run must report verified writer login and exact branch scope; no migration or deployed runtime test takes place.

## Termux

Use Node 22+, PostgreSQL client tools and a reviewed checkout. If needed install the Termux packages with `pkg install nodejs postgresql git openssl`. Download one Stage root CA PEM from the authenticated Supabase Stage Database Settings into Termux private storage as `$HOME/stage-ca.crt`. Obtain its SHA-256 fingerprint independently from the trusted dashboard copy (one way is `openssl x509 -in <trusted-copy> -noout -fingerprint -sha256` on a trusted device). Compare the entire fingerprint before entering any password. Do not use a CA that arrived with a forwarded endpoint or untrusted URL. Keep the terminal running during the operation. The script only copies the nonsecret CA to a private temporary file.

From the reviewed checkout run `node scripts/ops/play-support-stage-provision.mjs "$HOME/stage-ca.crt"` for read-only preflight. After it reports `PREFLIGHT_OK_NO_WRITES`, run the same command with `--apply` only for the separately authorized exact target. Freeze the pinned Netlify source branch against other pushes and deploys during the proof window. Enter the Stage postgres password and your existing Netlify API access token when asked; the inputs are hidden. If you obtained a temporary Netlify token, revoke it after use. No CLI auth token is copied from another user's session. The tested password remains in memory only. The Stage server may audit the generated SCRAM verifier.

The final success line proves a DB login from Termux and Netlify key placement only. The exact deployed Functions runtime still needs its own acceptance test, including CA, scope, secret visibility and environment size, before using the login. Do not enroll Pub/Sub, use Play credentials or run a purchase for this proof.

## If interrupted or refused

- Before Netlify create or on a preflight error, correct the local prerequisite and run the read-only preflight again. Do not retry a POST on timeout or unknown status.
- After the Netlify create attempt, check whether the role is still NOLOGIN through verified Stage administration. Compare the reported value ID, site and branch to Netlify metadata (never inspect or print the secret value). If an orphan exists and is positively identified as created by this attempt, the OWNER may remove only that exact site branch value and retry first provisioning after confirming no consumer used it. An ambiguous or pre-existing entry requires investigation.
- If the login may be active, do not rerun. First verify the exact target and that there are no consumers. For this attempt alone the OWNER can use approved Stage SQL administration to set `ALTER ROLE play_support_writer NOLOGIN PASSWORD NULL;`, terminate any remaining sessions for that role if required, confirm the disabled state, and remove only the identified Netlify branch value. This reset is manual and requires its own permission. An active login of unknown origin and ordinary rotation remain outside scope.
- Remove branch access on ending the approved proof and account for already built deploys. Deleting a Netlify value does not revoke snapshots already built with it.

After a refusal, share only the `NETLIFY_DIAGNOSTIC` lines and the final code. These report a fixed stage, numeric HTTP status (or none), and an error category. They do not include API response bodies or credentials. Do not re-run apply after an unconfirmed create.
