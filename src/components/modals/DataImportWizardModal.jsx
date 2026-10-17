import { createElement, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Database, ExternalLink, FileJson, Globe2, Table2, Upload, X } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';

function ImportSourceCard({
  icon,
  title,
  badge,
  description,
  note,
  accept,
  links = [],
  onImportFile,
  actionLabel,
  disabled = false,
  accent = 'yellow'
}) {
  const inputRef = useRef(null);
  const accentClasses = accent === 'cyan'
    ? 'border-cyan-400/70 text-cyan-600 dark:text-cyan-300 hover:border-cyan-400 hover:bg-cyan-500/10'
    : accent === 'violet'
      ? 'border-violet-400/70 text-violet-600 dark:text-violet-300 hover:border-violet-400 hover:bg-violet-500/10'
      : accent === 'emerald'
        ? 'border-emerald-400/70 text-emerald-600 dark:text-emerald-300 hover:border-emerald-400 hover:bg-emerald-500/10'
        : 'border-yellow-500/70 text-yellow-700 dark:text-endfield-yellow hover:border-yellow-500 hover:bg-yellow-500/10';

  return (
    <div className="border border-zinc-200 bg-white p-4 transition-colors dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start gap-4">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center border ${accentClasses}`}>
          {createElement(icon, { size: 20 })}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black text-slate-900 dark:text-zinc-100">{title}</h3>
            <span className="border border-zinc-300 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:border-zinc-700 dark:text-zinc-400">
              {badge}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-zinc-400">{description}</p>
          {note && (
            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-amber-700 dark:text-amber-400">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{note}</span>
            </p>
          )}
          {links.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 border border-zinc-200 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 transition-colors hover:border-yellow-500 hover:text-yellow-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-yellow-500 dark:hover:text-endfield-yellow"
                >
                  {link.label}
                  <ExternalLink size={10} />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={`mt-4 flex w-full items-center justify-center gap-2 border px-4 py-2.5 text-xs font-black uppercase tracking-wider transition-colors ${disabled
          ? 'cursor-not-allowed border-zinc-200 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500'
          : accentClasses}`}
      >
        <Upload size={14} />
        {actionLabel}
      </button>
      {!disabled && <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        onChange={onImportFile}
      />}
    </div>
  );
}

export default function DataImportWizardModal({
  isOpen,
  onClose,
  onImportFile
}) {
  const { t } = useI18n();

  if (!isOpen) {
    return null;
  }

  const modal = (
    <div className="app-modal-backdrop fixed inset-0 z-[95] bg-slate-950/70 backdrop-blur-md">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('import.fileWizard.title')}
        className="app-modal-panel w-full max-w-5xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#101012]"
        style={{ clipPath: 'polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 18px 100%, 0 calc(100% - 18px))' }}
      >
        <div className="absolute left-0 top-0 h-1 w-full bg-yellow-500" />
        <div className="app-modal-header flex items-center justify-between gap-3 border-b border-zinc-200 bg-slate-50 p-3 dark:border-zinc-800 dark:bg-zinc-950 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-black text-slate-900 dark:text-zinc-50 sm:text-xl">{t('import.fileWizard.title')}</h2>
            <p className="app-modal-header-description mt-1 text-xs text-slate-500 dark:text-zinc-400">{t('import.fileWizard.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="app-modal-icon-button border border-transparent text-slate-400 transition-colors hover:border-red-500 hover:bg-red-500/10 hover:text-red-500"
            aria-label={t('common.close')}
          >
            <X size={20} />
          </button>
        </div>

        <div className="grid gap-3 p-4 sm:gap-4 sm:p-6 md:grid-cols-2 xl:grid-cols-3">
          <ImportSourceCard
            icon={Database}
            title={t('import.fileWizard.internal.title')}
            badge="JSON"
            description={t('import.fileWizard.internal.desc')}
            accept=".json"
            onImportFile={onImportFile}
            actionLabel={t('import.fileWizard.chooseFile')}
          />
          <ImportSourceCard
            icon={Globe2}
            title={t('import.fileWizard.endgacha.title')}
            badge="JSON / TXT"
            description={t('import.fileWizard.endgacha.desc')}
            note={t('import.fileWizard.endgacha.note')}
            links={[
              { label: t('import.fileWizard.website'), href: 'https://endgacha.kwer.top/' }
            ]}
            accept=".json,.txt"
            onImportFile={onImportFile}
            actionLabel={t('import.fileWizard.chooseFile')}
            accent="emerald"
          />
          <ImportSourceCard
            icon={Table2}
            title={t('import.fileWizard.bhaoo.title')}
            badge="XLSX"
            description={t('import.fileWizard.bhaoo.desc')}
            note={t('import.fileWizard.bhaoo.note')}
            links={[
              { label: t('import.fileWizard.github'), href: 'https://github.com/bhaoo/endfield-gacha' },
              { label: t('import.fileWizard.release'), href: 'https://github.com/bhaoo/endfield-gacha/releases/latest' }
            ]}
            accept=".xlsx"
            onImportFile={onImportFile}
            actionLabel={t('import.fileWizard.chooseFile')}
            accent="cyan"
          />
          <ImportSourceCard
            icon={FileJson}
            title={t('import.fileWizard.helper.title')}
            badge="JSON / CSV"
            description={t('import.fileWizard.helper.desc')}
            links={[
              { label: t('import.fileWizard.github'), href: 'https://github.com/xccccya/EndfieldGachaHelper' },
              { label: t('import.fileWizard.release'), href: 'https://github.com/xccccya/EndfieldGachaHelper/releases/latest' }
            ]}
            accept=".endfieldgacha.json,.csv,.json"
            onImportFile={onImportFile}
            actionLabel={t('import.fileWizard.chooseFile')}
            accent="violet"
          />
          <ImportSourceCard
            icon={Table2}
            title={t('import.fileWizard.highStarSummary.title')}
            badge="XLSX"
            description={t('import.fileWizard.highStarSummary.desc')}
            note={t('import.fileWizard.highStarSummary.note')}
            accept=".xlsx"
            onImportFile={onImportFile}
            actionLabel={t('import.fileWizard.chooseFile')}
            accent="cyan"
          />
          <ImportSourceCard
            icon={Globe2}
            title={t('import.fileWizard.lcx.title')}
            badge="JSON / TXT"
            description={t('import.fileWizard.lcx.desc')}
            note={t('import.fileWizard.lcx.note')}
            links={[{ label: t('import.fileWizard.website'), href: 'https://wiki.lcx.cab/zmd/gacha_tracker.php' }]}
            onImportFile={onImportFile}
            actionLabel={t('import.fileWizard.chooseFile')}
            accent="emerald"
          />
        </div>

        <div className="border-t border-zinc-200 px-4 py-4 text-[11px] leading-5 text-slate-500 dark:border-zinc-800 dark:text-zinc-500 sm:px-6">
          {t('import.fileWizard.footer')}
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(modal, document.body);
  }

  return modal;
}
