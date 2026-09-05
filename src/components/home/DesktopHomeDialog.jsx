import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import './desktopHomeDemo.css';

export default function DesktopHomeDialog({ title, onClose, children, className = '' }) {
  const ref = useRef(null);
  const timeout = useRef(null);
  const [closing, setClosing] = useState(false);
  const { isEnglish } = useI18n();
  useEffect(() => {
    const element = ref.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => {
      clearTimeout(timeout.current);
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  const close = () => {
    if (closing) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onClose();
      return;
    }
    setClosing(true);
    timeout.current = window.setTimeout(onClose, 160);
  };
  return createPortal(
    <dialog
      ref={ref}
      aria-label={title}
      className={`dh-dialog ${className} ${closing ? 'dh-dialog--closing' : ''}`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          close();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = [
          ...ref.current.querySelectorAll(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'
          ),
        ].filter((el) => el.getClientRects().length);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <header className="dh-dialog-heading">
        <div>
          <small>ENDFIELD // OBSERVATORY</small>
          <h2>{title}</h2>
        </div>
        <button type="button" onClick={close} aria-label={isEnglish ? 'Close' : '关闭'}>
          <X size={22} />
        </button>
      </header>
      {children}
    </dialog>,
    document.body
  );
}
