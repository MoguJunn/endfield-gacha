import React, { useMemo } from 'react';
import { List, useDynamicRowHeight } from 'react-window';
import BatchCard from '../BatchCard.jsx';

function getRecordKey(record) {
  return String(
    record?.id
    || record?.record_id
    || [
      record?.poolId || record?.pool_id || 'pool',
      record?.seqId || record?.seq_id || 'seq',
      record?.timestamp || record?.created_at || 'time',
    ].join(':')
  );
}

function getRecordGroupKey(group = []) {
  return group.map(getRecordKey).join('|') || 'empty-group';
}

function RecordGroupRow({
  index,
  style,
  ariaAttributes,
  groups,
  onEdit,
  onDeleteGroup,
  poolType,
  canEdit,
  showPoolName,
  poolMetaById,
}) {
  const group = groups[index] || [];
  const groupKey = getRecordGroupKey(group);

  return (
    <div style={style} {...ariaAttributes} className="border-b border-slate-100 dark:border-zinc-800/70">
      <BatchCard
        key={groupKey}
        group={group}
        onEdit={onEdit}
        onDeleteGroup={onDeleteGroup}
        poolType={poolType}
        canEdit={canEdit}
        showPoolName={showPoolName}
        poolMetaById={poolMetaById}
      />
    </div>
  );
}

export default function VirtualizedRecordGroupList({
  groups,
  onEdit,
  onDeleteGroup,
  poolType,
  canEdit,
  showPoolName,
  poolMetaById,
}) {
  const normalizedGroups = useMemo(() => (Array.isArray(groups) ? groups : []), [groups]);
  const cacheKey = useMemo(() => {
    const firstKey = getRecordGroupKey(normalizedGroups[0]);
    const lastKey = getRecordGroupKey(normalizedGroups[normalizedGroups.length - 1]);
    return `${normalizedGroups.length}:${firstKey}:${lastKey}`;
  }, [normalizedGroups]);
  const dynamicRowHeight = useDynamicRowHeight({
    defaultRowHeight: 176,
    key: cacheKey,
  });
  const rowProps = useMemo(() => ({
    groups: normalizedGroups,
    onEdit,
    onDeleteGroup,
    poolType,
    canEdit,
    showPoolName,
    poolMetaById,
  }), [canEdit, normalizedGroups, onDeleteGroup, onEdit, poolMetaById, poolType, showPoolName]);

  return (
    <List
      aria-label="抽卡记录列表"
      rowComponent={RecordGroupRow}
      rowCount={normalizedGroups.length}
      rowHeight={dynamicRowHeight}
      rowProps={rowProps}
      overscanCount={4}
      defaultHeight={640}
      style={{ height: 'min(70vh, 720px)', width: '100%' }}
    />
  );
}
