import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Trash2,
  AlertCircle,
  Upload,
  CheckCircle2,
  User,
  Cloud,
  CloudOff,
  RefreshCw,
  Star,
  Layers,
  Search,
  HelpCircle,
  ExternalLink,
  ArrowRight,
} from 'lucide-react';
import AuthModal from '../../AuthModal';
import { Toast, ConfirmDialog } from '../ui';
import { useUIStore, useAuthStore, useHistoryStore } from '../../stores';
import { PRESET_POOLS } from '../../constants';
import { buildUsernameHandle } from '../../utils/usernameValidation.js';
import { useI18n } from '../../i18n/index.js';
import { fetchAccountsList } from '../../utils/endfieldAuthChain.js';
import { buildGameAccountServerTag, localizeGameAccountServerTag } from '../../utils/gameAccountMetadata.js';
import { buildPendingImportPreview, normalizeImportPreviewText } from './importPreviewUtils.js';

const DEFAULT_POOL_FORM = {
  name: '',
  type: 'limited',
  isLimitedWeapon: true,
  drawerName: '',
  selectedCharName: '',
};

function normalizeEditablePoolType(type) {
  if (type === 'limited_character') return 'limited';
  if (type === 'limited_weapon') return 'weapon';
  return type || 'standard';
}

function getPoolTypeLabel(type, t) {
  if (type === 'limited') return t('modals.pool.type.limited');
  if (type === 'weapon') return t('modals.pool.type.weapon');
  return t('modals.pool.type.standard');
}

function buildPoolName(type, selectedCharName, drawerName, t) {
  const typeLabel = getPoolTypeLabel(type, t);
  return `${typeLabel}${selectedCharName ? '-' + selectedCharName : ''}${drawerName ? '-' + drawerName : ''}`;
}

function getInitialPoolForm(modalState) {
  if (modalState.type === 'editPool' && modalState.data) {
    return {
      name: modalState.data.name || '',
      type: normalizeEditablePoolType(modalState.data.type),
      isLimitedWeapon: modalState.data.isLimitedWeapon !== false,
      drawerName: '',
      selectedCharName: '',
    };
  }

  return DEFAULT_POOL_FORM;
}

function formatImportDateRange(preview, formatDateTime, t) {
  if (!preview.startMs || !preview.endMs) {
    return t('modals.import.unknownDateRange');
  }

  const start = formatDateTime(preview.startMs, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const end = formatDateTime(preview.endMs, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return start === end ? start : `${start} - ${end}`;
}

function parseImportVerifyTokenInput(input) {
  const trimmed = normalizeImportPreviewText(input);
  if (!trimmed) {
    return { token: '', fromJson: false };
  }

  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed);
      if (json?.data?.content) {
        return { token: normalizeImportPreviewText(json.data.content), fromJson: true };
      }
    } catch {
      // 继续按普通 token 处理
    }
  }

  return { token: trimmed, fromJson: false };
}

function normalizeComparableGameUid(value) {
  const text = normalizeImportPreviewText(value);
  const serverPrefixedMatch = text.match(/^\d+:(.+)$/);
  return serverPrefixedMatch ? serverPrefixedMatch[1] : text;
}

function buildImportVerificationResult(importAccount, selectedAccount, t) {
  if (!selectedAccount) {
    return {
      tone: 'idle',
      canImport: false,
      message: t('modals.import.verifyPending'),
    };
  }

  const importedGameUid = normalizeComparableGameUid(importAccount?.gameUid);
  const verifiedGameUid = normalizeComparableGameUid(selectedAccount?.gameUid);
  const importedNickName = normalizeImportPreviewText(importAccount?.nickName);
  const importedNickNameIsUidFallback = importedNickName && importedGameUid && importedNickName === importedGameUid;
  const verifiedNickName = normalizeImportPreviewText(selectedAccount?.nickName);

  if (!importedGameUid && !importedNickName) {
    return {
      tone: 'success',
      canImport: true,
      message: t('modals.import.verifyMatchedMissingAccount'),
    };
  }

  if (importedGameUid && verifiedGameUid && importedGameUid !== verifiedGameUid) {
    return {
      tone: 'error',
      canImport: false,
      message: t('modals.import.verifyMismatch', {
        imported: importedGameUid,
        verified: verifiedGameUid,
      }),
    };
  }

  if (!importedNickNameIsUidFallback && importedNickName && verifiedNickName && importedNickName !== verifiedNickName) {
    return {
      tone: 'warning',
      canImport: true,
      message: t('modals.import.verifyNicknameDifferent', {
        imported: importedNickName,
        verified: verifiedNickName,
      }),
    };
  }

  return {
    tone: 'success',
    canImport: true,
    message: t('modals.import.verifyMatched'),
  };
}

function normalizeVerifiedImportAccounts(accounts = [], source = 'cn') {
  return (Array.isArray(accounts) ? accounts : []).map((account) => ({
    ...account,
    source,
    serverTag: account.serverTag || buildGameAccountServerTag(account),
  }));
}

function getImportVerifyStep(status) {
  if (status === 'checking') return 2;
  if (status === 'selecting' || status === 'verified') return 3;
  if (status === 'error') return 2;
  return 1;
}

function getImportVerifyProgress(status) {
  if (status === 'checking') return 55;
  if (status === 'selecting') return 78;
  if (status === 'verified') return 100;
  if (status === 'error') return 100;
  return 8;
}

function getImportVerifyStatusMessage(status, t) {
  if (status === 'checking') return t('modals.import.verifyStatusChecking');
  if (status === 'selecting') return t('modals.import.verifyStatusSelecting');
  if (status === 'verified') return t('modals.import.verifyStatusVerified');
  if (status === 'error') return t('modals.import.verifyStatusError');
  return t('modals.import.verifyStatusIdle');
}

function getImportVerifyToneClasses(tone) {
  if (tone === 'error') {
    return 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/20 dark:text-red-300';
  }
  if (tone === 'warning') {
    return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300';
  }
  if (tone === 'success') {
    return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300';
  }
  return 'border-zinc-200 bg-white text-slate-600 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400';
}

/**
 * 全局弹窗管理组件
 */
