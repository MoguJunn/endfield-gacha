import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Crown,
  Grid2X2,
  List,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Trash2,
  User,
  Users,
  X
} from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import { characterCache } from '../../utils/characterUtils.js';
import { localizeEntityName } from '../../utils/gameDataI18n.js';
import { annotateInfoBookPulls } from '../../utils/historyInfoBook.js';
import { normalizeIsStandard } from '../../utils/index.js';
import {
  buildLimitedCrossPoolPityMap,
  buildTimelineAcquisitionIndex
} from '../../utils/poolTimelineView.js';
import { getDesktopPathForTab, getMobilePathForTab } from '../../constants/appRoutes.js';
import { usePoolStore } from '../../stores';
import { usePersonalGameAccounts } from '../../hooks/app/usePersonalGameAccounts.js';
import { RARITY_CONFIG } from '../../constants/index.js';
import {
  getGameAccountSelectionValue,
  getHistoryRecordGameUid,
  isGameAccountSelectionMatch,
  localizeGameAccountServerTag,
} from '../../utils/gameAccountMetadata.js';
import {
  attachRankingInfoToCatalogRows,
  buildCharacterCatalogRows,
  calculateCharacterQuotaForCopy,
  createEmptyQuotaSummary,
  FULL_POTENTIAL_COPY_COUNT,
  MAX_POTENTIAL_LEVEL,
  normalizeQuotaSummary
} from '../../utils/quotaEconomy.js';
import { getStorageItem, setStorageItem, STORAGE_KEYS } from '../../utils/storageUtils.js';
import {
  DEFAULT_CHARACTER_CATALOG_FILTERS,
  getCatalogRowPotentialState,
  getCatalogRowQuota,
  isCatalogRowOwned,
  selectCharacterCatalogRows
} from '../../utils/characterCatalogViewModel.js';
import {
  getLocalizedResourceLabel,
  RESOURCE_ICON_URLS
} from '../../utils/resourceEconomy.js';
import RankingCard from './RankingCard.jsx';
import LimitedUpAnalysisStrip from './LimitedUpAnalysisStrip.jsx';
import { loadAllAccountGachaHistoryForAccounts } from '../../services/accountGachaDataService.js';

const RARITY_OPTIONS = ['all', '6', '5', '4'];
const LIMITED_OPTIONS = ['all', 'limited', 'standard'];
const OWNERSHIP_OPTIONS = ['all', 'owned', 'unowned'];
const POTENTIAL_OPTIONS = ['all', 'owned_unfull', 'full', 'excess'];
const SORT_OPTIONS = ['ownershipRate', 'ownerUsers', 'fullPotentialRate', 'rarity', 'name', 'copies', 'quota'];
const SORT_DIRECTION_OPTIONS = ['desc', 'asc'];

const RANKING_SECTION_LABEL_KEYS = {
  extraUp: 'characterCatalog.ranking.extraUp',
  extraFive: 'characterCatalog.ranking.extraFive',
  limitedUp: 'characterCatalog.ranking.limitedUp',
  limitedOffStandard: 'characterCatalog.ranking.limitedOffStandard',
  limitedOffLimited: 'characterCatalog.ranking.limitedOffLimited',
  limitedFive: 'characterCatalog.ranking.limitedFive',
  standardSix: 'characterCatalog.ranking.standardSix',
  standardFive: 'characterCatalog.ranking.standardFive'
};

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeHistoryForUser(history = [], user, currentGameUid = null) {
  if (!user?.id) {
    return [];
  }
  return (Array.isArray(history) ? history : []).filter((record) => {
    if (record?.user_id && record.user_id !== user.id) {
      return false;
    }
    if (!currentGameUid) {
      return true;
    }
    return isGameAccountSelectionMatch(record, currentGameUid)
      || getHistoryRecordGameUid(record) === currentGameUid;
  });
}

function getManualOverrideScopeKey(user, gameUid) {
  return `${user?.id || 'local'}::${gameUid || 'all'}`;
}

function getRowKey(row = {}) {
  const safeRow = row || {};
  return String(safeRow.id || safeRow.name || '');
}

function buildQuotaFromManualCount(rarity, acquisitionCount) {
  const quota = createEmptyQuotaSummary();
  const normalizedCount = Math.max(0, Math.floor(toFiniteNumber(acquisitionCount)));
  for (let copyNumber = 1; copyNumber <= normalizedCount; copyNumber += 1) {
    const copyQuota = calculateCharacterQuotaForCopy({ rarity, copyNumber });
    Object.keys(quota).forEach((key) => {
      quota[key] += Number(copyQuota[key] || 0);
    });
  }
  return normalizeQuotaSummary(quota);
}

function summarizeLocalRows(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const quota = createEmptyQuotaSummary();
  let excessTrustTokens = 0;

  safeRows.forEach((row) => {
    const rowQuota = getCatalogRowQuota(row);
    Object.keys(quota).forEach((key) => {
      quota[key] += Number(rowQuota[key] || 0);
    });
    excessTrustTokens += Math.max(0, Math.floor(toFiniteNumber(row.excessTrustTokens)));
  });

  const ownedCharacters = safeRows.filter((row) => isCatalogRowOwned(row, 'local')).length;
  const fullPotentialCharacters = safeRows.filter((row) => toFiniteNumber(row.potentialLevel) >= MAX_POTENTIAL_LEVEL).length;
  return {
    totalCharacters: safeRows.length,
    ownedCharacters,
    unownedCharacters: Math.max(safeRows.length - ownedCharacters, 0),
    ownershipRate: safeRows.length > 0 ? ownedCharacters / safeRows.length : 0,
    fullPotentialCharacters,
    quota: normalizeQuotaSummary(quota),
    excessTrustTokens
  };
}

function applyManualOverridesToCatalog(catalog = null, overrides = {}) {
  if (!catalog?.rows || !overrides || Object.keys(overrides).length === 0) {
    return catalog;
  }

  const rows = catalog.rows.map((row) => {
    const override = overrides[getRowKey(row)];
    if (!override) {
      return row;
    }

    const owned = override.owned === true;
    const potentialLevel = owned
      ? Math.min(MAX_POTENTIAL_LEVEL, Math.max(0, Math.floor(toFiniteNumber(override.potentialLevel))))
      : 0;
    const acquisitionCount = owned ? potentialLevel + 1 : 0;
    const source = String(override.source || '').trim();

    return {
      ...row,
      owned,
      acquisitionCount,
      potentialLevel,
      acquisitionPulls: [],
      trustTokensGained: Math.max(acquisitionCount - 1, 0),
      excessTrustTokens: Math.max(acquisitionCount - FULL_POTENTIAL_COPY_COUNT, 0),
      firstAcquiredAt: owned ? row.firstAcquiredAt : null,
      firstAcquiredPoolName: owned ? (source || row.firstAcquiredPoolName) : null,
      lastAcquiredAt: owned ? row.lastAcquiredAt : null,
      lastAcquiredPoolName: owned ? (source || row.lastAcquiredPoolName) : null,
      manualOverrideApplied: true,
      manualSource: source,
      quota: buildQuotaFromManualCount(row.rarity, acquisitionCount)
    };
  });

  return {
    ...catalog,
    rows,
    summary: summarizeLocalRows(rows)
  };
}

function formatRateValue(value, formatNumber, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '-';
  }
  return `${formatNumber(numeric * 100, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}%`;
}

function getRowAvatar(row) {
  return row?.avatarUrl || row?.avatar_url || null;
}

function getSummaryQuota(summary = {}) {
  return getCatalogRowQuota({ quota: summary.quota || summary.quotaAggregate });
}

function getCharacterDisplayName(row, locale) {
  return localizeEntityName(row?.name, { locale, type: 'character' }) || row?.name || '-';
}

function getRarityBadgeTone(row) {
  const rarity = Number(row?.rarity) || 0;
  if (rarity >= 6 && row?.isLimited) {
    return {
      className: 'rainbow-badge text-white',
      style: null
    };
  }
  if (rarity >= 6) {
    return {
      className: 'text-white',
      style: { backgroundColor: RARITY_CONFIG['6_std'].color }
    };
  }
  if (rarity === 5) {
    return {
      className: 'text-black',
      style: { backgroundColor: RARITY_CONFIG[5].color }
    };
  }
  if (rarity === 4) {
    return {
      className: 'text-white',
      style: { backgroundColor: RARITY_CONFIG[4].color }
    };
  }
  return {
    className: 'bg-zinc-500 text-white',
    style: null
  };
}

function getPotentialLabel(row, dataSource, tt) {
  const state = getCatalogRowPotentialState(row, dataSource);
  const labels = {
    unowned: tt('characterCatalog.potential.unowned', '未拥有'),
    owned_unfull: tt('characterCatalog.potential.ownedUnfull', '未满潜'),
    full: tt('characterCatalog.potential.full', '满潜'),
    excess: tt('characterCatalog.potential.excess', '有超出信物')
  };
  return labels[state] || labels.unowned;
}

