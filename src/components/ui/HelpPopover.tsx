'use client';
import { useState } from 'react';

/**
 * Generic "?" info button + modal, for attaching a short explanation directly onto a button or
 * link without it triggering the parent's own click/navigation. Reusable version of the one-off
 * TablesHelp/VotingHelp/WhyVoteHelp components.
 */
export default function HelpPopover({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  function show(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  }

  function close(e: React.MouseEvent | React.SyntheticEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
  }

  return (
    <>
      <span onClick={show}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-gray-600 text-gray-400 text-xs hover:bg-gray-800 hover:text-gray-200 shrink-0">
        ?
      </span>
      {open && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={close}>
          <div className="max-w-sm w-full bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm text-left"
            onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-100">{title}</h3>
            <div className="text-gray-300 space-y-2">{children}</div>
            <button onClick={close}
              className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700">
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
}
