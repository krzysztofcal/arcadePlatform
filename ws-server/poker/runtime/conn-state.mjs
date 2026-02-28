import { randomUUID } from "node:crypto";
import { PROTOCOL_VERSION } from "../protocol/constants.mjs";

export const HEARTBEAT_MS = 15000;

export function createConnState() {
  return {
    sessionId: `sess_${randomUUID()}`,
    negotiatedVersion: PROTOCOL_VERSION,
    protocolViolations: []
  };
}
