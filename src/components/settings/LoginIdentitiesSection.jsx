import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Github, Link2, Mail, RefreshCw, ShieldCheck, Unlink } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useI18n } from '../../i18n/index.js';
import { useAuthStore } from '../../stores';
import { isUserEmailVerified } from '../../services/accountEmailService.js';
import { emitAuthSessionSync, subscribeAuthSessionSync } from '../../services/authSessionEvents.js';
import { getCurrentSiteSession } from '../../services/siteSessionService.js';
import {
  getIdentityDisplayValue,
  groupAuthIdentities,
  isLoginIdentityProviderAvailable,
  linkLoginIdentity,
  loadAuthIdentities,
  LOGIN_IDENTITY_PROVIDERS,
  unlinkLoginIdentity,
} from '../../services/authIdentityService.js';

function getVisualClasses(variant) {
  if (variant === 'mobile') {
    return {
      wrapper: 'space-y-3',
      card: 'rounded-[1.05rem] border border-zinc-200 bg-zinc-50/75 p-4 dark:border-white/8 dark:bg-white/[0.03]',
      button: 'rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-wider',
      helper: 'text-[10px] text-zinc-500 dark:text-zinc-400',
      status: 'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
    };
  }

  return {
    wrapper: 'space-y-3',
    card: 'border border-zinc-200 bg-zinc-50/70 p-4 rounded-sm dark:border-zinc-800 dark:bg-zinc-950/40',
    button: 'rounded-sm px-3 py-2 text-[11px] font-bold uppercase tracking-widest',
    helper: 'text-[11px] text-zinc-500 dark:text-zinc-400',
    status: 'rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest',
  };
}

function getProviderIcon(providerKey) {
  if (providerKey === 'email') return Mail;
  if (providerKey === 'github') return Github;
  if (providerKey === 'linuxdo') return ShieldCheck;
  return Link2;
}

function getProviderAccent(providerKey) {
  if (providerKey === 'github') return 'text-zinc-700 dark:text-zinc-200';
  if (providerKey === 'linuxdo') return 'text-sky-500';
  if (providerKey === 'email') return 'text-endfield-yellow';
  return 'text-zinc-400';
}

function getErrorMessage(error, t) {
  const raw = String(error?.message || error || '').toLowerCase();
  if (raw.includes('identity_provider_not_ready') || raw.includes('oauth_provider_not_ready')) {
    return t('settings.authIdentity.errorProviderNotReady');
  }
  if (raw.includes('identity_already_exists') || raw.includes('already exists')) {
    return t('settings.authIdentity.errorAlreadyLinked');
  }
  if (raw.includes('at least two') || raw.includes('only identity') || raw.includes('oauth_last_login_method')) {
    return t('settings.authIdentity.errorLastIdentity');
  }
  if (raw.includes('site_session_required')) {
    return t('settings.authIdentity.errorSessionRequired');
  }
  if (raw.includes('supabase_not_configured')) {
    return t('settings.authIdentity.errorUnavailable');
  }
  return error?.message || t('settings.authIdentity.errorAction');
}

function getProviderPendingHint(providerKey, t) {
  if (providerKey === 'linuxdo') {
    return t('settings.authIdentity.linuxdoPendingHint');
  }
  if (providerKey === 'qq') {
    return t('settings.authIdentity.qqPlannedHint');
  }
  return t('settings.authIdentity.providerPendingHint');
}

