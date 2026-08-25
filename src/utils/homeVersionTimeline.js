export const HOME_NEXT_VERSION_TARGET_CONFIG_KEY = 'home_next_version_target_at';
export const HOME_VERSION_TIMELINE_CONFIG_KEY = 'home_version_timeline';
export const DEFAULT_HOME_NEXT_VERSION_TARGET_DATE = '2026-06-05T12:00:00+08:00';

export const DEFAULT_HOME_VERSION_TIMELINE = Object.freeze([
  Object.freeze({
    id: 'pre-summer-2026',
    name: '寻遗散记',
    name_en: 'Lost Heirlooms',
    starts_at: DEFAULT_HOME_NEXT_VERSION_TARGET_DATE,
    ends_at: null,
    enabled: true,
    order: 10,
    pool_ids: [],
  }),
]);

function buildDefaultHomeVersionTimeline(fallbackStartAt = DEFAULT_HOME_NEXT_VERSION_TARGET_DATE) {
  return DEFAULT_HOME_VERSION_TIMELINE.map((version, index) => ({
    ...version,
    starts_at: index === 0
      ? (parseHomeVersionTimestamp(fallbackStartAt) || DEFAULT_HOME_NEXT_VERSION_TARGET_DATE)
      : version.starts_at,
  }));
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJsonMaybe(value) {
  if (!value || typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function parseHomeVersionTimestamp(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? normalized : null;
}

function getVersionStartAt(version) {
  return parseHomeVersionTimestamp(
    version?.starts_at
    || version?.startsAt
    || version?.start_time
    || version?.startTime
    || version?.target_at
    || version?.targetAt
  );
}

function getVersionEndAt(version) {
  return parseHomeVersionTimestamp(
    version?.ends_at
    || version?.endsAt
    || version?.end_time
    || version?.endTime
  );
}

function toTimestamp(value) {
  const normalized = parseHomeVersionTimestamp(value);
  if (!normalized) {
    return NaN;
  }

  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function normalizeScheduleTimestamp(value) {
  const timestamp = new Date(value || '').getTime();
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function getSchedulePoolId(pool) {
  return normalizeText(pool?.id || pool?.pool_id || pool?.poolId || pool?.poolData?.pool_id || pool?.poolData?.id);
}

function isExtraSchedulePool(pool) {
  return pool?.poolType === 'extra' || pool?.poolData?.type === 'extra';
}

function isReconstructionCharacterSchedulePool(pool) {
  return pool?.homeNodeKind === 'reconstruction-character'
    || pool?.poolData?.extra_rule_profile === 'reconstruction_character_v1'
    || pool?.poolData?.extraRuleProfile === 'reconstruction_character_v1';
}

function isOrdinaryLimitedCharacterSchedulePool(pool) {
  if (isExtraSchedulePool(pool) || isReconstructionCharacterSchedulePool(pool)) {
    return false;
  }

  const poolType = pool?.poolType || pool?.poolData?.type;
  return poolType === 'limited' || poolType === 'limited_character';
}

function normalizePoolIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map(normalizeText).filter(Boolean))];
}

function isVersionEnabled(version) {
  if (version?.enabled === false) {
    return false;
  }

  if (version?.disabled === true) {
    return false;
  }

  const status = normalizeText(version?.status).toLowerCase();
  return status !== 'disabled' && status !== 'hidden';
}

export function normalizeHomeVersionTimeline(timelineConfig, {
  fallbackTargetAt = DEFAULT_HOME_NEXT_VERSION_TARGET_DATE,
} = {}) {
  const parsedConfig = parseJsonMaybe(timelineConfig);
  const fallbackStartAt = parseHomeVersionTimestamp(fallbackTargetAt) || DEFAULT_HOME_NEXT_VERSION_TARGET_DATE;
  const rawVersions = Array.isArray(parsedConfig)
    ? parsedConfig
    : (
      Array.isArray(parsedConfig?.versions)
        ? parsedConfig.versions
        : buildDefaultHomeVersionTimeline(fallbackStartAt)
    );

  const versions = rawVersions
    .map((version, index) => {
      const startsAt = getVersionStartAt(version) || (index === 0 ? fallbackStartAt : null);
      if (!startsAt || !isVersionEnabled(version)) {
        return null;
      }

      const id = normalizeText(version?.id) || `version-${index + 1}`;
      const name = normalizeText(version?.name || version?.title) || '下个版本';
      const nameEn = normalizeText(version?.name_en || version?.nameEn || version?.title_en || version?.titleEn);
      const endsAt = getVersionEndAt(version);

      return {
        id,
        name,
        nameEn: nameEn || name,
        startsAt,
        endsAt,
        order: Number.isFinite(Number(version?.order)) ? Number(version.order) : index,
        poolIds: normalizePoolIds(version?.pool_ids || version?.poolIds),
        raw: version,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const timeDiff = toTimestamp(left.startsAt) - toTimestamp(right.startsAt);
      if (timeDiff !== 0) {
        return timeDiff;
      }

      return left.order - right.order;
    });

  if (versions.length > 0) {
    return versions;
  }

  return normalizeHomeVersionTimeline(DEFAULT_HOME_VERSION_TIMELINE, { fallbackTargetAt });
}

export function getHomeVersionDisplayName(version, {
  locale = 'zh-CN',
  fallback = '',
} = {}) {
  if (!version) {
    return fallback;
  }

  const normalizedLocale = normalizeText(locale).toLowerCase();
  if (normalizedLocale.startsWith('en')) {
    return normalizeText(version.nameEn) || normalizeText(version.name) || fallback;
  }

  return normalizeText(version.name) || normalizeText(version.nameEn) || fallback;
}

export function resolveHomeVersionPlan({
  timelineConfig = null,
  legacyTargetAt = DEFAULT_HOME_NEXT_VERSION_TARGET_DATE,
  locale = 'zh-CN',
  now = new Date(),
} = {}) {
  const fallbackTargetAt = parseHomeVersionTimestamp(legacyTargetAt) || DEFAULT_HOME_NEXT_VERSION_TARGET_DATE;
  const versions = normalizeHomeVersionTimeline(timelineConfig, { fallbackTargetAt });
  const nowMs = new Date(now || Date.now()).getTime();
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();

  const decoratedVersions = versions.map((version) => {
    const startsMs = toTimestamp(version.startsAt);
    const endsMs = toTimestamp(version.endsAt);
    const hasStarted = Number.isFinite(startsMs) && safeNowMs >= startsMs;
    const hasEnded = Number.isFinite(endsMs) && safeNowMs >= endsMs;
    const isCurrent = hasStarted && !hasEnded;
    return {
      ...version,
      displayName: getHomeVersionDisplayName(version, { locale }),
      hasStarted,
      hasEnded,
      isCurrent,
    };
  });

  const currentVersion = [...decoratedVersions]
    .reverse()
    .find((version) => version.isCurrent) || null;
  const nextVersion = decoratedVersions.find((version) => {
    const startsMs = toTimestamp(version.startsAt);
    return Number.isFinite(startsMs) && safeNowMs < startsMs;
  }) || null;
  const latestStartedVersion = [...decoratedVersions]
    .reverse()
    .find((version) => version.hasStarted) || null;
  const countdownVersion = nextVersion || currentVersion || latestStartedVersion || decoratedVersions[0] || null;

  return {
    versions: decoratedVersions,
    currentVersion,
    nextVersion,
    countdownVersion,
    targetAt: countdownVersion?.startsAt || fallbackTargetAt,
    source: timelineConfig ? HOME_VERSION_TIMELINE_CONFIG_KEY : HOME_NEXT_VERSION_TARGET_CONFIG_KEY,
  };
}

export function buildHomeVersionCountdownTitle(versionPlan, {
  baseTitle = '下个版本倒计时',
} = {}) {
  const displayName = normalizeText(versionPlan?.countdownVersion?.displayName);
  return displayName ? `${displayName} · ${baseTitle}` : baseTitle;
}

export function buildHomeRotationVersionSections({
  poolSchedule = [],
  versionPlan = null,
  now = new Date(),
} = {}) {
  const schedule = Array.isArray(poolSchedule) ? poolSchedule : [];
  const versions = Array.isArray(versionPlan?.versions) && versionPlan.versions.length > 0
    ? versionPlan.versions
    : normalizeHomeVersionTimeline(null);
  const nowMs = normalizeScheduleTimestamp(now);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const sections = versions.map((version, index) => ({
    id: version.id || `version-${index + 1}`,
    name: version.displayName || version.name || version.nameEn || `版本 ${index + 1}`,
    version,
    pools: [],
  }));
  const fallbackSection = {
    id: 'unassigned',
    name: '未归属版本',
    version: null,
    pools: [],
  };

  const findSection = (pool) => {
    const poolId = getSchedulePoolId(pool);
    if (poolId) {
      const explicit = sections.find((section) => (
        Array.isArray(section.version?.poolIds)
        && section.version.poolIds.includes(poolId)
      ));
      if (explicit) return explicit;
    }

    const startMs = normalizeScheduleTimestamp(pool?.startDate || pool?.start_time);
    if (Number.isFinite(startMs)) {
      const timed = sections.find((section, index) => {
        const startsMs = normalizeScheduleTimestamp(section.version?.startsAt);
        const explicitEndMs = normalizeScheduleTimestamp(section.version?.endsAt);
        const nextStartMs = normalizeScheduleTimestamp(sections[index + 1]?.version?.startsAt);
        const endMs = Number.isFinite(nextStartMs)
          ? nextStartMs
          : explicitEndMs;

        if (!Number.isFinite(startsMs) || startMs < startsMs) {
          return false;
        }

        return !Number.isFinite(endMs) || startMs < endMs;
      });
      if (timed) return timed;
    }

    return fallbackSection;
  };

  schedule.forEach((pool) => {
    findSection(pool).pools.push({ ...pool, foldedExtraPools: Array.isArray(pool.foldedExtraPools) ? pool.foldedExtraPools : [] });
  });

  const foldedSections = [...sections, fallbackSection]
    .map((section) => {
      const orderedPools = [...section.pools].sort((left, right) => (
        normalizeScheduleTimestamp(left.startDate || left.start_time) - normalizeScheduleTimestamp(right.startDate || right.start_time)
      ));
      const visiblePools = [];

      orderedPools.forEach((pool) => {
        const endMs = normalizeScheduleTimestamp(pool.endDate || pool.end_time);
        if (
          !isExtraSchedulePool(pool)
          || isReconstructionCharacterSchedulePool(pool)
          || !Number.isFinite(endMs)
          || safeNowMs < endMs
        ) {
          visiblePools.push(pool);
          return;
        }

        const extraStartMs = normalizeScheduleTimestamp(pool.startDate || pool.start_time);
        const overlappingTargets = orderedPools.filter((candidate) => {
          if (candidate === pool || isExtraSchedulePool(candidate)) return false;
          const candidateStartMs = normalizeScheduleTimestamp(candidate.startDate || candidate.start_time);
          const candidateEndMs = normalizeScheduleTimestamp(candidate.endDate || candidate.end_time);
          return Number.isFinite(candidateStartMs)
            && Number.isFinite(candidateEndMs)
            && Number.isFinite(extraStartMs)
            && candidateStartMs <= extraStartMs
            && candidateEndMs > extraStartMs;
        });
        const target = overlappingTargets[overlappingTargets.length - 1] || orderedPools.find((candidate) => {
          if (candidate === pool || isExtraSchedulePool(candidate)) return false;
          const candidateStartMs = normalizeScheduleTimestamp(candidate.startDate || candidate.start_time);
          return Number.isFinite(candidateStartMs) && candidateStartMs >= endMs;
        }) || orderedPools.find((candidate) => {
          if (candidate === pool || isExtraSchedulePool(candidate)) return false;
          const candidateStartMs = normalizeScheduleTimestamp(candidate.startDate || candidate.start_time);
          return Number.isFinite(candidateStartMs) && Number.isFinite(extraStartMs) && candidateStartMs >= extraStartMs;
        });

        if (target) {
          target.foldedExtraPools = [...(target.foldedExtraPools || []), pool];
        } else {
          visiblePools.push(pool);
        }
      });

      return {
        ...section,
        pools: visiblePools,
        hiddenExtraCount: orderedPools.filter((pool) => (
          isExtraSchedulePool(pool)
          && !isReconstructionCharacterSchedulePool(pool)
          && Number.isFinite(normalizeScheduleTimestamp(pool.endDate || pool.end_time))
          && safeNowMs >= normalizeScheduleTimestamp(pool.endDate || pool.end_time)
          && !visiblePools.includes(pool)
        )).length,
      };
    });

  foldedSections.slice(0, sections.length).forEach((section, sectionIndex) => {
    const nextVersionSection = foldedSections[sectionIndex + 1];
    if (!nextVersionSection?.version) {
      return;
    }

    const nextVersionStartsMs = normalizeScheduleTimestamp(nextVersionSection.version.startsAt);
    const explicitEndMs = normalizeScheduleTimestamp(section.version?.endsAt);
    const versionEndMs = Number.isFinite(nextVersionStartsMs) ? nextVersionStartsMs : explicitEndMs;
    if (!Number.isFinite(versionEndMs) || safeNowMs < versionEndMs) {
      return;
    }

    const rerunPools = section.pools.filter(isReconstructionCharacterSchedulePool);
    if (rerunPools.length === 0) {
      return;
    }

    const target = foldedSections
      .slice(sectionIndex + 1, sections.length)
      .flatMap((candidateSection) => candidateSection.pools)
      .filter(isOrdinaryLimitedCharacterSchedulePool)
      .filter((pool) => {
        const startMs = normalizeScheduleTimestamp(pool.startDate || pool.start_time);
        return Number.isFinite(startMs) && startMs >= versionEndMs;
      })
      .sort((left, right) => (
        normalizeScheduleTimestamp(left.startDate || left.start_time)
        - normalizeScheduleTimestamp(right.startDate || right.start_time)
      ))[0];
    const targetStartMs = normalizeScheduleTimestamp(target?.startDate || target?.start_time);
    if (!target || !Number.isFinite(targetStartMs) || safeNowMs < targetStartMs) {
      return;
    }

    const rerunPoolSet = new Set(rerunPools);
    section.pools = section.pools.filter((pool) => !rerunPoolSet.has(pool));
    target.foldedExtraPools = [
      ...(target.foldedExtraPools || []),
      ...rerunPools.map((pool) => ({
        ...pool,
        mergeKind: 'current-rerun',
        characterName: pool.homeCharacterName || pool.characterName || pool.name,
      })),
    ];
    section.hiddenExtraCount += rerunPools.length;
  });

  const visibleSections = foldedSections.filter((section) => section.pools.length > 0);

  return visibleSections.length > 0
    ? visibleSections
    : [{ id: 'all', name: '轮换计划', version: null, pools: schedule }];
}
