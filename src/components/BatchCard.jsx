import React, { useMemo, useState } from 'react';
import { Star, Trash2, ChevronDown, User } from 'lucide-react';
import { characterCache } from '../utils/characterUtils';
import { useI18n } from '../i18n/index.js';
import { localizeHistoryItemName } from '../utils/gameDataI18n.js';
import { getRecordPoolVersion } from '../../shared/poolVersion.js';

const POOL_TYPE_LABEL_CLASSES = {
  limited: 'text-orange-600 dark:text-orange-300',
  limited_character: 'text-orange-600 dark:text-orange-300',
  extra: 'text-cyan-600 dark:text-cyan-300',
  weapon: 'text-slate-600 dark:text-slate-300',
  limited_weapon: 'text-slate-600 dark:text-slate-300',
  weapon_limited: 'text-slate-600 dark:text-slate-300',
  weapon_standard: 'text-zinc-500 dark:text-zinc-400',
  standard: 'text-yellow-600 dark:text-yellow-300',
  beginner: 'text-green-600 dark:text-green-300'
};

function getItemPoolId(item) {
  const value = item?.poolId || item?.pool_id || null;
  return value == null ? null : String(value);
}

function getPoolLabelClass(poolTypeValue) {
  return POOL_TYPE_LABEL_CLASSES[poolTypeValue] || 'text-cyan-600 dark:text-cyan-300';
}

