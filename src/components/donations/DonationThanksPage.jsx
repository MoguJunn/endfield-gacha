import React from 'react';
import { ArrowLeft, ExternalLink, Gift, HandCoins, ReceiptText, Server, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ACCOUNT_RECOVERY_QQ_GROUP, ENGLISH_COMMUNITY_DISCORD_URL } from '../../constants/community.js';
import {
  AFDIAN_SUPPORT_TIERS,
  DONATION_LEDGER,
  DONATION_PLATFORM_URL,
  DONATION_TOTALS,
} from '../../constants/donations.js';
import { useI18n } from '../../i18n/index.js';

const PROCESS_STEPS = [
  { id: 'received', icon: ReceiptText },
  { id: 'raffle', icon: Gift },
  { id: 'site', icon: Server },
  { id: 'public', icon: Users },
];

export default function DonationThanksPage() {
  const { t, isEnglish } = useI18n();

  return (
    <main className="min-h-screen bg-[#f5f4ef] px-4 py-8 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-2 border border-zinc-300 bg-white px-3 py-2 text-xs font-bold transition-colors hover:border-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
          >
            <ArrowLeft size={14} />
            {t('donations.backHome')}
          </Link>
          <a
            href={DONATION_PLATFORM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-rose-600 px-4 py-2 text-xs font-black text-white transition-colors hover:bg-rose-500"
          >
            <HandCoins size={15} />
            {t('donations.supportAction')}
            <ExternalLink size={13} />
          </a>
        </div>

        <header className="relative overflow-hidden border-l-4 border-rose-500 bg-zinc-950 px-6 py-8 text-white shadow-xl sm:px-8 sm:py-10">
          <HandCoins className="pointer-events-none absolute -bottom-14 -right-8 text-rose-500/15" size={240} />
          <div className="relative z-10 max-w-3xl">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-rose-300">Donation Center // Public Ledger</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{t('donations.title')}</h1>
            <p className="mt-3 text-sm leading-relaxed text-zinc-300">{t('donations.subtitle')}</p>
          </div>
        </header>

        <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ['total', DONATION_TOTALS.amountCny, 'text-rose-600 dark:text-rose-300'],
            ['raffle', DONATION_TOTALS.raffleAmountCny, 'text-amber-600 dark:text-amber-300'],
            ['site', DONATION_TOTALS.siteAmountCny, 'text-emerald-600 dark:text-emerald-300'],
          ].map(([key, amount, tone]) => (
            <div key={key} className="border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">{t(`donations.summary.${key}`)}</p>
              <p className={`mt-2 font-mono text-3xl font-black ${tone}`}>¥{amount}</p>
            </div>
          ))}
        </section>

        <section className="mt-6 border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">{t('donations.tiersTitle')}</h2>
            </div>
            <a href={DONATION_PLATFORM_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-600 hover:text-rose-500 dark:text-rose-300">
              {t('donations.tiersOpen')} <ExternalLink size={12} />
            </a>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
            {AFDIAN_SUPPORT_TIERS.map((tier) => (
              <a
                key={tier.planId}
                href={DONATION_PLATFORM_URL}
                target="_blank"
                rel="noopener noreferrer"
                data-plan-id={tier.planId}
                className="group border border-rose-200 bg-gradient-to-br from-rose-50 to-white p-4 text-center transition-all hover:-translate-y-0.5 hover:border-rose-400 hover:shadow-md dark:border-rose-900/60 dark:from-rose-950/30 dark:to-zinc-950"
              >
                <p className="font-mono text-2xl font-black text-rose-600 dark:text-rose-300">¥{tier.amountCny}</p>
                <p className="mt-1 text-[10px] font-bold text-zinc-600 dark:text-zinc-300">
                  {t('donations.tierName', { amount: tier.amountCny })}
                </p>
                <p className="mt-2 text-[9px] text-zinc-400">
                  {t('donations.tierBilling', { months: tier.billingMonths })}
                </p>
              </a>
            ))}
          </div>
        </section>

        <section className="mt-6 border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 sm:p-7">
          <div className="flex items-center gap-2">
            <ReceiptText size={18} className="text-rose-500" />
            <h2 className="text-lg font-black">{t('donations.processTitle')}</h2>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-4">
            {PROCESS_STEPS.map((step, index) => {
              const Icon = step.icon;
              return (
                <article key={step.id} className="relative border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
                  <span className="absolute right-3 top-2 font-mono text-2xl font-black text-zinc-200 dark:text-zinc-800">{String(index + 1).padStart(2, '0')}</span>
                  <Icon size={18} className="text-rose-500" />
                  <h3 className="mt-4 text-sm font-black">{t(`donations.process.${step.id}.title`)}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{t(`donations.process.${step.id}.description`)}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-6 border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800 sm:px-7">
            <h2 className="text-lg font-black">{t('donations.ledgerTitle')}</h2>
            <p className="mt-1 text-xs text-zinc-500">{t('donations.ledgerSubtitle')}</p>
          </div>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {DONATION_LEDGER.map((donation) => (
              <article key={donation.id} className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-7">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <h3 className="truncate text-base font-black">{donation.name}</h3>
                    <img
                      src={donation.avatarUrl}
                      alt={donation.name}
                      className="h-7 w-7 shrink-0 rounded border border-zinc-300 object-cover dark:border-zinc-700"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="mt-1 text-xs text-zinc-500">{t(donation.roleKey)}</p>
                    <p className="mt-2 text-[11px] text-zinc-500">{t('donations.ledgerMonth', { month: donation.donatedAt })}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[300px]">
                  <div className="bg-rose-50 px-3 py-2 dark:bg-rose-950/30">
                    <p className="text-[9px] text-zinc-500">{t('donations.summary.total')}</p>
                    <strong className="font-mono text-sm text-rose-600 dark:text-rose-300">¥{donation.amountCny}</strong>
                  </div>
                  <div className="bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
                    <p className="text-[9px] text-zinc-500">{t('donations.summary.raffle')}</p>
                    <strong className="font-mono text-sm text-amber-600 dark:text-amber-300">¥{donation.raffleAmountCny}</strong>
                  </div>
                  <div className="bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
                    <p className="text-[9px] text-zinc-500">{t('donations.summary.site')}</p>
                    <strong className="font-mono text-sm text-emerald-600 dark:text-emerald-300">¥{donation.siteAmountCny}</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-6 flex flex-col items-start justify-between gap-4 border border-zinc-800 bg-zinc-950 p-5 text-white sm:flex-row sm:items-center sm:p-7">
          <div>
            <h2 className="text-lg font-black">{t('donations.communityTitle')}</h2>
            <p className="mt-1 text-xs text-zinc-400">{t('donations.communityDescription')}</p>
          </div>
          {isEnglish ? (
            <a href={ENGLISH_COMMUNITY_DISCORD_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-endfield-yellow px-4 py-2 text-xs font-black text-black">
              <Users size={15} /> Discord <ExternalLink size={12} />
            </a>
          ) : (
            <div className="border border-endfield-yellow/40 bg-endfield-yellow/10 px-5 py-2 font-mono text-lg font-black text-endfield-yellow">
              QQ {ACCOUNT_RECOVERY_QQ_GROUP}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
