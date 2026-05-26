const { formatPrice } = require('../services/credits');

function registerPublicRoutes(app, deps) {
  const { config, http, store } = deps;
  const { asyncRoute } = http;
  const { feedbackRateLimit } = http.rateLimiters;

  app.get('/api/credit-packages', asyncRoute(async (_req, res) => {
    const packages = await store.listCreditPackages();
    res.json({
      checkoutEnabled: Boolean(config.enableCreditCheckout && config.stripeSecretKey),
      packages: packages.map((entry) => ({
        ...entry,
        priceLabel: formatPrice(entry),
      })),
    });
  }));

  app.get('/api/feedback', asyncRoute(async (_req, res) => {
    res.json({ feedback: await store.listPublicFeedback() });
  }));

  app.post('/api/feedback', feedbackRateLimit, asyncRoute(async (req, res) => {
    const message = String(req.body?.message || '').trim();
    const feature = String(req.body?.feature || '').trim();
    if (message.length < 3) return res.status(400).json({ error: 'Feedback must be at least 3 characters.' });
    if (message.length > 500) return res.status(400).json({ error: 'Feedback must be 500 characters or less.' });

    const feedback = await store.createPublicFeedback({ feature, message });
    return res.status(201).json({ feedback });
  }));
}

module.exports = {
  registerPublicRoutes,
};
