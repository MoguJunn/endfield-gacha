import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Plus, ScanLine, X } from 'lucide-react';
import WorkbenchDialog from './WorkbenchDialog.jsx';
import { buildScreenshotEntries, createManualRow, createManualSegment, applyNormalCountMeaning } from './xhh/semantics.js';
import WorkbenchCatalogSelect, { WorkbenchEntitySelect, WorkbenchPoolSelect } from './WorkbenchCatalogSelect.jsx';
import { SCREENSHOT_TYPES, screenshotPoolType, entitiesForWorkbenchPool } from './workbenchCatalog.js';
import './xhh/screenshotImport.css';

const COUNT_FIELDS = { totalPulls: '普通抽取总数', fiveStarCount: '普通五星总数', sixStarCount: '普通六星总数', pity: '当前垫抽', initialPity: '入池时继承垫抽' };
const numberInput = (value, onChange, label, min = 0) => <input className="wb-input" aria-label={label} type="number" min={min} step="1" inputMode="numeric" value={value ?? ''} placeholder="未知" onChange={e => onChange(e.target.value)} />;

function CropPreview({ imageUrl, rect }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !imageUrl || !rect) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const scale = Math.min(1.5, 500 / rect.width);
      canvas.width = Math.max(1, Math.round(rect.width * scale));
      canvas.height = Math.max(1, Math.round(rect.height * scale));
      canvas.getContext('2d').drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    };
    image.src = imageUrl;
    return () => { cancelled = true; };
  }, [imageUrl, rect]);
  if (!rect) return null;
  return <figure className="xhh-crop"><canvas ref={ref} aria-label="当前记录原图裁剪" /><figcaption>原图裁剪 · x {Math.round(rect.x)} / y {Math.round(rect.y)} / {Math.round(rect.width)} × {Math.round(rect.height)}</figcaption></figure>;
}

