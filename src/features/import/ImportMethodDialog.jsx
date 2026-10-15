import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownToLine, ArrowUpRight, FileUp, PencilLine, X } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import WorkbenchBetaBadge from './WorkbenchBetaBadge.jsx';
import './importMethodDialog.css';

// Keep this entry dialog independent of the workbench and import implementations.
export default function ImportMethodDialog({ onClose, onOfficial, onFile, onManual }) {
  const { locale } = useI18n();
  const en = locale === 'en-US';
  const dialogRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  const choices = [
    { key: 'official', Icon: ArrowDownToLine, label: en ? 'Sync official records' : '同步官方记录',
      description: en ? 'Fetch your records through the official account flow.' : '通过官方账号流程获取抽卡记录。', onClick: onOfficial },
    { key: 'file', Icon: FileUp, label: en ? 'Import a file' : '导入文件',
      description: en ? 'Preview and confirm records from an exported file.' : '上传已有记录文件，预览确认后导入。', onClick: onFile },
    { key: 'manual', Icon: PencilLine, label: en ? 'Enter records manually' : '手动补录',
      description: en ? 'Add known results and correct your records in the workbench.' : '在数据工作台补充已知结果、校对已有记录。', onClick: onManual },
  ];

  return createPortal(
    <dialog ref={dialogRef} className="import-method-dialog" aria-labelledby={titleId}
      aria-describedby={descriptionId} aria-modal="true"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header className="import-method-header">
        <div>
          <span className="import-method-eyebrow">ENDFIELD // RECORDS</span>
          <h2 id={titleId}>{en ? 'Choose an import method' : '选择导入方式'}</h2>
          <p id={descriptionId}>{en ? 'Bring your records together, your way.' : '选择适合你的方式，整理完整抽卡记录。'}</p>
        </div>
        <button type="button" className="import-method-close" aria-label={en ? 'Close dialog' : '关闭弹窗'} onClick={onClose}><X size={21} /></button>
      </header>
      <div className="import-method-choices">
        {choices.map((choice) => (
          <button key={choice.key} type="button" className="import-method-choice" onClick={choice.onClick}>
            <span className="import-method-icon"><choice.Icon size={21} aria-hidden="true" /></span>
            <span className="import-method-copy"><strong className="flex flex-wrap items-center gap-2">{choice.label}{choice.key === 'manual' && <WorkbenchBetaBadge />}</strong><span>{choice.description}</span></span>
            <ArrowUpRight size={17} aria-hidden="true" />
          </button>
        ))}
      </div>
    </dialog>, document.body
  );
}
