import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Search, Star } from 'lucide-react';
import { observationItemGroupLabel } from '../../utils/observationItemDisplay.js';

function Portrait({ item }) {
  return item?.avatarUrl ? <img src={item.avatarUrl} alt="" loading="lazy" /> : <span className="ex-picker-placeholder"><Star size={16} aria-hidden="true" /></span>;
}

export default function ObservationTargetPicker({ options, item, onSelect, t }) {
  const id = useId();
  const root = useRef(null);
  const trigger = useRef(null);
  const search = useRef(null);
  const list = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState('');
  const [placement, setPlacement] = useState({ above: false, height: 390 });
  const filtered = options.filter((option) => `${option.name} ${option.canonicalName}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const active = filtered.find((option) => option.itemId === activeId) || filtered[0];
  const groups = [...new Set(filtered.map((option) => option.group))];
  const optionId = (option) => `${id}-option-${options.indexOf(option)}`;
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  const choose = (option) => { onSelect(option.itemId); close(true); };

  useEffect(() => {
    if (!open) return undefined;
    search.current?.focus({ preventScroll: true });
    const place = () => {
      const rect = trigger.current.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const useAbove = below < 300 && above > below;
      setPlacement({ above: useAbove, height: Math.max(100, Math.min(390, useAbove ? above : below)) });
    };
    const outside = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    place();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const option = list.current?.querySelector('[data-active="true"]');
    if (option && list.current) {
      const bounds = option.getBoundingClientRect();
      const container = list.current.getBoundingClientRect();
      if (bounds.top < container.top) list.current.scrollTop -= container.top - bounds.top;
      else if (bounds.bottom > container.bottom) list.current.scrollTop += bounds.bottom - container.bottom;
    }
  }, [open, active?.itemId, placement.height]);

  const start = () => { setQuery(''); setActiveId(item?.itemId || ''); setOpen(true); };
  const onSearchKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'Enter' && active) { event.preventDefault(); choose(active); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !filtered.length) return;
    if (['Home', 'End'].includes(event.key) && query) return;
    event.preventDefault();
    const index = filtered.indexOf(active);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length;
    setActiveId(filtered[next].itemId);
  };

  return <div className="ex-target-picker" ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <span id={`${id}-label`} className="ex-picker-label">{t('关注对象', 'Focus item')}</span>
    <button ref={trigger} className="ex-picker-trigger" type="button" aria-label={t('关注对象', 'Focus item')} aria-haspopup="dialog"
      aria-expanded={open} aria-controls={open ? `${id}-popup` : undefined} data-value={item?.itemId || ''} disabled={!options.length}
      onClick={() => open ? close() : start()} onKeyDown={(event) => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); start(); } }}>
      <Portrait item={item} /><span className="ex-picker-trigger-copy"><strong>{item?.name || t('暂无对象', 'No items')}</strong><small>{item ? observationItemGroupLabel(item.group, t) : '—'}</small></span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && <div className="ex-picker-popup" id={`${id}-popup`} role="dialog" aria-label={t('选择关注对象', 'Choose a focus item')}
      data-above={placement.above} style={{ maxHeight: placement.height }}>
      <div className="ex-picker-search"><Search size={15} aria-hidden="true" /><input ref={search} type="search" role="combobox" aria-label={t('搜索关注对象', 'Search focus items')}
        aria-expanded="true" aria-autocomplete="list" aria-controls={`${id}-list`} aria-activedescendant={active ? optionId(active) : undefined}
        placeholder={t('搜索干员或武器', 'Search operators or weapons')} value={query} onKeyDown={onSearchKeyDown}
        onChange={(event) => { setQuery(event.target.value); setActiveId(''); }} /></div>
      <div ref={list} className="ex-picker-list" id={`${id}-list`} role="listbox" tabIndex={-1} aria-labelledby={`${id}-label`}>
        {groups.map((group) => <div role="group" aria-labelledby={`${id}-${group}`} key={group}>
          <div className="ex-picker-group" id={`${id}-${group}`}><span>{observationItemGroupLabel(group, t)}</span><span>{filtered.filter((option) => option.group === group).length}</span></div>
          {filtered.filter((option) => option.group === group).map((option) => <button type="button" key={option.itemId} id={optionId(option)} className="ex-picker-option" role="option"
            aria-label={option.name} aria-selected={item?.itemId === option.itemId} data-active={active?.itemId === option.itemId} data-group={group} tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
            <Portrait item={option} /><span className="ex-picker-option-copy"><strong>{option.name}</strong><small>{option.rarity}★{option.missing ? t(' · 暂无统计', ' · No statistics') : ''}</small></span>
            {item?.itemId === option.itemId && <Check size={16} aria-hidden="true" />}
          </button>)}
        </div>)}
      </div>
      {!filtered.length && <p className="ex-picker-empty" role="status">{t('没有匹配的对象', 'No matching items')}</p>}
    </div>}
  </div>;
}