export default function LoginIdentitiesSection({
  variant = 'desktop',
  emailVerified: emailVerifiedOverride = null,
}) {
  const { t, formatDateTime } = useI18n();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const setUserRole = useAuthStore((state) => state.setUserRole);
  const styles = useMemo(() => getVisualClasses(variant), [variant]);
  const [identities, setIdentities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  const groupedIdentities = useMemo(() => groupAuthIdentities(identities), [identities]);
  const emailVerified = useMemo(
    () => typeof emailVerifiedOverride === 'boolean'
      ? emailVerifiedOverride
      : isUserEmailVerified(user),
    [emailVerifiedOverride, user]
  );
  const identityCount = identities.length + (user?.email && !groupedIdentities.has('email') ? 1 : 0);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!user?.id) {
      setIdentities([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    if (!silent) {
      setError('');
    }

    try {
      const nextIdentities = await loadAuthIdentities();
      setIdentities(nextIdentities);
    } catch (loadError) {
      setError(loadError?.message || t('settings.authIdentity.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [t, user]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!user?.id) {
        if (!cancelled) {
          setIdentities([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError('');
      try {
        const nextIdentities = await loadAuthIdentities();
        if (!cancelled) {
          setIdentities(nextIdentities);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError?.message || t('settings.authIdentity.errorLoad'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [t, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }
    return subscribeAuthSessionSync(() => {
      refresh({ silent: true }).catch(() => null);
    });
  }, [refresh, user?.id]);

  const handleLink = async (providerKey) => {
    setActionLoading(providerKey);
    setError('');
    setSuccess('');
    try {
      await linkLoginIdentity(providerKey, { returnTo });
      setActionLoading('');
    } catch (linkError) {
      setError(getErrorMessage(linkError, t));
      setActionLoading('');
    }
  };

  const handleUnlink = async (providerKey, identity) => {
    if (!identity) return;
    if (identityCount <= 1) {
      setError(t('settings.authIdentity.errorLastIdentity'));
      return;
    }

    const confirmed = window.confirm(t('settings.authIdentity.unlinkConfirm', {
      value: LOGIN_IDENTITY_PROVIDERS[providerKey]?.label || providerKey,
    }));
    if (!confirmed) {
      return;
    }

    setActionLoading(providerKey);
    setError('');
    setSuccess('');
    try {
      await unlinkLoginIdentity(identity);
      const siteSession = await getCurrentSiteSession({
        syncSupabase: true,
        useCache: false,
      }).catch(() => null);
      if (siteSession?.authenticated && siteSession.user) {
        setUser(siteSession.user);
        setUserRole(siteSession.profile?.role || siteSession.user?.profile_role || 'user');
        emitAuthSessionSync({ source: 'login-identity-unlink' });
      }
      await refresh({ silent: true });
      setSuccess(t('settings.authIdentity.unlinkSuccess'));
    } catch (unlinkError) {
      setError(getErrorMessage(unlinkError, t));
    } finally {
      setActionLoading('');
    }
  };

  if (!user) {
    return (
      <div className={styles.card}>
        <div className="flex items-center gap-2 text-zinc-500">
          <ShieldCheck size={14} />
          <span className={styles.helper}>{t('settings.authIdentity.loginRequired')}</span>
        </div>
      </div>
    );
  }

  const providerKeys = ['email', 'github', 'linuxdo', 'qq'];

  return (
    <div className={styles.wrapper}>
      <div className={`${styles.card} space-y-2`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} className="text-endfield-yellow" />
              <h4 className="text-sm font-bold text-slate-800 dark:text-zinc-100">{t('settings.authIdentity.title')}</h4>
            </div>
            <p className={styles.helper}>{t('settings.authIdentity.desc')}</p>
          </div>
          <button
            type="button"
            onClick={() => refresh()}
            disabled={loading}
            className={`${styles.button} border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800`}
            aria-label={t('settings.authIdentity.refresh')}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        {!emailVerified ? (
          <div className="flex items-start gap-2 rounded-sm border border-amber-400/30 bg-amber-500/10 p-3 text-[11px] leading-5 text-amber-700 dark:text-amber-200">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{t('settings.authIdentity.emailVerifyHint')}</span>
          </div>
        ) : null}
        {error ? <div className="text-[11px] text-red-500">{error}</div> : null}
        {success ? <div className="text-[11px] text-emerald-500">{success}</div> : null}
      </div>

      {loading ? (
        <div className={styles.card}>
          <div className={styles.helper}>{t('common.loading')}</div>
        </div>
      ) : providerKeys.map((providerKey) => {
        const meta = LOGIN_IDENTITY_PROVIDERS[providerKey];
        const providerIdentities = groupedIdentities.get(providerKey) || [];
        const identity = providerIdentities[0] || null;
        const isEmail = providerKey === 'email';
        const isLinked = isEmail ? Boolean(user.email) : Boolean(identity);
        const isProviderReady = isLoginIdentityProviderAvailable(providerKey);
        const isPlanned = !isEmail && !isLinked && (Boolean(meta.planned) || !isProviderReady);
        const canUnlink = Boolean(meta.canUnlink && identity);
        const Icon = getProviderIcon(providerKey);
        const displayValue = isEmail ? user.email : getIdentityDisplayValue(identity);
        const statusLabel = isPlanned
          ? t('settings.authIdentity.status.planned')
          : isLinked
            ? isEmail && !emailVerified
              ? t('settings.authIdentity.status.unverified')
              : t('settings.authIdentity.status.linked')
            : t('settings.authIdentity.status.unlinked');
        const statusClass = isPlanned
          ? 'border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400'
          : isLinked
            ? isEmail && !emailVerified
              ? 'border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
              : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : 'border-zinc-200 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400';

        return (
          <div key={providerKey} className={`${styles.card} space-y-3`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Icon size={14} className={getProviderAccent(providerKey)} />
                  <span className="font-bold text-sm text-slate-800 dark:text-zinc-100">{meta.label}</span>
                  <span className={`${styles.status} border ${statusClass}`}>
                    {statusLabel}
                  </span>
                </div>
                <div className={`${styles.helper} mt-1 break-all`}>
                  {displayValue || t('settings.authIdentity.noIdentifier')}
                </div>
              </div>
              {isLinked && !isEmail && !isPlanned ? (
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" />
              ) : null}
            </div>

            {identity?.created_at ? (
              <div className={styles.helper}>
                {t('settings.authIdentity.linkedAt', {
                  value: formatDateTime(identity.created_at, {}, t('common.unknown')),
                })}
              </div>
            ) : null}

            {!isEmail ? (
              <div className="flex flex-wrap gap-2">
                {isPlanned ? (
                  <span className={styles.helper}>{getProviderPendingHint(providerKey, t)}</span>
                ) : isLinked && canUnlink ? (
                  <button
                    type="button"
                    onClick={() => handleUnlink(providerKey, identity)}
                    disabled={actionLoading === providerKey || identityCount <= 1}
                    className={`${styles.button} border border-red-400/30 bg-red-500/10 text-red-500 hover:bg-red-500/15 disabled:opacity-60`}
                  >
                    <Unlink size={12} />
                    {t('settings.authIdentity.unlinkAction')}
                  </button>
                ) : isLinked ? (
                  <span className={styles.helper}>{t('settings.authIdentity.siteManagedHint')}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleLink(providerKey)}
                    disabled={actionLoading === providerKey}
                    className={`${styles.button} border border-endfield-yellow/40 bg-endfield-yellow/10 text-amber-700 hover:bg-endfield-yellow hover:text-black disabled:opacity-60 dark:text-endfield-yellow`}
                  >
                    <Link2 size={12} />
                    {actionLoading === providerKey ? t('settings.integration.processing') : t('settings.authIdentity.linkAction')}
                  </button>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
