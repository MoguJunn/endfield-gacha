import React from 'react';
import { AlertTriangle, ArrowRight, EyeOff, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePersonalGameAccounts } from '../../hooks/app/usePersonalGameAccounts.js';
import { useI18n } from '../../i18n/index.js';
import usePersonalAnalysisStore from '../../stores/usePersonalAnalysisStore.js';
import {
  getVisibleAccountServerLabelIssues,
  ignoreAccountServerLabelIssues,
} from '../../utils/accountServerLabelNotice.js';

export default function AccountServerLabelNotice({ ownerId, mobile = false }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [dismissed, setDismissed] = React.useState(false);
  const [preferenceRevision, setPreferenceRevision] = React.useState(0);
  const analysisOwnerId = usePersonalAnalysisStore((state) => state.ownerId);
  const availability = usePersonalAnalysisStore((state) => state.availability);
  const accounts = usePersonalGameAccounts();
  const normalizedOwnerId = String(ownerId || '').trim();
  const issues = React.useMemo(() => {
    void preferenceRevision;
    if (
      !normalizedOwnerId
      || analysisOwnerId !== normalizedOwnerId
      || !['ready', 'stale'].includes(availability)
    ) {
      return [];
    }
    return getVisibleAccountServerLabelIssues(normalizedOwnerId, accounts);
  }, [accounts, analysisOwnerId, availability, normalizedOwnerId, preferenceRevision]);

  React.useEffect(() => {
    setDismissed(false);
  }, [normalizedOwnerId]);

  if (dismissed || issues.length === 0) {
    return null;
  }

  const goToSettings = () => navigate(mobile ? '/m/settings' : '/settings', {
    state: {
      scrollTo: 'settings-account-server-labels',
      _ts: Date.now(),
    },
  });

  return (
    <aside
      className={`border border-amber-400/50 bg-amber-50 text-amber-950 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100 ${mobile ? 'mx-4 mb-3 p-3' : 'mb-4 p-4'}`}
      role="status"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle size={mobile ? 18 : 20} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="font-bold">
            {t('dashboard.serverNotice.title')}
          </div>
          <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-200/80">
            {t('dashboard.serverNotice.description', { count: issues.length })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={goToSettings}
              className="inline-flex items-center gap-1.5 bg-amber-500 px-3 py-2 text-xs font-bold text-black transition-colors hover:bg-amber-400"
            >
              {t('dashboard.serverNotice.action')}
              <ArrowRight size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                ignoreAccountServerLabelIssues(normalizedOwnerId, issues);
                setPreferenceRevision((revision) => revision + 1);
              }}
              className="inline-flex items-center gap-1.5 border border-amber-500/40 px-3 py-2 text-xs font-bold transition-colors hover:bg-amber-500/10"
            >
              <EyeOff size={14} />
              {t('dashboard.serverNotice.ignore')}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 p-1 text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-300"
          aria-label={t('dashboard.serverNotice.dismiss')}
          title={t('dashboard.serverNotice.dismiss')}
        >
          <X size={16} />
        </button>
      </div>
    </aside>
  );
}
