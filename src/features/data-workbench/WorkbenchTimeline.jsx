import React, { useMemo } from 'react';
import { Clock3, Plus, Star } from 'lucide-react';
import { KIND_LABELS } from './workbenchLabels.js';
import { StageBadge, TimelineSectionCard, TimelineStageCard } from '../../components/dashboard/PoolTimelinePanel.jsx';
import { useI18n } from '../../i18n/index.js';
import { resolvePoolCapabilities } from '../../utils/poolCapabilities.js';
import { compareHistoryTimelineAsc } from '../../utils/historyTimelineSort.js';
import { buildWorkbenchHistoryProgress } from './workbenchHistoryView.js';

const present = (value) => value !== '' && value !== null && value !== undefined;
const date = (value, dateOnly = false) => {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '时间未知';
  return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit',
    ...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) });
};
const METHODS = { normal: '普通抽取', free: '免费抽取', info_book: '情报书', gift: '赠送' };
const poolType = pool => resolvePoolCapabilities(pool).basePoolType;

function FiveStarDrops({ rows, entities, renderActions }) {
  if (!rows.length) return null;
  return <details className="wb-five-drops"><summary>五星获得 · {rows.length} 次</summary><div className="wb-five-drop-list">
    {rows.map(({ entry, index }) => {
      const entity = entities.find(item => String(item.id) === String(entry.values.entityId));
      return <article className="wb-five-drop" key={entry.entryId || entry.id} data-record-id={entry._historyRecord?.id ?? entry._historyRecord?.record_id}
        title={`${date(entry.values.timestamp)} · ${present(entry.values.intervalPulls) ? `${entry.values.intervalPulls} 抽间隔` : '间隔未知'} · ${METHODS[entry.values.drawMethod]}`}>
        <StageBadge compact badge={{ label: entity?.name || '身份未知', rarity: 5, count: 1, avatarUrl: entity?.avatar_url }} />
        {present(entry.values.intervalPulls) && <span>{entry.values.intervalPulls}抽</span>}{renderActions?.(entry, index)}
      </article>;
    })}
  </div></details>;
}

export function WorkbenchEntryPreview({ entry, pools, entities }) {
  const values = entry.values;
  const entity = entities.find((item) => item.id === values.entityId);
  const pool = pools.find((item) => item.id === entry.poolId);
  const summary = ['pool-summary', 'batch-summary', 'pool-ledger'].includes(entry.kind);
  const exact = ['detail', 'potential-evidence'].includes(entry.kind);
  const fields = summary
    ? [['totalPulls', '总抽数'], ['sixStarCount', '六星'], ['fiveStarCount', '五星'], ['fourStarCount', '四星'], ['pity', '当前垫抽']]
    : entry.kind === 'six-star-interval' ? [['intervalPulls', '出货间隔 / 抽']] : [['quantity', '获取数量']];
  return <div className="wb-entry-preview">
    <div className="wb-preview-pool"><strong>{pool?.name || entry.poolId || '尚未选择卡池'}</strong>
      <span>{entry.kind === 'potential-evidence' ? '其他获取来源' : METHODS[values.drawMethod] || '抽取方式未知'}</span>
    </div>
    {(!summary) && <div className="wb-preview-entity">
      <span className={`wb-entity-mark ${Number(entity?.rarity) === 6 ? 'wb-entity-mark--six' : ''}`}><Star size={21} /></span>
      <div><strong>{entity?.name || values.entityId || '角色 / 武器未知'}</strong><span>{entity?.rarity ? `${entity.rarity} 星 · ` : ''}{KIND_LABELS[entry.kind]}</span></div>
    </div>}
    <dl className="wb-preview-numbers">
      {fields.map(([key, label]) => <div key={key} data-rarity={key === 'sixStarCount' ? 6 : key === 'fiveStarCount' ? 5 : undefined}>
        <dt>{label}</dt><dd className={present(values[key]) ? '' : 'wb-unknown'}>{present(values[key]) ? values[key] : '未知'}</dd>
      </div>)}
      {entry.kind === 'batch-summary' && <div><dt>批次序号</dt><dd>{present(values.batchIndex) ? values.batchIndex : '未知'}</dd></div>}
      {present(values.orderIndex) && <div><dt>同秒顺序</dt><dd>{values.orderIndex}</dd></div>}
    </dl>
    <div className="wb-preview-time"><Clock3 size={14} />
      <div>{exact ? <span>获得时间：{date(values.timestamp)}</span> : <><span>覆盖开始：{date(values.rangeStart)}（含）</span><span>覆盖结束：{date(values.rangeEnd)}（不含）</span></>}
        <small>时间精度：{{ second: '精确到秒', day: '仅日期', range: '覆盖区间', unknown: '未知' }[entry.timePrecision] || '未知'}</small>
      </div>
    </div>
    {values.evidenceRef && <p className="wb-preview-note"><b>获取证据</b>{values.evidenceRef}</p>}
    {values.notes && <p className="wb-preview-note"><b>备注</b>{values.notes}</p>}
  </div>;
}

