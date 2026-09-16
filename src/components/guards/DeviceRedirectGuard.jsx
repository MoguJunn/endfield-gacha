import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Monitor, Smartphone } from 'lucide-react';
import { useDeviceDetection } from '../../hooks/useDeviceDetection';
import { getDeviceRedirectTarget, shouldBypassDeviceRedirect } from '../../utils/deviceRedirect.js';
import { useI18n } from '../../i18n/index.js';

function RememberedPlatformCountdown({ preference, onContinue, tt }) {
  const [seconds, setSeconds] = useState(5);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    if (paused || !visible) return;
    if (seconds === 0) {
      onContinue(preference);
      return;
    }
    const timer = window.setTimeout(() => setSeconds(value => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [onContinue, paused, preference, seconds, visible]);

  // Keyboard users can inspect both choices without racing the countdown.
  useEffect(() => {
    const stopForKeyboard = event => {
      if (event.key === 'Tab') setPaused(true);
    };
    document.addEventListener('keydown', stopForKeyboard);
    return () => document.removeEventListener('keydown', stopForKeyboard);
  }, []);

  const name = preference === 'mobile' ? tt('移动版', 'mobile') : tt('桌面版', 'desktop');
  return (
    <div className="mt-4 border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3 text-sm">
      <p className="font-semibold">{tt(`上次选择：${name}`, `Last choice: ${name}`)}</p>
      <p className="mt-1 text-zinc-600 dark:text-zinc-300" role="timer" aria-live="off">
        {paused
          ? tt('已暂停自动进入，请选择下方版本。', 'Auto-entry paused. Choose a version below.')
          : tt(`${seconds} 秒后自动进入${name}，也可以立即选择下方任一版本。`, `Continuing with ${name} in ${seconds}s. You can choose either version below now.`)}
      </p>
      {!paused && <button type="button" onClick={() => setPaused(true)} className="mt-2 min-h-10 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-600">{tt('暂停倒计时', 'Pause countdown')}</button>}
    </div>
  );
}

function DeviceRedirectGuard({ children }) {
  const location = useLocation();
  const { shouldUseMobile, needsPlatformChoice, platformPreference, setPreference } = useDeviceDetection();
  const { isEnglish } = useI18n();
  const tt = (zh, en) => isEnglish ? en : zh;

  if (shouldBypassDeviceRedirect(location.pathname)) return children;

  if (needsPlatformChoice) {
    return (
      <main className="min-h-dvh flex items-center justify-center bg-slate-50 dark:bg-zinc-950 p-5 text-slate-800 dark:text-zinc-100">
        <section className="w-full max-w-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 sm:p-8" aria-labelledby="platform-choice-title">
          <p className="text-xs font-bold tracking-widest text-yellow-700 dark:text-yellow-400">ENDFIELD GACHA</p>
          <h1 id="platform-choice-title" className="mt-4 text-2xl font-bold">{tt('选择适合你的浏览版本', 'Choose your viewing experience')}</h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{platformPreference
            ? tt('将沿用你上次的选择，无需重复操作。想换个版本？在下方直接选择即可。', 'We’ll continue with your last choice automatically. To change it, choose a version below.')
            : tt('当前设备或窗口较窄，建议使用移动版。选择后会记住，下次自动继续。', 'Your device or window is narrow. We recommend mobile. We’ll remember your choice for next time.')}</p>
          {platformPreference && <RememberedPlatformCountdown key={platformPreference} preference={platformPreference} onContinue={setPreference} tt={tt} />}
          <p id="platform-desktop-warning" className="mt-4 border-l-4 border-yellow-500 bg-yellow-50 dark:bg-yellow-950 p-3 text-sm leading-relaxed text-yellow-900 dark:text-yellow-200">{tt('手机端无法完整显示桌面端内容，部分图表、表格和操作区域可能需要横向滚动。需要完整体验时，建议使用电脑。', 'Phones cannot fully display desktop content. Some charts, tables and controls may require horizontal scrolling. Use a computer for the full experience.')}</p>
          <div className="mt-6 grid gap-3">
            <button type="button" onClick={() => setPreference('mobile')} className="flex items-center gap-3 border border-yellow-400 bg-yellow-300 p-4 text-left text-zinc-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-600">
              <Smartphone className="h-6 w-6 shrink-0" aria-hidden="true" />
              <span><strong className="block">{tt('进入移动版（推荐）', 'Continue with mobile (recommended)')}</strong><span className="mt-1 block text-sm">{tt('更适合手机屏幕与触控操作', 'Designed for small screens and touch')}</span></span>
            </button>
            <button type="button" onClick={() => setPreference('desktop')} aria-describedby="platform-desktop-warning" className="flex items-center gap-3 border border-zinc-300 dark:border-zinc-600 p-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-600">
              <Monitor className="h-6 w-6 shrink-0" aria-hidden="true" />
              <span><strong className="block">{tt('仍然进入桌面版', 'Continue with desktop')}</strong><span className="mt-1 block text-sm text-zinc-600 dark:text-zinc-400">{tt('保留桌面布局，部分内容可能显示不全', 'Desktop layout; some content may not fit')}</span></span>
            </button>
          </div>
          <p className="mt-5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{tt('本标签页内刷新或返回首页无需重选。之后也可在菜单或设置中切换版本。', 'Refreshing or returning home in this tab keeps your choice. You can switch later in the menu or settings.')}</p>
        </section>
      </main>
    );
  }

  const target = getDeviceRedirectTarget(location.pathname, shouldUseMobile, {
    search: location.search,
    hash: location.hash,
  });
  if (target) return <Navigate to={target} replace />;

  return children;
}

export default DeviceRedirectGuard;
