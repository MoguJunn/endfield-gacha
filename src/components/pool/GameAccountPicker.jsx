import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, User } from 'lucide-react';
import { buildGameAccountServerTag, localizeGameAccountServerTag } from '../../utils/gameAccountMetadata.js';

export default function GameAccountPicker({ accounts, value, onChange, locale = 'zh-CN', disabled = false, allLabel = null }) {
  const english = locale === 'en-US';
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const listId = useId();
  const selected = accounts.find(account => account.key === value);
  const name = account => account.nickName || account.name || account.gameUid;
  const tag = account => localizeGameAccountServerTag(buildGameAccountServerTag({ ...account, serverId: account.serverId || account.server_id || account.serverScope }), locale);
  const options = [...(allLabel ? [{ key: '', name: allLabel }] : []), ...accounts];
  useEffect(() => {
    if (!open) return undefined;
    const close = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const choose = key => { onChange(key); setOpen(false); root.current?.querySelector('[role="combobox"]')?.focus(); };
  return <div ref={root} className="relative min-w-0" onKeyDown={event => {
    if (event.key === 'Escape') { setOpen(false); root.current?.querySelector('[role="combobox"]')?.focus(); }
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && !disabled && options.length) {
      event.preventDefault(); setOpen(true);
      requestAnimationFrame(() => {
        const buttons = [...root.current.querySelectorAll('[role="option"]')];
        const current = buttons.indexOf(document.activeElement);
        buttons[(current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      });
    }
  }}>
    <button type="button" role="combobox" aria-label={english ? 'Game account' : '游戏账号'} aria-expanded={open} aria-controls={listId} aria-haspopup="listbox"
      disabled={disabled || !options.length} onClick={() => setOpen(!open)}
      className="flex w-full min-w-0 items-center gap-2 border border-zinc-300 bg-white px-3 py-2 text-left text-xs text-slate-700 hover:border-yellow-500 disabled:cursor-default disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
      <User size={14} className="shrink-0 text-zinc-500" /><span className="min-w-0 flex-1 truncate font-bold">{selected ? name(selected) : allLabel || '—'}</span>
      {selected && <span className="shrink-0 border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:border-zinc-700">{tag(selected) || (english ? 'Unconfirmed' : '区服待确认')}</span>}
      <ChevronDown size={12} className={`shrink-0 ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div id={listId} role="listbox" aria-label={english ? 'Game accounts' : '游戏账号列表'} className="absolute left-0 top-full z-30 mt-1 max-h-72 w-full min-w-56 overflow-y-auto border border-zinc-300 bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      {options.map(account => <button type="button" role="option" aria-selected={account.key === value} key={account.key} onClick={() => choose(account.key)}
        className={`block w-full px-2 py-2 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 ${account.key === value ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400' : 'text-slate-700 dark:text-zinc-200'}`}>
        <span className="flex min-w-0 items-center gap-2"><strong className="truncate">{name(account)}</strong>{account.gameUid && <small className="shrink-0 border border-zinc-300 px-1 dark:border-zinc-700">{tag(account) || (english ? 'Unconfirmed' : '区服待确认')}</small>}</span>
        {account.gameUid && <span className="mt-1 block text-[11px] text-zinc-500">UID {account.gameUid}</span>}
      </button>)}
    </div>}
  </div>;
}
