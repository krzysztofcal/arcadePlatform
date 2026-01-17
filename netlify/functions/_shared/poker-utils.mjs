const PRESENCE_TTL_SEC = 90;
const HEARTBEAT_INTERVAL_SEC = 20;
const TABLE_EMPTY_CLOSE_SEC = 300;

const now = () => new Date().toISOString();
const nowSec = () => Math.floor(Date.now() / 1000);

export {
  PRESENCE_TTL_SEC,
  HEARTBEAT_INTERVAL_SEC,
  TABLE_EMPTY_CLOSE_SEC,
  now,
  nowSec,
};
