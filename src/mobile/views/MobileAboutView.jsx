import React from 'react';
import {
  Star,
  Calculator,
  BarChart3,
  Cloud,
  Download,
  Shield,
  Heart,
  Code,
  Sparkles,
  ExternalLink,
  Bot
} from 'lucide-react';
import useSiteConfigStore from '../../stores/useSiteConfigStore';
import { APP_BUILD_INFO, APP_VERSION_LABEL } from '../../constants/appMeta';
import { useI18n } from '../../i18n/index.js';
import { resolveSiteLegalConfig } from '../../utils/siteLegalConfig.js';
import { MobileSectionTitle, MobileStickyHeader } from '../components/ux/MobilePrimitives.jsx';

function MobileAboutSection({ title, icon, children }) {
  return (
    <div className="mobile-ux-card p-4 space-y-4">
      <MobileSectionTitle title={title} icon={icon} />
      <div>{children}</div>
    </div>
  );
}

function MobileAboutView() {
  const { t } = useI18n();
  const config = useSiteConfigStore((state) => state.config);

  const siteVersion = config.site_version || APP_VERSION_LABEL;
  const buildInfo = config.build_info || APP_BUILD_INFO;
  const authorName = config.author_name || '';
  const authorBilibili = config.author_bilibili || '';
  const githubUrl = config.github_url || '';
  const { icpNumber, icpUrl, policeNumber, policeUrl } = resolveSiteLegalConfig(config);
  const features = [
    { Icon: Star, label: t('about.feature.pool.label'), desc: t('about.feature.pool.desc') },
    { Icon: Calculator, label: t('about.feature.simulator.label'), desc: t('about.feature.simulator.desc') },
    { Icon: BarChart3, label: t('about.feature.analytics.label'), desc: t('about.feature.analytics.desc') },
    { Icon: Cloud, label: t('about.feature.sync.label'), desc: t('about.feature.sync.desc') },
    { Icon: Download, label: t('about.feature.import.label'), desc: t('about.feature.import.desc') },
    { Icon: Shield, label: t('about.feature.global.label'), desc: t('about.feature.global.desc') },
  ];

  return (
    <div className="flex-1 h-full overflow-y-auto overflow-x-hidden slide-right-enter scroll-smooth w-full bg-ef-light dark:bg-ef-dark px-4 pb-6 space-y-4">
      <MobileStickyHeader
        eyebrow="SYSTEM"
        icon={BarChart3}
        title={t('app.brand')}
        subtitle={t('about.mobileSubtitle')}
      />

      <div className="mobile-ux-card p-5 relative overflow-hidden border-l-4 border-l-endfield-yellow bg-[radial-gradient(circle_at_top_right,rgba(255,250,0,0.14),transparent_38%),linear-gradient(160deg,rgba(255,255,255,0.75),rgba(244,244,245,0.85))] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,250,0,0.14),transparent_38%),linear-gradient(160deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))]">
        <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.05)_50%,transparent_75%,transparent_100%)] bg-[length:250%_250%,100%_100%] animate-shine-slow pointer-events-none" />
        <div className="relative z-10">
            <h1 className="mb-2 flex items-center gap-2 text-lg font-black tracking-tight uppercase text-slate-900 dark:text-zinc-100">
            <BarChart3 size={20} className="text-endfield-yellow" />
            {t('app.brand')}
          </h1>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">{t('about.mobileSubtitle')}</p>
          <div className="mt-4 flex items-center gap-3">
            <span className="mobile-ux-card-chip px-2 py-0.5 font-mono text-[10px] text-endfield-yellow dark:border-zinc-700 dark:bg-zinc-800">{siteVersion}</span>
            <span className="font-mono text-[10px] uppercase text-slate-500 dark:text-zinc-600">{buildInfo}</span>
          </div>
        </div>
      </div>

      <MobileAboutSection title={t('about.teamSection')} icon={Heart}>
        {authorName && (
          <div className="mb-4 flex items-center gap-4 rounded-[1.05rem] border border-zinc-200 bg-zinc-50/75 p-4 transition-colors hover:border-zinc-300 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/15">
            <div className="relative">
              <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-[1rem] border border-zinc-300 bg-zinc-200 dark:border-zinc-600 dark:bg-zinc-700">
                <img
                  src="/avatar.png"
                  alt={authorName}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="absolute -bottom-1 -right-1 h-3 w-3 border border-white bg-green-500 dark:border-zinc-900" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-bold uppercase text-slate-900 dark:text-zinc-100">{authorName}</h4>
                <span className="bg-zinc-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300 rounded-[0.8rem]">{t('about.leadBadge')}</span>
              </div>
              <p className="mb-2 font-mono text-[10px] uppercase text-slate-500 dark:text-zinc-400">{t('about.leadDesc')}</p>
              {authorBilibili && (
                <a
                  href={authorBilibili}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-pink-900/30 bg-pink-900/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-pink-400 transition-colors hover:bg-pink-900/20"
                >
                  Bilibili
                </a>
              )}
            </div>
          </div>
        )}

        <div className="mb-4 flex items-center gap-4 rounded-[1.05rem] border border-zinc-200 bg-zinc-50/75 p-4 transition-colors hover:border-zinc-300 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/15">
          <div className="relative">
            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-[1rem] border border-zinc-300 bg-zinc-200 dark:border-zinc-600 dark:bg-zinc-700">
              <img
                src="/neptune.jpg"
                alt="Neptune"
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
            <div className="absolute -bottom-1 -right-1 h-3 w-3 border border-white bg-green-500 dark:border-zinc-900" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-bold uppercase text-slate-900 dark:text-zinc-100">Neptune</h4>
            <p className="mt-1 font-mono text-[10px] uppercase text-slate-500 dark:text-zinc-400">{t('about.neptuneRole')}</p>
          </div>
        </div>

        <div className="border-t border-zinc-200 pt-4 dark:border-white/8">
          <p className="mb-3 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
            <Bot size={12} />
            {t('about.aiSection')}
          </p>
          <div className="space-y-3">
            <div className="rounded-[1.05rem] border border-zinc-200 bg-zinc-50/75 p-3 dark:border-white/10 dark:bg-white/[0.04]">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.9rem] border border-[#D97757] bg-[#D97757] text-white">
                  <span className="font-serif text-xs font-bold italic">Cl</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h5 className="text-xs font-bold uppercase text-slate-800 dark:text-zinc-200">Claude</h5>
                    <span className="bg-orange-900/30 px-1.5 py-0.5 font-mono text-[9px] font-bold text-orange-400">OPUS</span>
                  </div>
                  <p className="mt-1 text-[9px] uppercase tracking-wide text-slate-500 dark:text-zinc-400">{t('about.ai.claudeFocus')}</p>
                </div>
              </div>
            </div>

            <div className="rounded-[1.05rem] border border-zinc-200 bg-zinc-50/75 p-3 dark:border-white/10 dark:bg-white/[0.04]">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.9rem] border border-[#1A73E8] bg-[#1A73E8] text-white">
                  <span className="font-sans text-xs font-bold">Ge</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h5 className="text-xs font-bold uppercase text-slate-800 dark:text-zinc-200">Gemini</h5>
                    <span className="bg-blue-900/30 px-1.5 py-0.5 font-mono text-[9px] font-bold text-blue-400">1.5 PRO</span>
                  </div>
                  <p className="mt-1 text-[9px] uppercase tracking-wide text-slate-500 dark:text-zinc-400">{t('about.ai.geminiFocus')}</p>
                </div>
              </div>
            </div>

            <div className="rounded-[1.05rem] border border-zinc-200 bg-zinc-50/75 p-3 dark:border-white/10 dark:bg-white/[0.04]">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.9rem] border border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-black dark:text-white">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M7.5 8.5 4.5 12l3 3.5" />
                    <path d="M16.5 8.5 19.5 12l-3 3.5" />
                    <path d="M13.5 6 10.5 18" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h5 className="text-xs font-bold uppercase text-slate-800 dark:text-zinc-200">Codex</h5>
                    <span className="bg-zinc-700 px-1.5 py-0.5 font-mono text-[9px] font-bold text-zinc-200">GPT-5</span>
                  </div>
                  <p className="mt-1 text-[9px] uppercase tracking-wide text-slate-500 dark:text-zinc-400">{t('about.ai.codexFocus')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </MobileAboutSection>

      <MobileAboutSection title={t('about.featuresSection')} icon={Sparkles}>
        <div className="grid grid-cols-2 gap-3">
          {features.map((feature, idx) => (
            <div key={idx} className="rounded-[1.05rem] border border-zinc-200 bg-zinc-50/75 p-3 transition-colors hover:border-zinc-300 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/15">
              <feature.Icon size={16} className="mb-2 text-slate-500 transition-colors hover:text-endfield-yellow dark:text-zinc-400" />
              <h4 className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700 dark:text-zinc-300">{feature.label}</h4>
              <p className="font-mono text-[9px] text-slate-500 dark:text-zinc-500">{feature.desc}</p>
            </div>
          ))}
        </div>
      </MobileAboutSection>

      {githubUrl && (
        <MobileAboutSection title={t('about.openSourceSection')} icon={Code}>
          <div className="mobile-ux-card-inset flex items-center justify-between p-4 text-slate-900 dark:text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-[0.9rem] bg-white text-black">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-bold uppercase tracking-tight">{githubUrl.replace('https://github.com/', '')}</h4>
              </div>
            </div>
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex shrink-0 items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-black transition-colors hover:bg-zinc-200"
            >
              {t('about.openSourceView')}
              <ExternalLink size={10} />
            </a>
          </div>
        </MobileAboutSection>
      )}

      <div className="mobile-ux-card p-4 text-center">
        <p className="font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-zinc-500">{t('about.disclaimer')}</p>
        <div className="mt-2 flex items-center justify-center gap-2 font-mono text-[9px] text-zinc-500">
          <a href="/privacy" className="underline">{t('about.privacyPolicy')}</a>
          <span>|</span>
          <a href="/terms" className="underline">{t('about.terms')}</a>
        </div>
        {(icpNumber || policeNumber) && (
          <div className="mt-1 flex items-center justify-center gap-2 font-mono text-[9px] text-zinc-500">
            {icpNumber && (
              <a href={icpUrl} target="_blank" rel="noopener noreferrer">{icpNumber}</a>
            )}
            {icpNumber && policeNumber && <span>|</span>}
            {policeNumber && (
              <a href={policeUrl} target="_blank" rel="noopener noreferrer">{policeNumber}</a>
            )}
          </div>
        )}
      </div>

      <div className="h-4" />
    </div>
  );
}

export default MobileAboutView;
