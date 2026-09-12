# Existing prune retry contract

Signature and JSON unchanged: `chips_prune_committed_archive_batch_internal(text,uuid[],bigint[],boolean)` returns `state: already_pruned`, transaction and entry counts through the existing wrapper.

Only the complete prune receipt branch changes. Without any cleanup field, require full registry and matching mapping counts. Otherwise require all cleanup fields, canonical Stage `krydukthwdvccggbyjfw`, format 1, exact `stage-ledger-auto-retention-30d-v1`, non-null committed timestamp, equal cleaned/transaction count, valid lowercase SHA-256 and zero registry/matching counts. Reject NULL predicates. Retain zero wrong/extra mappings and hot row checks and exact archive/prune hashes/counts.

Receipt validity derives from #980's protected atomic retirement transition. This read does not authorize deletion or change historical key replay semantics.
