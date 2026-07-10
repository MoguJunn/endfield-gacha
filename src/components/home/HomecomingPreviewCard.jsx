import React, { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';

const PREVIEW_SUMMARY_OPUS_URL = 'https://www.bilibili.com/opus/1223424273258905683';
const PREVIEW_REDEEM_CODE = 'ENDFIELDRENEW';

const INK_BARCODE_BARS = [
  { id: 'bar-1', widthPx: 3 },
  { id: 'bar-2', widthPx: 8 },
  { id: 'bar-3', widthPx: 2 },
  { id: 'bar-4', widthPx: 11 },
  { id: 'bar-5', widthPx: 3 },
  { id: 'bar-6', widthPx: 6 },
  { id: 'bar-7', widthPx: 2 },
];

const CARD_COPY_ZH = {
  programTitle: '相伴庆典资源速览',
  summaryLabel: '图中资源汇总',
  redeemCodeLabel: '奖励兑换码',
  redeemCodeReward: '贴纸「工业安全帽」＋ 折金票 ×71,600',
  copyCode: '复制兑换码',
  codeCopied: '已复制',
  resourceGroups: [
    {
      title: '前瞻特别节目当日奖励',
      items: [
        ['嵌晶玉', '×2,000'],
        ['折金票', '×12,000'],
        ['初级认知载体', '×10'],
        ['武器检查装置', '×10'],
        ['协议校准组', '×10'],
        ['存续的痕迹', '×2'],
      ],
    },
    {
      title: '特许寻访限时签到',
      items: [['两类特许寻访凭证', '×5 ＋ ×5']],
    },
    {
      title: '宏运连连乐',
      items: [['嵌晶玉', '至少 ×5,000']],
    },
    {
      title: '相伴贺礼',
      items: [
        ['嵌晶玉', '×3,000'],
        ['基础寻访凭证', '×5'],
        ['单手剑「巡望」', '×1'],
      ],
    },
  ],
  summaryButton: '查看官方前瞻总结',
  tagline: '向渊而行，新章将启',
};

const CARD_COPY_EN = {
  programTitle: 'Celebration Rewards',
  summaryLabel: 'Reward Overview',
  redeemCodeLabel: 'Redeem Code',
  redeemCodeReward: 'Industrial Safety Helmet sticker + T-Creds ×71,600',
  copyCode: 'Copy Code',
  codeCopied: 'Copied',
  resourceGroups: [
    {
      title: 'Preview Program Rewards',
      items: [
        ['Oroberyl', '×2,000'],
        ['T-Creds', '×12,000'],
        ['Basic Cognition Carrier', '×10'],
        ['Weapon Inspection Device', '×10'],
        ['Protocol Calibration Kit', '×10'],
        ['Trace of Existence', '×2'],
      ],
    },
    {
      title: 'Limited Check-in',
      items: [['Two permit types', '×5 + ×5']],
    },
    {
      title: 'Fortune Streak',
      items: [['Oroberyl', 'At least ×5,000']],
    },
    {
      title: 'Companionship Gifts',
      items: [
        ['Oroberyl', '×3,000'],
        ['Basic HH Permit', '×5'],
        ['One-handed Sword “Watch”', '×1'],
      ],
    },
  ],
  summaryButton: 'Official Preview Summary',
  tagline: 'Toward the abyss, a new chapter begins',
};

export default function HomecomingPreviewCard() {
  const { isEnglish } = useI18n();
  const copy = isEnglish ? CARD_COPY_EN : CARD_COPY_ZH;
  const serifDisplayStyle = {
    fontFamily: '"Harmony Sans App", "Noto Serif SC", "Source Han Serif SC", serif',
  };

  const [hasCopiedCode, setHasCopiedCode] = useState(false);

  const handleCopyCode = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(PREVIEW_REDEEM_CODE);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = PREVIEW_REDEEM_CODE;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }

      setHasCopiedCode(true);
      window.setTimeout(() => setHasCopiedCode(false), 1800);
    } catch {
      setHasCopiedCode(false);
    }
  };

  return (
    <section className="relative min-h-[300px] overflow-hidden border border-zinc-300 bg-[#f5f3ee] text-zinc-900 shadow-2xl dark:border-white/10">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background: [
              'radial-gradient(ellipse 44% 36% at 78% 2%, rgba(126,164,138,0.42), transparent 68%)',
              'radial-gradient(ellipse 26% 20% at 60% 16%, rgba(126,164,138,0.22), transparent 70%)',
              'radial-gradient(ellipse 42% 30% at 98% 34%, rgba(84,90,86,0.28), transparent 72%)',
              'linear-gradient(180deg, #f7f5f0 0%, #efede6 100%)',
            ].join(', '),
          }}
        />
        <div
          className="absolute inset-0 opacity-50"
          style={{
            background: [
              'linear-gradient(114deg, transparent 56%, rgba(64,62,58,0.16) 64%, transparent 78%)',
              'linear-gradient(78deg, transparent 28%, rgba(64,62,58,0.08) 35%, transparent 44%)',
            ].join(', '),
          }}
        />
        <svg
          className="absolute bottom-0 left-0 h-14 w-full md:h-20"
          viewBox="0 0 1200 120"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0,120 L0,92 C120,86 240,98 360,90 C500,80 560,96 680,92 C820,86 900,98 1020,92 C1100,88 1160,94 1200,90 L1200,120 Z"
            fill="#4a4a46"
            opacity="0.45"
          />
          <path
            d="M0,120 L0,74 C50,62 110,84 170,76 C250,66 290,42 350,50 C410,58 450,84 530,80 C610,76 650,54 716,46 C758,42 796,60 848,68 C916,78 976,54 1038,62 C1102,70 1158,84 1200,76 L1200,120 Z"
            fill="#111110"
            opacity="0.92"
          />
        </svg>
        <span className="absolute left-[36%] top-7 hidden h-1.5 w-1.5 bg-[#c8101a]/85 md:block" />
        <span className="absolute left-[33%] top-[58%] hidden h-1 w-1 bg-[#c8101a]/70 md:block" />
      </div>

      <div className="relative z-10 flex min-h-[300px] flex-col md:grid md:grid-cols-[minmax(170px,auto)_1fr]">
        <div className="flex flex-row items-start justify-between gap-4 border-b border-zinc-900/10 p-5 md:flex-col md:items-stretch md:border-b-0 md:border-r md:p-6">
          <div className="flex items-stretch gap-1.5">
            <div className="bg-zinc-950 px-2 py-1.5 text-white">
              <p className="text-[10px] font-black leading-tight tracking-[0.1em]">
                明日方舟
                <br />
                终末地
              </p>
              <p className="mt-1 text-[6px] uppercase tracking-[0.16em] text-white/65">Arknights Endfield</p>
            </div>
            <div className="flex flex-col items-center justify-center bg-zinc-950 px-2 py-1.5 text-white">
              <p className="text-lg font-black leading-none">26</p>
              <p className="mt-1 text-[7px] font-bold leading-none tracking-[0.1em]">相伴庆典</p>
              <p className="mt-0.5 text-[5px] uppercase tracking-[0.1em] text-white/65">Companionship</p>
            </div>
          </div>

          <div className="flex items-start justify-end gap-3 md:flex-1 md:justify-center md:py-4">
            <div className="hidden items-end gap-[3px] pt-1 md:flex">
              {INK_BARCODE_BARS.map((bar) => (
                <span key={bar.id} className="h-5 bg-zinc-900/85" style={{ width: `${bar.widthPx}px` }} />
              ))}
            </div>
            <span className="pt-1 text-[10px] font-bold uppercase tracking-[0.4em] text-zinc-500 md:pt-2 md:[writing-mode:vertical-rl]">
              Homecoming
            </span>
            <div className="relative">
              <span
                className="absolute inset-y-0 left-1/2 hidden w-[2px] -translate-x-1/2 bg-[#c8101a]/75 md:block"
                aria-hidden="true"
              />
              <h2
                className="relative text-3xl font-black tracking-[0.16em] text-zinc-900 md:text-5xl md:leading-none md:tracking-[0.3em] md:[writing-mode:vertical-rl]"
                style={serifDisplayStyle}
              >
                向渊行
              </h2>
            </div>
          </div>

          <p className="hidden text-[10px] tracking-[0.2em] text-zinc-500 md:block">{copy.tagline}</p>
        </div>

        <div className="flex flex-1 flex-col justify-center p-5 pb-12 md:p-8 md:pb-14">
          <div className="relative mx-auto w-full max-w-xl border border-zinc-900/15 bg-white/90 shadow-[0_18px_44px_-20px_rgba(20,20,18,0.45)]">
            <div className="absolute inset-y-0 right-0 hidden w-7 items-center justify-center border-l border-zinc-900/10 sm:flex">
              <span className="text-[8px] uppercase tracking-[0.32em] text-zinc-500 [writing-mode:vertical-rl]">
                Arknights: Endfield
              </span>
            </div>

            <div className="p-4 md:p-6 sm:pr-11 md:pr-12">
              <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b-2 border-[#c8101a] pb-2.5">
                <h3 className="text-lg font-black tracking-[0.1em] text-[#c8101a] md:text-xl" style={serifDisplayStyle}>
                  {copy.programTitle}
                </h3>
                <span className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-500">
                  {copy.summaryLabel}
                </span>
              </div>

              <div className="mt-3 border border-[#c8101a]/25 bg-[#c8101a]/[0.035] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-[0.28em] text-[#c8101a]">
                      {copy.redeemCodeLabel}
                    </p>
                    <code className="mt-1 block text-base font-black tracking-[0.12em] text-zinc-950">
                      {PREVIEW_REDEEM_CODE}
                    </code>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="inline-flex items-center gap-1.5 border border-zinc-900 bg-zinc-950 px-3 py-2 text-[10px] font-bold tracking-wider text-white transition-colors hover:bg-[#c8101a] focus:outline-none focus:ring-2 focus:ring-[#c8101a] focus:ring-offset-2"
                  >
                    {hasCopiedCode ? <Check size={13} /> : <Copy size={13} />}
                    {hasCopiedCode ? copy.codeCopied : copy.copyCode}
                  </button>
                </div>
                <p className="mt-2 border-t border-zinc-900/10 pt-2 text-[10px] leading-relaxed text-zinc-600">
                  {copy.redeemCodeReward}
                </p>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {copy.resourceGroups.map((group, groupIndex) => (
                  <section
                    key={group.title}
                    className={`border border-zinc-900/10 bg-white/75 p-3 ${groupIndex === 0 ? 'sm:col-span-2' : ''}`}
                  >
                    <h4 className="flex items-center gap-2 text-[10px] font-black tracking-wide text-zinc-900">
                      <span className="font-mono text-[#c8101a]">{String(groupIndex + 1).padStart(2, '0')}</span>
                      {group.title}
                    </h4>
                    <ul className={`mt-2 grid gap-x-4 gap-y-1.5 ${groupIndex === 0 ? 'sm:grid-cols-2' : ''}`}>
                      {group.items.map(([name, amount]) => (
                        <li
                          key={`${group.title}-${name}`}
                          className="flex items-baseline justify-between gap-3 border-t border-zinc-900/8 pt-1.5 text-[10px]"
                        >
                          <span className="text-zinc-600">{name}</span>
                          <strong className="shrink-0 font-mono text-zinc-950">{amount}</strong>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>

              {/* 倒计时暂时停用；需要恢复时可在资源速览下方重新接入。 */}

              <div
                className="mt-3 h-2"
                style={{
                  background:
                    'linear-gradient(90deg, rgba(200,16,26,0.14) 0%, rgba(200,16,26,0.92) 22%, #c8101a 58%, rgba(200,16,26,0.3) 100%)',
                }}
              />

              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[9px] uppercase tracking-[0.26em] text-zinc-600">Endfield Industries</p>
                  <p className="mt-0.5 text-[8px] uppercase tracking-[0.26em] text-zinc-400">— From Talos-II</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={PREVIEW_SUMMARY_OPUS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 border border-zinc-900/30 bg-white/70 px-3 py-1.5 text-[11px] font-bold tracking-widest text-zinc-800 transition-colors hover:border-zinc-900 hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#c8101a]"
                  >
                    <ExternalLink size={12} />
                    {copy.summaryButton}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="absolute bottom-2 right-3 z-10 text-[8px] font-bold tracking-[0.24em] text-white/60">
        © HYPERGRYPH
      </p>
    </section>
  );
}
