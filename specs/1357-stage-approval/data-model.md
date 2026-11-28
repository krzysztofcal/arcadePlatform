# Data model

- **Request** — existing operation, approval JSON and confirmation. Approval binds PR, full source SHA, historical count/digest, ordered file names and original-byte SHA-256s.
- **Run attestation** — repository, workflow ref/SHA, run ID, run attempt, actor and triggering actor supplied by GitHub. No caller-supplied replacement.
- **Protection and review** — exact named Environment, main-only branch rule, no bypass, one pinned OWNER reviewer, associated OWNER approved event keyed by run ID and exact Environment. Missing and malformed fields fail closed.
- **Receipt** — existing Stage schema_migrations and schema_migration_files. No model or storage changes.
