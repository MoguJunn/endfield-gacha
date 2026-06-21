import React, { useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Settings, User, Moon, Sun, Monitor, Trash2, Lock, AlertTriangle, X, Smartphone, Globe, ShieldCheck, Layers, Database, Mail, CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import { useAuthStore, useHistoryStore, usePoolStore } from '../stores';
import PlatformSwitcher from './common/PlatformSwitcher';
import LocaleSwitcher from './common/LocaleSwitcher.jsx';
import PlatformBindingsSection from './settings/PlatformBindingsSection.jsx';
import DeveloperApiSection from './settings/DeveloperApiSection.jsx';
import LoginIdentitiesSection from './settings/LoginIdentitiesSection.jsx';
import UsernameEditDialog from './settings/UsernameEditDialog.jsx';
import { useTheme } from '../contexts/ThemeContext';
import { useCloudSync } from '../hooks/app';
import {
  AuthRateLimitError,
  isOAuthAccountCompletionRequired,
  isOAuthPasswordSetupRequired,
  loadAccountSecurityState,
  setupPasswordForOAuthAccount,
  updatePasswordWithCurrentPassword,
} from '../services/accountSecurityService.js';
import {
  AccountEmailActionError,
  isUserEmailVerified,
  requestCurrentEmailVerification,
  requestEmailChange,
  verifyCurrentEmailCode,
} from '../services/accountEmailService.js';
import { deleteOwnAccount } from '../services/selfAccountService';
import { updateOwnUsername } from '../services/accountProfileService.js';
import { finalizeDeletedAccountSession } from '../utils/finalizeDeletedAccountSession';
import {
  buildUsernameHandle,
  getPreferredUsername,
} from '../utils/usernameValidation.js';
import {
  formatFreshnessAbsolute,
  formatFreshnessRelative,
  getFreshnessTone
} from '../utils/dataFreshness.js';
import { getAccountLastImportTimestamp } from '../utils/accountFreshness.js';
import {
  getPrimaryAccountPasswordError,
  isInvalidCurrentPasswordError,
  validateAccountPassword,
} from '../utils/authSecurity.js';
import { useI18n } from '../i18n/index.js';
import {
  getGameAccountSelectionValue,
  isGameAccountSelectionMatch,
  localizeGameAccountServerTag,
} from '../utils/gameAccountMetadata.js';
import {
  ACCOUNT_SERVER_LABEL_OPTIONS,
  updateAccountServerLabel,
} from '../utils/accountServerLabelCorrection.js';

function getFreshnessToneClasses(tone) {
  switch (tone) {
    case 'fresh':
      return 'border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300';
    case 'notice':
      return 'border-amber-500/40 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300';
    case 'stale':
      return 'border-red-500/40 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300';
    default:
      return 'border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400';
  }
}

function getPasswordPolicyMessage(errorCode, t) {
  switch (errorCode) {
    case 'required':
    case 'too_short':
      return t('settings.error.passwordTooShort');
    case 'too_long':
      return t('settings.error.passwordTooLong');
    case 'too_simple':
      return t('settings.error.passwordTooSimple');
    default:
      return t('settings.error.passwordUpdateFailed');
  }
}

function formatSecurityDeadline(value, locale) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(date);
}

function getAccountEmailErrorMessage(error, t) {
  const code = error instanceof AccountEmailActionError ? error.code : error?.code;
  switch (code) {
    case 'current_password_required':
      return t('settings.error.currentPasswordRequired');
    case 'invalid_current_password':
      return t('settings.error.currentPasswordIncorrect');
    case 'new_email_invalid':
    case 'current_email_invalid':
      return t('settings.error.emailInvalid');
    case 'email_unchanged':
      return t('settings.error.emailUnchanged');
    case 'email_already_registered':
      return t('settings.error.emailAlreadyRegistered');
    case 'auth_mail_disabled':
      return t('settings.error.emailMailDisabled');
    case 'mail_kill_switch_enabled':
      return t('settings.error.emailMailPaused');
    case 'mail_event_disabled':
      return t('settings.error.emailEventDisabled');
    case 'mail_domain_paused':
      return t('settings.error.emailDomainPaused');
    default:
      if (error instanceof AccountEmailActionError && error.partial) {
        return t('settings.error.emailChangePartial');
      }
      return error?.message || t('settings.error.emailActionFailed');
  }
}

