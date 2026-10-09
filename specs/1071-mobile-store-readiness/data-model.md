# Conceptual model — #1071

Documentation only. No schema, migration, DB access or retention change is proposed for execution under this issue.

| Entity | Proposed fields / relationship | Invariant |
| --- | --- | --- |
| AuditFinding | ID, code revision/source, affected path, observed/policy/inference status, impact, gate | Source and uncertainty remain visible. |
| ReleaseGate | ID, free/monetized mode, Android/iOS target, owner role, evidence reference, decision/date | Pending/failed evidence is NO-GO; approval for one target/mode does not authorize another. |
| Purchase | Provider, app/package, environment, provider-qualified unique ID, authenticated owner, catalogue SKU, verified state | Client cannot mint a grant or change owner. Duplicate identity cannot grant twice; purchased IAP CH cannot expire. |
| Fulfillment | Purchase reference, grant/entitlement reference, durable outcome, provider completion status | Grant and recovery are durable; provider acknowledgment failure is retried without another grant. |
| Entitlement | Account + cosmetic ownership or VIP validity/status | Restore ownership, not consumable CH already spent. Cancellation and expiry are distinct. |
| DeletionRequest | Verified account, request/completion dates, retained categories/reason, live-seat handling, subscription warning | Delete account/associated data subject to approved lawful retention; never promise deletion automatically cancels provider renewal. |

Purchase conceptual transitions: received → verification pending → verified → durable fulfilled → provider completed. Invalid/unowned/pending purchase never reaches fulfillment. Refund/revocation is an independently verified transition with an approved compensation policy, including spent CH. VIP expiry/grace derives from provider state. Out-of-order events trigger authoritative re-query, not last-arrival wins. Existing WS state remains authoritative for poker; future verified billing would own commercial entitlements and use existing accounting boundaries.
