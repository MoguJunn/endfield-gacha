/**
 * 角色/武器列表表格组件
 *
 * @version 1.1.0
 * @date 2026-04-29
 */

import React from 'react';
import {
  CheckSquare,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Edit2,
  Square,
  Star,
  Swords,
  Trash2,
  User,
} from 'lucide-react';
import VirtualizedList from '../VirtualizedList';

const GRID_TEMPLATE = '2.7rem 4.5rem minmax(12rem,1.3fr) minmax(9rem,1fr) minmax(9rem,1fr) 6rem 6rem minmax(11rem,1fr) 5rem';

const getRarityColor = (rarity) => {
  switch (rarity) {
    case 6:
      return 'text-orange-500 bg-orange-100 dark:bg-orange-900/30';
    case 5:
      return 'text-purple-500 bg-purple-100 dark:bg-purple-900/30';
    case 4:
      return 'text-blue-500 bg-blue-100 dark:bg-blue-900/30';
    case 3:
      return 'text-slate-500 bg-slate-100 dark:bg-zinc-700';
    default:
      return 'text-slate-400 bg-slate-100 dark:bg-zinc-700';
  }
};

const getTypeIcon = (type) => (type === 'weapon' ? <Swords size={14} /> : <User size={14} />);

const SortIcon = ({ field, sortField, sortDirection }) => {
  if (sortField !== field) {
    return <ChevronsUpDown size={14} className="text-slate-300 dark:text-zinc-600" />;
  }
  return sortDirection === 'asc'
    ? <ChevronUp size={14} className="text-blue-500" />
    : <ChevronDown size={14} className="text-blue-500" />;
};

const HeaderCell = ({ children, className = '' }) => (
  <div className={`px-4 py-3 text-left ${className}`}>
    {children}
  </div>
);

const CharacterRow = ({
  char,
  getEnglishName,
  selectedIds,
  actionLoading,
  onToggleSelect,
  onEdit,
  onDelete,
}) => (
  <div
    className={`grid min-w-[76rem] items-center border-b border-slate-100 text-sm hover:bg-slate-50 dark:border-zinc-800 dark:hover:bg-zinc-950 ${
      selectedIds.has(char.id) ? 'bg-blue-50 dark:bg-blue-900/10' : 'bg-white dark:bg-zinc-900'
    }`}
    style={{ gridTemplateColumns: GRID_TEMPLATE }}
  >
    <div className="px-4 py-3">
      <button
        onClick={() => onToggleSelect(char.id)}
        className="text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-300"
      >
        {selectedIds.has(char.id) ? <CheckSquare size={18} className="text-blue-500" /> : <Square size={18} />}
      </button>
    </div>

    <div className="px-4 py-3">
      {char.avatar_url ? (
        <img
          src={char.avatar_url}
          alt={char.name}
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          className="w-10 h-10 rounded object-cover"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <div className="w-10 h-10 rounded bg-slate-200 dark:bg-zinc-700 flex items-center justify-center">
          {getTypeIcon(char.type)}
        </div>
      )}
    </div>

    <div className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-zinc-500 truncate">
      {char.id}
    </div>

    <div className="px-4 py-3 min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-medium text-slate-700 dark:text-zinc-200 truncate">{char.name}</span>
        {char.aliases?.length > 0 && (
          <span className="text-xs text-slate-400 dark:text-zinc-500 truncate">
            ({char.aliases.join(', ')})
          </span>
        )}
      </div>
    </div>

    <div className="px-4 py-3 min-w-0">
      <span className="font-medium text-slate-600 dark:text-zinc-300 truncate block">
        {getEnglishName?.(char) || '-'}
      </span>
    </div>

    <div className="px-4 py-3">
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium ${getRarityColor(char.rarity)}`}>
        <Star size={12} />
        {char.rarity}星
      </span>
    </div>

    <div className="px-4 py-3">
      <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${
        char.is_limited
          ? 'text-orange-600 bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400'
          : 'text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400'
      }`}>
        {char.is_limited ? '限定' : '常驻'}
      </span>
    </div>

    <div className="px-4 py-3 min-w-0">
      <div className="flex flex-wrap gap-1">
        {char.pool_config?.pools?.map(pool => (
          <span
            key={pool}
            className={`px-1.5 py-0.5 text-xs rounded ${
              pool === 'limited' ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400' :
              pool === 'standard' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' :
              pool === 'weapon' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' :
              'bg-slate-100 text-slate-600 dark:bg-zinc-700 dark:text-zinc-400'
            }`}
          >
            {pool === 'limited' ? '限定池' : pool === 'standard' ? '常驻池' : pool === 'weapon' ? '武器池' : pool}
          </span>
        ))}
        {(!char.pool_config?.pools || char.pool_config.pools.length === 0) && (
          <span className="text-xs text-slate-400 dark:text-zinc-600">-</span>
        )}
      </div>
    </div>

    <div className="px-4 py-3 text-right">
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => onEdit(char)}
          className="p-1.5 text-slate-400 hover:text-blue-500 dark:text-zinc-500 dark:hover:text-blue-400"
          title="编辑"
        >
          <Edit2 size={16} />
        </button>
        <button
          onClick={() => onDelete(char)}
          disabled={actionLoading === char.id}
          className="p-1.5 text-slate-400 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400"
          title="删除"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  </div>
);

