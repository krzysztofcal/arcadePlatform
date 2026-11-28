# Workflow contract

| Operation | Dispatcher | Environment | Result |
| --- | --- | --- | --- |
| inspect | Existing trusted-main dispatch policy | stage-automation | Read-only history and pending catalog |
| apply | OWNER or exact GitHub App, first attempt, actor equals triggering actor | stage-db-apply | Requires live protection checks and OWNER approval, then exact atomic apply or verified no-op |

Inputs remain `approval` (PR, sourceSha, historyCount, historySha256, ordered migrations), `operation` and `confirmation` (existing Stage target, SHA and approval digest). A queue entry alone is never a success signal. Invalid policy, review, target or bundle emits a sanitized refusal. Never include a DB URL, token or raw database error in evidence.

The apply jobs enforce first attempt in job conditions. The protected job uses Actions read for review history. Both dispatchers require the same OWNER approval record. Dispatch and approval are distinct events and approval does not stand in for the original actor.
