import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function WorkbenchDialog({ title, description, onClose, busy = false, children, footer }) {
  const ref = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog ref={ref} className="wb-page wb-dialog" aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined} aria-modal="true"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <header className="wb-dialog-header">
        <div><span className="wb-eyebrow">ENDFIELD // DATA WORKBENCH</span><h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <button type="button" className="wb-icon-button" disabled={busy} aria-label="关闭弹窗" onClick={onClose}><X size={21} /></button>
      </header>
      <div className="wb-dialog-content">{children}</div>
      {footer && <footer className="wb-dialog-footer">{footer}</footer>}
    </dialog>, document.body
  );
}
