import React from 'react';
import { usePersonalGameAccounts } from '../../../hooks/app/usePersonalGameAccounts.js';
import { useI18n } from '../../../i18n/index.js';
import { getImportAccountScopeConflicts } from '../../../utils/importAccountScope.js';

export default function ImportAccountScopeNotice({ accounts = [] }) {
  const existing = usePersonalGameAccounts();
  const { isEnglish } = useI18n();
  const conflicts = getImportAccountScopeConflicts(accounts, existing);
  if (!conflicts.length) return null;
  const settings = window.location.pathname.startsWith('/m') ? '/m/settings' : '/settings';
  return <aside role="note" aria-label={isEnglish ? 'Check the import server' : '导入区服提醒'} className="border border-amber-300 bg-amber-50 p-4 text-xs leading-5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
    <strong className="block text-sm">{isEnglish ? 'This UID already has records under another CN server label' : '同一 UID 已有另一国服标签下的记录'}</strong>
    <p className="mt-1">{conflicts.map(item => `UID ${item.gameUid} → ${item.serverId === 'bilibili' ? (isEnglish ? 'Bilibili' : 'B 服') : (isEnglish ? 'CN official' : '官服')}`).join('；')}</p>
    <p className="mt-1">{isEnglish
      ? 'Records stay separate by server. Switching to the imported account can hide older records stored under the other label; it does not delete them. Check both labels in settings, and merge only if they belong to the same game account.'
      : '记录按区服分别保存。导入后切换到本次区服，可能暂时看不到另一标签下的旧记录，旧记录不会因此被删除。请到设置核对；确认是同一个游戏账号后，再使用合并区服。'}</p>
    <a href={settings} target="_blank" rel="noreferrer" className="mt-2 inline-block font-bold underline underline-offset-4">{isEnglish ? 'Check server settings (new tab)' : '核对区服设置（新标签页）'}</a>
  </aside>;
}
