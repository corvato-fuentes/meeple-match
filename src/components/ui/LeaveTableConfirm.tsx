'use client';
import ConfirmModal from '@/components/ui/ConfirmModal';
import type { Table } from '@/lib/types';
import { isExplainOnly } from '@/lib/explainOnly';

/**
 * "Bajarme de la mesa" confirmation, the same wherever a player can step down from a table. It says what will happen:
 * an owner who posted the table is cancelling it; the explainer of a recommended table hands it over (or the table is
 * cancelled if nobody else can explain it); anyone else just gives up their seat.
 */
export default function LeaveTableConfirm({ table, myId, onConfirm, onCancel }: {
  table: Table | null;
  myId: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const when = table ? `${table.gameName} (${table.startTime}–${table.endTime})` : '';
  const ownerPosted = !!table && !!table.postedByOwner && table.explainerId === myId;
  const explainer = !!table && !table.postedByOwner && table.explainerId === myId;
  const confirmed = table?.status === 'confirmed';

  const title = ownerPosted ? '¿Cancelar esta mesa?' : '¿Bajarte de esta mesa?';
  let message = '';
  if (table) {
    if (ownerPosted) {
      message = `Vas a cancelar tu mesa de ${when}. Los jugadores anotados la van a dejar de ver.`;
    } else if (explainer && isExplainOnly(table)) {
      // They only explain: no seat to give up
      message = `Vas a dejar de explicar ${when}. Si otro de la mesa puede explicarla, la toma; si no, la mesa se cancela y los demás vuelven a quedar libres. No te la vamos a volver a ofrecer.`;
    } else if (explainer) {
      message = `Vas a dejar tu lugar en ${when} y a dejar de explicarla. Si otro de la mesa puede explicarla, la toma; si no, la mesa se cancela y los demás vuelven a quedar libres.`;
    } else if (table.postedByOwner) {
      message = confirmed
        ? `Vas a dejar tu lugar en ${when}, que ya está confirmada. Si queda por debajo del mínimo vuelve a esperar jugadores.`
        : `Vas a dejar tu lugar en ${when}. Si querés, después podés volver a sumarte mientras haya lugar.`;
    } else {
      message = confirmed
        ? `Vas a dejar tu lugar en ${when}, que ya está confirmada. Si queda por debajo del mínimo vuelve a esperar jugadores. No te la vamos a volver a ofrecer.`
        : `Vas a dejar tu lugar en ${when}. No te la vamos a volver a ofrecer.`;
    }
  }
  return (
    <ConfirmModal open={!!table} title={title} message={message} confirmLabel={ownerPosted ? 'Sí, cancelar' : 'Sí, bajarme'} danger
      onConfirm={onConfirm} onCancel={onCancel} />
  );
}