export default function GachaModals({
  // 已知抽卡人列表
  knownDrawers,
  // Toast
  toasts,
  removeToast,
  addDurableNotification,
  // Confirm
  confirmState,
  handleConfirm,
  handleCancel,
  // 卡池操作回调
  closeModalAndClear,
  confirmCreatePool,
  confirmEditPool,
  confirmDeletePool,
  confirmDeleteData,
  confirmRealDeleteItem,
  confirmRealDeleteGroup,
  // 数据导入
  pendingImport,
  setPendingImport,
  confirmImport,
  // 迁移
  showMigrateModal,
  setShowMigrateModal,
  migrateLocalToCloud,
  canEdit,
}) {
  const { t, locale, formatNumber, formatDateTime } = useI18n();
  // 从 stores 获取状态
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const showAuthModal = useAuthStore((state) => state.showAuthModal);
  const closeAuthModal = useAuthStore((state) => state.closeAuthModal);
  const syncing = useAuthStore((state) => state.syncing);
  const syncError = useAuthStore((state) => state.syncError);

  const modalState = useUIStore((state) => state.modalState);
  const setModalState = useUIStore((state) => state.setModalState);

  const history = useHistoryStore((state) => state.history);
  const [poolForm, setPoolForm] = useState(DEFAULT_POOL_FORM);
  const [importAccountForm, setImportAccountForm] = useState({ gameUid: '', nickName: '', serverId: '' });
  const [importManualAccountMode, setImportManualAccountMode] = useState(false);
  const [showImportAccountVerifyModal, setShowImportAccountVerifyModal] = useState(false);
  const [importVerifyState, setImportVerifyState] = useState({
    source: 'cn',
    tokenInput: '',
    autoDetected: false,
    status: 'idle',
    accounts: [],
    selectedAccount: null,
    error: '',
  });
  const importPreview = useMemo(() => buildPendingImportPreview(pendingImport), [pendingImport]);
  const canOverrideImportAccount = importPreview.accountCount <= 1;
  const importVerificationResult = useMemo(
    () => buildImportVerificationResult(importPreview.primaryAccount, importVerifyState.selectedAccount, t),
    [importPreview.primaryAccount, importVerifyState.selectedAccount, t]
  );
  const importAccountReady = (!importPreview.accountServerMissing || ['1', '2', '3'].includes(importAccountForm.serverId)) && (
    !pendingImport ||
    !canOverrideImportAccount ||
    (importManualAccountMode
      ? importAccountForm.gameUid.trim() && importAccountForm.nickName.trim()
      : importVerificationResult.canImport));
  const importDateRange = useMemo(
    () => formatImportDateRange(importPreview, formatDateTime, t),
    [formatDateTime, importPreview, t]
  );

  useEffect(() => {
    queueMicrotask(() => {
      setPoolForm(getInitialPoolForm(modalState));
    });
  }, [modalState]);

  useEffect(() => {
    if (!pendingImport) {
      queueMicrotask(() => {
        setImportAccountForm({ gameUid: '', nickName: '' });
        setImportManualAccountMode(false);
        setShowImportAccountVerifyModal(false);
        setImportVerifyState({
          source: 'cn',
          tokenInput: '',
          autoDetected: false,
          status: 'idle',
          accounts: [],
          selectedAccount: null,
          error: '',
        });
      });
      return;
    }

    const primaryAccount = buildPendingImportPreview(pendingImport).primaryAccount;
    queueMicrotask(() => {
      setImportAccountForm({
        gameUid: primaryAccount?.gameUid || '',
        nickName: primaryAccount?.nickName || '',
        serverId: primaryAccount?.serverId || '',
      });
      setImportManualAccountMode(pendingImport.data?.sourceFormatId === 'endfield_helper_summary_xlsx');
      setShowImportAccountVerifyModal(false);
      setImportVerifyState({
        source: 'cn',
        tokenInput: '',
        autoDetected: false,
        status: 'idle',
        accounts: [],
        selectedAccount: null,
        error: '',
      });
    });
  }, [pendingImport]);

  const closePoolFormModal = () => {
    setPoolForm(DEFAULT_POOL_FORM);
    closeModalAndClear();
  };

  const applyAutoPoolName = (updates) => {
    setPoolForm((prev) => {
      const next = { ...prev, ...updates };
      return { ...next, name: buildPoolName(next.type, next.selectedCharName, next.drawerName, t) };
    });
  };

  const submitPoolForm = async () => {
    if (modalState.type === 'createPool') {
      await confirmCreatePool(poolForm);
      return;
    }

    await confirmEditPool(poolForm);
  };

  const selectVerifiedImportAccount = (account) => {
    if (!account) {
      return;
    }

    setImportVerifyState((prev) => ({
      ...prev,
      selectedAccount: account,
      status: 'verified',
      error: '',
    }));
    setImportManualAccountMode(false);
    setImportAccountForm({
      gameUid: normalizeComparableGameUid(account.gameUid),
      nickName: account.nickName || normalizeComparableGameUid(account.gameUid),
      serverId: String(account.serverId || ''),
    });
  };

  const verifyImportAccount = async () => {
    const { token } = parseImportVerifyTokenInput(importVerifyState.tokenInput);
    if (!token) {
      setImportVerifyState((prev) => ({
        ...prev,
        status: 'error',
        error: t('import.error.emptyToken'),
      }));
      return;
    }

    if (token.length !== 24) {
      setImportVerifyState((prev) => ({
        ...prev,
        status: 'error',
        error: t('import.error.tokenLength', { length: token.length }),
      }));
      return;
    }

    setImportVerifyState((prev) => ({
      ...prev,
      tokenInput: token,
      status: 'checking',
      accounts: [],
      selectedAccount: null,
      error: '',
    }));

    try {
      const result = await fetchAccountsList(token, null, importVerifyState.source);
      const accounts = normalizeVerifiedImportAccounts(result?.accounts || [], importVerifyState.source);
      if (accounts.length === 0) {
        setImportVerifyState((prev) => ({
          ...prev,
          status: 'error',
          accounts: [],
          error: t('modals.import.verifyNoAccounts'),
        }));
        return;
      }

      setImportVerifyState((prev) => ({
        ...prev,
        status: accounts.length === 1 ? 'verified' : 'selecting',
        accounts,
        selectedAccount: accounts.length === 1 ? accounts[0] : null,
        error: '',
      }));

      if (accounts.length === 1) {
        selectVerifiedImportAccount(accounts[0]);
      }
    } catch (verifyError) {
      setImportVerifyState((prev) => ({
        ...prev,
        status: 'error',
        accounts: [],
        selectedAccount: null,
        error: verifyError?.message || t('modals.import.verifyFailed'),
      }));
    }
  };

  const importVerifyStep = getImportVerifyStep(importVerifyState.status);
  const importVerifyProgress = getImportVerifyProgress(importVerifyState.status);
  const importVerifyStatusMessage =
    importVerifyState.error || getImportVerifyStatusMessage(importVerifyState.status, t);
  const importVerifyGuides = {
    cn: {
      bindingTitle: t('import.source.cn.bindingTitle'),
      bindingDesc: t('import.source.cn.bindingDesc'),
      bindingUrl: 'https://user.hypergryph.com/bindCharacters?game=endfield',
      bindingHost: 'user.hypergryph.com',
      tokenTitle: t('import.source.cn.tokenTitle'),
      tokenDesc: t('import.source.cn.tokenDesc'),
      tokenUrl: 'https://web-api.hypergryph.com/account/info/hg',
      tokenHost: 'web-api.hypergryph.com',
    },
    intl: {
      bindingTitle: t('import.source.intl.bindingTitle'),
      bindingDesc: t('import.source.intl.bindingDesc'),
      bindingUrl: 'https://topup.gryphline.com/endfield',
      bindingHost: 'topup.gryphline.com',
      tokenTitle: t('import.source.intl.tokenTitle'),
      tokenDesc: t('import.source.intl.tokenDesc'),
      tokenUrl: 'https://web-api.gryphline.com/cookie_store/account_token',
      tokenHost: 'web-api.gryphline.com',
    },
  };
  const importVerifyGuide = importVerifyGuides[importVerifyState.source] || importVerifyGuides.cn;

  return (
    <>
      {/* 创建/编辑卡池弹窗 */}
      {(modalState.type === 'createPool' || modalState.type === 'editPool') && (
        <div className="app-modal-backdrop fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={modalState.type === 'createPool' ? t('modals.pool.createTitle') : t('modals.pool.editTitle')}
            className="app-modal-panel bg-white dark:bg-zinc-900 rounded-none shadow-2xl w-full max-w-sm animate-scale-up"
          >
            <div className="app-modal-header p-3 sm:p-4 border-b border-zinc-100 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 flex gap-2 justify-between items-center">
              <h3 className="font-bold text-slate-700 dark:text-zinc-300">
                {modalState.type === 'createPool' ? t('modals.pool.createTitle') : t('modals.pool.editTitle')}
              </h3>
              <button
                onClick={closePoolFormModal}
                aria-label={t('common.close')}
                className="app-modal-icon-button text-slate-400 dark:text-zinc-500 hover:text-slate-600 dark:text-zinc-400 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              {modalState.type === 'createPool' && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-zinc-500 uppercase mb-2">
                    {t('modals.pool.quickPick')}
                  </label>
                  <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                    {PRESET_POOLS.map((preset, idx) => (
                      <button
                        key={idx}
                        onClick={() => applyAutoPoolName({ type: preset.type, selectedCharName: preset.charName })}
                        className="text-left text-xs p-2 rounded-none border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-yellow-50 dark:hover:bg-yellow-900/30 hover:border-yellow-300 dark:hover:border-yellow-700 text-slate-600 dark:text-zinc-300 hover:text-yellow-700 dark:hover:text-yellow-300 transition-colors truncate"
                        title={preset.label}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {modalState.type === 'editPool' && (
                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-zinc-400 mb-2">
                    {t('modals.pool.creator')}
                  </label>
                  <div className="flex items-center gap-2 px-4 py-2 border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-none">
                    <User size={16} />
                    <span>
                      {modalState.data?.creator_username ||
                        (user ? buildUsernameHandle(user) : t('settings.mobile.unnamedUser'))}
                    </span>
                    {modalState.data?.created_at && (
                      <span className="text-xs text-zinc-400 dark:text-zinc-500 ml-auto">
                        {t('modals.pool.createdAt', {
                          value: new Date(modalState.data.created_at).toLocaleDateString(
                            locale === 'en-US' ? 'en-US' : 'zh-CN'
                          ),
                        })}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-zinc-400 mb-2">
                  {t('modals.pool.drawer')}
                </label>
                {knownDrawers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {knownDrawers.map((drawer) => (
                      <button
                        key={drawer}
                        onClick={() => {
                          if (modalState.type === 'createPool') {
                            applyAutoPoolName({ drawerName: drawer });
                          } else {
                            setPoolForm((prev) => ({ ...prev, drawerName: drawer }));
                          }
                        }}
                        className={`text-xs px-2 py-1 rounded-none border transition-colors ${
                          poolForm.drawerName === drawer
                            ? 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-400 dark:border-yellow-700 text-yellow-700 dark:text-yellow-300 font-bold'
                            : 'bg-slate-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-400 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 hover:border-yellow-300 dark:hover:border-yellow-700'
                        }`}
                      >
                        <User size={10} className="inline mr-1" />
                        {drawer}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  type="text"
                  value={poolForm.drawerName}
                  onChange={(e) => {
                    if (modalState.type === 'createPool') {
                      applyAutoPoolName({ drawerName: e.target.value });
                    } else {
                      setPoolForm((prev) => ({ ...prev, drawerName: e.target.value }));
                    }
                  }}
                  placeholder={
                    knownDrawers.length > 0
                      ? t('modals.pool.drawerPlaceholderWithKnown')
                      : t('modals.pool.drawerPlaceholder')
                  }
                  className="w-full px-4 py-2 border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 rounded-none focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-zinc-400 mb-2">
                  {t('modals.pool.name')}
                </label>
                <input
                  type="text"
                  value={poolForm.name}
                  onChange={(e) => setPoolForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder={t('modals.pool.namePlaceholder')}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 rounded-none focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 outline-none transition-all"
                  onKeyDown={(e) => e.key === 'Enter' && submitPoolForm()}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 dark:text-zinc-400 mb-2">
                  {t('modals.pool.typeLabel')}
                </label>
                <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-3">
                  {['limited', 'standard', 'weapon'].map((type) => (
                    <label
                      key={type}
                      className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-none border cursor-pointer transition-all ${poolForm.type === type ? (type === 'weapon' ? 'bg-slate-800 border-slate-600 text-white' : type === 'limited' ? 'bg-orange-50 border-orange-500 text-orange-700' : 'bg-yellow-50 dark:bg-yellow-900/20 border-indigo-500 text-yellow-700 dark:text-yellow-300') + ' font-bold ring-1' : 'border-zinc-200 dark:border-zinc-800 text-slate-500 dark:text-zinc-500 hover:bg-slate-50 dark:bg-zinc-950'}`}
                    >
                      <input
                        type="radio"
                        name="poolType"
                        value={type}
                        checked={poolForm.type === type}
                        onChange={() => {
                          if (modalState.type === 'createPool') {
                            applyAutoPoolName({ type });
                          } else {
                            setPoolForm((prev) => ({ ...prev, type }));
                          }
                        }}
                        className="hidden"
                      />
                      {type === 'limited' && <Star size={16} />}
                      {type === 'standard' && <Layers size={16} />}
                      {type === 'weapon' && <Search size={16} />}
                      {getPoolTypeLabel(type, t)}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-400 dark:text-zinc-500 mt-2">
                  {poolForm.type === 'limited' && t('modals.pool.typeHint.limited')}
                  {poolForm.type === 'standard' && t('modals.pool.typeHint.standard')}
                  {poolForm.type === 'weapon' &&
                    (poolForm.isLimitedWeapon
                      ? t('modals.pool.typeHint.weaponLimited')
                      : t('modals.pool.typeHint.weaponStandard'))}
                </p>

                {poolForm.type === 'weapon' && (
                  <div className="mt-3 p-3 bg-slate-50 dark:bg-zinc-800 rounded-none border border-zinc-200 dark:border-zinc-700">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <span className="text-sm font-medium text-slate-700 dark:text-zinc-300">
                          {t('modals.pool.limitedWeaponToggle')}
                        </span>
                        <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">
                          {t('modals.pool.limitedWeaponHint')}
                        </p>
                      </div>
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={poolForm.isLimitedWeapon}
                          onChange={(e) => setPoolForm((prev) => ({ ...prev, isLimitedWeapon: e.target.checked }))}
                          className="sr-only"
                        />
                        <div
                          className={`w-11 h-6 rounded-full transition-colors ${poolForm.isLimitedWeapon ? 'bg-orange-500' : 'bg-slate-300 dark:bg-zinc-600'}`}
                        >
                          <div
                            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${poolForm.isLimitedWeapon ? 'translate-x-5' : ''}`}
                          ></div>
                        </div>
                      </div>
                    </label>
                  </div>
                )}
              </div>
            </div>
            <div className="app-modal-actions p-4 border-t border-zinc-100 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 flex flex-wrap gap-3 justify-end">
              <button
                onClick={closePoolFormModal}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-zinc-400 hover:text-slate-800 dark:text-zinc-100 hover:bg-slate-200 rounded-none transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={submitPoolForm}
                disabled={!poolForm.name.trim()}
                className="px-4 py-2 text-sm font-bold text-white bg-endfield-yellow text-black hover:bg-yellow-400 font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed rounded-none shadow-sm transition-all"
              >
                {modalState.type === 'createPool' ? t('modals.pool.createAction') : t('modals.pool.saveAction')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除卡池确认弹窗 */}
      {modalState.type === 'deletePool' && (
        <div className="app-modal-backdrop fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="app-modal-panel bg-white dark:bg-zinc-900 rounded-none shadow-2xl w-full max-w-sm animate-scale-up">
            <div className="p-6 text-center">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 text-red-500 rounded-sm flex items-center justify-center mx-auto mb-4">
                <Trash2 size={24} />
              </div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-zinc-100 mb-2">
                {t('modals.deletePool.title')}
              </h3>
              <p className="text-sm text-slate-500 dark:text-zinc-500 whitespace-pre-line">
                {t('modals.deletePool.message', {
                  name: modalState.data?.name,
                  count: (history || []).filter((h) => h.poolId === modalState.data?.id).length,
                })}
              </p>
            </div>
            <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 flex gap-3 justify-center">
              <button
                onClick={closeModalAndClear}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-100 hover:bg-slate-200 dark:hover:bg-zinc-800 rounded-none transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmDeletePool}
                className="px-4 py-2 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-none shadow-sm transition-all"
              >
                {t('modals.deletePool.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 清空卡池数据确认弹窗 */}
      {modalState.type === 'deleteConfirm' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white dark:bg-zinc-900 rounded-none shadow-2xl w-full max-w-sm overflow-hidden animate-scale-up">
            <div className="p-6 text-center">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 text-red-500 rounded-sm flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={24} />
              </div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-zinc-100 mb-2">
                {t('modals.deleteData.title')}
              </h3>
              <p className="text-sm text-slate-500 dark:text-zinc-500 whitespace-pre-line">
                {t('modals.deleteData.message', { name: modalState.data?.poolName })}
              </p>
            </div>
            <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 flex gap-3 justify-center">
              <button
                onClick={closeModalAndClear}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-100 hover:bg-slate-200 dark:hover:bg-zinc-800 rounded-none transition-colors"
              >
                {t('modals.deleteData.cancel')}
              </button>
              <button
                onClick={confirmDeleteData}
                className="px-4 py-2 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-none shadow-sm transition-all"
              >
                {t('modals.deleteData.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除单条记录确认 */}
      {modalState.type === 'deleteItem' && (
        <div
          className="app-modal-backdrop fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-fade-in"
          style={{ zIndex: 60 }}
        >
          <div className="app-modal-panel bg-white dark:bg-zinc-900 rounded-none shadow-2xl w-full max-w-sm animate-scale-up">
            <div className="p-6 text-center">
              <div className="w-12 h-12 bg-red-100 text-red-500 rounded-sm flex items-center justify-center mx-auto mb-4">
                <Trash2 size={24} />
              </div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-zinc-100 mb-2">
                {t('modals.deleteItem.title')}
              </h3>
              <p className="text-sm text-slate-500 dark:text-zinc-500">{t('modals.deleteItem.message')}</p>
            </div>
            <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 flex gap-3 justify-center">
              <button
                onClick={() => setModalState({ type: null, data: null })}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-zinc-400 hover:text-slate-800 dark:text-zinc-100 hover:bg-slate-200 rounded-none transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmRealDeleteItem}
                className="px-4 py-2 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-none shadow-sm transition-all"
              >
                {t('modals.deleteItem.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除整组确认 */}
      {modalState.type === 'deleteGroup' && (
        <div className="app-modal-backdrop fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="app-modal-panel bg-white dark:bg-zinc-900 rounded-none shadow-2xl w-full max-w-sm animate-scale-up">
            <div className="p-6 text-center">
              <div className="w-12 h-12 bg-red-100 text-red-500 rounded-sm flex items-center justify-center mx-auto mb-4">
                <Trash2 size={24} />
              </div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-zinc-100 mb-2">
                {t('modals.deleteGroup.title', { count: modalState.data?.length || 0 })}
              </h3>
              <p className="text-sm text-slate-500 dark:text-zinc-500">{t('modals.deleteGroup.message')}</p>
            </div>
            <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 flex gap-3 justify-center">
              <button
                onClick={closeModalAndClear}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-zinc-400 hover:text-slate-800 dark:text-zinc-100 hover:bg-slate-200 rounded-none transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmRealDeleteGroup}
                className="px-4 py-2 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-none shadow-sm transition-all"
              >
                {t('modals.deleteGroup.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 登录弹窗 */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={closeAuthModal}
        onAuthSuccess={(user) => setUser(user)}
        addDurableNotification={addDurableNotification}
      />

      {/* 数据迁移弹窗 */}
      {showMigrateModal && canEdit && (
        <div className="app-modal-backdrop fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="app-modal-panel bg-white dark:bg-zinc-900 rounded-none shadow-2xl w-full max-w-sm animate-scale-up">
            <div className="p-6 text-center">
              <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 rounded-sm flex items-center justify-center mx-auto mb-4">
                <Cloud size={24} />
              </div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-zinc-100 mb-2">{t('modals.migrate.title')}</h3>
              <p className="text-sm text-slate-500 dark:text-zinc-500 whitespace-pre-line">
                {t('modals.migrate.message', { count: (history || []).length })}
              </p>
              {syncing && (
                <div className="mt-4 flex items-center justify-center gap-2 text-yellow-600 dark:text-endfield-yellow">
                  <RefreshCw size={16} className="animate-spin" />
                  <span className="text-sm">{t('settings.syncing')}</span>
                </div>
              )}
              {syncError && (
                <div className="mt-4 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded-none">
                  {t('modals.migrate.error', { value: syncError })}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 flex gap-3 justify-center">
              <button
                onClick={() => setShowMigrateModal(false)}
                disabled={syncing}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-100 hover:bg-slate-200 dark:hover:bg-zinc-800 rounded-none transition-colors disabled:opacity-50"
              >
                {t('modals.migrate.skip')}
              </button>
              <button
                onClick={async () => {
                  const success = await migrateLocalToCloud();
                  if (success) setShowMigrateModal(false);
                }}
                disabled={syncing}
                className="px-4 py-2 text-sm font-bold bg-endfield-yellow text-black hover:bg-yellow-400 uppercase tracking-wider rounded-none shadow-sm transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {syncing ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    {t('modals.migrate.progress')}
                  </>
                ) : (
                  <>
                    <Cloud size={16} />
                    {t('modals.migrate.confirm')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导入确认弹窗 */}
      {pendingImport && (
        <div className="app-modal-backdrop fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm animate-fade-in">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('modals.import.title')}
            className="app-modal-panel bg-white dark:bg-zinc-900 rounded-none shadow-2xl w-full max-w-3xl animate-scale-up"
          >
            <div className="app-modal-header p-3 sm:p-5 border-b border-zinc-100 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 flex items-start gap-3">
              <div className="hidden sm:flex w-12 h-12 bg-blue-100 dark:bg-blue-950/40 text-blue-500 rounded-sm items-center justify-center shrink-0">
                <Upload size={24} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold text-slate-800 dark:text-zinc-100">{t('modals.import.title')}</h3>
                <p className="text-xs text-slate-500 dark:text-zinc-500 mt-1">
                  {t('modals.import.source', { value: importPreview.sourceLabel || '-' })}
                </p>
              </div>
              <button
                onClick={() => setPendingImport(null)}
                className="app-modal-icon-button text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-100 hover:bg-slate-200 dark:hover:bg-zinc-800 transition-colors"
                aria-label={t('common.cancel')}
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 sm:p-5 space-y-5">
              <p className="text-xs text-slate-500 dark:text-zinc-500">
                {t('modals.import.dateRange', { value: importDateRange })}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  [importPreview.sparseSummary ? (locale === 'en-US' ? 'Known high-rarity drops' : '已知高星出货') : t('modals.import.totalPulls'), importPreview.sparseSummary ? importPreview.supplementalDropCount : importPreview.historyCount],
                  [t('modals.import.poolCount'), importPreview.poolCount],
                  [t('modals.import.sixStarCount'), importPreview.rarityCounts[6] || 0],
                  [t('modals.import.fiveStarCount'), importPreview.rarityCounts[5] || 0],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3"
                  >
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">
                      {label}
                    </div>
                    <div className="text-2xl font-black text-slate-900 dark:text-zinc-100 mt-1">
                      {formatNumber(value)}
                    </div>
                  </div>
                ))}
              </div>

              {(importPreview.sparseSummary || importPreview.unresolvedCount > 0) && (
                <div className="border border-amber-300 bg-amber-50 p-4 text-xs leading-5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
                  {importPreview.sparseSummary
                    ? (locale === 'en-US' ? `${importPreview.supplementalDropCount} known drops and ${importPreview.supplementCount} supplementary entries. Missing totals and low-rarity history remain unknown; supplements are excluded from community statistics.`
                      : `${importPreview.supplementalDropCount} 条已知高星出货，整理为 ${importPreview.supplementCount} 条补录。缺失的低星、总抽数和累计位置保持未知；补录不参与全服统计。`)
                    : (locale === 'en-US' ? `${importPreview.unresolvedCount} unknown results from the source will be retained for review. Their identity and quality are not inferred; affected totals and pity remain unknown.`
                      : `原站有 ${importPreview.unresolvedCount} 条“三星未知角色／武器”。原始条目将保存为待核对资料，不猜测其身份或赠礼类型；受影响的总量和保底保持未知。`)}
                </div>
              )}

              {importPreview.accountServerMissing && (
                <label className="block border border-yellow-300 bg-yellow-50 p-4 text-sm dark:border-yellow-700 dark:bg-yellow-950/20">
                  {locale === 'en-US' ? 'Game server for this Excel' : '这份 Excel 对应的游戏区服'}
                  <select aria-label={locale === 'en-US' ? 'Excel game server' : 'Excel 游戏区服'} className="mt-2 block w-full border border-zinc-300 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900" value={importAccountForm.serverId || ''} onChange={event => setImportAccountForm(previous => ({ ...previous, serverId: event.target.value }))}>
                    <option value="">{locale === 'en-US' ? 'Select a server' : '请选择区服'}</option>
                    <option value="1">{locale === 'en-US' ? 'CN (official / Bilibili)' : '国服（官服／B服）'}</option>
                    <option value="2">{locale === 'en-US' ? 'International · Asia' : '国际服 · 亚洲'}</option>
                    <option value="3">{locale === 'en-US' ? 'International · EU/NA' : '国际服 · 欧美'}</option>
                  </select>
                </label>
              )}

              {importPreview.calendarConflictCount > 0 && <p className="border border-amber-300 bg-amber-50 p-4 text-xs leading-5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
                {locale === 'en-US'
                  ? `${importPreview.calendarConflictCount} source timestamps conflict with the banner calendar. Original times are retained in source notes for review and excluded from exact time analysis.`
                  : `${importPreview.calendarConflictCount} 条原表时间与当前卡池日历不一致。原始时间保留在来源说明中待核对，暂不参与准确时间分析。`}
              </p>}
              {importPreview.intervalConflictCount > 0 && <p className="border border-amber-300 bg-amber-50 p-4 text-xs leading-5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
                {locale === 'en-US'
                  ? `${importPreview.intervalConflictCount} source pull intervals exceed the banner pity limit. Original values are retained in source notes for review and excluded from exact interval analysis.`
                  : `${importPreview.intervalConflictCount} 条原表间隔超过本池保底上限。原值保留在来源说明中待核对，暂不参与准确间隔分析。`}
              </p>}

              {importPreview.accountInfoMissing && (
                <div className="border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
                  <div className="flex items-start gap-3">
                    <AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
                    <div>
                      <h4 className="text-sm font-black text-amber-900 dark:text-amber-200">
                        {t('modals.import.missingAccountInfoTitle')}
                      </h4>
                      <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-300">
                        {t('modals.import.missingAccountInfoDesc')}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-950/20 p-4">
                <div className="flex items-start gap-3">
                  <User size={18} className="text-yellow-700 dark:text-endfield-yellow mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-black text-slate-900 dark:text-zinc-100">
                      {t('modals.import.accountTitle')}
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-zinc-400 mt-1">
                      {importPreview.accountInfoMissing
                        ? t('modals.import.accountMissingDesc')
                        : canOverrideImportAccount
                          ? t('modals.import.accountDesc')
                          : t('modals.import.accountMultipleDesc')}
                    </p>
                  </div>
                </div>

                {canOverrideImportAccount ? (
                  <>
                    <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-stretch">
                      <div className="border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/60 px-3 py-2">
                        <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">
                          {t('modals.import.detectedAccount')}
                        </div>
                        <div className="mt-1 text-sm font-black text-slate-900 dark:text-zinc-100">
                          {importPreview.accountInfoMissing
                            ? t('modals.import.noAccountInFile')
                            : importPreview.primaryAccount?.nickName || '-'}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-zinc-500">
                          UID {normalizeComparableGameUid(importPreview.primaryAccount?.gameUid) || '-'}
                        </div>
                      </div>
                      <div
                        className={`border px-3 py-2 ${getImportVerifyToneClasses(importManualAccountMode ? 'warning' : importVerificationResult.tone)}`}
                      >
                        <div className="text-[11px] font-bold uppercase tracking-widest opacity-75">
                          {importManualAccountMode
                            ? t('modals.import.manualStatus')
                            : importVerificationResult.canImport
                              ? t('modals.import.verifyDone')
                              : t('modals.import.verifyRequired')}
                        </div>
                        <div className="mt-1 text-sm font-black">
                          {importManualAccountMode
                            ? importAccountForm.nickName || '-'
                            : importVerifyState.selectedAccount?.nickName || t('modals.import.verifyPendingShort')}
                        </div>
                        <div className="text-xs opacity-80">
                          UID{' '}
                          {normalizeComparableGameUid(
                            importManualAccountMode
                              ? importAccountForm.gameUid
                              : importVerifyState.selectedAccount?.gameUid
                          ) || '-'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowImportAccountVerifyModal(true)}
                        className="px-4 py-2 bg-endfield-yellow text-black text-xs font-black uppercase tracking-widest hover:bg-yellow-400 transition-colors flex items-center justify-center gap-2"
                      >
                        {importVerificationResult.canImport || importManualAccountMode
                          ? t('modals.import.verifyReset')
                          : t('modals.import.verifyOpen')}
                        <ArrowRight size={14} />
                      </button>
                    </div>

                    {(importVerifyState.selectedAccount || importVerifyState.error || importManualAccountMode) && (
                      <div
                        className={`mt-3 border px-3 py-2 text-xs font-bold ${
                          importManualAccountMode
                            ? getImportVerifyToneClasses('warning')
                            : getImportVerifyToneClasses(
                                importVerifyState.error ? 'error' : importVerificationResult.tone
                              )
                        }`}
                      >
                        {importManualAccountMode
                          ? t('modals.import.manualReady')
                          : importVerifyState.error || importVerificationResult.message}
                      </div>
                    )}
                    <p className="text-[11px] text-slate-500 dark:text-zinc-500 mt-3">
                      {t('modals.import.accountGuide')}
                    </p>
                  </>
                ) : (
                  <div className="mt-4 grid md:grid-cols-2 gap-2">
                    {importPreview.accounts.map((account) => (
                      <div
                        key={`${account.gameUid || ''}:${account.nickName || ''}`}
                        className="border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/60 px-3 py-2"
                      >
                        <div className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                          {account.nickName || '-'}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-zinc-500">UID {account.gameUid || '-'}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
                  <h4 className="text-sm font-black text-slate-900 dark:text-zinc-100 mb-3 flex items-center gap-2">
                    <Star size={16} className="text-yellow-500" />
                    {t('modals.import.sixStarDrops')}
                  </h4>
                  {importPreview.sixStarDrops.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                      {importPreview.sixStarDrops.map((drop) => (
                        <div
                          key={drop.name}
                          className="flex items-center justify-between gap-2 bg-slate-100 dark:bg-zinc-900 px-3 py-2"
                        >
                          <span className="text-sm font-bold text-slate-800 dark:text-zinc-100 truncate">
                            {drop.name}
                          </span>
                          <span className="text-xs font-black text-yellow-600 dark:text-endfield-yellow shrink-0">
                            x{formatNumber(drop.count)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-zinc-500">{t('modals.import.noSixStarDrops')}</p>
                  )}
                </div>

                <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
                  <h4 className="text-sm font-black text-slate-900 dark:text-zinc-100 mb-3 flex items-center gap-2">
                    <Layers size={16} className="text-blue-500" />
                    {t('modals.import.poolBreakdown')}
                  </h4>
                  <div className="space-y-2">
                    {importPreview.poolBreakdown.map((pool) => (
                      <div key={pool.name} className="flex items-center justify-between gap-3">
                        <span className="text-sm font-bold text-slate-700 dark:text-zinc-200 truncate">
                          {pool.name}
                        </span>
                        <span className="text-xs font-black text-slate-500 dark:text-zinc-400 shrink-0">
                          {formatNumber(pool.count)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="text-xs space-y-2">
                <p className="text-slate-500 dark:text-zinc-500">{t('modals.import.skipDuplicate')}</p>
                {pendingImport.willSyncToCloud ? (
                  <p className="text-green-600 dark:text-green-400 flex items-center gap-1">
                    <Cloud size={14} /> {t('modals.import.cloudSync')}
                  </p>
                ) : (
                  <p className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <CloudOff size={14} /> {t('modals.import.localOnly')}
                  </p>
                )}
              </div>
            </div>
            <div className="app-modal-actions p-4 border-t border-zinc-100 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 flex flex-wrap gap-3 justify-end">
              <button
                onClick={() => setPendingImport(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-100 hover:bg-slate-200 dark:hover:bg-zinc-800 rounded-none transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => confirmImport({ accountOverride: canOverrideImportAccount ? importAccountForm : null })}
                disabled={syncing || !importAccountReady}
                className="px-4 py-2 text-sm font-bold text-white bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed rounded-none shadow-sm transition-all flex items-center gap-2"
              >
                {syncing ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {syncing ? t('modals.import.progress') : t('modals.import.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingImport && canOverrideImportAccount && showImportAccountVerifyModal && (
        <div className="app-modal-backdrop fixed inset-0 z-[130] bg-black/60 backdrop-blur-sm animate-fade-in">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('modals.import.verifyModalTitle')}
            className="app-modal-panel bg-white dark:bg-zinc-900 rounded-none shadow-2xl w-full max-w-2xl animate-scale-up"
          >
            <div className="app-modal-header p-3 sm:p-5 border-b border-zinc-100 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 flex items-start gap-3">
              <div className="hidden sm:flex w-12 h-12 bg-yellow-100 dark:bg-yellow-950/40 text-yellow-600 dark:text-endfield-yellow rounded-sm items-center justify-center shrink-0">
                <User size={24} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold text-slate-800 dark:text-zinc-100">
                  {t('modals.import.verifyModalTitle')}
                </h3>
              </div>
              <button
                onClick={() => setShowImportAccountVerifyModal(false)}
                disabled={importVerifyState.status === 'checking'}
                className="app-modal-icon-button text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-100 hover:bg-slate-200 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                aria-label={t('common.cancel')}
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] transition-colors">
              <div className="grid grid-cols-3 gap-2 text-[11px] uppercase tracking-wide sm:tracking-widest">
                {[
                  [1, t('modals.import.verifyStepToken')],
                  [2, t('modals.import.verifyStepAccount')],
                  [3, t('modals.import.verifyStepConfirm')],
                ].map(([step, label]) => (
                  <React.Fragment key={step}>
                    <div
                      className={`flex min-w-0 items-center gap-2 transition-colors ${
                        importVerifyStep >= step
                          ? 'text-yellow-600 dark:text-yellow-500 font-bold'
                          : 'text-slate-400 dark:text-zinc-500'
                      }`}
                    >
                      <span
                        className={`w-6 h-6 shrink-0 flex items-center justify-center border transition-colors ${
                          importVerifyStep >= step ? 'border-yellow-500 bg-yellow-500/10' : 'border-current'
                        }`}
                        style={{
                          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%)',
                        }}
                      >
                        {step}
                      </span>
                      <span>{label}</span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              <p className="text-xs text-slate-500 dark:text-zinc-500">{t('modals.import.verifyModalDesc')}</p>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="border border-zinc-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950/40 p-3">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">
                    {t('modals.import.detectedAccount')}
                  </div>
                  <div className="mt-1 text-sm font-black text-slate-900 dark:text-zinc-100">
                    {importPreview.accountInfoMissing
                      ? t('modals.import.noAccountInFile')
                      : importPreview.primaryAccount?.nickName || '-'}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-zinc-500">
                    UID {normalizeComparableGameUid(importPreview.primaryAccount?.gameUid) || '-'}
                  </div>
                </div>
                <div className={`border p-3 ${getImportVerifyToneClasses(importVerificationResult.tone)}`}>
                  <div className="text-[11px] font-bold uppercase tracking-widest opacity-75">
                    {importVerificationResult.canImport
                      ? t('modals.import.verifyDone')
                      : t('modals.import.verifyRequired')}
                  </div>
                  <div className="mt-1 text-sm font-black">
                    {importVerifyState.selectedAccount?.nickName || t('modals.import.verifyPendingShort')}
                  </div>
                  <div className="text-xs opacity-80">
                    UID {normalizeComparableGameUid(importVerifyState.selectedAccount?.gameUid) || '-'}
                  </div>
                </div>
              </div>

              <div className="border border-zinc-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/50 p-4">
                <div className="flex justify-between items-center mb-2 text-[10px] uppercase text-slate-500 dark:text-zinc-500 transition-colors tracking-widest">
                  <span className="flex items-center gap-2">
                    {importVerifyState.status === 'checking' ? (
                      <RefreshCw size={12} className="animate-spin text-yellow-600 dark:text-yellow-500" />
                    ) : (
                      <CheckCircle2 size={12} className="text-yellow-600 dark:text-yellow-500" />
                    )}
                    {t('modals.import.verifyProgressTitle')}
                  </span>
                  <span className="text-yellow-600 dark:text-yellow-500 font-bold">{importVerifyProgress}%</span>
                </div>
                <div
                  className="h-1.5 w-full bg-slate-200 dark:bg-zinc-900 relative overflow-hidden transition-colors"
                  style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)' }}
                >
                  <div
                    className={`h-full transition-all duration-300 ${importVerifyState.status === 'error' ? 'bg-red-500' : 'bg-yellow-500'}`}
                    style={{ width: `${importVerifyProgress}%` }}
                  />
                </div>
                <div className="mt-2 text-xs text-slate-600 dark:text-zinc-400">{importVerifyStatusMessage}</div>
              </div>

              <div
                className="bg-slate-50 dark:bg-zinc-950/40 border border-zinc-200 dark:border-zinc-800 p-4 sm:p-5 transition-colors"
                style={{ clipPath: 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)' }}
              >
                <div className="mb-4">
                  <div className="text-[11px] text-slate-600 dark:text-zinc-400 font-bold uppercase tracking-widest mb-3">
                    {t('import.official.sourceLabel')}
                  </div>
                  <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 sm:gap-3">
                    {['cn', 'intl'].map((sourceKey) => (
                      <button
                        key={sourceKey}
                        type="button"
                        onClick={() =>
                          setImportVerifyState((prev) => ({
                            ...prev,
                            source: sourceKey,
                            status: 'idle',
                            accounts: [],
                            selectedAccount: null,
                            error: '',
                          }))
                        }
                        disabled={importVerifyState.status === 'checking'}
                        className={`border p-4 text-left transition-all duration-300 relative group overflow-hidden disabled:opacity-60 ${
                          importVerifyState.source === sourceKey
                            ? 'border-yellow-500 bg-zinc-100 dark:bg-yellow-500/10 shadow-[0_0_15px_rgba(234,179,8,0.1)]'
                            : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-slate-50 dark:hover:bg-zinc-800 hover:border-yellow-500/50'
                        }`}
                        style={{ clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)' }}
                      >
                        <div
                          className={`absolute inset-y-0 left-0 w-1 transition-transform duration-300 origin-bottom ${importVerifyState.source === sourceKey ? 'bg-yellow-500 scale-y-100' : 'bg-zinc-400 dark:bg-zinc-600 scale-y-0 group-hover:scale-y-100'}`}
                        />
                        <div
                          className={`text-sm font-bold tracking-widest uppercase transition-colors relative z-10 ${importVerifyState.source === sourceKey ? 'text-yellow-600 dark:text-yellow-500' : 'text-slate-800 dark:text-zinc-200 group-hover:text-yellow-600 dark:group-hover:text-yellow-500'}`}
                        >
                          {sourceKey === 'intl' ? t('import.source.intl.label') : t('import.source.cn.label')}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-zinc-500 mt-1.5 relative z-10">
                          {sourceKey === 'intl'
                            ? t('import.source.intl.description')
                            : t('import.source.cn.description')}
                        </div>
                        {importVerifyState.source === sourceKey && (
                          <div
                            className="absolute top-2 right-2 w-2 h-2 bg-yellow-500 animate-pulse"
                            style={{
                              clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
                            }}
                          />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <h3 className="text-slate-800 dark:text-zinc-300 font-bold mb-2 flex items-center gap-2 uppercase tracking-widest">
                  <HelpCircle size={14} className="text-yellow-600 dark:text-yellow-500" />
                  {t('modals.import.verifyGuideTitle')}
                </h3>

                <div className="space-y-4 pt-2 text-xs text-slate-500 dark:text-zinc-400">
                  {[
                    [
                      1,
                      importVerifyGuide.bindingTitle,
                      importVerifyGuide.bindingDesc,
                      importVerifyGuide.bindingUrl,
                      importVerifyGuide.bindingHost,
                    ],
                    [
                      2,
                      importVerifyGuide.tokenTitle,
                      importVerifyGuide.tokenDesc,
                      importVerifyGuide.tokenUrl,
                      importVerifyGuide.tokenHost,
                    ],
                    [3, t('modals.import.verifyNoFetchTitle'), t('modals.import.verifyNoFetchDesc'), null, null],
                  ].map(([step, title, desc, href, host]) => (
                    <div key={step} className="flex gap-3">
                      <div
                        className="w-5 h-5 flex-shrink-0 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 flex items-center justify-center text-slate-600 dark:text-zinc-300"
                        style={{
                          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%)',
                        }}
                      >
                        {step}
                      </div>
                      <div>
                        <p className="text-slate-800 dark:text-zinc-300 font-bold mb-1 uppercase tracking-widest">
                          {title}
                        </p>
                        <p className="mb-1 text-slate-500 dark:text-zinc-500">{desc}</p>
                        {href && (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 flex items-center gap-1 underline"
                          >
                            {host} <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <label className="block">
                  <span className="block text-[11px] text-slate-600 dark:text-zinc-400 font-bold uppercase tracking-widest mb-3">
                    {t('import.official.tokenLabel')}
                  </span>
                  <div className="relative">
                    <input
                      type="text"
                      value={importVerifyState.tokenInput}
                      onChange={(event) => {
                        const { token, fromJson } = parseImportVerifyTokenInput(event.target.value);
                        setImportVerifyState((prev) => ({
                          ...prev,
                          tokenInput: token || event.target.value,
                          autoDetected: fromJson,
                          status: 'idle',
                          accounts: [],
                          selectedAccount: null,
                          error: '',
                        }));
                      }}
                      disabled={importVerifyState.status === 'checking'}
                      className="w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 p-4 font-mono text-center text-lg text-slate-800 dark:text-white focus:border-yellow-500 dark:focus:border-yellow-500 focus:outline-none transition-colors placeholder:text-slate-300 dark:placeholder:text-zinc-700 shadow-inner disabled:opacity-60"
                      style={{
                        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)',
                      }}
                      placeholder={t('modals.import.verifyTokenPlaceholder')}
                    />
                    <div className="absolute right-3 top-[38px] text-[10px] text-slate-400 dark:text-zinc-600 font-mono pointer-events-none">
                      {importVerifyState.tokenInput.trim().length} chars
                    </div>
                  </div>
                </label>

                {importVerifyState.autoDetected && importVerifyState.tokenInput.length === 24 && (
                  <div
                    className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 px-3 py-2 transition-colors"
                    style={{ clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)' }}
                  >
                    <CheckCircle2 size={14} />
                    <span>{t('import.official.autoDetected')}</span>
                  </div>
                )}

                {importVerifyState.accounts.length > 1 && (
                  <div
                    className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 p-4 transition-colors"
                    style={{ clipPath: 'polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)' }}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <User className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      <span className="text-blue-700 dark:text-blue-400 font-bold uppercase tracking-widest text-sm">
                        {t('import.official.multipleAccounts')}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-zinc-400 text-xs mb-4">
                      {t('modals.import.verifySelectAccount')}
                    </p>
                    <div className="space-y-2">
                      {importVerifyState.accounts.map((account) => (
                        <button
                          key={`${account.uid || ''}-${account.gameUid || 'unknown'}-${account.serverId || 'unknown'}`}
                          type="button"
                          onClick={() => selectVerifiedImportAccount(account)}
                          className={`w-full p-4 border transition-all duration-300 text-left flex items-center gap-4 group hover:-translate-y-0.5 hover:shadow-lg relative overflow-hidden ${
                            importVerifyState.selectedAccount?.gameUid === account.gameUid
                              ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/20'
                              : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-yellow-500/50'
                          }`}
                          style={{
                            clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)',
                          }}
                        >
                          <div
                            className="w-12 h-12 flex items-center justify-center shrink-0 border border-black/10 dark:border-white/10 bg-amber-100 dark:bg-amber-800/50"
                            style={{ clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)' }}
                          >
                            <User size={24} className="text-amber-600 dark:text-amber-400" />
                          </div>
                          <div className="flex-1 min-w-0 z-10 relative">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-bold text-slate-800 dark:text-white truncate">
                                {account.nickName || '-'}
                              </span>
                              <span
                                className="shrink-0 text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider bg-amber-500 dark:bg-amber-600 text-white"
                                style={{ clipPath: 'polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 0 100%)' }}
                              >
                                {account.serverTag
                                  ? localizeGameAccountServerTag(account.serverTag, locale)
                                  : account.channelName}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-zinc-500 font-mono flex items-center gap-1">
                              <span className="text-[9px] uppercase tracking-widest">UID</span>
                              <span className="text-slate-700 dark:text-zinc-300 font-bold">
                                {normalizeComparableGameUid(account.gameUid) || '-'}
                              </span>
                            </p>
                          </div>
                          <ArrowRight
                            size={20}
                            className="text-slate-400 dark:text-zinc-500 group-hover:translate-x-1 group-hover:text-slate-800 dark:group-hover:text-white transition-all z-10 relative"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {(importVerifyState.selectedAccount || importVerifyState.error) && (
                  <div
                    className={`border px-3 py-2 text-xs font-bold ${getImportVerifyToneClasses(importVerifyState.error ? 'error' : importVerificationResult.tone)}`}
                  >
                    {importVerifyState.error || importVerificationResult.message}
                  </div>
                )}

                <button
                  type="button"
                  onClick={verifyImportAccount}
                  disabled={importVerifyState.status === 'checking' || !importVerifyState.tokenInput.trim()}
                  className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:bg-zinc-300 dark:disabled:bg-zinc-800 disabled:text-zinc-500 text-black font-bold py-4 text-sm tracking-widest uppercase transition-all duration-300 flex items-center justify-center gap-2 group relative overflow-hidden disabled:cursor-not-allowed"
                  style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)' }}
                >
                  <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 ease-in-out" />
                  <span className="relative z-10">
                    {importVerifyState.status === 'checking'
                      ? t('modals.import.verifyProgress')
                      : t('modals.import.verifyAction')}
                  </span>
                  {importVerifyState.status === 'checking' ? (
                    <RefreshCw size={16} className="animate-spin relative z-10" />
                  ) : (
                    <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform relative z-10" />
                  )}
                </button>
              </div>

              <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4">
                <button
                  type="button"
                  onClick={() => setImportManualAccountMode((prev) => !prev)}
                  className="text-[11px] font-bold uppercase tracking-widest text-slate-500 underline-offset-4 hover:text-slate-900 hover:underline dark:text-zinc-500 dark:hover:text-zinc-100"
                >
                  {importManualAccountMode ? t('modals.import.manualHide') : t('modals.import.manualShow')}
                </button>

                {importManualAccountMode && (
                  <div className="mt-3 border border-zinc-300 dark:border-zinc-700 bg-white/70 dark:bg-zinc-950/40 p-3">
                    <p className="mb-3 text-[11px] text-slate-500 dark:text-zinc-500">
                      {t('modals.import.manualDesc')}
                    </p>
                    <div className="grid md:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="block text-xs font-bold text-slate-600 dark:text-zinc-400 mb-1">
                          {t('modals.import.uidLabel')}
                        </span>
                        <input
                          value={importAccountForm.gameUid}
                          onChange={(event) =>
                            setImportAccountForm((prev) => ({ ...prev, gameUid: event.target.value }))
                          }
                          placeholder={t('modals.import.uidPlaceholder')}
                          className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm font-bold text-slate-900 dark:text-zinc-100 outline-none focus:border-yellow-500"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-xs font-bold text-slate-600 dark:text-zinc-400 mb-1">
                          {t('modals.import.nickNameLabel')}
                        </span>
                        <input
                          value={importAccountForm.nickName}
                          onChange={(event) =>
                            setImportAccountForm((prev) => ({ ...prev, nickName: event.target.value }))
                          }
                          placeholder={t('modals.import.nickNamePlaceholder')}
                          className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm font-bold text-slate-900 dark:text-zinc-100 outline-none focus:border-yellow-500"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 flex gap-3 justify-end">
              <button
                onClick={() => setShowImportAccountVerifyModal(false)}
                disabled={importVerifyState.status === 'checking'}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-100 hover:bg-slate-200 dark:hover:bg-zinc-800 rounded-none transition-colors disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => setShowImportAccountVerifyModal(false)}
                disabled={!importAccountReady || importVerifyState.status === 'checking'}
                className="px-4 py-2 text-sm font-bold bg-endfield-yellow text-black hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-none shadow-sm transition-all flex items-center gap-2"
              >
                <CheckCircle2 size={16} />
                {t('modals.import.verifyCompleteAction')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 通用确认弹窗 */}
      <ConfirmDialog
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        cancelText={confirmState.cancelText}
        type={confirmState.type}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />

      {/* Toast 通知 */}
      <Toast toasts={toasts} onRemove={removeToast} />
    </>
  );
}
