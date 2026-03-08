function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function buildStatePatch({ beforePayload, nextPayload }) {
  if (!isObject(beforePayload) || !isObject(nextPayload)) {
    return { ok: false, reason: "missing_baseline" };
  }

  const beforeVersion = beforePayload.stateVersion;
  const nextVersion = nextPayload.stateVersion;
  if (!Number.isInteger(beforeVersion) || !Number.isInteger(nextVersion) || nextVersion < beforeVersion) {
    return { ok: false, reason: "invalid_state_version" };
  }

  if (!isObject(beforePayload.public) || !isObject(nextPayload.public) || !isObject(beforePayload.table) || !isObject(nextPayload.table) || !isObject(beforePayload.you) || !isObject(nextPayload.you)) {
    return { ok: false, reason: "incompatible_shape" };
  }

  const patch = { stateVersion: nextVersion };
  let changedCount = 0;

  const branches = ["table", "you", "public", "private"];
  for (const key of branches) {
    const beforeBranch = beforePayload[key];
    const nextBranch = nextPayload[key];
    const beforeJson = JSON.stringify(beforeBranch ?? null);
    const nextJson = JSON.stringify(nextBranch ?? null);
    if (beforeJson !== nextJson) {
      if (key === "private" && nextBranch === undefined) {
        continue;
      }
      patch[key] = clone(nextBranch ?? null);
      changedCount += 1;
    }
  }

  if (changedCount === 0) {
    return { ok: true, patch: { stateVersion: nextVersion } };
  }

  const patchSize = JSON.stringify(patch).length;
  const snapshotSize = JSON.stringify(nextPayload).length;
  if (patchSize >= snapshotSize) {
    return { ok: false, reason: "patch_not_smaller" };
  }

  return { ok: true, patch };
}
