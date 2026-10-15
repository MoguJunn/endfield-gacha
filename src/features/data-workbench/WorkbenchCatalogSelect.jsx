import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Search, Check } from 'lucide-react';
import { entitySelectGroups, poolSelectGroups } from './workbenchCatalog.js';

export default function WorkbenchCatalogSelect({ value = '', onChange, groups = [], label, placeholder = '请选择', disabled = false, emptyText = '没有可选项目' }) {
  const id = useId();
  const trigger = useRef(null); const popover = useRef(null); const search = useRef(null);
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(''); const [closed, setClosed] = useState({});
  const selected = groups.flatMap(group => group.options).find(option => option.value === String(value));
  const needle = query.trim().toLowerCase();
  const filtered = groups.map(group => ({ ...group, options: group.options.filter(option => `${option.label} ${option.search || ''}`.toLowerCase().includes(needle)) })).filter(group => group.options.length);
  useEffect(() => {
    if (!open) return undefined;
    const panel = popover.current;
    const position = () => {
      const box = trigger.current.getBoundingClientRect();
      const height = Math.min(350, innerHeight - 24);
      const below = innerHeight - box.bottom - 12;
      panel.style.left = `${Math.min(Math.max(8, box.left), Math.max(8, innerWidth - Math.max(260, box.width) - 8))}px`;
      panel.style.width = `${Math.min(Math.max(260, box.width), innerWidth - 16)}px`;
      panel.style.top = `${below >= 180 ? box.bottom + 5 : Math.max(8, box.top - Math.min(height, box.top - 8) - 5)}px`;
      panel.style.maxHeight = `${below >= 180 ? Math.min(height, below) : Math.min(height, box.top - 12)}px`;
    };
    position();
    if (panel.showPopover) panel.showPopover(); else panel.style.display = 'block';
    search.current?.focus();
    const outside = event => { if (!panel.contains(event.target) && !trigger.current.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', position);
    return () => { panel.hidePopover?.(); document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', position); };
  }, [open]);
  const choose = option => { if (option.disabled) return; onChange(option.value); setOpen(false); trigger.current.focus(); };
  return <span className="wb-catalog-select">
    <button type="button" ref={trigger} className="wb-input wb-catalog-trigger" role="combobox" aria-label={label} aria-expanded={open} aria-controls={id} aria-haspopup="listbox" disabled={disabled}
      onClick={() => { setQuery(''); setOpen(!open); }} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}>
      <span className={!selected ? 'wb-catalog-placeholder' : ''}>{selected?.label || (value ? '原项目不在本池名单，请重新选择' : placeholder)}</span><ChevronDown size={15} />
    </button>
    {open && <div ref={popover} id={id} popover="manual" className="wb-catalog-popover" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current.focus(); }
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault(); const options = [...popover.current.querySelectorAll('[role="option"]:not(:disabled)')];
        const index = options.indexOf(document.activeElement); options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
      }
    }}>
      <div className="wb-catalog-search"><Search size={14} /><input ref={search} type="search" aria-label={`搜索${label}`} placeholder="搜索名称" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <div role="listbox" aria-label={label} className="wb-catalog-options">
        <button type="button" role="option" aria-selected={!value} className="wb-catalog-option" onClick={() => choose({ value: '' })}>{placeholder}</button>
        {filtered.map(group => <div key={group.id} role="group" aria-label={group.label}>
          <button type="button" className="wb-catalog-group" aria-expanded={needle ? true : !closed[group.id]} onClick={() => setClosed(old => ({ ...old, [group.id]: !old[group.id] }))}>{group.label}<span>{group.options.length}<ChevronDown size={13} className={closed[group.id] && !needle ? 'is-closed' : ''} /></span></button>
          {(needle || !closed[group.id]) && group.options.map(option => <button key={option.value} type="button" role="option" disabled={option.disabled} aria-disabled={option.disabled || undefined} aria-selected={option.value === String(value)} className="wb-catalog-option" onClick={() => choose(option)}>
            {option.avatar && <img src={option.avatar} alt="" loading="lazy" />}<span>{option.label}{option.detail && <small>{option.detail}</small>}</span>{option.value === String(value) && <Check size={14} />}
          </button>)}
        </div>)}
        {!filtered.length && <p className="wb-catalog-empty">{emptyText}</p>}
      </div>
    </div>}
  </span>;
}

export function WorkbenchPoolSelect({ pools, ...props }) { return <WorkbenchCatalogSelect {...props} groups={poolSelectGroups(pools)} />; }
export function WorkbenchEntitySelect({ pool, entities, rarity, ...props }) {
  return <WorkbenchCatalogSelect {...props} groups={entitySelectGroups(pool, entities, { rarity })} emptyText="本池名单没有对应项目，请核对卡池资料" />;
}
