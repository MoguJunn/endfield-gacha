import React, { useState } from 'react';
import WorkbenchDialog from './WorkbenchDialog.jsx';
import { WorkbenchEntitySelect, WorkbenchPoolSelect } from './WorkbenchCatalogSelect.jsx';
import { entitiesForWorkbenchPool } from './workbenchCatalog.js';

export default function WorkbenchHistoryEditor({ record, entities, pools, scope, onApply, onClose }) {
  const [value, setValue] = useState({ entityId: record.characterId ?? record.character_id ?? '', poolId: record.poolId ?? record.pool_id,
    timestamp: record.timestamp || '', drawMethod: record.specialType === 'gift' ? 'gift' : record.isFree ? 'free' : record.isInfoBook ? 'info_book' : 'normal', isStandard: record.isStandard === true });
  const [reason, setReason] = useState('');
  const entity = entities.find(item => String(item.id) === String(value.entityId));
  const pool = pools.find(item => item.id === value.poolId);
  const eligible = entitiesForWorkbenchPool(pool, entities).some(item => String(item.id) === String(value.entityId));
  const localDate = raw => {
    const date = new Date(raw);
    if (!Number.isFinite(date.getTime())) return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  };
  function apply() {
    const original = record._originalHistory || record;
    onApply({ recordId: String(original.record_id ?? original.id), gameUid: scope.gameUid, serverScope: scope.serverScope,
      currentPoolId: original.poolId ?? original.pool_id, seqId: original.seqId ?? original.seq_id,
      expectedEditVersion: Number(original.editVersion ?? original.edit_version ?? 1), reason: reason.trim(),
      changes: { poolId: value.poolId, characterId: entity.id, timestamp: new Date(value.timestamp).toISOString(),
        isStandard: value.isStandard, drawMethod: value.drawMethod },
    });
  }
  return <WorkbenchDialog title="修改原有明细" onClose={onClose} description="先生成待核对修改；规则验证和整体保存后才更新原有记录。" footer={<>
    <button className="wb-button" onClick={onClose}>取消</button><button className="wb-button wb-button--primary" disabled={!entity || !eligible || !Number.isFinite(Date.parse(value.timestamp)) || !reason.trim()} onClick={apply}>返回卡片核对</button>
  </>}>
    <p className="wb-notice">原内容：{record.rarity}★ {record.name || entities.find(item => String(item.id) === String(record.characterId))?.name} · {record.timestamp ? new Date(record.timestamp).toLocaleString('zh-CN') : '时间未知'}</p>
    <div className="wb-field-grid">
      <label>卡池<WorkbenchPoolSelect label="卡池" pools={pools} value={value.poolId} onChange={poolId => setValue(previous => ({ ...previous, poolId, entityId: '' }))} /></label>
      <label>角色／武器<WorkbenchEntitySelect label="角色／武器" pool={pool} entities={entities} value={value.entityId} onChange={entityId => setValue(previous => ({ ...previous, entityId }))} /></label>
      <label>准确时间<input className="wb-input" type="datetime-local" step="1" value={localDate(value.timestamp)} onChange={event => setValue(previous => ({ ...previous, timestamp: event.target.value }))} /></label>
      <label>抽取方式<select className="wb-input" value={value.drawMethod} onChange={event => setValue(previous => ({ ...previous, drawMethod: event.target.value }))}><option value="normal">普通抽取</option><option value="free">免费抽取</option><option value="info_book">情报书</option><option value="gift">赠送</option></select></label>
      <label><input type="checkbox" checked={value.isStandard} onChange={event => setValue(previous => ({ ...previous, isStandard: event.target.checked }))} /> 常驻／歪</label>
      <label>修改原因<input className="wb-input" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder="说明原记录需要修正的原因" /></label>
    </div>
  </WorkbenchDialog>;
}
