const DEFAULT_STREAM_CAP = 128;
const GLOBAL_RECEIVER_KEY = "__global__";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeReceiverKey(receiverKey) {
  return typeof receiverKey === "string" && receiverKey.length > 0 ? receiverKey : GLOBAL_RECEIVER_KEY;
}

export function createStreamLog({ cap = DEFAULT_STREAM_CAP } = {}) {
  const normalizedCap = Number.isInteger(cap) && cap > 0 ? cap : DEFAULT_STREAM_CAP;
  const streamByTableId = new Map();

  function ensureTable(tableId) {
    if (!streamByTableId.has(tableId)) {
      streamByTableId.set(tableId, {
        nextSeq: 1,
        entriesByReceiverKey: new Map(),
        latestSeqByReceiverKey: new Map()
      });
    }
    return streamByTableId.get(tableId);
  }

  function ensureReceiverEntries(tableStream, receiverKey) {
    if (!tableStream.entriesByReceiverKey.has(receiverKey)) {
      tableStream.entriesByReceiverKey.set(receiverKey, []);
    }
    return tableStream.entriesByReceiverKey.get(receiverKey);
  }

  function append({ tableId, frame, receiverKey = null }) {
    const tableStream = ensureTable(tableId);
    const resolvedReceiverKey = normalizeReceiverKey(receiverKey);
    const seq = tableStream.nextSeq;
    tableStream.nextSeq += 1;

    const replayFrame = clone({ ...frame, seq });
    const receiverEntries = ensureReceiverEntries(tableStream, resolvedReceiverKey);
    receiverEntries.push({ seq, frame: replayFrame });

    while (receiverEntries.length > normalizedCap) {
      receiverEntries.shift();
    }

    tableStream.latestSeqByReceiverKey.set(resolvedReceiverKey, seq);
    return replayFrame;
  }

  function latestSeq(tableId) {
    const tableStream = ensureTable(tableId);
    return tableStream.nextSeq - 1;
  }

  function eventsAfter({ tableId, lastSeq, receiverKey = null }) {
    const tableStream = ensureTable(tableId);
    const resolvedReceiverKey = normalizeReceiverKey(receiverKey);
    const receiverEntries = ensureReceiverEntries(tableStream, resolvedReceiverKey);
    const latest = tableStream.latestSeqByReceiverKey.get(resolvedReceiverKey) ?? 0;

    if (lastSeq > latest) {
      return { ok: false, reason: "last_seq_ahead_of_head", latestSeq: latest, earliestSeq: receiverEntries[0]?.seq ?? null };
    }

    if (receiverEntries.length === 0) {
      if (latest === 0 || lastSeq === latest) {
        return { ok: true, latestSeq: latest, earliestSeq: null, frames: [] };
      }
      return { ok: false, reason: "last_seq_out_of_window", latestSeq: latest, earliestSeq: null };
    }

    const earliest = receiverEntries[0].seq;
    if (lastSeq < earliest - 1) {
      return { ok: false, reason: "last_seq_out_of_window", latestSeq: latest, earliestSeq: earliest };
    }

    const frames = receiverEntries.filter((entry) => entry.seq > lastSeq).map((entry) => clone(entry.frame));

    return {
      ok: true,
      latestSeq: latest,
      earliestSeq: earliest,
      frames
    };
  }

  return {
    append,
    latestSeq,
    eventsAfter
  };
}
