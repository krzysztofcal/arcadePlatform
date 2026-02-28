import { randomUUID } from "node:crypto";
import { PROTOCOL_VERSION } from "../protocol/constants.mjs";
import { createSession } from "./session.mjs";

export const HEARTBEAT_MS = 15000;

export function createConnState(nowTs = () => new Date().toISOString()) {
  const sessionId = `sess_${randomUUID()}`;
  return {
    sessionId,
    negotiatedVersion: PROTOCOL_VERSION,
    protocolViolations: [],
    userId: null,
    session: createSession({ sessionId, nowTs })
  };
}
