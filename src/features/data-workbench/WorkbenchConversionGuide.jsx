import React, { useMemo, useState } from 'react';
import { Copy, Download, Upload } from 'lucide-react';
import WorkbenchDialog from './WorkbenchDialog.jsx';
import { buildImportConvertPrompt, buildWorkbenchConversionTemplate } from './importConvertPrompt.js';
import { parseConvertedWorkbenchJson, poolIdOf } from './workbenchInputAdapters.js';
import './workbench-inputs.css';

export default function WorkbenchConversionGuide({
  scope,
  pools = [],
  entities = [],
  selectedPoolId,
  onApply,
  onClose,
}) {
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const conversion = useMemo(() => {
    try {
      const options = { scope, pools, entities, selectedPoolId };
      return { prompt: buildImportConvertPrompt(options), template: buildWorkbenchConversionTemplate(options) };
    } catch (failure) {
      return { error: failure.message };
    }
  }, [scope, pools, entities, selectedPoolId]);

  function updateContent(value) {
    setContent(value);
    setPreview(null);
    setError('');
    setNotice('');
  }
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(conversion.prompt);
      setNotice('转换提示词已复制，请连同原始材料交给你选择的工具。');
      setError('');
    } catch {
      setError('浏览器未允许复制，请展开提示词后手动复制。');
    }
  }
  function downloadTemplate() {
    let url;
    try {
      url = URL.createObjectURL(
        new Blob([JSON.stringify(conversion.template, null, 2)], { type: 'application/json;charset=utf-8' })
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'endfield-workbench-conversion-template.json';
      link.click();
      setNotice('已下载当前账号区服的转换模板。');
      setError('');
    } catch {
      setError('模板未能下载，请展开空模板后复制保存为 JSON 文件。');
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }
  async function readFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      updateContent(await file.text());
      setNotice(`已读取 ${file.name}，请检查转换内容。`);
    } catch {
      setError('文件无法读取，请使用 UTF-8 JSON 文件或直接粘贴内容。');
    } finally {
      setBusy(false);
    }
  }
  function checkContent() {
    setError('');
    setNotice('');
    try {
      setPreview(parseConvertedWorkbenchJson(content, { scope, pools, entities }));
    } catch (failure) {
      setPreview(null);
      setError(failure.message);
    }
  }
  async function apply() {
    if (!preview || busy) return;
    setBusy(true);
    setError('');
    try {
      await onApply(preview);
      setApplied(true);
    } catch (failure) {
      setError(failure.message || '未能加入草稿，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkbenchDialog
      title="转换其他格式的记录"
      description="生成当前目录的模板，将转换后的 JSON 检查并加入本次草稿。"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <span className="wb-dialog-draft-note">只加入草稿，之后在工作台核对并保存。</span>
          {applied ? (
            <button type="button" className="wb-button wb-button--primary" onClick={onClose}>
              返回工作台核对
            </button>
          ) : (
            <>
              <button type="button" className="wb-button" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="wb-button wb-button--primary"
                disabled={!preview || busy}
                onClick={apply}
              >
                {busy ? '正在处理…' : '加入本次草稿'}
              </button>
            </>
          )}
        </>
      }
    >
      <div className="wb-input-flow">
        {(error || conversion.error) && (
          <p role="alert" className="wb-notice wb-notice--error">
            {error || conversion.error}
          </p>
        )}
        {notice && (
          <p role="status" className="wb-notice wb-notice--success">
            {notice}
          </p>
        )}
        {applied ? (
          <section className="wb-input-review">
            <h3>转换内容已加入本次草稿</h3>
            <p role="status">
              已交给工作台 {preview.entries.length}{' '}
              条台账，尚未保存。返回工作台核对卡池、抽数和获得顺序后，再统一确认保存。
            </p>
          </section>
        ) : (
          <>
            <section className="wb-input-question">
              <h3>1. 复制提示词或下载模板</h3>
              <p>将表格、截图文字或你记得的内容交给转换工具。使用 DeepSeek 时可开启「深度思考」，再要求输出纯 JSON。</p>
              <p className="wb-input-help">
                模板包含当前游戏账号区服、真实卡池 ID 和角色武器目录。未知日期、数量和来源标记都应保留，不要补造记录。
              </p>
              <div className="wb-input-actions">
                <button
                  type="button"
                  className="wb-button"
                  disabled={Boolean(conversion.error) || busy}
                  onClick={copyPrompt}
                >
                  <Copy size={15} /> 复制转换提示词
                </button>
                <button
                  type="button"
                  className="wb-button"
                  disabled={Boolean(conversion.error) || busy}
                  onClick={downloadTemplate}
                >
                  <Download size={15} /> 下载 JSON 模板
                </button>
              </div>
              {!conversion.error && (
                <>
                  <details className="wb-input-details">
                    <summary>展开提示词，手动复制</summary>
                    <textarea
                      className="wb-input wb-input-code"
                      readOnly
                      rows="9"
                      aria-label="转换提示词"
                      value={conversion.prompt}
                    />
                  </details>
                  <details className="wb-input-details">
                    <summary>展开空模板</summary>
                    <textarea
                      className="wb-input wb-input-code"
                      readOnly
                      rows="8"
                      aria-label="JSON 空模板"
                      value={JSON.stringify(conversion.template, null, 2)}
                    />
                  </details>
                </>
              )}
            </section>
            <section className="wb-input-question">
              <h3>2. 导入转换后的 JSON</h3>
              <p className="wb-input-help">日期未知的记录放入台账。已知日期明细也会转换为手动声明的获得信息。</p>
              <label className="wb-button wb-input-upload">
                <Upload size={15} /> 选择转换后的 JSON 文件
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={busy || Boolean(conversion.error)}
                  onChange={readFile}
                  aria-label="选择转换后的 JSON 文件"
                />
              </label>
              <label className="wb-input-json-label">
                或粘贴转换后的 JSON
                <textarea
                  className="wb-input wb-input-code"
                  rows="8"
                  value={content}
                  disabled={busy}
                  placeholder="粘贴纯 JSON，不要包含 Markdown 代码围栏"
                  onChange={(event) => updateContent(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="wb-button"
                disabled={!content.trim() || busy || Boolean(conversion.error)}
                onClick={checkContent}
              >
                检查转换内容
              </button>
            </section>
            {preview && (
              <section className="wb-input-review">
                <h3>3. 核对转换结果</h3>
                <p>
                  共 {preview.entries.length} 条卡池台账，账号 {scope.gameUid} · 区服 {scope.serverScope}。
                </p>
                {preview.entries.map((entry) => (
                  <article key={entry.entryId}>
                    <strong>{pools.find((pool) => poolIdOf(pool) === entry.poolId)?.name || entry.poolId}</strong>
                    <p>
                      总抽数：{entry.values.totalPulls ?? '未知'} · 五星：{entry.values.fiveStarCount ?? '未知'} ·
                      六星：{entry.values.sixStarCount ?? '未知'} · 高星获得 {entry.values.acquisitions.length} 行
                    </p>
                    <small>
                      来源：{entry.source === 'file' ? '文件转换' : '手动补充'} · 日期未知{' '}
                      {entry.values.acquisitions.filter((row) => row.timePrecision === 'unknown').length} 行
                    </small>
                  </article>
                ))}
                {preview.warnings.map((warning, index) => (
                  <p key={index} className="wb-notice wb-notice--warning">
                    {warning}
                  </p>
                ))}
                <p className="wb-input-help">加入后在工作台展示，仍可修改草稿。</p>
              </section>
            )}
          </>
        )}
      </div>
    </WorkbenchDialog>
  );
}
