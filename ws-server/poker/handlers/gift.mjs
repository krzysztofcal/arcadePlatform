export async function handleGiftSendCommand({ payload, identityMode, tableId, buyerUserId, requestId, connectedToTable, senderSeatNo, senderIsBot, purchase }) {
  if (identityMode !== 'user' || senderIsBot) return { ok: false, code: 'invalid_sender' };
  if (!connectedToTable || !Number.isInteger(senderSeatNo)) return { ok: false, code: 'not_seated' };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).some((key) => !['tableId', 'giftKey', 'targetSeatNo'].includes(key))) return { ok: false, code: 'gift_invalid' };
  return purchase({ tableId, buyerUserId, requestId, giftKey: payload.giftKey, recipientSeatNo: payload.targetSeatNo });
}
