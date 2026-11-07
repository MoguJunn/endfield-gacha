import React, { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert } from 'lucide-react';

export default function StatisticsInfo({ label, children }) {
  const id = useId();
  const [trigger, setTrigger] = useState(null);
  const position = event => {
    if (event.newState !== 'open' || !trigger) return;
    const panel = event.currentTarget;
    const anchor = trigger.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 32);
    panel.style.width = `${width}px`;
    panel.style.left = `${Math.max(16, Math.min(anchor.left, window.innerWidth - width - 16))}px`;
    const height = panel.getBoundingClientRect().height;
    panel.style.top = `${Math.max(16, anchor.bottom + height + 12 <= window.innerHeight ? anchor.bottom + 8 : anchor.top - height - 8)}px`;
  };
  return <span className="ex-info">
    <button ref={setTrigger} type="button" className="ex-info-trigger" popoverTarget={id} aria-label={label} title={label}>
      <CircleAlert size={15} aria-hidden="true" />
    </button>
    {trigger && createPortal(<div id={id} popover="auto" className="ex-info-panel" role="note" onToggle={position}>
      <strong>{label}</strong><div>{children}</div>
    </div>, trigger.closest('.experience-ui') || document.body)}
  </span>;
}
