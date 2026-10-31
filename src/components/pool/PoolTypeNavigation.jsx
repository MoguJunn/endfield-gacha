import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronsRight, Layers, Sparkles, Star, Swords, User } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import './poolTypeNavigation.css';

const TYPE_ICONS = {
  limited: Star,
  extra: Sparkles,
  standard: Layers,
  weapon_limited: Swords,
  weapon_standard: Swords,
  beginner: User,
};

export default function PoolTypeNavigation({ groups, scrollRef, orientation = 'horizontal' }) {
  const { t } = useI18n();
  const navigationRef = useRef(null);
  const tabsRef = useRef(null);
  const indicatorRef = useRef(null);
  const [position, setPosition] = useState({ progress: 0, activeType: groups[0]?.type, canScroll: false });
  const [sectionSizes, setSectionSizes] = useState({});
  const vertical = orientation === 'vertical';
  const activeType = groups.find((group) => group.type === position.activeType)?.type || groups[0]?.type;

  useLayoutEffect(() => {
    const tabs = tabsRef.current;
    const indicator = indicatorRef.current;
    const activeTab = tabs.querySelector('[aria-current="location"]');
    if (!activeTab) return undefined;

    const updateIndicator = () => {
      const left = activeTab.offsetLeft;
      const width = activeTab.offsetWidth;
      indicator.style.width = `${width}px`;
      indicator.style.transform = `translateX(${left}px)`;

      const visibleLeft = tabs.scrollLeft + 3;
      const visibleRight = tabs.scrollLeft + tabs.clientWidth - 3;
      const desiredLeft = left < visibleLeft
        ? left - 3
        : left + width > visibleRight
          ? left + width - tabs.clientWidth + 3
          : tabs.scrollLeft;
      const nextLeft = Math.max(0, Math.min(desiredLeft, tabs.scrollWidth - tabs.clientWidth));
      if (Math.abs(nextLeft - tabs.scrollLeft) > 1) {
        tabs.scrollTo({
          left: nextLeft,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        });
      }
    };
    updateIndicator();
    const observer = new ResizeObserver(updateIndicator);
    observer.observe(tabs);
    tabs.querySelectorAll('button').forEach((tab) => observer.observe(tab));
    return () => observer.disconnect();
  }, [activeType, groups, sectionSizes]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return undefined;
    const sections = [...container.querySelectorAll('[data-pool-type]')];
    const update = () => {
      const max = vertical
        ? container.scrollHeight - container.clientHeight
        : container.scrollWidth - container.clientWidth;
      const offset = vertical ? container.scrollTop : container.scrollLeft;
      const bounds = container.getBoundingClientRect();
      const start = vertical ? bounds.top + navigationRef.current.offsetHeight + 8 : bounds.left;
      let activeType = groups[0]?.type;
      const measuredSizes = {};
      sections.forEach((section) => {
        const sectionBounds = section.getBoundingClientRect();
        measuredSizes[section.dataset.poolType] = Math.max(
          1,
          Math.round(vertical ? sectionBounds.height : sectionBounds.width)
        );
        if ((vertical ? sectionBounds.top : sectionBounds.left) <= start + 16) {
          activeType = section.dataset.poolType;
        }
      });
      const progress = max > 1 ? Math.round(Math.max(0, Math.min(1, offset / max)) * 100) : 0;
      if (max > 1 && progress === 100) activeType = groups.at(-1)?.type;
      setSectionSizes((current) =>
        Object.keys(current).length === Object.keys(measuredSizes).length &&
        Object.entries(measuredSizes).every(([type, size]) => current[type] === size)
          ? current
          : measuredSizes
      );
      setPosition((current) =>
        current.progress === progress && current.activeType === activeType && current.canScroll === (max > 1)
          ? current
          : { progress, activeType, canScroll: max > 1 }
      );
    };
    update();
    container.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const observer = new ResizeObserver(update);
    observer.observe(container);
    sections.forEach((section) => observer.observe(section));
    return () => {
      container.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer.disconnect();
    };
  }, [groups, scrollRef, vertical]);

  const jumpToType = (type) => {
    const container = scrollRef.current;
    const section = [...container.querySelectorAll('[data-pool-type]')]
      .find((element) => element.dataset.poolType === type);
    if (!section) return;
    const containerBounds = container.getBoundingClientRect();
    const sectionBounds = section.getBoundingClientRect();
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    if (vertical) {
      container.scrollTo({
        top: container.scrollTop + sectionBounds.top - containerBounds.top - navigationRef.current.offsetHeight - 8,
        behavior,
      });
    } else {
      container.scrollTo({ left: container.scrollLeft + sectionBounds.left - containerBounds.left, behavior });
    }
    if (behavior === 'smooth') {
      section.animate(
        [{ backgroundColor: 'rgb(234 179 8 / 0.12)' }, { backgroundColor: 'transparent' }],
        { duration: 700, easing: 'ease-out' }
      );
    }
  };
  const DirectionIcon = position.progress >= 100 ? Check : vertical ? ChevronDown : ChevronsRight;

  return (
    <nav
      ref={navigationRef}
      aria-label={t('pool.navigation.label')}
      title={t('pool.navigation.hint')}
      data-pool-type-navigation
      data-orientation={orientation}
      className={`pool-type-nav${vertical ? ' pool-type-nav--sticky' : ''}`}
    >
      <div className="pool-type-nav__row">
        <div ref={tabsRef} className="pool-type-nav__tabs">
          <div
            className="pool-type-nav__track"
            style={{
              gridTemplateColumns: groups.map((group) =>
                `minmax(max-content, ${sectionSizes[group.type] || 1}fr)`
              ).join(' '),
            }}
          >
            <span ref={indicatorRef} aria-hidden="true" className="pool-type-nav__indicator" />
            {groups.map((group) => {
              const Icon = TYPE_ICONS[group.type] || Layers;
              return (
                <button
                  key={group.type}
                  type="button"
                  title={group.label}
                  aria-label={t('pool.navigation.jump', { label: group.label })}
                  aria-current={activeType === group.type ? 'location' : undefined}
                  onClick={() => jumpToType(group.type)}
                  className="pool-type-nav__tab"
                >
                  <Icon aria-hidden="true" size={14} className="pool-type-nav__icon" />
                  <span className="pool-type-nav__name">{group.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        {position.canScroll && (
          <span
            className="pool-type-nav__direction"
            data-complete={position.progress >= 100}
            title={t(position.progress >= 100 ? 'pool.navigation.end' : vertical ? 'pool.navigation.swipe' : 'pool.navigation.wheel')}
          >
            <span aria-hidden="true" className="pool-type-nav__percentage">{position.progress}%</span>
            <span className="sr-only">
              {t(position.progress >= 100 ? 'pool.navigation.end' : vertical ? 'pool.navigation.swipe' : 'pool.navigation.wheel')}
            </span>
            <DirectionIcon aria-hidden="true" size={13} />
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-label={t('pool.navigation.progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={position.progress}
        className="pool-type-nav__progress"
      >
        <span className="pool-type-nav__fill" style={{ transform: `scaleX(${position.progress / 100})` }} />
      </div>
    </nav>
  );
}
