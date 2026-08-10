const DOMAIN_LEGAL_CONFIG_KEY = 'legal_registration_by_domain';
const REGISTERED_DOMAIN_HOSTNAME = 'ef.nepst.cn';

const DEFAULT_LEGAL_URLS = {
  icpUrl: 'https://beian.miit.gov.cn/',
  policeUrl: 'https://www.beian.gov.cn/',
};

function normalizeHostname(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) return '';

  try {
    return new URL(rawValue.includes('://') ? rawValue : `https://${rawValue}`)
      .hostname
      .toLowerCase()
      .replace(/\.$/, '');
  } catch {
    return rawValue.toLowerCase().replace(/\.$/, '');
  }
}

function parseDomainLegalConfig(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeLegalEntry(entry = {}) {
  return {
    icpNumber: String(entry.icpNumber ?? entry.icp_number ?? '').trim(),
    icpUrl: String(entry.icpUrl ?? entry.icp_url ?? DEFAULT_LEGAL_URLS.icpUrl).trim() || DEFAULT_LEGAL_URLS.icpUrl,
    policeNumber: String(entry.policeNumber ?? entry.police_number ?? '').trim(),
    policeUrl: String(entry.policeUrl ?? entry.police_url ?? DEFAULT_LEGAL_URLS.policeUrl).trim() || DEFAULT_LEGAL_URLS.policeUrl,
  };
}

function resolveGenericLegalConfig(config) {
  return normalizeLegalEntry({
    icpNumber: config.icp_number,
    icpUrl: config.icp_url,
    policeNumber: config.police_number,
    policeUrl: config.police_url,
  });
}

export function resolveSiteLegalConfig(config = {}, origin = '') {
  const hostname = normalizeHostname(
    origin || (typeof window !== 'undefined' ? window.location.origin : '')
  );
  const domainConfig = parseDomainLegalConfig(config[DOMAIN_LEGAL_CONFIG_KEY]);
  const configuredEntry = domainConfig[hostname];

  if (configuredEntry && typeof configuredEntry === 'object') {
    return normalizeLegalEntry(configuredEntry);
  }

  if (hostname === REGISTERED_DOMAIN_HOSTNAME) {
    return normalizeLegalEntry({
      icpNumber: config.icp_number_ef_nepst_cn,
      icpUrl: config.icp_url_ef_nepst_cn,
      policeNumber: config.police_number_ef_nepst_cn,
      policeUrl: config.police_url_ef_nepst_cn,
    });
  }

  return resolveGenericLegalConfig(config);
}

export { DOMAIN_LEGAL_CONFIG_KEY, REGISTERED_DOMAIN_HOSTNAME };
