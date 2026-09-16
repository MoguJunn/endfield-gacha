import React from 'react';
import { Monitor, Smartphone } from 'lucide-react';
import { resolvePlatformPath } from '../../constants/appRoutes';
import { useI18n } from '../../i18n/index.js';
import { useDeviceDetection } from '../../hooks/useDeviceDetection.js';

/**
 * 平台切换器组件
 * 同时记录当前标签页选择与长期偏好，再刷新目标平台。
 */
function PlatformSwitcher({ variant = 'button', className = '', label }) {
  const { t, isEnglish } = useI18n();
  const { isMobile, setPreference } = useDeviceDetection();
  const currentPlatform = window.location.pathname.startsWith('/m') ? 'mobile' : 'desktop';

  const resolveTargetPath = (targetPlatform) => {
    return resolvePlatformPath(window.location.pathname, targetPlatform);
  };

  const handleSwitch = (targetPlatform) => {
    if (
      isMobile &&
      targetPlatform === 'desktop' &&
      !window.confirm(
        isEnglish
          ? 'Phones cannot fully display desktop content. Some charts, tables and controls may require horizontal scrolling. Switch to desktop anyway?'
          : '手机端无法完整显示桌面端内容，部分图表、表格和操作区域可能需要横向滚动。仍要切换到桌面版吗？'
      )
    )
      return;
    setPreference(targetPlatform);
    const basePath = window.location.origin;
    const targetPath = resolveTargetPath(targetPlatform);
    const search = window.location.search || '';
    const hash = window.location.hash || '';
    window.location.replace(basePath + targetPath + search + hash);
  };

  if (variant === 'menu-item') {
    return (
      <button
        onClick={() => handleSwitch(currentPlatform === 'mobile' ? 'desktop' : 'mobile')}
        className={`flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${className}`}
      >
        {currentPlatform === 'mobile' ? (
          <>
            <Monitor className="w-5 h-5 text-zinc-500" />
            <span className="text-zinc-700 dark:text-zinc-300">{t('platform.switchToDesktop')}</span>
          </>
        ) : (
          <>
            <Smartphone className="w-5 h-5 text-zinc-500" />
            <span className="text-zinc-700 dark:text-zinc-300">{t('platform.switchToMobile')}</span>
          </>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={() => handleSwitch(currentPlatform === 'mobile' ? 'desktop' : 'mobile')}
      className={`flex items-center gap-2 px-3 py-2 text-sm bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors ${className}`}
    >
      {currentPlatform === 'mobile' ? (
        <>
          <Monitor className="w-4 h-4" />
          <span>{label ?? t('platform.desktopShort')}</span>
        </>
      ) : (
        <>
          <Smartphone className="w-4 h-4" />
          <span>{label ?? t('platform.mobileShort')}</span>
        </>
      )}
    </button>
  );
}

export default PlatformSwitcher;
