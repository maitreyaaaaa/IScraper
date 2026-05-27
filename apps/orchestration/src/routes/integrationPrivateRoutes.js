const { credentialOptions } = require('../services/providers');
const { testProviderCredential } = require('../services/providerClients');
const { recordSecurityAuditForRequest } = require('../services/auditLog');
const {
  DEFAULT_AGENT_SCOPES,
  DEFAULT_EXTENSION_SCOPES,
  defaultAgentExpiry,
  defaultExtensionExpiry,
  generateAgentToken,
  generateExtensionToken,
  hashExtensionToken,
} = require('../services/extensionTokens');

function extensionScopesFromBody(body = {}) {
  if (!Array.isArray(body.scopes) || !body.scopes.length) return DEFAULT_EXTENSION_SCOPES;
  const allowed = new Set(DEFAULT_EXTENSION_SCOPES);
  const scopes = [...new Set(body.scopes.map((scope) => String(scope || '').trim()).filter((scope) => allowed.has(scope)))];
  return scopes.length ? scopes : DEFAULT_EXTENSION_SCOPES;
}

function registerPrivateIntegrationRoutes(app, deps) {
  const { config, http, store, workflows } = deps;
  const { asyncRoute, captureWorkflow, cleanText } = http;
  const { requireCompletedProfile } = http.auth;
  const { checkoutRateLimit } = http.rateLimiters;
  const { stripeFor } = workflows.billing;

  app.get('/api/extension-tokens', asyncRoute(async (req, res) => {
    if (typeof store.listExtensionTokens !== 'function') return res.json({ tokens: [] });
    return res.json({ tokens: await store.listExtensionTokens(req.user.id) });
  }));

  app.post('/api/extension-tokens', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.createExtensionToken !== 'function') return res.status(501).json({ error: 'Extension tokens are not available.' });
    const rawToken = generateExtensionToken();
    const scopes = extensionScopesFromBody(req.body || {});
    const token = await store.createExtensionToken(req.user.id, {
      tokenHash: hashExtensionToken(rawToken),
      name: cleanText(req.body?.name || 'Browser extension', 80),
      scopes,
      expiresAt: defaultExtensionExpiry(),
    });
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'extension_token_created',
      severity: 'warning',
      metadata: { tokenId: token.id, scopeCount: scopes.length },
    });
    captureWorkflow(req, 'extension token created', { extensionTokenId: token.id, scopeCount: scopes.length });
    return res.status(201).json({ token, secret: rawToken });
  }));

  app.delete('/api/extension-tokens/:id', asyncRoute(async (req, res) => {
    if (typeof store.revokeExtensionToken !== 'function') return res.status(501).json({ error: 'Extension tokens are not available.' });
    const revoked = await store.revokeExtensionToken(req.user.id, req.params.id);
    if (!revoked) return res.status(404).json({ error: 'Extension token not found.' });
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'extension_token_revoked',
      severity: 'warning',
      metadata: { tokenId: req.params.id },
    });
    captureWorkflow(req, 'extension token revoked', { extensionTokenId: req.params.id });
    return res.json({ revoked: true });
  }));

  app.get('/api/agent-access/tokens', asyncRoute(async (req, res) => {
    if (typeof store.listExtensionTokens !== 'function') return res.json({ tokens: [] });
    const tokens = (await store.listExtensionTokens(req.user.id))
      .filter((token) => (token.scopes || []).includes('agent:access'));
    return res.json({ tokens });
  }));

  app.post('/api/agent-access/tokens', asyncRoute(async (req, res) => {
    await requireCompletedProfile(req, store);
    if (typeof store.createExtensionToken !== 'function') return res.status(501).json({ error: 'Agent access tokens are not available.' });
    const rawToken = generateAgentToken();
    const token = await store.createExtensionToken(req.user.id, {
      tokenHash: hashExtensionToken(rawToken),
      name: cleanText(req.body?.name || 'Agent access', 80),
      scopes: DEFAULT_AGENT_SCOPES,
      expiresAt: defaultAgentExpiry(),
    });
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'token_created',
      severity: 'critical',
      metadata: { tokenId: token.id, tokenType: 'agent_access', scopeCount: DEFAULT_AGENT_SCOPES.length },
    });
    captureWorkflow(req, 'agent access token created', { agentTokenId: token.id, scopeCount: DEFAULT_AGENT_SCOPES.length });
    return res.status(201).json({
      token,
      secret: rawToken,
      mcpEndpoint: '/api/mcp',
      queryEndpoint: '/api/agent-access/query',
    });
  }));

  app.delete('/api/agent-access/tokens/:id', asyncRoute(async (req, res) => {
    if (typeof store.revokeExtensionToken !== 'function' || typeof store.listExtensionTokens !== 'function') {
      return res.status(501).json({ error: 'Agent access tokens are not available.' });
    }
    const existing = (await store.listExtensionTokens(req.user.id))
      .find((token) => token.id === req.params.id && (token.scopes || []).includes('agent:access'));
    if (!existing) return res.status(404).json({ error: 'Agent access token not found.' });
    const revoked = await store.revokeExtensionToken(req.user.id, req.params.id);
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'token_revoked',
      severity: 'critical',
      metadata: { tokenId: req.params.id, tokenType: 'agent_access' },
    });
    captureWorkflow(req, 'agent access token revoked', { agentTokenId: req.params.id });
    return res.json({ revoked: Boolean(revoked) });
  }));

  app.post('/api/credits/checkout', checkoutRateLimit, asyncRoute(async (req, res) => {
    if (!config.enableCreditCheckout) return res.status(503).json({ error: 'Credit checkout is coming soon.' });

    const stripe = stripeFor();
    if (!stripe) return res.status(503).json({ error: 'Stripe is not configured yet.' });

    const packageId = String(req.body?.packageId || '').trim();
    const packageEntry = await store.getCreditPackage(packageId);
    if (!packageEntry) return res.status(404).json({ error: 'Credit package not found.' });

    const purchase = await store.createCreditPurchase({ userId: req.user.id, packageEntry });
    const appUrl = String(config.appUrl || req.get('origin') || 'http://localhost:5173').replace(/\/$/, '');
    const lineItem = packageEntry.stripePriceId
      ? { price: packageEntry.stripePriceId, quantity: 1 }
      : {
          price_data: {
            currency: packageEntry.currency,
            unit_amount: packageEntry.amountCents,
            product_data: { name: `${packageEntry.credits} IScraper credits` },
          },
          quantity: 1,
        };

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: req.user.id,
      customer_email: req.user.email,
      line_items: [lineItem],
      success_url: `${appUrl}/?checkout=success#app`,
      cancel_url: `${appUrl}/?checkout=cancelled#app`,
      metadata: {
        purchaseId: purchase.id,
        userId: req.user.id,
        packageId: packageEntry.id,
        credits: String(packageEntry.credits),
      },
    });

    await store.updateCreditPurchaseSession({ purchaseId: purchase.id, checkoutSessionId: session.id });
    captureWorkflow(req, 'credit checkout created', { purchaseId: purchase.id, checkoutSessionId: session.id, packageId: packageEntry.id, credits: packageEntry.credits });
    return res.json({ url: session.url, sessionId: session.id });
  }));

  app.get('/api/provider-credentials', asyncRoute(async (req, res) => {
    res.json({
      credentials: await store.listProviderCredentials(req.user.id),
      options: credentialOptions(),
    });
  }));

  app.post('/api/provider-credentials', asyncRoute(async (req, res) => {
    const credential = await store.saveProviderCredential(req.user.id, {
      provider: req.body.provider,
      purpose: req.body.purpose,
      model: req.body.model,
      apiKey: req.body.apiKey,
      baseUrl: req.body.baseUrl,
      displayName: req.body.displayName,
      encryptionKey: config.credentialEncryptionKey,
    });
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'provider_key_changed',
      severity: 'critical',
      metadata: {
        credentialId: credential.id,
        provider: credential.provider,
        purpose: credential.purpose,
        model: credential.model,
      },
    });
    captureWorkflow(req, 'provider credential saved', { provider: credential.provider, purpose: credential.purpose, model: credential.model, displayName: credential.displayName, credentialId: credential.id });
    res.json({ credential });
  }));

  app.delete('/api/provider-credentials/:id', asyncRoute(async (req, res) => {
    const deleted = await store.deleteProviderCredential(req.user.id, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Credential not found.' });
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'provider_key_deleted',
      severity: 'critical',
      metadata: { credentialId: req.params.id },
    });
    captureWorkflow(req, 'provider credential deleted', { credentialId: req.params.id });
    return res.json({ deleted: true });
  }));

  app.post('/api/provider-credentials/:id/test', asyncRoute(async (req, res) => {
    const credential = await store.getProviderCredential(req.user.id, req.params.id, config.credentialEncryptionKey);
    if (!credential) return res.status(404).json({ error: 'Credential not found.' });
    await testProviderCredential({ credential });
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'provider_key_tested',
      severity: 'warning',
      metadata: { credentialId: req.params.id, provider: credential.provider, purpose: credential.purpose, model: credential.model },
    });
    captureWorkflow(req, 'provider credential tested', { credentialId: req.params.id, provider: credential.provider, purpose: credential.purpose, model: credential.model });
    return res.json({ ok: true, provider: credential.provider, purpose: credential.purpose, model: credential.model });
  }));

  app.post('/api/provider-credentials/:id/reveal', asyncRoute(async (req, res) => {
    const credential = await store.getProviderCredential(req.user.id, req.params.id, config.credentialEncryptionKey);
    if (!credential) return res.status(404).json({ error: 'Credential not found.' });
    await recordSecurityAuditForRequest(store, req, {
      eventType: 'provider_key_revealed',
      severity: 'critical',
      metadata: { credentialId: req.params.id, provider: credential.provider, purpose: credential.purpose, model: credential.model },
    });
    return res.json({ apiKey: credential.apiKey });
  }));
}

module.exports = {
  registerPrivateIntegrationRoutes,
};