const SettingsPanel = React.memo(({ onDeleteAllData }) => {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore(state => state.user);
  const setUser = useAuthStore(state => state.setUser);
  const userRole = useAuthStore(state => state.userRole);
  const logout = useAuthStore(state => state.logout);
  const pools = usePoolStore(state => state.pools);
  const currentGameUid = usePoolStore(state => state.currentGameUid);
  const setPools = usePoolStore(state => state.setPools);
  const switchPool = usePoolStore(state => state.switchPool);
  const switchGameAccount = usePoolStore(state => state.switchGameAccount);
  const history = useHistoryStore(state => state.history);
  const getGameAccountsFromHistory = useHistoryStore(state => state.getGameAccountsFromHistory);
  const setHistory = useHistoryStore(state => state.setHistory);
  const { themeMode, setThemeMode } = useTheme();
  const { loadPublicPools } = useCloudSync({ showToast: () => {} });
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteAccountConfirmText, setDeleteAccountConfirmText] = useState('');
  const [deleteAccountPassword, setDeleteAccountPassword] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState('');
  const [deleteAccountSuccess, setDeleteAccountSuccess] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailVerificationLoading, setEmailVerificationLoading] = useState(false);
  const [emailVerificationCode, setEmailVerificationCode] = useState('');
  const [emailVerificationCodeLoading, setEmailVerificationCodeLoading] = useState(false);
  const [emailVerificationSendCount, setEmailVerificationSendCount] = useState(0);
  const [emailVerificationDeferred, setEmailVerificationDeferred] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState('');
  const [emailStatusMessage, setEmailStatusMessage] = useState('');
  const [emailStatusTone, setEmailStatusTone] = useState('success');
  const [serverLabelUpdatingAccount, setServerLabelUpdatingAccount] = useState(null);
  const [serverLabelError, setServerLabelError] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailCurrentPassword, setEmailCurrentPassword] = useState('');
  const [accountSecurityState, setAccountSecurityState] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const deletePhrase = t('settings.deletePhrase');
  const deleteAccountPhrase = t('settings.deleteAccountPhrase');

  const myPools = useMemo(() => {
    if (!pools || !user) return [];
    return pools.filter(pool => pool.user_id === user.id);
  }, [pools, user]);

  const myHistory = useMemo(() => {
    if (!history || !user) return [];
    return history.filter(h => !h.user_id || h.user_id === user.id);
  }, [history, user]);

  const userPoolCount = myPools.length;
  const userHistoryCount = myHistory.length;
  const gameAccounts = useMemo(() => {
    void history;
    return getGameAccountsFromHistory();
  }, [getGameAccountsFromHistory, history]);
  const currentUsername = useMemo(() => getPreferredUsername(user), [user]);
  const currentUsernameHandle = useMemo(() => buildUsernameHandle(user), [user]);
  const emailVerificationRequired = userRole !== 'super_admin' && Boolean(accountSecurityState?.emailVerificationRequired);
  const emailVerified = useMemo(
    () => isUserEmailVerified(user, { emailVerificationRequired }),
    [emailVerificationRequired, user]
  );
  const pendingEmailChange = user?.new_email || null;
  const passwordChangeRequired = Boolean(accountSecurityState?.passwordChangeRequired);
  const oauthPasswordSetupRequired = isOAuthPasswordSetupRequired(accountSecurityState);
  const oauthAccountCompletionRequired = isOAuthAccountCompletionRequired(accountSecurityState);
  const accountCompletionSteps = useMemo(() => {
    if (!oauthAccountCompletionRequired) {
      return [];
    }
    return [
      {
        key: 'email',
        done: emailVerified,
        label: emailVerified ? t('settings.accountCompletion.emailDone') : t('settings.accountCompletion.emailTodo'),
      },
      {
        key: 'password',
        done: !oauthPasswordSetupRequired,
        label: !oauthPasswordSetupRequired ? t('settings.accountCompletion.passwordDone') : t('settings.accountCompletion.passwordTodo'),
      },
    ];
  }, [emailVerified, oauthAccountCompletionRequired, oauthPasswordSetupRequired, t]);
  const passwordChangeExpiresAt = useMemo(
    () => formatSecurityDeadline(accountSecurityState?.expiresAt, locale),
    [accountSecurityState?.expiresAt, locale]
  );

  React.useEffect(() => {
    let cancelled = false;

    if (!user?.id) {
      setAccountSecurityState(null);
      return () => {
        cancelled = true;
      };
    }

    loadAccountSecurityState()
      .then((state) => {
        if (!cancelled) {
          setAccountSecurityState(state || null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccountSecurityState(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  React.useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const verificationStatus = searchParams.get('email_verification');
    if (!verificationStatus) {
      return;
    }

    if (verificationStatus === 'success') {
      showEmailStatus(t('settings.success.emailVerifiedByLink'), 'success');
      setAccountSecurityState((prev) => ({
        ...(prev || {}),
        emailVerificationRequired: false,
        emailVerificationVerifiedAt: new Date().toISOString(),
      }));
    } else {
      const reason = searchParams.get('reason') || '';
      showEmailStatus(
        reason === 'token_expired'
          ? t('settings.error.emailVerificationLinkExpired')
          : t('settings.error.emailVerificationLinkFailed'),
        'error'
      );
    }

    searchParams.delete('email_verification');
    searchParams.delete('reason');
    const nextSearch = searchParams.toString();
    navigate({
      pathname: location.pathname,
      search: nextSearch ? `?${nextSearch}` : '',
    }, { replace: true });
  }, [location.pathname, location.search, navigate, t]);

  const handleDeleteAllData = async () => {
    if (deleteConfirmText !== deletePhrase) return;
    setDeleteLoading(true);
    try {
      await onDeleteAllData();
      setShowDeleteAllModal(false);
      setDeleteConfirmText('');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleAccountServerLabelChange = async (account, nextServerId) => {
    const accountValue = getGameAccountSelectionValue(account) || account?.gameUid || account?.game_uid;
    setServerLabelError('');
    setServerLabelUpdatingAccount(accountValue);
    try {
      await updateAccountServerLabel({
        account,
        nextServerId,
        history,
        setHistory,
        currentGameUid,
        switchGameAccount,
      });
    } catch (error) {
      setServerLabelError(t('settings.serverLabelUpdateFailed', { message: error?.message || t('common.unknown') }));
    } finally {
      setServerLabelUpdatingAccount(null);
    }
  };

  const resetDeleteAccountModalState = () => {
    setDeleteAccountConfirmText('');
    setDeleteAccountPassword('');
    setDeleteAccountError('');
    setDeleteAccountSuccess('');
  };

  const handleDeleteAccount = async () => {
    if (!user) {
      setDeleteAccountError(t('settings.error.notLoggedInDeleteAccount'));
      return;
    }
    if (deleteAccountConfirmText !== deleteAccountPhrase) {
      setDeleteAccountError(t('settings.error.confirmDeleteAccount'));
      return;
    }
    if (deleteAccountPassword.length < 6) {
      setDeleteAccountError(t('settings.error.currentPasswordRequired'));
      return;
    }
    setDeleteAccountError('');
    setDeleteAccountSuccess('');
    setDeleteAccountLoading(true);
    try {
      await deleteOwnAccount(deleteAccountPassword);
      setDeleteAccountSuccess(t('settings.success.deleteAccount'));
      await finalizeDeletedAccountSession({
        loadPublicPools, setPools, setHistory, switchPool, switchGameAccount, logout,
      });
      navigate('/', { replace: true });
    } catch (error) {
      setDeleteAccountError(error.message || t('settings.error.deleteAccountFailed'));
    } finally {
      setDeleteAccountLoading(false);
    }
  };

  const resetPasswordModalState = () => {
    setPasswordError('');
    setPasswordSuccess('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
  };

  const handlePasswordReset = async () => {
    if (!user) {
      setPasswordError(t('settings.error.notLoggedInPassword'));
      return;
    }

    if (!oauthPasswordSetupRequired && !currentPassword) {
      setPasswordError(t('settings.error.currentPasswordRequired'));
      return;
    }

    const passwordValidation = validateAccountPassword(newPassword);
    if (!passwordValidation.isValid) {
      setPasswordError(getPasswordPolicyMessage(getPrimaryAccountPasswordError(passwordValidation), t));
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setPasswordError(t('settings.error.passwordMismatch'));
      return;
    }
    setPasswordError('');
    setPasswordSuccess('');
    setPasswordLoading(true);
    try {
      const passwordResult = oauthPasswordSetupRequired
        ? await setupPasswordForOAuthAccount({ newPassword })
        : await updatePasswordWithCurrentPassword({
          email: user.email,
          currentPassword,
          newPassword,
        });
      if (passwordResult?.state) {
        setAccountSecurityState(passwordResult.state);
      } else if (passwordResult?.securityStateUpdated) {
        setAccountSecurityState((prev) => ({
          ...(prev || {}),
          passwordChangeRequired: false,
        }));
      }
      setPasswordSuccess(
        passwordResult?.securityStateError
          ? t('settings.warning.passwordStateClearFailed')
          : t('settings.success.passwordUpdated')
      );
      setTimeout(() => {
        setShowPasswordModal(false);
        resetPasswordModalState();
      }, 2000);
    } catch (error) {
      if (error instanceof AuthRateLimitError) {
        const retryMinutes = Math.max(1, Math.ceil(Number(error.retryAfter || 60) / 60));
        setPasswordError(t('settings.error.passwordChangeRateLimited', { minutes: retryMinutes }));
      } else if (isInvalidCurrentPasswordError(error)) {
        setPasswordError(t('settings.error.currentPasswordIncorrect'));
      } else {
        setPasswordError(
          error?.code === 'verified_email_required'
            ? t('settings.error.verifiedEmailRequiredForPassword')
            : error.message || t('settings.error.passwordUpdateFailed')
        );
      }
    } finally {
      setPasswordLoading(false);
    }
  };

  const resetEmailModalState = () => {
    setEmailError('');
    setEmailSuccess('');
    setNewEmail('');
    setEmailCurrentPassword('');
  };

  const showEmailStatus = (message, tone = 'success') => {
    setEmailStatusMessage(message);
    setEmailStatusTone(tone);
  };

  const handleVerifyEmail = async () => {
    if (!user) {
      showEmailStatus(t('settings.error.notLoggedInEmail'), 'error');
      return;
    }

    setEmailVerificationLoading(true);
    setEmailStatusMessage('');
    try {
      const result = await requestCurrentEmailVerification({ locale });
      const status = result?.data?.status;
      setEmailVerificationCode('');
      if (status !== 'already_verified') {
        setEmailVerificationSendCount((prev) => prev + 1);
        setEmailVerificationDeferred(false);
      }
      showEmailStatus(
        status === 'already_verified'
          ? t('settings.success.emailAlreadyVerified')
          : t('settings.success.emailVerificationSent'),
        'success'
      );
    } catch (error) {
      showEmailStatus(getAccountEmailErrorMessage(error, t), 'error');
    } finally {
      setEmailVerificationLoading(false);
    }
  };

  const handleVerifyEmailCode = async () => {
    if (!user) {
      showEmailStatus(t('settings.error.notLoggedInEmail'), 'error');
      return;
    }

    const code = String(emailVerificationCode || '').replace(/\D/g, '').slice(0, 6);
    if (code.length !== 6) {
      showEmailStatus(t('settings.error.emailVerificationCodeInvalid'), 'error');
      return;
    }

    setEmailVerificationCodeLoading(true);
    setEmailStatusMessage('');
    try {
      await verifyCurrentEmailCode({ code });
      setEmailVerificationCode('');
      setEmailVerificationSendCount(0);
      setEmailVerificationDeferred(false);
      setAccountSecurityState((prev) => ({
        ...(prev || {}),
        emailVerificationRequired: false,
        emailVerificationVerifiedAt: new Date().toISOString(),
      }));
      showEmailStatus(t('settings.success.emailVerificationCodeVerified'), 'success');
    } catch (error) {
      const codeValue = error instanceof AccountEmailActionError ? error.code : error?.code;
      showEmailStatus(
        codeValue === 'code_expired'
          ? t('settings.error.emailVerificationCodeExpired')
          : t('settings.error.emailVerificationCodeFailed'),
        'error'
      );
    } finally {
      setEmailVerificationCodeLoading(false);
    }
  };

  const handleEmailChangeRequest = async () => {
    if (!user) {
      setEmailError(t('settings.error.notLoggedInEmail'));
      return;
    }

    if (!newEmail.trim()) {
      setEmailError(t('settings.error.emailInvalid'));
      return;
    }

    if (!oauthPasswordSetupRequired && !emailCurrentPassword) {
      setEmailError(t('settings.error.currentPasswordRequired'));
      return;
    }

    setEmailError('');
    setEmailSuccess('');
    setEmailLoading(true);
    try {
      const result = await requestEmailChange({
        newEmail,
        currentPassword: emailCurrentPassword,
        locale,
      });
      const successMessage = result?.data?.dryRun
        ? t('settings.success.emailChangeDryRun')
        : t('settings.success.emailChangeRequested');
      setEmailSuccess(successMessage);
      showEmailStatus(successMessage, 'success');
      setTimeout(() => {
        setShowEmailModal(false);
        resetEmailModalState();
      }, 2400);
    } catch (error) {
      setEmailError(getAccountEmailErrorMessage(error, t));
    } finally {
      setEmailLoading(false);
    }
  };

  const handleUsernameSubmit = async (normalizedUsername) => {
    if (!user) {
      throw new Error(t('settings.error.notLoggedInUsername'));
    }

    const updatedUser = await updateOwnUsername(user, normalizedUsername);
    setUser(updatedUser);
  };

  const getRoleInfo = (role) => {
    switch (role) {
      case 'super_admin':
        return { label: t('settings.role.super_admin.label'), color: 'bg-red-500/10 text-red-600 border-red-500/30' };
      case 'admin':
        return { label: t('settings.role.admin.label'), color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' };
      default:
        return { label: t('settings.role.user.label'), color: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30' };
    }
  };

  const roleInfo = getRoleInfo(userRole);

  return (
    <div className="space-y-4 animate-fade-in pb-8">
      {/* 页面标题 */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 sm:p-5 flex items-center justify-between shadow-sm relative overflow-hidden rounded-sm">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.02)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none"></div>
        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-endfield-yellow"></div>
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-400 rounded-sm">
            <Settings size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-zinc-100 tracking-wider uppercase">{t('settings.pageTitle')}</h2>
            <p className="text-[10px] text-zinc-500 font-mono mt-0.5 tracking-widest uppercase">{t('settings.pageSubtitle')}</p>
          </div>
        </div>
      </div>

      {/* Grid: 账户信息 & 偏好设置 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* 账户信息 */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 relative flex flex-col rounded-sm">
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2 bg-zinc-50/50 dark:bg-zinc-950/50">
            <ShieldCheck size={14} className="text-zinc-500" />
            <h3 className="font-bold text-xs text-zinc-600 dark:text-zinc-300 uppercase tracking-widest">{t('settings.accountSection')}</h3>
          </div>
          <div className="p-4 flex-1">
            {user ? (
              <div className="space-y-4">
                {oauthAccountCompletionRequired && (
                  <div className="border border-amber-300 bg-amber-50 px-3 py-3 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200 rounded-sm">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1 space-y-3">
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider">
                            {t('settings.accountCompletion.title')}
                          </div>
                          <div className="mt-1 text-[11px] leading-5">
                            {t('settings.accountCompletion.desc')}
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {accountCompletionSteps.map((step) => (
                            <div
                              key={step.key}
                              className={`flex items-center gap-2 border px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm ${
                                step.done
                                  ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                  : 'border-amber-400/40 bg-white/70 text-amber-800 dark:bg-zinc-950/40 dark:text-amber-200'
                              }`}
                            >
                              {step.done ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                              <span>{step.label}</span>
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {!emailVerified && (
                            <button
                              type="button"
                              onClick={() => { resetEmailModalState(); setShowEmailModal(true); }}
                              className="flex items-center justify-center gap-2 px-3 py-2 bg-white hover:bg-amber-50 dark:bg-zinc-950 dark:hover:bg-amber-900/20 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 text-xs font-bold tracking-wider transition-all uppercase rounded-sm"
                            >
                              <Mail size={14} /> {t('settings.accountCompletion.bindEmailAction')}
                            </button>
                          )}
                          {oauthPasswordSetupRequired && (
                            <button
                              type="button"
                              onClick={() => { resetPasswordModalState(); setShowPasswordModal(true); }}
                              disabled={!emailVerified}
                              className="flex items-center justify-center gap-2 px-3 py-2 bg-endfield-yellow hover:bg-yellow-400 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 text-black disabled:text-zinc-400 border border-endfield-yellow text-xs font-bold tracking-wider transition-all uppercase rounded-sm disabled:cursor-not-allowed"
                            >
                              <Lock size={14} /> {t('settings.accountCompletion.setPasswordAction')}
                            </button>
                          )}
                        </div>
                        {oauthPasswordSetupRequired && !emailVerified && (
                          <div className="text-[10px] leading-4 text-amber-700 dark:text-amber-300">
                            {t('settings.accountCompletion.passwordLockedHint')}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                <div className="border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 px-3 py-3 rounded-sm space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
                        <Mail size={14} /> {t('settings.email')}
                      </div>
                      <div className="mt-1 font-bold text-sm text-slate-800 dark:text-zinc-200 truncate max-w-[240px]">
                        {user.email}
                      </div>
                    </div>
                    <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold border font-mono tracking-widest uppercase rounded-sm ${
                      emailVerified
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                        : 'border-amber-500/40 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
                    }`}>
                      {emailVerified ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                      {emailVerified ? t('settings.emailVerified') : t('settings.emailUnverified')}
                    </span>
                  </div>
                  {pendingEmailChange && (
                    <div className="text-[11px] text-amber-700 dark:text-amber-300 leading-5">
                      {t('settings.pendingEmailChange', { value: pendingEmailChange })}
                    </div>
                  )}
                  {emailVerificationRequired && (
                    <div className="text-[11px] text-amber-700 dark:text-amber-300 leading-5">
                      {t('settings.emailVerificationRequired')}
                    </div>
                  )}
                  {!emailVerified && (
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-5">
                      {t('settings.emailVerificationReminder')}
                    </div>
                  )}
                  {emailStatusMessage && (
                    <div className={`px-3 py-2 rounded-sm text-xs border ${
                      emailStatusTone === 'error'
                        ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400'
                        : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50 text-emerald-600 dark:text-emerald-400'
                    }`}>
                      {emailStatusMessage}
                    </div>
                  )}
                  <div className={`grid grid-cols-1 gap-2 ${emailVerified ? '' : 'sm:grid-cols-2'}`}>
                    {!emailVerified && (
                      <button
                        type="button"
                        onClick={handleVerifyEmail}
                        disabled={emailVerificationLoading}
                        className="flex items-center justify-center gap-2 px-3 py-2 bg-white hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 text-xs font-bold tracking-wider transition-all uppercase rounded-sm disabled:opacity-60"
                      >
                        <Mail size={14} /> {emailVerificationLoading ? t('settings.emailVerificationSending') : t('settings.verifyEmail')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { resetEmailModalState(); setShowEmailModal(true); }}
                      className="flex items-center justify-center gap-2 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 border border-zinc-900 dark:border-zinc-100 text-xs font-bold tracking-wider transition-all uppercase rounded-sm"
                    >
                      <Mail size={14} /> {t('settings.changeEmail')}
                    </button>
                  </div>
                  {!emailVerified && (
                    <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-sm p-3 space-y-2">
                      <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                        <KeyRound size={13} /> {t('settings.emailVerificationCode')}
                      </label>
                      {emailVerificationSendCount > 0 && (
                        <div className="text-[10px] leading-4 text-amber-700 dark:text-amber-300">
                          {t('settings.emailVerificationSendCount', { count: emailVerificationSendCount })}
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={6}
                          value={emailVerificationCode}
                          onChange={(event) => setEmailVerificationCode(String(event.target.value || '').replace(/\D/g, '').slice(0, 6))}
                          placeholder="000000"
                          className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-100 rounded-sm text-center font-mono tracking-[0.28em] outline-none focus:ring-1 focus:ring-endfield-yellow focus:border-endfield-yellow"
                        />
                        <button
                          type="button"
                          onClick={handleVerifyEmailCode}
                          disabled={emailVerificationCodeLoading || emailVerificationCode.length !== 6}
                          className="flex items-center justify-center gap-2 px-3 py-2 bg-endfield-yellow hover:bg-yellow-400 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 text-black disabled:text-zinc-400 text-xs font-bold tracking-wider transition-all uppercase rounded-sm disabled:cursor-not-allowed"
                        >
                          {emailVerificationCodeLoading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                          {t('settings.verifyEmailCode')}
                        </button>
                      </div>
                      <p className="text-[10px] leading-4 text-zinc-500 dark:text-zinc-500">
                        {t('settings.emailVerificationCodeHint')}
                      </p>
                      {emailVerificationSendCount >= 2 && !emailVerificationDeferred && (
                        <div className="border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-500/10 px-3 py-2 text-[10px] leading-4 text-amber-800 dark:text-amber-200">
                          <p>{t('settings.emailVerificationDeferHint')}</p>
                          <button
                            type="button"
                            onClick={() => {
                              setEmailVerificationDeferred(true);
                              showEmailStatus(t('settings.emailVerificationDeferred'), 'success');
                            }}
                            className="mt-2 w-full px-3 py-2 border border-amber-300 dark:border-amber-700 bg-white dark:bg-zinc-950 text-amber-800 dark:text-amber-200 font-bold uppercase tracking-wider rounded-sm hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                          >
                            {t('settings.emailVerificationDeferAction')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 px-3 py-3 rounded-sm space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
                      <User size={14} /> {t('settings.username')}
                    </div>
                    <span className="font-bold text-sm text-slate-800 dark:text-zinc-200 truncate">{currentUsernameHandle}</span>
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {t('settings.usernameDialogDesc')}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowUsernameModal(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 border border-zinc-900 dark:border-zinc-100 text-xs font-bold tracking-wider transition-all uppercase rounded-sm disabled:opacity-60"
                  >
                    <User size={14} /> {t('settings.changeUsername')}
                  </button>
                </div>

                <div className="flex items-center justify-between border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 px-3 py-2 rounded-sm">
                  <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
                    <Lock size={14} /> {t('settings.role')}
                  </div>
                  <span className={`px-2 py-0.5 text-[10px] font-bold border font-mono tracking-widest uppercase rounded-sm ${roleInfo.color}`}>
                    {roleInfo.label}
                  </span>
                </div>

                {passwordChangeRequired && (
                  <div className="border border-amber-300 bg-amber-50 px-3 py-3 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200 rounded-sm">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                      <div className="min-w-0 space-y-1">
                        <div className="text-xs font-bold uppercase tracking-wider">
                          {t('settings.passwordChangeRequiredTitle')}
                        </div>
                        <div className="text-[11px] leading-5">
                          {oauthPasswordSetupRequired
                            ? t('settings.oauthPasswordSetupRequiredDesc')
                            : passwordChangeExpiresAt
                              ? t('settings.passwordChangeRequiredDescWithExpiry', { value: passwordChangeExpiresAt })
                              : t('settings.passwordChangeRequiredDesc')}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <button
                    onClick={() => { resetPasswordModalState(); setShowPasswordModal(true); }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-endfield-yellow/10 hover:bg-endfield-yellow text-amber-700 dark:text-endfield-yellow hover:text-black border border-endfield-yellow/50 text-xs font-bold tracking-wider transition-all uppercase rounded-sm"
                  >
                    <Lock size={14} /> {oauthPasswordSetupRequired ? t('settings.setPassword') : t('settings.changePassword')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-zinc-400 py-6">
                <User size={32} className="mb-2 opacity-50" />
                <span className="text-xs font-mono">{t('settings.loginRequired')}</span>
              </div>
            )}
          </div>
        </div>

        {/* 偏好设置 (Theme, Lang, Platform) */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 relative flex flex-col rounded-sm">
           <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2 bg-zinc-50/50 dark:bg-zinc-950/50">
            <Monitor size={14} className="text-zinc-500" />
            <h3 className="font-bold text-xs text-zinc-600 dark:text-zinc-300 uppercase tracking-widest">{t('settings.appearanceSection')} / PREFERENCES</h3>
          </div>
          <div className="p-4 flex-1 flex flex-col justify-between gap-4">

            {/* Theme */}
            <div>
              <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-1"><Sun size={12}/> {t('settings.appearanceSection')}</div>
              <div className="flex gap-2 bg-zinc-50 dark:bg-zinc-950/50 p-1 border border-zinc-200 dark:border-zinc-800 rounded-sm">
                {[
                  { id: 'light', icon: Sun, label: t('settings.theme.light') },
                  { id: 'dark', icon: Moon, label: t('settings.theme.dark') },
                  { id: 'system', icon: Monitor, label: t('settings.theme.system') }
                ].map(tObj => {
                  const isActive = themeMode === tObj.id;
                  return (
                    <button
                      key={tObj.id}
                      onClick={() => setThemeMode(tObj.id)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold font-mono uppercase transition-colors rounded-sm ${
                        isActive ? 'bg-white dark:bg-zinc-800 text-endfield-yellow shadow-sm border border-zinc-200 dark:border-zinc-700' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                    >
                      <tObj.icon size={12} className={isActive ? 'text-endfield-yellow' : ''} />
                      <span className={isActive ? 'text-slate-800 dark:text-white' : ''}>{tObj.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Language */}
              <div>
                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-1"><Globe size={12}/> {t('settings.languageSection')}</div>
                <LocaleSwitcher />
              </div>

              {/* Platform */}
              <div>
                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-1"><Smartphone size={12}/> {t('settings.platformSection')}</div>
                <PlatformSwitcher className="w-full" />
              </div>
            </div>

          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 relative rounded-sm">
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2 bg-zinc-50/50 dark:bg-zinc-950/50">
            <KeyRound size={14} className="text-zinc-500" />
            <h3 className="font-bold text-xs text-zinc-600 dark:text-zinc-300 uppercase tracking-widest">
              {t('settings.authIdentity.title')}
            </h3>
          </div>
          <div className="p-4">
            <LoginIdentitiesSection />
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 relative rounded-sm">
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2 bg-zinc-50/50 dark:bg-zinc-950/50">
            <ShieldCheck size={14} className="text-zinc-500" />
            <h3 className="font-bold text-xs text-zinc-600 dark:text-zinc-300 uppercase tracking-widest">
              {t('settings.integration.bindingsTitle')}
            </h3>
          </div>
          <div className="p-4">
            <PlatformBindingsSection />
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 relative rounded-sm">
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2 bg-zinc-50/50 dark:bg-zinc-950/50">
            <Globe size={14} className="text-zinc-500" />
            <h3 className="font-bold text-xs text-zinc-600 dark:text-zinc-300 uppercase tracking-widest">
              {t('settings.integration.apiTitle')}
            </h3>
          </div>
          <div className="p-4">
            <DeveloperApiSection />
          </div>
        </div>
      </div>

      {/* 数据管理 */}
      {user && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 relative rounded-sm">
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2 bg-zinc-50/50 dark:bg-zinc-950/50">
            <Database size={14} className="text-zinc-500" />
            <h3 className="font-bold text-xs text-zinc-600 dark:text-zinc-300 uppercase tracking-widest">{t('settings.dataSection')}</h3>
          </div>

          <div className="p-4 lg:p-5">
            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800 p-3 rounded-sm flex justify-between items-center relative overflow-hidden group">
                <div className="absolute -right-2 -bottom-2 opacity-5 text-zinc-800 group-hover:scale-110 transition-transform"><Layers size={48} /></div>
                <div>
                  <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-0.5">{t('settings.createdPools')}</div>
                  <div className="text-2xl font-black font-mono text-slate-800 dark:text-zinc-100">{userPoolCount}</div>
                </div>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800 p-3 rounded-sm flex justify-between items-center relative overflow-hidden group">
                <div className="absolute -right-2 -bottom-2 opacity-5 text-zinc-800 group-hover:scale-110 transition-transform"><Database size={48} /></div>
                <div>
                  <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-0.5">{t('settings.historyRecords')}</div>
                  <div className="text-2xl font-black font-mono text-slate-800 dark:text-zinc-100">{userHistoryCount}</div>
                </div>
              </div>
            </div>

            {/* Imported Accounts Freshness */}
            <div className="mb-6">
              <div className="text-xs font-bold text-slate-700 dark:text-zinc-300 mb-3">{t('settings.importFreshnessTitle')}</div>
              <div className="mb-3 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                {t('settings.serverLabelHint')}
              </div>
              {serverLabelError && (
                <div className="mb-3 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-[10px] text-red-600 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
                  {serverLabelError}
                </div>
              )}
              {gameAccounts.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {gameAccounts.map((account) => {
                    const accountValue = getGameAccountSelectionValue(account);
                    const isCurrentAccount = isGameAccountSelectionMatch(account, currentGameUid);
                    const isUpdatingServerLabel = serverLabelUpdatingAccount === accountValue;

                    return (
                    <div
                      key={accountValue || account.gameUid}
                      className={`border p-3 rounded-sm flex flex-col justify-between ${
                        isCurrentAccount
                          ? 'border-endfield-yellow bg-endfield-yellow/5'
                          : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/30'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-sm text-zinc-800 dark:text-zinc-100 truncate max-w-[120px]">{account.nickName}</span>
                            {account.serverTag && (
                              <span className="px-1 py-0.5 text-[9px] font-bold rounded-sm bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                                {localizeGameAccountServerTag(account.serverTag, locale)}
                              </span>
                            )}
                            {isCurrentAccount && (
                              <span className="px-1 py-0.5 text-[9px] font-bold bg-endfield-yellow/15 text-amber-700 dark:text-endfield-yellow rounded-sm border border-endfield-yellow/30">
                                CURRENT
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-zinc-500 mt-0.5">UID: {account.gameUid}</div>
                          <label className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                            <span>{t('settings.serverLabel')}</span>
                            <select
                              value={account.serverId || account.server_id || ''}
                              disabled={isUpdatingServerLabel}
                              onChange={(event) => handleAccountServerLabelChange(account, event.target.value)}
                              className="rounded-sm border border-zinc-200 bg-white px-2 py-1 text-[10px] font-bold text-zinc-700 outline-none disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                            >
                              <option value="" disabled>{t('settings.serverLabelUnknown')}</option>
                              {ACCOUNT_SERVER_LABEL_OPTIONS.map((option) => (
                                <option key={option.serverId} value={option.serverId}>{t(option.labelKey)}</option>
                              ))}
                            </select>
                            {isUpdatingServerLabel && <span>{t('settings.serverLabelUpdating')}</span>}
                          </label>
                        </div>
                        <div className={`px-1.5 py-0.5 text-[9px] font-bold border rounded-sm whitespace-nowrap shrink-0 ${getFreshnessToneClasses(getFreshnessTone(getAccountLastImportTimestamp(account)))}`}>
                          {formatFreshnessRelative(getAccountLastImportTimestamp(account), t('common.importTimeUnknown'), locale)}
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-[10px] font-mono text-zinc-500 border-t border-zinc-100 dark:border-zinc-800/50 pt-2">
                         <div className="truncate"><span className="text-zinc-400">PULLS:</span> {account.recordCount}</div>
                         <div className="truncate"><span className="text-zinc-400">LATEST:</span> {formatFreshnessAbsolute(account.latestRecordAt, t('common.unknown'), locale, { includeYear: false })}</div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              ) : (
                <div className="border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/30 px-4 py-6 text-center text-xs font-mono text-zinc-500 rounded-sm">
                  {t('settings.noImportedAccounts')}
                </div>
              )}
            </div>

            {/* Danger Zone */}
            <div className="border border-red-200 dark:border-red-900/30 bg-red-50/30 dark:bg-red-950/10 rounded-sm p-4">
              <h4 className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-3 flex items-center gap-1"><AlertTriangle size={12}/> DANGER ZONE</h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Delete Data */}
                <div className="bg-white dark:bg-zinc-900 border border-red-100 dark:border-red-900/50 p-3 flex flex-col justify-between rounded-sm">
                  <div>
                    <div className="font-bold text-xs text-red-600 dark:text-red-400 mb-1">{t('settings.deleteDataTitle')}</div>
                    <div className="text-[10px] text-zinc-500 leading-tight mb-3">{t('settings.deleteDataDesc')}</div>
                  </div>
                  <button
                    onClick={() => setShowDeleteAllModal(true)}
                    disabled={userPoolCount === 0 && userHistoryCount === 0}
                    className="w-full flex justify-center items-center gap-2 px-3 py-1.5 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 border border-red-200 dark:border-red-800/50 disabled:bg-zinc-100 dark:disabled:bg-zinc-900 disabled:border-zinc-200 dark:disabled:border-zinc-800 disabled:text-zinc-400 text-red-600 dark:text-red-400 text-[10px] font-bold tracking-wider transition-colors disabled:cursor-not-allowed rounded-sm uppercase"
                  >
                    <Trash2 size={12} /> {t('settings.deleteMyData')}
                  </button>
                </div>

                {/* Delete Account */}
                <div className="bg-white dark:bg-zinc-900 border border-red-100 dark:border-red-900/50 p-3 flex flex-col justify-between rounded-sm">
                  <div>
                    <div className="font-bold text-xs text-red-600 dark:text-red-400 mb-1">{t('settings.deleteAccountTitle')}</div>
                    <div className="text-[10px] text-zinc-500 leading-tight mb-3">{t('settings.deleteAccountDesc')}</div>
                  </div>
                  <div className="flex flex-col gap-2">
                     <button
                        onClick={() => { resetDeleteAccountModalState(); setShowDeleteAccountModal(true); }}
                        disabled={userRole === 'admin' || userRole === 'super_admin'}
                        className="w-full flex justify-center items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 text-white disabled:text-zinc-400 text-[10px] font-bold tracking-wider transition-colors disabled:cursor-not-allowed rounded-sm uppercase border border-red-700 disabled:border-transparent"
                      >
                        <Trash2 size={12} /> {t('settings.confirmDeleteAccountAction')}
                      </button>
                      {(userRole === 'admin' || userRole === 'super_admin') && (
                        <div className="text-[9px] text-zinc-500 text-center leading-tight">
                          {t('settings.adminDeleteAccountHint')}
                        </div>
                      )}
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      <UsernameEditDialog
        open={showUsernameModal}
        onClose={() => setShowUsernameModal(false)}
        user={user}
        currentUsername={currentUsername}
        currentUsernameHandle={currentUsernameHandle}
        onSubmit={handleUsernameSubmit}
      />

      {/* Modals remain structurally similar, just updated dark mode classes slightly for consistency */}
      {/* 更换邮箱弹窗 */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white dark:bg-zinc-900 rounded-sm shadow-2xl w-full max-w-sm overflow-hidden animate-scale-up border border-zinc-200 dark:border-zinc-800">
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 flex justify-between items-center">
              <h3 className="font-bold text-sm text-slate-700 dark:text-zinc-200 flex items-center gap-2 uppercase tracking-wide">
                <Mail size={16} className="text-endfield-yellow" />
                {t('settings.emailModalTitle')}
              </h3>
              <button onClick={() => { setShowEmailModal(false); resetEmailModalState(); }} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {oauthPasswordSetupRequired ? t('settings.oauthEmailSetupModalDesc') : t('settings.emailModalDesc')}
              </p>
              {emailError && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 px-3 py-2 rounded-sm text-xs flex items-start gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>{emailError}</span>
                </div>
              )}
              {emailSuccess && (
                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 text-emerald-600 dark:text-emerald-400 px-3 py-2 rounded-sm text-xs flex items-start gap-2">
                  <Mail size={14} className="shrink-0 mt-0.5" /> <span>{emailSuccess}</span>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">{t('settings.newEmail')}</label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(event) => setNewEmail(event.target.value)}
                    placeholder={t('settings.newEmailPlaceholder')}
                    className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 rounded-sm focus:ring-1 focus:ring-endfield-yellow focus:border-endfield-yellow outline-none transition-all font-mono"
                  />
                </div>
                {!oauthPasswordSetupRequired && (
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">{t('settings.currentPassword')}</label>
                    <input
                      type="password"
                      value={emailCurrentPassword}
                      onChange={(event) => setEmailCurrentPassword(event.target.value)}
                      placeholder={t('settings.currentPasswordPlaceholder')}
                      className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 rounded-sm focus:ring-1 focus:ring-endfield-yellow focus:border-endfield-yellow outline-none transition-all font-mono"
                    />
                  </div>
                )}
              </div>

              <button
                onClick={handleEmailChangeRequest}
                disabled={emailLoading || !!emailSuccess}
                className="w-full bg-endfield-yellow hover:bg-yellow-400 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 text-black disabled:text-zinc-400 font-bold uppercase tracking-wider py-2.5 text-xs rounded-sm transition-colors mt-2"
              >
                {emailLoading ? t('settings.emailChangeSending') : emailSuccess ? t('settings.emailChangeSent') : t('settings.emailChangeAction')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 修改密码弹窗 */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white dark:bg-zinc-900 rounded-sm shadow-2xl w-full max-w-sm overflow-hidden animate-scale-up border border-zinc-200 dark:border-zinc-800">
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 flex justify-between items-center">
              <h3 className="font-bold text-sm text-slate-700 dark:text-zinc-200 flex items-center gap-2 uppercase tracking-wide">
                <Lock size={16} className="text-endfield-yellow" />
                {oauthPasswordSetupRequired ? t('settings.passwordSetupModalTitle') : t('settings.passwordModalTitle')}
              </h3>
              <button onClick={() => { setShowPasswordModal(false); resetPasswordModalState(); }} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {passwordError && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 px-3 py-2 rounded-sm text-xs flex items-start gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>{passwordError}</span>
                </div>
              )}
              {passwordSuccess && (
                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 text-emerald-600 dark:text-emerald-400 px-3 py-2 rounded-sm text-xs flex items-start gap-2">
                  <Lock size={14} className="shrink-0 mt-0.5" /> <span>{passwordSuccess}</span>
                </div>
              )}

              <div className="space-y-3">
                {oauthPasswordSetupRequired ? (
                  <div className="border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-800 dark:text-amber-200">
                    {t('settings.passwordSetupVerifiedEmailHint')}
                  </div>
                ) : (
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">{t('settings.currentPassword')}</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      placeholder={t('settings.currentPasswordPlaceholder')}
                      className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 rounded-sm focus:ring-1 focus:ring-endfield-yellow focus:border-endfield-yellow outline-none transition-all font-mono"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">{t('settings.newPassword')}</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder={t('settings.newPasswordPlaceholder')}
                    className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 rounded-sm focus:ring-1 focus:ring-endfield-yellow focus:border-endfield-yellow outline-none transition-all font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">{t('settings.confirmNewPassword')}</label>
                  <input
                    type="password"
                    value={confirmNewPassword}
                    onChange={(event) => setConfirmNewPassword(event.target.value)}
                    placeholder={t('settings.confirmNewPasswordPlaceholder')}
                    className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 rounded-sm focus:ring-1 focus:ring-endfield-yellow focus:border-endfield-yellow outline-none transition-all font-mono"
                  />
                  {confirmNewPassword && newPassword !== confirmNewPassword && (
                    <p className="mt-1.5 text-[10px] text-red-500">{t('settings.passwordMismatchInline')}</p>
                  )}
                </div>
              </div>

              <button
                onClick={handlePasswordReset}
                disabled={passwordLoading || !!passwordSuccess}
                className="w-full bg-endfield-yellow hover:bg-yellow-400 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 text-black disabled:text-zinc-400 font-bold uppercase tracking-wider py-2.5 text-xs rounded-sm transition-colors mt-2"
              >
                {passwordLoading ? t('settings.passwordUpdating') : passwordSuccess ? t('settings.passwordUpdated') : oauthPasswordSetupRequired ? t('settings.passwordSetupAction') : t('settings.passwordUpdateAction')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除账户弹窗 */}
      {showDeleteAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white dark:bg-zinc-900 rounded-sm shadow-2xl w-full max-w-md overflow-hidden animate-scale-up border border-zinc-200 dark:border-zinc-800">
            <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 bg-red-50 dark:bg-red-950/30">
              <h3 className="text-base font-bold text-red-600 dark:text-red-400 flex items-center gap-2 uppercase tracking-wide">
                <AlertTriangle size={18} />
                {t('settings.deleteAccountModalTitle')}
              </h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
                {t('settings.deleteAccountModalDesc')}
              </p>
            </div>
            <div className="p-5 space-y-4">
              {deleteAccountError && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 px-3 py-2 rounded-sm text-xs flex items-start gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>{deleteAccountError}</span>
                </div>
              )}
              {deleteAccountSuccess && (
                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 text-emerald-600 dark:text-emerald-400 px-3 py-2 rounded-sm text-xs">
                  {deleteAccountSuccess}
                </div>
              )}

              <div className="bg-red-50/50 dark:bg-red-900/10 border border-red-200/50 dark:border-red-900/40 p-3 text-[11px] text-red-700 dark:text-red-300 space-y-1.5 rounded-sm">
                <p>• {t('settings.deleteAccountWarning1')}</p>
                <p>• {t('settings.deleteAccountWarning2')}</p>
                <p>• {t('settings.deleteAccountWarning3')}</p>
                <p>• {t('settings.deleteAccountWarning4')}</p>
                <p>• {t('settings.deleteAccountWarning5')}</p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">{t('settings.currentPassword')}</label>
                  <input
                    type="password"
                    value={deleteAccountPassword}
                    onChange={(event) => setDeleteAccountPassword(event.target.value)}
                    placeholder={t('settings.currentPasswordPlaceholder')}
                    className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 rounded-sm focus:ring-1 focus:ring-red-500 focus:border-red-500 outline-none transition-all font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">{t('settings.confirmPhrase')}</label>
                  <input
                    type="text"
                    value={deleteAccountConfirmText}
                    onChange={(event) => setDeleteAccountConfirmText(event.target.value)}
                    placeholder={t('settings.confirmDeleteAccountPlaceholder')}
                    className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 rounded-sm focus:ring-1 focus:ring-red-500 focus:border-red-500 outline-none transition-all font-mono"
                  />
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 flex gap-2 justify-end">
              <button
                onClick={() => { setShowDeleteAccountModal(false); resetDeleteAccountModalState(); }}
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-sm transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteAccountLoading || deleteAccountSuccess || deleteAccountConfirmText !== deleteAccountPhrase}
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-white bg-red-600 hover:bg-red-700 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 disabled:text-zinc-400 disabled:border-transparent border border-red-700 rounded-sm transition-colors disabled:cursor-not-allowed"
              >
                {deleteAccountLoading ? t('settings.deleteAccountProgress') : deleteAccountSuccess ? t('settings.deleteAccountDone') : t('settings.confirmDeleteAccountAction')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除所有数据弹窗 */}
      {showDeleteAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white dark:bg-zinc-900 rounded-sm shadow-2xl w-full max-w-sm overflow-hidden animate-scale-up border border-zinc-200 dark:border-zinc-800">
            <div className="p-5 text-center bg-red-50 dark:bg-red-950/30 border-b border-zinc-100 dark:border-zinc-800">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900/50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-3 shadow-inner">
                <Trash2 size={24} />
              </div>
              <h3 className="text-base font-bold text-slate-800 dark:text-zinc-100 tracking-wide">{t('settings.deleteDataModalTitle')}</h3>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">
                {t('settings.deleteDataModalIntro')}
              </p>
            </div>
            <div className="p-5">
              <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 p-3 rounded-sm mb-4">
                <ul className="text-xs font-mono text-zinc-600 dark:text-zinc-400 space-y-1.5 flex flex-col items-center">
                  <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-red-500 rounded-full"></div> {userPoolCount} {t('settings.createdPools')}</li>
                  <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-red-500 rounded-full"></div> {userHistoryCount} {t('settings.historyRecords')}</li>
                </ul>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-500 mb-3 text-center leading-relaxed">
                {t('settings.deleteDataModalKeepAccount')} {t('settings.deleteDataModalFinal')}
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={t('settings.deleteDataPlaceholder')}
                className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-sm focus:ring-1 focus:ring-red-500 focus:border-red-500 outline-none font-mono text-center"
              />
            </div>
            <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 flex gap-2 justify-center">
              <button
                onClick={() => { setShowDeleteAllModal(false); setDeleteConfirmText(''); }}
                className="px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-sm transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeleteAllData}
                disabled={deleteConfirmText !== deletePhrase || deleteLoading}
                className="px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white bg-red-600 hover:bg-red-700 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 disabled:text-zinc-400 border border-red-700 disabled:border-transparent rounded-sm transition-colors disabled:cursor-not-allowed"
              >
                {deleteLoading ? t('settings.deleteDataProgress') : t('settings.deleteDataAction')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default SettingsPanel;
