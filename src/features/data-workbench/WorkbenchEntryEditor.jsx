import React from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { KIND_LABELS } from './workbenchLabels.js';
import { WorkbenchEntitySelect, WorkbenchPoolSelect } from './WorkbenchCatalogSelect.jsx';
const inputClass = 'wb-input';
const COUNT_LABELS = {
  totalPulls: '总抽数',
  fourStarCount: '四星数量',
  fiveStarCount: '五星数量',
  sixStarCount: '六星数量',
  pity: '截至区间结束时垫抽',
  batchIndex: '批次序号',
  intervalPulls: '出货间隔（抽）',
  quantity: '获取数量',
  orderIndex: '同秒顺序（已知时填写）',
};
const localTime = (value) => {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
};

export default function WorkbenchEntryEditor({ entry, pools, entities, onChange, disabled = false }) {
  const value = entry.values;
  const patch = (change) => onChange({ ...entry, ...change, reviewState: 'unreviewed' });
  const field = (key, next) => patch({ values: { ...value, [key]: next },
    ...(['rangeStart', 'rangeEnd'].includes(key) && next && entry.timePrecision === 'unknown' ? { timePrecision: 'range' } : {}) });
  const exact = ['detail', 'potential-evidence'].includes(entry.kind);
  const needsEntity = ['detail', 'six-star-interval', 'potential-evidence'].includes(entry.kind);
  const pool = pools.find((item) => item.id === entry.poolId);
  const summary = ['pool-summary', 'batch-summary'].includes(entry.kind);
  const counts = summary
    ? ['totalPulls', 'sixStarCount', 'fiveStarCount', 'fourStarCount']
    : entry.kind === 'potential-evidence' ? ['quantity'] : entry.kind === 'six-star-interval' ? ['intervalPulls'] : [];
  const countInput = (key) => (
    <label key={key} className={`wb-count wb-count--${key}`}>
      <span>{COUNT_LABELS[key]}</span>
      <input className={inputClass} type="number" inputMode="numeric" min="0" max="1000000" step="1"
        placeholder="未知" value={value[key] ?? ''} onChange={(event) => field(key, event.target.value)} />
    </label>
  );
  return (
    <fieldset disabled={disabled} className="wb-entry-form">
      <legend className="sr-only">{KIND_LABELS[entry.kind]}填写内容</legend>
      <div className="wb-field-grid">
      <label>
        <span>标准卡池</span>
        <WorkbenchPoolSelect label="标准卡池" pools={pools} value={entry.poolId || ''} disabled={disabled}
          onChange={poolId => patch({ poolId: poolId || null, values: { ...value, entityId: '' } })} />
      </label>
      {needsEntity && (
        <label>
          <span>角色 / 武器</span>
          <WorkbenchEntitySelect label="角色 / 武器" pool={pool} entities={entities} value={value.entityId || ''}
            disabled={disabled} rarity={entry.kind === 'six-star-interval' ? 6 : undefined} onChange={id => field('entityId', id)} />
        </label>
      )}
      {entry.kind !== 'potential-evidence' && (
        <label>
          <span>抽取方式</span>
          <select
            className={inputClass}
            value={value.drawMethod || ''}
            onChange={(event) => field('drawMethod', event.target.value)}
          >
            <option value="">未知 / 请选择</option>
            <option value="normal">普通抽取</option>
            <option value="free">免费抽取</option>
            <option value="info_book">情报书</option>
            <option value="gift">赠送</option>
          </select>
        </label>
      )}
      {entry.kind === 'batch-summary' && countInput('batchIndex')}
      </div>
      {counts.length > 0 && (
        <section className="wb-form-section">
          <div className="wb-section-caption"><strong>{summary ? '已知的抽卡数量' : '已知数量'}</strong><span>不知道的留空，不等于 0</span></div>
          <div className={`wb-counts ${summary ? 'wb-counts--summary' : ''}`}>{counts.map(countInput)}</div>
          {summary && <div className="wb-pity">{countInput('pity')}<span>距离上次六星的抽数，知道时再填。</span></div>}
        </section>
      )}
      <section className="wb-form-section">
        <div className="wb-section-caption"><strong>{exact ? '获得时间' : '这些数量覆盖的时间'}</strong><span>使用设备当前时区</span></div>
        <div className="wb-field-grid">
      {exact ? (
        <label>
          <span>获得时间</span>
          <input
            className={inputClass}
            type="datetime-local"
            step="1"
            value={localTime(value.timestamp)}
            onChange={(event) =>
              patch({
                timePrecision: event.target.value ? 'second' : 'unknown',
                values: {
                  ...value,
                  timestamp: event.target.value,
                  ...(entry.kind === 'detail' ? { quantity: 1 } : {}),
                },
              })
            }
          />
        </label>
      ) : (
        <>
          {['rangeStart', 'rangeEnd'].map((key, index) => (
            <label key={key}>
              <span>{index ? '覆盖结束（不含该时刻）' : '覆盖开始（含该时刻）'}</span>
              <input
                className={inputClass}
                type="datetime-local"
                step="1"
                value={localTime(value[key])}
                onChange={(event) => field(key, event.target.value)}
              />
            </label>
          ))}
        </>
      )}
        </div>
        {!exact && <p className="wb-field-hint"><Info size={13} /> 填写这份汇总实际覆盖的时间，用于与已有记录查重。</p>}
      </section>
      {entry.kind === 'potential-evidence' && (
        <label>
          <span>可追溯的获取证据</span>
          <input
            className={inputClass}
            maxLength={500}
            value={value.evidenceRef || ''}
            onChange={(event) => field('evidenceRef', event.target.value)}
            placeholder="来源和唯一凭据，不重复填写已导入的抽卡记录"
          />
        </label>
      )}
      <details className="wb-optional">
        <summary><ChevronDown size={15} /> 更多信息<span>备注{exact ? '、同秒顺序' : ''}与时间精度</span></summary>
        <div className="wb-field-grid">
          <label>
            <span>时间精度</span>
            <select className={inputClass} value={entry.timePrecision} onChange={(event) => patch({ timePrecision: event.target.value })}>
              <option value="unknown">未知（保留草稿）</option><option value="second">精确到秒</option><option value="day">仅日期</option><option value="range">覆盖区间</option>
            </select>
          </label>
          {exact && countInput('orderIndex')}
        </div>
      <label>
        <span>备注</span>
        <textarea
          className={inputClass}
          rows={2}
          placeholder="例如：数据来自哪张截图，或需要说明的情况（选填）"
          maxLength={2000}
          value={value.notes || ''}
          onChange={(event) => field('notes', event.target.value)}
        />
      </label>
      </details>
    </fieldset>
  );
}
