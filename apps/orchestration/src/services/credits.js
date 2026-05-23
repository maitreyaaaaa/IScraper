const FREE_ITEMS_LIMIT = 200;

const DEFAULT_CREDIT_PACKAGES = [
  {
    id: 'starter_100',
    name: 'Starter',
    credits: 100,
    amountCents: 900,
    currency: 'usd',
    active: true,
  },
  {
    id: 'growth_500',
    name: 'Growth',
    credits: 500,
    amountCents: 3900,
    currency: 'usd',
    active: true,
  },
  {
    id: 'pro_1500',
    name: 'Pro',
    credits: 1500,
    amountCents: 9900,
    currency: 'usd',
    active: true,
  },
];

function normalizePackage(row) {
  return {
    id: row.id,
    name: row.name,
    credits: Number(row.credits || 0),
    amountCents: Number(row.amountCents ?? row.amount_cents ?? 0),
    currency: String(row.currency || 'usd').toLowerCase(),
    stripePriceId: row.stripePriceId || row.stripe_price_id || null,
    active: row.active !== false,
  };
}

function formatPrice(packageEntry) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: packageEntry.currency || 'usd',
  }).format((packageEntry.amountCents || 0) / 100);
}

module.exports = {
  DEFAULT_CREDIT_PACKAGES,
  FREE_ITEMS_LIMIT,
  formatPrice,
  normalizePackage,
};
