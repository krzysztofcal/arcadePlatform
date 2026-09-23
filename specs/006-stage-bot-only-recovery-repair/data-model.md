# Data Model: Stage Bot-Only Recovery Repair for Batch 9923

This feature introduces no database entities or schema changes. It validates existing entities and produces no lifecycle receipt.

## Existing committed batch evidence

Source: `public.chips_ledger_archive_batches` through the existing read-only `createPruneStore(...)` interface.

Required values for the exact repair:

| Field | Rule |
| --- | --- |
| `batch_id` | Exactly `9923` |
| `project_ref` | Canonical Stage project `krydukthwdvccggbyjfw` |
| `source_policy_id` | `stage-ledger-bot-only-retention-7d-v1` |
| `status` / `committed_at` | Committed and timestamped |
| `object_path` | `v1/sha256/<compressed_sha256>.jsonl.gz` |
| `compressed_bytes` / `compressed_sha256` | Committed archive size and SHA-256 |
| proof fields | Complete bot-only transaction, entry, registry, and out-of-scope evidence |
| lifecycle receipts | Prune, registry cleanup, and destructive GO all absent |

## Recovery pair

The pair is content-addressed by the committed compressed SHA-256:

- Archive: `recovery/v1/sha256/<compressed_sha256>.jsonl.gz`
- Manifest: `recovery/v1/sha256/<compressed_sha256>.recovery.json.gz`

Both objects must be private `application/gzip` objects. The archive must be byte-identical to the verified primary archive. The manifest must be the canonical gzip/JSON representation built from the committed row, Stage identity, and dry-run proof evidence.

## Repair state transition

```text
PARTIAL
  recovery archive: present + byte/SHA verified
  recovery manifest: absent
      |
      | create-only manifest + read-after-write verification
      v
COMPLETE
  recovery archive: unchanged + verified
  recovery manifest: present + canonical + verified
```

All other observed states (`BOTH_MISSING`, archive missing, manifest present without archive, `MISMATCH`, `UNAVAILABLE`, or an ambiguous post-timeout state) remain blocked and do not transition.
