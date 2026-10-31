import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowDownToLine, Check, Copy, MessageSquare, Users, UserRound } from 'lucide-react';
import { useAuthStore, usePoolStore } from '../../stores';
import { useCloudSync, usePersonalGameAccounts } from '../../hooks';
import { useI18n } from '../../i18n/index.js';
import { ACCOUNT_RECOVERY_QQ_GROUP, ENGLISH_COMMUNITY_DISCORD_URL } from '../../constants/community.js';
import { characterCache } from '../../utils/characterUtils.js';
import { isGameAccountSelectionMatch, normalizeGameAccountServerId } from '../../utils/gameAccountMetadata.js';
import { isContributorDemoUser } from '../../dev/contributorDemoMode.js';
import { isReservedPoolTypeId } from '../../../shared/poolIdValidation.js';
import WorkbenchAccountEditor from './WorkbenchAccountEditor.jsx';
import WorkbenchDialog from './WorkbenchDialog.jsx';
import WorkbenchBetaBadge from '../import/WorkbenchBetaBadge.jsx';
import { loadWorkbenchRosters } from './workbenchCatalog.js';
import './workbench.css';

const ImportManager = lazy(() => import('../import/ImportManager.jsx'));
const WorkbenchFileImport = lazy(() => import('./WorkbenchFileImport.jsx'));
const ImportMethodDialog = lazy(() => import('../import/ImportMethodDialog.jsx'));
const button = 'wb-button';

export default function DataWorkbenchPage(props) {
  const ownerId = useAuthStore((state) => state.user?.id);
  return <DataWorkbenchContent key={ownerId || 'guest'} {...props} />;
}

