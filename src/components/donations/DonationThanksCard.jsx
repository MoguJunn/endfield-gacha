import React, { useState } from 'react';
import { Check, Copy, ExternalLink, HandCoins, List, Pin, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ACCOUNT_RECOVERY_QQ_GROUP, ENGLISH_COMMUNITY_DISCORD_URL } from '../../constants/community.js';
import { DONATION_LEDGER, DONATION_PLATFORM_URL, DONATION_TOTALS } from '../../constants/donations.js';
import { useI18n } from '../../i18n/index.js';

export default function DonationThanksCard({ compact = false }) {
  const { t, isEnglish } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCommunityAction = async () => {
    if (isEnglish) {
      window.open(ENGLISH_COMMUNITY_DISCORD_URL, '_blank', 'noopener,noreferrer');
      return;
    }

    try {
      await navigator.clipboard.writeText(ACCOUNT_RECOVERY_QQ_GROUP);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className={`relative flex h-full min-h-0 flex-col overflow-hidden border border-rose-200 bg-rose-50/80 shadow-sm dark:border-rose-900/60 dark:bg-rose-950/25 ${compact ? 'rounded-xl' : ''}`}>
      <div className={`flex items-start gap-3 ${compact ? 'p-3' : 'px-4 py-3'}`}>
        <div className={`flex shrink-0 items-center justify-center bg-rose-100 text-rose-600 dark:bg-rose-900/50 dark:text-rose-300 ${compact ? 'h-8 w-8 rounded-lg' : 'p-2'}`}>
          <HandCoins size={compact ? 16 : 20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`${compact ? 'text-[10px]' : 'text-sm'} font-bold text-rose-800 dark:text-rose-300`}>
              {t('home.donation.title')}
            </h3>
            <span className="bg-rose-600 px-1.5 py-0.5 font-mono text-[9px] font-black text-white">
              ¥{DONATION_TOTALS.amountCny}
            </span>
          </div>
          <p className={`${compact ? 'mt-1 text-[8px]' : 'mt-1 text-[11px]'} leading-relaxed text-rose-700/75 dark:text-rose-300/65`}>
            {t('home.donation.summary', { count: DONATION_LEDGER.length })}
          </p>
        </div>
      </div>

      <div className={`min-h-0 flex-1 overflow-y-auto border-y border-rose-200/70 bg-white/45 dark:border-rose-900/50 dark:bg-black/10 ${compact ? 'max-h-32' : 'max-h-28'}`}>
        <div className="divide-y divide-rose-200/60 dark:divide-rose-900/40">
          {DONATION_LEDGER.map((donation) => (
            <article key={donation.id} className={`${compact ? 'px-3 py-2' : 'px-4 py-2.5'} flex items-center justify-between gap-3`}>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <strong className={`${compact ? 'text-[10px]' : 'text-xs'} truncate text-rose-950 dark:text-rose-100`}>
                    {donation.name}
                  </strong>
                  <img
                    src={donation.avatarUrl}
                    alt={donation.name}
                    className="h-5 w-5 shrink-0 rounded border border-rose-200 object-cover dark:border-rose-800"
                    loading="lazy"
                  />
                  <span className="truncate text-[8px] text-rose-600/65 dark:text-rose-300/55">{donation.donatedAt}</span>
                  {donation.pinned ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-[8px] font-bold text-amber-600 dark:text-amber-300">
                      <Pin size={9} fill="currentColor" /> {t('home.donation.pinned')}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-[8px] text-rose-700/65 dark:text-rose-300/55">
                  {t('home.donation.allocation', {
                    raffle: donation.raffleAmountCny,
                    site: donation.siteAmountCny,
                  })}
                </p>
              </div>
              <a
                href={DONATION_PLATFORM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={`${compact ? 'text-xs' : 'text-sm'} donation-rainbow-amount shrink-0 font-mono font-black`}
                aria-label={t('home.donation.amountLink', { name: donation.name, amount: donation.amountCny })}
              >
                ¥{donation.amountCny}
              </a>
            </article>
          ))}
        </div>
      </div>

      <div className={`grid gap-2 ${compact ? 'grid-cols-2 p-3' : 'grid-cols-3 px-4 py-3'}`}>
        <a href={DONATION_PLATFORM_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 bg-rose-600 px-2 py-2 text-[10px] font-black text-white transition-colors hover:bg-rose-500">
          <HandCoins size={13} /> {t('home.donation.action')} <ExternalLink size={11} />
        </a>
        <Link to="/donations" className="inline-flex items-center justify-center gap-1.5 border border-rose-300 bg-white/65 px-2 py-2 text-[10px] font-bold text-rose-700 transition-colors hover:border-rose-500 dark:border-rose-900/70 dark:bg-black/20 dark:text-rose-200">
          <List size={13} /> {t('home.donation.ledgerAction')}
        </Link>
        <button type="button" onClick={handleCommunityAction} className={`inline-flex items-center justify-center gap-1.5 border border-amber-300 bg-amber-100/70 px-2 py-2 text-[10px] font-bold text-amber-800 transition-colors hover:border-amber-500 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200 ${compact ? 'col-span-2' : ''}`}>
          {copied ? <Check size={13} /> : isEnglish ? <Users size={13} /> : <Copy size={13} />}
          {copied ? t('home.donation.groupCopied') : t('home.donation.groupAction')}
        </button>
      </div>
    </section>
  );
}
