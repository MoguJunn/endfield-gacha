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
});

export const DONATION_LEDGER = Object.freeze([
  FEATURED_SUPPORTER,
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
