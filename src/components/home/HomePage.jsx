import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowRight,
  AlertTriangle,
  BarChart3,
  Bell,
  ChevronUp,
  Image,
  Maximize2,
  Shield,
  Sparkles,
  Star,
  Users,
  X
} from 'lucide-react';
import confetti from 'canvas-confetti';
import {
  getActiveHomeCountdownPools,
  getCurrentUpPoolInfo,
  getHomeRotationPoolSchedule,
  getLimitedPoolCountdownState,
  getLimitedPoolSchedule
} from '../../utils/poolTimeUtils';
import usePoolStore from '../../stores/usePoolStore';
import useSiteConfigStore, {
  HOME_NEXT_VERSION_TARGET_CONFIG_KEY,
  HOME_VERSION_TIMELINE_CONFIG_KEY,
} from '../../stores/useSiteConfigStore';
import CountdownTimer from './CountdownTimer';
import HomecomingPreviewCard from './HomecomingPreviewCard';
import NextVersionCountdownCard from './NextVersionCountdownCard';
import HomeAnnouncementContent from './AnnouncementContent';
import CollapsibleContent from './CollapsibleContent';
import HomeFriendlyLinksCard from './FriendlyLinksCard';
import GameAnnouncementFeed from './GameAnnouncementFeed';
import GuideCard from './GuideCard';
import PoolMechanicsCard from './PoolMechanicsCard';
import RoadmapCard from './RoadmapCard';
import HomeRotationScheduleCard from './RotationScheduleCard';
import SummerLotteryBanner from './SummerLotteryBanner';
import { ACCOUNT_RECOVERY_QQ_GROUP, ENGLISH_COMMUNITY_DISCORD_URL } from '../../constants/community';
import {
  STORAGE_KEYS,
  getHomeCollapseState,
  hasNewContent,
  markAsViewed,
  setHomeCollapseState
} from '../../utils';
import { useAppStore, useAuthStore } from '../../stores';
import { useI18n } from '../../i18n/index.js';
import { localizeEntityName } from '../../utils/gameDataI18n.js';
import { getLocalizedAnnouncementContent, getLocalizedAnnouncementTitle } from '../../utils/announcementLocale.js';
import { resolveGameAnnouncementCalendarImage } from '../../utils/gameAnnouncementCalendar.js';
import { resolveGameAnnouncementDigest } from '../../utils/gameAnnouncementDigest.js';
import {
  buildHomeRotationVersionSections,
  buildHomeVersionCountdownTitle,
  resolveHomeVersionPlan,
} from '../../utils/homeVersionTimeline.js';
import {
  getAnnouncementSeverityMeta,
  getAnnouncementTypeLabel,
  splitSiteAnnouncements
} from '../../utils/announcementMeta.js';

