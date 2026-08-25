import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Mounts expensive content only after the user opens the disclosure. This is
 * intentionally interaction-driven rather than a CSS-only hide, so charts and
 * long timelines do not execute while collapsed.
 */
export default function DeferredSection({
  title,
  description = '',
  children,
  defaultOpen = false,
  className = '',
  contentClassName = '',
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section className={`border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-14 w-full items-center justify-between gap-4 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        <span>
          <span className="block text-sm font-black text-slate-800 dark:text-zinc-100">{title}</span>
          {description ? (
            <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-zinc-400">{description}</span>
          ) : null}
        </span>
        <ChevronDown
          size={18}
          aria-hidden="true"
          className={`shrink-0 text-slate-400 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <div id={contentId} className={`border-t border-zinc-200 p-4 dark:border-zinc-800 ${contentClassName}`}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
