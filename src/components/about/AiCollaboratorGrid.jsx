import React from 'react';
import { useI18n } from '../../i18n/index.js';

const AI_COLLABORATORS = Object.freeze([
  {
    id: 'claude',
    name: 'Claude',
    vendor: 'ANTHROPIC',
    version: 'OPUS 5',
    tone: 'border-orange-300 text-orange-600 dark:border-orange-800 dark:text-orange-400',
    iconFrameClass: 'bg-[#D97757] text-white',
    iconKind: 'claude',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    vendor: 'GOOGLE',
    version: '3.7 FLASH',
    tone: 'border-blue-300 text-blue-600 dark:border-blue-800 dark:text-blue-400',
    iconSrc: 'https://www.gstatic.com/lamda/images/gemini_sparkle_aurora_33f86dc0c0257da337c63.svg',
    iconSource: 'https://gemini.google.com',
    iconFrameClass: 'bg-white dark:bg-zinc-950',
    iconClass: 'h-6 w-6 object-contain',
  },
  {
    id: 'codex',
    name: 'Codex',
    vendor: 'OPENAI',
    version: 'GPT-5.6 SOL',
    tone: 'border-zinc-400 text-zinc-700 dark:border-zinc-600 dark:text-zinc-300',
    iconSrc: 'https://openai.gallerycdn.vsassets.io/extensions/openai/chatgpt/26.5818.61809/1787550472726/Microsoft.VisualStudio.Services.Icons.Default',
    iconSource: 'https://marketplace.visualstudio.com/items?itemName=openai.chatgpt',
    iconFrameClass: 'bg-black dark:bg-white',
    iconClass: 'h-full w-full object-cover',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    vendor: 'DEEPSEEK',
    version: 'V4 PRO',
    tone: 'border-cyan-300 text-cyan-700 dark:border-cyan-800 dark:text-cyan-300',
    iconSrc: 'https://api-docs.deepseek.com/img/favicon.svg',
    iconSource: 'https://api-docs.deepseek.com',
    iconFrameClass: 'bg-[#eef1ff] dark:bg-[#141b3a]',
    iconClass: 'h-6 w-7 object-contain',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    vendor: 'MOONSHOT AI',
    version: 'K3',
    tone: 'border-violet-300 text-violet-700 dark:border-violet-800 dark:text-violet-300',
    iconSrc: 'https://statics.kimi.ai/moonshot-ai/assets/static/kimi-icon.ByIGCGon.webp',
    iconSource: 'https://www.moonshot.cn',
    iconFrameClass: 'bg-black dark:bg-white',
    iconClass: 'h-full w-full object-cover',
  },
]);

function ClaudeMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="currentColor"
      fillRule="evenodd"
      role="img"
      aria-label="Claude official icon"
    >
      <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" />
    </svg>
  );
}

export default function AiCollaboratorGrid({ mobile = false }) {
  const { t } = useI18n();

  return (
    <div className={mobile
      ? "flex flex-nowrap gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]"
      : "grid grid-cols-5 gap-3"}
    >
      {AI_COLLABORATORS.map((item) => (
        <article
          key={item.id}
          className={`min-w-0 border bg-zinc-50 p-3 transition-colors dark:bg-zinc-900 ${item.tone} ${mobile ? 'w-[12.5rem] shrink-0 rounded-[1rem]' : ''}`}
        >
          <div className="flex items-start gap-2.5">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden ${mobile ? 'rounded-[0.8rem]' : ''} ${item.iconFrameClass}`}>
              {item.iconKind === 'claude' ? (
                <ClaudeMark />
              ) : (
                <img
                  src={item.iconSrc}
                  alt={`${item.name} official icon`}
                  className={item.iconClass}
                  loading="lazy"
                  decoding="async"
                  data-brand-source={item.iconSource}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <h5 className="truncate text-xs font-bold text-zinc-800 dark:text-zinc-200">{item.name}</h5>
                <span className="whitespace-nowrap bg-zinc-200 px-1.5 py-0.5 font-mono text-[8px] font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {item.version}
                </span>
              </div>
              <p className="mt-1 font-mono text-[8px] text-zinc-500">{item.vendor}</p>
            </div>
          </div>
          <p className={`${mobile ? 'mt-2 text-[9px]' : 'mt-3 text-[10px]'} leading-relaxed text-zinc-500`}>
            {t(`about.ai.${item.id}${mobile ? 'Focus' : 'Summary'}`)}
          </p>
        </article>
      ))}
    </div>
  );
}