const HomePage = React.memo(() => {
  const { t, isEnglish, locale } = useI18n();
  const user = useAuthStore((state) => state.user);
  const announcements = useAppStore((state) => state.announcements);
  const gameAnnouncements = useAppStore((state) => state.gameAnnouncements);
  const storedGameAnnouncementDigest = useAppStore((state) => state.gameAnnouncementDigest);
  const pools = usePoolStore((state) => state.pools);
  const nextVersionTargetConfigValue = useSiteConfigStore(
    (state) => state.config[HOME_NEXT_VERSION_TARGET_CONFIG_KEY]
  );
  const versionTimelineConfigValue = useSiteConfigStore(
    (state) => state.config[HOME_VERSION_TIMELINE_CONFIG_KEY]
  );
  const communityLinkLabel = ENGLISH_COMMUNITY_DISCORD_URL.replace(/^https?:\/\//u, '');

  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const poolsArray = useMemo(() => (Array.isArray(pools) ? pools : []), [pools]);
  const versionPlan = useMemo(() => resolveHomeVersionPlan({
    timelineConfig: versionTimelineConfigValue,
    legacyTargetAt: nextVersionTargetConfigValue,
    locale,
    now,
  }), [locale, nextVersionTargetConfigValue, now, versionTimelineConfigValue]);
  const nextVersionTargetDate = versionPlan.targetAt;
  const nextVersionCountdownTitle = useMemo(() => buildHomeVersionCountdownTitle(versionPlan, {
    baseTitle: t('home.nextVersionCountdown'),
  }), [t, versionPlan]);

  const limitedPoolSchedule = useMemo(() => getLimitedPoolSchedule(poolsArray), [poolsArray]);
  const poolSchedule = useMemo(() => getHomeRotationPoolSchedule(poolsArray), [poolsArray]);
  const poolScheduleVersionSections = useMemo(() => buildHomeRotationVersionSections({
    poolSchedule,
    versionPlan,
    now,
  }), [now, poolSchedule, versionPlan]);
  const currentUpInfo = useMemo(() => getCurrentUpPoolInfo(poolsArray, now), [poolsArray, now]);

  const countdowns = useMemo(() => {
    let main = getLimitedPoolCountdownState(limitedPoolSchedule, now);

    if (main) {
      const localizedBannerName = localizeEntityName(main.name, {
        locale: isEnglish ? 'en-US' : 'zh-CN',
        type: 'character'
      }) || main.name;
      main = {
        ...main,
        title: main.isActive
          ? t('home.poolEndingCountdown', { name: localizedBannerName })
          : t('home.poolStartingCountdown', { name: localizedBannerName }),
        subTitle: main.isActive
          ? t('home.poolEndingSubtitle', { name: localizedBannerName })
          : t('home.poolStartingSubtitle', { name: localizedBannerName })
      };
    }

    const activeHomeCountdownPools = getActiveHomeCountdownPools(poolsArray, now);
    const secondaryPools = activeHomeCountdownPools.filter((pool) => {
      if (!main || pool.poolType !== 'limited') {
        return true;
      }

      return pool.name !== main.name && pool.id !== main.id;
    });
    const secondary = secondaryPools[0] || null;
    let secondaryCountdown = null;

    if (secondary) {
      const localizedSecondaryName = secondary.poolType === 'limited'
        ? localizeEntityName(secondary.name, {
          locale: isEnglish ? 'en-US' : 'zh-CN',
          type: 'character'
        }) || secondary.name
        : secondary.displayName || secondary.name;
      secondaryCountdown = {
        ...secondary,
        title: t('home.poolEndingCountdown', { name: localizedSecondaryName }),
        subTitle: t('home.poolEndingSubtitle', { name: localizedSecondaryName })
      };
    }

    if (!main) {
      main = {
        targetDate: nextVersionTargetDate,
        title: nextVersionCountdownTitle,
        subTitle: t('home.nextVersionWaiting')
      };
    }

    return { main, secondary: secondaryCountdown };
  }, [isEnglish, limitedPoolSchedule, nextVersionCountdownTitle, nextVersionTargetDate, now, poolsArray, t]);

  const initialCollapseState = useMemo(() => getHomeCollapseState(), []);
  const { temporary: temporaryAnnouncements, updates: updateAnnouncements } = useMemo(
    () => splitSiteAnnouncements(announcements),
    [announcements]
  );
  const latestAnnouncement = updateAnnouncements[0] || null;
  const latestAnnouncementTitle = getLocalizedAnnouncementTitle(latestAnnouncement, locale);
  const latestAnnouncementContent = getLocalizedAnnouncementContent(latestAnnouncement, locale);
  const latestSiteAnnouncement = useMemo(() => (
    [...temporaryAnnouncements, ...updateAnnouncements].sort((a, b) => (
      new Date(b?.updated_at || b?.created_at || 0) - new Date(a?.updated_at || a?.created_at || 0)
    ))[0] || null
  ), [temporaryAnnouncements, updateAnnouncements]);
  const gameAnnouncementDigest = useMemo(
    () => resolveGameAnnouncementDigest(storedGameAnnouncementDigest, gameAnnouncements, t),
    [gameAnnouncements, storedGameAnnouncementDigest, t]
  );
  const gameAnnouncementCalendar = useMemo(
    () => resolveGameAnnouncementCalendarImage(gameAnnouncements),
    [gameAnnouncements]
  );
  const hasAnnouncementUpdate = latestSiteAnnouncement
    ? hasNewContent(STORAGE_KEYS.ANNOUNCEMENT_LAST_VIEWED, latestSiteAnnouncement.updated_at || latestSiteAnnouncement.created_at)
    : false;
  const temporaryAnnouncementKeys = useMemo(
    () => temporaryAnnouncements.map((announcement, index) => (
      String(
        announcement?.id
        || announcement?.source_id
        || `${announcement?.updated_at || announcement?.created_at || 'no-time'}:${announcement?.title || 'untitled'}:${index}`
      )
    )),
    [temporaryAnnouncements]
  );
  const [shouldDefaultOpenTemporaryAnnouncements] = useState(
    () => hasAnnouncementUpdate || !initialCollapseState.temporaryAnnouncements
  );

  const [showPoolMechanics, setShowPoolMechanics] = useState(!initialCollapseState.poolMechanics);
  const [showGuide, setShowGuide] = useState(!initialCollapseState.guide);
  const [showRoadmap, setShowRoadmap] = useState(!initialCollapseState.roadmap);
  const [showUpdateAnnouncement, setShowUpdateAnnouncement] = useState(
    hasAnnouncementUpdate ? true : !initialCollapseState.announcement
  );
  const [temporaryAnnouncementOverrides, setTemporaryAnnouncementOverrides] = useState(() => new Map());
  const [showGameAnnouncements, setShowGameAnnouncements] = useState(!initialCollapseState.gameAnnouncements);
  const [showGameCalendar, setShowGameCalendar] = useState(!initialCollapseState.gameCalendar);
  const [expandedGameCalendarImage, setExpandedGameCalendarImage] = useState(null);
  const [isAnnouncementNew, setIsAnnouncementNew] = useState(hasAnnouncementUpdate);

  const handleTogglePoolMechanics = useCallback(() => {
    setShowPoolMechanics((prev) => {
      const next = !prev;
      setHomeCollapseState('poolMechanics', !next);
      return next;
    });
  }, []);

  const handleToggleGuide = useCallback(() => {
    setShowGuide((prev) => {
      const next = !prev;
      setHomeCollapseState('guide', !next);
      return next;
    });
  }, []);

  const handleToggleRoadmap = useCallback(() => {
    setShowRoadmap((prev) => {
      const next = !prev;
      setHomeCollapseState('roadmap', !next);
      return next;
    });
  }, []);

  const handleToggleAnnouncement = useCallback(() => {
    setShowUpdateAnnouncement((prev) => {
      const next = !prev;
      setHomeCollapseState('announcement', !next);
      return next;
    });
  }, []);

  const handleToggleTemporaryAnnouncement = useCallback((announcementKey, isExpanded) => {
    const next = new Map(temporaryAnnouncementOverrides);
    const nextExpanded = !isExpanded;
    if (nextExpanded === shouldDefaultOpenTemporaryAnnouncements) {
      next.delete(announcementKey);
    } else {
      next.set(announcementKey, nextExpanded);
    }

    const hasAnyExpanded = temporaryAnnouncementKeys.some((key) => (
      key === announcementKey
        ? nextExpanded
        : (next.has(key) ? next.get(key) : shouldDefaultOpenTemporaryAnnouncements)
    ));
    setHomeCollapseState('temporaryAnnouncements', !hasAnyExpanded);
    setTemporaryAnnouncementOverrides(next);
  }, [shouldDefaultOpenTemporaryAnnouncements, temporaryAnnouncementKeys, temporaryAnnouncementOverrides]);

  const handleToggleGameAnnouncements = useCallback(() => {
    setShowGameAnnouncements((prev) => {
      const next = !prev;
      setHomeCollapseState('gameAnnouncements', !next);
      return next;
    });
  }, []);

  const handleToggleGameCalendar = useCallback(() => {
    setShowGameCalendar((prev) => {
      const next = !prev;
      setHomeCollapseState('gameCalendar', !next);
      return next;
    });
  }, []);

  const handleAnnouncementViewed = useCallback(() => {
    if (!isAnnouncementNew) {
      return;
    }

    setTimeout(() => {
      markAsViewed(STORAGE_KEYS.ANNOUNCEMENT_LAST_VIEWED);
      setIsAnnouncementNew(false);
    }, 2000);
  }, [isAnnouncementNew]);

  useEffect(() => {
    const hasExpandedTemporaryAnnouncement = temporaryAnnouncementKeys.some((key) => (
      temporaryAnnouncementOverrides.has(key)
        ? temporaryAnnouncementOverrides.get(key)
        : shouldDefaultOpenTemporaryAnnouncements
    ));
    if ((showUpdateAnnouncement || hasExpandedTemporaryAnnouncement) && isAnnouncementNew) {
      handleAnnouncementViewed();
    }
  }, [
    showUpdateAnnouncement,
    temporaryAnnouncementKeys,
    temporaryAnnouncementOverrides,
    shouldDefaultOpenTemporaryAnnouncements,
    isAnnouncementNew,
    handleAnnouncementViewed
  ]);

  const handleCelebrationClick = useCallback((event) => {
    event.preventDefault();
    const x = event.clientX / window.innerWidth;
    const y = event.clientY / window.innerHeight;

    confetti({
      particleCount: 150,
      spread: 80,
      origin: { x, y }
    });
  }, []);

  return (
    <div className="space-y-6 animate-fade-in relative">
      <div className="relative overflow-hidden border-l-4 transition-all duration-500 bg-gradient-to-r from-zinc-800 to-zinc-900 dark:from-zinc-900 dark:to-black border-endfield-yellow p-6 text-white">
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-3">
                <BarChart3 size={28} />
                <span>{t('app.brand')}</span>
              </div>
            </h2>
            <p className="text-sm text-indigo-100">
              {t('home.heroSubtitle')}
            </p>
            {!user && (
              <p className="text-xs mt-2 flex items-center gap-1 text-indigo-200">
                <ArrowRight size={12} />
                {t('home.loginHint')}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 self-end md:self-center animate-fade-in-up">
            <button
              onClick={handleCelebrationClick}
              className="group flex items-center gap-3 px-4 py-2 rounded-full transition-all cursor-pointer border bg-yellow-500/10 hover:bg-yellow-500/20 border-yellow-500/50 text-endfield-yellow"
            >
              <span className="text-sm font-bold font-mono tracking-wide">{t('home.celebration')}</span>
              <div className="p-1.5 rounded-full transition-colors bg-yellow-500/20 group-hover:bg-yellow-500 group-hover:text-black text-yellow-500">
                <Sparkles size={16} className="animate-pulse" />
              </div>
            </button>
          </div>
        </div>

        <div className="absolute -right-10 -bottom-10 pointer-events-none text-white/10">
          <Star size={200} />
        </div>
      </div>

      <SummerLotteryBanner />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/50 rounded-none overflow-hidden shadow-sm">
          <div className="px-4 py-3 flex items-start gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-500 shrink-0">
              <Shield size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-green-800 dark:text-green-400 mb-1">
                {t('home.securityTitle')}
              </h3>
              <div className="text-xs text-green-700 dark:text-green-500/80 leading-relaxed space-y-1">
                <p>{t('home.securityCopy1')}</p>
                <p>{t('home.securityCopy2')}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 dark:bg-black border border-zinc-800 rounded-none overflow-hidden shadow-sm text-white">
          <div className="px-4 py-3 flex items-start gap-3">
            <div className="p-2 bg-endfield-yellow/15 text-endfield-yellow border border-endfield-yellow/30 shrink-0">
              <Users size={20} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white mb-1">
                {t('home.communityTitle')}
              </h3>
              <div className="text-xs text-zinc-300 leading-relaxed space-y-2">
                <p>{t('home.communityCopy1')}</p>
                {isEnglish ? (
                  <a
                    href={ENGLISH_COMMUNITY_DISCORD_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t('home.communityOpenLink')}
                    className="block border border-zinc-700 bg-zinc-950/80 px-3 py-2 font-mono text-sm tracking-wide text-endfield-yellow break-all transition-colors hover:border-endfield-yellow/50 hover:text-white"
                  >
                    {communityLinkLabel}
                  </a>
                ) : (
                  <div className="border border-zinc-700 bg-zinc-950/80 px-3 py-2 font-mono text-base tracking-wider text-endfield-yellow">
                    {ACCOUNT_RECOVERY_QQ_GROUP}
                  </div>
                )}
                <p className="text-zinc-400">{t('home.communityCopy2')}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {(temporaryAnnouncements.length > 0 || latestAnnouncement || gameAnnouncements.length > 0) && (
        <div className="space-y-3">
          {temporaryAnnouncements.map((announcement, index) => {
            const announcementKey = temporaryAnnouncementKeys[index];
            const isTemporaryAnnouncementExpanded = temporaryAnnouncementOverrides.has(announcementKey)
              ? temporaryAnnouncementOverrides.get(announcementKey)
              : shouldDefaultOpenTemporaryAnnouncements;
            const severityMeta = getAnnouncementSeverityMeta(announcement.severity, locale);
            const title = getLocalizedAnnouncementTitle(announcement, locale);
            const content = getLocalizedAnnouncementContent(announcement, locale);
            return (
              <div key={announcementKey} className={`${severityMeta.card} border rounded-none overflow-hidden`}>
                <button
                  type="button"
                  onClick={() => handleToggleTemporaryAnnouncement(announcementKey, isTemporaryAnnouncementExpanded)}
                  aria-expanded={isTemporaryAnnouncementExpanded}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/30 dark:hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-none shrink-0 relative ${severityMeta.icon}`}>
                      <AlertTriangle size={20} />
                      {isAnnouncementNew && (
                        <span className="absolute -top-1 -right-1 px-1 py-0.5 text-[8px] font-bold bg-red-500 text-white rounded animate-pulse">
                          NEW
                        </span>
                      )}
                    </div>
                    <div className="text-left min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] px-1.5 py-0.5 font-bold uppercase tracking-wide ${severityMeta.badge}`}>
                          {getAnnouncementTypeLabel('temporary', locale)}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 font-bold uppercase tracking-wide ${severityMeta.badge}`}>
                          {severityMeta.displayLabel}
                        </span>
                        <h3 className="font-bold truncate">{title}</h3>
                        {isAnnouncementNew && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold bg-red-500 text-white rounded animate-pulse">
                            NEW
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <ChevronUp size={20} className={`${severityMeta.chevron} transition-transform duration-300 ${isTemporaryAnnouncementExpanded ? '' : 'rotate-180'}`} />
                </button>

                <CollapsibleContent isOpen={isTemporaryAnnouncementExpanded} unmountOnClose>
                  <HomeAnnouncementContent content={content} />
                </CollapsibleContent>
              </div>
            );
          })}

          {latestAnnouncement && (
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border border-amber-200 dark:border-amber-800 rounded-none overflow-hidden">
              <button
                onClick={handleToggleAnnouncement}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-none text-amber-600 dark:text-amber-400 shrink-0 relative">
                    <Bell size={20} />
                    {isAnnouncementNew && (
                      <span className="absolute -top-1 -right-1 px-1 py-0.5 text-[8px] font-bold bg-red-500 text-white rounded animate-pulse">
                        NEW
                      </span>
                    )}
                  </div>
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-200 dark:bg-amber-800 text-amber-700 dark:text-amber-300 font-bold uppercase tracking-wide">{getAnnouncementTypeLabel('update', locale)}</span>
                      <h3 className="font-bold text-amber-800 dark:text-amber-300">{latestAnnouncementTitle}</h3>
                      {isAnnouncementNew && (
                        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-red-500 text-white rounded animate-pulse">
                          NEW
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <ChevronUp size={20} className={`text-amber-400 transition-transform duration-300 ${showUpdateAnnouncement ? '' : 'rotate-180'}`} />
              </button>

              <CollapsibleContent isOpen={showUpdateAnnouncement} unmountOnClose>
                <HomeAnnouncementContent content={latestAnnouncementContent} />
              </CollapsibleContent>
            </div>
          )}

          {gameAnnouncements.length > 0 && (
            <div className="bg-gradient-to-r from-amber-50/60 to-orange-50/60 dark:from-amber-950/20 dark:to-orange-950/20 border border-amber-200/70 dark:border-amber-800/50 rounded-none overflow-hidden">
              <button
                onClick={handleToggleGameAnnouncements}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-amber-100/30 dark:hover:bg-amber-900/20 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-100/70 dark:bg-amber-900/20 text-amber-500 dark:text-amber-500 shrink-0">
                    <Bell size={18} />
                  </div>
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                      <span className="text-[10px] px-1.5 py-0.5 bg-orange-200 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 font-bold uppercase tracking-wide">{t('home.gameAnnouncement')}</span>
                      <h3 className="font-bold text-amber-700 dark:text-amber-400">
                        {gameAnnouncementDigest.title}
                      </h3>
                    </div>
                    <p className="text-[11px] text-amber-600/60 dark:text-amber-500/50 mt-0.5">
                      {gameAnnouncementDigest.subtitle}
                    </p>
                  </div>
                </div>
                <ChevronUp size={20} className={`text-amber-400 transition-transform duration-300 ${showGameAnnouncements ? '' : 'rotate-180'}`} />
              </button>

              <CollapsibleContent isOpen={showGameAnnouncements} unmountOnClose>
                <GameAnnouncementFeed announcements={gameAnnouncements} maxItems={5} />
              </CollapsibleContent>
            </div>
          )}
        </div>
      )}

      {gameAnnouncementCalendar && (
        <div className="bg-gradient-to-r from-cyan-50/70 to-blue-50/60 dark:from-cyan-950/20 dark:to-blue-950/20 border border-cyan-200/70 dark:border-cyan-800/50 rounded-none overflow-hidden">
          <button
            type="button"
            onClick={handleToggleGameCalendar}
            className="w-full px-4 py-3 flex items-center justify-between gap-4 hover:bg-cyan-100/30 dark:hover:bg-cyan-900/20 transition-colors"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="p-2 bg-cyan-100/80 dark:bg-cyan-900/25 text-cyan-600 dark:text-cyan-400 shrink-0">
                <Image size={18} />
              </div>
              <div className="min-w-0 text-left">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 bg-cyan-200 dark:bg-cyan-900/50 text-cyan-700 dark:text-cyan-300 font-bold uppercase tracking-wide">{t('home.gameCalendar')}</span>
                  <h3 className="min-w-0 truncate font-bold text-cyan-700 dark:text-cyan-300">
                    {gameAnnouncementCalendar.title || t('home.gameCalendarTitle')}
                  </h3>
                </div>
              </div>
            </div>
            <ChevronUp size={20} className={`shrink-0 text-cyan-400 transition-transform duration-300 ${showGameCalendar ? '' : 'rotate-180'}`} />
          </button>

          <CollapsibleContent isOpen={showGameCalendar} unmountOnClose>
            <div className="px-4 pb-4">
              <button
                type="button"
                onClick={() => setExpandedGameCalendarImage(gameAnnouncementCalendar.imageUrl)}
                className="group relative block w-full overflow-hidden border border-cyan-200 bg-white/70 p-2 text-left transition-colors hover:border-cyan-400 dark:border-cyan-900/50 dark:bg-zinc-950/30"
                aria-label={t('home.gameCalendarOpen')}
              >
                <img
                  src={gameAnnouncementCalendar.imageUrl}
                  alt={t('home.gameCalendarImageAlt')}
                  loading="lazy"
                  decoding="async"
                  className="max-h-[400px] w-full object-contain"
                />
                <span className="absolute right-3 top-3 inline-flex items-center gap-1 border border-cyan-300 bg-white/90 px-2 py-1 text-[11px] font-bold text-cyan-700 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 dark:border-cyan-700 dark:bg-zinc-950/90 dark:text-cyan-300">
                  <Maximize2 size={12} />
                  {t('home.gameCalendarOpen')}
                </span>
              </button>
            </div>
          </CollapsibleContent>
        </div>
      )}

      {expandedGameCalendarImage && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setExpandedGameCalendarImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label={t('home.gameCalendarOpen')}
        >
          <button
            type="button"
            className="absolute right-4 top-4 border border-white/20 bg-black/40 p-2 text-white transition-colors hover:border-red-400 hover:text-red-300"
            onClick={() => setExpandedGameCalendarImage(null)}
            aria-label={t('common.close')}
          >
            <X size={22} />
          </button>
          <img
            src={expandedGameCalendarImage}
            alt={t('home.gameCalendarImageAlt')}
            className="max-h-[90vh] max-w-[94vw] object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}

      <div className="flex flex-col gap-4">
        <div className="relative">
          {countdowns.main && (
            <CountdownTimer
              targetDate={countdowns.main.targetDate}
              title={countdowns.main.title}
              subTitle={countdowns.main.subTitle}
              link={null}
              characterName={countdowns.main.name}
              scheduleDate={countdowns.main.scheduleDate || countdowns.main.startDate}
            />
          )}
        </div>
        {countdowns.secondary && (
          <div className="relative">
            <CountdownTimer
              targetDate={countdowns.secondary.targetDate}
              title={countdowns.secondary.title}
              subTitle={countdowns.secondary.subTitle}
              link={null}
              characterName={countdowns.secondary.poolType === 'limited' ? countdowns.secondary.name : null}
              featuredCharacterNames={countdowns.secondary.poolType === 'extra' ? countdowns.secondary.featuredNames : []}
              bgImage={countdowns.secondary.poolType === 'extra' ? null : countdowns.secondary.backgroundImage}
              scheduleDate={countdowns.secondary.scheduleDate || countdowns.secondary.startDate}
            />
          </div>
        )}

        <HomeRotationScheduleCard poolSchedule={poolSchedule} versionSections={poolScheduleVersionSections} now={now} />

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.3fr] gap-6">
          <HomeFriendlyLinksCard />

          <div className="flex flex-col gap-6">
            <HomecomingPreviewCard />
            <div className="shrink-0 min-h-32">
              <NextVersionCountdownCard
                targetDate={nextVersionTargetDate}
                title={nextVersionCountdownTitle}
                subTitle={t('home.nextVersionRelease')}
                endedText={t('home.versionLaunched')}
                scheduleLabel={t('home.countdown.releaseAt')}
              />
            </div>
          </div>
        </div>
      </div>

      <GuideCard isOpen={showGuide} onToggle={handleToggleGuide} />
      <PoolMechanicsCard
        isOpen={showPoolMechanics}
        onToggle={handleTogglePoolMechanics}
        currentUpInfo={currentUpInfo}
      />
      <RoadmapCard isOpen={showRoadmap} onToggle={handleToggleRoadmap} />
    </div>
  );
});

HomePage.displayName = 'HomePage';

export default HomePage;
