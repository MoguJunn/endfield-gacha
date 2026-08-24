import React from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileSearch,
  Github,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  LogIn,
  Mail,
  Plus,
  RefreshCw,
  Trash2,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import { ACCOUNT_RECOVERY_QQ_GROUP, ENGLISH_COMMUNITY_DISCORD_URL } from '../../constants/community';
import { useI18n } from '../../i18n/index.js';
import AuthCaptchaBox from '../captcha/AuthCaptchaBox.jsx';

export default function AuthModalView({
  agreedToTerms,
  confirmPassword,
  email,
  emailDomainError,
  emailValid,
  error,
  forgotPasswordStatus,
  hasEmailError,
  captchaAction,
  captchaReady,
  captchaResetKey,
  onCaptchaStateChange,
  loading,
  message,
  mode,
  onAgreedToTermsChange,
  onClose,
  onConfirmPasswordChange,
  onEmailChange,
  emailCodeAction,
  emailCodeLoading,
  emailCodeValue,
  emailLoginSendCount,
  passwordResetSendCount,
  onPasswordChange,
  onAddRecoveryClaim,
  onSubmit,
  onEmailLogin,
  onEmailCodeChange,
  onEmailCodeSubmit,
  onSkipEmailLoginCode,
  onSkipPasswordResetEmail,
  oauthProviders,
  onOAuthLogin,
  onSubmitRecoveryRequest,
  onSwitchMode,
  onSwitchToForgotPassword,
  onSwitchToLoginWithEmail,
  onOpenRecoveryRequest,
  onCloseRecoveryRequest,
  onRecoveryClaimChange,
  onRecoveryClaimedAccountCountChange,
  onRecoveryNoteChange,
  onRemoveRecoveryClaim,
  onUsernameChange,
  password,
  recoveryRequestError,
  recoveryRequestForm,
  recoveryRequestLoading,
  recoverySubmitDisabled,
  recoveryRequestSuccess,
  resendCooldown,
  showDuplicateEmailPrompt,
  submitDisabled,
  emailLoginDisabled,
  username,
}) {
  const { isEnglish } = useI18n();
  const tt = React.useCallback((zh, en) => (isEnglish ? en : zh), [isEnglish]);
  const hasOAuthProviders = mode === 'login' && Array.isArray(oauthProviders) && oauthProviders.length > 0;
  const recoveryRequestTypeLabel =
    recoveryRequestForm.requestType === 'delete_account'
      ? tt('注销旧账号', 'Delete Old Account')
      : tt('申请人工恢复', 'Manual Recovery');
  const submitButtonRef = React.useRef(null);
  const captchaWasReadyRef = React.useRef(captchaReady === true);

  React.useEffect(() => {
    const becameReady = mode === 'register' && captchaReady === true && !captchaWasReadyRef.current;
    captchaWasReadyRef.current = captchaReady === true;
    if (!becameReady) return;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const scheduleFrame = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 0));
    scheduleFrame(() => {
      submitButtonRef.current?.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'nearest',
      });
    });
  }, [captchaReady, mode]);

  return (
    <div
      className="auth-modal-backdrop-enter fixed inset-0 z-[80] overflow-y-auto overscroll-contain bg-black/65 p-2 backdrop-blur-sm sm:p-4"
      onClick={onClose}
    >
      <div className="flex min-h-full items-start justify-center sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        className="auth-modal-panel-enter my-auto flex max-h-[calc(100dvh-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-none border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:max-h-[calc(100dvh-2rem)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative shrink-0 border-b-4 border-endfield-yellow bg-gradient-to-r from-zinc-900 to-zinc-800 p-4 text-white dark:from-zinc-950 dark:to-zinc-900 sm:p-6">
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                               linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
                backgroundSize: '20px 20px',
              }}
            />
          </div>

          <button
            type="button"
            aria-label={tt('关闭账号窗口', 'Close account dialog')}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            className="absolute right-3 top-3 z-50 p-1.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white sm:right-4 sm:top-4"
          >
            <X size={20} />
          </button>

          <div className="relative z-10">
            <div className="mb-1.5 flex items-center gap-2.5 sm:mb-2 sm:gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center bg-endfield-yellow sm:h-10 sm:w-10">
                {mode === 'login' ? <LogIn size={20} className="text-black" /> :
                  mode === 'register' ? <UserPlus size={20} className="text-black" /> :
                    <KeyRound size={20} className="text-black" />}
              </div>
              <div>
                <h2 id="auth-modal-title" className="font-mono text-base font-bold tracking-tight sm:text-xl">
                  {mode === 'login' ? 'SIGN IN' : mode === 'register' ? 'REGISTER' : 'ACCOUNT RECOVERY'}
                </h2>
                <p className="text-zinc-400 text-xs uppercase tracking-widest leading-tight">
                  {mode === 'login'
                    ? tt('登录账户', 'Account Access')
                    : mode === 'register'
                      ? tt('创建新账户', 'Create Account')
                      : tt('账号恢复', 'Recovery Flow')}
                </p>
              </div>
            </div>
            <p className="mt-2 pr-6 text-xs leading-relaxed text-zinc-300 sm:mt-3 sm:pr-0 sm:text-sm">
              {mode === 'login'
                ? tt('登录以同步你的抽卡数据到云端', 'Sign in to sync your pull history to the cloud.')
                : mode === 'register'
                  ? tt('注册后可以先进入网站使用；邮箱验证可稍后在设置页完成。', 'You can use the site right after registration. Email verification can be completed later in Settings.')
                  : tt(
                    '输入邮箱地址，系统会优先发送密码重置邮件。多次收不到邮件时，再提交人工恢复申请。',
                    'Enter your email address. We will send a password reset email first. Use manual recovery only if emails repeatedly do not arrive.'
                  )}
            </p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          data-testid="auth-modal-scroll-region"
          className="auth-modal-scroll-region min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-slate-50 p-4 max-sm:[&_input:not([type='checkbox'])]:!py-2.5 dark:bg-zinc-950 sm:space-y-4 sm:p-6"
        >
          {message && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-4 py-3 rounded-none text-sm">
              <div className="flex items-start gap-2">
                <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
                <span>{message}</span>
              </div>
            </div>
          )}

          {error && !showDuplicateEmailPrompt && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-none text-sm flex items-start gap-2">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {showDuplicateEmailPrompt && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-none p-4">
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-amber-800 dark:text-amber-300 font-medium mb-2">
                    {tt('该邮箱已被注册', 'This Email Is Already Registered')}
                  </p>
                  <p className="text-sm text-amber-700 dark:text-amber-400 mb-3">
                    {tt('邮箱 ', 'The address ')}
                    <span className="font-mono bg-amber-100 dark:bg-amber-900/30 px-1 py-0.5 break-all">{email}</span>
                    {tt(' 已经注册过账号。', ' already has an account.')}
                  </p>
                  <button
                    type="button"
                    onClick={onSwitchToLoginWithEmail}
                    className="w-full min-h-[44px] bg-endfield-yellow hover:bg-yellow-400 text-black font-bold uppercase tracking-wider py-2 px-4 rounded-none transition-colors text-sm whitespace-normal text-center leading-tight"
                  >
                    {tt('使用此邮箱登录', 'Sign In Instead')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {mode === 'register' && (
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider mb-2">
                {tt('用户名', 'Username')} <span className="text-slate-400 dark:text-zinc-600 font-normal">{tt('(可选)', '(Optional)')}</span>
              </label>
              <div className="relative">
                <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
                <input
                  type="text"
                  value={username}
                  onChange={onUsernameChange}
                  placeholder={tt('显示名称', 'Display name')}
                  className="w-full pl-10 pr-4 py-3 border border-zinc-200 dark:border-zinc-700 rounded-none bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-600 focus:ring-2 focus:ring-endfield-yellow focus:border-endfield-yellow outline-none transition-all"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider mb-2">
              {tt('邮箱地址', 'Email Address')}
            </label>
            <div className="relative">
              <Mail
                size={18}
                className={`absolute left-3 top-1/2 -translate-y-1/2 transition-colors ${
                  hasEmailError ? 'text-red-500' : 'text-slate-400 dark:text-zinc-500'
                }`}
              />
              <input
                type="email"
                value={email}
                onChange={onEmailChange}
                placeholder="your@email.com"
                required
                className={`w-full pl-10 pr-4 py-3 border rounded-none bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-600 outline-none transition-all ${
                  hasEmailError
                    ? 'border-red-300 dark:border-red-700 focus:ring-2 focus:ring-red-500 focus:border-red-500'
                    : 'border-zinc-200 dark:border-zinc-700 focus:ring-2 focus:ring-endfield-yellow focus:border-endfield-yellow'
                }`}
              />
            </div>
            {email && !emailValid && (
              <p className="text-xs text-red-500 dark:text-red-400 mt-1 flex items-center gap-1">
                <AlertCircle size={12} />
                {tt('请输入有效的邮箱地址', 'Enter a valid email address.')}
              </p>
            )}
            {mode === 'register' && emailValid && emailDomainError && (
              <p className="text-xs text-red-500 dark:text-red-400 mt-1 flex items-start gap-1">
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                <span>{emailDomainError}</span>
              </p>
            )}
          </div>

          {mode === 'forgotPassword' && forgotPasswordStatus === 'checked' && (
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-none p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={20} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-emerald-800 dark:text-emerald-300 font-medium mb-2">
                    {tt('重置邮件请求已接收', 'Reset Email Request Received')}
                  </p>
                  <p className="text-sm text-emerald-700 dark:text-emerald-400 mb-3">
                    {tt(
                      '如果该邮箱存在可恢复账号，你会收到一封带按钮的密码重置邮件。为了保护账号安全，页面不会确认邮箱是否存在。',
                      'If this email matches a recoverable account, you will receive a styled password reset email. To protect accounts, this page does not confirm whether the address exists.'
                    )}
                  </p>
                  <div className="mb-3 border border-emerald-200 dark:border-emerald-800 bg-white/70 dark:bg-black/20 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
                    {tt(
                      '请检查收件箱、垃圾邮件夹和邮箱规则。若连续多次收不到邮件，或你已经无法访问该邮箱，再使用下方人工恢复。',
                      'Check inbox, spam, and mailbox rules. If email still does not arrive after repeated attempts, or you no longer have access to the mailbox, use manual recovery below.'
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenRecoveryRequest('password_reset')}
                      className={`min-h-[52px] px-3 py-2 text-sm font-bold uppercase tracking-wider transition-colors whitespace-normal text-center leading-tight ${
                        recoveryRequestForm.requestType === 'password_reset'
                          ? 'bg-endfield-yellow text-black'
                          : 'bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700'
                      }`}
                    >
                      {tt('收不到邮件，人工恢复', 'No Email, Manual Recovery')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenRecoveryRequest('delete_account')}
                      className={`min-h-[52px] px-3 py-2 text-sm font-bold uppercase tracking-wider transition-colors whitespace-normal text-center leading-tight ${
                        recoveryRequestForm.requestType === 'delete_account'
                          ? 'bg-red-600 text-white'
                          : 'bg-white text-red-600 border border-red-300 hover:bg-red-50 dark:bg-transparent dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20'
                      }`}
                    >
                      {tt('申请注销旧账号', 'Delete Old Account')}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={onSwitchToLoginWithEmail}
                    className="w-full mt-2 min-h-[44px] bg-endfield-yellow hover:bg-yellow-400 text-black font-bold uppercase tracking-wider py-2 px-4 rounded-none transition-colors text-sm whitespace-normal text-center leading-tight"
                  >
                    {tt('返回登录', 'Back to Sign In')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {mode === 'forgotPassword' && forgotPasswordStatus === 'checked' && recoveryRequestForm.requestType && (
            <div className="border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-700 dark:text-zinc-200 flex items-center gap-2">
                    <FileSearch size={16} className="text-endfield-yellow" />
                    {recoveryRequestTypeLabel}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-zinc-500 mt-1">
                    {tt(
                      '仅在多次收不到重置邮件、邮箱不可访问或需要注销旧账号时填写。请尽量填写你曾上传过的 UID 和游戏内昵称。',
                      'Use this only when reset emails repeatedly do not arrive, the mailbox is unavailable, or you need to delete an old account. Add UIDs and in-game names you uploaded before.'
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onCloseRecoveryRequest}
                  className="text-xs text-slate-500 dark:text-zinc-500 hover:text-endfield-yellow transition-colors"
                >
                  {tt('收起', 'Collapse')}
                </button>
              </div>

              {recoveryRequestSuccess && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-4 py-3 text-sm">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">{tt('恢复申请已提交', 'Request Submitted')}</div>
                      <div className="mt-1">
                        {tt(
                          '管理员会根据你填写的 UID、昵称和说明进行人工核验。通过后会按人工恢复流程继续处理。',
                          'An administrator will verify the UID, nickname, and notes you provided, then continue the manual recovery flow if approved.'
                        )}
                      </div>
                      <div className="mt-2">
                        {isEnglish ? (
                          <>
                            If the request is approved and the password is reset, join
                            {' '}
                            <a
                              href={ENGLISH_COMMUNITY_DISCORD_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-bold underline underline-offset-2"
                            >
                              Discord
                            </a>
                            {' '}
                            to receive the temporary password.
                          </>
                        ) : (
                          <>
                            若超管核验通过并已重置密码，请加入 QQ 群
                            {' '}
                            <span className="font-mono font-bold">{ACCOUNT_RECOVERY_QQ_GROUP}</span>
                            {' '}
                            获取临时密码。
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {recoveryRequestError && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 text-sm flex items-start gap-2">
                  <AlertCircle size={18} className="shrink-0 mt-0.5" />
                  <span>{recoveryRequestError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider mb-2">
                  {tt('你曾上传过几个账号', 'How Many Accounts Have You Uploaded')}
                </label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={recoveryRequestForm.claimedAccountCount}
                  onChange={onRecoveryClaimedAccountCountChange}
                  className="w-full px-4 py-3 border border-zinc-200 dark:border-zinc-700 rounded-none bg-white dark:bg-zinc-950 text-slate-800 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-endfield-yellow focus:border-endfield-yellow"
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="block text-xs font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider">
                    {tt('身份核验信息', 'Verification Clues')}
                  </label>
                  <button
                    type="button"
                    onClick={onAddRecoveryClaim}
                    className="text-xs font-bold uppercase tracking-wider text-endfield-yellow hover:text-yellow-500 flex items-center gap-1"
                  >
                    <Plus size={12} />
                    {tt('新增一组', 'Add Clue')}
                  </button>
                </div>

                {recoveryRequestForm.verificationClaims.map((claim, index) => (
                  <div key={`claim-${index}`} className="border border-zinc-200 dark:border-zinc-700 p-3 space-y-3 bg-slate-50 dark:bg-zinc-950">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">
                        {tt(`账号线索 ${index + 1}`, `Clue ${index + 1}`)}
                      </span>
                      {recoveryRequestForm.verificationClaims.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onRemoveRecoveryClaim(index)}
                          className="text-xs text-red-500 hover:text-red-400 flex items-center gap-1"
                        >
                          <Trash2 size={12} />
                          {tt('删除', 'Remove')}
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <input
                        type="text"
                        value={claim.gameUid}
                        onChange={(event) => onRecoveryClaimChange(index, 'gameUid', event.target.value)}
                        placeholder={tt('游戏 UID', 'Game UID')}
                        className="w-full px-4 py-3 border border-zinc-200 dark:border-zinc-700 rounded-none bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-endfield-yellow focus:border-endfield-yellow"
                      />
                      <input
                        type="text"
                        value={claim.nickName}
                        onChange={(event) => onRecoveryClaimChange(index, 'nickName', event.target.value)}
                        placeholder={tt('游戏内昵称', 'In-game Name')}
                        className="w-full px-4 py-3 border border-zinc-200 dark:border-zinc-700 rounded-none bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-endfield-yellow focus:border-endfield-yellow"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider mb-2">
                  {tt('补充说明', 'Additional Notes')}
                </label>
                <textarea
                  value={recoveryRequestForm.note}
                  onChange={onRecoveryNoteChange}
                  placeholder={
                    recoveryRequestForm.requestType === 'delete_account'
                      ? tt('请说明为什么需要注销旧账号，以及你后续是否会重新注册。', 'Explain why the old account should be deleted and whether you plan to sign up again.')
                      : tt('可补充上传时间、常用卡池、历史角色或其他只有你本人知道的信息。', 'Add upload timing, common banners, past characters, or any details that only you should know.')
                  }
                  className="w-full min-h-[100px] px-4 py-3 border border-zinc-200 dark:border-zinc-700 rounded-none bg-white dark:bg-zinc-950 text-slate-800 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-endfield-yellow focus:border-endfield-yellow"
                />
              </div>

              <button
                type="button"
                onClick={onSubmitRecoveryRequest}
                disabled={recoverySubmitDisabled ?? recoveryRequestLoading}
                className="w-full min-h-[48px] bg-endfield-yellow hover:bg-yellow-400 disabled:bg-yellow-300 dark:disabled:bg-yellow-600 disabled:cursor-not-allowed text-black font-bold uppercase tracking-wider py-3 rounded-none flex items-center justify-center gap-2 transition-colors whitespace-normal text-center leading-tight"
              >
                {recoveryRequestLoading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <FileSearch size={18} />
                )}
                {tt(`提交${recoveryRequestTypeLabel}`, 'Submit Request')}
              </button>
            </div>
          )}

          {mode !== 'forgotPassword' && (
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider mb-2">
                {tt('密码', 'Password')}
              </label>
              <div className="relative">
                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
                <input
                  type="password"
                  value={password}
                  onChange={onPasswordChange}
                  placeholder={mode === 'register' ? tt('至少 8 位字符，包含两类字符', 'At least 8 characters with two character groups') : tt('输入密码', 'Enter password')}
                  required
                  minLength={mode === 'register' ? 8 : undefined}
                  className="w-full pl-10 pr-4 py-3 border border-zinc-200 dark:border-zinc-700 rounded-none bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-600 focus:ring-2 focus:ring-endfield-yellow focus:border-endfield-yellow outline-none transition-all"
                />
              </div>
              {mode === 'login' && (
                <div className="mt-2 text-right">
                  <button
                    type="button"
                    onClick={onSwitchToForgotPassword}
                    className="text-xs text-slate-500 dark:text-zinc-500 hover:text-endfield-yellow transition-colors"
                  >
                    {tt('账号恢复', 'Account Recovery')}
                  </button>
                </div>
              )}
              {mode === 'register' && password && (
                <div className="mt-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          password.length < 8
                            ? 'w-1/3 bg-red-500'
                            : password.length < 12
                              ? 'w-2/3 bg-amber-500'
                              : 'w-full bg-green-500'
                        }`}
                      />
                    </div>
                    <span
                      className={`text-xs font-medium ${
                        password.length < 8
                          ? 'text-red-500'
                          : password.length < 12
                            ? 'text-amber-500'
                            : 'text-green-500'
                      }`}
                    >
                      {password.length < 8 ? tt('弱', 'Weak') : password.length < 12 ? tt('中', 'Medium') : tt('强', 'Strong')}
                    </span>
                  </div>
                  {password.length < 8 && (
                    <p className="text-xs text-slate-500 dark:text-zinc-500 mt-1">
                      {tt('至少需要 8 位字符，并包含两类字符。', 'Use at least 8 characters and two character groups.')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {mode === 'register' && (
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider mb-2">
                {tt('确认密码', 'Confirm Password')}
              </label>
              <div className="relative">
                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={onConfirmPasswordChange}
                  placeholder={tt('再次输入密码', 'Enter password again')}
                  required
                  className="w-full pl-10 pr-4 py-3 border border-zinc-200 dark:border-zinc-700 rounded-none bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-600 focus:ring-2 focus:ring-endfield-yellow focus:border-endfield-yellow outline-none transition-all"
                />
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-red-500 dark:text-red-400 mt-1 flex items-center gap-1">
                  <AlertCircle size={12} />
                  {tt('两次输入的密码不一致', 'The passwords do not match.')}
                </p>
              )}
              {confirmPassword && password === confirmPassword && password.length >= 8 && (
                <p className="text-xs text-green-500 dark:text-green-400 mt-1 flex items-center gap-1">
                  <CheckCircle2 size={12} />
                  {tt('密码一致', 'Passwords match')}
                </p>
              )}
            </div>
          )}

          {emailCodeAction && (
            <div className="border border-endfield-yellow/50 bg-yellow-50 dark:bg-yellow-500/10 px-4 py-4 space-y-3">
              <div className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200">
                <KeyRound size={18} className="mt-0.5 shrink-0" />
                <div>
                  <div className="font-bold">
                    {emailCodeAction === 'password_reset'
                      ? tt('输入重置验证码', 'Enter Reset Code')
                      : tt('输入邮件登录验证码', 'Enter Sign-In Code')}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-300">
                    {tt(
                      '请复制邮件中的 6 位验证码。无需在邮箱中打开链接，也不会切走当前页面。',
                      'Copy the 6-digit code from the email. You do not need to open a mail link or leave this page.'
                    )}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-300">
                    {emailCodeAction === 'password_reset'
                      ? tt(
                        `已尝试发送 ${passwordResetSendCount || 1} 次。若仍收不到邮件，可重新发送或改用人工恢复。`,
                        `Sent ${passwordResetSendCount || 1} time(s). If it still does not arrive, resend or use manual recovery.`
                      )
                      : tt(
                        `已尝试发送 ${emailLoginSendCount || 1} 次。若仍收不到邮件，可重新发送或改用密码登录。`,
                        `Sent ${emailLoginSendCount || 1} time(s). If it still does not arrive, resend or use password sign-in.`
                      )}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={emailCodeValue}
                  onChange={onEmailCodeChange}
                  placeholder="000000"
                  maxLength={6}
                  className="w-full px-4 py-3 border border-amber-300 dark:border-amber-700 rounded-none bg-white dark:bg-zinc-950 text-slate-900 dark:text-zinc-100 text-center font-mono text-xl tracking-[0.35em] outline-none focus:ring-2 focus:ring-endfield-yellow focus:border-endfield-yellow"
                />
                <button
                  type="button"
                  onClick={onEmailCodeSubmit}
                  disabled={emailCodeLoading || String(emailCodeValue || '').length !== 6}
                  className="min-h-[48px] px-4 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white disabled:opacity-60 disabled:cursor-not-allowed text-white dark:text-zinc-900 font-bold uppercase tracking-wider text-xs transition-colors flex items-center justify-center gap-2"
                >
                  {emailCodeLoading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  {emailCodeAction === 'password_reset'
                    ? tt('验证并重置', 'Verify')
                    : tt('验证并登录', 'Verify')}
                </button>
              </div>
              {(
                (emailCodeAction === 'password_reset' && (passwordResetSendCount || 0) >= 2)
                || (emailCodeAction === 'email_login' && (emailLoginSendCount || 0) >= 2)
              ) && (
                <div className="border border-amber-200 dark:border-amber-800 bg-white/70 dark:bg-black/20 p-3 text-xs leading-5 text-amber-800 dark:text-amber-200">
                  <p>
                    {emailCodeAction === 'password_reset'
                      ? tt(
                        '如果两次都没有收到邮件，可以暂时跳过邮件验证码，改走人工恢复。账号注册后的邮箱验证也可以稍后在设置页完成。',
                        'If two messages did not arrive, skip the mail code for now and use manual recovery. Email verification after registration can also be completed later in Settings.'
                      )
                      : tt(
                        '如果两次都没有收到邮件，可以暂时跳过邮件登录，改用邮箱密码登录。登录后仍可在设置页完成邮箱验证。',
                        'If two messages did not arrive, skip email sign-in for now and use email plus password. You can still verify email later in Settings.'
                      )}
                  </p>
                  <button
                    type="button"
                    onClick={emailCodeAction === 'password_reset' ? onSkipPasswordResetEmail : onSkipEmailLoginCode}
                    className="mt-2 min-h-[38px] w-full border border-amber-300 dark:border-amber-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-200 transition-colors hover:bg-amber-50 dark:hover:bg-amber-900/20"
                  >
                    {emailCodeAction === 'password_reset'
                      ? tt('收不到邮件，改用人工恢复', 'Use Manual Recovery')
                      : tt('暂时跳过，改用密码登录', 'Use Password Sign-In')}
                  </button>
                </div>
              )}
            </div>
          )}

          {mode === 'register' && (
            <label className="flex items-start gap-2 cursor-pointer mt-2">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={onAgreedToTermsChange}
                className="mt-0.5 accent-endfield-yellow"
              />
              <span className="text-xs text-slate-500 dark:text-zinc-500">
                {tt('我已阅读并同意', 'I have read and agree to the')}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-endfield-yellow hover:underline mx-0.5">{tt('隐私政策', 'Privacy Policy')}</a>
                {tt('和', 'and')}
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-endfield-yellow hover:underline mx-0.5">{tt('用户协议', 'Terms of Service')}</a>
              </span>
            </label>
          )}

          {captchaAction && (
            <AuthCaptchaBox
              key={`${captchaAction}:${captchaResetKey}`}
              action={captchaAction}
              onStateChange={onCaptchaStateChange}
            />
          )}

          <button
            ref={submitButtonRef}
            type="submit"
            disabled={submitDisabled}
            className="mt-2 flex min-h-[48px] w-full items-center justify-center gap-2 bg-endfield-yellow py-3 text-center font-bold uppercase leading-tight tracking-wider text-black shadow-lg transition-[background-color,transform,box-shadow] hover:-translate-y-0.5 hover:bg-yellow-400 hover:shadow-xl disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-yellow-300 disabled:shadow-none dark:disabled:bg-yellow-600 sm:mt-6"
          >
            {loading ? (
              <Loader2 size={20} className="animate-spin" />
            ) : mode === 'login' ? (
              <>
                <LogIn size={20} />
                {tt('登录', 'Sign In')}
              </>
            ) : mode === 'register' ? (
              <>
                <UserPlus size={20} />
                {captchaReady === false ? tt('等待验证', 'Waiting for Verification') : tt('创建账号', 'Create Account')}
              </>
            ) : resendCooldown > 0 ? (
              <>
                <RefreshCw size={20} />
                {tt(`${resendCooldown}秒后可重新发送`, `Retry in ${resendCooldown}s`)}
              </>
            ) : (
              <>
                <KeyRound size={20} />
                {tt('发送重置邮件', 'Send Reset Email')}
              </>
            )}
          </button>

          {mode === 'login' && (
            <button
              type="button"
              onClick={onEmailLogin}
              disabled={emailLoginDisabled}
              className="w-full min-h-[44px] border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-60 disabled:cursor-not-allowed text-slate-700 dark:text-zinc-200 font-bold uppercase tracking-wider py-2 px-4 rounded-none flex items-center justify-center gap-2 transition-colors whitespace-normal text-center leading-tight"
            >
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : resendCooldown > 0 ? (
                <RefreshCw size={18} />
              ) : (
                <Mail size={18} />
              )}
              {resendCooldown > 0
                ? tt(`${resendCooldown}秒后可重新发送邮件登录`, `Email sign-in in ${resendCooldown}s`)
                : tt('发送邮件登录验证码', 'Send Email Sign-In Code')}
            </button>
          )}

          {hasOAuthProviders && (
            <div className="pt-1 space-y-3">
              <div className="flex items-center gap-3 text-[11px] uppercase tracking-widest text-slate-400 dark:text-zinc-600">
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                {tt('第三方登录', 'Third-party sign-in')}
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {oauthProviders.map((provider) => {
                  const Icon = provider.key === 'github' ? Github : Link2;
                  return (
                    <button
                      key={provider.key}
                      type="button"
                      onClick={() => onOAuthLogin(provider.key)}
                      disabled={loading}
                      className="min-h-[44px] border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-60 disabled:cursor-not-allowed text-slate-700 dark:text-zinc-200 font-bold uppercase tracking-wider py-2 px-3 rounded-none flex items-center justify-center gap-2 transition-colors text-xs whitespace-normal text-center leading-tight"
                    >
                      <Icon size={16} />
                      {provider.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] leading-5 text-slate-500 dark:text-zinc-500">
                {tt(
                  '授权会在当前标签页跳转并回到本站，不会打开新标签页。第三方账号绑定仍会要求保留至少一种站内可用登录方式。',
                  'Authorization continues in this tab and returns here. Account linking still requires at least one usable site sign-in method.'
                )}
              </p>
            </div>
          )}
        </form>

        <div className="shrink-0 border-t border-zinc-100 bg-white px-4 py-3 text-center dark:border-zinc-800 dark:bg-zinc-900 sm:px-6 sm:py-4">
          <p className="text-slate-500 dark:text-zinc-500 text-sm">
            {mode === 'login' ? (
              <>
                {tt('还没有账户？', "Don't have an account?")}{' '}
                <button
                  type="button"
                  onClick={() => onSwitchMode('register')}
                  className="text-endfield-yellow hover:text-yellow-500 font-bold uppercase text-xs tracking-wider"
                >
                  {tt('立即注册', 'Register')}
                </button>
              </>
            ) : mode === 'register' ? (
              <>
                {tt('已有账户？', 'Already have an account?')}{' '}
                <button
                  type="button"
                  onClick={() => onSwitchMode('login')}
                  className="text-endfield-yellow hover:text-yellow-500 font-bold uppercase text-xs tracking-wider"
                >
                  {tt('登录', 'Sign In')}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => onSwitchMode('login')}
                className="text-slate-500 dark:text-zinc-500 hover:text-endfield-yellow transition-colors text-sm flex items-center gap-1 mx-auto"
              >
                <ArrowLeft size={14} />
                {tt('返回登录', 'Back to Sign In')}
              </button>
            )}
          </p>
        </div>
      </div>
      </div>
    </div>
  );
}
