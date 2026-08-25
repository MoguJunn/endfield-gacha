import { createClient } from '@supabase/supabase-js'
import appLogger from './utils/appLogger.js';
import { isContributorDemoModeEnabled } from './dev/contributorDemoMode.js';

function normalizeEnvValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

const supabaseUrl = normalizeEnvValue(
  import.meta.env?.VITE_SUPABASE_URL
    || import.meta.env?.SUPABASE_URL
)
const supabasePublishableKey = normalizeEnvValue(
  import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY
    || import.meta.env?.SUPABASE_PUBLISHABLE_KEY
    || import.meta.env?.VITE_SUPABASE_ANON_KEY
    || import.meta.env?.SUPABASE_ANON_KEY
    || import.meta.env?.PUBLISHABLE_KEY
)
const supabaseRealtimeEnabled = ['1', 'true', 'yes', 'on'].includes(
  normalizeEnvValue(import.meta.env?.VITE_SUPABASE_REALTIME_ENABLED).toLowerCase()
)

if (!supabaseUrl || !supabasePublishableKey) {
  // 仅在开发环境输出警告
  if (import.meta.env?.DEV) {
    appLogger.warn('Supabase 配置缺失，云同步功能将不可用。请检查 .env 文件。')
  }
}

export const supabase = !isContributorDemoModeEnabled() && supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      flowType: 'pkce',
    },
  })
  : null

export const isSupabaseRealtimeEnabled = () => {
  return Boolean(supabase && supabaseRealtimeEnabled)
}

// 检查 Supabase 是否可用
export const isSupabaseConfigured = () => {
  return supabase !== null
}
