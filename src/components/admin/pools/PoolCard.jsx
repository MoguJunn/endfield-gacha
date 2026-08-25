import React from 'react';
import { Edit2, Trash2, Calendar, Star, Layers, Swords, Users, Send } from 'lucide-react';
import { StatusDot, PanelToolbarButton } from '../panels/shared/PanelUi.jsx';
import { getPoolFeaturedNames } from '../../../utils/poolFeaturedResolver.js';

/**
 * 获取类型图标
 */
const getTypeIcon = (type) => {
  switch (type) {
    case 'limited':
    case 'limited_character':
      return <Star size={14} className="text-orange-500" />;
    case 'extra':
      return <Layers size={14} className="text-cyan-500" />;
    case 'weapon':
    case 'limited_weapon':
      return <Swords size={14} className="text-slate-500 dark:text-zinc-400" />;
    default:
      return <Layers size={14} className="text-amber-500 dark:text-endfield-yellow" />;
  }
};

/**
 * 获取类型标签
 */
const getTypeLabel = (type) => {
  switch (type) {
    case 'limited':
    case 'limited_character':
      return '限定角色';
    case 'extra':
      return '附加寻访';
    case 'weapon':
    case 'limited_weapon':
      return '限定武器';
    default:
      return '常驻';
  }
};

/**
 * 获取类型颜色
 */
const getTypeColor = (type) => {
  switch (type) {
    case 'limited':
    case 'limited_character':
      return 'border-orange-200 bg-orange-50 text-orange-600 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-300';
    case 'extra':
      return 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950/30 dark:text-cyan-300';
    case 'weapon':
    case 'limited_weapon':
      return 'border-zinc-200 bg-zinc-50 text-slate-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400';
    default:
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-endfield-yellow';
  }
};

/**
 * 获取卡池进行状态（仅呈现层推导，用于 StatusDot 展示）
 */
const getPoolStatus = (pool) => {
  if (!pool.start_time && !pool.end_time) return null;

  const now = Date.now();
  const start = pool.start_time ? new Date(pool.start_time).getTime() : null;
  const end = pool.end_time ? new Date(pool.end_time).getTime() : null;

  if (Number.isFinite(start) && now < start) {
    return { label: '未开始', tone: 'notice', pulse: false };
  }
  if (Number.isFinite(end) && now > end) {
    return { label: '已结束', tone: 'unknown', pulse: false };
  }
  return { label: '进行中', tone: 'ok', pulse: true };
};

/**
 * 卡池角色一览组件
 */
const PoolCharacterList = ({ pool, poolCharacters, characters }) => {
  const poolCharIds = (poolCharacters[pool.pool_id] || []).map((pc) => pc.character_id);
  const poolChars = characters.filter((c) => poolCharIds.includes(c.id));
  const featuredCharacterSet = new Set(getPoolFeaturedNames(pool, { entities: characters }));

  const sixStars = poolChars
    .filter((c) => c.rarity === 6)
    .sort((a, b) => {
      const aIsUp = featuredCharacterSet.has(a.name);
      const bIsUp = featuredCharacterSet.has(b.name);
      if (aIsUp && !bIsUp) return -1;
      if (!aIsUp && bIsUp) return 1;
      const aIsLimited = a.is_limited;
      const bIsLimited = b.is_limited;
      if (aIsLimited && !bIsLimited) return -1;
      if (!aIsLimited && bIsLimited) return 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });

  const fiveStars = poolChars.filter((c) => c.rarity === 5);
  const fourStars = poolChars.filter((c) => c.rarity === 4);

  return (
    <div className="mt-2.5 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
          <Users size={12} />
          卡池角色一览
        </span>
      </div>
      <div className="space-y-1.5">
        {sixStars.length > 0 && (
          <div className="flex items-start gap-1">
            <span className="w-8 shrink-0 font-mono text-[11px] font-semibold text-orange-500">6★</span>
            <div className="flex flex-wrap gap-1">
              {sixStars.slice(0, 6).map((char) => {
                const isUp = featuredCharacterSet.has(char.name);
                const isLimited = char.is_limited;
                return (
                  <span
                    key={char.id}
                    className={`border px-1.5 py-0.5 text-[11px] transition-colors ${
                      isUp
                        ? 'border-orange-400 bg-orange-50 font-bold text-orange-600 dark:border-orange-600 dark:bg-orange-900/40 dark:text-orange-300'
                        : isLimited
                          ? 'border-red-100 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400'
                          : 'border-amber-100 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300'
                    }`}
                    title={`${char.name}${isUp ? ' [当期UP]' : isLimited ? ' [限定]' : ' [常驻]'}`}
                  >
                    {isUp && '★'}
                    {char.name.length > 4 ? char.name.slice(0, 4) + '...' : char.name}
                  </span>
                );
              })}
              {sixStars.length > 6 && (
                <span className="font-mono text-[11px] text-slate-400 dark:text-zinc-500">+{sixStars.length - 6}</span>
              )}
            </div>
          </div>
        )}
        {fiveStars.length > 0 && (
          <div className="flex items-start gap-1">
            <span className="w-8 shrink-0 font-mono text-[11px] font-semibold text-purple-500">5★</span>
            <div className="flex flex-wrap gap-1">
              {fiveStars.slice(0, 4).map((char) => (
                <span
                  key={char.id}
                  className="border border-purple-100 bg-purple-50 px-1.5 py-0.5 text-[11px] text-purple-600 dark:border-purple-900 dark:bg-purple-900/20 dark:text-purple-400"
                >
                  {char.name.length > 4 ? char.name.slice(0, 4) + '...' : char.name}
                </span>
              ))}
              {fiveStars.length > 4 && (
                <span className="font-mono text-[11px] text-slate-400 dark:text-zinc-500">+{fiveStars.length - 4}</span>
              )}
            </div>
          </div>
        )}
        {fourStars.length > 0 && (
          <div className="flex items-start gap-1">
            <span className="w-8 shrink-0 font-mono text-[11px] font-semibold text-blue-500">4★</span>
            <span className="text-[11px] text-slate-400 dark:text-zinc-500">
              共 <span className="font-mono">{fourStars.length}</span> 个
            </span>
          </div>
        )}
        {poolChars.length === 0 && (
          <p className="text-[11px] italic text-slate-400 dark:text-zinc-500">暂无角色配置，点击编辑来添加</p>
        )}
      </div>
    </div>
  );
};

