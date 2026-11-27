const MAX_PUSH_BYTES = 16 * 1024;
const PACKAGES = new Map([
  ['stage', 'pl.kcswh.arcadepoker.stage'],
  ['production', 'pl.kcswh.arcadepoker']
]);

async function readPush(request) {
  const size = Number(request.headers.get('content-length'));
  if (size > MAX_PUSH_BYTES || !request.body) throw new Error('invalid_push');
  const chunks = [];
  let length = 0;
  for await (const chunk of request.body) {
    length += chunk.length;
    if (length > MAX_PUSH_BYTES) throw new Error('invalid_push');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// The handler is wired with a verified deployment target and scoped storage.
// HTTP success is delivery acknowledgement, never acknowledgement to Play.
export function createPlaySupportRtdnHandler({
  environment, packageName, subscription, verifyAuthorization, enqueue, process, isComplete, now = Date.now
}) {
  if (typeof packageName !== 'string' || PACKAGES.get(environment) !== packageName ||
      typeof subscription !== 'string' || !/^projects\/[a-z0-9-]+\/subscriptions\/[a-zA-Z0-9_.~-]+$/.test(subscription) ||
      [verifyAuthorization, enqueue, process, isComplete].some(value => typeof value !== 'function')) {
    throw new Error('play_support_push_config');
  }

  return async request => {
    const reply = status => new Response(null, { status });
    if (request.method !== 'POST') return reply(405);

    try {
      if (!await verifyAuthorization(request.headers.get('authorization'))) return reply(401);
    } catch {
      return reply(503);
    }

    let push;
    let notice;
    try {
      push = await readPush(request);
      const data = push?.message?.data;
      if (typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return reply(400);
      notice = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
    } catch {
      return reply(400);
    }
    if (push.subscription !== subscription || notice?.packageName !== packageName) return reply(403);
    if (notice.version !== '1.0') return reply(400);

    const oneTime = notice.oneTimeProductNotification;
    if (notice.testNotification && !oneTime && !notice.voidedPurchaseNotification && !notice.subscriptionNotification) {
      return reply(204);
    }
    // Voids need their own authoritative reconciliation. Do not consume them
    // as if a ProductPurchaseV2 observation alone handled the event.
    if (notice.voidedPurchaseNotification) return reply(503);
    if (!oneTime) return reply(400);
    const token = oneTime.purchaseToken;
    const messageId = push.message.messageId;
    const stamp = Number(notice.eventTimeMillis);
    if (typeof token !== 'string' || !token || Buffer.byteLength(token) > 8192 ||
        /[\u0000-\u0020\u007f]/.test(token) || token === '.' || token === '..' ||
        typeof messageId !== 'string' || !messageId.trim() || messageId.length > 128 ||
        typeof notice.eventTimeMillis !== 'string' || !/^\d{1,16}$/.test(notice.eventTimeMillis) ||
        !Number.isSafeInteger(stamp) || stamp <= 0 || stamp > now() + 300_000) return reply(400);

    const input = { environment, packageName, token, messageId, eventAt: new Date(stamp) };
    try {
      if (!await enqueue(input)) return reply(503);
      const result = await process(input);
      if (result.state === 'COMPLETE' || (result.state === 'NO_WORK' && await isComplete(input))) return reply(204);
      // Pending deliveries remain retryable until the deployed recovery owner
      // is proven; an inbox commit or another worker's lease is insufficient.
      return reply(503);
    } catch {
      return reply(503);
    }
  };
}