export default function WorkbenchTimeline({ entries, pools, entities, history = [], intervalHistory = history, showFiveStars = true, validations = [], issuesOnly = false, saved = false, renderActions, onAdd, disabled = false }) {
  const { t, locale } = useI18n();
  const progress = useMemo(() => buildWorkbenchHistoryProgress(intervalHistory, pools), [intervalHistory, pools]);
  // Keep original mutation indices while showing recent records first. A
  // summary's start is only a display position, never a draw time.
  const historical = history.filter(row => Number(row.rarity) >= 5).map(row => ({
    entryId: `history:${row.id ?? row.record_id}`, kind: 'detail', poolId: row.poolId ?? row.pool_id,
    _historyRecord: row, reviewState: 'confirmed', timePrecision: 'second',
    values: { entityId: row.characterId ?? row.character_id ?? row.entityId, timestamp: row.timestamp, quantity: 1,
      intervalPulls: progress.get(String(row.poolId ?? row.pool_id))?.intervals.get(String(row.id ?? row.record_id))?.[Number(row.rarity) >= 6 ? 'sixStarPity' : 'fiveStarPity'],
      drawMethod: row.specialType === 'gift' || row.special_type === 'gift' ? 'gift' : row.isFree || row.is_free ? 'free' : row.isInfoBook || row.is_info_book ? 'info_book' : 'normal' },
  }));
  const rows = [...entries, ...historical].map((entry, index) => ({ entry, index, time: new Date(entry.values.timestamp ?? entry.values.rangeStart).getTime() }));
  rows.sort((a, b) => (Number.isFinite(b.time) ? b.time : Infinity) - (Number.isFinite(a.time) ? a.time : Infinity)
    || (a.entry._historyRecord && b.entry._historyRecord ? compareHistoryTimelineAsc(b.entry._historyRecord, a.entry._historyRecord) : b.index - a.index));
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.entry.poolId)) groups.set(row.entry.poolId, []);
    groups.get(row.entry.poolId).push(row);
  }
  return <div className="wb-pool-grid" aria-label={saved ? '已保存补录时间线' : '待保存内容时间线'}>
    {[...groups].map(([poolId, group]) => {
      const pendingFives = new Map(); const support = new Map();
      for (const row of [...group].reverse()) {
        if (!row.entry._historyRecord) continue;
        const lane = row.entry.values.drawMethod;
        if (Number(row.entry._historyRecord.rarity) === 5) pendingFives.set(lane, [...(pendingFives.get(lane) || []), row]);
        else { support.set(row.entry.entryId, pendingFives.get(lane) || []); pendingFives.set(lane, []); }
      }
      const trailingFives = [...pendingFives.values()].flat();
      const visible = group.filter(({ entry, index }) => (!entry._historyRecord || Number(entry._historyRecord.rarity) >= 6)
        && (!issuesOnly || (!validations[index]?.valid && entry.reviewState !== 'skipped')));
      if (!visible.length && !trailingFives.length) return null;
      const pool = pools.find(item => item.id === poolId);
      const type = poolType(pool);
      const summaries = group.filter(({ entry }) => ['pool-summary', 'pool-ledger'].includes(entry.kind) && entry.reviewState !== 'skipped');
      // Overlapping summaries and displayed drops are not additive. The header
      // quotes one supplied summary, rather than manufacturing a combined total.
      const latest = [...summaries].sort((a, b) => (Date.parse(a.entry.values.rangeEnd) || 0) - (Date.parse(b.entry.values.rangeEnd) || 0)).at(-1)?.entry.values;
      const missing = group.filter(({ entry, index }) => !saved && !entry._historyRecord && entry.reviewState !== 'skipped' && validations[index] && !validations[index].valid).length;
      const poolHistory = history.filter(row => String(row.poolId ?? row.pool_id) === String(poolId));
      const totalHistory = poolHistory.filter(row => row.specialType !== 'gift' && row.special_type !== 'gift').length;
      const section = {
        id: `${saved ? 'saved' : 'draft'}-${poolId || 'unmapped'}`, type,
        title: pool?.name || poolId || '未选择卡池',
        featured: entities.find(entity => entity.id === pool?.up_character)?.name || pool?.up_character,
        period: latest?.coverageMode === 'pool' ? '整池存档 · 未知时间保留为空' : latest ? `${date(latest.rangeStart, true)} — ${date(latest.rangeEnd, true)}` : '只展示已知内容',
        entries: visible.map(row => ({ id: row.entry.entryId || row.entry.id, ...row })),
      };
      const metrics = [['总抽数', latest?.totalPulls ?? (poolHistory.length ? totalHistory : undefined)], ['六星', latest?.sixStarCount ?? (poolHistory.length ? poolHistory.filter(row => Number(row.rarity) === 6).length : undefined)], ['五星', latest?.fiveStarCount ?? (poolHistory.length ? poolHistory.filter(row => Number(row.rarity) === 5).length : undefined)], ['垫抽', latest ? latest.pity : progress.get(String(poolId))?.currentPity]]
        .map(([label, value]) => ({ label, value: present(value) ? String(value) : '—' }));
      return <section key={poolId || 'unmapped'} className="wb-pool-card" aria-label={`${section.title}补录卡片`}>
        <TimelineSectionCard section={section} dense embedded t={t} locale={locale} metrics={metrics} showMetadata={false}
          statusText={`${group.length} 条${missing ? ` · ${missing} 条待补齐` : ''}`}
          footer={<>
            {showFiveStars && <FiveStarDrops rows={trailingFives} entities={entities} renderActions={renderActions} />}
            {onAdd && <button className="wb-add-in-pool" disabled={disabled} onClick={() => onAdd(poolId)}><Plus size={14} /> 继续补录</button>}</>}
          renderEntry={({ entry, index }) => {
            const validation = validations[index];
            const state = saved ? 'saved' : entry.reviewState;
            const status = entry._historyRecord ? entry._historyRecord._changed ? '修改待保存' : '原有明细' : state === 'skipped' ? '本次不保存' : saved || entry._saved && !entry._changed ? '已保存' : entry._changed ? '修改待保存' : validation?.valid ? '新增待保存' : '待核对';
            const entity = entities.find(item => item.id === entry.values.entityId);
            const summary = ['pool-summary', 'batch-summary', 'pool-ledger'].includes(entry.kind);
            const paidHistory = entry._historyRecord && entry.values.drawMethod !== 'gift' && entry.values.drawMethod !== 'free';
            const interval = entry.kind === 'six-star-interval' || paidHistory;
            const value = summary ? entry.values.totalPulls : interval ? entry.values.intervalPulls : entry.values.quantity;
            const unit = summary || interval ? '抽' : '件';
            const stageKind = entry.values.drawMethod === 'gift' || entry.values.drawMethod === 'free' ? 'gift'
              : entity?.rarity === 5 ? 'fiveStar' : entity?.rarity >= 6 ? [entity.id, entity.name].includes(pool?.up_character) ? 'up' : 'sixStar' : 'generic';
            const stage = {
              id: entry.entryId || entry.id, stageKind,
              stageLabel: summary ? '汇总' : entry.values.drawMethod === 'gift' ? '赠送' : entry.values.drawMethod === 'free' ? '免费' : interval ? `${entity?.rarity || 6}★ 出货` : entry.kind === 'potential-evidence' ? '获取证据' : '明细',
              resultSummary: summary ? `6★ ${entry.values.sixStarCount ?? '未知'} · 5★ ${entry.values.fiveStarCount ?? '未知'} · 4★ ${entry.values.fourStarCount ?? '未知'}` : entity?.name || '待选择角色 / 武器',
              leadBadge: { label: summary ? '汇总' : entity?.name || '?', rarity: entity?.rarity || 0, avatarUrl: entity?.avatar_url },
              dateLabel: date(entry.values.timestamp || entry.values.rangeStart, true).replace(/^\d{4}\//, ''),
              pulls: interval && present(value) ? Number(value) : 0,
              targetPulls: Number(resolvePoolCapabilities(pool || {}).rules[Number(entity?.rarity) === 5 && paidHistory ? 'fiveStarPity' : 'sixStarPity'] || (Number(entity?.rarity) === 5 && paidHistory ? 10 : 80)),
              dropBadges: [],
            };
            return <article key={entry.entryId || entry.id} className={`wb-timeline-card ${entry._historyRecord ? 'wb-timeline-card--history' : ''} ${entry._historyRecord?._changed || entry._changed ? 'wb-timeline-card--changed' : ''} ${state === 'skipped' ? 'wb-row-skipped' : ''}`} aria-label={`${saved ? '已保存' : '草稿'}条目 ${index + 1}`} data-record-id={entry._historyRecord?.id ?? entry._historyRecord?.record_id} title={paidHistory && present(value) ? `出货间隔：${value} 抽` : undefined}>
              <TimelineStageCard entry={stage} sectionId={section.id} sectionType={type} t={t} dense
                barValue={present(value) ? value : '未知'} barUnit={present(value) ? unit : ''}
                barWidthPercent={!present(value) ? 0 : interval ? undefined : 100}>
                <div className="wb-row-meta">{(!entry._historyRecord || entry._historyRecord._changed) && <span className={validation?.valid || saved || entry._historyRecord ? '' : 'wb-row-warning'}>{status}</span>}
                  {!entry._historyRecord && <span>{entry.kind === 'pool-ledger' && entry.values.coverageMode === 'pool' ? '整池存档' : summary ? `${date(entry.values.rangeStart, true)} — ${date(entry.values.rangeEnd, true)}` : interval ? '已知出货间隔' : entry.kind === 'potential-evidence' ? '其他来源获取' : '出货间隔未知'}</span>}
                  {renderActions?.(entry, index)}
                </div>
                {validation?.issues.length > 0 && state !== 'skipped' && <p className="wb-row-warning wb-row-issue">{validation.issues[0].message}</p>}
              </TimelineStageCard>
              {showFiveStars && <FiveStarDrops rows={support.get(entry.entryId) || []} entities={entities} renderActions={renderActions} />}
              {entry.kind === 'pool-ledger' && <div className="wb-ledger-drops">
                {showFiveStars && <FiveStarDrops rows={(entry.values.acquisitions || []).filter(row => Number(row.rarity) === 5).map(row => ({ entry: { entryId: row.id, values: row } }))} entities={entities} />}
                {(entry.values.acquisitions || []).filter(row => Number(row.rarity) >= 6).map((row, at) => {
                  const item = entities.find(candidate => String(candidate.id) === String(row.entityId));
                  const drop = { id: row.id || `${entry.entryId}:${at}`, stageKind: row.drawMethod === 'free' || row.drawMethod === 'gift' ? 'gift' : row.rarity === 5 ? 'fiveStar' : row.isOffRate === false ? 'up' : 'sixStar', stageLabel: row.drawMethod === 'gift' ? '赠送' : row.drawMethod === 'free' ? '免费' : row.pullIndex ? `第 ${row.pullIndex} 抽` : '已知出货', resultSummary: item?.name || `${row.rarity}★ · 身份未知`, leadBadge: { label: item?.name || '?', rarity: row.rarity, avatarUrl: item?.avatar_url }, dateLabel: date(row.timestamp, true), pulls: Number(row.intervalPulls) || 0, targetPulls: stage.targetPulls, dropBadges: [] };
                  return <TimelineStageCard key={drop.id} entry={drop} sectionId={section.id} sectionType={type} t={t} dense barValue={row.intervalPulls || (row.batchIndex ? `第 ${row.batchIndex}` : '未知')} barUnit={row.intervalPulls ? '抽间隔' : row.batchIndex ? '次十连' : ''} barWidthPercent={row.intervalPulls ? undefined : 0}>
                    <div className="wb-row-meta"><span>{row.isOffRate === true ? '歪' : row.isOffRate === false ? '当期 UP' : 'UP 状态未确认'}</span><span>{METHODS[row.drawMethod]}</span></div>
                  </TimelineStageCard>;
                })}
                {!!(entry._inferredRemaining ?? entry.values.inferredFill?.count ?? entry.values.inferredRecords?.length) && <details className="wb-inferred-preview"><summary>{entry._inferredRemaining ?? entry.values.inferredFill?.count ?? entry.values.inferredRecords.length} 条四星推算记录 · 仅供存档展示</summary>
                  <p>角色随机填充，无准确时间与真实顺序，不参与精确分析。</p>
                  <div>{(entry.values.inferredRecords || []).slice(0, 16).map(row => <span key={row.id}>{entities.find(item => String(item.id) === String(row.entityId))?.name || '四星'} <small>推算</small></span>)}</div>
                </details>}
              </div>}
            </article>;
          }} />
      </section>;
    })}
  </div>;
}
