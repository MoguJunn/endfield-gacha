import React, { useEffect, useMemo, useState } from 'react';
import WorkbenchDialog from './WorkbenchDialog.jsx';
import { WorkbenchEntitySelect } from './WorkbenchCatalogSelect.jsx';
import { isWorkbenchPoolUnopened } from '../../../shared/workbenchPoolAvailability.js';
import {
  buildQuestionnaireResult,
  createQuestionnaireAcquisition,
  createQuestionnairePoolState,
  getSavedPoolLedgers,
  isWeaponPool,
  poolIdOf,
} from './workbenchInputAdapters.js';
import './workbench-inputs.css';

const methodOptions = (
  <>
    <option value="normal">正常抽取</option>
    <option value="free">免费抽取</option>
    <option value="gift">赠送</option>
    <option value="info_book">情报书</option>
  </>
);
const knownCount = (value) => (value === '' || value == null ? '未知' : value);

function CountQuestion({ label, value, onChange }) {
  return (
    <label>
      {label}
      <input
        className="wb-input"
        type="number"
        min="0"
        max="1000000"
        step="1"
        placeholder="不知道就留空"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function AcquisitionQuestion({ row, index, pool, entities, onChange, onRemove, onMove, first, last }) {
  const knownHistory = row.origin === 'history';
  return (
    <article className="wb-input-acquisition">
      <div className="wb-input-row-heading">
        <strong>第 {index + 1} 次高星获得</strong>
        <span className="wb-tag">{knownHistory ? '已有官方明细' : '本次台账'}</span>
        {!knownHistory && (
          <div className="wb-input-row-actions">
            <button
              type="button"
              className="wb-text-button"
              disabled={first}
              onClick={() => onMove(-1)}
              aria-label={`上移第 ${index + 1} 次获得`}
            >
              上移
            </button>
            <button
              type="button"
              className="wb-text-button"
              disabled={last}
              onClick={() => onMove(1)}
              aria-label={`下移第 ${index + 1} 次获得`}
            >
              下移
            </button>
            <button
              type="button"
              className="wb-text-button"
              onClick={onRemove}
              aria-label={`移除第 ${index + 1} 次获得`}
            >
              移除
            </button>
          </div>
        )}
      </div>
      <div className="wb-input-pair">
        <label>
          星级
          <select
            className="wb-input"
            value={row.rarity}
            onChange={(event) => onChange({ rarity: Number(event.target.value), entityId: '' })}
          >
            <option value="6">六星</option>
            <option value="5">五星</option>
          </select>
        </label>
        <label>
          {isWeaponPool(pool) ? '获得哪把武器？' : '获得哪位角色？'}
          <WorkbenchEntitySelect label={isWeaponPool(pool) ? '获得哪把武器？' : '获得哪位角色？'} pool={pool} entities={entities} rarity={row.rarity}
            value={row.entityId || ''} placeholder={knownHistory ? '请选择真实角色或武器' : '名称未知，仅记得星级'} onChange={entityId => onChange({ entityId })} />
        </label>
      </div>
      <details className="wb-input-details">
        <summary>补充获得位置、方式、UP 或日期（选填）</summary>
        <div className="wb-input-extra">
          {!knownHistory && (
            <div className="wb-input-pair">
              <CountQuestion
                label="在这个卡池第几抽获得？"
                value={row.pullIndex}
                onChange={(pullIndex) => onChange({ pullIndex })}
              />
              <CountQuestion
                label="距上次六星多少抽？（六星可填）"
                value={row.intervalPulls}
                onChange={(intervalPulls) => onChange({ intervalPulls })}
              />
            </div>
          )}
          <div className="wb-input-pair">
            <label>
              如何获得？
              <select
                className="wb-input"
                value={row.drawMethod || 'normal'}
                onChange={(event) => onChange({ drawMethod: event.target.value })}
              >
                {methodOptions}
              </select>
            </label>
            <label>
              是否为当期 UP？
              <select
                className="wb-input"
                value={typeof row.isOffRate === 'boolean' ? String(row.isOffRate) : ''}
                onChange={(event) =>
                  onChange({ isOffRate: event.target.value === '' ? undefined : event.target.value === 'true' })
                }
              >
                <option value="">不确定</option>
                <option value="false">是 UP</option>
                <option value="true">不是 UP（歪了）</option>
              </select>
            </label>
          </div>
          <label>
            记得日期吗？
            <select
              className="wb-input"
              value={row.timePrecision || 'unknown'}
              onChange={(event) => {
                if (event.target.value !== row.timePrecision)
                  onChange({ timePrecision: event.target.value, timestamp: undefined });
              }}
            >
              {(!knownHistory || row.timePrecision === 'unknown') && <option value="unknown">日期未知</option>}
              {!knownHistory && <option value="day">只知道日期</option>}
              <option value="second">知道精确时间（含秒和时区）</option>
            </select>
          </label>
          {row.timePrecision !== 'unknown' && (
            <label>
              {row.timePrecision === 'day' ? '已知日期' : '已知精确时间'}
              <input
                className="wb-input"
                type={row.timePrecision === 'day' ? 'date' : 'text'}
                value={row.timestamp || ''}
                placeholder={row.timePrecision === 'day' ? '' : 'YYYY-MM-DDTHH:mm:ss+08:00'}
                onChange={(event) => onChange({ timestamp: event.target.value })}
              />
            </label>
          )}
        </div>
      </details>
      {knownHistory && (
        <small className="wb-input-help">
          这行仅修改原明细，保留原记录标识，不会重复加入补录数量。不记得新的精确时间时，可以保留原时间。
        </small>
      )}
    </article>
  );
}

export default function WorkbenchQuestionnaire({
  scope,
  pools = [],
  entities = [],
  selectedPoolId,
  existingHistory = [],
  existingEntries = [],
  onApply,
  onClose,
  mode = 'add',
  readDelayMs = 15000,
}) {
  const [phase, setPhase] = useState('read');
  const [deadline] = useState(() => Date.now() + readDelayMs);
  const [seconds, setSeconds] = useState(() => Math.ceil(readDelayMs / 1000));
  const [selected, setSelected] = useState(() =>
    pools.some((pool) => poolIdOf(pool) === selectedPoolId && !isWorkbenchPoolUnopened(pool)) ? [selectedPoolId] : []
  );
  const [states, setStates] = useState({});
  const [position, setPosition] = useState(0);
  const [error, setError] = useState('');
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [skipPending, setSkipPending] = useState(false);
  useEffect(() => {
    if (readDelayMs === 0) return undefined;
    const timer = setInterval(() => setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
    return () => clearInterval(timer);
  }, [deadline, readDelayMs]);
  const selectedPools = useMemo(
    () => selected.map((id) => pools.find((pool) => poolIdOf(pool) === id)).filter(pool => pool && !isWorkbenchPoolUnopened(pool)),
    [selected, pools]
  );
  const pool = selectedPools[position];
  const state = pool ? states[poolIdOf(pool)] : null;

  function initialize(poolId, selectedEntryId) {
    return createQuestionnairePoolState(poolId, { scope, existingHistory, existingEntries, mode, selectedEntryId });
  }
  function startPools() {
    if (!selectedPools.length) return;
    setStates((previous) =>
      Object.fromEntries(
        selectedPools.map((item) => {
          const id = poolIdOf(item);
          return [id, previous[id] || initialize(id)];
        })
      )
    );
    setPosition(0);
    setSkipPending(false);
    setError('');
    setPhase('pool');
  }
  function changeState(patch) {
    setStates((previous) => ({
      ...previous,
      [poolIdOf(pool)]: { ...previous[poolIdOf(pool)], ...patch, skipped: false },
    }));
    setError('');
    setSkipPending(false);
  }
  function changeValue(key, value) {
    changeState({ values: { ...state.values, [key]: value } });
  }
  function changeRow(id, patch) {
    changeState({ acquisitions: state.acquisitions.map((row) => (row.id === id ? { ...row, ...patch } : row)) });
  }
  function moveRow(index, direction) {
    const rows = [...state.acquisitions];
    if (rows[index + direction]?.origin === 'history') return;
    [rows[index], rows[index + direction]] = [rows[index + direction], rows[index]];
    changeState({ acquisitions: rows });
  }
  function advance(skip = false) {
    const next = { ...states, [poolIdOf(pool)]: { ...state, skipped: skip } };
    try {
      if (!skip) buildQuestionnaireResult([next[poolIdOf(pool)]], { scope, pools, entities });
      setStates(next);
      setError('');
      setSkipPending(false);
      if (position + 1 < selectedPools.length) setPosition(position + 1);
      else {
        setReview(
          buildQuestionnaireResult(
            selectedPools.map((item) => next[poolIdOf(item)]),
            { scope, pools, entities }
          )
        );
        setPhase('review');
      }
    } catch (failure) {
      setError(failure.message);
    }
  }
  async function apply() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onApply(review);
      setPhase('applied');
    } catch (failure) {
      setError(failure.message || '未能加入草稿，请重试。');
    } finally {
      setBusy(false);
    }
  }
  const footer = (
    <>
      <span className="wb-dialog-draft-note">完成问卷后进入本次草稿，核对后再保存。</span>
      {phase === 'read' && (
        <button
          type="button"
          className="wb-button wb-button--primary"
          disabled={seconds > 0}
          onClick={() => {
            if (Date.now() >= deadline) setPhase('select');
          }}
        >
          我已阅读，继续{seconds > 0 ? `（${seconds} 秒）` : ''}
        </button>
      )}
      {phase === 'select' && (
        <>
          <button type="button" className="wb-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="wb-button wb-button--primary"
            disabled={!selectedPools.length}
            onClick={startPools}
          >
            开始填写
          </button>
        </>
      )}
      {phase === 'pool' && state && (
        <>
          <button
            type="button"
            className="wb-button"
            onClick={() => {
              setError('');
              setSkipPending(false);
              if (position) setPosition(position - 1);
              else setPhase('select');
            }}
          >
            上一步
          </button>
          <button
            type="button"
            className="wb-button"
            onClick={() => {
              setError('');
              setSkipPending(true);
            }}
          >
            跳过这个卡池
          </button>
          <button type="button" className="wb-button wb-button--primary" onClick={() => advance()}>
            {position + 1 === selectedPools.length ? '核对问卷' : '下一卡池'}
          </button>
        </>
      )}
      {phase === 'review' && (
        <>
          <button
            type="button"
            className="wb-button"
            disabled={busy}
            onClick={() => {
              setPhase('pool');
              setError('');
            }}
          >
            返回修改
          </button>
          <button type="button" className="wb-button wb-button--primary" disabled={busy} onClick={apply}>
            {busy ? '正在加入…' : '加入本次草稿'}
          </button>
        </>
      )}
      {phase === 'applied' && (
        <button type="button" className="wb-button wb-button--primary" onClick={onClose}>
          返回工作台核对
        </button>
      )}
    </>
  );
  return (
    <WorkbenchDialog
      title={mode === 'edit' ? '通过问卷修改已知记录' : '通过问卷补充抽卡记录'}
      description="每个卡池一页，只填写你确实知道的内容。"
      onClose={onClose}
      busy={busy}
      footer={footer}
    >
      <div className="wb-input-flow">
        {error && (
          <p role="alert" className="wb-notice wb-notice--error">
            {error}
          </p>
        )}
        {phase === 'read' && (
          <section className="wb-input-intro">
            <h3>先花 15 秒了解填写规则</h3>
            <p>请保证填写内容正确，不要凭模糊印象猜测。不能确认的信息请留空，或跳过这个卡池。</p>
            <p>不知道的抽数、垫抽和日期都可以留空。留空表示未知，明确为零才填 0。</p>
            <p>总抽数与星级数量是覆盖整个卡池（或选定时间段）的总汇，包含已有官方记录。请勿再把官方数量加一次。</p>
            <p>高星序列按你记得的先后顺序填写。只记得间隔也可以，未知日期不会被补成某一天。</p>
            <p>
              缺少四星角色或武器明细时，工作台会根据已知数量自动随机填充四星身份。随机结果无法保证准确，会明确标记为推算，请勿当作真实获得明细。
            </p>
            <p>已有官方行会修改原记录，已保存补录会按原修订版本更新。问卷完成后先展示在草稿中，你可以继续核对。</p>
            <p role="status" className="wb-input-countdown">
              {seconds > 0 ? `阅读提示后可继续，还需 ${seconds} 秒` : '阅读时间已结束，可以继续'}
            </p>
          </section>
        )}
        {phase === 'select' && (
          <section>
            <h3>这次要填写哪些卡池？</h3>
            <p className="wb-input-help">可以只选记得的几个卡池。</p>
            <div className="wb-input-selection-actions">
              <button type="button" className="wb-text-button" onClick={() => setSelected(pools.filter(pool => !isWorkbenchPoolUnopened(pool)).map(poolIdOf))}>
                全选
              </button>
              <button type="button" className="wb-text-button" onClick={() => setSelected([])}>
                清空选择
              </button>
            </div>
            <div className="wb-input-pool-selection">
              {pools.map((item) => (
                <label key={poolIdOf(item)}>
                  <input
                    type="checkbox"
                    disabled={isWorkbenchPoolUnopened(item)}
                    checked={selected.includes(poolIdOf(item))}
                    onChange={(event) =>
                      setSelected((previous) =>
                        event.target.checked
                          ? [...previous, poolIdOf(item)]
                          : previous.filter((id) => id !== poolIdOf(item))
                      )
                    }
                  />
                  <span>
                    {item.name || poolIdOf(item)}
                    <small>{isWeaponPool(item) ? '武器卡池' : '角色卡池'}{isWorkbenchPoolUnopened(item) ? ' · 尚未开放' : ''}</small>
                  </span>
                </label>
              ))}
            </div>
            {!pools.length && <p className="wb-notice wb-notice--warning">暂无可选卡池，请先刷新目录。</p>}
          </section>
        )}
        {phase === 'pool' && state && (
          <section className="wb-input-pool-questions">
            <div className="wb-input-step-heading">
              <div>
                <span className="wb-eyebrow">
                  {position + 1} / {selectedPools.length}
                </span>
                <h3>{pool.name || state.poolId}</h3>
              </div>
              <span className="wb-tag">{isWeaponPool(pool) ? '武器卡池' : '角色卡池'}</span>
            </div>
            {skipPending && (
              <section aria-label="跳过卡池提示">
                <p role="alert" className="wb-notice wb-notice--warning">
                  跳过后，{pool.name || state.poolId}{' '}
                  本次填写的内容不会加入草稿，已有记录保留。这个卡池的缺失信息将继续保持未知。
                </p>
                <div className="wb-input-actions">
                  <button type="button" className="wb-button" onClick={() => setSkipPending(false)}>
                    继续填写
                  </button>
                  <button type="button" className="wb-button" onClick={() => advance(true)}>
                    确认跳过
                  </button>
                </div>
              </section>
            )}
            {state.skipped && (
              <p className="wb-notice wb-notice--warning">此前跳过了这个卡池。继续填写会将它重新加入本次内容。</p>
            )}
            {mode === 'edit' && getSavedPoolLedgers(state.poolId, existingEntries, scope).length > 1 && (
              <label>
                这个卡池要修改哪条已保存补录？
                <select
                  className="wb-input"
                  value={state.original?.id ?? state.original?.entryId ?? state.original?.entry_id}
                  onChange={(event) =>
                    setStates((previous) => ({
                      ...previous,
                      [state.poolId]: initialize(state.poolId, event.target.value),
                    }))
                  }
                >
                  {getSavedPoolLedgers(state.poolId, existingEntries, scope).map((entry, index) => (
                    <option key={entry.id ?? entry.entryId} value={entry.id ?? entry.entryId ?? entry.entry_id}>
                      补录 {index + 1} · {entry.values?.totalPulls ?? '总数未知'} 抽
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="wb-input-question">
              <h4>1. 一共抽了多少次？</h4>
              <CountQuestion
                label="总抽数（包括已有官方记录）"
                value={state.values.totalPulls}
                onChange={(value) => changeValue('totalPulls', value)}
              />
            </div>
            <div className="wb-input-question">
              <h4>2. 总共获得了多少{isWeaponPool(pool) ? '把高星武器' : '位高星角色'}？</h4>
              <div className="wb-input-pair">
                <CountQuestion
                  label="五星数量"
                  value={state.values.fiveStarCount}
                  onChange={(value) => changeValue('fiveStarCount', value)}
                />
                <CountQuestion
                  label="六星数量"
                  value={state.values.sixStarCount}
                  onChange={(value) => changeValue('sixStarCount', value)}
                />
              </div>
            </div>
            <div className="wb-input-question">
              <h4>3. 现在垫了多少抽？</h4>
              <CountQuestion
                label="距上次六星的当前垫抽"
                value={state.values.pity}
                onChange={(value) => changeValue('pity', value)}
              />
            </div>
            <div className="wb-input-question">
              <h4>4. 记得哪些高星获得，以及先后顺序？</h4>
              <p className="wb-input-help">不记得名字也可以只保留星级。出货位置、间隔、UP 和日期都只填写已知信息。</p>
              {state.acquisitions.map((row, index) => (
                <AcquisitionQuestion
                  key={row.id}
                  row={row}
                  index={index}
                  pool={pool}
                  entities={entities}
                  onChange={(patch) => changeRow(row.id, patch)}
                  onRemove={() => {
                    const name = entities.find(entity => String(entity.id) === String(row.entityId))?.name || `${row.rarity}星获得`;
                    if (!window.confirm(`确定移除第 ${index + 1} 次获得（${name}）？这会清除该行填写的内容，核对并保存后才会更新存档。`)) return;
                    changeState({ acquisitions: state.acquisitions.filter((item) => item.id !== row.id) });
                  }}
                  onMove={(direction) => moveRow(index, direction)}
                  first={index === 0 || state.acquisitions[index - 1]?.origin === 'history'}
                  last={index === state.acquisitions.length - 1}
                />
              ))}
              <div className="wb-input-actions">
                <button
                  type="button"
                  className="wb-button"
                  onClick={() =>
                    changeState({ acquisitions: [...state.acquisitions, createQuestionnaireAcquisition(6)] })
                  }
                >
                  添加一次六星获得
                </button>
                <button
                  type="button"
                  className="wb-button"
                  onClick={() =>
                    changeState({ acquisitions: [...state.acquisitions, createQuestionnaireAcquisition(5)] })
                  }
                >
                  添加一次五星获得
                </button>
              </div>
            </div>
            <details className="wb-input-question">
              <summary>还记得四星数量、开始时垫抽或覆盖范围？（选填）</summary>
              <div className="wb-input-extra">
                <CountQuestion
                  label="四星数量"
                  value={state.values.fourStarCount}
                  onChange={(value) => changeValue('fourStarCount', value)}
                />
                <CountQuestion
                  label="开始记录前已经垫了多少抽？"
                  value={state.values.initialPity}
                  onChange={(value) => changeValue('initialPity', value)}
                />
                <label>
                  汇总对应哪种抽取方式？
                  <select
                    className="wb-input"
                    value={state.values.drawMethod}
                    onChange={(event) => changeValue('drawMethod', event.target.value)}
                  >
                    {methodOptions}
                  </select>
                </label>
                <label>
                  这些数量覆盖什么范围？
                  <select
                    className="wb-input"
                    value={state.values.coverageMode}
                    onChange={(event) => changeValue('coverageMode', event.target.value)}
                  >
                    <option value="pool">这个卡池的已知总汇</option>
                    <option value="range">我知道开始和结束日期</option>
                  </select>
                </label>
                {state.values.coverageMode === 'range' && (
                  <div className="wb-input-pair">
                    <label>
                      开始日期
                      <input
                        className="wb-input"
                        type="date"
                        value={state.values.rangeStart || ''}
                        onChange={(event) => changeValue('rangeStart', event.target.value)}
                      />
                    </label>
                    <label>
                      结束日期
                      <input
                        className="wb-input"
                        type="date"
                        value={state.values.rangeEnd || ''}
                        onChange={(event) => changeValue('rangeEnd', event.target.value)}
                      />
                    </label>
                  </div>
                )}
                <label>
                  这些内容是否覆盖完整记录？
                  <select
                    className="wb-input"
                    value={typeof state.values.complete === 'boolean' ? String(state.values.complete) : ''}
                    onChange={(event) =>
                      changeValue('complete', event.target.value === '' ? undefined : event.target.value === 'true')
                    }
                  >
                    <option value="">不确定</option>
                    <option value="true">是，数量与高星序列都完整</option>
                    <option value="false">否，只记得一部分</option>
                  </select>
                </label>
              </div>
            </details>
            <p className="wb-input-help">跳过会保留原记录，本次核对页面会提示哪些卡池没有填写。</p>
          </section>
        )}
        {phase === 'review' && review && (
          <section className="wb-input-review">
            <h3>核对后加入本次草稿</h3>
            <p>
              新增 {review.entries.length} 条卡池台账，修改 {review.historyChanges.length} 条官方明细，修改{' '}
              {review.supplementChanges.length} 条已保存补录。
            </p>
            {selectedPools.map((item) => {
              const value = states[poolIdOf(item)];
              return (
                <article key={value.poolId}>
                  <strong>{item.name || value.poolId}</strong>
                  <p>
                    {value.skipped
                      ? '已跳过，不更新'
                      : `总抽数：${knownCount(value.values.totalPulls)} · 五星：${knownCount(value.values.fiveStarCount)} · 六星：${knownCount(value.values.sixStarCount)} · 垫抽：${knownCount(value.values.pity)}`}
                  </p>
                  {!value.skipped && (
                    <small>
                      官方高星行 {value.acquisitions.filter((row) => row.origin === 'history').length} 条，补录高星行{' '}
                      {value.acquisitions.filter((row) => row.origin !== 'history').length} 条；日期未知的行保持未知。
                    </small>
                  )}
                </article>
              );
            })}
            {review.warnings.map((warning, index) => (
              <p key={index} className="wb-notice wb-notice--warning">
                {warning}
              </p>
            ))}
            <p className="wb-input-help">汇总包含官方明细，不会将同一份数量再相加。</p>
          </section>
        )}
        {phase === 'applied' && (
          <section className="wb-input-review">
            <h3>已加入本次草稿</h3>
            <p role="status">问卷内容已经交给工作台草稿，尚未保存。返回工作台后继续核对，再统一确认保存。</p>
          </section>
        )}
      </div>
    </WorkbenchDialog>
  );
}