const BatchCard = React.memo(({ group, onEdit, onDeleteGroup, poolType, canEdit, showPoolName = false, poolMetaById = null }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { locale } = useI18n();
  const entityType = poolType === 'weapon' ? 'weapon' : 'character';
  const groupPoolMeta = useMemo(() => {
    if (!showPoolName || !(poolMetaById instanceof Map)) {
      return null;
    }

    const poolMetas = [];
    const seenPoolIds = new Set();
    group.forEach((item) => {
      const poolId = getItemPoolId(item);
      if (!poolId || seenPoolIds.has(poolId)) {
        return;
      }
      seenPoolIds.add(poolId);
      const meta = poolMetaById.get(poolId);
      if (meta?.name) {
        poolMetas.push(meta);
      }
    });

    if (poolMetas.length === 0) {
      return null;
    }

    const primaryMeta = poolMetas[0];
    return {
      label: poolMetas.length === 1 ? primaryMeta.name : `${primaryMeta.name} +${poolMetas.length - 1}`,
      title: poolMetas.map((meta) => meta.name).join(' / '),
      className: getPoolLabelClass(primaryMeta.type)
    };
  }, [group, poolMetaById, showPoolName]);

  // 统计该组信息
  const counts = { 6: 0, 5: 0, 4: 0 };
  group.forEach(i => {
    if (i.rarity >= 6) counts[6]++;
    else if (i.rarity === 5) counts[5]++;
    else counts[4]++;
  });

  const isBatch = group.length >= 5; // 5连以上视为Batch展示
  const hasHighRarity = counts[6] > 0 || counts[5] > 0;

  // 检查是否是免费十连
  const isFreePull = group.some(item => item.isFree || item.is_free);
  const isInfoBookPull = group.some(item => item.isInfoBook || item.is_info_book);

  return (
    <div className="bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800 last:border-0 transition-colors">
      {/* 折叠头部 - 可点击展开 */}
      <div
        className="p-4 flex flex-col sm:flex-row sm:items-center gap-4 hover:bg-slate-50 dark:hover:bg-zinc-950 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Header Info */}
        <div className="w-36 shrink-0">
          <div className="text-sm font-black text-slate-700 dark:text-zinc-300 font-mono mb-1 flex items-center gap-2">
            {group.length === 1 ? (
              <>No.{group[0].globalIndex}</>
            ) : (
              <>No.{group[0].globalIndex} - {group[group.length - 1].globalIndex}</>
            )}
            <ChevronDown
              size={14}
              className={`text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            />
          </div>
          {groupPoolMeta && (
            <div
              className={`mb-1 max-w-[8.5rem] truncate text-[11px] font-bold ${groupPoolMeta.className}`}
              title={groupPoolMeta.title}
            >
              {groupPoolMeta.label}
            </div>
          )}
          <div className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono mb-2">
            {new Date(group[0].timestamp).toLocaleString()}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${
              isFreePull
                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                : isInfoBookPull
                  ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                  : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400'
            }`}>
              {isBatch ? (isFreePull ? '免费十连' : isInfoBookPull ? '情报书十连' : '十连/多抽') : (isInfoBookPull ? '情报书' : '单抽')}
            </span>
            {/* 高星统计 */}
            {hasHighRarity && (
              <span className="text-[10px]">
                {counts[6] > 0 && <span className="text-orange-500 font-bold">{counts[6]}×6★</span>}
                {counts[6] > 0 && counts[5] > 0 && <span className="text-slate-400 mx-1">·</span>}
                {counts[5] > 0 && <span className="text-amber-500 font-bold">{counts[5]}×5★</span>}
              </span>
            )}
            {isBatch && canEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteGroup(group);
                }}
                className="text-slate-300 hover:text-red-500 transition-colors p-1 z-10 relative cursor-pointer"
                title="删除整组"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Items Grid - 简略视图 (Avatar Style) */}
        {!isExpanded && (
          <div className="flex-1">
            <div className="flex flex-wrap gap-2">
              {group.map((item) => {
                const isLimitedUp = item.rarity === 6 && !item.isStandard;
                const isGift = item.specialType === 'gift' || item.special_type === 'gift';
                const isFree = item.isFree || item.is_free;
                const isInfoBook = item.isInfoBook || item.is_info_book;

                // 确定边框颜色
                let borderColor = 'border-purple-300 dark:border-purple-700';
                let avatarBg = 'bg-purple-100 dark:bg-purple-900/50';

                if (item.rarity === 6) {
                  if (isLimitedUp) {
                    borderColor = 'rainbow-border border-transparent'; // 使用 rainbow-border
                    avatarBg = 'rainbow-bg-light';
                  } else {
                    borderColor = 'border-red-400 dark:border-red-500';
                    avatarBg = 'bg-red-100 dark:bg-red-900/30';
                  }
                } else if (item.rarity === 5) {
                  borderColor = 'border-amber-400 dark:border-amber-500';
                  avatarBg = 'bg-amber-100 dark:bg-amber-900/30';
                }

                return (
                  <div
                    key={item.id}
                    onClick={canEdit ? (e) => { e.stopPropagation(); onEdit(item); } : undefined}
                    className={`
                      relative w-10 h-10 border-2 transition-all group ${getRecordPoolVersion(item) ? 'mb-4' : ''}
                      ${canEdit ? 'cursor-pointer hover:scale-105' : 'cursor-default'}
                      ${borderColor}
                      ${isFree && !isGift ? 'ring-2 ring-blue-300 dark:ring-blue-700 ring-offset-1 dark:ring-offset-black' : ''}
                    `}
                    title={canEdit ? "点击修改" : undefined}
                  >
                    {/* 背景和头像容器 (添加 overflow-hidden 防止光效溢出) */}
                    <div className={`absolute inset-0 overflow-hidden ${avatarBg}`}>
                       {/* 彩虹流光特效 */}
                       {isLimitedUp && <div className="absolute inset-0 rainbow-shine opacity-50"></div>}

                       {/* 头像 - 优先使用缓存中的avatar_url */}
                       <div className="w-full h-full flex items-center justify-center relative z-10">
                         {(() => {
                           const name = item.character_name || item.item_name || item.name;
                           const localizedName = localizeHistoryItemName(item, { locale, type: entityType, fallback: name });
                           const charData = name ? characterCache.searchByName(name, false) : null;
                           const avatarUrl = charData?.avatar_url;

                           if (avatarUrl) {
                             return (
                               <img
                                 src={avatarUrl}
                                 alt={localizedName}
                                 className="w-full h-full object-cover"
                                 onError={(e) => {
                                   e.target.style.display = 'none';
                                   e.target.nextSibling.style.display = 'flex';
                                 }}
                               />
                             );
                           }
                           return null;
                         })()}
                         <div className={`w-full h-full items-center justify-center ${(() => {
                           const name = item.character_name || item.item_name || item.name;
                           const charData = name ? characterCache.searchByName(name, false) : null;
                           return charData?.avatar_url ? 'hidden' : 'flex';
                         })()}`}>
                           <User size={16} className={`opacity-50 ${item.rarity === 6 ? 'text-orange-500' : item.rarity === 5 ? 'text-amber-500' : 'text-purple-500'}`} />
                         </div>
                       </div>
                    </div>

                    {/* 6星状态标记 (UP / 歪) - 放在容器外层以允许溢出 */}
                    {item.rarity === 6 && poolType !== 'standard' && (
                      <div className={`absolute -top-1.5 -right-1.5 px-1 h-3 flex items-center justify-center rounded-sm text-[7px] font-bold text-white shadow-sm z-10
                        ${isGift ? 'bg-purple-500' :
                          isLimitedUp ? 'bg-orange-500' : 'bg-red-500'
                        }`}>
                        {isGift ? '赠' : isLimitedUp ? 'UP' : '歪'}
                      </div>
                    )}

                    {/* 免费标记 */}
                    {isInfoBook && !isGift && !isFree && (
                       <div className="absolute -bottom-1 -left-1 px-1 h-2.5 flex items-center justify-center rounded-sm text-[6px] font-bold bg-amber-500 text-white z-10">
                         书
                       </div>
                    )}
                    {isFree && !isGift && (
                       <div className="absolute -bottom-1 -left-1 px-1 h-2.5 flex items-center justify-center rounded-sm text-[6px] font-bold bg-blue-500 text-white z-10">
                         免
                       </div>
                    )}
                    {getRecordPoolVersion(item) && (
                      <span className="absolute top-full left-0 w-full text-center text-[10px] text-slate-500 dark:text-zinc-400">
                        #{getRecordPoolVersion(item)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 展开后的详细视图 - 仿模拟器样式 */}
      {isExpanded && (
        <div className="bg-slate-50 dark:bg-zinc-950 border-t border-zinc-100 dark:border-zinc-800">
          <div className="p-4 grid grid-cols-5 sm:grid-cols-10 gap-3">
            {group.map((item) => {
              const isLimitedUp = item.rarity === 6 && !item.isStandard;
              const isGift = item.specialType === 'gift' || item.special_type === 'gift';
              const isFree = item.isFree || item.is_free;
              const isInfoBook = item.isInfoBook || item.is_info_book;
              const name = item.character_name || item.item_name || item.name || '未知';
              const localizedName = localizeHistoryItemName(item, { locale, type: entityType, fallback: name });

              // 确定颜色
              let borderColor = 'border-purple-300 dark:border-purple-700';
              let bgColor = 'bg-purple-50 dark:bg-purple-900/20';
              let textColor = 'text-purple-600 dark:text-purple-400';
              let avatarBg = 'bg-purple-200 dark:bg-purple-800';

              if (item.rarity === 6) {
                if (isLimitedUp) {
                  borderColor = 'rainbow-border';
                  bgColor = 'rainbow-bg-light';
                  textColor = 'text-orange-600 dark:text-orange-400';
                  avatarBg = 'bg-gradient-to-br from-orange-400 to-pink-500';
                } else {
                  borderColor = 'border-red-300 dark:border-red-700';
                  bgColor = 'bg-red-50 dark:bg-red-900/20';
                  textColor = 'text-red-600 dark:text-red-400';
                  avatarBg = 'bg-red-200 dark:bg-red-800';
                }
              } else if (item.rarity === 5) {
                borderColor = 'border-amber-300 dark:border-amber-700';
                bgColor = 'bg-amber-50 dark:bg-amber-900/20';
                textColor = 'text-amber-600 dark:text-amber-400';
                avatarBg = 'bg-amber-200 dark:bg-amber-800';
              }

              return (
                <div
                  key={item.id}
                  className={`
                    relative flex flex-col items-center p-2 border-2 transition-all
                    cursor-default
                    ${borderColor} ${bgColor}
                    ${isFree ? 'ring-2 ring-blue-300 dark:ring-blue-700' : ''}
                  `}
                >
                  {/* 角色头像 */}
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-2 ${avatarBg} overflow-hidden`}>
                    {(() => {
                      const charData = name ? characterCache.searchByName(name, false) : null;
                      const avatarUrl = charData?.avatar_url;

                      if (avatarUrl) {
                        return (
                          <img
                            src={avatarUrl}
                            alt={localizedName}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.target.style.display = 'none';
                              e.target.nextSibling.style.display = 'flex';
                            }}
                          />
                        );
                      }
                      return null;
                    })()}
                    <div className={`w-full h-full items-center justify-center ${(() => {
                      const charData = name ? characterCache.searchByName(name, false) : null;
                      return charData?.avatar_url ? 'hidden' : 'flex';
                    })()}`}>
                      <User size={24} className="text-white opacity-80" />
                    </div>
                  </div>

                  {/* 角色名称 */}
                  <div className={`text-[10px] font-bold ${textColor} text-center truncate w-full`}>
                    {localizedName}
                  </div>
                  {getRecordPoolVersion(item) && (
                    <div className="text-[10px] text-slate-500 dark:text-zinc-400">#{getRecordPoolVersion(item)}</div>
                  )}

                  {/* 稀有度星星 */}
                  <div className="flex items-center gap-0.5 mt-1">
                    {Array.from({ length: item.rarity }).map((_, i) => (
                      <Star
                        key={i}
                        size={8}
                        fill="currentColor"
                        className={textColor}
                      />
                    ))}
                  </div>

                  {/* 标签 */}
                  {item.rarity === 6 && poolType !== 'standard' && (
                    <div className={`absolute -top-1 -right-1 px-1 h-3 flex items-center justify-center rounded-sm text-[7px] font-bold border border-white
                      ${isGift ? 'bg-purple-500 text-white' :
                        isLimitedUp ? 'rainbow-badge text-white' : 'bg-red-500 text-white'
                      }`}>
                      {isGift ? '赠送' : isLimitedUp ? 'UP' : '歪'}
                    </div>
                  )}

                  {/* 免费标记 */}
                  {isFree && (
                    <div className="absolute -top-1 -left-1 px-1 h-3 flex items-center justify-center rounded-sm text-[7px] font-bold bg-blue-500 text-white border border-white">
                      免费
                    </div>
                  )}
                  {isInfoBook && !isFree && (
                    <div className="absolute -top-1 -left-1 px-1 h-3 flex items-center justify-center rounded-sm text-[7px] font-bold bg-amber-500 text-white border border-white">
                      情报书
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

export default BatchCard;
