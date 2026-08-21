import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Bell, Calendar, ChevronRight, Globe, Image as ImageIcon, Layers, Maximize2, Radio, Shield, Sparkles, Star, Users, X, BarChart3, Map, BarChart2 } from 'lucide-react';
import { ACCOUNT_RECOVERY_QQ_GROUP, ENGLISH_COMMUNITY_DISCORD_URL } from '../../constants/community';
import { useAppStore, useAuthStore } from '../../stores';
import usePoolStore from '../../stores/usePoolStore';
import useSiteConfigStore, {
  HOME_NEXT_VERSION_TARGET_CONFIG_KEY,
  HOME_VERSION_TIMELINE_CONFIG_KEY,
  useJsonConfig
} from '../../stores/useSiteConfigStore';
import { useI18n } from '../../i18n/index.js';
import {
  getActiveHomeCountdownPools,
  getHomeRotationPoolSchedule,
  getLimitedPoolCountdownState,
  getLimitedPoolSchedule
} from '../../utils/poolTimeUtils';
import { localizeEntityName, localizePoolName } from '../../utils/gameDataI18n.js';
import { getLocalizedAnnouncementTitle } from '../../utils/announcementLocale.js';
import { resolveGameAnnouncementDigest } from '../../utils/gameAnnouncementDigest.js';
import { resolveGameAnnouncementCalendarImage } from '../../utils/gameAnnouncementCalendar.js';
import {
  buildHomeRotationVersionSections,
  buildHomeVersionCountdownTitle,
  resolveHomeVersionPlan,
} from '../../utils/homeVersionTimeline.js';
import { getAnnouncementTypeLabel, splitSiteAnnouncements } from '../../utils/announcementMeta.js';
import { DEFAULT_HOME_ROADMAP_SUMMARY, normalizeHomeRoadmapItems } from '../../constants/homeRoadmap.js';
import SummerLotteryBanner from '../../components/home/SummerLotteryBanner.jsx';
const DEFAULT_LINKS = [
  { id: 'yituliu-calculator', title: '一图流攒抽计算器', url: 'https://ef.yituliu.cn/tools/gacha-calculator', icon: 'bar-chart-2' }, 
  { id: 'opendfield-map', title: '地图（国际服可用）', url: 'https://opendfieldmap.cn/', icon: 'map' },
  { id: 'zmdmap', title: '终末地地图（笋干）', url: 'https://www.zmdmap.com/', icon: 'map' },
  { id: 'endgacha', title: '同样优秀的抽卡记录分析（还有舟本体的）', url: 'https://endgacha.kwer.top/', icon: 'bar-chart-2' },       
  { id: 'story-search', title: '剧情检索 (AI精准查询与梗概生成)', url: 'https://endfield.prts.chat/', icon: 'globe' },
  { id: 'pull-planner', title: '抽卡规划器', url: 'https://endfield.203.io/', icon: 'bar-chart-2' },
];

const FRIENDLY_LINK_ID_BY_HOST = {
  'ef.yituliu.cn': 'yituliu-calculator',
  'opendfieldmap.cn': 'opendfield-map',
  'www.zmdmap.com': 'zmdmap',
  'zmdmap.com': 'zmdmap',
  'endgacha.kwer.top': 'endgacha',
  'endfield.prts.chat': 'story-search',
  'endfield.203.io': 'pull-planner',
};

function resolveFriendlyLinkId(item, fallbackIndex = 0) {
  if (item?.id) {
    return item.id;
  }

  try {
    const host = new URL(item?.url || '').hostname;
    if (FRIENDLY_LINK_ID_BY_HOST[host]) {
      return FRIENDLY_LINK_ID_BY_HOST[host];
    }
  } catch {
    // Fall back to default list when URL parsing fails.
  }

  return DEFAULT_LINKS[fallbackIndex]?.id || null;
}

