import React, { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import DeviceRedirectGuard from './components/guards/DeviceRedirectGuard';
import { useI18n } from './i18n/index.js';

// 懒加载桌面端入口，避免移动端与独立页面首包提前带入完整桌面壳层
const App = lazy(() => import('./App'));
// 懒加载移动端入口
const MobileApp = lazy(() => import('./mobile/MobileApp'));
// 懒加载法律页面
const PrivacyPolicy = lazy(() => import('./components/legal/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./components/legal/TermsOfService'));
const ResetPasswordPage = lazy(() => import('./components/auth/ResetPasswordPage'));
const AuthCallbackPage = lazy(() => import('./components/auth/AuthCallbackPage.jsx'));
const SiteStatusPage = lazy(() => import('./components/status/SiteStatusPage.jsx'));
const DonationThanksPage = lazy(() => import('./components/donations/DonationThanksPage.jsx'));

/**
 * 应用路由配置
 * - / : 桌面端入口
 * - /m/* : 移动端入口
 * - /privacy : 隐私政策
 * - /terms : 用户协议
 * - /reset-password : 密码重置页
 * - /auth/callback : 第三方登录回调页
 * - /status : 公开服务状态页
 */
function AppRouter() {
  return (
    <DeviceRedirectGuard>
      <Routes>
        {/* 独立页面（不受设备重定向影响） */}
        <Route
          path="/reset-password"
          element={
            <Suspense fallback={<MobileLoadingFallback />}>
              <ResetPasswordPage />
            </Suspense>
          }
        />
        <Route
          path="/auth/callback"
          element={
            <Suspense fallback={<MobileLoadingFallback />}>
              <AuthCallbackPage />
            </Suspense>
          }
        />
        <Route
          path="/status"
          element={
            <Suspense fallback={<MobileLoadingFallback />}>
              <SiteStatusPage />
            </Suspense>
          }
        />
        <Route
          path="/privacy"
          element={
            <Suspense fallback={<MobileLoadingFallback />}>
              <PrivacyPolicy />
            </Suspense>
          }
        />
        <Route
          path="/terms"
          element={
            <Suspense fallback={<MobileLoadingFallback />}>
              <TermsOfService />
            </Suspense>
          }
        />
        <Route
          path="/donations"
          element={
            <Suspense fallback={<MobileLoadingFallback />}>
              <DonationThanksPage />
            </Suspense>
          }
        />

        {/* 移动端路由（比 /* 更具体，优先匹配） */}
        <Route
          path="/m/*"
          element={
            <Suspense fallback={<MobileLoadingFallback />}>
              <MobileApp />
            </Suspense>
          }
        />

        {/* 桌面端路由（兜底） */}
        <Route
          path="/*"
          element={
            <Suspense fallback={<MobileLoadingFallback />}>
              <App />
            </Suspense>
          }
        />
      </Routes>
    </DeviceRedirectGuard>
  );
}

// 移动端加载占位
function MobileLoadingFallback() {
  const { t } = useI18n();

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-endfield-yellow border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-zinc-500 dark:text-zinc-400">{t('common.loading')}</p>
      </div>
    </div>
  );
}

export default AppRouter;
