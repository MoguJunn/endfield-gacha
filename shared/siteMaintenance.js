export const MAINTENANCE_CONFIG_KEY = 'site_maintenance_notice';

export const MAINTENANCE_SERVICES = Object.freeze([
  { id: 'account', label: '账号注册、登录、验证、找回与绑定', labelEn: 'Registration, sign-in, verification, recovery and account linking' },
  { id: 'records', label: '云端记录读取、同步、保存及数据工作台', labelEn: 'Cloud records, sync, saving and the data workbench' },
  { id: 'imports', label: '官方记录导入、文件导入保存与导入进度查询', labelEn: 'Official imports, saving file imports and checking import progress' },
  { id: 'statistics', label: '个人分析、全服统计、排名与图鉴更新', labelEn: 'Personal analysis, community statistics, rankings and collection updates' },
  { id: 'saves', label: '模拟器及其他功能的云端存档', labelEn: 'Simulator and other cloud saves' },
  { id: 'support', label: '工单、公告读取、后台管理等在线功能', labelEn: 'Support tickets, announcements and administration' },
  { id: 'api', label: '依赖本站数据库的开放 API、机器人及关联服务', labelEn: 'Database-dependent public APIs, bots and connected services' },
]);

// Deployment notice for the current upgrade. It must remain available during
// database downtime, including on a first visit without a browser snapshot.
// A saved administrator value (including enabled:false) takes precedence.
// Clear this deployment default after the upgrade is completed.
export const DEFAULT_MAINTENANCE_NOTICE = Object.freeze({
  enabled: true,
  showAffectedServices: true,
  allowCollapse: true,
  title: '数据库服务器升级维护',
  titleEn: 'Database server upgrade',
  period: '即刻起，至升级完成',
  periodEn: 'Effective immediately, until the upgrade is complete',
  message: '我们正在升级数据库服务器。维护期间，依赖数据库的功能可能出现加载缓慢、请求失败或暂时无法访问，属于维护期间的正常现象。请稍后再试，避免反复提交；升级完成后将恢复服务。',
  messageEn: 'We are upgrading the database server. Database-dependent features may load slowly, fail or become temporarily unavailable during maintenance. This is expected. Please try again later and avoid submitting repeatedly. Services will resume after the upgrade.',
  affectedServices: MAINTENANCE_SERVICES.map(service => service.id),
});

export function normalizeMaintenanceNotice(value) {
  let input = value;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { input = null; }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ...DEFAULT_MAINTENANCE_NOTICE };
  const result = { ...DEFAULT_MAINTENANCE_NOTICE };
  for (const key of ['enabled', 'showAffectedServices', 'allowCollapse']) {
    if (typeof input[key] === 'boolean') result[key] = input[key];
  }
  for (const key of ['title', 'titleEn', 'period', 'periodEn', 'message', 'messageEn']) {
    if (typeof input[key] === 'string' && input[key].trim()) result[key] = input[key].trim().slice(0, key.startsWith('message') ? 3000 : 200);
  }
  if (Array.isArray(input.affectedServices)) {
    result.affectedServices = MAINTENANCE_SERVICES.map(service => service.id).filter(id => input.affectedServices.includes(id));
  }
  return result;
}
