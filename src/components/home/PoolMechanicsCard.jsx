import React from 'react';
import { ChevronUp, Info, Layers, Star, Swords } from 'lucide-react';
import CollapsibleContent from './CollapsibleContent';
import usePoolMechanicsData from '../../hooks/home/usePoolMechanicsData';
import { useI18n } from '../../i18n/index.js';
import { localizeEntityList, localizeEntityName } from '../../utils/gameDataI18n.js';

const CharacterRow = ({
  label,
  labelClassName,
  characters,
  highlightFirst = false,
  highlightLabel = 'UP',
}) => {
  const normalizedCharacters = (characters || []).filter(Boolean);
  return (
  <div className="flex items-baseline gap-2">
    <span className={`text-[10px] font-bold font-mono w-8 shrink-0 ${labelClassName}`}>{label}</span>
    <div className="flex flex-wrap gap-1">
      {normalizedCharacters.map((character, index) => (
        <span
          key={character}
          className={`text-xs px-1.5 py-0.5 rounded-sm ${
            highlightFirst && index === 0
              ? 'bg-fuchsia-100 dark:bg-fuchsia-500/20 text-fuchsia-600 dark:text-fuchsia-400 border border-fuchsia-200 dark:border-fuchsia-500/30'
              : 'bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border border-zinc-100 dark:border-transparent'
          }`}
        >
          {character}
          {highlightFirst && index === 0 ? ` (${highlightLabel})` : ''}
        </span>
      ))}
    </div>
  </div>
  );
};

const ExtraMechanicsRuleCard = ({ title, badge, items, accentClassName }) => (
  <div className={`bg-white dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-700/50 p-4 shadow-sm dark:shadow-none ${accentClassName}`}>
    <div className="flex items-center justify-between gap-3 mb-3 pb-2 border-b border-zinc-100 dark:border-zinc-800">
      <h5 className="font-bold text-zinc-800 dark:text-zinc-200 text-sm">{title}</h5>
      <span className="shrink-0 text-[9px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-mono uppercase tracking-wider">
        {badge}
      </span>
    </div>
    <ul className="space-y-2 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-2 h-1 w-1 shrink-0 bg-current opacity-60" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  </div>
);

function ExtraPoolMechanicsOverview({ tt }) {
  const cards = [
    {
      title: tt('home.poolMechanics.extra.reconstructionCharacter.title', '重构寻访 · 角色'),
      badge: tt('home.poolMechanics.extra.reconstruction.badge', '重构'),
      accentClassName: 'hover:border-fuchsia-400 dark:hover:border-fuchsia-500/50 transition-colors',
      items: [
        tt('home.poolMechanics.extra.reconstructionCharacter.base', '复用普通限定寻访基础规则，设置单一概率提升目标。'),
        tt('home.poolMechanics.extra.reconstructionCharacter.free', '累计 30 / 60 / 90 抽各赠一次免费十连；免费十连不推进付费保底或奖励进度。'),
        tt('home.poolMechanics.extra.reconstructionCharacter.target', '120 抽内确保目标角色一次；每 240 抽赠送目标信物。'),
        tt('home.poolMechanics.extra.reconstructionCharacter.carryOver', '保底与奖励按同一系列跨期继承。'),
      ],
    },
    {
      title: tt('home.poolMechanics.extra.reconstructionWeapon.title', '重构申领 · 武器'),
      badge: tt('home.poolMechanics.extra.reconstruction.badge', '重构'),
      accentClassName: 'hover:border-slate-400 dark:hover:border-slate-500/50 transition-colors',
      items: [
        tt('home.poolMechanics.extra.reconstructionWeapon.base', '复用武器寻访基础规则，设置单一概率提升武器。'),
        tt('home.poolMechanics.extra.reconstructionWeapon.target', '前 8 次申领内确保目标武器一次。'),
        tt('home.poolMechanics.extra.reconstructionWeapon.rewards', '第 10 次申领赠武库赠礼，第 18 次赠概率提升武器，之后每 8 次交替；同系列奖励继承。'),
        tt('home.poolMechanics.extra.reconstructionWeapon.pity', '普通 6★ 保底最多 4 次申领，按单池独立计算。'),
      ],
    },
    {
      title: tt('home.poolMechanics.extra.brilliance.title', '特殊寻访 · 辉光庆典'),
      badge: tt('home.poolMechanics.extra.special.badge', '特殊'),
      accentClassName: 'hover:border-amber-400 dark:hover:border-amber-500/50 transition-colors',
      items: [
        tt('home.poolMechanics.extra.brilliance.targets', '四名 6★ 目标等概率出现。'),
        tt('home.poolMechanics.extra.brilliance.free', '累计 30 抽赠送一次免费十连，免费十连不推进保底或奖励进度。'),
        tt('home.poolMechanics.extra.brilliance.pity', '保底独立计算，不继承到其他寻访。'),
      ],
    },
  ];

  return (
    <section className="space-y-3">
      <div>
        <h4 className="font-bold text-zinc-700 dark:text-zinc-300 text-xs flex items-center gap-2 uppercase tracking-widest">
          <Layers size={14} className="text-blue-500" />
          {tt('home.poolMechanics.extra.title', '附加寻访规则')}
        </h4>
        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-500">
          {tt('home.poolMechanics.extra.subtitle', '附加寻访分为重构寻访与特殊寻访；重构规则优先展示。')}
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {cards.map((card) => <ExtraMechanicsRuleCard key={card.title} {...card} />)}
      </div>
    </section>
  );
}

