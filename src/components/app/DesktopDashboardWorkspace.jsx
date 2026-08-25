import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown, History, LogIn, Lock } from 'lucide-react';
import EditItemModal from '../modals/EditItemModal';
import DataExportOptionsModal from '../modals/DataExportOptionsModal.jsx';
import { useI18n } from '../../i18n/index.js';
import { useHistoryStore, usePersonalAnalysisStore, usePoolStore } from '../../stores';
import { isPoolGroupId } from '../../stores/usePoolStore';
import { localizePoolName } from '../../utils/gameDataI18n.js';
import { resolveEffectiveGameUid } from '../../utils/accountScopeUtils.js';
import { resolveGameAccountServerTag } from '../../utils/gameAccountMetadata.js';
import PersonalDataBoundary from './PersonalDataBoundary.jsx';
import AccountServerLabelNotice from './AccountServerLabelNotice.jsx';
import PoolSelector from '../pool/PoolSelector.jsx';

const DashboardView = lazy(() => import('../dashboard/DashboardView'));
const RecordsView = lazy(() => import('../records/RecordsView'));

function resolveExportGameAccounts(analysisAccounts, historyAccounts) {
  const accounts = Array.isArray(analysisAccounts)
    ? analysisAccounts
    : Array.isArray(historyAccounts) ? historyAccounts : [];
  return accounts.map((account) => ({
    ...account,
    serverTag: resolveGameAccountServerTag(account) || '区服待确认',
  }));
}

function TabPanelFallback({ label = '正在加载模块...' }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-none p-10 text-center animate-fade-in">
      <div className="inline-flex items-center gap-3 text-sm font-medium text-slate-500 dark:text-zinc-400">
        <div className="w-4 h-4 border-2 border-slate-300 dark:border-zinc-600 border-t-transparent rounded-full animate-spin"></div>
        <span>{label}</span>
      </div>
    </div>
  );
}

function RecordsSectionTitleBar({ currentPool: fallbackCurrentPool }) {
  const { isEnglish, locale, t } = useI18n();
  const tt = (zh, en) => (isEnglish ? en : zh);
  const activePool = fallbackCurrentPool;
  const currentPoolName = localizePoolName(activePool, { locale }) || activePool?.name || t('records.unknownPool');

  return (
    <summary className="flex min-h-14 cursor-pointer items-center gap-4 border border-zinc-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
        <span className="flex items-center gap-2 font-bold text-slate-700 dark:text-zinc-300">
          <History size={18} aria-hidden="true" /> {tt('详细日志', 'Detailed Records')}
        </span>
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">
          {t('records.currentPoolContext')}
        </span>
        <span className="min-w-0 max-w-[280px] truncate border border-yellow-500/30 bg-yellow-50 px-2 py-1 text-xs font-bold text-yellow-600 dark:bg-yellow-900/20 dark:text-endfield-yellow">
          {currentPoolName}
        </span>
      </div>
      <ChevronDown
        size={20}
        aria-hidden="true"
        className="shrink-0 text-slate-400 transition-transform group-open:rotate-180 dark:text-zinc-500"
      />
    </summary>
  );
}