const CharacterTable = ({
  characters,
  getEnglishName,
  selectedIds,
  isAllSelected,
  actionLoading,
  sortField,
  sortDirection,
  onSort,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  onEdit,
  onDelete
}) => (
  <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-800">
    <div
      className="grid min-w-[76rem] bg-slate-50 dark:bg-zinc-950 text-xs text-slate-500 dark:text-zinc-500 uppercase"
      style={{ gridTemplateColumns: GRID_TEMPLATE }}
    >
      <HeaderCell className="w-10">
        <button
          onClick={isAllSelected ? onDeselectAll : onSelectAll}
          className="text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          {isAllSelected ? <CheckSquare size={18} /> : <Square size={18} />}
        </button>
      </HeaderCell>
      <HeaderCell>头像</HeaderCell>
      <HeaderCell>
        <button onClick={() => onSort('id')} className="flex items-center gap-1 hover:text-slate-700 dark:hover:text-zinc-300 transition-colors">
          ID <SortIcon field="id" sortField={sortField} sortDirection={sortDirection} />
        </button>
      </HeaderCell>
      <HeaderCell>
        <button onClick={() => onSort('name')} className="flex items-center gap-1 hover:text-slate-700 dark:hover:text-zinc-300 transition-colors">
          名称 <SortIcon field="name" sortField={sortField} sortDirection={sortDirection} />
        </button>
      </HeaderCell>
      <HeaderCell>英文名</HeaderCell>
      <HeaderCell>
        <button onClick={() => onSort('rarity')} className="flex items-center gap-1 hover:text-slate-700 dark:hover:text-zinc-300 transition-colors">
          稀有度 <SortIcon field="rarity" sortField={sortField} sortDirection={sortDirection} />
        </button>
      </HeaderCell>
      <HeaderCell>
        <button onClick={() => onSort('is_limited')} className="flex items-center gap-1 hover:text-slate-700 dark:hover:text-zinc-300 transition-colors">
          限定 <SortIcon field="is_limited" sortField={sortField} sortDirection={sortDirection} />
        </button>
      </HeaderCell>
      <HeaderCell>可用卡池</HeaderCell>
      <HeaderCell className="text-right">操作</HeaderCell>
    </div>

    <VirtualizedList
      items={characters}
      getKey={(char) => char.id}
      itemHeight={74}
      maxHeight={620}
      className="min-w-[76rem] bg-white dark:bg-zinc-900"
      renderItem={(char) => (
        <CharacterRow
          char={char}
          getEnglishName={getEnglishName}
          selectedIds={selectedIds}
          actionLoading={actionLoading}
          onToggleSelect={onToggleSelect}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
    />
  </div>
);

export default CharacterTable;
