# Data Model: Stage bot-only recovery durability

This feature introduces no database entities or schema changes. It validates
the existing committed archive row and existing private Storage objects.

## Existing committed batch row

Source: `public.chips_ledger_archive_batches`, read through the existing
prune-store adapter.

| Field/group | Required condition before a repair POST |
|---|---|
| Identity | Exact positive `batch_id`; canonical Stage project and PostgreSQL system identifier |
| Policy/schema | `stage-ledger-bot-only-retention-7d-v1`, schema-v2 bot-only row |
| Commit | `status=committed` and non-null `committed_at` |
| Archive binding | `object_path=v1/sha256/<compressed_sha256>.jsonl.gz`; valid compressed byte count/SHA-256 |
| Immutable proof | Complete archive proof plus bot-only table, registry, eligible, and out-of-scope evidence |
| Lifecycle | No `pruned_at`, `registry_cleaned_at`, `destructive_go_at`, destructive GO batch ID, or completed-retention marker |
| Current manifest | Active normalized manifest exists and matches the exact DB row after dry-run |

No row is inserted or updated by repair.

## Recovery objects

Both objects live in private bucket `chips-ledger-archive` and use
`application/gzip`.

| Object | Deterministic path | Validation |
|---|---|---|
| Primary archive | `v1/sha256/<sha>.jsonl.gz` | Private GET, expected MIME, committed byte count, SHA-256 |
| Recovery archive | `recovery/v1/sha256/<sha>.jsonl.gz` | Private GET, expected MIME, same size/SHA/bytes as primary |
| Recovery manifest | `recovery/v1/sha256/<sha>.recovery.json.gz` | Private GET, canonical gzip/JSON, matches row, identity, policy, proof, and dry-run |

The primary archive and existing recovery archive are immutable evidence. The
generic partial repair may create only the missing recovery manifest, with a
create-only request.

## Durable recovery state

`inspectDurableRecoveryState` returns one of these states:

| State | Archive | Manifest | Repair behavior |
|---|---|---|---|
| `both_missing` | absent | absent | Block; no write |
| `partial` | exactly one present | exactly one present | Only repairable when archive is present and manifest absent, and bytes/SHA match |
| `complete` | present and valid | present and canonical | Read-only idempotent result `recovery_already_repaired` only after the row passes the unpruned/un-cleaned/no-GO lifecycle |
| `mismatch` | wrong MIME/size/SHA/JSON/manifest | any | Block; no overwrite/delete |
| `unavailable` | read error | any | Block; no write |
| `write_not_visible` | ambiguous write not observed | absent/unknown | Block; no second POST |
| `blocked` | not applicable | not applicable | Higher-level identity, fence, proof, or lifecycle rejection |

## Repair transition

```text
PARTIAL
  recovery archive: present + verified
  recovery manifest: absent
      |
      | revalidate identity/fence/lock/row/proof/dry-run/archives
      | one create-only manifest POST; reconcile 504/network outcome
      v
COMPLETE
  recovery archive: unchanged + verified
  recovery manifest: canonical + verified
```

A complete pair on an eligible, unpruned and uncleaned row does not transition
and is reported as `recovery_already_repaired`. Lifecycle is checked before
recovery inspection: a row with `pruned_at`, completed registry cleanup,
destructive GO, or a completed-retention marker is `blocked` even when both
objects are present and valid. Every other state remains fail-closed.

## Observability shape

Recovery errors and blocked automatic progress expose:

- exact `batch_id` and primary `object_path`;
- `recovery_state`;
- per-object `object_path`, `present`, MIME, size/content-length, and SHA-256;
- `required_action` instructing read-only diagnosis or owner-gated repair;
- existing `archive_storage_modified`, `recovery_storage_modified`, and
  `storage_modified` fields.

The report does not expose secrets, raw object bytes, or database credentials.
