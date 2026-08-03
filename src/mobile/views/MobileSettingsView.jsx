import React, { useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Settings, User, Moon, Sun, Monitor, Trash2, Lock, Cloud, RefreshCw,
  AlertTriangle, X, Database, LogOut, ChevronRight, Globe, Mail, CheckCircle2, KeyRound, Loader2
} from 'lucide-react';
import useAuthStore from '../../stores/useAuthStore';
import usePoolStore from '../../stores/usePoolStore';
import useHistoryStore from '../../stores/useHistoryStore';
import useSiteConfigStore from '../../stores/useSiteConfigStore';
import { useCloudSync } from '../../hooks/app';
import { useToast } from '../../hooks';
import PlatformSwitcher from '../../components/common/PlatformSwitcher';
import LocaleSwitcher from '../../components/common/LocaleSwitcher.jsx';
import PlatformBindingsSection from '../../components/settings/PlatformBindingsSection.jsx';
import DeveloperApiSection from '../../components/settings/DeveloperApiSection.jsx';
import LoginIdentitiesSection from '../../components/settings/LoginIdentitiesSection.jsx';
import OAuthEmailMergeFlow from '../../components/settings/OAuthEmailMergeFlow.jsx';
import UsernameEditDialog from '../../components/settings/UsernameEditDialog.jsx';
import { Toast } from '../../components/ui';
import { useTheme } from '../../contexts/ThemeContext';
import { APP_VERSION_LABEL } from '../../constants/appMeta';
import {
  AuthRateLimitError,
  isOAuthPasswordSetupRequired,
  loadAccountSecurityState,
  setupPasswordForOAuthAccount,
  updatePasswordWithCurrentPassword,
} from '../../services/accountSecurityService.js';
import {
  AccountEmailActionError,
  isUserEmailVerified,
  requestCurrentEmailVerification,
  requestEmailChange,
  verifyCurrentEmailCode,
} from '../../services/accountEmailService.js';
import { deleteOwnAccount } from '../../services/selfAccountService';
import { updateOwnUsername } from '../../services/accountProfileService.js';
import { finalizeDeletedAccountSession } from '../../utils/finalizeDeletedAccountSession';
import {
  buildUsernameHandle,
  getPreferredUsername,
} from '../../utils/usernameValidation.js';
import { MobileSectionTitle, MobileStickyHeader } from '../components/ux/MobilePrimitives.jsx';
import {
  formatFreshnessAbsolute,
  formatFreshnessRelative,
  getFreshnessTone
} from '../../utils/dataFreshness.js';
import { getAccountLastImportTimestamp } from '../../utils/accountFreshness.js';
import {
  getPrimaryAccountPasswordError,
  isInvalidCurrentPasswordError,
  validateAccountPassword,
} from '../../utils/authSecurity.js';
import { useI18n } from '../../i18n/index.js';
import {
  getGameAccountSelectionValue,
  isGameAccountSelectionMatch,
  localizeGameAccountServerTag,
} from '../../utils/gameAccountMetadata.js';
import {
  ACCOUNT_SERVER_LABEL_OPTIONS,
  buildDuplicateGameUidServerGroups,
  updateAccountServerLabel,
} from '../../utils/accountServerLabelCorrection.js';