function StatTile({ icon: Icon, label, value, hint, tone = 'text-slate-900 dark:text-white', mobile = false }) {
  return (
    <div className={`${mobile ? 'rounded-xl p-3' : 'p-4'} border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#151518] transition-colors`} style={!mobile ? { clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)' } : {}}>
      <div className={`flex items-start ${mobile ? 'gap-1.5 text-[9px]' : 'gap-2 text-[10px]'} break-words font-bold uppercase leading-tight tracking-[0.14em] text-zinc-500`}>
        {Icon && <Icon size={mobile ? 12 : 13} />}
        {label}
      </div>
      <div className={`${mobile ? 'mt-1.5 text-lg' : 'mt-2 text-xl sm:text-2xl'} break-words font-mono font-black leading-tight ${tone}`}>{value}</div>
      {hint && <div className={`${mobile ? 'text-[9px]' : 'text-[11px]'} mt-1 break-words leading-snug text-zinc-500`}>{hint}</div>}
    </div>
  );
}

function QuotaTiles({ quota, formatNumber, locale, tt, mobile = false, compact = false }) {
  const items = [
    {
      key: 'aic',
      label: getLocalizedResourceLabel('aicQuota', locale),
      icon: RESOURCE_ICON_URLS.aicQuota,
      value: quota.aicQuotaTotalPotential,
      hint: tt('characterCatalog.quota.aicHint', '直得 {direct} / 可兑换 {convertible}', {
        direct: formatNumber(quota.aicQuotaDirect || 0),
        convertible: formatNumber(quota.aicQuotaConvertible || 0)
      })
    },
    {
      key: 'bond',
      label: getLocalizedResourceLabel('bondQuota', locale),
      icon: RESOURCE_ICON_URLS.bondQuota,
      value: quota.bondQuotaDirect,
      hint: tt('characterCatalog.quota.bondHint', '重复 5★ / 6★ 角色产生')
    },
    {
      key: 'endpoint',
      label: getLocalizedResourceLabel('endpointQuota', locale),
      icon: RESOURCE_ICON_URLS.endpointQuota,
      value: quota.endpointQuotaConvertible,
      hint: tt('characterCatalog.quota.endpointHint', '满潜后 6★ 超出信物可兑换')
    }
  ];

  return (
    <div className={`grid ${mobile || compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-3'} ${mobile ? 'gap-2' : 'gap-3'}`}>
      {items.map((item) => (
        <div
          key={item.key}
          className={`flex min-w-0 items-center border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#151518] transition-colors ${mobile ? 'gap-2 p-2.5' : 'gap-3 p-3'}`}
          style={!mobile ? { clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)' } : {}}
        >
          <div className={`flex ${mobile ? 'h-8 w-8' : 'h-10 w-10'} shrink-0 items-center justify-center border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950`} style={!mobile ? { clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' } : {}}>
            <img src={item.icon} alt={item.label} className={`${mobile ? 'h-6 w-6' : 'h-8 w-8'} object-contain`} loading="lazy" />
          </div>
          <div className="min-w-0 flex-1">
            <div className={`break-words ${mobile ? 'text-[9px]' : 'text-[10px]'} font-bold uppercase leading-tight tracking-[0.12em] text-zinc-500`} title={item.label}>{item.label}</div>
            <div className={`font-mono ${mobile ? 'text-lg' : 'text-xl'} font-black text-slate-900 dark:text-white`}>{formatNumber(item.value || 0)}</div>
            <div className={`break-words ${mobile ? 'text-[9px]' : 'text-[10px]'} leading-snug text-zinc-500`}>{item.hint}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FilterSelect({ label, value, options, onChange, mobile = false }) {
  return (
    <label className={`${mobile ? 'min-w-0 text-[9px]' : 'min-w-[8rem] text-[10px]'} flex-1 font-bold uppercase tracking-[0.12em] text-zinc-500`}>
      <span className="mb-1 block">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full border border-zinc-200 bg-white px-2 ${mobile ? 'py-1.5 text-[11px]' : 'py-2 text-xs'} font-semibold text-slate-800 outline-none transition focus:border-yellow-500 dark:border-zinc-800 dark:bg-[#151518] dark:text-zinc-200 focus:ring-1 focus:ring-yellow-500/50`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function AccountSelect({ accounts = [], currentGameUid, onChange, locale, tt, mobile = false, disabled = false }) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return null;
  }

  const selectedAccount = accounts.find((account) => (
    getGameAccountSelectionValue(account) === currentGameUid
  )) || accounts[0] || null;
  const selectedValue = getGameAccountSelectionValue(selectedAccount) || '';
  const selectedServerTag = selectedAccount?.serverTag
    ? localizeGameAccountServerTag(selectedAccount.serverTag, locale)
    : null;

  return (
    <label className={`relative block ${mobile ? 'w-full' : 'w-44'}`}>
      <span className="sr-only">{tt('pool.selector.switchAccountHint', '切换游戏账号')}</span>
      <div className={`pointer-events-none absolute left-2 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 ${disabled ? 'opacity-50' : ''}`}>
        <User size={mobile ? 11 : 12} className="text-yellow-500" />
        {selectedAccount && currentGameUid === selectedValue ? <Check size={mobile ? 10 : 11} className="text-emerald-500" /> : null}
      </div>
      <select
        value={currentGameUid || selectedValue}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full appearance-none border border-zinc-200 bg-white py-2 pl-10 pr-7 font-bold text-slate-800 outline-none transition focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500/50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-[#0c0c0e] dark:text-zinc-200 ${mobile ? 'text-[10px]' : 'text-xs'}`}
        style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}
        title={selectedAccount ? `${selectedAccount.nickName || selectedAccount.gameUid} · ${selectedAccount.gameUid}` : undefined}
      >
        {accounts.map((account) => {
          const accountValue = getGameAccountSelectionValue(account) || account.gameUid;
          const serverTag = account.serverTag ? localizeGameAccountServerTag(account.serverTag, locale) : '';
          const label = [serverTag, account.nickName || account.gameUid].filter(Boolean).join(' · ');
          return (
            <option key={accountValue} value={accountValue}>
              {label}
            </option>
          );
        })}
      </select>
      <ChevronDown size={mobile ? 12 : 13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500" />
      {selectedServerTag && !mobile ? (
        <span className="pointer-events-none absolute right-7 top-1/2 hidden -translate-y-1/2 border border-blue-200 bg-blue-50 px-1 py-0.5 text-[8px] font-black text-blue-600 dark:border-blue-500/40 dark:bg-blue-900/30 dark:text-blue-300 min-[1180px]:block">
          {selectedServerTag}
        </span>
      ) : null}
    </label>
  );
}

function ManualCatalogEditor({ open, rows = [], selectedRow, overrides = {}, onSave, onRemove, onClose, locale, tt, mobile = false }) {
  const sortedRows = React.useMemo(() => [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const rarityDiff = toFiniteNumber(right.rarity) - toFiniteNumber(left.rarity);
    if (rarityDiff !== 0) return rarityDiff;
    return getCharacterDisplayName(left, locale).localeCompare(getCharacterDisplayName(right, locale), 'zh-Hans-CN');
  }), [locale, rows]);
  const initialKey = getRowKey(selectedRow) || getRowKey(sortedRows[0]);
  const [characterKey, setCharacterKey] = React.useState(initialKey);
  const activeRow = sortedRows.find((row) => getRowKey(row) === characterKey) || sortedRows[0] || null;
  const activeOverride = activeRow ? overrides[getRowKey(activeRow)] : null;
  const [owned, setOwned] = React.useState(true);
  const [potentialLevel, setPotentialLevel] = React.useState(0);
  const [source, setSource] = React.useState('');

  React.useEffect(() => {
    if (!open) {
      return;
    }
    const nextKey = getRowKey(selectedRow) || getRowKey(sortedRows[0]);
    if (nextKey) {
      setCharacterKey(nextKey);
    }
  }, [open, selectedRow, sortedRows]);

  React.useEffect(() => {
    if (!activeRow) {
      return;
    }
    const override = overrides[getRowKey(activeRow)];
    if (override) {
      setOwned(override.owned === true);
      setPotentialLevel(Math.min(MAX_POTENTIAL_LEVEL, Math.max(0, Math.floor(toFiniteNumber(override.potentialLevel)))));
      setSource(String(override.source || ''));
      return;
    }

    setOwned(isCatalogRowOwned(activeRow, 'local'));
    setPotentialLevel(Math.min(MAX_POTENTIAL_LEVEL, Math.max(0, Math.floor(toFiniteNumber(activeRow.potentialLevel)))));
    setSource(activeRow.manualSource || activeRow.firstAcquiredPoolName || '');
  }, [activeRow, overrides]);

  if (!open) {
    return null;
  }

  const handleSave = () => {
    if (!activeRow) {
      return;
    }
    onSave?.(getRowKey(activeRow), {
      characterId: getRowKey(activeRow),
      name: activeRow.name,
      owned,
      potentialLevel: owned ? potentialLevel : 0,
      source: source.trim(),
      updatedAt: new Date().toISOString()
    });
  };

  const handleRemove = () => {
    if (!activeRow) {
      return;
    }
    onRemove?.(getRowKey(activeRow));
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/55 p-4" onClick={onClose}>
      <div
        className={`mx-auto w-full ${mobile ? 'mt-10 max-w-sm' : 'mt-20 max-w-xl'} border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-[#111113]`}
        style={!mobile ? { clipPath: 'polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px))' } : {}}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
              <Pencil size={15} className="text-yellow-500" />
              {tt('characterCatalog.manual.title', '编辑我的图鉴记录')}
            </div>
            <div className="mt-1 text-[11px] leading-snug text-zinc-500">
              {tt('characterCatalog.manual.description', '手动补录只影响当前账号的角色图鉴显示，不会写入抽卡历史。')}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-zinc-500 hover:text-slate-900 dark:hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <label className="block font-bold uppercase tracking-[0.12em] text-zinc-500">
            <span className="mb-1 block">{tt('characterCatalog.manual.character', '角色')}</span>
            <select
              value={characterKey}
              onChange={(event) => setCharacterKey(event.target.value)}
              className="w-full border border-zinc-200 bg-white px-3 py-2 font-semibold text-slate-800 outline-none focus:border-yellow-500 dark:border-zinc-800 dark:bg-[#151518] dark:text-zinc-200"
            >
              {sortedRows.map((row) => (
                <option key={getRowKey(row)} value={getRowKey(row)}>
                  {getCharacterDisplayName(row, locale)} · {row.rarity || 0}★
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 border border-zinc-200 bg-zinc-50 px-3 py-2 font-bold text-slate-800 dark:border-zinc-800 dark:bg-[#151518] dark:text-zinc-200">
            <input
              type="checkbox"
              checked={owned}
              onChange={(event) => setOwned(event.target.checked)}
              className="h-4 w-4 accent-yellow-500"
            />
            {tt('characterCatalog.manual.owned', '已获得该角色')}
          </label>

          <label className="block font-bold uppercase tracking-[0.12em] text-zinc-500">
            <span className="mb-1 block">{tt('characterCatalog.manual.potential', '潜能')}</span>
            <select
              value={potentialLevel}
              disabled={!owned}
              onChange={(event) => setPotentialLevel(Number(event.target.value))}
              className="w-full border border-zinc-200 bg-white px-3 py-2 font-semibold text-slate-800 outline-none focus:border-yellow-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-[#151518] dark:text-zinc-200"
            >
              {[0, 1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value === MAX_POTENTIAL_LEVEL
                    ? tt('characterCatalog.manual.fullPotentialOption', '满潜 / 5潜')
                    : tt('characterCatalog.manual.potentialOption', '{value}潜', { value })}
                </option>
              ))}
            </select>
          </label>

          <label className="block font-bold uppercase tracking-[0.12em] text-zinc-500">
            <span className="mb-1 block">{tt('characterCatalog.manual.source', '来源')}</span>
            <input
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder={tt('characterCatalog.manual.sourcePlaceholder', '例如：启程寻访 / 附加寻访 / 手动补录')}
              className="w-full border border-zinc-200 bg-white px-3 py-2 font-semibold text-slate-800 outline-none focus:border-yellow-500 dark:border-zinc-800 dark:bg-[#151518] dark:text-zinc-200"
            />
          </label>

          {activeOverride && (
            <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              {tt('characterCatalog.manual.overrideActive', '该角色当前使用手动补录记录。')}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleRemove}
            disabled={!activeOverride}
            className="inline-flex items-center gap-1.5 border border-zinc-200 px-3 py-2 text-xs font-bold text-zinc-500 transition hover:border-red-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800"
          >
            <Trash2 size={13} />
            {tt('characterCatalog.manual.clear', '清除补录')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 bg-yellow-500 px-4 py-2 text-xs font-black text-black transition hover:bg-yellow-400"
            style={{ clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)' }}
          >
            <Check size={14} />
            {tt('characterCatalog.manual.save', '保存补录')}
          </button>
        </div>
      </div>
    </div>
  );
}

function RankingTags({ rankingInfo = [], formatNumber, tt }) {
  if (!Array.isArray(rankingInfo) || rankingInfo.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {rankingInfo.map((item) => (
        <span
          key={`${item.section}-${item.rank}`}
          className="border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
        >
          {RANKING_SECTION_LABEL_KEYS[item.section] ? tt(RANKING_SECTION_LABEL_KEYS[item.section], item.section) : item.section} #{item.rank} · ×{formatNumber(item.count || 0)}
        </span>
      ))}
    </div>
  );
}

function CharacterAvatar({ row, name, sizeClass = 'h-14 w-14' }) {
  const avatarUrl = getRowAvatar(row);

  return (
    <div className={`${sizeClass} shrink-0 overflow-hidden border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950`}>
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-zinc-400">
          <User size={20} />
        </div>
      )}
    </div>
  );
}

function AcquisitionPullList({ pulls = [], tt, compact = false, onJump = null }) {
  const entries = Array.isArray(pulls) ? pulls.filter(Boolean) : [];
  if (entries.length === 0) {
    return <span className="text-zinc-500 dark:text-zinc-600">--</span>;
  }

  const renderEntry = (entry, index) => {
    let label = entry?.pulls ? String(entry.pulls) : '-';
    let className = 'text-slate-700 dark:text-zinc-300';

    if (entry?.kind === 'pity') {
      label = `${entry?.pulls || '?'}保底`;
      className = 'text-pink-400';
    } else if (entry?.kind === 'cycle') {
      label = `${entry?.pulls || '?'}抽`;
      className = 'text-emerald-400';
    } else if (entry?.kind === 'free') {
      label = tt('simulator.history.freeTen', '免费');
      className = 'text-sky-400';
    }

    return (
      <React.Fragment key={`${entry?.kind || 'normal'}-${entry?.pulls || 'x'}-${index}`}>
        {index > 0 && <span className="text-zinc-400 dark:text-zinc-600">/</span>}
        {entry?.timelineElementId && typeof onJump === 'function' ? (
          <button
            type="button"
            className={`${className} underline decoration-dotted underline-offset-2 hover:brightness-110`}
            title={entry?.poolName || undefined}
            onClick={(event) => {
              event.stopPropagation();
              onJump(entry);
            }}
          >
            {label}
          </button>
        ) : (
          <span className={className}>{label}</span>
        )}
      </React.Fragment>
    );
  };

  return (
    <div className={`${compact ? 'text-[10px]' : 'text-[11px]'} font-mono font-bold leading-tight tabular-nums`}>
      {entries.map(renderEntry)}
    </div>
  );
}

function CharacterCard({ row, dataSource, onSelect, selected, locale, formatNumber, tt, mobile = false, onJumpToTimeline = null }) {
  const name = getCharacterDisplayName(row, locale);
  const owned = isCatalogRowOwned(row, dataSource);
  const rarity = Number(row.rarity) || 0;
  const avatarUrl = getRowAvatar(row);
  const potentialState = getCatalogRowPotentialState(row, dataSource);
  const rarityBadgeTone = getRarityBadgeTone(row);

  let bgColor = 'bg-slate-200/70 dark:bg-slate-600/30';
  if (rarity === 6) {
    bgColor = 'bg-blue-100/70 dark:bg-blue-900/30';
  } else if (rarity === 5) {
    bgColor = 'bg-purple-100/70 dark:bg-purple-900/30';
  } else if (rarity === 4) {
    bgColor = 'bg-sky-100/70 dark:bg-sky-900/30';
  }

  let statusBlock = null;
  let borderHoverClass = 'hover:border-zinc-400 dark:hover:border-zinc-500';
  let baseClasses = 'bg-white border-zinc-200 dark:bg-[#111113] dark:border-zinc-800 transition-colors';

  if (dataSource === 'global') {
    const rate = formatRateValue(row.ownershipRate, formatNumber);
    statusBlock = (
      <>
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="text-[10px] text-zinc-500 truncate">{tt('characterCatalog.metric.ownershipRate', '拥有率')}</div>
          <div className="text-emerald-400 font-bold text-[11px] truncate tabular-nums">{rate}</div>
        </div>
        <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1" style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}>
          <div className="bg-emerald-500 h-full transition-all" style={{ width: `${Math.min(100, Math.max(0, row.ownershipRate * 100))}%` }}></div>
        </div>
        <div className="flex flex-col gap-0.5 min-w-0 mt-0.5">
          <div className="text-[11px] text-emerald-500 font-bold truncate tabular-nums">{formatNumber(row.ownerUsers || 0)}</div>
          <div className="text-[9px] text-zinc-500 truncate">{tt('characterCatalog.metric.ownerUsers', '拥有')}</div>
        </div>
      </>
    );
  } else if (!owned) {
    baseClasses = 'bg-zinc-50 border-zinc-200 opacity-70 hover:opacity-100 dark:bg-[#111113] dark:border-zinc-800 transition-colors';
    statusBlock = (
      <>
        <div className="text-[10px] text-zinc-600 truncate">{tt('characterCatalog.unowned', '未拥有')}</div>
        <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1 my-1" style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}></div>
        <div className="text-[10px] text-zinc-700 tracking-widest tabular-nums">--</div>
      </>
    );
  } else if (potentialState === 'excess') {
    baseClasses = 'bg-red-50/40 border-red-200 shadow-[0_0_15px_rgba(220,38,38,0.08)] hover:border-red-500 dark:bg-[#111113] dark:border-red-900/50 dark:shadow-[0_0_15px_rgba(220,38,38,0.1)]';
    borderHoverClass = 'hover:border-red-500';
    statusBlock = (
      <>
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="text-[10px] text-zinc-500 truncate">{tt('characterCatalog.metric.copies', '持有数')}</div>
          <div className="text-red-400 font-bold text-[11px] truncate tabular-nums">{formatNumber(row.acquisitionCount || 0)}</div>
        </div>
        <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1" style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}>
          <div className="bg-red-500 h-full w-full"></div>
        </div>
        <div className="text-[9px] text-black bg-red-500 px-1 inline-block font-bold self-start mt-0.5 truncate max-w-full">
          {tt('characterCatalog.potential.excess', '超出信物')} +{formatNumber((row.acquisitionCount || 0) - FULL_POTENTIAL_COPY_COUNT)}
        </div>
      </>
    );
  } else if (potentialState === 'full') {
    borderHoverClass = 'hover:border-yellow-500';
    statusBlock = (
      <>
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="text-[10px] text-zinc-500 truncate">{tt('characterCatalog.metric.copies', '持有数')}</div>
          <div className="text-slate-700 dark:text-zinc-300 font-bold text-[11px] truncate tabular-nums">{formatNumber(row.acquisitionCount || 0)}</div>
        </div>
        <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1" style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}>
          <div className="bg-yellow-500 h-full w-full"></div>
        </div>
        <div className="text-[9px] text-yellow-500 font-bold mt-0.5 truncate">{tt('characterCatalog.potential.full', '已满潜')}</div>
      </>
    );
  } else {
    const progress = Math.min(100, Math.max(0, (Number(row.potentialLevel || 0) / MAX_POTENTIAL_LEVEL) * 100));
    const acquisitionPulls = Array.isArray(row.acquisitionPulls) ? row.acquisitionPulls : [];
    const showAcquisitionPulls = rarity >= 6 && acquisitionPulls.length > 0;
    statusBlock = (
      <>
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="text-[10px] text-zinc-500 truncate">
            {showAcquisitionPulls ? tt('characterCatalog.metric.acquisitionPulls', '获得抽数') : tt('characterCatalog.metric.copies', '获得次数')}
          </div>
          {showAcquisitionPulls ? (
            <AcquisitionPullList pulls={acquisitionPulls} tt={tt} compact onJump={onJumpToTimeline} />
          ) : (
            <div className="text-slate-700 dark:text-zinc-300 font-bold text-[11px] truncate tabular-nums">×{formatNumber(row.acquisitionCount || 0)}</div>
          )}
        </div>
        <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-1" style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}>
          <div className="bg-cyan-500 h-full transition-all" style={{ width: `${progress}%` }}></div>
        </div>
        <div className="text-[9px] text-cyan-500 font-bold mt-0.5 truncate">潜能 {formatNumber(row.potentialLevel || 0)}/{MAX_POTENTIAL_LEVEL}</div>
      </>
    );
  }

  return (
    <div
      onClick={() => onSelect(row)}
      className={`border ${mobile ? 'h-[88px]' : 'h-[100px]'} flex group cursor-pointer relative overflow-hidden ${baseClasses} ${selected ? 'border-yellow-500 bg-amber-50 shadow-[0_0_15px_rgba(234,179,8,0.12)] dark:bg-zinc-800/40 dark:shadow-[0_0_15px_rgba(234,179,8,0.15)]' : borderHoverClass}`}
      style={!mobile ? { clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)' } : {}}
    >
      <div className={`${mobile ? 'w-[74px]' : 'w-[90px]'} shrink-0 bg-zinc-100 relative border-r border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 ${!owned ? 'grayscale opacity-50' : ''}`}>
        <div className={`absolute inset-0 ${bgColor}`}></div>
        {avatarUrl ? (
          <img src={avatarUrl} alt={name} className="h-full w-full object-cover relative z-10" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-400 relative z-10">
            <User size={20} />
          </div>
        )}
        <div
          className={`absolute top-0 left-0 ${rarityBadgeTone.className} ${mobile ? 'text-[9px] px-1 py-0.5' : 'text-[10px] px-1.5 py-0.5'} font-black z-20`}
          style={rarityBadgeTone.style || undefined}
        >
          {rarity}★
        </div>
        <div className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/95 via-black/70 to-transparent ${mobile ? 'px-1 pb-1 pt-5' : 'px-1.5 pb-1.5 pt-6'}`}>
          <div
            className={`${mobile ? 'text-[10px]' : 'text-[11px]'} truncate text-center font-black leading-tight text-white`}
            title={name}
            style={{
              textShadow: '0 1px 0 #000, 1px 0 0 #000, -1px 0 0 #000, 0 -1px 0 #000, 0 0 4px #000'
            }}
          >
            {name}
          </div>
        </div>
      </div>

      <div className={`${mobile ? 'p-1.5' : 'p-2'} flex-1 flex flex-col justify-center min-w-0`}>
        <div className={`${mobile ? 'gap-0.5' : 'gap-1'} flex flex-col w-full`}>
          {statusBlock}
        </div>
      </div>

      {!mobile && <div className={`absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-yellow-500 transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}></div>}
    </div>
  );
}

function CharacterGrid({ rows, dataSource, onSelect, selectedId, locale, formatNumber, tt, mobile = false, onJumpToTimeline = null }) {
  return (
    <div
      className={`grid ${mobile ? 'gap-2.5' : 'gap-4'}`}
      style={{
        gridTemplateColumns: mobile
          ? 'repeat(2, minmax(0, 1fr))'
          : 'repeat(auto-fill, minmax(min(100%, 12.5rem), 1fr))'
      }}
    >
      {rows.map((row) => (
        <CharacterCard
          key={row.id || row.name}
          row={row}
          dataSource={dataSource}
          onSelect={onSelect}
          selected={selectedId === (row.id || row.name)}
          locale={locale}
          formatNumber={formatNumber}
          tt={tt}
          mobile={mobile}
          onJumpToTimeline={onJumpToTimeline}
        />
      ))}
    </div>
  );
}

function QuotaPill({ label, value, icon, tone, formatNumber }) {
  return (
    <span className={`flex min-w-0 items-center justify-center gap-1 border px-1 py-1 ${tone}`} title={`${label} ${formatNumber(value || 0)}`} aria-label={`${label} ${formatNumber(value || 0)}`}>
      <img src={icon} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" loading="lazy" />
      <span className="min-w-0 break-words text-center tabular-nums leading-tight">{formatNumber(value || 0)}</span>
    </span>
  );
}

function CharacterTable({ rows, dataSource, onSelect, selectedId, locale, formatNumber, tt, onJumpToTimeline = null }) {
  return (
    <div className="overflow-x-auto border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/60">
      <table className="min-w-full text-left text-xs">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-[10px] uppercase tracking-[0.12em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
          <tr>
            <th className="px-3 py-2">{tt('characterCatalog.column.character', '角色')}</th>
            <th className="px-3 py-2">{tt('characterCatalog.column.rarity', '星级')}</th>
            <th className="px-3 py-2">{dataSource === 'global' ? tt('characterCatalog.metric.ownerUsers', '拥有人数') : tt('characterCatalog.metric.dropInfo', '获得信息')}</th>
            <th className="px-3 py-2">{dataSource === 'global' ? tt('characterCatalog.metric.ownershipRate', '拥有率') : tt('characterCatalog.metric.potential', '潜能')}</th>
            <th className="px-3 py-2">{tt('characterCatalog.metric.fullPotentialRate', '满潜率')}</th>
            <th className="px-3 py-2">{tt('characterCatalog.column.quota', '集成 / 保障 / 终点配额')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const name = getCharacterDisplayName(row, locale);
            const quota = getCatalogRowQuota(row);
            const potentialState = getCatalogRowPotentialState(row, dataSource);
            const showAcquisitionPulls = dataSource === 'local' && Number(row.rarity) >= 6 && potentialState === 'owned_unfull' && Array.isArray(row.acquisitionPulls) && row.acquisitionPulls.length > 0;
            return (
              <tr
                key={row.id || row.name}
                onClick={() => onSelect(row)}
                className={`cursor-pointer border-b border-zinc-100 transition last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-[#151518] ${
                  selectedId === (row.id || row.name) ? 'bg-amber-50 dark:bg-amber-950/20' : ''
                }`}
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <CharacterAvatar row={row} name={name} sizeClass="h-8 w-8" />
                    <span className="max-w-[10rem] truncate font-bold text-slate-900 dark:text-white" title={name}>{name}</span>
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-amber-600">{formatNumber(row.rarity || 0)}★</td>
                <td className="px-3 py-2 font-mono">{dataSource === 'global' ? formatNumber(row.ownerUsers || 0) : showAcquisitionPulls ? <AcquisitionPullList pulls={row.acquisitionPulls} tt={tt} compact onJump={onJumpToTimeline} /> : `×${formatNumber(row.acquisitionCount || 0)}`}</td>
                <td className="px-3 py-2 font-mono">{dataSource === 'global' ? formatRateValue(row.ownershipRate, formatNumber) : `${formatNumber(row.potentialLevel || 0)}/${MAX_POTENTIAL_LEVEL}`}</td>
                <td className="px-3 py-2 font-mono">{dataSource === 'global' ? formatRateValue(row.fullPotentialRateOfOwners, formatNumber) : getPotentialLabel(row, dataSource, tt)}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-zinc-500">
                  {formatNumber(quota.aicQuotaTotalPotential || 0)} / {formatNumber(quota.bondQuotaDirect || 0)} / {formatNumber(quota.endpointQuotaConvertible || 0)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CopyDistribution({ row, totalContributors, formatNumber, tt }) {
  const distribution = row?.copyDistribution || {};
  const keys = ['0', '1', '2', '3', '4', '5', '6', '7plus'];
  const max = Math.max(...keys.map((key) => Number(distribution[key] || 0)), 1);
  const labels = {
    0: tt('characterCatalog.copyDistribution.unowned', '未拥有'),
    1: tt('characterCatalog.copyDistribution.p0', '0潜'),
    2: tt('characterCatalog.copyDistribution.p1', '1潜'),
    3: tt('characterCatalog.copyDistribution.p2', '2潜'),
    4: tt('characterCatalog.copyDistribution.p3', '3潜'),
    5: tt('characterCatalog.copyDistribution.p4', '4潜'),
    6: tt('characterCatalog.copyDistribution.full', '满潜'),
    '7plus': tt('characterCatalog.copyDistribution.excess', '满潜后溢出')
  };

  return (
    <div>
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">{tt('characterCatalog.detail.copyDistribution', '潜能持有分布')}</div>
      <div className="space-y-1.5">
        {keys.map((key) => {
          const value = Number(distribution[key] || 0);
          const label = labels[key] || key;
          return (
            <div key={key} className="grid grid-cols-[5rem_1fr_4rem] items-center gap-2 text-[11px]">
              <span className="truncate font-bold text-zinc-500" title={label}>{label}</span>
              <div className="h-2 overflow-hidden bg-zinc-100 dark:bg-zinc-800" style={{ clipPath: 'polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 0 100%)' }}>
                <div
                  className="h-full bg-yellow-500 transition-all duration-300"
                  style={{ width: `${Math.max(value > 0 ? 4 : 0, (value / max) * 100)}%` }}
                />
              </div>
              <span className="text-right font-mono text-zinc-500" title={`${formatNumber(value)} / ${formatNumber(totalContributors || 0)}`}>{formatNumber(value)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailPanel({ row, dataSource, totalContributors, locale, formatNumber, formatDate, tt, onClose, mobile = false }) {
  if (!row) {
    return (
      <div className="border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-[#111113]">
        {tt('characterCatalog.detail.empty', '选择一个角色查看图鉴详情')}
      </div>
    );
  }

  const name = getCharacterDisplayName(row, locale);
  const quota = getCatalogRowQuota(row);
  const owned = isCatalogRowOwned(row, dataSource);

  return (
    <div className={`${mobile ? 'h-full overflow-y-auto bg-white p-3 dark:bg-[#111113]' : 'border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#111113] xl:sticky xl:top-4 relative overflow-hidden'}`}>
      {!mobile && <div className="absolute top-0 left-0 w-full h-[2px] bg-yellow-500"></div>}
      <div className={`${mobile ? 'mb-3' : 'mb-4'} flex items-start justify-between gap-3`}>
        <div className={`flex min-w-0 items-center ${mobile ? 'gap-2.5' : 'gap-3'}`}>
          <CharacterAvatar row={row} name={name} sizeClass={mobile ? 'h-14 w-14' : 'h-16 w-16'} />
          <div className="min-w-0">
            <div className={`truncate ${mobile ? 'text-lg' : 'text-xl'} font-black text-slate-900 dark:text-white`} title={name}>{name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
              <span className="text-yellow-600 dark:text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 border border-yellow-500/30">{formatNumber(row.rarity || 0)}★</span>
              <span className="border border-zinc-200 px-1.5 py-0.5 text-zinc-500 dark:border-zinc-700 bg-zinc-800/30">{row.isLimited ? tt('characterCatalog.tag.limited', '限定') : tt('characterCatalog.tag.standard', '常驻')}</span>
              <span className="border border-zinc-200 px-1.5 py-0.5 text-zinc-500 dark:border-zinc-700 bg-zinc-800/30 font-mono">
                {row.releaseDate ? formatDate(row.releaseDate) : tt('common.unknown', '未知')}
              </span>
            </div>
          </div>
        </div>
        {mobile && (
          <button type="button" onClick={onClose} className="p-2 text-zinc-500">
            <X size={18} />
          </button>
        )}
      </div>

      <div className={mobile ? 'space-y-3' : 'space-y-5'}>
        <div className={`grid grid-cols-2 ${mobile ? 'gap-2' : 'gap-3'}`}>
          {dataSource === 'global' ? (
            <>
              <StatTile icon={Users} label={tt('characterCatalog.metric.ownerUsers', '拥有人数')} value={formatNumber(row.ownerUsers || 0)} hint={`${tt('characterCatalog.metric.unownedUsers', '未拥有')} ${formatNumber(row.unownedUsers || 0)}`} mobile={mobile} />
              <StatTile icon={ShieldCheck} label={tt('characterCatalog.metric.ownershipRate', '拥有率')} value={formatRateValue(row.ownershipRate, formatNumber)} hint={`${tt('stats.contributors', '贡献者')} ${formatNumber(totalContributors || 0)}`} tone="text-emerald-600 dark:text-emerald-400" mobile={mobile} />
              <StatTile icon={Crown} label={tt('characterCatalog.metric.fullPotentialUsers', '满潜人数')} value={formatNumber(row.fullPotentialUsers || 0)} hint={formatRateValue(row.fullPotentialRateOfContributors, formatNumber)} tone="text-yellow-600 dark:text-yellow-500" mobile={mobile} />
              <StatTile icon={Star} label={tt('characterCatalog.metric.avgCopies', '人均获得次数')} value={formatNumber(row.avgCopiesPerOwner || 0, { maximumFractionDigits: 2 })} hint={`${tt('characterCatalog.metric.totalCopies', '总获得次数')} ${formatNumber(row.totalCopies || 0)}`} tone="text-cyan-600 dark:text-cyan-400" mobile={mobile} />
            </>
          ) : (
            <>
              <StatTile icon={ShieldCheck} label={tt('characterCatalog.metric.ownedState', '拥有状态')} value={owned ? tt('characterCatalog.owned', '已拥有') : tt('characterCatalog.unowned', '未拥有')} tone={owned ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500'} mobile={mobile} />
              <StatTile icon={Star} label={tt('characterCatalog.metric.copies', '获得次数')} value={`×${formatNumber(row.acquisitionCount || 0)}`} hint={`${tt('characterCatalog.metric.potential', '潜能')} ${formatNumber(row.potentialLevel || 0)}/${MAX_POTENTIAL_LEVEL}`} mobile={mobile} />
              <StatTile icon={BookOpen} label={tt('characterCatalog.metric.firstAcquired', '首次获得')} value={row.firstAcquiredAt ? formatDate(row.firstAcquiredAt) : '-'} hint={row.firstAcquiredPoolName || undefined} mobile={mobile} />
              <StatTile icon={RefreshCw} label={tt('characterCatalog.metric.lastAcquired', '最近获得')} value={row.lastAcquiredAt ? formatDate(row.lastAcquiredAt) : '-'} hint={row.lastAcquiredPoolName || undefined} mobile={mobile} />
            </>
          )}
        </div>

        <QuotaTiles quota={quota} formatNumber={formatNumber} locale={locale} tt={tt} mobile={mobile} compact={!mobile} />

        {dataSource === 'global' && (
          <CopyDistribution row={row} totalContributors={totalContributors} formatNumber={formatNumber} tt={tt} />
        )}

        {dataSource === 'local' && (
          <div className={`grid grid-cols-2 ${mobile ? 'gap-2 text-[11px]' : 'gap-3 text-xs'}`}>
            <div className={`border border-zinc-200 bg-zinc-50 ${mobile ? 'p-3' : 'p-4'} dark:border-zinc-800 dark:bg-[#151518]`} style={!mobile ? { clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)' } : {}}>
              <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500">{tt('characterCatalog.metric.tokens', '信物')}</div>
              <div className={`${mobile ? 'text-lg' : 'text-xl'} mt-1 font-mono font-black text-cyan-600 dark:text-cyan-400`}>{formatNumber(row.trustTokensGained || 0)}</div>
            </div>
            <div className={`border border-zinc-200 bg-zinc-50 ${mobile ? 'p-3' : 'p-4'} dark:border-zinc-800 dark:bg-[#151518]`} style={!mobile ? { clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)' } : {}}>
              <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500">{tt('characterCatalog.metric.excessTokens', '超出信物')}</div>
              <div className={`${mobile ? 'text-lg' : 'text-xl'} mt-1 font-mono font-black text-red-600 dark:text-red-500`}>{formatNumber(row.excessTrustTokens || 0)}</div>
            </div>
            {row.manualSource && (
              <div className={`col-span-2 border border-amber-200 bg-amber-50 ${mobile ? 'p-3' : 'p-4'} text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300`} style={!mobile ? { clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)' } : {}}>
                <div className="text-[9px] font-bold uppercase tracking-[0.12em] opacity-70">{tt('characterCatalog.manual.source', '来源')}</div>
                <div className="mt-1 break-words text-xs font-bold">{row.manualSource}</div>
              </div>
            )}
          </div>
        )}

        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">{tt('characterCatalog.detail.rankingSource', '出货排行来源')}</div>
          <RankingTags rankingInfo={row.rankingInfo} formatNumber={formatNumber} tt={tt} />
          {(!Array.isArray(row.rankingInfo) || row.rankingInfo.length === 0) && (
            <div className="border border-dashed border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-[#151518]" style={!mobile ? { clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)' } : {}}>
              {tt('characterCatalog.detail.noRanking', '暂无该角色的出货排名来源。')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CharacterCatalogView({
  dataSource = 'global',
  setDataSource,
  history = [],
  pools = [],
  user = null,
  globalStats = null,
  localStats = null,
  currentStats = null,
  fetchGlobalStats,
  globalStatsLoading = false,
  ranking = null,
  isRankingLoading = false,
  mobile = false
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const currentGameUid = usePoolStore((state) => state.currentGameUid);
  const switchGameAccount = usePoolStore((state) => state.switchGameAccount);
  const { t, locale, formatNumber, formatDateTime } = useI18n();
  const tt = React.useCallback((key, fallback, params = {}) => t(key, params, fallback), [t]);
  const [filters, setFilters] = React.useState(DEFAULT_CHARACTER_CATALOG_FILTERS);
  const [viewMode, setViewMode] = React.useState('grid');
  const [selectedId, setSelectedId] = React.useState(null);
  const [showMobileFilters, setShowMobileFilters] = React.useState(false);
  const [showManualEditor, setShowManualEditor] = React.useState(false);
  const [manualOverrides, setManualOverrides] = React.useState({});
  const [characters, setCharacters] = React.useState(() => characterCache.getAll({ type: 'character' }));
  const [loadedLocalHistory, setLoadedLocalHistory] = React.useState(null);
  const [localHistoryLoading, setLocalHistoryLoading] = React.useState(false);
  const [localHistoryError, setLocalHistoryError] = React.useState(null);
  const [localHistoryReloadKey, setLocalHistoryReloadKey] = React.useState(0);

  React.useEffect(() => {
    let mounted = true;
    characterCache.load().finally(() => {
      if (mounted) {
        setCharacters(characterCache.getAll({ type: 'character' }));
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const activeDataSource = dataSource === 'local' ? 'local' : 'global';
  const gameAccounts = usePersonalGameAccounts();
  const effectiveGameUid = React.useMemo(() => {
    const currentAccount = gameAccounts.find((account) => (
      isGameAccountSelectionMatch(account, currentGameUid)
    ));
    if (currentAccount) {
      return getGameAccountSelectionValue(currentAccount) || currentGameUid;
    }
    return getGameAccountSelectionValue(gameAccounts[0]) || currentGameUid || null;
  }, [currentGameUid, gameAccounts]);
  const selectedGameAccount = React.useMemo(() => (
    gameAccounts.find((account) => isGameAccountSelectionMatch(account, effectiveGameUid)) || null
  ), [effectiveGameUid, gameAccounts]);
  React.useEffect(() => {
    let cancelled = false;

    if (activeDataSource !== 'local' || !user?.id || !selectedGameAccount) {
      setLoadedLocalHistory(null);
      setLocalHistoryLoading(false);
      setLocalHistoryError(null);
      return () => {
        cancelled = true;
      };
    }

    setLoadedLocalHistory(null);
    setLocalHistoryLoading(true);
    setLocalHistoryError(null);
    loadAllAccountGachaHistoryForAccounts({
      accounts: [selectedGameAccount],
      expectedOwnerId: user.id,
    })
      .then((result) => {
        if (!cancelled) {
          setLoadedLocalHistory(Array.isArray(result?.history) ? result.history : []);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLocalHistoryError(error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLocalHistoryLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeDataSource, localHistoryReloadKey, selectedGameAccount, user?.id]);
  const manualOverrideScopeKey = React.useMemo(() => getManualOverrideScopeKey(user, effectiveGameUid), [effectiveGameUid, user]);
  React.useEffect(() => {
    const stored = getStorageItem(STORAGE_KEYS.CHARACTER_CATALOG_MANUAL_OVERRIDES, {});
    setManualOverrides(stored?.[manualOverrideScopeKey] || {});
  }, [manualOverrideScopeKey]);
  React.useEffect(() => {
    if (effectiveGameUid && currentGameUid !== effectiveGameUid) {
      switchGameAccount(effectiveGameUid);
    }
  }, [currentGameUid, effectiveGameUid, switchGameAccount]);
  const localHistorySource = Array.isArray(loadedLocalHistory) ? loadedLocalHistory : history;
  const localHistory = React.useMemo(
    () => normalizeHistoryForUser(localHistorySource, user, effectiveGameUid),
    [effectiveGameUid, localHistorySource, user]
  );
  const localTimelineHistory = React.useMemo(() => {
    const poolById = new Map();
    (Array.isArray(pools) ? pools : []).forEach((pool) => {
      [pool?.id, pool?.pool_id].forEach((poolId) => {
        if (poolId) {
          poolById.set(String(poolId), pool);
        }
      });
    });

    return annotateInfoBookPulls(localHistory, pools).map((record) => {
      const poolId = record?.poolId || record?.pool_id || null;
      const pool = poolId ? poolById.get(String(poolId)) : null;
      return {
        ...record,
        isStandard: normalizeIsStandard(record, pool?.type, pool?.up_character || pool?.upCharacter)
      };
    });
  }, [localHistory, pools]);
  const localTimelineAcquisitionIndex = React.useMemo(() => {
    if (localTimelineHistory.length === 0 || !Array.isArray(pools) || pools.length === 0) {
      return null;
    }

    const limitedPoolIds = new Set(
      pools
        .filter((pool) => ['limited', 'limited_character'].includes(pool?.type))
        .flatMap((pool) => [pool?.id, pool?.pool_id])
        .filter(Boolean)
        .map(String)
    );
    const limitedHistory = localTimelineHistory.filter((record) => {
      const poolId = record?.poolId || record?.pool_id || null;
      return poolId && limitedPoolIds.has(String(poolId));
    });
    const crossPoolPityMap = buildLimitedCrossPoolPityMap(limitedHistory);

    return buildTimelineAcquisitionIndex({
      pools,
      history: localTimelineHistory,
      crossPoolPityMap,
      locale
    });
  }, [localTimelineHistory, locale, pools]);
  const localCatalogBase = React.useMemo(() => (
    buildCharacterCatalogRows({
      history: localTimelineHistory,
      pools,
      characters,
      ranking,
      acquisitionIndex: localTimelineAcquisitionIndex
    })
  ), [characters, localTimelineAcquisitionIndex, localTimelineHistory, pools, ranking]);
  const localCatalog = React.useMemo(() => (
    applyManualOverridesToCatalog(localCatalogBase, manualOverrides)
  ), [localCatalogBase, manualOverrides]);
  const globalCatalog = React.useMemo(() => (
    attachRankingInfoToCatalogRows(globalStats?.characterCatalog || null, ranking)
  ), [globalStats?.characterCatalog, ranking]);
  const catalog = activeDataSource === 'global' ? globalCatalog : localCatalog;
  const rows = React.useMemo(() => catalog?.rows || [], [catalog]);
  const selectedRows = React.useMemo(() => selectCharacterCatalogRows(rows, filters, activeDataSource), [activeDataSource, filters, rows]);
  const summary = catalog?.summary || {};
  const quota = getSummaryQuota(summary);
  const totalContributors = activeDataSource === 'global' ? Number(catalog?.totalContributors || globalStats?.totalContributors || 0) : (user ? 1 : 0);
  const loading = activeDataSource === 'global' && globalStatsLoading && !globalCatalog;
  const selectedRow = React.useMemo(() => (
    selectedRows.find((row) => (row.id || row.name) === selectedId) || null
  ), [selectedId, selectedRows]);
  const selectedEditableRow = React.useMemo(() => (
    (localCatalog?.rows || []).find((row) => getRowKey(row) === selectedId) || selectedRow
  ), [localCatalog?.rows, selectedId, selectedRow]);
  const catalogStats = activeDataSource === 'global'
    ? (globalStats || currentStats)
    : (localStats || currentStats);

  React.useEffect(() => {
    if (mobile || selectedRows.length === 0) {
      return;
    }

    if (!selectedRows.some((row) => (row.id || row.name) === selectedId)) {
      setSelectedId(selectedRows[0].id || selectedRows[0].name);
    }
  }, [mobile, selectedId, selectedRows]);

  const updateFilter = React.useCallback((key, value) => {
    setFilters((current) => ({
      ...current,
      [key]: value
    }));
  }, []);
  const handleSelectSource = React.useCallback((nextSource) => {
    if (setDataSource) {
      setDataSource(nextSource);
    }
  }, [setDataSource]);
  const persistManualOverrides = React.useCallback((updater) => {
    const stored = getStorageItem(STORAGE_KEYS.CHARACTER_CATALOG_MANUAL_OVERRIDES, {});
    const currentScopeOverrides = stored?.[manualOverrideScopeKey] || {};
    const nextScopeOverrides = typeof updater === 'function'
      ? updater(currentScopeOverrides)
      : updater;
    const nextStored = {
      ...(stored || {}),
      [manualOverrideScopeKey]: nextScopeOverrides || {}
    };
    setStorageItem(STORAGE_KEYS.CHARACTER_CATALOG_MANUAL_OVERRIDES, nextStored);
    setManualOverrides(nextStored[manualOverrideScopeKey] || {});
  }, [manualOverrideScopeKey]);
  const handleSaveManualOverride = React.useCallback((rowKey, override) => {
    if (!rowKey) {
      return;
    }
    persistManualOverrides((current) => ({
      ...(current || {}),
      [rowKey]: override
    }));
    setSelectedId(rowKey);
    if (setDataSource) {
      setDataSource('local');
    }
    setShowManualEditor(false);
  }, [persistManualOverrides, setDataSource]);
  const handleRemoveManualOverride = React.useCallback((rowKey) => {
    if (!rowKey) {
      return;
    }
    persistManualOverrides((current) => {
      const next = { ...(current || {}) };
      delete next[rowKey];
      return next;
    });
  }, [persistManualOverrides]);
  const handleOpenManualEditor = React.useCallback(() => {
    if (setDataSource) {
      setDataSource('local');
    }
    setShowManualEditor(true);
  }, [setDataSource]);
  const handleRefresh = React.useCallback(async () => {
    if (activeDataSource === 'global' && fetchGlobalStats) {
      await fetchGlobalStats(true);
      return;
    }

    await characterCache.refresh();
    setCharacters(characterCache.getAll({ type: 'character' }));
    setLocalHistoryReloadKey((value) => value + 1);
  }, [activeDataSource, fetchGlobalStats]);
  const handleSelectRow = React.useCallback((row) => {
    setSelectedId(row.id || row.name);
  }, []);
  const handleJumpToTimeline = React.useCallback((entry) => {
    if (!entry?.timelineElementId) {
      return;
    }

    const targetPath = location.pathname.startsWith('/m')
      ? getMobilePathForTab('dashboard')
      : getDesktopPathForTab('dashboard');
    const targetPoolId = entry.poolId || entry.timelineSectionId || '';
    const query = targetPoolId ? `?poolId=${encodeURIComponent(targetPoolId)}` : '';
    navigate(`${targetPath}${query}`, {
      state: {
        scrollTo: entry.timelineElementId,
        dashboardCharViewMode: 'waterfall',
        _ts: Date.now()
      }
    });
  }, [location.pathname, navigate]);
  const formatDate = React.useCallback((value) => formatDateTime(value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }, '-'), [formatDateTime]);
  const formatCount = React.useCallback((value) => formatNumber(Number(value) || 0), [formatNumber]);
  const formatPercent = React.useCallback((value, digits = 1) => `${formatNumber(Number(value) || 0, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}%`, [formatNumber]);

  const filterOptions = React.useMemo(() => ({
    rarity: RARITY_OPTIONS.map((value) => ({ value, label: value === 'all' ? tt('characterCatalog.filter.allRarity', '全部星级') : `${value}★` })),
    limitedStatus: LIMITED_OPTIONS.map((value) => ({
      value,
      label: value === 'all' ? tt('characterCatalog.filter.allLimited', '全部限定状态') : value === 'limited' ? tt('characterCatalog.tag.limited', '限定') : tt('characterCatalog.tag.standard', '常驻')
    })),
    ownershipStatus: OWNERSHIP_OPTIONS.map((value) => ({
      value,
      label: value === 'all' ? tt('characterCatalog.filter.allOwnership', '全部拥有状态') : value === 'owned' ? tt('characterCatalog.owned', '已拥有') : tt('characterCatalog.unowned', '未拥有')
    })),
    potentialStatus: POTENTIAL_OPTIONS.map((value) => ({
      value,
      label: {
        all: tt('characterCatalog.filter.allPotential', '全部潜能状态'),
        owned_unfull: tt('characterCatalog.potential.ownedUnfull', '已拥有未满潜'),
        full: tt('characterCatalog.potential.full', '满潜'),
        excess: tt('characterCatalog.potential.excess', '有超出信物')
      }[value]
    })),
    sortKey: SORT_OPTIONS.map((value) => ({
      value,
      label: {
        ownershipRate: tt('characterCatalog.sort.ownershipRate', '拥有率'),
        ownerUsers: tt('characterCatalog.sort.ownerUsers', '拥有人数'),
        fullPotentialRate: tt('characterCatalog.sort.fullPotentialRate', '满潜率'),
        rarity: tt('characterCatalog.sort.rarity', '星级'),
        name: tt('characterCatalog.sort.name', '名称'),
        copies: tt('characterCatalog.sort.copies', '获得次数'),
        quota: tt('characterCatalog.sort.quota', '可兑换配额')
      }[value]
    })),
    sortDirection: SORT_DIRECTION_OPTIONS.map((value) => ({
      value,
      label: value === 'asc'
        ? tt('characterCatalog.sortDirection.asc', '正序')
        : tt('characterCatalog.sortDirection.desc', '倒序')
    }))
  }), [tt]);

  const filterControls = (
    <div className={`${mobile ? 'grid grid-cols-2 gap-2' : 'flex flex-wrap gap-3'}`}>
      <FilterSelect label={tt('characterCatalog.filter.rarity', '星级')} value={filters.rarity} options={filterOptions.rarity} onChange={(value) => updateFilter('rarity', value)} mobile={mobile} />
      <FilterSelect label={tt('characterCatalog.filter.limited', '限定状态')} value={filters.limitedStatus} options={filterOptions.limitedStatus} onChange={(value) => updateFilter('limitedStatus', value)} mobile={mobile} />
      <FilterSelect label={tt('characterCatalog.filter.ownership', '拥有状态')} value={filters.ownershipStatus} options={filterOptions.ownershipStatus} onChange={(value) => updateFilter('ownershipStatus', value)} mobile={mobile} />
      <FilterSelect label={tt('characterCatalog.filter.potential', '潜能状态')} value={filters.potentialStatus} options={filterOptions.potentialStatus} onChange={(value) => updateFilter('potentialStatus', value)} mobile={mobile} />
      <FilterSelect label={tt('characterCatalog.filter.sort', '排序')} value={filters.sortKey} options={filterOptions.sortKey} onChange={(value) => updateFilter('sortKey', value)} mobile={mobile} />
      <FilterSelect label={tt('characterCatalog.filter.sortDirection', '顺序')} value={filters.sortDirection} options={filterOptions.sortDirection} onChange={(value) => updateFilter('sortDirection', value)} mobile={mobile} />
    </div>
  );

  return (
    <div className={mobile ? 'space-y-3 pb-6' : 'space-y-6'}>
      <div className={`border border-zinc-200 bg-white ${mobile ? 'p-3' : 'p-4'} dark:border-zinc-800 dark:bg-[#151518]`} style={!mobile ? { clipPath: 'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))' } : {}}>
        <div className={`${mobile ? 'space-y-2.5' : 'flex flex-wrap items-center justify-between gap-3'}`}>
          <div>
            <div className={`flex items-center gap-2 ${mobile ? 'text-base tracking-wide' : 'text-xl tracking-widest'} font-black uppercase text-slate-900 dark:text-white`}>
              <BookOpen size={mobile ? 15 : 18} className="text-yellow-500" />
              {tt('characterCatalog.title', '角色图鉴')}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <AccountSelect
              accounts={gameAccounts}
              currentGameUid={effectiveGameUid}
              onChange={switchGameAccount}
              locale={locale}
              tt={tt}
              mobile={mobile}
            />
            <div className="flex bg-zinc-50 p-1 dark:bg-[#0c0c0e] border border-zinc-200 dark:border-zinc-800" style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}>
              {[
                { value: 'local', label: tt('summary.source.local', '我的数据'), icon: User },
                { value: 'global', label: tt('summary.source.global', '全服数据'), icon: Cloud }
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => handleSelectSource(item.value)}
                    className={`inline-flex items-center gap-1.5 ${mobile ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs'} font-bold transition ${
                      activeDataSource === item.value
                        ? 'bg-yellow-500 text-black shadow-[0_0_10px_rgba(234,179,8,0.3)]'
                        : 'text-zinc-500 hover:text-slate-900 dark:hover:text-yellow-500'
                    }`}
                  >
                    <Icon size={mobile ? 12 : 13} />
                    {item.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              className={`inline-flex items-center gap-1.5 bg-white ${mobile ? 'px-2.5 py-1.5 text-[10px]' : 'px-3 py-2 text-xs'} font-bold text-slate-700 transition hover:bg-slate-100 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700`}
              style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}
            >
              <RefreshCw size={mobile ? 12 : 13} className={loading ? 'animate-spin text-yellow-500' : ''} />
              {tt('common.refresh', '刷新')}
            </button>
          </div>
        </div>
      </div>

      {activeDataSource === 'local' && localHistoryLoading && (
        <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
          {tt('characterCatalog.local.loadingHistory', '正在按需读取该账号的完整记录…')}
        </div>
      )}
      {activeDataSource === 'local' && localHistoryError && (
        <div className="flex items-center justify-between gap-3 border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300">
          <span>{tt('characterCatalog.local.historyFailed', '完整记录读取失败，请重试。')}</span>
          <button
            type="button"
            onClick={() => setLocalHistoryReloadKey((value) => value + 1)}
            className="shrink-0 border border-current px-3 py-1.5 text-xs font-bold"
          >
            {tt('common.retry', '重试')}
          </button>
        </div>
      )}

      <div className={`grid ${mobile ? 'grid-cols-2 gap-2' : 'grid-cols-2 xl:grid-cols-6 gap-3'}`}>
        <StatTile icon={BookOpen} label={tt('characterCatalog.metric.totalCharacters', '图鉴角色总数')} value={formatNumber(summary.totalCharacters || rows.length || 0)} mobile={mobile} tone="text-cyan-600 dark:text-cyan-400" />
        <StatTile icon={ShieldCheck} label={tt('characterCatalog.metric.ownedCharacters', '已拥有')} value={`${formatNumber(summary.ownedCharacters || 0)} / ${formatNumber(summary.unownedCharacters || 0)}`} hint={tt('characterCatalog.metric.ownedUnownedHint', '已拥有 / 未拥有')} tone="text-emerald-600 dark:text-emerald-400" mobile={mobile} />
        <StatTile icon={Users} label={tt('characterCatalog.metric.ownershipRate', '拥有率')} value={formatRateValue(summary.ownershipRate || 0, formatNumber)} hint={activeDataSource === 'global' ? `${tt('stats.contributors', '贡献者')} ${formatNumber(totalContributors)}` : undefined} tone="text-indigo-600 dark:text-indigo-400" mobile={mobile} />
        <StatTile icon={Crown} label={tt('characterCatalog.metric.fullPotentialCharacters', '满潜角色数')} value={formatNumber(summary.fullPotentialCharacters || 0)} tone="text-yellow-600 dark:text-yellow-500" mobile={mobile} />
        <StatTile icon={BookOpen} label={tt('characterCatalog.metric.convertibleTokens', '可兑换信物数')} value={formatNumber(summary.excessTrustTokens || 0)} tone="text-fuchsia-600 dark:text-fuchsia-400" mobile={mobile} />
        <StatTile icon={Search} label={tt('characterCatalog.metric.visibleRows', '当前结果')} value={formatNumber(selectedRows.length)} hint={`${tt('characterCatalog.metric.totalRows', '总行数')} ${formatNumber(rows.length)}`} tone="text-slate-900 dark:text-white" mobile={mobile} />
      </div>

      <div className={`border border-zinc-200 bg-zinc-50 ${mobile ? 'p-3' : 'p-4'} dark:border-zinc-800 dark:bg-zinc-950/30`} style={!mobile ? { clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)' } : {}}>
        <RankingCard
          ranking={ranking}
          loading={isRankingLoading}
          poolType="all"
          title={activeDataSource === 'global'
            ? tt('summary.section.otherRankingGlobal', '全服出货排名 (其他)')
            : tt('summary.section.otherRankingLocal', '我的出货排名 (其他)')}
          visibleSections={['extraUp', 'limitedOff', 'standard', 'extraFive', 'limitedFive', 'standardFive']}
          flatLayout={mobile}
          denseFlatLayout={mobile}
          singleColumn={mobile}
        />
      </div>

      <LimitedUpAnalysisStrip
        currentStats={catalogStats}
        ranking={ranking}
        loading={isRankingLoading}
        locale={locale}
        formatCount={formatCount}
        formatPercent={formatPercent}
        tt={tt}
        mobile={mobile}
      />

      <QuotaTiles quota={quota} formatNumber={formatNumber} locale={locale} tt={tt} mobile={mobile} compact={mobile} />

      <div className={`border border-zinc-200 bg-zinc-50 ${mobile ? 'p-3' : 'p-4'} dark:border-zinc-800 dark:bg-[#111113] transition-colors`} style={!mobile ? { clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)' } : {}}>
        <div className={`${mobile ? 'space-y-2' : 'flex flex-wrap items-end gap-3'}`}>
          <label className={`${mobile ? 'min-w-0 text-[9px]' : 'min-w-[14rem] text-[10px]'} flex-1 font-bold uppercase tracking-[0.12em] text-zinc-500`}>
            <div className="mb-1 flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span>{tt('common.search', '搜索')}</span>
              <div className="flex min-w-0 items-center gap-2">
                {Object.keys(manualOverrides || {}).length > 0 && (
                  <span className="truncate text-[10px] font-bold normal-case tracking-normal text-zinc-500">
                    {tt('characterCatalog.manual.overrideCount', '已补录 {count} 个角色', { count: Object.keys(manualOverrides || {}).length })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleOpenManualEditor}
                  className={`inline-flex shrink-0 items-center gap-1 border border-yellow-500 bg-yellow-500 ${mobile ? 'px-2 py-1 text-[9px]' : 'px-2.5 py-1 text-[10px]'} font-black normal-case tracking-normal text-black transition hover:bg-yellow-400`}
                  style={!mobile ? { clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' } : {}}
                >
                  <Pencil size={mobile ? 10 : 12} />
                  {tt('characterCatalog.manual.editButton', '编辑我的图鉴')}
                </button>
              </div>
            </div>
            <div className="relative">
              <Search size={mobile ? 12 : 14} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                value={filters.search}
                onChange={(event) => updateFilter('search', event.target.value)}
                placeholder={tt('characterCatalog.searchPlaceholder', '搜索角色名称')}
                className={`w-full border border-zinc-200 bg-white ${mobile ? 'py-1.5 pl-7 pr-2 text-xs' : 'py-2 pl-8 pr-3 text-sm'} text-slate-800 outline-none transition focus:border-yellow-500 dark:border-zinc-800 dark:bg-[#151518] dark:text-zinc-200 focus:ring-1 focus:ring-yellow-500/50`}
              />
            </div>
          </label>

          {mobile ? (
            <button
              type="button"
              onClick={() => setShowMobileFilters(true)}
              className="inline-flex w-full items-center justify-center gap-2 border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
            >
              <SlidersHorizontal size={13} />
              {tt('characterCatalog.filter.open', '筛选与排序')}
            </button>
          ) : (
            <>
              <div className="flex-1">{filterControls}</div>
              <div className="flex border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-950">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={`p-2 ${viewMode === 'grid' ? 'bg-yellow-500 text-black' : 'text-zinc-500 hover:text-yellow-500'}`}
                  title={tt('characterCatalog.view.grid', '卡片视图')}
                >
                  <Grid2X2 size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`p-2 ${viewMode === 'table' ? 'bg-yellow-500 text-black' : 'text-zinc-500 hover:text-yellow-500'}`}
                  title={tt('characterCatalog.view.table', '表格视图')}
                >
                  <List size={15} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className={`${mobile ? 'space-y-3' : 'grid grid-cols-1 gap-5 min-[1400px]:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]'}`}>
        <div className="min-w-0">
          {loading ? (
            <div className="flex min-h-[20rem] items-center justify-center border border-zinc-200 bg-white text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60" style={!mobile ? { clipPath: 'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 0 100%)' } : {}}>
              <RefreshCw size={18} className="mr-2 animate-spin text-yellow-500" />
              {tt('summary.loading.data', '正在获取数据...')}
            </div>
          ) : selectedRows.length === 0 ? (
            <div className="flex min-h-[16rem] items-center justify-center border border-dashed border-zinc-300 bg-zinc-50 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-[#111113]" style={!mobile ? { clipPath: 'polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 0 100%)' } : {}}>
              {tt('characterCatalog.empty', '没有符合条件的角色。')}
            </div>
          ) : viewMode === 'table' && !mobile ? (
            <CharacterTable rows={selectedRows} dataSource={activeDataSource} onSelect={handleSelectRow} selectedId={selectedId} locale={locale} formatNumber={formatNumber} tt={tt} onJumpToTimeline={handleJumpToTimeline} />
          ) : (
            <CharacterGrid
              rows={selectedRows}
              dataSource={activeDataSource}
              onSelect={handleSelectRow}
              selectedId={selectedId}
              locale={locale}
              formatNumber={formatNumber}
              tt={tt}
              mobile={mobile}
              onJumpToTimeline={handleJumpToTimeline}
            />
          )}
        </div>

        {!mobile && (
          <DetailPanel
            row={selectedRow}
            dataSource={activeDataSource}
            totalContributors={totalContributors}
            locale={locale}
            formatNumber={formatNumber}
            formatDate={formatDate}
            tt={tt}
          />
        )}
      </div>

      {mobile && selectedRow && (
        <div className="fixed inset-0 z-50 bg-black/50">
          <div className="absolute inset-x-0 bottom-0 max-h-[86vh] overflow-hidden rounded-t-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <DetailPanel
              row={selectedRow}
              dataSource={activeDataSource}
              totalContributors={totalContributors}
              locale={locale}
              formatNumber={formatNumber}
              formatDate={formatDate}
              tt={tt}
              onClose={() => setSelectedId(null)}
              mobile
            />
          </div>
        </div>
      )}

      <ManualCatalogEditor
        open={showManualEditor}
        rows={localCatalog?.rows || []}
        selectedRow={selectedEditableRow}
        overrides={manualOverrides}
        onSave={handleSaveManualOverride}
        onRemove={handleRemoveManualOverride}
        onClose={() => setShowManualEditor(false)}
        locale={locale}
        tt={tt}
        mobile={mobile}
      />

      {mobile && showMobileFilters && (
        <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setShowMobileFilters(false)}>
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2.5 flex items-center justify-between">
              <div className="text-xs font-black text-slate-900 dark:text-white">{tt('characterCatalog.filter.open', '筛选与排序')}</div>
              <button type="button" onClick={() => setShowMobileFilters(false)} className="p-2 text-zinc-500">
                <X size={16} />
              </button>
            </div>
            {filterControls}
          </div>
        </div>
      )}
    </div>
  );
}
