import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clipboard,
  Info,
  Trash2,
  X,
} from 'lucide-react';

const TONE_CLASSES = {
  success: {
    icon: 'text-emerald-500',
    dot: 'bg-emerald-500',
    border: 'border-emerald-400/30',
  },
  error: {
    icon: 'text-red-500',
    dot: 'bg-red-500',
    border: 'border-red-400/30',
  },
  warning: {
    icon: 'text-amber-500',
    dot: 'bg-amber-500',
    border: 'border-amber-400/30',
  },
  info: {
    icon: 'text-blue-500',
    dot: 'bg-blue-500',
    border: 'border-blue-400/30',
  },
};

const CATEGORY_LABELS = {
  account: '账号',
  import: '导入',
  'developer-api': 'API',
  ticket: '工单',
  cache: '缓存',
  ops: '自动化',
  system: '系统',
};

async function copyText(text) {
  if (!text) {
    return false;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.cssText = 'position: fixed; left: -9999px; top: -9999px; opacity: 0;';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    textarea.remove();
    return success;
  } catch {
    return false;
  }
}

function NotificationIcon({ type }) {
  const className = TONE_CLASSES[type]?.icon || TONE_CLASSES.info.icon;
  if (type === 'success') return <CheckCircle2 size={16} className={className} />;
  if (type === 'error') return <AlertCircle size={16} className={className} />;
  if (type === 'warning') return <AlertTriangle size={16} className={className} />;
  return <Info size={16} className={className} />;
}

function formatNotificationTime(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function shouldAutoOpenNotification(notification) {
  if (!notification || notification.readAt) {
    return false;
  }

  return notification.category === 'account'
    && (notification.type === 'error' || notification.type === 'warning');
}

export default function NotificationCenter({
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onClearRead,
}) {
  const [open, setOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [suppressedAutoOpenId, setSuppressedAutoOpenId] = useState(null);
  const hasNotifications = notifications.length > 0;
  const autoOpenNotification = useMemo(
    () => notifications.find(shouldAutoOpenNotification) || null,
    [notifications]
  );
  const autoOpen = Boolean(
    autoOpenNotification?.id
    && suppressedAutoOpenId !== autoOpenNotification.id
  );
  const visible = open || autoOpen;

  const suppressCurrentAutoOpen = () => {
    if (autoOpenNotification?.id) {
      setSuppressedAutoOpenId(autoOpenNotification.id);
    }
  };

  const handleCopy = async (notification) => {
    const copied = await copyText(notification.diagnosticText);
    if (!copied) {
      return;
    }

    setCopiedId(notification.id);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="notification-center fixed bottom-20 right-4 z-[90] sm:bottom-6 sm:right-6">
      {visible && (
        <div className="mb-3 w-[min(25rem,calc(100vw-2rem))] overflow-hidden border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-slate-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div>
              <div className="text-sm font-black uppercase tracking-wider text-slate-800 dark:text-zinc-100">
                通知中心
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-zinc-500">
                {unreadCount > 0 ? `${unreadCount} 条未读` : '暂无未读'}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onMarkAllRead}
                disabled={!hasNotifications || unreadCount === 0}
                className="border border-zinc-200 px-2 py-1 text-[11px] font-bold text-slate-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                全部已读
              </button>
              <button
                type="button"
                onClick={onClearRead}
                disabled={!notifications.some((item) => item.readAt)}
                className="border border-zinc-200 p-1.5 text-slate-500 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                aria-label="清理已读通知"
              >
                <Trash2 size={13} />
              </button>
              <button
                type="button"
                onClick={() => {
                  suppressCurrentAutoOpen();
                  setOpen(false);
                }}
                className="border border-zinc-200 p-1.5 text-slate-500 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                aria-label="关闭通知中心"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          <div className="max-h-[min(30rem,60vh)] overflow-y-auto">
            {!hasNotifications ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-zinc-500">
                关键操作状态会保留在这里。
              </div>
            ) : (
              notifications.map((notification) => {
                const tone = TONE_CLASSES[notification.type] || TONE_CLASSES.info;
                const unread = !notification.readAt;

                return (
                  <div
                    key={notification.id}
                    className={`border-b border-zinc-100 px-4 py-3 last:border-b-0 dark:border-zinc-800 ${unread ? 'bg-yellow-50/35 dark:bg-yellow-500/[0.04]' : 'bg-white dark:bg-zinc-950'}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 border p-1.5 ${tone.border}`}>
                        <NotificationIcon type={notification.type} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-slate-800 dark:text-zinc-100">
                            {notification.title || '通知'}
                          </span>
                          {unread && <span className={`h-1.5 w-1.5 ${tone.dot}`} />}
                          <span className="border border-zinc-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500 dark:border-zinc-700 dark:text-zinc-400">
                            {CATEGORY_LABELS[notification.category] || '系统'}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600 dark:text-zinc-400">
                          {notification.message}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-400 dark:text-zinc-500">
                          <span>{formatNotificationTime(notification.updatedAt || notification.createdAt)}</span>
                          {notification.source ? <span>{notification.source}</span> : null}
                        </div>
                        {(notification.diagnosticText || notification.actions?.length > 0) && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {notification.diagnosticText && (
                              <button
                                type="button"
                                onClick={() => void handleCopy(notification)}
                                className="inline-flex items-center gap-1.5 border border-zinc-200 px-2.5 py-1 text-[11px] font-bold text-slate-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                              >
                                <Clipboard size={12} />
                                {copiedId === notification.id ? notification.copiedDiagnosticLabel : notification.copyDiagnosticLabel}
                              </button>
                            )}
                            {notification.actions?.map((action, index) => (
                              <a
                                key={`${notification.id}-action-${index}`}
                                href={action.href}
                                className={`inline-flex items-center border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                                  action.variant === 'primary'
                                    ? 'border-endfield-yellow bg-endfield-yellow text-black hover:bg-yellow-400'
                                    : 'border-zinc-200 text-slate-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
                                }`}
                              >
                                {action.label}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        {unread && (
                          <button
                            type="button"
                            onClick={() => onMarkRead(notification.id)}
                            className="border border-zinc-200 px-2 py-1 text-[10px] font-bold text-slate-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                          >
                            已读
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDismiss(notification.id)}
                          className="border border-zinc-200 p-1 text-slate-400 hover:bg-zinc-100 hover:text-red-500 dark:border-zinc-700 dark:hover:bg-zinc-800"
                          aria-label="移除通知"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          if (visible) {
            suppressCurrentAutoOpen();
            setOpen(false);
            return;
          }

          setOpen(true);
        }}
        className="relative inline-flex h-12 w-12 items-center justify-center border border-zinc-300 bg-white text-slate-700 shadow-xl transition-colors hover:border-endfield-yellow hover:text-slate-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        aria-label="打开通知中心"
        aria-expanded={visible}
      >
        <Bell size={19} />
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-5 border border-white bg-red-500 px-1 text-center text-[10px] font-black leading-5 text-white dark:border-zinc-950">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
