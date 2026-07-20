import React, { useEffect, useState } from 'react';
import { AlertCircle, Layers, Save, Search, Swords, Trash2, UserRound, X } from 'lucide-react';
import { characterCache } from '../../utils/characterUtils.js';
import { useI18n } from '../../i18n/index.js';

/**
 * 编辑记录弹窗组件
 * 用于安全修改单条抽卡记录的时间、卡池、目标与抽取方式。
 */
const toDateTimeInputValue = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const getDrawMethod = (item) => {
  if (item?.isInfoBook === true || item?.is_info_book === true) return 'info_book';
  if (item?.isFree === true || item?.is_free === true) return 'free';
  return 'normal';
};

const isWeaponPool = (pool) => {
  const type = String(pool?.type || pool?.pool_type || '').toLowerCase();
  const id = String(pool?.id || pool?.pool_id || '').toLowerCase();
  return type.includes('weapon') || id.startsWith('weponbox') || id.startsWith('weapon');
};

const buildDraft = (item) => ({
  timestamp: toDateTimeInputValue(item?.timestamp),
  poolId: item?.poolId || item?.pool_id || '',
  characterId: item?.characterId || item?.character_id || '',
  drawMethod: getDrawMethod(item),
  isStandard: item?.isStandard === true || item?.is_standard === true,
  specialType: item?.specialType || item?.special_type || '',
  reason: '',
});

const getPoolId = (pool) => String(pool?.id || pool?.pool_id || '');
const getPoolName = (pool, t) => pool?.name || pool?.display_name || getPoolId(pool) || t('records.editor.unnamedPool');

const getPoolTypeLabel = (pool, t) => {
  if (isWeaponPool(pool)) return t('records.editor.poolTypeWeapon');
  const type = String(pool?.type || pool?.pool_type || '').toLowerCase();
  if (type.includes('limited')) return t('records.editor.poolTypeLimited');
  if (type.includes('extra')) return t('records.editor.poolTypeExtra');
  if (type.includes('beginner')) return t('records.editor.poolTypeBeginner');
  return t('records.editor.poolTypeCharacter');
};

function getItemTypeLabel(type, t) {
  return type === 'weapon'
    ? t('records.editor.weapon')
    : t('records.editor.character');
}

function PoolChoiceCard({ pool, selected, onSelect, t }) {
  const weaponPool = isWeaponPool(pool);
  const PoolIcon = weaponPool ? Swords : Layers;
  const poolId = getPoolId(pool);
  const poolName = getPoolName(pool, t);

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={poolName}
      onClick={() => onSelect(poolId)}
      className={`relative min-h-24 w-36 flex-shrink-0 overflow-hidden border p-3 text-left transition-all ${
        selected
          ? 'border-yellow-500 bg-yellow-50 shadow-[inset_0_0_20px_rgba(234,179,8,0.12)] ring-1 ring-yellow-500/30 dark:bg-yellow-500/10'
          : 'border-zinc-300 bg-white hover:border-yellow-500 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-800'
      }`}
      style={{ clipPath: 'polygon(0 0, calc(100% - 9px) 0, 100% 9px, 100% 100%, 9px 100%, 0 calc(100% - 9px))' }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`flex h-7 w-7 items-center justify-center border ${selected ? 'border-yellow-500 bg-yellow-500 text-black' : 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400'}`}>
          <PoolIcon size={14} />
        </span>
        {selected && <span className="bg-yellow-500 px-1.5 py-0.5 text-[9px] font-black tracking-widest text-black">{t('records.editor.current')}</span>}
      </div>
      <div className={`mt-3 line-clamp-2 text-xs font-black leading-4 ${selected ? 'text-yellow-700 dark:text-yellow-400' : 'text-zinc-800 dark:text-zinc-100'}`}>
        {poolName}
      </div>
      <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-zinc-400">{getPoolTypeLabel(pool, t)}</div>
    </button>
  );
}

