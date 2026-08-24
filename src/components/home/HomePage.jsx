import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowRight,
  AlertTriangle,
  BarChart3,
  Bell,
  ChevronUp,
  ExternalLink,
  Shield,
  Sparkles,
  Star,
  Users
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
import HomeAnnouncementContent from './AnnouncementContent';
import CollapsibleContent from './CollapsibleContent';
import HomeFriendlyLinksCard from './FriendlyLinksCard';
import GameAnnouncementFeed from './GameAnnouncementFeed';
import GuideCard from './GuideCard';
import PoolMechanicsCard from './PoolMechanicsCard';
import RoadmapCard from './RoadmapCard';
import HomeRotationScheduleCard from './RotationScheduleCard';
import SummerLotteryBanner from './SummerLotteryBanner';
import DonationThanksCard from '../donations/DonationThanksCard.jsx';
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
import { resolveGameAnnouncementDigest } from '../../utils/gameAnnouncementDigest.js';
import {
  buildHomeRotationVersionSections,
  buildHomeVersionCountdownTitle,
  resolveHomeVersionPlan,
} from '../../utils/homeVersionTimeline.js';
import {
  getAnnouncementSeverityMeta,
  getAnnouncementTypeLabel,
  getMostImportantAnnouncement,
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
  const mostImportantTemporaryAnnouncement = useMemo(
    () => getMostImportantAnnouncement(temporaryAnnouncements),
    [temporaryAnnouncements]
  );
  const temporarySeverityMeta = getAnnouncementSeverityMeta(
    mostImportantTemporaryAnnouncement?.severity,
    locale
  );
  const hasAnnouncementUpdate = latestSiteAnnouncement
    ? hasNewContent(STORAGE_KEYS.ANNOUNCEMENT_LAST_VIEWED, latestSiteAnnouncement.updated_at || latestSiteAnnouncement.created_at)
    : false;
  const [showTemporaryAnnouncements, setShowTemporaryAnnouncements] = useState(
    () => hasAnnouncementUpdate || !initialCollapseState.temporaryAnnouncements
  );

  const [showPoolMechanics, setShowPoolMechanics] = useState(!initialCollapseState.poolMechanics);
  const [showGuide, setShowGuide] = useState(!initialCollapseState.guide);
  const [showRoadmap, setShowRoadmap] = useState(!initialCollapseState.roadmap);
  const [showUpdateAnnouncement, setShowUpdateAnnouncement] = useState(
    hasAnnouncementUpdate ? true : !initialCollapseState.announcement
  );
  const [showGameAnnouncements, setShowGameAnnouncements] = useState(!initialCollapseState.gameAnnouncements);
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

  const handleToggleTemporaryAnnouncements = useCallback(() => {
    setShowTemporaryAnnouncements((previous) => {
      const next = !previous;
      setHomeCollapseState('temporaryAnnouncements', !next);
      return next;
    });
  }, []);

  const handleToggleGameAnnouncements = useCallback(() => {
    setShowGameAnnouncements((prev) => {
      const next = !prev;
      setHomeCollapseState('gameAnnouncements', !next);
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
    if ((showUpdateAnnouncement || showTemporaryAnnouncements) && isAnnouncementNew) {
      handleAnnouncementViewed();
    }
  }, [
    showUpdateAnnouncement,
    showTemporaryAnnouncements,
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
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <h2 className="flex items-center gap-3 text-2xl font-bold">
                <BarChart3 size={28} />
                <span>{t('app.brand')}</span>
              </h2>
              <div className="flex flex-wrap items-center gap-2 font-mono">
                <a
                  href="https://ef-gacha.mogujun.icu/"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${t('home.siteLinks.main')}: ef-gacha.mogujun.icu`}
                  className="group inline-flex items-center gap-2 border border-endfield-yellow/50 bg-black/20 px-2.5 py-1 text-[10px] font-medium tracking-wide text-zinc-100 transition-colors hover:bg-endfield-yellow/15 hover:text-endfield-yellow"
                >
                  <span className="h-1.5 w-1.5 bg-endfield-yellow shadow-[0_0_6px_rgba(250,204,21,0.7)]" />
                  <span>ef-gacha.mogujun.icu</span>
                  <ExternalLink size={10} className="text-zinc-500 transition-colors group-hover:text-endfield-yellow" />
                </a>
                <a
                  href="https://ef.nepst.cn/"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${t('home.siteLinks.backup')}: ef.nepst.cn`}
                  className="group inline-flex items-center gap-2 border border-zinc-600 bg-black/20 px-2.5 py-1 text-[10px] font-medium tracking-wide text-zinc-300 transition-colors hover:border-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <span className="h-1.5 w-1.5 bg-zinc-400" />
                  <span>ef.nepst.cn</span>
                  <ExternalLink size={10} className="text-zinc-600 transition-colors group-hover:text-zinc-300" />
                </a>
              </div>
            </div>
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

          <div className="flex shrink-0 items-center gap-3 self-end md:self-center animate-fade-in-up">
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
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

        <DonationThanksCard />
      </div>

      {(temporaryAnnouncements.length > 0 || latestAnnouncement || gameAnnouncements.length > 0) && (
        <div className="space-y-3">
          {temporaryAnnouncements.length > 0 && (
            <div className={`${temporarySeverityMeta.card} overflow-hidden border`}>
              <button
                type="button"
                onClick={handleToggleTemporaryAnnouncements}
                aria-expanded={showTemporaryAnnouncements}
                className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-white/30 dark:hover:bg-white/5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`relative shrink-0 p-2 ${temporarySeverityMeta.icon}`}>
                    <AlertTriangle size={20} />
                    {isAnnouncementNew && (
                      <span className="absolute -right-1 -top-1 bg-red-500 px-1 py-0.5 text-[8px] font-bold text-white animate-pulse">NEW</span>
                    )}
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${temporarySeverityMeta.badge}`}>
                        {getAnnouncementTypeLabel('temporary', locale)} × {temporaryAnnouncements.length}
                      </span>
                      <span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${temporarySeverityMeta.badge}`}>
                        {temporarySeverityMeta.displayLabel}
                      </span>
                      <h3 className="truncate font-bold">
                        {getLocalizedAnnouncementTitle(mostImportantTemporaryAnnouncement, locale)}
                      </h3>
                    </div>
                    <p className="mt-1 text-[11px] opacity-65">{t('home.temporaryAnnouncementsMerged', { count: temporaryAnnouncements.length })}</p>
                  </div>
                </div>
                <ChevronUp size={20} className={`${temporarySeverityMeta.chevron} shrink-0 transition-transform duration-300 ${showTemporaryAnnouncements ? '' : 'rotate-180'}`} />
              </button>

              <CollapsibleContent isOpen={showTemporaryAnnouncements} unmountOnClose>
                <div className="space-y-3 border-t border-current/10 px-4 pb-4 pt-3">
                  {temporaryAnnouncements.map((announcement, index) => {
                    const itemSeverity = getAnnouncementSeverityMeta(announcement.severity, locale);
                    return (
                      <article key={announcement.id || `${announcement.title}-${index}`} className={`border ${itemSeverity.card}`}>
                        <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
                          <span className={`px-1.5 py-0.5 text-[9px] font-bold ${itemSeverity.badge}`}>{itemSeverity.displayLabel}</span>
                          <h4 className="text-sm font-black">{getLocalizedAnnouncementTitle(announcement, locale)}</h4>
                        </div>
                        <HomeAnnouncementContent content={getLocalizedAnnouncementContent(announcement, locale)} />
                      </article>
                    );
                  })}
                </div>
              </CollapsibleContent>
            </div>
          )}

          <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
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

          <div className="flex h-full flex-col">
            <HomecomingPreviewCard
              targetDate={nextVersionTargetDate}
              title={nextVersionCountdownTitle}
            />
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
