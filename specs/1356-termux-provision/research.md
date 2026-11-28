# Decisions

Netlify documented createEnvVars supports site_id, functions scope, is_secret and a single branch context_parameter. Use raw HTTPS body, not CLI argv. Existing Netlify operator token is entered through a hidden prompt if no supported session export is used. PostgreSQL SCRAM verifier avoids cleartext in ALTER ROLE. Stage CA and verify-full are mandatory for both pooler paths. Use fixed DB hosts from the target and the existing validator for writer options.
