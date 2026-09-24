import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Search, Layers, Swords } from 'lucide-react';
import { buildPoolSelectorGroups } from '../../utils/poolSelectorDisplay.js';
import { characterCache, getCharacterAvatarUrl } from '../../utils/characterUtils.js';
import { STATISTICS_GROUPS, getStatisticsGroupPools } from '../../../shared/statisticsScopes.js';

export default function StatisticsPoolList({ pools, counts, scope, onSelect, locale, t }) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const [directoryReady, setDirectoryReady] = useState(() => characterCache.loaded);
  useEffect(() => {
    let active = true;
    characterCache.load().then(() => { if (active) setDirectoryReady(true); });
    return () => { active = false; };
  }, []);
  const selectedId = scope?.kind === 'pool' ? scope.poolId : null;
  const groups = useMemo(() => buildPoolSelectorGroups({ pools, currentPoolId: selectedId, searchQuery: query, locale })
    .flatMap((group) => group.subgroups || [group]), [pools, selectedId, query, locale]);
  return <section className="ex-pool-list" aria-label={t('具体卡池', 'Banner')}>
    <label className="ex-pool-search"><Search size={14} /><input type="search" aria-label={t('搜索卡池', 'Search banners')}
      placeholder={t('搜索卡池或 UP', 'Search banners or UP')} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    {groups.map((group) => {
      const closed = !query && collapsed[group.groupId];
      const aggregate = STATISTICS_GROUPS.find((item) => item.type === group.type && item.subtype === group.subtype);
      const members = aggregate ? getStatisticsGroupPools(pools, aggregate.key) : [];
      const total = members.every((item) => Number.isFinite(counts[item.id]))
        ? members.reduce((sum, item) => sum + counts[item.id], 0) : null;
      const GroupIcon = aggregate?.entityType === 'weapon' ? Swords : Layers;
      return <div className="ex-pool-group" key={group.groupId}>
        <button className="ex-pool-group-heading" aria-expanded={!closed} onClick={() => setCollapsed((old) => ({ ...old, [group.groupId]: !closed }))}>
          <span>{group.label}</span><span>{group.pools.length}<ChevronDown size={13} className={closed ? 'is-closed' : ''} /></span>
        </button>
        {!closed && <div>
          {aggregate && <button className="ex-pool-row ex-group-scope" data-group-key={aggregate.key}
            aria-label={t(aggregate.name, aggregate.nameEn)} aria-pressed={scope?.kind === 'group' && scope.groupKey === aggregate.key}
            onClick={() => onSelect({ kind: 'group', groupKey: aggregate.key })}>
            <span className="ex-pool-placeholder"><GroupIcon size={21} aria-hidden="true" /></span>
            <span className="ex-pool-copy"><strong>{t(aggregate.name, aggregate.nameEn)}</strong>
              <span className="ex-pool-featured">{members.length} {t('期卡池', 'banner periods')}</span>
              <span className="ex-pool-count">{total === null ? t('等待统计', 'Pending statistics') : `${total.toLocaleString(locale)} ${t('条记录合计', 'total records')}`}</span>
            </span>
          </button>}
          {group.pools.map((pool) => {
            const avatar = directoryReady && (pool.avatarLookupNames || [pool.up_character]).filter(Boolean).map((name) => getCharacterAvatarUrl(name)).find(Boolean);
            const count = counts[pool.id];
            const timing = pool.selectorTiming;
            return <button key={pool.id} className="ex-pool-row" data-pool-id={pool.id} aria-label={pool.displayName || pool.name}
              aria-pressed={pool.id === selectedId} onClick={() => onSelect({ kind: 'pool', poolId: pool.id })}>
              {avatar ? <img src={avatar} alt="" loading="lazy" /> : <span className="ex-pool-placeholder">{pool.type?.includes('weapon') ? 'W' : '★'}</span>}
              <span className="ex-pool-copy"><strong>{pool.displayName || pool.name}</strong>
                <span className="ex-pool-featured">{pool.displayUpCharacter || group.label}</span>
                <span className="ex-pool-count">{Number.isFinite(count) ? `${count.toLocaleString(locale)} ${t('抽', 'results')}` : t('等待统计', 'Pending statistics')}
                  {timing?.isActive && <i>{t('进行中', 'Live')}</i>}{timing?.isUpcoming && <i>{t('未开始', 'Upcoming')}</i>}
                </span>
              </span>
            </button>;
          })}
        </div>}
      </div>;
    })}
    {!groups.length && <p className="ex-sidebar-hint">{t('没有匹配的卡池', 'No matching banners')}</p>}
  </section>;
}