function CatalogAvatar({ item, t }) {
  const [failed, setFailed] = useState(false);
  const ItemIcon = item?.type === 'weapon' ? Swords : UserRound;
  if (!item?.avatar_url || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
        <ItemIcon size={30} />
      </div>
    );
  }

  return (
    <img
      src={item.avatar_url}
      alt={item.name || item.id || (item.type === 'weapon' ? t('records.editor.weaponImage') : t('records.editor.characterImage'))}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
    />
  );
}

function CatalogItemCard({ item, selected, onSelect, t }) {
  const itemName = item?.name || item?.id || t('records.editor.unnamedItem');
  const label = t('records.editor.itemAriaLabel', {
    name: itemName,
    rarity: item?.rarity || '?',
  });
  return (
    <button
      type="button"
      aria-label={t('records.editor.selectItemAria', { label })}
      aria-pressed={selected}
      onClick={() => onSelect(item.id)}
      className={`group relative overflow-hidden border text-left transition-all ${
        selected
          ? 'border-yellow-500 bg-yellow-50 ring-2 ring-yellow-500/30 dark:bg-yellow-500/10'
          : 'border-zinc-200 bg-white hover:-translate-y-0.5 hover:border-yellow-500 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950'
      }`}
      style={{ clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)' }}
    >
      <div className="aspect-square w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
        <CatalogAvatar item={item} t={t} />
      </div>
      <div className="p-2">
        <div className="truncate text-xs font-black text-zinc-800 dark:text-zinc-100">{item.name || item.id}</div>
        <div className="mt-1 flex items-center justify-between gap-1 text-[9px]">
          <span className="font-black text-yellow-600 dark:text-yellow-400">{item.rarity || '?'}★</span>
          <span className="truncate font-mono text-zinc-400">{item.id}</span>
        </div>
      </div>
      {selected && <span className="absolute right-0 top-0 bg-yellow-500 px-2 py-1 text-[9px] font-black text-black">{t('records.editor.selected')}</span>}
    </button>
  );
}

const EditItemModal = React.memo(({ item, onClose, onUpdate, onDelete, pools = [] }) => {
  const { t, locale } = useI18n();
  const [catalogItems, setCatalogItems] = useState(() => characterCache.getAll());
  const [search, setSearch] = useState('');
  const [activeItemType, setActiveItemType] = useState('character');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(() => buildDraft(item));

  useEffect(() => {
    setDraft(buildDraft(item));
    setSearch('');
    setActiveItemType(item?.item_type === 'weapon' || item?.recordType === 'weapon' ? 'weapon' : 'character');
    setError('');
  }, [item]);

  useEffect(() => {
    let active = true;
    characterCache.load().then(() => {
      if (active) setCatalogItems(characterCache.getAll());
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!item || draft.characterId || catalogItems.length === 0) return;
    const itemName = String(item.character_name || item.item_name || item.name || '').trim();
    const matched = itemName ? characterCache.searchByName(itemName, false) : null;
    if (matched?.id) {
      setDraft((current) => ({ ...current, characterId: matched.id }));
    }
  }, [catalogItems.length, draft.characterId, item]);

  const poolOptions = Array.isArray(pools) ? pools : [];
  const selectedPool = poolOptions.find((pool) => getPoolId(pool) === String(draft.poolId));
  const expectedItemType = isWeaponPool(selectedPool) ? 'weapon' : 'character';
  const normalizedSearch = search.trim().toLowerCase();
  const matchingItems = catalogItems
    .filter((catalogItem) => catalogItem?.type === activeItemType)
    .filter((catalogItem) => {
      if (!normalizedSearch) return true;
      const aliases = Array.isArray(catalogItem.aliases) ? catalogItem.aliases : [];
      return [catalogItem.id, catalogItem.name, ...aliases]
        .some((value) => String(value || '').toLowerCase().includes(normalizedSearch));
    })
    .sort((left, right) => Number(right.rarity || 0) - Number(left.rarity || 0) || String(left.name || '').localeCompare(String(right.name || ''), locale));
  const selectedItem = catalogItems.find((catalogItem) => String(catalogItem.id) === String(draft.characterId));
  const selectedItemMatchesPool = selectedItem?.type === expectedItemType;
  const isLimitedOrWeapon = ['limited', 'limited_character', 'weapon', 'limited_weapon'].includes(
    String(selectedPool?.type || selectedPool?.pool_type || '').toLowerCase()
  ) || isWeaponPool(selectedPool);

  useEffect(() => {
    if (selectedItem?.type) {
      setActiveItemType(selectedItem.type);
      return;
    }
    if (selectedPool) {
      setActiveItemType(isWeaponPool(selectedPool) ? 'weapon' : 'character');
    }
  }, [item, selectedItem?.type, selectedPool]);

  if (!item) return null;

  const updateDraft = (field, value) => {
    setError('');
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const handlePoolChange = (poolId) => {
    const nextPool = poolOptions.find((pool) => getPoolId(pool) === String(poolId));
    const nextType = isWeaponPool(nextPool) ? 'weapon' : 'character';
    setActiveItemType(nextType);
    setSearch('');
    setError('');
    setDraft((current) => {
      const currentItem = catalogItems.find((catalogItem) => String(catalogItem.id) === String(current.characterId));
      return {
        ...current,
        poolId,
        characterId: currentItem?.type === nextType ? current.characterId : '',
      };
    });
  };

  const handleSave = async () => {
    if (!draft.timestamp || Number.isNaN(new Date(draft.timestamp).getTime())) {
      setError(t('records.editor.validationTime'));
      return;
    }
    if (!draft.poolId || !selectedPool) {
      setError(t('records.editor.validationPool'));
      return;
    }
    if (!draft.characterId || !selectedItem || !selectedItemMatchesPool) {
      setError(t('records.editor.validationItem', {
        type: getItemTypeLabel(expectedItemType, t),
      }));
      return;
    }

    setSaving(true);
    setError('');
    try {
      const success = await onUpdate?.(item, {
        timestamp: new Date(draft.timestamp).toISOString(),
        poolId: draft.poolId,
        characterId: draft.characterId,
        drawMethod: draft.drawMethod,
        isStandard: Number(selectedItem.rarity) === 6 ? Boolean(draft.isStandard) : false,
        specialType: Number(selectedItem.rarity) === 6 ? draft.specialType || null : null,
      }, draft.reason);
      if (success === false) {
        setError(t('records.editor.saveConflict'));
      }
    } catch {
      setError(t('records.editor.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto bg-white shadow-2xl animate-scale-up dark:bg-zinc-900" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 flex justify-between items-center">
          <div>
            <h3 className="font-bold text-slate-700 dark:text-zinc-300">{t('records.editor.title')}</h3>
            <p className="mt-1 text-xs text-zinc-500">{t('records.editor.subtitle')}</p>
          </div>
          <button type="button" aria-label={t('records.editor.close')} disabled={saving} onClick={onClose} className="text-slate-400 transition-colors hover:text-slate-600 disabled:opacity-40 dark:text-zinc-500 dark:hover:text-zinc-400">
            <X size={20} />
          </button>
        </div>

        <div className="grid lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.35fr)]">
          <section className="space-y-6 border-b border-zinc-200 p-5 dark:border-zinc-800 sm:p-6 lg:border-b-0 lg:border-r">
            <div className="space-y-5">
              <label className="block space-y-2 text-xs font-bold text-zinc-500">
                {t('records.editor.timestamp')}
                <input
                  type="datetime-local"
                  step="1"
                  value={draft.timestamp}
                  onChange={(event) => updateDraft('timestamp', event.target.value)}
                  className="w-full border border-zinc-300 bg-white px-3 py-2.5 text-sm font-normal text-zinc-800 outline-none focus:border-yellow-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
                />
              </label>

              <div className="space-y-2">
                <div className="text-xs font-bold text-zinc-500">{t('records.editor.drawMethod')}</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ['normal', t('records.editor.drawNormal')],
                    ['free', t('records.editor.drawFree')],
                    ['info_book', t('records.editor.drawInfoBook')],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={draft.drawMethod === value}
                      onClick={() => updateDraft('drawMethod', value)}
                      className={`border px-2 py-2.5 text-xs font-bold transition-colors ${draft.drawMethod === value
                        ? 'border-yellow-500 bg-yellow-500 text-black'
                        : 'border-zinc-300 text-zinc-600 hover:border-yellow-500 dark:border-zinc-700 dark:text-zinc-300'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {Number(selectedItem?.rarity || item.rarity) === 6 && (
                <div className="grid gap-4 border-y border-zinc-200 py-4 dark:border-zinc-800 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-zinc-500">{t('records.editor.sixStarSource')}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" disabled={!isLimitedOrWeapon} onClick={() => updateDraft('isStandard', false)} className={`border py-2 text-xs font-bold disabled:opacity-40 ${!draft.isStandard ? 'border-fuchsia-500 bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-950/30 dark:text-fuchsia-300' : 'border-zinc-300 text-zinc-500 dark:border-zinc-700'}`}>{t('records.editor.up')}</button>
                      <button type="button" onClick={() => updateDraft('isStandard', true)} className={`border py-2 text-xs font-bold ${draft.isStandard ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300' : 'border-zinc-300 text-zinc-500 dark:border-zinc-700'}`}>{t('records.editor.standardOffrate')}</button>
                    </div>
                  </div>
                  <label className="space-y-2 text-xs font-bold text-zinc-500">
                    {t('records.editor.special')}
                    <select value={draft.specialType} onChange={(event) => updateDraft('specialType', event.target.value)} className="w-full border border-zinc-300 bg-white px-3 py-2 text-sm font-normal text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white">
                      <option value="">{t('records.editor.specialNormal')}</option>
                      <option value="guaranteed">{t('records.editor.specialGuaranteed')}</option>
                      <option value="gift">{t('records.editor.specialGift')}</option>
                    </select>
                  </label>
                </div>
              )}

              <label className="block space-y-2 text-xs font-bold text-zinc-500">
                {t('records.editor.reason')}
                <textarea
                  value={draft.reason}
                  onChange={(event) => updateDraft('reason', event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder={t('records.editor.reasonPlaceholder')}
                  className="w-full resize-none border border-zinc-300 bg-white px-3 py-2 text-sm font-normal text-zinc-800 outline-none focus:border-yellow-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
                />
              </label>
            </div>

            <div className="border-t border-zinc-200 pt-5 dark:border-zinc-800">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div id="edit-history-pool-label" className="text-xs font-black text-zinc-700 dark:text-zinc-200">{t('records.editor.pool')}</div>
                  <div className="mt-1 text-[10px] text-zinc-400">{t('records.editor.poolHint')}</div>
                </div>
                <span className="font-mono text-[10px] text-zinc-400">{t('records.editor.poolCount', { count: poolOptions.length })}</span>
              </div>
              <div role="radiogroup" aria-labelledby="edit-history-pool-label" className="pool-card-rail-scrollbar flex gap-2 overflow-x-auto pb-2">
                {poolOptions.map((pool) => (
                  <PoolChoiceCard
                    key={getPoolId(pool)}
                    pool={pool}
                    selected={getPoolId(pool) === String(draft.poolId)}
                    onSelect={handlePoolChange}
                    t={t}
                  />
                ))}
                {poolOptions.length === 0 && (
                  <div className="w-full border border-dashed border-zinc-300 px-4 py-8 text-center text-xs text-zinc-400 dark:border-zinc-700">
                    {t('records.editor.noPools')}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="min-w-0 space-y-4 p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-xs font-black text-zinc-700 dark:text-zinc-200">{t('records.editor.target')}</div>
                <div className="mt-1 text-[10px] text-zinc-400">
                  {t('records.editor.targetHint', { type: getItemTypeLabel(expectedItemType, t) })}
                </div>
              </div>
              {selectedItem && (
                <div className="text-xs text-zinc-500">
                  {t('records.editor.selectedItemPrefix')}<span className="font-bold text-zinc-800 dark:text-zinc-100">{selectedItem.name}</span>{t('records.editor.selectedItemMeta', { rarity: selectedItem.rarity })}
                </div>
              )}
            </div>

            <div role="tablist" aria-label={t('records.editor.catalogType')} className="grid grid-cols-2 border border-zinc-300 dark:border-zinc-700">
              {[
                ['character', t('records.editor.character')],
                ['weapon', t('records.editor.weapon')],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={activeItemType === value}
                  onClick={() => {
                    setActiveItemType(value);
                    setSearch('');
                  }}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-black transition-colors ${activeItemType === value
                    ? 'bg-yellow-500 text-black'
                    : 'bg-white text-zinc-500 hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800'}`}
                >
                  {value === 'weapon' ? <Swords size={14} /> : <UserRound size={14} />} {label}
                  <span className="font-mono text-[10px] opacity-60">
                    {catalogItems.filter((catalogItem) => catalogItem?.type === value).length}
                  </span>
                </button>
              ))}
            </div>

            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('records.editor.searchPlaceholder', {
                  type: getItemTypeLabel(activeItemType, t),
                })}
                className="w-full border border-zinc-300 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-yellow-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
              />
            </div>

            {selectedItem && !selectedItemMatchesPool && (
              <div className="flex items-start gap-2 border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                {t('records.editor.typeMismatch', {
                  selectedType: getItemTypeLabel(selectedItem.type, t),
                  targetType: getItemTypeLabel(expectedItemType, t),
                })}
              </div>
            )}

            <div className="pool-card-rail-scrollbar max-h-[52vh] overflow-y-auto pr-1">
              {matchingItems.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {matchingItems.map((catalogItem) => (
                    <CatalogItemCard
                      key={catalogItem.id}
                      item={catalogItem}
                      selected={String(catalogItem.id) === String(draft.characterId)}
                      onSelect={(characterId) => updateDraft('characterId', characterId)}
                      t={t}
                    />
                  ))}
                </div>
              ) : (
                <div className="border border-dashed border-zinc-300 px-4 py-16 text-center text-xs text-zinc-400 dark:border-zinc-700">
                  {t('records.editor.noMatches', { type: getItemTypeLabel(activeItemType, t) })}
                </div>
              )}
            </div>
          </section>
        </div>

        {error && (
          <div className="mx-5 mb-5 flex items-start gap-2 border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300 sm:mx-6">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 border-t border-zinc-100 bg-slate-50 p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:flex-row sm:justify-between">
          <button
            type="button"
            disabled={saving}
            onClick={() => onDelete?.(item)}
            className="flex items-center justify-center gap-1 px-3 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
          >
            <Trash2 size={16}/> {t('records.editor.delete')}
          </button>
          <div className="flex gap-2">
            <button type="button" disabled={saving} onClick={onClose} className="flex-1 border border-zinc-300 px-5 py-2 text-sm font-bold text-zinc-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300">{t('common.cancel')}</button>
            <button type="button" disabled={saving} onClick={handleSave} className="flex flex-1 items-center justify-center gap-2 bg-yellow-500 px-6 py-2 text-sm font-bold text-black transition-colors hover:bg-yellow-400 disabled:opacity-50">
              <Save size={16} /> {saving ? t('records.editor.saving') : t('records.editor.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

EditItemModal.displayName = 'EditItemModal';

export default EditItemModal;
