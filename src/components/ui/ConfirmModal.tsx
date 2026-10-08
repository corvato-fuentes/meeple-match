'use client';

export default function ConfirmModal({
  open, title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger, onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={onCancel}>
      <div className="max-w-sm w-full bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm"
        onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-100">{title}</h3>
        <p className="text-xs text-gray-400">{message}</p>
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="flex-1 border border-gray-700 rounded-lg py-2 text-xs font-medium text-gray-400 hover:bg-gray-800">
            {cancelLabel}
          </button>
          <button onClick={onConfirm}
            className={'flex-1 rounded-lg py-2 text-xs font-medium text-white ' +
              (danger ? 'bg-red-700 hover:bg-red-600' : 'bg-indigo-600 hover:bg-indigo-700')}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
