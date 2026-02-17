const PRESENCE_TTL_SEC = 90;
const HEARTBEAT_INTERVAL_SEC = 20;
const TABLE_EMPTY_CLOSE_SEC = 300;
const TABLE_SINGLETON_CLOSE_SEC = 21600;
const TABLE_BOT_ONLY_CLOSE_SEC = 300;

const now = () => new Date().toISOString();
const nowSec = () => Math.floor(Date.now() / 1000);
const isValidUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export {
  PRESENCE_TTL_SEC,
  HEARTBEAT_INTERVAL_SEC,
  TABLE_EMPTY_CLOSE_SEC,
  TABLE_SINGLETON_CLOSE_SEC,
  TABLE_BOT_ONLY_CLOSE_SEC,
  now,
  nowSec,
  isValidUuid,
};