export default function DesktopDashboardWorkspace({
  user,
  showToast,
  onRetryPersonalData,
  canEdit,
  canEditCurrentPool,
  currentPool,
  editItemState,
  setEditItemState,
  handleUpdateItem,
  handleDeleteItem,
  handleDeleteGroup,
  openImportWizard,
  handleExportJSON,
  handleExportCSV,
  handleExportEndfieldGachaUserDataZip,
  handleExportEndfieldGachaHelperJSON,
  handleExportEndfieldGachaHelperCSV,
  handleExportEndfieldGachaHelperUserDataZip,
  handleExportEndgachaKwerTopPlainJSON,
  handleExportEndgachaKwerTopPlainTXT,
}) {
  const { isEnglish, locale, t } = useI18n();
  const location = useLocation();
  const tt = (zh, en) => (isEnglish ? en : zh);
  const pools = usePoolStore((state) => state.pools);
  const currentPoolId = usePoolStore((state) => state.currentPoolId);
  const currentGameUid = usePoolStore((state) => state.currentGameUid);
  const getGameAccountsFromHistory = useHistoryStore((state) => state.getGameAccountsFromHistory);
  const analysisAccounts = usePersonalAnalysisStore((state) => state.owner?.accounts);
  const activeExportPool = currentPool;
  const exportCurrentPoolName =
    localizePoolName(activeExportPool, { locale }) || activeExportPool?.name || t('records.unknownPool');
  const exportPoolOptions = useMemo(
    () => [...(Array.isArray(pools) ? pools : [])].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-CN')),
    [pools]
  );
  const historyGameAccounts = getGameAccountsFromHistory();
  const exportGameAccounts = resolveExportGameAccounts(analysisAccounts, historyGameAccounts);
  const effectiveExportGameUid = useMemo(
    () =>
      resolveEffectiveGameUid({
        currentGameUid,
        gameAccounts: exportGameAccounts,
      }),
    [currentGameUid, exportGameAccounts]
  );

  const buildDefaultExportOptions = () => ({
    poolFilter: 'current',
    poolId: !isPoolGroupId(currentPoolId) && currentPoolId ? currentPoolId : '',
    accountFilter: effectiveExportGameUid ? 'current' : 'all',
    gameUid: effectiveExportGameUid || '',
    dateFrom: '',
    dateTo: '',
  });
  const [showQuickExportMenu, setShowQuickExportMenu] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [quickExportOptions, setQuickExportOptions] = useState(buildDefaultExportOptions);
  const closeQuickExportMenu = () => setShowQuickExportMenu(false);
  const openQuickExportMenu = () => {
    setQuickExportOptions(buildDefaultExportOptions());
    setShowQuickExportMenu(true);
  };
  const updateQuickExportOption = (key, value) => {
    setQuickExportOptions((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  useEffect(() => {
    if (location.state?.openHistoryAnomalies !== true) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setRecordsOpen(true);
      document.getElementById('guide-export-section')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [location.state]);
  const resetQuickExportOptions = () => setQuickExportOptions(buildDefaultExportOptions());
  const buildQuickExportOptions = () => ({
    poolFilter: quickExportOptions.poolFilter,
    poolId: quickExportOptions.poolFilter === 'specific' ? quickExportOptions.poolId || null : null,
    accountFilter: quickExportOptions.accountFilter,
    gameUid: ['current', 'specific'].includes(quickExportOptions.accountFilter)
      ? quickExportOptions.gameUid || null
      : null,
    dateFrom: quickExportOptions.dateFrom,
    dateTo: quickExportOptions.dateTo,
  });
  const canQuickExport =
    (quickExportOptions.poolFilter !== 'specific' || Boolean(quickExportOptions.poolId)) &&
    (quickExportOptions.accountFilter !== 'specific' || Boolean(quickExportOptions.gameUid));
  const runQuickExport = async (handler) => {
    if (!canQuickExport || typeof handler !== 'function') {
      return false;
    }
    return handler(buildQuickExportOptions());
  };

  return (
    <>
      {!user && (
        <div className="mb-8 bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-zinc-900 dark:to-zinc-950 border border-amber-200 dark:border-amber-900/50 rounded-none p-8 text-center">
          <div className="w-16 h-16 bg-endfield-yellow/20 dark:bg-endfield-yellow/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <LogIn size={32} className="text-amber-600 dark:text-endfield-yellow" />
          </div>
          <h3 className="font-bold text-xl text-slate-800 dark:text-zinc-100 mb-3">
            {tt('登录后即可导入抽卡数据', 'Sign in to import your pull history')}
          </h3>
          <p className="text-sm text-slate-600 dark:text-zinc-400 mb-6 max-w-md mx-auto">
            {tt(
              '注册并登录后，您可以导入自己的抽卡记录进行分析。',
              'After you register and sign in, you can import your own pull history for analysis.'
            )}
            <br />
            {tt(
              '数据安全存储在云端，可在任意设备访问。',
              'Your data is stored in the cloud and can be accessed on any device.'
            )}
          </p>
          <p className="text-xs text-slate-400 dark:text-zinc-500 mt-4">
            {tt('已有账号？点击右上角登录', 'Already have an account? Use the top-right sign-in button.')}
          </p>
        </div>
      )}

      {user && canEdit && !canEditCurrentPool && (
        <div className="mb-8 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-none p-6 text-center">
          <Lock size={40} className="mx-auto text-amber-400 mb-3" />
          <h3 className="font-bold text-amber-700 dark:text-amber-400 mb-2">
            {tt('此卡池已被锁定', 'This banner is locked')}
          </h3>
          <p className="text-sm text-amber-600 dark:text-amber-500">
            {tt(
              `卡池「${currentPool?.name}」已被超级管理员锁定，暂时无法编辑。`,
              `Banner "${currentPool?.name}" has been locked by a super admin and cannot be edited right now.`
            )}
            <br />
            {tt('如需修改，请联系超级管理员解锁。', 'Contact a super admin if you need it unlocked.')}
          </p>
        </div>
      )}

      {user && (
        <div className="animate-fade-in">
          <PersonalDataBoundary user={user} onRetry={onRetryPersonalData}>
            <AccountServerLabelNotice ownerId={user.id} />
            <div className="mb-6 border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <PoolSelector
                onOpenImportWizard={openImportWizard}
                onOpenExportOptions={openQuickExportMenu}
              />
            </div>
            <Suspense fallback={<TabPanelFallback label={tt('正在加载卡池分析...', 'Loading banner analysis...')} />}>
              <DashboardView showToast={showToast} />
            </Suspense>

          <div className="mt-6">
            <details
              id="guide-export-section"
              className="group"
              open={recordsOpen}
              onToggle={(event) => setRecordsOpen(event.currentTarget.open)}
            >
              <RecordsSectionTitleBar currentPool={currentPool} />
              {recordsOpen && (
                <div className="mt-2">
                  <Suspense
                    fallback={<TabPanelFallback label={tt('正在加载详细日志...', 'Loading detailed records...')} />}
                  >
                    <RecordsView
                      onEdit={setEditItemState}
                      onDeleteItem={handleDeleteItem}
                      onDeleteGroup={handleDeleteGroup}
                    />
                  </Suspense>
                </div>
              )}
            </details>
          </div>

          {editItemState && (
            <EditItemModal
              item={editItemState}
              pools={pools}
              onClose={() => setEditItemState(null)}
              onUpdate={handleUpdateItem}
              onDelete={handleDeleteItem}
            />
          )}

            <DataExportOptionsModal
              isOpen={showQuickExportMenu}
              onClose={closeQuickExportMenu}
              onReset={resetQuickExportOptions}
              exportOptions={quickExportOptions}
              onUpdateOption={updateQuickExportOption}
              canExport={canQuickExport}
              currentPoolName={exportCurrentPoolName}
              currentGameUid={effectiveExportGameUid}
              poolOptions={exportPoolOptions}
              gameAccounts={exportGameAccounts}
              locale={locale}
              onExportJSON={() => runQuickExport(handleExportJSON)}
              onExportCSV={() => runQuickExport(handleExportCSV)}
              onExportEndfieldGachaUserDataZip={() => runQuickExport(handleExportEndfieldGachaUserDataZip)}
              onExportEndfieldGachaHelperJSON={() => runQuickExport(handleExportEndfieldGachaHelperJSON)}
              onExportEndfieldGachaHelperCSV={() => runQuickExport(handleExportEndfieldGachaHelperCSV)}
              onExportEndfieldGachaHelperUserDataZip={() => runQuickExport(handleExportEndfieldGachaHelperUserDataZip)}
              onExportEndgachaKwerTopPlainJSON={() => runQuickExport(handleExportEndgachaKwerTopPlainJSON)}
              onExportEndgachaKwerTopPlainTXT={() => runQuickExport(handleExportEndgachaKwerTopPlainTXT)}
            />
          </PersonalDataBoundary>
        </div>
      )}
    </>
  );
}