/**
 * 卡池卡片组件
 */
const PoolCard = ({ pool, poolCharacters, characters, actionLoading, onEdit, onDelete, onPreviewPush }) => {
  const featuredCharacters = getPoolFeaturedNames(pool, { entities: characters });
  const singleUpCharacter = featuredCharacters[0] || '';
  const poolStatus = getPoolStatus(pool);

  return (
    <div className="group border border-zinc-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md motion-reduce:hover:translate-y-0 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
      {/* Banner 图片 */}
      {pool.banner_url && (
        <div className="relative h-24 w-full overflow-hidden">
          <img
            src={pool.banner_url}
            alt={pool.name}
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent"></div>
        </div>
      )}

      {/* 卡池信息 */}
      <div className="p-2.5">
        <div className="mb-1.5 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              {getTypeIcon(pool.type)}
              <h4 className="truncate text-sm font-bold text-slate-700 dark:text-zinc-200">{pool.name}</h4>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`border px-1.5 py-0.5 text-[11px] font-medium ${getTypeColor(pool.type)}`}>
                {getTypeLabel(pool.type)}
              </span>
              {poolStatus && (
                <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-zinc-400">
                  <StatusDot tone={poolStatus.tone} pulse={poolStatus.pulse} />
                  {poolStatus.label}
                </span>
              )}
              <span className="truncate font-mono text-[10px] text-slate-400 dark:text-zinc-600" title={pool.pool_id}>
                {pool.pool_id}
              </span>
            </div>
          </div>
        </div>

        {/* UP 角色 */}
        {singleUpCharacter && pool.type !== 'extra' && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-600 dark:text-zinc-400">
            <Star size={12} className="text-orange-500" />
            UP: {singleUpCharacter}
          </div>
        )}

        {pool.type === 'extra' && featuredCharacters.length > 0 && (
          <div className="mt-1.5 text-xs text-slate-600 dark:text-zinc-400">
            <div className="flex items-center gap-1.5">
              <Star size={12} className="text-cyan-500" />
              6★ 名单
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {featuredCharacters.map((name) => (
                <span
                  key={name}
                  className="border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-[11px] text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950/30 dark:text-cyan-300"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 描述 */}
        {pool.description && (
          <p className="mt-1.5 line-clamp-2 text-[11px] text-slate-500 dark:text-zinc-500">{pool.description}</p>
        )}

        {/* 时间范围 */}
        {(pool.start_time || pool.end_time) && (
          <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] text-slate-400 dark:text-zinc-500">
            <Calendar size={12} />
            {pool.start_time && new Date(pool.start_time).toLocaleDateString()}
            {pool.start_time && pool.end_time && ' - '}
            {pool.end_time && new Date(pool.end_time).toLocaleDateString()}
          </div>
        )}

        {/* 卡池角色一览 */}
        <PoolCharacterList pool={pool} poolCharacters={poolCharacters} characters={characters} />

        {/* 操作按钮 */}
        <div className="mt-2.5 flex items-center gap-2 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
          {onPreviewPush && (
            <PanelToolbarButton
              onClick={() => onPreviewPush(pool)}
              disabled={actionLoading === pool.pool_id || actionLoading === 'pool-push'}
            >
              <Send size={12} />
              预览推送
            </PanelToolbarButton>
          )}
          <PanelToolbarButton onClick={() => onEdit(pool)} disabled={actionLoading === pool.pool_id}>
            <Edit2 size={12} />
            编辑
          </PanelToolbarButton>
          <PanelToolbarButton onClick={() => onDelete(pool)} disabled={actionLoading === pool.pool_id} tone="danger">
            <Trash2 size={12} />
            {actionLoading === pool.pool_id ? '删除中...' : '删除'}
          </PanelToolbarButton>
        </div>
      </div>
    </div>
  );
};

export default PoolCard;