export default function WorkbenchScreenshotImport({ scope, pools = [], entities = [], selectedPoolId,
  existingHistory = [], existingEntries = [], onApply, onClose }) {
  const [file, setFile] = useState(null);
  const [imageUrl, setImageUrl] = useState('');
  const [chosenType, setChosenType] = useState(() => {
    const type = screenshotPoolType(pools.find(pool => pool.id === selectedPoolId));
    return SCREENSHOT_TYPES.some(item => item.id === type) ? type : 'limited';
  });
  const [normalMeaning, setNormalMeaning] = useState('unknown');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [activeRect, setActiveRect] = useState(null);
  const [showOriginal, setShowOriginal] = useState(true);
  const clientRef = useRef(null);
  const abortRef = useRef(null);
  const jobRef = useRef(0);

  useEffect(() => () => { jobRef.current += 1; abortRef.current?.abort(); clientRef.current?.dispose(); }, []);
  useEffect(() => {
    if (!file) { setImageUrl(''); return undefined; }
    const url = URL.createObjectURL(file); setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const cancel = () => { jobRef.current += 1; abortRef.current?.abort(); clientRef.current?.cancel(); setBusy(false); setProgress({ message: '已取消识别，可以重新开始' }); };
  const close = () => { cancel(); onClose(); };
  const confirmResultReset = action => !result?.segments.length || window.confirm(`${action}会清除当前 ${result.segments.length} 个池段的识别结果及人工修改，确定继续？`);
  const chooseFile = selected => {
    if (!selected) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type)) { setError('请选择 PNG、JPG 或 WebP 截图'); return; }
    if (selected.size > 40 * 1024 * 1024) { setError('截图超过 40 MB，请先裁剪或压缩'); return; }
    if (!confirmResultReset('更换截图')) return;
    cancel(); setFile(selected); setResult(null); setError(''); setActiveRect(null); setProgress(null);
  };
  const recognize = async () => {
    if (!file) return;
    if (!confirmResultReset('重新识别')) return;
    const job = ++jobRef.current;
    const controller = new AbortController(); abortRef.current = controller;
    setBusy(true); setError(''); setResult(null); setActiveRect(null);
    setProgress({ message: '准备本地识别', current: 0, total: 1 });
    try {
      const [{ createOcrClient }, { analyzeScreenshot }, { addVisualCandidates }] = await Promise.all([
        import('./xhh/ocrClient.js'), import('./xhh/semantics.js'), import('./xhh/visualCandidates.js'),
      ]);
      if (job !== jobRef.current) return;
      clientRef.current ||= createOcrClient();
      const onProgress = next => { if (job === jobRef.current) setProgress(next); };
      const raw = await clientRef.current.recognize(file, { signal: controller.signal, onProgress });
      let parsed = analyzeScreenshot({ ...raw, pools, entities, selectedType: chosenType });
      if (raw.diagnostics.failedTiles.length) parsed.warnings.push(`${raw.diagnostics.failedTiles.length} 个分块识别失败，请检查遗漏并补充。`);
      parsed = await addVisualCandidates(parsed, file, { pools, entities, signal: controller.signal, onProgress });
      if (job !== jobRef.current) return;
      setResult({ ...parsed, segments: applyNormalCountMeaning(parsed.segments, normalMeaning) }); setActiveRect(parsed.segments[0]?.sourceBox || null);
      setProgress({ message: `识别完成：${parsed.segments.length} 个池段、${parsed.segments.reduce((n, s) => n + s.rows.length, 0)} 条待核对记录` });
    } catch (e) { if (job === jobRef.current && e.name !== 'AbortError') setError(e.message || '截图识别失败，请重新选择截图'); }
    finally { if (job === jobRef.current) setBusy(false); }
  };
  const patchSegment = (id, patch) => setResult(previous => ({ ...previous, segments: previous.segments.map(s => s.id === id ? { ...s, ...patch } : s) }));
  const patchRow = (segmentId, rowId, patch) => setResult(previous => ({ ...previous, segments: previous.segments.map(s => s.id !== segmentId ? s :
    { ...s, rows: s.rows.map(r => r.id === rowId ? { ...r, ...patch, ...(patch.confirmed === undefined ? { confirmed: false } : {}) } : r) }) }));
  const apply = () => {
    const draft = buildScreenshotEntries(result?.segments || [], { pools, entities, scope, existingHistory, existingEntries });
    if (draft.errors.length) { setError(draft.errors.join('；')); return; }
    onApply({ entries: draft.entries, warnings: [...(result?.warnings || []), ...draft.warnings] });
  };
  const footer = <><span className="xhh-footer-hint">原图只在本机识别，确认后加入待审草稿</span><button type="button" className="wb-button" onClick={close}>取消</button>
    <button type="button" className="wb-button wb-button--primary" disabled={busy || !result} onClick={apply}>加入工作台草稿</button></>;

  return <WorkbenchDialog title="小黑盒截图识别" description="识别卡池、高星与抽数，再对照原图人工修正。截图可能只是某个时点或局部，未知信息请留空。" onClose={close} footer={footer}>
    <div className="xhh-import">
      <section className="xhh-upload" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) chooseFile(e.dataTransfer.files[0]); }}>
        <label className="xhh-file-label"><ImagePlus size={22} /><span>{file ? file.name : '选择或拖入小黑盒原始截图'}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择小黑盒截图" disabled={busy} onChange={e => { chooseFile(e.target.files[0]); e.target.value = ''; }} /></label>
        <label className="xhh-pool-choice"><span>截图的卡池类型</span><WorkbenchCatalogSelect label="截图的卡池类型" value={chosenType} disabled={busy}
          groups={[{ id: 'characters', label: '角色寻访', options: SCREENSHOT_TYPES.filter(type => type.id !== 'weapon').map(type => ({ value: type.id, label: type.label })) },
            { id: 'weapons', label: '武器申领', options: [{ value: 'weapon', label: '武器池' }] }]}
          onChange={type => { const next = type || 'limited'; if (next === chosenType || !confirmResultReset('切换卡池类型')) return; setChosenType(next); setResult(null); }} /></label>
        <button type="button" className="wb-button wb-button--primary" disabled={!file || busy} onClick={recognize}><ScanLine size={17} />{result ? '重新识别' : '开始识别'}</button>
        {busy && <button type="button" className="wb-button" onClick={cancel}><X size={16} />停止识别</button>}
      </section>
      {progress && <div className="xhh-progress" role="status" aria-live="polite"><span>{progress.message}</span>{busy && <progress aria-label="截图识别进度" max={progress.total || 1} value={progress.current || 0} />}</div>}
      {error && <div className="xhh-error" role="alert">{error}</div>}
      {result?.warnings.length > 0 && <ul className="xhh-warnings">{result.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
      {file && <div className="xhh-review-layout">
        <aside className="xhh-preview"><div className="xhh-preview-heading"><strong>原图对照</strong><button type="button" className="wb-button" onClick={() => setShowOriginal(!showOriginal)}>{showOriginal ? '收起整图' : '查看整图'}</button></div>
          <CropPreview imageUrl={imageUrl} rect={activeRect} />
          {showOriginal && imageUrl && <div className="xhh-original"><img src={imageUrl} alt="待识别的小黑盒原始截图" /></div>}
        </aside>
        <div className="xhh-corrections">{!result && <p className="xhh-empty">选择卡池类型后开始识别，具体卡池在识别结果中核对。</p>}
          {result && <div className="xhh-global-meaning"><label><span>所有普通横条“N抽”的含义</span><select className="wb-input" aria-label="所有普通横条数字含义" value={normalMeaning} onChange={e => {
            setNormalMeaning(e.target.value); setResult(previous => ({ ...previous, segments: applyNormalCountMeaning(previous.segments, e.target.value) }));
          }}><option value="unknown">请选择数字含义</option><option value="interval">距上次六星的间隔（可跨池）</option><option value="index">本池普通抽取中的位置</option></select></label><small>一次应用于本次截图的所有普通横条。免费十连的位置与武器角标分别核对。</small></div>}
          {result?.segments.map((segment, segmentIndex) => {
            const pool = pools.find(p => String(p.id) === String(segment.poolId));
            const eligible = entitiesForWorkbenchPool(pool, entities).filter(e => [5, 6].includes(Number(e.rarity)));
            return <section key={segment.id} className="xhh-segment">
              <div className="xhh-segment-heading"><strong>池段 {segmentIndex + 1} · {segment.poolName}</strong>
                {segment.sourceBox && <button type="button" className="wb-button" onClick={() => setActiveRect(segment.sourceBox)}>查看池段裁图</button>}
                <button type="button" className="wb-button" onClick={() => {
                  if (!window.confirm(`确定移除“${segment.poolName}”池段？这会移除该池段的 ${segment.rows.length} 条获得记录和已填写的数量。`)) return;
                  setResult(previous => ({ ...previous, segments: previous.segments.filter(s => s.id !== segment.id) }));
                  setActiveRect(null);
                }}>移除此池段</button></div>
              <div className="xhh-fields"><label><span>所属卡池 <em>{segment.poolGuess ? '自动猜测，可修改' : '待人工补充'}</em></span><WorkbenchPoolSelect label={`池段 ${segmentIndex + 1} 所属卡池`} pools={pools.filter(p => screenshotPoolType(p) === chosenType)} value={segment.poolId} onChange={poolId => {
                const allowed = new Set(entitiesForWorkbenchPool(pools.find(p => p.id === poolId), entities).map(entity => String(entity.id)));
                patchSegment(segment.id, { poolId, poolName: pools.find(p => p.id === poolId)?.name || '待选择卡池', poolConfirmed: false, countsConfirmed: false, rows: segment.rows.map(r => ({ ...r, entityId: allowed.has(r.entityId) ? r.entityId : '', candidates: r.candidates.filter(candidate => allowed.has(candidate.entityId)), entityConfirmed: false, confirmed: false })) });
              }} /></label></div>
              {!eligible.length && <p className="xhh-error">本池的高星可获得名单尚未就绪，请先核对卡池资料。</p>}
              <div className="xhh-counts">{Object.entries(COUNT_FIELDS).map(([key, label]) => <label key={key}><span>{label}</span>{numberInput(segment[key], value => patchSegment(segment.id, { [key]: value, countsConfirmed: false }), `${segment.poolName} ${label}`)}</label>)}</div>
              <p className="xhh-hint">总数与五星、六星总数均按普通抽取填写。免费十连、赠送及情报书单独标记；角标只说明批次内数量，不说明抽取顺序。</p>
              <fieldset className="xhh-checks"><legend>池段核对</legend>
                <label className="xhh-check"><input type="checkbox" checked={segment.poolConfirmed} onChange={e => patchSegment(segment.id, { poolConfirmed: e.target.checked })} /><span>所属卡池正确<small>必选，确认这段记录来自上方卡池</small></span></label>
                <label className="xhh-check"><input type="checkbox" checked={segment.complete} onChange={e => patchSegment(segment.id, { complete: e.target.checked, countsConfirmed: false })} /><span>覆盖本池完整存档<small>选填，局部截图或尚未补齐五星时保持未选</small></span></label>
                <label className="xhh-check"><input type="checkbox" checked={segment.countsConfirmed} onChange={e => patchSegment(segment.id, { countsConfirmed: e.target.checked })} /><span>数量与获得方式已核对<small>必选，已区分普通抽取、免费十连与赠送</small></span></label></fieldset>
              <div className="xhh-rows">{segment.rows.map((row, rowIndex) => <article key={row.id} className={`xhh-row ${row.confirmed ? 'xhh-row--confirmed' : 'xhh-row--review'} ${!row.included ? 'xhh-row--excluded' : ''}`}>
                <div className="xhh-row-heading"><label className="xhh-check"><input type="checkbox" checked={row.included} onChange={e => {
                  const included = e.target.checked;
                  const name = entities.find(entity => String(entity.id) === String(row.entityId))?.name || `${row.rarity}星获得`;
                  if (!included && !window.confirm(`确定将“${segment.poolName}”的第 ${rowIndex + 1} 条记录（${name}）排除出本次导入？该行内容会保留，可以重新勾选恢复；之后需要重新核对池段数量。`)) return;
                  patchSegment(segment.id, { countsConfirmed: false, rows: segment.rows.map(item => item.id === row.id ? { ...item, included, confirmed: false } : item) });
                }} /><strong>记录 {rowIndex + 1}{row.batchIndex ? ` · 第${row.batchIndex}十连` : ''}</strong></label>
                  <span className="xhh-tag">{row.confirmed ? '已核对' : !row.entityId ? '身份未知，需补充' : row.confidence < .8 || row.visualStatus === 'uncertain' ? '低置信，需修正' : '自动猜测，待核对'}</span>
                  {row.sourceBox && <button type="button" className="wb-button" onClick={() => setActiveRect(row.sourceBox)}>查看裁图</button>}</div>
                {row.included && <><p className="xhh-evidence">{row.evidenceText}{Number.isFinite(row.confidence) ? ` · 文字置信度 ${Math.round(row.confidence * 100)}%` : ''}</p>
                  {row.candidates.length > 0 && <div className="xhh-candidates"><span>候选前三 · 匹配分：</span>{row.candidates.filter(c => eligible.some(entity => String(entity.id) === c.entityId)).slice(0, 3).map(c => <button key={c.entityId} type="button" className="wb-button" onClick={() => patchRow(segment.id, row.id, { entityId: c.entityId, rarity: c.rarity, entityConfirmed: true })}>{c.name} · {Math.round(c.score * 100)}</button>)}</div>}
                  <div className="xhh-fields"><label><span>角色 / 武器</span><WorkbenchEntitySelect label={`记录 ${rowIndex + 1} 角色 / 武器`} pool={pool} entities={entities.filter(entity => [5, 6].includes(Number(entity.rarity)))} value={row.entityId} onChange={entityId => patchRow(segment.id, row.id, { entityId, rarity: Number(entities.find(item => String(item.id) === entityId)?.rarity) || 6, entityConfirmed: true })} /></label>
                    <label><span>获得方式</span><select className="wb-input" value={row.drawMethod} onChange={e => patchRow(segment.id, row.id, { drawMethod: e.target.value, pullMeaning: 'unknown' })}><option value="normal">普通抽取</option><option value="free">免费抽取</option><option value="gift">赠送</option><option value="info_book">情报书</option></select></label>
                    <label><span>横条抽数 / 数字证据</span>{numberInput(row.rawPullCount, value => patchRow(segment.id, row.id, { rawPullCount: value }), `记录${rowIndex + 1} 横条抽数`, 1)}</label>
                    {row.drawMethod === 'normal' && row.origin === 'bar' ? <p className="xhh-hint">普通横条统一使用：{normalMeaning === 'interval' ? '六星出货间隔' : normalMeaning === 'index' ? '本池普通抽取位置' : '请在上方选择'}</p> : row.origin !== 'grid' && <label><span>{row.drawMethod === 'free' ? '免费十连数字含义' : '本条数字含义'}</span><select className="wb-input" value={row.pullMeaning} onChange={e => patchRow(segment.id, row.id, { pullMeaning: e.target.value })}><option value="unknown">待确认</option><option value="index">此获得方式内的位置</option>{row.drawMethod === 'normal' && <option value="interval">六星间隔</option>}</select></label>}
                    <label><span>池内位置（确知时填写）</span>{numberInput(row.pullIndex, value => patchRow(segment.id, row.id, { pullIndex: value }), `记录${rowIndex + 1} 池内位置`, 1)}</label>
                    <label><span>间隔（确知时填写）</span>{numberInput(row.intervalPulls, value => patchRow(segment.id, row.id, { intervalPulls: value }), `记录${rowIndex + 1} 间隔`, 1)}</label>
                    <label><span>UP / 歪</span><select className="wb-input" value={String(row.isOffRate)} onChange={e => patchRow(segment.id, row.id, { isOffRate: e.target.value })}><option value="">未知</option><option value="false">UP / 未歪</option><option value="true">歪 / 非目标</option></select></label>
                    <label><span>时间精度</span><select className="wb-input" value={row.timePrecision} onChange={e => patchRow(segment.id, row.id, { timePrecision: e.target.value, timestamp: '' })}><option value="unknown">未知时间</option><option value="day">只知道日期</option><option value="second">确知到秒</option></select></label>
                    {row.timePrecision !== 'unknown' && <label><span>获得时间</span><input className="wb-input" type={row.timePrecision === 'day' ? 'date' : 'datetime-local'} step="1" value={row.timestamp || ''} onChange={e => patchRow(segment.id, row.id, { timestamp: e.target.value })} /></label>}
                  </div>
                  <label className="xhh-check"><input type="checkbox" checked={row.confirmed} disabled={!row.entityId} onChange={e => patchRow(segment.id, row.id, { confirmed: e.target.checked, entityConfirmed: e.target.checked })} />我已对照裁图确认身份、抽数含义与获得方式</label></>}
              </article>)}</div>
              {segment.fiveStarHints?.length > 0 && !segment.fiveStarHintsReviewed && <div className="xhh-five-hint" role="status"><strong>横条下方检测到 {segment.fiveStarHints.length} 个头像，可能还有五星获得。</strong><p>请对照裁图确认是否继续补充，避免遗漏。</p><button type="button" className="wb-button" onClick={() => setActiveRect(segment.fiveStarHints[0].sourceBox)}>查看检测位置</button><button type="button" className="wb-button" onClick={() => {
                patchSegment(segment.id, { fiveStarHintsReviewed: true, countsConfirmed: false, rows: [...segment.rows, ...segment.fiveStarHints.map(hint => ({ ...createManualRow(), rarity: 5, entityId: hint.entityId || '', candidates: hint.candidates || [], sourceBox: hint.sourceBox, evidenceText: '横条下方头像 · 待核对五星', drawMethod: hint.drawMethod || 'normal' }))] });
              }}>继续添加五星</button><button type="button" className="wb-text-button" onClick={() => patchSegment(segment.id, { fiveStarHintsReviewed: true })}>已核对，无需补充</button></div>}
              <button type="button" className="wb-button" onClick={() => patchSegment(segment.id, { rows: [...segment.rows, createManualRow()], countsConfirmed: false })}><Plus size={16} />补充一条高星记录</button>
            </section>;
          })}
          {result && <button type="button" className="wb-button" onClick={() => setResult(previous => ({ ...previous, segments: [...previous.segments, { ...createManualSegment(), countMeaning: normalMeaning }] }))}><Plus size={16} />补充未识别的卡池段</button>}
        </div>
      </div>}
    </div>
  </WorkbenchDialog>;
}
