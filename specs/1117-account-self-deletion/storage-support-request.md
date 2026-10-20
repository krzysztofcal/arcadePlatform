# Supabase support request — DRAFT, NOT SENT

Subject: Hosted Storage 1.80.2: terminal-write guarantee for account/avatar erasure

Hello Supabase Support,

We need a supported deletion-closure contract for hosted project `krydukthwdvccggbyjfw` (Stage; Production is outside this request). Read-only `/storage/v1/version` reported 1.80.2. Our application uses standard signed PUT uploads into `profile-avatar-uploads`, followed by server-side processed output into `profile-avatars`; it does not use TUS in this flow. Our isolated test files are synthetic avatars, <=1MiB; existing users and their objects are outside any requested operation.

Our database guards now stop new legacy intents/consumption and retain immutable manifests. A controlled Stage test nevertheless confirmed that an intent admitted before the guard can still receive a signed upload URL afterward. One returned token declared exp-iat=7200s. We have NOT treated that observation or URL expiry as proof of terminal I/O. A separately labelled client-side fault injection retained an output whose successful POST response was discarded; it is not evidence of a provider-origin failure.

Please provide version/config-specific guarantees, preferably linked documentation or an engineering statement:

1. What is the effective maximum signed-upload token lifetime for this hosted project, including older issuance configurations, clock tolerance and any renewal/replay semantics? Can you provide non-secret configuration/build identifiers?
2. Can a standard PUT accepted before expiry finish streaming or commit metadata/object bytes after expiry? Is expiry checked again at final commit?
3. Is there a HARD maximum elapsed time covering admitted request body, backend upload, database commit, all retries/queues and recovery after disconnection? Please specify its start point, applicable settings and whether it remains valid during outages/restarts. An idle/socket/lock timeout alone is insufficient.
4. Does client cancellation or timeout terminate all downstream work? Can background cleanup/retry later recreate an object or metadata?
5. Is there a supported bucket/path/tenant write-freeze or cancellation barrier that includes already-admitted service_role operations and signed capabilities? What is the acknowledgement/propagation/terminal-work contract? Please distinguish admission denial from terminal commit fencing.
6. What constitutes authoritative proof that an uncertain POST is terminal? Can operation/request IDs, object version/ETag/metadata or a supported operation-status API establish it without claiming a lost HTTP response was acknowledged?
7. After a supported terminal fence, does exact-path DELETE plus a verified absence guarantee no later recreation? How are physical orphaned versions/multipart data removed, and is there a documented maximum retention/cleanup receipt? We need personal-data erasure, not merely absence in `storage.objects`.
8. Are changes/triggers in the managed `storage` schema supported for this purpose? We currently propose NO such changes: a metadata rejection does not itself prove erasure of already-uploaded bytes.
9. If no finite bound exists, what supported operational mechanism can establish quiescence for these two buckets without rotating shared credentials or introducing a new service? Please state if an additional plan/cost is required; we authorize no purchase.

Please do NOT change configuration, revoke keys, freeze buckets, delete data, rotate secrets or operate on Production. This is a request for guarantees and an operational proposal only. We will separately approve any action.

We can supply sanitized request timestamps/IDs privately if requested. No credentials, JWTs, signed URLs, emails, object paths or user IDs are included here.

Thank you.
