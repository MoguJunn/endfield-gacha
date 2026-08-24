export const DONATION_PLATFORM_URL = 'https://afdian.com/a/mogujun';

export const FEATURED_SUPPORTER = Object.freeze({
  id: 'neptune-2026-08',
  name: 'Neptune',
  avatarUrl: '/neptune.jpg',
  roleKey: 'about.neptuneRole',
  donatedAt: '2026-08',
  amountCny: 200,
  raffleAmountCny: 60,
  siteAmountCny: 140,
  pinned: true,
});

const DONATION_RECORDS = [
  FEATURED_SUPPORTER,
];

export const DONATION_LEDGER = Object.freeze([...DONATION_RECORDS].sort((left, right) => {
  const pinnedDiff = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
  if (pinnedDiff !== 0) return pinnedDiff;

  const dateDiff = String(right.donatedAt || '').localeCompare(String(left.donatedAt || ''));
  if (dateDiff !== 0) return dateDiff;

  return String(left.id || '').localeCompare(String(right.id || ''));
}));

export const AFDIAN_SUPPORT_TIERS = Object.freeze([
  { planId: '1c0daaaa9fd511f1b11e5254001e7c00', amountCny: 6, billingMonths: 1 },
  { planId: '1b908d049fd511f1a28d52540025c377', amountCny: 12, billingMonths: 1 },
  { planId: 'ed1477fa9fdf11f19d4b5254001e7c00', amountCny: 32, billingMonths: 1 },
  { planId: 'ec215a209fdf11f1b71d52540025c377', amountCny: 70, billingMonths: 1 },
  { planId: 'eb8323dc9fdf11f18f255254001e7c00', amountCny: 125, billingMonths: 1 },
]);

export const DONATION_TOTALS = Object.freeze(DONATION_LEDGER.reduce((totals, donation) => ({
  amountCny: totals.amountCny + donation.amountCny,
  raffleAmountCny: totals.raffleAmountCny + donation.raffleAmountCny,
  siteAmountCny: totals.siteAmountCny + donation.siteAmountCny,
}), {
  amountCny: 0,
  raffleAmountCny: 0,
  siteAmountCny: 0,
}));
