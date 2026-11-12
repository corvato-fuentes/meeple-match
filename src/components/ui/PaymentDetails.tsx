'use client';
import { useState } from 'react';

/**
 * How to pay, as the organizers set it: the alias on its own line, big and with a button to copy it (it is what people type or
 * paste into their banking app), and under it whatever else the organizers wrote (CBU, account holder, the amount…).
 * Shows nothing when neither is set.
 */
export default function PaymentDetails({ alias, info }: { alias?: string | null; info?: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!alias && !info) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(alias ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* the alias is on screen: they can still select it */ }
  }

  return (
    <div className="space-y-1.5">
      {alias && (
        <div className="flex items-center justify-between gap-2 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2">
          <div className="min-w-0">
            <p className="text-[11px] text-gray-500">Alias</p>
            <p className="font-mono text-sm text-gray-100 break-all select-all">{alias}</p>
          </div>
          <button type="button" onClick={copy} className="shrink-0 text-xs border border-indigo-700 text-indigo-300 rounded-lg px-2.5 py-1 hover:bg-indigo-950/40">
            {copied ? '✓ Copiado' : '📋 Copiar'}
          </button>
        </div>
      )}
      {info && <p className="text-xs text-gray-300 whitespace-pre-wrap">{info}</p>}
    </div>
  );
}
