const ERROR_MESSAGES = {
  auth_identity_conflict: {
    zh: '检测到两个不同账号的登录凭据。请退出登录后重新登录，再重试读取。',
    en: 'Two different account credentials were detected. Sign out, sign in again, and retry.',
  },
  auth_service_not_configured: {
    zh: '当前部署的登录服务配置不完整，请联系站点管理员。',
    en: 'Authentication is not fully configured for this deployment. Contact the site administrator.',
  },
  missing_access_token: {
    zh: '登录会话已失效，请重新登录后重试。',
    en: 'Your sign-in session has expired. Sign in again and retry.',
  },
  site_session_missing: {
    zh: '登录会话已失效，请重新登录后重试。',
    en: 'Your sign-in session has expired. Sign in again and retry.',
  },
  auth_session_revoked: {
    zh: '登录会话已被撤销，请重新登录后重试。',
    en: 'Your sign-in session was revoked. Sign in again and retry.',
  },
  CLIENT_TIMEOUT: {
    zh: '读取耗时过长并已超时。你的数据不会被当作空数据处理，可以稍后重试。',
    en: 'The read took too long and timed out. Your data has not been treated as empty; try again later.',
  },
  personal_data_owner_mismatch: {
    zh: '返回数据与当前登录账号不一致，已阻止加载以保护你的数据。请重新登录后重试。',
    en: 'The returned data belongs to a different account and was blocked. Sign in again and retry.',
  },
  history_revision_changed: {
    zh: '抽卡记录在翻页期间发生了变化，请从第一页重新加载。',
    en: 'Your gacha history changed while paging. Reload it from the first page.',
  },
  personal_analysis_queue_unavailable: {
    zh: '统计任务队列暂时不可用，系统没有假装进入排队。请稍后重试或联系站点管理员。',
    en: 'The statistics queue is unavailable and the request was not reported as queued. Try again later or contact the administrator.',
  },
  personal_analysis_queue_not_queued: {
    zh: '统计任务未能进入后台队列，请稍后重试或联系站点管理员。',
    en: 'The statistics request could not enter the background queue. Try again later or contact the administrator.',
  },
};

function normalizeDiagnosticValue(value, maxLength = 128) {
  const normalized = String(value || '').trim();
  if (!normalized || !/^[a-zA-Z0-9_.:-]+$/.test(normalized)) {
    return '';
  }
  return normalized.slice(0, maxLength);
}

function getFallbackMessage(status, isEnglish) {
  if (status === 401) {
    return isEnglish
      ? 'Your sign-in session is no longer valid. Sign in again and retry.'
      : '登录会话已失效，请重新登录后重试。';
  }
  if (status === 409) {
    return isEnglish
      ? 'The current account state conflicts with the saved session. Sign in again and retry.'
      : '当前账号状态与已保存会话冲突，请重新登录后重试。';
  }
  if (status === 503) {
    return isEnglish
      ? 'The personal data service is temporarily unavailable. Try again later.'
      : '个人数据服务暂时不可用，请稍后重试。';
  }
  if (status === 504) {
    return isEnglish
      ? 'The personal data request timed out. Try again later.'
      : '个人数据请求超时，请稍后重试。';
  }
  return isEnglish
    ? 'Your personal data could not be loaded. No empty-data conclusion has been made.'
    : '个人数据读取失败；当前不会把读取错误显示成“没有数据”。';
}

export function getPersonalDataErrorPresentation(error, { isEnglish = false } = {}) {
  const statusValue = Number(error?.status);
  const status = Number.isInteger(statusValue) && statusValue >= 100 && statusValue <= 599
    ? statusValue
    : null;
  const code = normalizeDiagnosticValue(error?.code);
  const requestId = normalizeDiagnosticValue(error?.requestId);
  const localized = code ? ERROR_MESSAGES[code] : null;
  const diagnosticParts = [];

  if (status) {
    diagnosticParts.push(`HTTP ${status}`);
  }
  if (code) {
    diagnosticParts.push(`code: ${code}`);
  }
  if (requestId) {
    diagnosticParts.push(`request: ${requestId}`);
  }

  return {
    message: localized?.[isEnglish ? 'en' : 'zh'] || getFallbackMessage(status, isEnglish),
    diagnostic: diagnosticParts.join(' · '),
  };
}

export default getPersonalDataErrorPresentation;
