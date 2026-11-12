// The organizer's receipt actions, through the admin API (the server checks the admin token and sends the notifications).

async function call(code: string, adminToken: string, body: Record<string, unknown>) {
  const res = await fetch('/api/admin/payment-review', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, adminToken, ...body }),
  });
  if (!res.ok) throw new Error('No se pudo completar la acción');
  return res.json() as Promise<{ ok: boolean; notified?: boolean; owing?: number; devices?: number }>;
}

export const reviewReceipt = (code: string, adminToken: string, playerId: string, decision: 'approve' | 'reject') =>
  call(code, adminToken, { action: decision, playerId });

/** Reminds one player, or everyone who still owes a receipt when no player is given. */
export const remindReceipts = (code: string, adminToken: string, playerId?: string) => call(code, adminToken, { action: 'remind', playerId });