function DataWorkbenchContent({ onOpenFileImport, questionnaireReadDelayMs = 15000 }) {
  const location = useLocation();
  const { isEnglish } = useI18n();
  const tt = (zh, en) => (isEnglish ? en : zh);
  const mobile = location.pathname.startsWith('/m/');
  const user = useAuthStore((state) => state.user);
  const openAuthModal = useAuthStore((state) => state.openAuthModal);
  const allPools = usePoolStore((state) => state.pools);
  const currentPoolId = usePoolStore((state) => state.currentPoolId);
  const currentGameUid = usePoolStore((state) => state.currentGameUid);
  const accounts = usePersonalGameAccounts();
  const [accountChoice, setAccountChoice] = useState('');
  const [newScope, setNewScope] = useState({ gameUid: '', serverScope: '' });
  const [accountDialog, setAccountDialog] = useState(false);
  const [confirmedScope, setConfirmedScope] = useState(null);
  const [entities, setEntities] = useState([]);
  const [catalogError, setCatalogError] = useState('');
  const [rosterResult, setRosterResult] = useState(null);
  const [rosterRetry, setRosterRetry] = useState(0);
  const [source, setSource] = useState(() => new URLSearchParams(location.search).get('import') === 'choose' ? 'choose' : '');
  const [dirty, setDirty] = useState(false);
  const [startRequest, setStartRequest] = useState(0);
  const [groupCopyStatus, setGroupCopyStatus] = useState('');
  const { refreshPersonalData } = useCloudSync({ showToast: () => {} });
  const scopes = useMemo(
    () =>
      accounts
        .map((account) => ({
          gameUid: String(account.gameUid || account.game_uid || ''),
          serverScope: String(
            account.serverScope || account.server_scope || normalizeGameAccountServerId(account) || ''
          ),
          name: account.nickName || account.nick_name || account.gameUid,
          serverTag: account.serverTag,
        }))
        .filter((account) => account.gameUid && account.serverScope),
    [accounts]
  );
  const choices = useMemo(() => {
    const available = [...scopes];
    if (
      confirmedScope &&
      !available.some(
        (account) => account.gameUid === confirmedScope.gameUid && account.serverScope === confirmedScope.serverScope
      )
    )
      available.push(confirmedScope);
    return available.map((account) => ({ ...account, key: JSON.stringify([account.gameUid, account.serverScope]) }));
  }, [scopes, confirmedScope]);
  const selectedKey =
    accountChoice ||
    (confirmedScope ? JSON.stringify([confirmedScope.gameUid, confirmedScope.serverScope]) : null) ||
    choices.find((account) => isGameAccountSelectionMatch(account, currentGameUid))?.key ||
    choices[0]?.key ||
    'new';
  const selected = choices.find((account) => account.key === selectedKey);
  const selectedUid = selected?.gameUid;
  const selectedServer = selected?.serverScope;
  const scope = useMemo(
    () => (selectedUid ? { gameUid: selectedUid, serverScope: selectedServer } : confirmedScope),
    [selectedUid, selectedServer, confirmedScope]
  );
  const catalogPools = useMemo(() => (allPools || []).filter(pool => !isReservedPoolTypeId(pool.id) && !String(pool.id).startsWith('group_')), [allPools]);
  const currentRoster = rosterResult?.source === catalogPools && rosterResult.retry === rosterRetry ? rosterResult : null;
  const pools = currentRoster?.pools || catalogPools;
  const rosterError = currentRoster?.error || '';
  const catalogReady = pools.length > 0 && pools.every(pool => Array.isArray(pool.rosterEntityIds)) && !rosterError;
  useEffect(() => {
    let active = true;
    if (!catalogPools.length || catalogPools.every(pool => Array.isArray(pool.rosterEntityIds))) return undefined;
    loadWorkbenchRosters(catalogPools).then(next => { if (active) setRosterResult({ source: catalogPools, retry: rosterRetry, pools: next }); })
      .catch(failure => { if (active) setRosterResult({ source: catalogPools, retry: rosterRetry, error: failure.message }); });
    return () => { active = false; };
  }, [catalogPools, rosterRetry]);

  // Refreshing analysis may temporarily clear its account manifest. Keep the
  // explicitly displayed editing scope until the user chooses another account.
  if (selectedUid && !confirmedScope) {
    setConfirmedScope({ gameUid: selectedUid, serverScope: selectedServer });
  }

  useEffect(() => {
    let active = true;
    characterCache
      .load()
      .then(() => {
        if (active) setEntities(characterCache.getAll());
      })
      .catch(() => {
        if (active) setCatalogError('角色目录加载失败，请刷新后重试。草稿仍可保留。');
      });
    return () => {
      active = false;
    };
  }, []);
  const fileImport = () => {
    if (onOpenFileImport) {
      setSource('');
      onOpenFileImport();
    } else setSource('file');
  };
  const refresh = () => refreshPersonalData(user, { kind: 'mutation', reason: 'data_workbench_saved' });
  const confirmLeave = () =>
    !dirty ||
    window.confirm('尚有待提交草稿或未保存修改。当前变化会按原账号和区服保留 24 小时。确定切换或离开吗？');
  const copyFeedbackGroup = async () => {
    try {
      await navigator.clipboard.writeText(ACCOUNT_RECOVERY_QQ_GROUP);
      setGroupCopyStatus('copied');
    } catch {
      setGroupCopyStatus('failed');
    }
  };
  const accountHeader = <div className="wb-account-bar">
    <label className="wb-account-label">
      <span className="wb-account-icon"><UserRound size={19} /></span>
      <span className="wb-account-caption">游戏账号与区服</span>
      <select className="wb-account-select" aria-label="补录所属账号与区服" value={selectedKey} onChange={event => {
        if (event.target.value === 'new') { setAccountDialog(true); return; }
        if (!confirmLeave()) return;
        setDirty(false); setAccountChoice(event.target.value);
        const next = choices.find(account => account.key === event.target.value);
        setConfirmedScope(next ? { gameUid: next.gameUid, serverScope: next.serverScope } : null);
      }}>
        {choices.map(account => <option key={account.key} value={account.key}>{account.name} · {account.gameUid} · {account.serverTag || account.serverScope}</option>)}
        <option value="new">填写尚无记录的账号</option>
      </select>
    </label>
    <button className="wb-text-button" onClick={() => setAccountDialog(true)}>＋ 添加账号</button>
  </div>;
  return (
    <div
      className={`wb-page ${mobile ? 'wb-page--mobile flex-1 overflow-y-auto' : ''}`}
    >
      <header className="wb-page-header">
        <div className="wb-page-title"><h1>手动导入／修改</h1><WorkbenchBetaBadge /></div>
        <nav className="wb-page-actions" aria-label="导入方式">
          <button className="wb-button" disabled={!user} onClick={() => setSource('choose')}><ArrowDownToLine size={15} /> 选择导入方式</button>
        </nav>
      </header>
      <section className="wb-beta-notice" aria-label={tt('测试版说明与反馈', 'Beta information and feedback')}>
        <div className="wb-beta-copy">
          <p>{tt('此功能正在测试中。遇到识别、数据或操作问题，欢迎提交工单或加群反馈。',
            'This feature is in beta. Report recognition, data or interaction issues through a support ticket or the community.')}</p>
          <small>{tt('反馈时请附上问题截图和操作步骤。', 'Please include a screenshot and the steps to reproduce the issue.')}</small>
        </div>
        <div className="wb-beta-actions">
          <Link className="wb-button" onClick={event => { if (!confirmLeave()) event.preventDefault(); }}
            to={{ pathname: mobile ? '/m/tickets' : '/tickets', search: `?poolId=${encodeURIComponent(currentPoolId || '')}` }}>
            <MessageSquare size={15} />{tt('提交工单', 'Submit a ticket')}
          </Link>
          {isEnglish ? <a className="wb-button" href={ENGLISH_COMMUNITY_DISCORD_URL} target="_blank" rel="noreferrer">
            <Users size={15} />Discord feedback
          </a> : <button type="button" className="wb-button" onClick={copyFeedbackGroup}>
            {groupCopyStatus === 'copied' ? <Check size={15} /> : <Copy size={15} />}
            加群反馈 · QQ {ACCOUNT_RECOVERY_QQ_GROUP}
          </button>}
        </div>
        {!isEnglish && <small className="wb-beta-group-hint" role={groupCopyStatus ? 'status' : undefined}>
          {groupCopyStatus === 'copied' ? '群号已复制，在 QQ 中搜索群号并申请加入即可反馈。'
            : groupCopyStatus === 'failed' ? `复制失败，请在 QQ 中搜索群号 ${ACCOUNT_RECOVERY_QQ_GROUP} 并申请加入。`
              : '点击加群反馈可复制群号，在 QQ 中搜索群号并申请加入。'}
        </small>}
      </section>
      <p className="wb-notice" role="note" aria-label={tt('统计范围说明', 'Statistics eligibility')}>
        {tt('手动修改和已保存的补录会展示在你的个人分析中；资料缺失的数量、出率和保底保留为未知。发生手动添加或修改的账号、区服、卡池整池不参与全服统计。跨池修改排除原池和目标池；删除、重新导入或撤回不会恢复全服统计资格。',
          'Manual edits and saved supplements appear in your personal analysis. Missing counts, rates and pity remain unknown. The affected game account, server and banner are excluded from community statistics. Moving a record excludes both banners; deleting, reimporting or reverting does not restore community eligibility.')}
      </p>
      {!user ? (
        <section className="wb-surface p-6">
          <p>登录后可按账号保存草稿及补录。</p>
          <button className={button} onClick={() => openAuthModal()}>
            登录
          </button>
        </section>
      ) : isContributorDemoUser(user) ? (
        <p className="border p-4">演示账号不写入个人补录，请登录自己的账号使用。</p>
      ) : (
        <section id="manual-workbench" className="wb-manual">
          {!scope && accountHeader}
          {selectedKey === 'new' && !scope && <div className="wb-surface p-6"><p>先选择补录所属的游戏账号与区服。</p><button className="wb-button wb-button--primary" onClick={() => setAccountDialog(true)}>填写账号</button></div>}
          {accountDialog && (
            <WorkbenchDialog title="添加游戏账号" onClose={() => setAccountDialog(false)} description="补录和草稿会按账号、区服分别保存。"
              footer={<>
                <button className="wb-button" onClick={() => setAccountDialog(false)}>取消</button>
                <button className="wb-button wb-button--primary" disabled={!newScope.gameUid.trim() || !newScope.serverScope.trim()}
                  onClick={() => {
                    if (!confirmLeave()) return;
                    const next = { gameUid: newScope.gameUid.trim(), serverScope: newScope.serverScope.trim() };
                    setConfirmedScope(next);
                    setAccountChoice(JSON.stringify([next.gameUid, next.serverScope]));
                    setDirty(false);
                    setAccountDialog(false);
                  }}>确认账号与区服</button>
              </>}>
            <div className="wb-new-account wb-field-grid">
              <label className="text-sm">
                游戏 UID
                <input
                  className="wb-input"
                  maxLength={160}
                  value={newScope.gameUid}
                  onChange={(event) => {
                    setNewScope((previous) => ({ ...previous, gameUid: event.target.value }));
                  }}
                />
              </label>
              <label className="text-sm">
                区服
                <select
                  className="wb-input"
                  value={newScope.serverScope}
                  onChange={(event) => {
                    setNewScope((previous) => ({ ...previous, serverScope: event.target.value }));
                  }}
                >
                  <option value="">请选择</option>
                  <option value="1">国服 · 官方</option>
                  <option value="bilibili">国服 · 哔哩哔哩</option>
                  <option value="2">国际服 · 亚洲</option>
                  <option value="3">国际服 · 欧美</option>
                </select>
              </label>
            </div>
            </WorkbenchDialog>
          )}
          {catalogError && <p role="alert">{catalogError}</p>}
          {rosterError ? <div className="wb-notice" role="alert">{rosterError}<button className="wb-button" onClick={() => setRosterRetry(value => value + 1)}>重新读取卡池名单</button></div>
            : !catalogReady && <p role="status">正在读取完整卡池名单…</p>}
          {scope && (
            <WorkbenchAccountEditor
              key={JSON.stringify([user.id, scope.gameUid, scope.serverScope])}
              ownerId={user.id}
              scope={scope}
              pools={pools}
              entities={entities}
              currentPoolId={currentPoolId}
              onRefresh={refresh}
              onDirtyChange={setDirty}
              accountHeader={accountHeader}
              autoPromptEnabled={!source && !accountDialog && catalogReady}
              catalogReady={catalogReady}
              startRequest={startRequest}
              questionnaireReadDelayMs={questionnaireReadDelayMs}
            />
          )}
        </section>
      )}
      <Suspense fallback={<p role="status">正在加载导入模块…</p>}>
        {source === 'choose' && <ImportMethodDialog onClose={() => setSource('')} onOfficial={() => setSource('official')} onFile={fileImport} onManual={() => { setSource(''); if (!scope) setAccountDialog(true); else setStartRequest(value => value + 1); }} />}
        {source === 'official' && (
          <ImportManager
            isOpen
            onClose={() => setSource('')}
            onImportComplete={refresh}
            onOpenFileImport={fileImport}
          />
        )}
        {source === 'file' && <WorkbenchFileImport onClose={() => setSource('')} />}
      </Suspense>
    </div>
  );
}
