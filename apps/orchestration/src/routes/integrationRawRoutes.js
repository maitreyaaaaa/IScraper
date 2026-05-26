const express = require('express');

function registerRawIntegrationRoutes(app, deps) {
  const { config, http, store, workflows } = deps;
  const { asyncRoute, captureWorkflow, warnWorkflow } = http;
  const { stripeFor } = workflows.billing;

  app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), asyncRoute(async (req, res) => {
    const stripe = stripeFor();
    if (!stripe || !config.stripeWebhookSecret) {
      return res.status(503).json({ error: 'Stripe webhook is not configured.' });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.header('stripe-signature'), config.stripeWebhookSecret);
    } catch (_error) {
      warnWorkflow(req, 'stripe webhook rejected', { reason: 'invalid_signature', statusCode: 400 });
      return res.status(400).json({ error: 'Invalid Stripe signature.' });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await store.completeCreditPurchase({
        purchaseId: session.metadata?.purchaseId,
        checkoutSessionId: session.id,
        paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
      });
      captureWorkflow(req, 'stripe checkout completed', {
        checkoutSessionId: session.id,
        purchaseId: session.metadata?.purchaseId,
      });
    }

    return res.json({ received: true });
  }));
}

module.exports = {
  registerRawIntegrationRoutes,
};