function getFreshnessToneClasses(tone) {
  switch (tone) {
    case 'fresh':
      return 'border-emerald-500/30 bg-emerald-500/12 text-emerald-300';
    case 'notice':
      return 'border-amber-500/30 bg-amber-500/12 text-amber-300';
    case 'stale':
      return 'border-red-500/30 bg-red-500/12 text-red-300';
    default:
      return 'border-zinc-200 bg-zinc-50 text-slate-500 dark:border-white/8 dark:bg-white/[0.03] dark:text-zinc-400';
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

function MobileSettingsSection({ title, icon, children }) {
  return (
    <div className="mobile-ux-card p-4 space-y-4">
      <MobileSectionTitle title={title} icon={icon} />
      <div className="space-y-4">{children}</div>
    </div>
  );
}

/**
 * 移动端设置视图 - 工业风重构版 (中文)
 */
function MobileSettingsView() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, locale, formatDateTime } = useI18n();
  const { themeMode, setThemeMode } = useTheme();
  const { user, signOut, logout, userRole, syncing, syncError, lastSyncAt, setUser } = useAuthStore();
  const { pools, setPools, currentPoolId, currentGameUid, switchPool, switchGameAccount } = usePoolStore();
  const { history, setHistory, getGameAccountsFromHistory } = useHistoryStore();
  const siteVersion = useSiteConfigStore((state) => state.config.site_version || APP_VERSION_LABEL);
  const { toasts, showToast, removeToast } = useToast();
  const { syncToCloud, loadPublicPools, deleteUserDataFromCloud } = useCloudSync({ showToast });
  const deletePhrase = t('settings.deletePhrase');
  const deleteAccountPhrase = t('settings.deleteAccountPhrase');

  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState('');
  const [deleteAccountConfirmText, setDeleteAccountConfirmText] = useState('');
  const [deleteAccountPassword, setDeleteAccountPassword] = useState('');
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
  const [emailMergeOffer, setEmailMergeOffer] = useState(null);
  const [serverLabelUpdatingAccount, setServerLabelUpdatingAccount] = useState(null);
  const [serverLabelError, setServerLabelError] = useState('');
  const [serverMergeSelections, setServerMergeSelections] = useState({});
  const [newEmail, setNewEmail] = useState('');
  const [emailCurrentPassword, setEmailCurrentPassword] = useState('');
  const [accountSecurityState, setAccountSecurityState] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const myPools = useMemo(() => {
    if (!pools || !user) return [];
    const poolsArray = Array.isArray(pools) ? pools : [];
    return poolsArray.filter(pool => pool.user_id === user.id);
  }, [pools, user]);

  const myHistory = useMemo(() => {
    if (!history || !user) return [];
    const historyArray = Array.isArray(history) ? history : [];
    return historyArray.filter(h => !h.user_id || h.user_id === user.id);
  }, [history, user]);

  const userPoolCount = myPools.length;
  const userHistoryCount = myHistory.length;
  const gameAccounts = useMemo(() => {
    void history;
    return getGameAccountsFromHistory();
  }, [getGameAccountsFromHistory, history]);
  const duplicateGameUidServerGroups = useMemo(
    () => buildDuplicateGameUidServerGroups(gameAccounts),
    [gameAccounts]
  );
  const currentUsername = useMemo(() => getPreferredUsername(user), [user]);
  const currentUsernameHandle = useMemo(() => buildUsernameHandle(user), [user]);
  const emailVerificationRequired = userRole !== 'super_admin' && Boolean(accountSecurityState?.emailVerificationRequired);
  const emailVerified = useMemo(
    () => isUserEmailVerified(user, {
      emailVerificationRequired,
      emailVerificationVerifiedAt: accountSecurityState?.emailVerificationVerifiedAt,
    }),
    [accountSecurityState?.emailVerificationVerifiedAt, emailVerificationRequired, user]
  );
  const pendingEmailChange = accountSecurityState?.emailVerificationRequired
    ? accountSecurityState?.emailVerificationTargetEmail || user?.new_email || null
    : user?.new_email || null;
  const passwordChangeRequired = Boolean(accountSecurityState?.passwordChangeRequired);
  const oauthPasswordSetupRequired = isOAuthPasswordSetupRequired(accountSecurityState);
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
      showToast(t('settings.success.emailVerifiedByLink'), 'success');
      setAccountSecurityState((prev) => ({
        ...(prev || {}),
        emailVerificationRequired: false,
        emailVerificationVerifiedAt: new Date().toISOString(),
      }));
    } else {
      const reason = searchParams.get('reason') || '';
      showToast(
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
  }, [location.pathname, location.search, navigate, showToast, t]);

  const getRoleInfo = (role) => {
    switch (role) {
      case 'super_admin':
        return {
          label: t('settings.role.super_admin.label'),
          badgeClass: 'border-red-400/30 bg-red-500/12',
          textClass: 'text-red-300',
        };
      case 'admin':
        return {
          label: t('settings.role.admin.label'),
          badgeClass: 'border-emerald-400/30 bg-emerald-500/12',
          textClass: 'text-emerald-300',
        };
      default:
        return {
          label: t('settings.role.user.label'),
          badgeClass: 'border-white/10 bg-white/[0.04]',
          textClass: 'text-zinc-300',
        };
    }
  };

  const roleInfo = getRoleInfo(userRole);
  const lastSyncLabel = useMemo(() => {
    return formatDateTime(lastSyncAt, {}, t('settings.syncNever'));
  }, [formatDateTime, lastSyncAt, t]);

  const handleManualSync = async () => {
    if (syncToCloud) {
      await syncToCloud();
    }
  };

  const handleAccountServerLabelChange = async (account, nextServerId) => {
    const accountValue = getGameAccountSelectionValue(account) || account?.gameUid || account?.game_uid;
    const nextOption = ACCOUNT_SERVER_LABEL_OPTIONS.find(option => option.serverId === nextServerId);
    const currentLabel = localizeGameAccountServerTag(account, locale) || accountValue || '';
    const nextLabel = nextOption ? t(nextOption.labelKey) : nextServerId;

    if (!window.confirm(t('settings.serverLabelConfirm', { current: currentLabel, next: nextLabel }))) {
      return;
    }

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
      const message = error?.message === 'server_label_update_no_records'
        ? t('settings.serverLabelNoRecords')
        : error?.message || t('common.unknown');
      setServerLabelError(t('settings.serverLabelUpdateFailed', { message }));
    } finally {
      setServerLabelUpdatingAccount(null);
    }
  };

  const handleMergeDuplicateGameUidServers = async (group) => {
    const nextServerId = serverMergeSelections[group.gameUid] || group.defaultServerId || '';
    const anchorAccount = group.accounts[0];
    if (!anchorAccount || !nextServerId) {
      return;
    }

    const nextOption = ACCOUNT_SERVER_LABEL_OPTIONS.find(option => option.serverId === nextServerId);
    const nextLabel = nextOption ? t(nextOption.labelKey) : nextServerId;
    const currentLabels = group.labels.map(label => localizeGameAccountServerTag(label, locale)).join(' / ');

    if (!window.confirm(t('settings.serverMergeConfirm', { uid: group.gameUid, current: currentLabels, next: nextLabel }))) {
      return;
    }

    const loadingKey = `merge:${group.gameUid}`;
    setServerLabelError('');
    setServerLabelUpdatingAccount(loadingKey);
    try {
      await updateAccountServerLabel({
        account: anchorAccount,
        nextServerId,
        history,
        setHistory,
        currentGameUid,
        switchGameAccount,
        mergeGameUid: true,
        mergeAccounts: group.accounts,
      });
      setServerMergeSelections((prev) => {
        const next = { ...prev };
        delete next[group.gameUid];
        return next;
      });
    } catch (error) {
      const message = error?.message === 'server_label_update_no_records'
        ? t('settings.serverLabelNoRecords')
        : error?.message || t('common.unknown');
      setServerLabelError(t('settings.serverMergeFailed', { message }));
    } finally {
      setServerLabelUpdatingAccount(null);
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
      } else if (error?.code === 'oauth_email_merge_available') {
        const targetEmail = accountSecurityState?.emailVerificationTargetEmail || user?.email || '';
        setEmailMergeOffer({
          targetEmail,
          maskedEmail: error?.details?.maskedEmail || '',
        });
        setNewEmail(targetEmail);
        setShowPasswordModal(false);
        resetPasswordModalState();
        setShowEmailModal(true);
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
    setEmailMergeOffer(null);
  };

  const handleVerifyEmail = async () => {
    if (!user) {
      showToast(t('settings.error.notLoggedInEmail'), 'error');
      return;
    }

    setEmailVerificationLoading(true);
    try {
      const result = await requestCurrentEmailVerification({ locale });
      const status = result?.data?.status;
      setEmailVerificationCode('');
      if (status === 'already_verified') {
        setAccountSecurityState((prev) => ({
          ...(prev || {}),
          emailVerificationRequired: false,
          emailVerificationVerifiedAt: prev?.emailVerificationVerifiedAt || new Date().toISOString(),
        }));
      } else {
        setEmailVerificationSendCount((prev) => prev + 1);
        setEmailVerificationDeferred(false);
      }
      showToast(
        status === 'already_verified'
          ? t('settings.success.emailAlreadyVerified')
          : t('settings.success.emailVerificationSent'),
        'success'
      );
    } catch (error) {
      showToast(getAccountEmailErrorMessage(error, t), 'error');
    } finally {
      setEmailVerificationLoading(false);
    }
  };

  const handleVerifyEmailCode = async () => {
    if (!user) {
      showToast(t('settings.error.notLoggedInEmail'), 'error');
      return;
    }

    const code = String(emailVerificationCode || '').replace(/\D/g, '').slice(0, 6);
    if (code.length !== 6) {
      showToast(t('settings.error.emailVerificationCodeInvalid'), 'error');
      return;
    }

    setEmailVerificationCodeLoading(true);
    try {
      const result = await verifyCurrentEmailCode({ code });
      const verifiedEmail = result?.data?.email || '';
      if (verifiedEmail) {
        setUser({
          ...user,
          email: verifiedEmail,
        });
      }
      setEmailVerificationCode('');
      setEmailVerificationSendCount(0);
      setEmailVerificationDeferred(false);
      setAccountSecurityState((prev) => ({
        ...(prev || {}),
        emailVerificationRequired: false,
        emailVerificationVerifiedAt: new Date().toISOString(),
        emailVerificationTargetEmail: verifiedEmail || prev?.emailVerificationTargetEmail || null,
      }));
      showToast(t('settings.success.emailVerificationCodeVerified'), 'success');
    } catch (error) {
      const codeValue = error instanceof AccountEmailActionError ? error.code : error?.code;
      showToast(
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
      if (result?.data?.nextStep === 'enter_verification_code' && result?.data?.sent?.new) {
        const pendingEmail = result?.data?.pendingEmail || newEmail.trim().toLowerCase();
        setAccountSecurityState((prev) => ({
          ...(prev || {}),
          emailVerificationRequired: true,
          emailVerificationVerifiedAt: null,
          emailVerificationTargetEmail: pendingEmail,
        }));
        setEmailVerificationCode('');
        setEmailVerificationSendCount((prev) => prev + 1);
        setEmailVerificationDeferred(false);
      }
      const successMessage = result?.data?.dryRun
        ? t('settings.success.emailChangeDryRun')
        : t('settings.success.emailChangeRequested');
      setEmailSuccess(successMessage);
      showToast(successMessage, 'success');
      setTimeout(() => {
        setShowEmailModal(false);
        resetEmailModalState();
      }, 2400);
    } catch (error) {
      if (error?.code === 'oauth_email_merge_available') {
        setEmailMergeOffer({
          targetEmail: newEmail.trim().toLowerCase(),
          maskedEmail: error?.details?.maskedEmail || '',
        });
        setEmailError('');
      } else {
        setEmailError(getAccountEmailErrorMessage(error, t));
      }
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

  const handleDeleteAllData = async () => {
    if (deleteConfirmText !== deletePhrase) return;
    setDeleteLoading(true);
    setDeleteError('');
    try {
      const historyArray = Array.isArray(history) ? history : [];
      const poolsArray = Array.isArray(pools) ? pools : [];
      const nextHistory = historyArray.filter((item) => item?.user_id && item.user_id !== user.id);
      const refreshedPublicPools = await deleteUserDataFromCloud()
        .then(() => loadPublicPools?.());
      const fallbackPools = poolsArray.filter((pool) => pool?.user_id !== user.id);
      const nextPools = Array.isArray(refreshedPublicPools) ? refreshedPublicPools : fallbackPools;

      setHistory(nextHistory);
      setPools(nextPools);

      if (!nextPools.some((pool) => pool?.id === currentPoolId)) {
        switchPool(nextPools[0]?.id || null);
      }

      setShowDeleteModal(false);
      setDeleteConfirmText('');
    } catch (error) {
      setDeleteError(error.message || t('settings.error.deleteDataFailed'));
    } finally {
      setDeleteLoading(false);
    }
  };

  const resetDeleteAccountState = () => {
    setDeleteAccountLoading(false);
    setDeleteAccountError('');
    setDeleteAccountConfirmText('');
    setDeleteAccountPassword('');
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

    setDeleteAccountLoading(true);
    setDeleteAccountError('');

    try {
      await deleteOwnAccount(deleteAccountPassword);
      await finalizeDeletedAccountSession({
        loadPublicPools,
        setPools,
        setHistory,
        switchPool,
        switchGameAccount,
        logout,
      });
      showToast(t('settings.success.deleteAccount'), 'success');
      navigate('/m', { replace: true });
    } catch (error) {
      setDeleteAccountError(error.message || t('settings.error.deleteAccountFailed'));
    } finally {
      setDeleteAccountLoading(false);
    }
  };

  const themeOptions = [
    { value: 'light', label: t('settings.theme.light'), icon: Sun },
    { value: 'dark', label: t('settings.theme.dark'), icon: Moon },
    { value: 'system', label: t('settings.theme.system'), icon: Monitor },
  ];

  return (
    <div className="flex-1 h-full overflow-y-auto overflow-x-hidden slide-right-enter scroll-smooth w-full bg-ef-light dark:bg-ef-dark px-4 pb-6 space-y-4">
      <MobileStickyHeader
        eyebrow="SYSTEM"
        icon={Settings}
        title={t('settings.pageTitle')}
        subtitle={t('settings.pageSubtitle')}
      />

      {/* 账户信息 */}
      <MobileSettingsSection title={t('settings.accountSection')} icon={User}>
        {user ? (
          <div className="divide-y divide-zinc-200 overflow-hidden rounded-[1.05rem] border border-zinc-200 bg-zinc-50/75 dark:divide-white/8 dark:border-white/8 dark:bg-white/[0.03]">
            {/* 用户头像和邮箱 */}
            <div className="p-4 flex items-center gap-4">
              <div className="w-14 h-14 rounded-[1rem] bg-endfield-yellow flex items-center justify-center overflow-hidden border border-endfield-yellow shadow-sm">
                {user.user_metadata?.avatar_url ? (
                  <img
                    src={user.user_metadata.avatar_url}
                    alt={currentUsername || user.email || t('settings.mobile.unnamedUser')}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-2xl font-bold text-black font-mono">
                    {(currentUsername || user.email || '?')[0].toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-zinc-900 dark:text-zinc-100 truncate text-lg">
                  {currentUsernameHandle || t('settings.mobile.unnamedUser')}
                </p>
                <p className="text-xs text-zinc-500 truncate font-mono uppercase tracking-wide">{user.email}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${
                    emailVerified
                      ? 'border-emerald-400/30 bg-emerald-500/12 text-emerald-300'
                      : 'border-amber-400/30 bg-amber-500/12 text-amber-300'
                  }`}>
                    {emailVerified ? <CheckCircle2 size={10} /> : <AlertTriangle size={10} />}
                    <span className="text-[9px] font-bold uppercase">
                      {emailVerified ? t('settings.emailVerified') : t('settings.emailUnverified')}
                    </span>
                  </span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 border ${roleInfo.badgeClass}`}>
                    <span className={`text-[9px] font-bold uppercase ${roleInfo.textClass}`}>
                      {roleInfo.label}
                    </span>
                  </span>
                </div>
                {pendingEmailChange && (
                  <p className="mt-2 text-[10px] leading-4 text-amber-600 dark:text-amber-300">
                    {t('settings.pendingEmailChange', { value: pendingEmailChange })}
                  </p>
                )}
                {emailVerificationRequired && (
                  <p className="mt-2 text-[10px] leading-4 text-amber-600 dark:text-amber-300">
                    {t('settings.emailVerificationRequired')}
                  </p>
                )}
                {!emailVerified && (
                  <p className="mt-2 text-[10px] leading-4 text-zinc-500 dark:text-zinc-400">
                    {t('settings.emailVerificationReminder')}
                  </p>
                )}
              </div>
            </div>

            <div className="px-4 py-4 space-y-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                {t('settings.email')}
              </div>
              <div className="grid grid-cols-1 gap-2">
                {!emailVerified && (
                  <button
                    type="button"
                    onClick={handleVerifyEmail}
                    disabled={emailVerificationLoading}
                    className="w-full rounded-[0.95rem] border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm font-bold uppercase tracking-widest text-amber-700 transition-all hover:bg-amber-400 hover:text-black disabled:opacity-60 dark:text-amber-300"
                  >
                    {emailVerificationLoading ? t('settings.emailVerificationSending') : t('settings.verifyEmail')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    resetEmailModalState();
                    setShowEmailModal(true);
                  }}
                  className="w-full rounded-[0.95rem] border border-zinc-300 bg-white px-4 py-3 text-sm font-bold uppercase tracking-widest text-zinc-700 transition-all hover:border-endfield-yellow hover:text-zinc-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-200 dark:hover:border-endfield-yellow"
                >
                  {t('settings.changeEmail')}
                </button>
                {!emailVerified && (
                  <div className="rounded-[0.95rem] border border-zinc-200 bg-white px-3 py-3 dark:border-white/8 dark:bg-white/[0.04]">
                    <label className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                      <KeyRound size={13} /> {t('settings.emailVerificationCode')}
                    </label>
                    {emailVerificationSendCount > 0 && (
                      <p className="mb-2 text-[10px] leading-4 text-amber-700 dark:text-amber-300">
                        {t('settings.emailVerificationSendCount', { count: emailVerificationSendCount })}
                      </p>
                    )}
                    <div className="grid grid-cols-1 gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        value={emailVerificationCode}
                        onChange={(event) => setEmailVerificationCode(String(event.target.value || '').replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        className="mobile-ux-input px-4 py-3 text-center font-mono text-lg tracking-[0.28em]"
                      />
                      <button
                        type="button"
                        onClick={handleVerifyEmailCode}
                        disabled={emailVerificationCodeLoading || emailVerificationCode.length !== 6}
                        className="flex w-full items-center justify-center gap-2 rounded-[0.95rem] bg-endfield-yellow px-4 py-3 text-xs font-bold uppercase tracking-widest text-black touch-feedback disabled:opacity-50 transition-colors hover:bg-yellow-400 disabled:bg-zinc-700"
                      >
                        {emailVerificationCodeLoading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                        {t('settings.verifyEmailCode')}
                      </button>
                    </div>
                    <p className="mt-2 text-[10px] leading-4 text-zinc-500 dark:text-zinc-500">
                      {t('settings.emailVerificationCodeHint')}
                    </p>
                    {emailVerificationSendCount >= 2 && !emailVerificationDeferred && (
                      <div className="mt-3 rounded-[0.95rem] border border-amber-300/60 bg-amber-50 px-3 py-3 text-[10px] leading-4 text-amber-800 dark:border-amber-700/70 dark:bg-amber-500/10 dark:text-amber-200">
                        <p>{t('settings.emailVerificationDeferHint')}</p>
                        <button
                          type="button"
                          onClick={() => {
                            setEmailVerificationDeferred(true);
                            showToast(t('settings.emailVerificationDeferred'), 'success');
                          }}
                          className="mt-2 w-full rounded-[0.85rem] border border-amber-300 bg-white px-3 py-2 text-xs font-bold uppercase tracking-widest text-amber-800 transition-colors hover:bg-amber-50 dark:border-amber-700 dark:bg-zinc-950 dark:text-amber-200 dark:hover:bg-amber-900/20"
                        >
                          {t('settings.emailVerificationDeferAction')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="px-4 py-4 space-y-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                {t('settings.username')}
              </div>
              <div className="text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                {t('settings.usernameDialogDesc')}
              </div>
              <button
                type="button"
                onClick={() => setShowUsernameModal(true)}
                className="w-full rounded-[0.95rem] border border-endfield-yellow bg-endfield-yellow/10 px-4 py-3 text-sm font-bold uppercase tracking-widest text-amber-700 transition-all hover:bg-endfield-yellow hover:text-black disabled:opacity-60 dark:text-endfield-yellow"
              >
                {t('settings.changeUsername')}
              </button>
            </div>

            {passwordChangeRequired && (
              <div className="px-4 py-4 bg-amber-500/10">
                <div className="rounded-[0.95rem] border border-amber-400/30 bg-amber-500/10 px-3 py-3 text-amber-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    <div className="min-w-0 space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-widest">
                        {t('settings.passwordChangeRequiredTitle')}
                      </div>
                      <div className="text-[11px] leading-5 text-amber-100/90">
                        {oauthPasswordSetupRequired
                          ? t('settings.oauthPasswordSetupRequiredDesc')
                          : passwordChangeExpiresAt
                            ? t('settings.passwordChangeRequiredDescWithExpiry', { value: passwordChangeExpiresAt })
                            : t('settings.passwordChangeRequiredDesc')}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 修改密码 */}
            <button
              onClick={() => {
                resetPasswordModalState();
                setShowPasswordModal(true);
              }}
              className="w-full px-4 py-3 flex items-center justify-between touch-feedback hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Lock size={16} className="text-zinc-400" />
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {oauthPasswordSetupRequired ? t('settings.setPassword') : t('settings.changePassword')}
                </span>
              </div>
              <ChevronRight size={16} className="text-zinc-300" />
            </button>
          </div>
        ) : (
          <div className="rounded-[1.05rem] border border-dashed border-zinc-200 bg-zinc-50/75 p-8 text-center dark:border-white/10 dark:bg-white/[0.03]">
            <User size={32} className="mx-auto mb-3 text-zinc-300 dark:text-zinc-700" />
            <p className="text-xs text-zinc-500 uppercase tracking-widest">{t('settings.mobile.authRequired')}</p>
          </div>
        )}
      </MobileSettingsSection>

      <MobileSettingsSection title={t('settings.authIdentity.title')} icon={KeyRound}>
        <div className="p-4">
          <LoginIdentitiesSection variant="mobile" emailVerified={emailVerified} />
        </div>
      </MobileSettingsSection>

      <MobileSettingsSection title={t('settings.integration.bindingsTitle')} icon={Cloud}>
        <div className="p-4">
          <PlatformBindingsSection variant="mobile" />
        </div>
      </MobileSettingsSection>

      <MobileSettingsSection title={t('settings.integration.apiTitle')} icon={Globe}>
        <div className="p-4">
          <DeveloperApiSection variant="mobile" />
        </div>
      </MobileSettingsSection>

      {/* 外观设置 */}
      <MobileSettingsSection title={t('settings.appearanceSection')} icon={Monitor}>
        <div className="p-4">
          <div className="grid grid-cols-3 gap-3">
            {themeOptions.map((option) => {
              const Icon = option.icon;
              const isActive = themeMode === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => setThemeMode(option.value)}
                  className={`flex-1 flex flex-col items-center gap-2 rounded-[1rem] p-3 border transition-all touch-feedback ${
                    isActive
                      ? 'border-endfield-yellow bg-endfield-yellow/10 shadow-[inset_0_0_0_1px_rgba(255,250,0,0.25)]'
                      : 'border-zinc-200 bg-zinc-50/75 hover:border-zinc-300 dark:border-white/8 dark:bg-white/[0.03] dark:hover:border-white/15'
                  }`}
                >
                  <Icon size={20} className={isActive ? 'text-endfield-yellow' : 'text-slate-500 dark:text-zinc-400'} strokeWidth={1.5} />
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? 'text-zinc-900 dark:text-endfield-yellow' : 'text-slate-500 dark:text-zinc-500'}`}>
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </MobileSettingsSection>

      <MobileSettingsSection title={t('settings.languageSection')} icon={Monitor}>
        <div className="p-4 space-y-3">
          <p className="text-[10px] text-zinc-500 text-center font-mono">
            {t('language.description')}
          </p>
          <div className="flex justify-center">
            <LocaleSwitcher />
          </div>
        </div>
      </MobileSettingsSection>

      {/* 平台切换 */}
      <MobileSettingsSection title={t('settings.platformSection')} icon={Monitor}>
        <div className="p-4">
          <PlatformSwitcher className="w-full justify-center py-2.5 rounded-[1rem]" />
          <p className="text-[10px] text-zinc-400 text-center mt-2 font-mono uppercase">
            {t('settings.mobile.platformHint')}
          </p>
        </div>
      </MobileSettingsSection>

      {/* 数据管理 */}
      {user && (
        <MobileSettingsSection title={t('settings.dataSection')} icon={Database}>
          <div className="p-4 space-y-4">
            {/* 数据统计 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="mobile-ux-soft-card p-3">
                <div className="text-2xl font-bold font-mono text-slate-900 dark:text-zinc-100">{userPoolCount}</div>
                <div className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-bold tracking-wider mt-1">{t('settings.createdPools')}</div>
              </div>
              <div className="mobile-ux-soft-card p-3">
                <div className="text-2xl font-bold font-mono text-slate-900 dark:text-zinc-100">{userHistoryCount}</div>
                <div className="text-[9px] text-slate-500 dark:text-zinc-400 uppercase font-bold tracking-wider mt-1">{t('settings.historyRecords')}</div>
              </div>
            </div>

            {/* 云端同步 */}
            <div className="pt-3 border-t border-zinc-100 scroll-mt-20 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-zinc-700 dark:text-zinc-300">{t('settings.syncSection')}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">{t('settings.lastSync', { value: lastSyncLabel })}</p>
                </div>
                <button
                  onClick={handleManualSync}
                  disabled={syncing || (userPoolCount === 0 && userHistoryCount === 0)}
                  className="flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-white text-xs font-bold uppercase tracking-wider touch-feedback disabled:opacity-50 transition-colors disabled:bg-zinc-800 hover:bg-blue-500"
                >
                  {syncing ? (
                    <>
                      <RefreshCw size={12} className="animate-spin" />
                      {t('settings.syncing')}
                    </>
                  ) : (
                    <>
                      <Cloud size={12} />
                      {t('settings.syncAction')}
                    </>
                  )}
                </button>
              </div>
              {syncError && (
                <p className="mt-2 text-[10px] text-red-500 font-mono">
                  {t('settings.lastSyncError', { value: syncError })}
                </p>
              )}
            </div>

            <div id="settings-account-server-labels" className="pt-3 border-t border-zinc-100 scroll-mt-20 dark:border-zinc-800">
              <div>
                <p className="text-sm font-bold text-zinc-700 dark:text-zinc-300">{t('settings.importFreshnessTitle')}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                  {t('settings.importFreshnessDesc')}
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  {t('settings.serverLabelHint')}
                </p>
              </div>

              {serverLabelError && (
                <div className="mt-3 rounded-[0.9rem] border border-red-400/30 bg-red-500/10 px-3 py-2 text-[10px] text-red-300">
                  {serverLabelError}
                </div>
              )}

              {duplicateGameUidServerGroups.length > 0 && (
                <div className="mt-3 rounded-[1.05rem] border border-amber-400/30 bg-amber-500/10 px-3 py-3">
                  <div className="flex items-start gap-2 text-amber-200">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-wider">{t('settings.serverMergeTitle')}</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-amber-100/80">
                        {t('settings.serverMergeDesc')}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {duplicateGameUidServerGroups.map((group) => {
                      const selectedServerId = serverMergeSelections[group.gameUid] || group.defaultServerId || '';
                      const loadingKey = `merge:${group.gameUid}`;
                      const isMerging = serverLabelUpdatingAccount === loadingKey;

                      return (
                        <div key={group.gameUid} className="rounded-[0.9rem] border border-amber-400/20 bg-black/10 px-3 py-2">
                          <div className="text-[10px] text-amber-100">
                            <div className="font-mono font-bold">UID: {group.gameUid}</div>
                            <div className="mt-0.5">
                              {t('settings.serverMergeCurrent', {
                                count: group.accounts.length,
                                labels: group.labels.map(label => localizeGameAccountServerTag(label, locale)).join(' / '),
                              })}
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <select
                              value={selectedServerId}
                              disabled={isMerging}
                              onChange={(event) => setServerMergeSelections((prev) => ({
                                ...prev,
                                [group.gameUid]: event.target.value,
                              }))}
                              className="rounded-[0.65rem] border border-amber-400/30 bg-zinc-950 px-2 py-1 text-[10px] font-bold text-amber-100 outline-none disabled:opacity-60"
                            >
                              {ACCOUNT_SERVER_LABEL_OPTIONS.map((option) => (
                                <option key={option.serverId} value={option.serverId}>{t(option.labelKey)}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={!selectedServerId || isMerging}
                              onClick={() => handleMergeDuplicateGameUidServers(group)}
                              className="rounded-[0.65rem] border border-amber-400/40 bg-amber-500/80 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white disabled:opacity-60"
                            >
                              {isMerging ? t('settings.serverMergeUpdating') : t('settings.serverMergeAction')}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {gameAccounts.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {gameAccounts.map((account) => {
                    const accountValue = getGameAccountSelectionValue(account);
                    const isCurrentAccount = isGameAccountSelectionMatch(account, currentGameUid);
                    const isUpdatingServerLabel = serverLabelUpdatingAccount === accountValue;

                    return (
                    <div
                      key={accountValue || account.gameUid}
                      className={`border px-3 py-3 ${
                        isCurrentAccount
                          ? 'mobile-ux-soft-card rounded-[1.05rem] border-endfield-yellow bg-endfield-yellow/5'
                          : 'mobile-ux-soft-card mobile-ux-soft-card--muted'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100">{account.nickName}</span>
                            {account.serverTag && (
                              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-[0.8rem] bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                                {localizeGameAccountServerTag(account.serverTag, locale)}
                              </span>
                            )}
                            {isCurrentAccount && (
                              <span className="rounded-full bg-endfield-yellow/15 px-1.5 py-0.5 text-[10px] font-bold text-endfield-yellow">
                                {t('settings.currentAccount')}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-[10px] font-mono text-zinc-500 dark:text-zinc-500">
                            {t('settings.uidRecordCount', { uid: account.gameUid, count: account.recordCount })}
                          </div>
                          <label className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                            <span>{t('settings.serverLabel')}</span>
                            <select
                              value={account.serverId || account.server_id || ''}
                              disabled={isUpdatingServerLabel}
                              onChange={(event) => handleAccountServerLabelChange(account, event.target.value)}
                              className="rounded-[0.65rem] border border-zinc-200 bg-zinc-50 px-2 py-1 text-[10px] font-bold text-zinc-700 outline-none disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-200"
                            >
                              <option value="" disabled>{t('settings.serverLabelUnknown')}</option>
                              {ACCOUNT_SERVER_LABEL_OPTIONS.map((option) => (
                                <option key={option.serverId} value={option.serverId}>{t(option.labelKey)}</option>
                              ))}
                            </select>
                            {isUpdatingServerLabel && <span>{t('settings.serverLabelUpdating')}</span>}
                          </label>
                        </div>
                        <span className={`px-2 py-1 text-[10px] font-bold border whitespace-nowrap ${getFreshnessToneClasses(getFreshnessTone(getAccountLastImportTimestamp(account)))}`}>
                          {formatFreshnessRelative(getAccountLastImportTimestamp(account), t('common.importTimeUnknown'), locale)}
                        </span>
                      </div>
                      <div className="mt-2 space-y-1 text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
                        <div>{t('settings.lastImport', { value: formatFreshnessAbsolute(getAccountLastImportTimestamp(account), t('common.unknown'), locale) })}</div>
                        <div>{t('settings.latestRecord', { value: formatFreshnessAbsolute(account.latestRecordAt, t('common.unknown'), locale) })}</div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 rounded-[1.05rem] border border-dashed border-zinc-200 bg-zinc-50/75 px-3 py-3 text-[10px] font-mono text-zinc-500 dark:border-white/10 dark:bg-white/[0.03]">
                  {t('settings.noImportedAccounts')}
                </div>
              )}
            </div>

            {/* 删除数据 */}
            <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-red-600 dark:text-red-500 uppercase">{t('settings.dangerSection')}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">{t('settings.deleteDataDesc')}</p>
                </div>
                <button
                  onClick={() => {
                    setDeleteError('');
                    setShowDeleteModal(true);
                  }}
                  disabled={userPoolCount === 0 && userHistoryCount === 0}
                  className="flex items-center gap-2 rounded-full border border-red-400/30 px-4 py-2 text-red-300 text-xs font-bold uppercase tracking-wider touch-feedback disabled:opacity-50 transition-colors hover:bg-red-500/10"
                >
                  <Trash2 size={12} />
                  {t('settings.deleteMyData')}
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-red-700 dark:text-red-500 uppercase">{t('settings.deleteAccountTitle')}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    {t('settings.deleteAccountDesc')}
                  </p>
                </div>
                <button
                  onClick={() => {
                    resetDeleteAccountState();
                    setShowDeleteAccountModal(true);
                  }}
                  disabled={userRole === 'admin' || userRole === 'super_admin'}
                  className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-white text-xs font-bold uppercase tracking-wider touch-feedback disabled:opacity-50 transition-colors disabled:bg-zinc-800 hover:bg-red-700"
                >
                  <Trash2 size={12} />
                  {t('settings.confirmDeleteAccountAction')}
                </button>
              </div>
              {(userRole === 'admin' || userRole === 'super_admin') && (
                <p className="mt-2 text-[10px] text-zinc-500 font-mono">
                  {t('settings.adminDeleteAccountHint')}
                </p>
              )}
            </div>
          </div>
        </MobileSettingsSection>
      )}

      {/* 退出登录 */}
      {user && (
        <button
          onClick={signOut}
          className="w-full flex items-center justify-center gap-2 rounded-[1.05rem] border border-zinc-200 bg-zinc-50/75 py-4 text-xs font-bold uppercase tracking-widest text-slate-500 hover:border-rose-300 hover:text-rose-500 touch-feedback transition-colors dark:border-white/8 dark:bg-white/[0.03] dark:text-zinc-400 dark:hover:border-rose-400/20 dark:hover:text-rose-300"
        >
          <LogOut size={16} />
          {t('nav.logout')}
        </button>
      )}

      {/* 版本信息 */}
      <div className="mobile-ux-card p-4 text-center">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/10" />
        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-zinc-400">{t('app.brand')}</p>
        <p className="mt-1 text-[10px] font-mono text-zinc-500">{siteVersion}</p>
      </div>

      {/* 底部留白 */}
      <div className="h-4" />

      <UsernameEditDialog
        open={showUsernameModal}
        onClose={() => setShowUsernameModal(false)}
        user={user}
        currentUsername={currentUsername}
        currentUsernameHandle={currentUsernameHandle}
        onSubmit={handleUsernameSubmit}
        variant="mobile"
      />

      {/* 更换邮箱弹窗 */}
      {showEmailModal && (
        <div className="mobile-ux-modal">
          <div className="mobile-ux-modal-card animate-scale-up">
            <div className="mobile-ux-modal-header">
              <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-900 dark:text-zinc-100">
                <Mail size={16} />
                {t('settings.emailModalTitle')}
              </h3>
              <button
                onClick={() => {
                  setShowEmailModal(false);
                  resetEmailModalState();
                }}
                className="rounded-full border border-zinc-200 bg-zinc-50 p-1 touch-feedback transition-colors hover:bg-zinc-100 dark:border-white/8 dark:bg-white/5 dark:hover:bg-white/10"
              >
                <X size={18} className="text-slate-500 dark:text-zinc-400" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {emailMergeOffer ? (
                <OAuthEmailMergeFlow
                  targetEmail={emailMergeOffer.targetEmail}
                  initialMaskedEmail={emailMergeOffer.maskedEmail}
                  variant="mobile"
                  onCancel={() => setEmailMergeOffer(null)}
                  onCompleted={(result) => {
                    const nextUser = result?.session?.user;
                    if (nextUser?.id) {
                      setUser(nextUser);
                    }
                    setAccountSecurityState((prev) => ({
                      ...(prev || {}),
                      emailVerificationRequired: false,
                      emailVerificationVerifiedAt: new Date().toISOString(),
                      emailVerificationTargetEmail: result?.data?.email || emailMergeOffer.targetEmail,
                    }));
                    setEmailSuccess(t('settings.oauthEmailMerge.completedMessage'));
                    showToast(t('settings.oauthEmailMerge.completedMessage'), 'success');
                  }}
                  onDone={() => {
                    setShowEmailModal(false);
                    resetEmailModalState();
                    setShowPasswordModal(true);
                  }}
                />
              ) : (
                <>
              <p className="text-xs leading-relaxed text-slate-500 dark:text-zinc-400">
                {oauthPasswordSetupRequired ? t('settings.oauthEmailSetupModalDesc') : t('settings.emailModalDesc')}
              </p>
              {emailError && (
                <div className="mobile-ux-soft-card mobile-ux-soft-card--danger flex items-start gap-2 px-3 py-2 text-xs text-red-300">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>{emailError}</span>
                </div>
              )}
              {emailSuccess && (
                <div className="mobile-ux-soft-card mobile-ux-soft-card--success flex items-start gap-2 px-3 py-2 text-xs text-emerald-300">
                  <Mail size={14} className="shrink-0 mt-0.5" />
                  <span>{emailSuccess}</span>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">
                    {t('settings.newEmail')}
                  </label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(event) => setNewEmail(event.target.value)}
                    placeholder={t('settings.newEmailPlaceholder')}
                    className="mobile-ux-input px-4 py-3 text-sm font-mono"
                  />
                </div>
                {!oauthPasswordSetupRequired && (
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">
                      {t('settings.currentPassword')}
                    </label>
                    <input
                      type="password"
                      value={emailCurrentPassword}
                      onChange={(event) => setEmailCurrentPassword(event.target.value)}
                      placeholder={t('settings.currentPasswordPlaceholder')}
                      className="mobile-ux-input px-4 py-3 text-sm font-mono"
                    />
                  </div>
                )}
              </div>

              <button
                onClick={handleEmailChangeRequest}
                disabled={emailLoading || !!emailSuccess}
                className="w-full rounded-full bg-endfield-yellow py-3 text-xs font-bold uppercase tracking-widest text-black touch-feedback disabled:opacity-50 transition-colors hover:bg-yellow-400 disabled:bg-zinc-700"
              >
                {emailLoading ? t('settings.emailChangeSending') : emailSuccess ? t('settings.emailChangeSent') : t('settings.emailChangeAction')}
              </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 修改密码弹窗 */}
      {showPasswordModal && (
        <div className="mobile-ux-modal">
          <div className="mobile-ux-modal-card animate-scale-up">
            <div className="mobile-ux-modal-header">
              <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-900 dark:text-zinc-100">
                <Lock size={16} />
                {oauthPasswordSetupRequired ? t('settings.passwordSetupModalTitle') : t('settings.passwordModalTitle')}
              </h3>
              <button
                onClick={() => {
                  setShowPasswordModal(false);
                  resetPasswordModalState();
                }}
                className="rounded-full border border-zinc-200 bg-zinc-50 p-1 touch-feedback transition-colors hover:bg-zinc-100 dark:border-white/8 dark:bg-white/5 dark:hover:bg-white/10"
              >
                <X size={18} className="text-slate-500 dark:text-zinc-400" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {passwordError && (
                <div className="mobile-ux-soft-card mobile-ux-soft-card--danger flex items-start gap-2 px-3 py-2 text-xs text-red-300">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>{passwordError}</span>
                </div>
              )}
              {passwordSuccess && (
                <div className="mobile-ux-soft-card mobile-ux-soft-card--success flex items-start gap-2 px-3 py-2 text-xs text-emerald-300">
                  <Lock size={14} className="shrink-0 mt-0.5" />
                  <span>{passwordSuccess}</span>
                </div>
              )}

              <div className="space-y-3">
                {oauthPasswordSetupRequired ? (
                  <div className="rounded-[0.95rem] border border-amber-300/60 bg-amber-50 px-3 py-3 text-[11px] leading-5 text-amber-800 dark:border-amber-700/70 dark:bg-amber-500/10 dark:text-amber-200">
                    {t('settings.passwordSetupVerifiedEmailHint')}
                  </div>
                ) : (
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">
                      {t('settings.currentPassword')}
                    </label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      placeholder={t('settings.currentPasswordPlaceholder')}
                      className="mobile-ux-input px-4 py-3 text-sm font-mono"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">
                    {t('settings.newPassword')}
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder={t('settings.newPasswordPlaceholder')}
                    className="mobile-ux-input px-4 py-3 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">
                    {t('settings.confirmNewPassword')}
                  </label>
                  <input
                    type="password"
                    value={confirmNewPassword}
                    onChange={(event) => setConfirmNewPassword(event.target.value)}
                    placeholder={t('settings.confirmNewPasswordPlaceholder')}
                    className="mobile-ux-input px-4 py-3 text-sm font-mono"
                  />
                  {confirmNewPassword && newPassword !== confirmNewPassword && (
                    <p className="mt-2 text-[10px] text-red-500">{t('settings.passwordMismatchInline')}</p>
                  )}
                </div>
              </div>

              <button
                onClick={handlePasswordReset}
                disabled={passwordLoading || !!passwordSuccess}
                className="w-full rounded-full bg-endfield-yellow py-3 text-xs font-bold uppercase tracking-widest text-black touch-feedback disabled:opacity-50 transition-colors hover:bg-yellow-400 disabled:bg-zinc-700"
              >
                {passwordLoading ? t('settings.passwordUpdating') : passwordSuccess ? t('settings.passwordUpdated') : oauthPasswordSetupRequired ? t('settings.passwordSetupAction') : t('settings.passwordUpdateAction')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除数据确认弹窗 */}
      {showDeleteModal && (
        <div className="mobile-ux-modal">
          <div className="mobile-ux-modal-card animate-scale-up border border-red-400/30">
            <div className="p-6 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[1rem] border border-red-400/30 bg-red-500/10 text-red-300">
                <AlertTriangle size={32} />
              </div>
              <h3 className="mb-1 text-lg font-bold uppercase tracking-wide text-slate-900 dark:text-zinc-100">{t('settings.deleteDataModalTitle')}</h3>
              <p className="text-xs text-slate-500 dark:text-zinc-500 mb-4 font-mono">{t('settings.deleteDataIrreversible')}</p>
              {deleteError && (
                <div className="mobile-ux-soft-card mobile-ux-soft-card--danger mb-4 flex items-start gap-2 px-3 py-2 text-xs text-red-300">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>{deleteError}</span>
                </div>
              )}

              <div className="mobile-ux-soft-card mobile-ux-soft-card--danger mb-4 p-3 text-left">
                <p className="text-[10px] text-red-400 uppercase font-bold mb-2">{t('settings.deleteDataTargetTitle')}</p>
                <ul className="space-y-1 font-mono text-xs text-red-300">
                  <li>[x] {t('settings.deleteDataTargetPools', { count: userPoolCount })}</li>
                  <li>[x] {t('settings.deleteDataTargetHistory', { count: userHistoryCount })}</li>
                </ul>
              </div>
              <p className="text-xs text-zinc-500 mb-3">
                {t('settings.deleteDataModalKeepAccount')}
              </p>

              <p className="text-xs text-zinc-500 mb-3">
                {t('settings.deleteDataConfirmPrompt', { phrase: deletePhrase })}
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={t('settings.deleteDataPlaceholder')}
                className="mobile-ux-input mb-4 px-4 py-3 text-sm font-mono"
              />
            </div>
            <div className="mobile-ux-modal-footer">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmText('');
                  setDeleteError('');
                }}
                className="flex-1 rounded-full border border-zinc-200 bg-zinc-50 py-3 text-xs font-bold uppercase tracking-wider text-slate-600 touch-feedback dark:border-white/8 dark:bg-white/[0.03] dark:text-zinc-300"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeleteAllData}
                disabled={deleteConfirmText !== deletePhrase || deleteLoading}
                className="flex-1 rounded-full bg-red-600 py-3 text-xs font-bold uppercase tracking-wider text-white touch-feedback disabled:opacity-50 transition-colors hover:bg-red-700 disabled:bg-zinc-800"
              >
                {deleteLoading ? t('settings.deleteDataProgress') : t('settings.deleteDataAction')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteAccountModal && (
        <div className="mobile-ux-modal">
          <div className="mobile-ux-modal-card">
            <div className="mobile-ux-modal-header">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-red-500" />
                <span className="text-sm font-bold text-red-300 uppercase tracking-wide">{t('settings.deleteAccountModalTitle')}</span>
              </div>
              <button
                onClick={() => {
                  setShowDeleteAccountModal(false);
                  resetDeleteAccountState();
                }}
                className="text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {deleteAccountError && (
                <div className="mobile-ux-soft-card mobile-ux-soft-card--danger px-3 py-2 text-xs text-red-300">
                  {deleteAccountError}
                </div>
              )}

              <div className="mobile-ux-soft-card mobile-ux-soft-card--danger px-3 py-3 text-xs text-red-300 space-y-1">
                <p>• {t('settings.deleteAccountWarning1')}</p>
                <p>• {t('settings.deleteAccountWarning2')}</p>
                <p>• {t('settings.deleteAccountWarning3')}</p>
                <p>• {t('settings.deleteAccountWarning4')}</p>
                <p>• {t('settings.deleteAccountWarning5')}</p>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">
                  {t('settings.currentPassword')}
                </label>
                <input
                  type="password"
                  value={deleteAccountPassword}
                  onChange={(event) => setDeleteAccountPassword(event.target.value)}
                  placeholder={t('settings.currentPasswordPlaceholder')}
                  className="mobile-ux-input px-3 py-3 text-sm"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">
                  {t('settings.confirmPhrase')}
                </label>
                <input
                  type="text"
                  value={deleteAccountConfirmText}
                  onChange={(event) => setDeleteAccountConfirmText(event.target.value)}
                  placeholder={t('settings.confirmDeleteAccountPlaceholder')}
                  className="mobile-ux-input px-3 py-3 text-sm"
                />
              </div>
            </div>

            <div className="mobile-ux-modal-footer">
              <button
                onClick={() => {
                  setShowDeleteAccountModal(false);
                  resetDeleteAccountState();
                }}
                className="flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-600 dark:border-white/8 dark:bg-white/[0.03] dark:text-zinc-300"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteAccountLoading || deleteAccountConfirmText !== deleteAccountPhrase}
                className="flex-1 rounded-full bg-red-600 px-4 py-2 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 hover:bg-red-700 disabled:bg-zinc-700"
              >
                {deleteAccountLoading ? t('settings.deleteAccountProgress') : t('settings.confirmDeleteAccountAction')}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

export default MobileSettingsView;