function normalizeRoadmapStatus(status) {
  const normalized = String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, '_');

  if (['completed', 'done', 'shipped', 'finished'].includes(normalized)) {
    return 'completed';
  }

  if (['in_progress', 'inprogress', 'progress', 'ongoing', 'active', 'working'].includes(normalized)) {
    return 'in_progress';
  }

  return 'planned';
}

export default function MobileHomePageView() {
  const navigate = useNavigate();
  const { t, isEnglish, locale, formatDateTime } = useI18n();
  const user = useAuthStore((state) => state.user);
  const announcements = useAppStore((state) => state.announcements);
  const gameAnnouncements = useAppStore((state) => state.gameAnnouncements);
  const storedGameAnnouncementDigest = useAppStore((state) => state.gameAnnouncementDigest);
  const pools = usePoolStore((state) => state.pools);
  const getConfig = useSiteConfigStore((state) => state.getConfig);
  const nextVersionTargetConfigValue = useSiteConfigStore(
    (state) => state.config[HOME_NEXT_VERSION_TARGET_CONFIG_KEY]
  );
  const versionTimelineConfigValue = useSiteConfigStore(
    (state) => state.config[HOME_VERSION_TIMELINE_CONFIG_KEY]
  );
  const links = useJsonConfig('home_friendly_links', DEFAULT_LINKS);
  const roadmapConfig = useJsonConfig('home_roadmap_items', DEFAULT_HOME_ROADMAP_SUMMARY);
  const roadmap = normalizeHomeRoadmapItems(roadmapConfig, DEFAULT_HOME_ROADMAP_SUMMARY);
  const [now, setNow] = useState(new Date());
  const [showGameCalendar, setShowGameCalendar] = useState(false);
  const [expandedGameCalendarImage, setExpandedGameCalendarImage] = useState(null);
  const heroSlogan = t(
    'home.mobile.heroLead',
    {},
    isEnglish
      ? 'Open-source, free, and synced across devices for Endfield gacha history analysis.'
      : '开源、免费、多端同步的终末地抽卡记录分析工具'
  );
  const qqGroup = getConfig('qq_group_number', ACCOUNT_RECOVERY_QQ_GROUP);
  const communityLabel = ENGLISH_COMMUNITY_DISCORD_URL.replace(/^https?:\/\//u, '');

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const poolsArray = useMemo(() => (Array.isArray(pools) ? pools : []), [pools]);
  const schedule = useMemo(() => getLimitedPoolSchedule(poolsArray), [poolsArray]);
  const homeRotationSchedule = useMemo(() => getHomeRotationPoolSchedule(poolsArray), [poolsArray]);
  const versionPlan = useMemo(() => resolveHomeVersionPlan({
    timelineConfig: versionTimelineConfigValue,
    legacyTargetAt: nextVersionTargetConfigValue,
    locale,
    now,
  }), [locale, nextVersionTargetConfigValue, now, versionTimelineConfigValue]);
  const nextVersionTargetDate = versionPlan.targetAt;
  const nextVersionCardTitle = useMemo(() => buildHomeVersionCountdownTitle(versionPlan, {
    baseTitle: t('home.mobile.nextVersionTitle'),
  }), [t, versionPlan]);
  const homeRotationVersionSections = useMemo(() => buildHomeRotationVersionSections({
    poolSchedule: homeRotationSchedule,
    versionPlan,
    now,
  }), [homeRotationSchedule, now, versionPlan]);
  const { temporary: temporaryAnnouncements, updates: updateAnnouncements } = useMemo(
    () => splitSiteAnnouncements(announcements),
    [announcements]
  );
  const latestAnnouncement = temporaryAnnouncements?.[0] || updateAnnouncements?.[0] || null;
  const localizedAnnouncementTitle = getLocalizedAnnouncementTitle(latestAnnouncement, locale) || t('announcement.empty');
  const gameAnnouncementDigest = useMemo(
    () => resolveGameAnnouncementDigest(storedGameAnnouncementDigest, gameAnnouncements, t),
    [gameAnnouncements, storedGameAnnouncementDigest, t]
  );
  const gameAnnouncementCalendar = useMemo(
    () => resolveGameAnnouncementCalendarImage(gameAnnouncements),
    [gameAnnouncements]
  );
  
  const translatedLinks = useMemo(() => (Array.isArray(links) ? links : []).map((item, index) => ({
    ...item,
    id: resolveFriendlyLinkId(item, index),
    icon: DEFAULT_LINKS[index]?.icon || 'globe',
    title: resolveFriendlyLinkId(item, index) ? t(`home.friendlyLinks.item.${resolveFriendlyLinkId(item, index)}.title`, {}, item.title) : item.title,
    hostname: (() => {
      try {
        return new URL(item.url).hostname;
      } catch {
        return item.url;
      }
    })(),
  })), [links, t]);

  const translatedRoadmap = useMemo(() => (Array.isArray(roadmap) ? roadmap : []).map((item) => ({
    ...item,
    status: normalizeRoadmapStatus(item.status),
    title: item.id ? t(`home.roadmap.item.${item.id}.title`, {}, item.title) : item.title,
    description: item.id ? t(`home.roadmap.item.${item.id}.description`, {}, item.description) : item.description,
  })), [roadmap, t]);

  const roadmapCounts = useMemo(() => ({
    completed: translatedRoadmap.filter((item) => item.status === 'completed').length,
    inProgress: translatedRoadmap.filter((item) => item.status === 'in_progress').length,
    planned: translatedRoadmap.filter((item) => item.status === 'planned').length,
  }), [translatedRoadmap]);

  const countdown = useMemo(() => {
    const limitedCountdown = getLimitedPoolCountdownState(schedule, now);
    if (limitedCountdown?.isActive) {
      return limitedCountdown;
    }

    const activeHomeCountdownPools = getActiveHomeCountdownPools(poolsArray, now);
    const activeExtraCountdown = activeHomeCountdownPools.find((pool) => pool.poolType === 'extra');
    return activeExtraCountdown || activeHomeCountdownPools[0] || limitedCountdown;
  }, [now, poolsArray, schedule]);
  const localizedCountdownName = useMemo(() => (
    countdown?.poolType === 'extra'
      ? countdown.displayName || countdown.name || t('common.unknown')
      : localizeEntityName(countdown?.name, {
        locale,
        type: countdown?.poolData?.type === 'weapon' ? 'weapon' : 'character'
      }) || countdown?.name || t('common.unknown')
  ), [countdown, locale, t]);
  const countdownScheduleMeta = useMemo(() => {
    const scheduleDate = countdown?.scheduleDate || countdown?.startDate;
    if (!scheduleDate) {
      return null;
    }

    return t('home.countdown.scheduleTime', {
      label: t('home.countdown.startsAt'),
      time: formatDateTime(scheduleDate, { timeZoneName: 'short' }, t('common.timeUnknown')),
    });
  }, [countdown?.scheduleDate, countdown?.startDate, formatDateTime, t]);

  const rotationPreview = useMemo(() => {
    const sorted = homeRotationVersionSections
      .flatMap((section) => (section.pools || []).map((pool) => ({
        ...pool,
        versionName: section.name,
        foldedExtraCount: Array.isArray(pool.foldedExtraPools) ? pool.foldedExtraPools.length : 0,
      })))
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    if (!sorted.length) return [];
    let index = sorted.findIndex((pool) => now >= new Date(pool.startDate) && now < new Date(pool.endDate));
    if (index === -1) index = sorted.findIndex((pool) => now < new Date(pool.startDate));
    if (index === -1) index = Math.max(sorted.length - 1, 0);
    return sorted.slice(Math.max(0, index - 1), index + 3).map((pool) => {
      const active = now >= new Date(pool.startDate) && now < new Date(pool.endDate);
      const ended = now >= new Date(pool.endDate);
      const isExtraPool = pool.poolType === 'extra' || pool?.poolData?.type === 'extra';
      const localizedCharacterName = isExtraPool
        ? null
        : localizeEntityName(pool.name, {
          locale,
          type: pool?.poolData?.type === 'weapon' ? 'weapon' : 'character'
        });
      const localizedPoolName = localizePoolName(pool.poolData || pool, { locale });

      return {
        ...pool,
        displayName: localizedCharacterName
          || localizedPoolName
          || pool.name,
        active,
        ended,
        isExtraPool,
        versionName: pool.versionName,
        foldedExtraCount: pool.foldedExtraCount,
        label: active ? (isEnglish ? 'Live' : '进行中') : ended ? (isEnglish ? 'Ended' : '已结束') : (isEnglish ? 'Queued' : '待开启'),
      };
    });
  }, [homeRotationVersionSections, isEnglish, locale, now]);

  const nextVersionCountdown = useMemo(() => {
    const target = new Date(nextVersionTargetDate);
    if (Number.isNaN(target.getTime())) {
      return null;
    }

    const diff = Math.max(0, target.getTime() - now.getTime());
    return {
      targetDate: nextVersionTargetDate,
      days: Math.floor(diff / (1000 * 60 * 60 * 24)),
      hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
      minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
      seconds: Math.floor((diff % (1000 * 60)) / 1000)
    };
  }, [nextVersionTargetDate, now]);
  const nextVersionScheduleMeta = useMemo(() => t('home.countdown.scheduleTime', {
    label: t('home.countdown.releaseAt'),
    time: formatDateTime(nextVersionTargetDate, { timeZoneName: 'short' }, t('common.timeUnknown')),
  }), [formatDateTime, nextVersionTargetDate, t]);

  const featureLinks = [
    {
      key: 'mechanics',
      title: t('home.mobile.mechanicsTitle', {}, isEnglish ? 'Pool Mechanics' : '卡池机制'),
      subtitle: t('home.mobile.subpageMechanicsSubtitle'),
      icon: Layers,
      path: '/m/mechanics'
    },
    {
      key: 'roadmap',
      title: t('home.mobile.roadmapTitle', {}, isEnglish ? 'Roadmap' : '开发路线图'),
      subtitle: isEnglish
        ? `${roadmapCounts.inProgress} in progress · ${roadmapCounts.planned} planned`
        : `${roadmapCounts.inProgress} 项进行中 · ${roadmapCounts.planned} 项计划中`,
      icon: Sparkles,
      path: '/m/roadmap'
    }
  ];

  return (
    <div className="flex-1 h-full overflow-y-auto overflow-x-hidden px-4 pb-24 slide-up-enter scroll-smooth w-full">
      {/* Hero Banner */}
      <div className="rounded-xl p-5 mb-4 border-l-4 border-amber-500 dark:border-ef-yellow bg-gradient-to-r from-zinc-100 dark:from-zinc-800 to-white dark:to-zinc-950 relative overflow-hidden shadow-lg">
          <div className="relative z-10">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
                  <BarChart3 size={20} className="text-amber-600 dark:text-ef-yellow" />
                  Endfield Gacha Analyzer
              </h2>
              <p className="text-[11px] text-slate-600 dark:text-zinc-400 mb-3 leading-relaxed">{heroSlogan}</p>
              <p className="text-[10px] text-blue-700 dark:text-blue-300 flex items-center gap-1 bg-blue-100 dark:bg-blue-900/30 px-2 py-1 rounded inline-flex"><ArrowUpRight size={10} /> {user ? t('home.mobile.loggedIn') : t('home.mobile.loginCollabHint')}</p>
          </div>
          <Star size={120} className="absolute -right-6 -bottom-6 text-slate-900 dark:text-white opacity-[0.03]" />
      </div>

      <SummerLotteryBanner compact />

      {/* Security & Community */}
      <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="rounded-xl border border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-950/30 p-3 flex gap-3">
              <div className="text-green-500 shrink-0"><Shield size={16}/></div>
              <div>
                  <h3 className="text-[10px] font-bold text-green-700 dark:text-green-400 mb-1">{t('home.securityTitle')}</h3>
                  <p className="text-[8px] text-green-600/80 leading-tight">{t('home.securityCopy1')}</p>
              </div>
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 p-3 flex gap-3">
              <div className="text-amber-600 dark:text-ef-yellow shrink-0"><Users size={16}/></div>
              <div className="min-w-0">
                  <h3 className="text-[10px] font-bold text-slate-900 dark:text-white mb-1 truncate">{t('home.communityTitle')}</h3>
                  {isEnglish ? (
                    <a href={ENGLISH_COMMUNITY_DISCORD_URL} target="_blank" rel="noopener noreferrer" className="mt-1 block rounded border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-black px-1 py-0.5 text-center font-mono text-[10px] text-amber-600 dark:text-ef-yellow shadow-inner truncate">{communityLabel}</a>
                  ) : (
                    <div className="mt-1 rounded border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-black px-1 py-0.5 text-center font-mono text-[10px] text-amber-600 dark:text-ef-yellow shadow-inner truncate">{qqGroup}</div>
                  )}
              </div>
          </div>
      </div>

      {/* Announcements */}
      <div className="mb-6 space-y-2">
          <div onClick={() => navigate('/m/announcements')} className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-gradient-to-r from-amber-100 dark:from-amber-950/40 to-transparent flex items-center justify-between p-3 cursor-pointer">
              <div className="flex items-center gap-2 w-full pr-2">
                  <div className="relative">
                      <Bell size={16} className="text-amber-500 shrink-0" />
                      {latestAnnouncement && <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-ping"></span>}
                  </div>
                  <span className="text-[9px] bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-100 px-1 py-0.5 rounded font-bold shrink-0">{latestAnnouncement ? getAnnouncementTypeLabel(latestAnnouncement.announcement_type, locale) : t('home.siteAnnouncement')}</span>
                  <span className="text-xs font-bold text-amber-900 dark:text-amber-100 truncate flex-1">{localizedAnnouncementTitle}</span>
              </div>
              <ChevronRight size={14} className="text-amber-500/50 shrink-0" />
          </div>
          <div onClick={() => navigate('/m/announcements')} className="rounded-xl border border-orange-200 dark:border-orange-800/30 bg-gradient-to-r from-orange-100 dark:from-orange-950/20 to-transparent flex items-center justify-between p-3 cursor-pointer">
              <div className="flex items-center gap-2 w-full pr-2">
                  <Radio size={16} className="text-orange-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] bg-orange-100 dark:bg-orange-900/50 text-orange-600 dark:text-orange-400 px-1 py-0.5 rounded font-bold shrink-0">{t('home.gameAnnouncement')}</span>
                      <span className="text-xs font-bold text-slate-700 dark:text-zinc-300 truncate">{gameAnnouncementDigest.title}</span>
                    </div>
                    {gameAnnouncementDigest.subtitle ? (
                      <div className="mt-0.5 text-[10px] text-slate-500 dark:text-zinc-400 truncate">
                        {gameAnnouncementDigest.subtitle}
                      </div>
                    ) : null}
                  </div>
              </div>
              <ChevronRight size={14} className="text-slate-400 dark:text-zinc-600 shrink-0" />
          </div>
      </div>

      {gameAnnouncementCalendar ? (
        <div className="mb-6 overflow-hidden rounded-xl border border-cyan-200 dark:border-cyan-800/40 bg-gradient-to-r from-cyan-50 dark:from-cyan-950/25 to-white dark:to-zinc-950">
          <button
            type="button"
            onClick={() => setShowGameCalendar((value) => !value)}
            className="flex w-full items-center justify-between gap-3 p-3 text-left"
            aria-expanded={showGameCalendar}
          >
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-200 dark:border-cyan-800/50 bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300">
                <ImageIcon size={15} />
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 rounded bg-cyan-100 dark:bg-cyan-900/50 px-1 py-0.5 text-[9px] font-bold text-cyan-700 dark:text-cyan-300">{t('home.gameCalendar')}</span>
                  <span className="truncate text-xs font-bold text-cyan-900 dark:text-cyan-100">{gameAnnouncementCalendar.title || t('home.gameCalendarTitle')}</span>
                </div>
              </div>
            </div>
            <ChevronRight size={14} className={`shrink-0 text-cyan-500 transition-transform ${showGameCalendar ? 'rotate-90' : ''}`} />
          </button>
          {showGameCalendar ? (
            <div className="px-3 pb-3">
              <button
                type="button"
                onClick={() => setExpandedGameCalendarImage(gameAnnouncementCalendar.imageUrl)}
                className="group relative block w-full overflow-hidden rounded-lg border border-cyan-200 dark:border-cyan-900/60 bg-white/80 dark:bg-black/30 p-2"
                aria-label={t('home.gameCalendarOpen')}
              >
                <img
                  src={gameAnnouncementCalendar.imageUrl}
                  alt={t('home.gameCalendarImageAlt')}
                  loading="lazy"
                  decoding="async"
                  className="max-h-72 w-full object-contain"
                />
                <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded border border-cyan-300 bg-white/90 px-2 py-1 text-[10px] font-bold text-cyan-700 shadow-sm dark:border-cyan-700 dark:bg-zinc-950/90 dark:text-cyan-300">
                  <Maximize2 size={11} />
                  {t('home.gameCalendarOpen')}
                </span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {expandedGameCalendarImage ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm"
          onClick={() => setExpandedGameCalendarImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label={t('home.gameCalendarOpen')}
        >
          <button
            type="button"
            className="absolute right-3 top-3 rounded-full border border-white/20 bg-black/40 p-2 text-white"
            onClick={() => setExpandedGameCalendarImage(null)}
            aria-label={t('common.close')}
          >
            <X size={20} />
          </button>
          <img
            src={expandedGameCalendarImage}
            alt={t('home.gameCalendarImageAlt')}
            className="max-h-[88vh] max-w-[94vw] object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 mb-6">
        {featureLinks.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.path)}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-ef-card p-3 text-left shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 text-slate-700 dark:text-zinc-300">
                  <Icon size={15} />
                </div>
                <ChevronRight size={14} className="mt-1 shrink-0 text-slate-400 dark:text-zinc-600" />
              </div>
              <div className="mt-3 text-xs font-bold text-slate-900 dark:text-white">{item.title}</div>
              <div className="mt-1 text-[10px] leading-relaxed text-slate-500 dark:text-zinc-500">{item.subtitle}</div>
            </button>
          );
        })}
      </div>

      {/* System Countdown */}
      {countdown ? (
        <div className="rounded-xl border border-amber-500/20 dark:border-ef-yellow/20 bg-zinc-100 dark:bg-black p-4 mb-6 relative overflow-hidden shadow-sm dark:shadow-[0_0_20px_rgba(255,250,0,0.05)]">
            {countdown.backgroundImage ? (
              <div className="absolute inset-y-0 right-0 w-[46%] pointer-events-none opacity-30 dark:opacity-40">
                <img src={countdown.backgroundImage} alt="" className="h-full w-full object-cover object-right" />
                <div className="absolute inset-0 bg-gradient-to-l from-transparent via-zinc-100/45 to-zinc-100 dark:via-black/25 dark:to-black" />
              </div>
            ) : null}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,250,0,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,250,0,0.03)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none"></div>
            <div className="relative z-10 flex flex-col items-center text-center">
              <div className="text-[9px] font-bold tracking-[0.2em] text-amber-600 dark:text-ef-yellow mb-1 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm bg-amber-400 dark:bg-ef-yellow animate-pulse"></span>{t('countdown.system')}</div>
              <h3 className="max-w-[75%] text-xl font-black text-slate-900 dark:text-white tracking-normal mb-1 uppercase">{countdown.active ? t('home.poolEndingCountdown', { name: localizedCountdownName }) : t('home.poolStartingCountdown', { name: localizedCountdownName })}</h3>
              <p className="text-[9px] text-slate-500 dark:text-zinc-500 font-mono mb-1 tracking-widest">{countdown.active ? t('home.mobile.countdownEnding', {}, isEnglish ? 'ENDING COUNTDOWN' : '结束倒计时') : t('home.mobile.countdownStarting', {}, isEnglish ? 'STARTING COUNTDOWN' : '开始倒计时')}</p>
              {countdownScheduleMeta ? (
                <p className="mb-4 text-[10px] text-slate-500 dark:text-zinc-400 font-mono tracking-wide">{countdownScheduleMeta}</p>
              ) : <div className="mb-4" />}
              <div className="flex items-baseline gap-1 countdown-nums font-bold text-4xl tracking-tighter">
                  <span className="text-slate-900 dark:text-white">{String(countdown.days).padStart(2, '0')}</span><span className="text-slate-400 dark:text-zinc-600 text-sm relative top-[-6px] ml-0.5 mr-2 font-sans font-bold">{isEnglish ? 'D' : '天'}</span>
                  <span className="text-slate-900 dark:text-white">{String(countdown.hours).padStart(2, '0')}</span><span className="text-slate-400 dark:text-zinc-600 text-sm relative top-[-6px] ml-0.5 mr-2 font-sans font-bold">{isEnglish ? 'H' : '时'}</span>
                  <span className="text-slate-900 dark:text-white">{String(countdown.minutes).padStart(2, '0')}</span><span className="text-slate-400 dark:text-zinc-600 text-sm relative top-[-6px] ml-0.5 mr-2 font-sans font-bold">{isEnglish ? 'M' : '分'}</span>
                  <span className="text-slate-900 dark:text-white">{String(countdown.seconds || 0).padStart(2, '0')}</span><span className="text-slate-400 dark:text-zinc-600 text-sm relative top-[-6px] ml-0.5 font-sans font-bold">{isEnglish ? 'S' : '秒'}</span>
              </div>
            </div>
        </div>
      ) : null}

      {/* Pool Schedule Placeholder */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-ef-card p-4 mb-6">
          <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-bold tracking-widest text-slate-900 dark:text-white flex items-center gap-2"><Calendar size={14}/> {t('home.mobile.calendarTitle')}</h3>
              <button type="button" onClick={() => navigate('/m/details')} className="text-slate-400 dark:text-zinc-600">
                <ChevronRight size={14} />
              </button>
          </div>
          <div className="space-y-3">
            {rotationPreview.length > 0 ? rotationPreview.map((pool) => (
              <div key={pool.name + pool.startDate} className="flex items-center gap-3 text-xs bg-zinc-100 dark:bg-zinc-900 p-2 rounded-lg border border-zinc-200 dark:border-zinc-800/50">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${pool.active ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.8)]' : pool.isExtraPool ? 'bg-cyan-500' : (pool.ended ? 'bg-zinc-500' : 'bg-blue-500')}`}></span>
                  <span className="w-10 text-[10px] text-slate-500 dark:text-zinc-500 font-mono shrink-0">{formatDateTime(pool.startDate, { month: 'numeric', day: 'numeric', includeYear: false }, t('common.timeUnknown'))}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold text-slate-900 dark:text-white">{pool.displayName || pool.name}</span>
                    <span className="mt-0.5 block truncate text-[9px] text-slate-500 dark:text-zinc-500">
                      {pool.versionName || t('home.mobile.currentRotation')}
                      {pool.foldedExtraCount > 0 ? ` · 已合并 ${pool.foldedExtraCount} 个过期附加池` : ''}
                    </span>
                  </span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${pool.active ? 'bg-green-500/20 text-green-700 dark:text-green-400' : (pool.ended ? 'bg-zinc-200 dark:bg-zinc-800 text-slate-500 dark:text-zinc-500' : 'bg-blue-500/20 text-blue-700 dark:text-blue-300')}`}>{pool.label}</span>
              </div>
            )) : (
              <div className="text-xs text-zinc-500">{t('home.mobile.rotationEmpty')}</div>
            )}
          </div>
      </div>

      {/* Next Version Countdown */}
      {nextVersionCountdown ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-ef-card p-4 mb-8 flex flex-col items-center justify-center relative overflow-hidden">
            <div className="text-[9px] font-bold tracking-[0.2em] text-slate-500 dark:text-zinc-500 mb-1 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm bg-zinc-600"></span>{t('countdown.system')}</div>
            <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-normal mb-2 uppercase">{nextVersionCardTitle}</h3>
            <div className="flex items-baseline gap-1 countdown-nums font-bold text-3xl text-slate-700 dark:text-zinc-300 tracking-tighter">
                <span>{String(nextVersionCountdown.days).padStart(2, '0')}</span><span className="text-slate-400 dark:text-zinc-600 text-xs relative top-[-4px] ml-0.5 mr-1 font-sans font-bold">{isEnglish ? 'D' : '天'}</span>
                <span>{String(nextVersionCountdown.hours).padStart(2, '0')}</span><span className="text-slate-400 dark:text-zinc-600 text-xs relative top-[-4px] ml-0.5 mr-1 font-sans font-bold">{isEnglish ? 'H' : '时'}</span>
                <span>{String(nextVersionCountdown.minutes).padStart(2, '0')}</span><span className="text-slate-400 dark:text-zinc-600 text-xs relative top-[-4px] ml-0.5 mr-1 font-sans font-bold">{isEnglish ? 'M' : '分'}</span>
                <span>{String(nextVersionCountdown.seconds || 0).padStart(2, '0')}</span><span className="text-slate-400 dark:text-zinc-600 text-xs relative top-[-4px] ml-0.5 font-sans font-bold">{isEnglish ? 'S' : '秒'}</span>
            </div>
            <div className="mt-2 text-[10px] text-slate-500 dark:text-zinc-500 font-mono">{nextVersionScheduleMeta}</div>
        </div>
      ) : null}

      {/* Friendly Links */}
      <div className="mb-6">
          <div className="flex items-center gap-2 mb-3 text-[10px] font-bold tracking-[0.1em] text-blue-700 dark:text-blue-400 uppercase">
              <div className="w-1.5 h-1.5 bg-blue-500"></div> {isEnglish ? 'FRIENDLY LINKS // Friendly Links' : `FRIENDLY LINKS // ${t('home.friendlyLinks.title', {}, '友情链接')}`}
          </div>
          <div className="grid grid-cols-2 gap-2">
              {translatedLinks.slice(0, 6).map((link, i) => (
                  <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="bg-white/80 dark:bg-zinc-900/70 backdrop-blur-xl border border-zinc-200 dark:border-white/5 shadow-sm p-3 rounded-lg flex flex-col justify-between h-20 group relative overflow-hidden">
                      <div className="absolute right-2 top-2 opacity-5 text-slate-400 dark:text-zinc-600 group-hover:scale-110 transition-transform">
                          {link.icon === 'map' ? <Map size={40} /> : (link.icon === 'globe' ? <Globe size={40} /> : <BarChart2 size={40} />)}
                      </div>
                      <div className="relative z-10">
                          <div className="text-[8px] text-slate-500 dark:text-zinc-500 uppercase tracking-widest font-mono mb-1 truncate">{link.icon === 'map' ? 'MAP WIKI' : (link.icon === 'globe' ? 'WIKI' : 'TOOL')}</div>
                          <div className="text-[11px] font-bold text-slate-900 dark:text-white leading-tight line-clamp-2">{link.title}</div>
                      </div>
                      <div className="flex justify-between items-center text-[8px] text-slate-500 dark:text-zinc-500 font-mono mt-1 relative z-10">
                          <span className="truncate">{link.hostname}</span>
                          <ArrowUpRight size={10} className="shrink-0 group-hover:text-slate-900 dark:text-white" />
                      </div>
                  </a>
              ))}
          </div>
      </div>
    </div>
  );
}