function PoolMechanicsCard({
  currentUpInfo,
  isOpen,
  onToggle,
  interactive = true,
}) {
  const { t, locale } = useI18n();
  const { limitedCharacters, standardCharacters } = usePoolMechanicsData(currentUpInfo);
  const tt = (key, fallback, params = {}) => t(key, params, fallback);

  const {
    isActive,
    isExpired,
    remainingDays = 0,
    remainingHours = 0,
    startsIn = 0,
    startsInHours = 0,
    name,
  } = currentUpInfo || {};

  const currentUpName = localizeEntityName(name || limitedCharacters.sixStar[0] || tt('home.poolMechanics.pending', '待公布'), {
    locale,
    type: 'character'
  });
  const localizedLimitedCharacters = {
    sixStar: localizeEntityList(limitedCharacters.sixStar, { locale, type: 'character' }),
    fiveStar: localizeEntityList(limitedCharacters.fiveStar, { locale, type: 'character' }),
    fourStar: localizeEntityList(limitedCharacters.fourStar, { locale, type: 'character' })
  };
  const localizedStandardCharacters = {
    sixStar: localizeEntityList(standardCharacters.sixStar, { locale, type: 'character' }),
    fiveStar: localizeEntityList(standardCharacters.fiveStar, { locale, type: 'character' }),
    fourStar: localizeEntityList(standardCharacters.fourStar, { locale, type: 'character' })
  };
  const isEndingSoon = remainingDays <= 3 && isActive;
  const isUpcoming = !isActive && !isExpired;
  const currentStatus = isActive
    ? {
        className: isEndingSoon ? 'text-amber-500' : 'text-green-600 dark:text-green-500',
        text: tt('home.poolMechanics.current.active', '// 剩余 {days}天{hours}小时', {
          days: remainingDays,
          hours: remainingHours,
        }),
      }
    : isUpcoming
      ? {
          className: 'text-blue-500',
          text: tt('home.poolMechanics.current.upcoming', '// {days}天{hours}小时后开始', {
            days: startsIn,
            hours: startsInHours,
          }),
        }
      : isExpired
        ? {
            className: 'text-red-500',
            text: tt('home.poolMechanics.current.expired', '// 已结束'),
          }
      : null;
  const HeaderTag = interactive ? 'button' : 'div';

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden relative group/card shadow-sm dark:shadow-none">
      <div className="absolute top-0 left-0 w-1 h-full bg-blue-500/50 group-hover:bg-blue-500 transition-colors"></div>
      <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.03)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none"></div>

      <HeaderTag
        type={interactive ? 'button' : undefined}
        onClick={interactive ? onToggle : undefined}
        className={`w-full px-6 py-4 flex items-center justify-between transition-colors relative z-10 border-b border-zinc-100 dark:border-zinc-800 ${interactive ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-white/5' : ''}`}
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/30 rounded-sm">
            <Info size={18} />
          </div>
          <div className="text-left">
            <h3 className="font-bold text-zinc-800 dark:text-zinc-100 flex items-center gap-2 text-sm tracking-wide">
              {tt('home.poolMechanics.title', '公测卡池机制速览')}
              <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 text-blue-600 dark:text-blue-400 uppercase tracking-wider font-mono">
                {tt('home.poolMechanics.badge', 'System Info')}
              </span>
            </h3>
            <p className="text-xs text-zinc-500 mt-1 font-mono">
              {tt('home.poolMechanics.currentLabel', '当前 UP')}: <span className="text-zinc-700 dark:text-zinc-300 font-bold">{currentUpName}</span>
              {currentStatus && <span className={`ml-2 countdown-nums ${currentStatus.className}`}>{currentStatus.text}</span>}
            </p>
          </div>
        </div>
        {interactive ? (
          <ChevronUp size={20} className={`text-zinc-400 dark:text-zinc-500 transition-transform duration-300 ${isOpen ? '' : 'rotate-180'}`} />
        ) : null}
      </HeaderTag>

      <CollapsibleContent isOpen={interactive ? isOpen : true}>
        <div className="p-6 space-y-6 bg-zinc-50/50 dark:bg-black/20">
          <ExtraPoolMechanicsOverview tt={tt} />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-700/50 p-4 relative group/pool hover:border-fuchsia-400 dark:hover:border-fuchsia-500/50 transition-colors shadow-sm dark:shadow-none">
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                <Star size={14} className="text-fuchsia-500" />
                <h4 className="font-bold text-zinc-800 dark:text-zinc-200 text-sm">{tt('home.poolMechanics.cards.limited.title', '限定角色池')}</h4>
              </div>
              <div className="space-y-3 text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                <div className="flex justify-between">
                  <span className="text-zinc-500">{tt('home.poolMechanics.common.sixPity', '6星保底')}</span>
                  <span className="text-zinc-700 dark:text-zinc-300 text-right">{tt('home.poolMechanics.cards.limited.sixPity.value', '80抽必出')}<br /><span className="text-[10px] text-zinc-400 dark:text-zinc-600">{tt('home.poolMechanics.cards.limited.sixPity.note', '65抽起概率+5%')}</span></span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">{tt('home.poolMechanics.common.hardPity', '硬保底')}</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{tt('home.poolMechanics.cards.limited.hardPity.value', '120抽必出限定(仅1次)')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">{tt('home.poolMechanics.common.gift', '赠送')}</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{tt('home.poolMechanics.cards.limited.gift.value', '240抽送信物')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">{tt('home.poolMechanics.common.carryOver', '继承')}</span>
                  <span className="text-green-600 dark:text-green-500">{tt('home.poolMechanics.cards.limited.carryOver.value', '继承到下期限定')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">{tt('home.poolMechanics.cards.limited.emergency.label', '新增加急招募机制')}</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{tt('home.poolMechanics.cards.limited.emergency.value', '累计30抽后，赠送1发不计入保底的十连')}</span>
                </div>
                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/50 flex flex-col gap-1 text-[10px]">
                  <div className="flex justify-between text-zinc-500"><span>{tt('home.poolMechanics.common.baseRateSix', '6★基础概率')}</span><span className="text-zinc-700 dark:text-zinc-300">{tt('home.poolMechanics.cards.limited.baseRateSix.value', '0.8%（UP角色占其中50%）')}</span></div>
                  <div className="flex justify-between text-zinc-500"><span>{tt('home.poolMechanics.common.baseRateFive', '5★基础概率')}</span><span className="text-zinc-700 dark:text-zinc-300">{tt('home.poolMechanics.cards.limited.baseRateFive.value', '8.0%')}</span></div>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-700/50 p-4 relative group/pool hover:border-slate-400 dark:hover:border-slate-500/50 transition-colors shadow-sm dark:shadow-none">
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                <Swords size={14} className="text-slate-400" />
                <h4 className="font-bold text-zinc-800 dark:text-zinc-200 text-sm">{tt('home.poolMechanics.cards.weapon.title', '武器池')}</h4>
              </div>
              <div className="space-y-3 text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                <div className="flex justify-between">
                  <span className="text-zinc-500">{tt('home.poolMechanics.common.sixPity', '6星保底')}</span>
                  <span className="text-zinc-700 dark:text-zinc-300 text-right">{tt('home.poolMechanics.cards.weapon.sixPity.value', '40抽(4次申领)必出')}<br /><span className="text-[10px] text-zinc-400 dark:text-zinc-600">{tt('home.poolMechanics.cards.weapon.sixPity.note', '无概率递增')}</span></span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">{tt('home.poolMechanics.common.hardPity', '硬保底')}</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{tt('home.poolMechanics.cards.weapon.hardPity.value', '80抽必出限定(仅1次)')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">{tt('home.poolMechanics.common.gift', '赠送')}</span>
                  <span className="text-zinc-700 dark:text-zinc-300 text-right">{tt('home.poolMechanics.cards.weapon.gift.value1', '100抽送武库箱')}<br />{tt('home.poolMechanics.cards.weapon.gift.value2', '180抽送限定')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">{tt('home.poolMechanics.common.carryOver', '继承')}</span>
                  <span className="text-red-500">{tt('home.poolMechanics.cards.weapon.carryOver.value', '不继承')}</span>
                </div>
                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/50 flex flex-col gap-1 text-[10px]">
                  <div className="flex justify-between text-zinc-500"><span>{tt('home.poolMechanics.common.baseRateSix', '6★基础概率')}</span><span className="text-zinc-700 dark:text-zinc-300">{tt('home.poolMechanics.cards.weapon.baseRateSix.value', '4.0%')}</span></div>
                  <div className="flex justify-between text-zinc-500"><span>{tt('home.poolMechanics.common.baseRateFive', '5★基础概率')}</span><span className="text-zinc-700 dark:text-zinc-300">{tt('home.poolMechanics.cards.weapon.baseRateFive.value', '15.0%')}</span></div>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-700/50 p-4 relative group/pool hover:border-indigo-400 dark:hover:border-indigo-500/50 transition-colors shadow-sm dark:shadow-none">
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                <Layers size={14} className="text-indigo-400" />
                <h4 className="font-bold text-zinc-800 dark:text-zinc-200 text-sm">{tt('home.poolMechanics.cards.standard.title', '常驻角色池')}</h4>
              </div>
              <div className="space-y-3 text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                <div className="flex justify-between">
                  <span className="text-zinc-500">{tt('home.poolMechanics.common.sixPity', '6星保底')}</span>
                  <span className="text-zinc-700 dark:text-zinc-300 text-right">{tt('home.poolMechanics.cards.standard.sixPity.value', '80抽必出')}<br /><span className="text-[10px] text-zinc-400 dark:text-zinc-600">{tt('home.poolMechanics.cards.standard.sixPity.note', '65抽起概率+5%')}</span></span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">{tt('home.poolMechanics.common.gift', '赠送')}</span>
                  <span className="text-zinc-700 dark:text-zinc-300 text-right">{tt('home.poolMechanics.cards.standard.gift.value', '300抽自选6星')}<br /><span className="text-[10px] text-zinc-400 dark:text-zinc-600">{tt('home.poolMechanics.cards.standard.gift.note', '(仅1次)')}</span></span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">{tt('home.poolMechanics.common.carryOver', '继承')}</span>
                  <span className="text-red-500">{tt('home.poolMechanics.cards.standard.carryOver.value', '独立计算')}</span>
                </div>
                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/50 flex flex-col gap-1 text-[10px]">
                  <div className="flex justify-between text-zinc-500"><span>{tt('home.poolMechanics.common.baseRateSix', '6★基础概率')}</span><span className="text-zinc-700 dark:text-zinc-300">{tt('home.poolMechanics.cards.standard.baseRateSix.value', '0.8%')}</span></div>
                  <div className="flex justify-between text-zinc-500"><span>{tt('home.poolMechanics.common.baseRateFive', '5★基础概率')}</span><span className="text-zinc-700 dark:text-zinc-300">{tt('home.poolMechanics.cards.standard.baseRateFive.value', '8.0%')}</span></div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-zinc-200 dark:border-zinc-800 pt-6">
            <div>
              <h4 className="font-bold text-zinc-500 dark:text-zinc-400 text-xs mb-3 flex items-center gap-2 uppercase tracking-widest">
                {tt('home.poolMechanics.sections.limited', 'Limited Pool // 限定池内容')}
              </h4>
              <div className="space-y-2 bg-zinc-50 dark:bg-zinc-900/50 p-3 border border-zinc-200 dark:border-zinc-800/50">
                <CharacterRow label="6★" labelClassName="text-fuchsia-500" characters={localizedLimitedCharacters.sixStar} highlightFirst highlightLabel={tt('home.poolMechanics.upLabel', 'UP')} />
                <CharacterRow label="5★" labelClassName="text-amber-500" characters={localizedLimitedCharacters.fiveStar} />
                <CharacterRow label="4★" labelClassName="text-purple-500" characters={localizedLimitedCharacters.fourStar} />
              </div>
            </div>
            <div>
              <h4 className="font-bold text-zinc-500 dark:text-zinc-400 text-xs mb-3 flex items-center gap-2 uppercase tracking-widest">
                {tt('home.poolMechanics.sections.standard', 'Standard Pool // 常驻池内容')}
              </h4>
              <div className="space-y-2 bg-zinc-50 dark:bg-zinc-900/50 p-3 border border-zinc-200 dark:border-zinc-800/50">
                <CharacterRow label="6★" labelClassName="text-indigo-500" characters={localizedStandardCharacters.sixStar} />
                <CharacterRow label="5★" labelClassName="text-amber-500" characters={localizedStandardCharacters.fiveStar} />
                <CharacterRow label="4★" labelClassName="text-purple-500" characters={localizedStandardCharacters.fourStar} />
              </div>
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </div>
  );
}

export default PoolMechanicsCard;
