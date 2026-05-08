const { createClient } = require('@supabase/supabase-js');
const { decryptSecret, encryptSecret, maskSecret, publicCredential } = require('../services/credentials');
const { assertMediaModelAllowed, assertProviderPurpose } = require('../services/providers');
const { DEFAULT_CREDIT_PACKAGES, FREE_ITEMS_LIMIT, normalizePackage } = require('../services/credits');
const { normalizeUsername, publicProfile } = require('../services/profiles');

function createSupabaseStore({ url, serviceRoleKey }) {
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Supabase mode.');
  }

  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    client,
    requiresAuth: true,
    supportsSemanticSearch: true,
    async getUserFromToken(token) {
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) {
        const authError = new Error('Invalid or expired Supabase session.');
        authError.statusCode = 401;
        throw authError;
      }
      return { id: data.user.id, email: data.user.email };
    },
    async ensureUser(userId, email) {
      await client.from('users').upsert({ id: userId, email }, { onConflict: 'id' }).throwOnError();
      await client
        .from('user_credit_accounts')
        .upsert({ user_id: userId, free_items_limit: FREE_ITEMS_LIMIT }, { onConflict: 'user_id' })
        .throwOnError();
    },
    async getProfile(userId) {
      const { data, error } = await client
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return data ? mapProfile(data) : null;
    },
    async saveProfile(userId, { username, avatarUrl = '' }) {
      const { data, error } = await client
        .from('user_profiles')
        .upsert(
          {
            user_id: userId,
            username: normalizeUsername(username),
            avatar_url: avatarUrl || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        )
        .select('*')
        .single();
      if (error?.code === '23505') {
        const conflict = new Error('That username is already taken.');
        conflict.statusCode = 409;
        throw conflict;
      }
      if (error) throw error;
      return mapProfile(data);
    },
    async listPublicFeedback() {
      const { data, error } = await client
        .from('public_feedback')
        .select('*')
        .eq('status', 'visible')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data.map(mapFeedback);
    },
    async createPublicFeedback({ feature, message }) {
      const { data, error } = await client
        .from('public_feedback')
        .insert({
          feature: String(feature || 'Feature idea').trim().slice(0, 80),
          message: String(message || '').trim().replace(/\s+/g, ' ').slice(0, 500),
          display_name: 'Anonymous user',
          status: 'visible',
        })
        .select('*')
        .single();
      if (error) throw error;
      return mapFeedback(data);
    },
    async createImport({ userId, source, mode = 'export', fileNames = [] }) {
      const { data, error } = await client
        .from('imports')
        .insert({ user_id: userId, source, mode, file_names: fileNames, status: 'imported' })
        .select('*')
        .single();
      if (error) throw error;
      return mapImport(data);
    },
    async upsertImportData({ userId, importId, parsed }) {
      if (!parsed.items.length) return [];

      const ids = [...new Set(parsed.items.map((item) => item.id).filter(Boolean))];
      const urls = [...new Set(parsed.items.map((item) => item.url).filter(Boolean))];
      const existingKeys = new Set();
      if (ids.length || urls.length) {
        const filters = [];
        if (ids.length) filters.push(`id.in.(${ids.map(escapeSupabaseListValue).join(',')})`);
        if (urls.length) filters.push(`url.in.(${urls.map(escapeSupabaseListValue).join(',')})`);
        const { data: existing, error: existingError } = await client
          .from('saved_items')
          .select('id,url')
          .eq('user_id', userId)
          .or(filters.join(','));
        if (existingError) throw existingError;
        for (const row of existing || []) {
          existingKeys.add(`id:${row.id}`);
          existingKeys.add(`url:${row.url}`);
        }
      }

      const items = parsed.items
        .filter((item) => !existingKeys.has(`id:${item.id}`) && !existingKeys.has(`url:${item.url}`))
        .map((item) => ({
        id: item.id,
        user_id: userId,
        import_id: importId,
        url: item.url,
        content_type: item.contentType,
        caption: item.caption,
        hashtags: item.hashtags,
        owner_name: item.ownerName,
        owner_username: item.ownerUsername,
        saved_at_text: item.savedAt,
        collections: item.collections,
        platform: item.platform || 'Instagram',
        platform_key: item.platformKey || 'instagram',
        source_id: item.sourceId || item.id,
        source_title: item.sourceTitle || '',
        source_author: item.sourceAuthor || item.ownerUsername || item.ownerName || '',
        source_description: item.sourceDescription || '',
        thumbnail_url: item.thumbnailUrl || '',
        status: 'queued',
      }));
      if (!items.length) return [];
      const { data, error } = await client.from('saved_items').insert(items).select('*');
      if (error) throw error;
      return data.map(mapItem);
    },
    async createJobs({ userId, importId, items }) {
      const rows = items.map((item) => ({
        user_id: userId,
        import_id: importId,
        item_id: item.id,
        status: 'queued',
      }));
      if (!rows.length) return [];
      const { data, error } = await client.from('processing_jobs').upsert(rows, { onConflict: 'import_id,item_id' }).select('*');
      if (error) throw error;
      return data.map(mapJob);
    },
    async getItems(userId) {
      const { data, error } = await client
        .from('saved_items')
        .select('*, item_analysis(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(mapItemWithAnalysis);
    },
    async getItem(userId, id) {
      const { data, error } = await client
        .from('saved_items')
        .select('*, item_analysis(*)')
        .eq('user_id', userId)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data ? mapItemWithAnalysis(data) : null;
    },
    async getJobs(userId, importId = null) {
      let query = client.from('processing_jobs').select('*').eq('user_id', userId);
      if (importId) query = query.eq('import_id', importId);
      const { data, error } = await query.order('created_at');
      if (error) throw error;
      return data.map(mapJob);
    },
    async getJob(userId, id) {
      const { data, error } = await client.from('processing_jobs').select('*').eq('user_id', userId).eq('id', id).maybeSingle();
      if (error) throw error;
      return data ? mapJob(data) : null;
    },
    async updateJob(userId, id, patch) {
      const { data, error } = await client
        .from('processing_jobs')
        .update(toJobRow(patch))
        .eq('user_id', userId)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return mapJob(data);
    },
    async restartJobs(userId, importId = null) {
      const restartableStatuses = ['failed', 'downloading', 'analyzing', 'paused_needs_billing', 'paused_api_limit', 'paused_missing_provider'];
      let query = client
        .from('processing_jobs')
        .update({ status: 'queued', error: null })
        .eq('user_id', userId)
        .in('status', restartableStatuses);
      if (importId) query = query.eq('import_id', importId);
      const { data, error } = await query.select('item_id');
      if (error) throw error;

      const itemIds = [...new Set((data || []).map((row) => row.item_id))];
      if (itemIds.length) {
        await client
          .from('saved_items')
          .update({ status: 'queued', error: null })
          .eq('user_id', userId)
          .in('id', itemIds)
          .neq('status', 'done')
          .throwOnError();
      }
      return itemIds.length;
    },
    async saveAnalysis(userId, itemId, analysis) {
      await client
        .from('item_analysis')
        .upsert({ item_id: itemId, user_id: userId, ...toAnalysisRow(analysis) }, { onConflict: 'user_id,item_id' })
        .throwOnError();
      await client.from('saved_items').update({ status: 'done' }).eq('user_id', userId).eq('id', itemId).throwOnError();
      return this.getItem(userId, itemId);
    },
    async saveEmbedding(userId, itemId, { content, embedding, model }) {
      await client
        .from('item_embeddings')
        .upsert(
          {
            item_id: itemId,
            user_id: userId,
            content,
            embedding,
            embedding_model: model,
          },
          { onConflict: 'user_id,item_id' },
        )
        .throwOnError();
    },
    async markItemFailed(userId, itemId, error) {
      await client.from('saved_items').update({ status: 'failed', error }).eq('user_id', userId).eq('id', itemId).throwOnError();
    },
    async setItemStatus(userId, itemId, status, error = null) {
      await client.from('saved_items').update({ status, error }).eq('user_id', userId).eq('id', itemId).throwOnError();
    },
    async listCreditPackages() {
      const { data, error } = await client
        .from('credit_packages')
        .select('*')
        .eq('active', true)
        .order('credits', { ascending: true });
      if (error && error.code === '42P01') return DEFAULT_CREDIT_PACKAGES;
      if (error) throw error;
      return (data || []).map(mapCreditPackage);
    },
    async getCreditPackage(packageId) {
      const { data, error } = await client
        .from('credit_packages')
        .select('*')
        .eq('id', packageId)
        .eq('active', true)
        .maybeSingle();
      if (error && error.code === '42P01') return DEFAULT_CREDIT_PACKAGES.find((entry) => entry.id === packageId) || null;
      if (error) throw error;
      return data ? mapCreditPackage(data) : null;
    },
    async createCreditPurchase({ userId, packageEntry }) {
      const { data, error } = await client
        .from('credit_purchases')
        .insert({
          user_id: userId,
          package_id: packageEntry.id,
          credits: packageEntry.credits,
          amount_cents: packageEntry.amountCents,
          currency: packageEntry.currency,
          status: 'pending',
        })
        .select('*')
        .single();
      if (error) throw error;
      return mapCreditPurchase(data);
    },
    async updateCreditPurchaseSession({ purchaseId, checkoutSessionId }) {
      const { data, error } = await client
        .from('credit_purchases')
        .update({ stripe_checkout_session_id: checkoutSessionId })
        .eq('id', purchaseId)
        .select('*')
        .single();
      if (error) throw error;
      return mapCreditPurchase(data);
    },
    async completeCreditPurchase({ purchaseId, checkoutSessionId, paymentIntentId }) {
      const { data, error } = await client.rpc('complete_credit_purchase', {
        p_purchase_id: purchaseId || null,
        p_checkout_session_id: checkoutSessionId || null,
        p_payment_intent_id: paymentIntentId || null,
      });
      if (error) throw error;
      return data ? mapCreditPurchase(data) : null;
    },
    async getCredits(userId) {
      await this.ensureCreditAccount(userId);
      const { data: account, error: accountError } = await client
        .from('user_credit_accounts')
        .select('*')
        .eq('user_id', userId)
        .single();
      if (accountError) throw accountError;

      const { count, error: countError } = await client
        .from('analysis_usage_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('source', 'free');
      if (countError) throw countError;

      const freeItemsLimit = account.free_items_limit ?? FREE_ITEMS_LIMIT;
      const freeItemsUsed = count || 0;
      return {
        userId,
        freeItemsLimit,
        freeItemsUsed,
        freeItemsRemaining: Math.max(freeItemsLimit - freeItemsUsed, 0),
        paidCredits: account.paid_credits || 0,
        itemCreditCost: 1,
        totalAvailableCredits: Math.max(freeItemsLimit - freeItemsUsed, 0) + (account.paid_credits || 0),
      };
    },
    async ensureCreditAccount(userId) {
      await client
        .from('user_credit_accounts')
        .upsert({ user_id: userId, free_items_limit: FREE_ITEMS_LIMIT }, { onConflict: 'user_id' })
        .throwOnError();
    },
    async recordUsage({ userId, itemId, source, provider, model }) {
      const { data: existing, error: existingError } = await client
        .from('analysis_usage_events')
        .select('id')
        .eq('user_id', userId)
        .eq('item_id', itemId)
        .eq('source', source)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) return;

      const { error } = await client
        .from('analysis_usage_events')
        .upsert({ user_id: userId, item_id: itemId, source, provider, model }, { onConflict: 'user_id,item_id,source' });
      if (error) throw error;
      if (source === 'paid') {
        await this.addCreditTransaction({ userId, amount: -1, reason: 'item_analysis', itemId });
      }
    },
    async addCreditTransaction({ userId, amount, reason = 'manual', itemId = null, metadata = {} }) {
      const numericAmount = Number(amount || 0);
      if (!Number.isInteger(numericAmount) || numericAmount === 0) {
        throw new Error('Credit amount must be a non-zero whole number.');
      }
      const credits = await this.getCredits(userId);
      const nextPaidCredits = credits.paidCredits + numericAmount;
      if (nextPaidCredits < 0) throw new Error('Not enough paid credits.');
      await client
        .from('credit_transactions')
        .insert({ user_id: userId, amount: numericAmount, reason, item_id: itemId, metadata })
        .throwOnError();
      await client
        .from('user_credit_accounts')
        .update({ paid_credits: nextPaidCredits })
        .eq('user_id', userId)
        .throwOnError();
    },
    async addAdminCreditAdjustment({ userId, amount, reason, adminActor }) {
      await this.addCreditTransaction({
        userId,
        amount,
        reason: 'admin_adjustment',
        metadata: { reason, adminActor },
      });
      const { data, error } = await client
        .from('admin_credit_adjustments')
        .insert({ user_id: userId, amount, reason, admin_actor: adminActor })
        .select('*')
        .single();
      if (error) throw error;
      return { adjustment: data, credits: await this.getCredits(userId) };
    },
    async listProviderCredentials(userId) {
      const { data, error } = await client
        .from('user_provider_credentials')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data.map(mapCredential).map(publicCredential);
    },
    async saveProviderCredential(userId, { provider, purpose, model, apiKey, encryptionKey, status = 'active', isPreferred = true }) {
      assertProviderPurpose(provider, purpose);
      if (purpose === 'media' && provider === 'openrouter') assertMediaModelAllowed(model);
      if (!apiKey) throw new Error('API key is required.');

      if (isPreferred) {
        await client
          .from('user_provider_credentials')
          .update({ is_preferred: false })
          .eq('user_id', userId)
          .eq('purpose', purpose)
          .throwOnError();
      }

      const row = {
        user_id: userId,
        provider,
        purpose,
        model,
        encrypted_key: encryptSecret(apiKey, encryptionKey),
        key_hint: maskSecret(apiKey),
        status,
        is_preferred: isPreferred,
      };
      const { data, error } = await client
        .from('user_provider_credentials')
        .upsert(row, { onConflict: 'user_id,provider,purpose' })
        .select('*')
        .single();
      if (error) throw error;
      return publicCredential(mapCredential(data));
    },
    async getPreferredProviderCredential(userId, purpose, encryptionKey) {
      const { data, error } = await client
        .from('user_provider_credentials')
        .select('*')
        .eq('user_id', userId)
        .eq('purpose', purpose)
        .eq('status', 'active')
        .order('is_preferred', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? credentialWithSecret(data, encryptionKey) : null;
    },
    async getProviderCredential(userId, id, encryptionKey) {
      const { data, error } = await client
        .from('user_provider_credentials')
        .select('*')
        .eq('user_id', userId)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data ? credentialWithSecret(data, encryptionKey) : null;
    },
    async deleteProviderCredential(userId, id) {
      const { data, error } = await client
        .from('user_provider_credentials')
        .delete()
        .eq('user_id', userId)
        .eq('id', id)
        .select('id');
      if (error) throw error;
      return Boolean(data?.length);
    },
    async search(userId, query, filters = {}, options = {}) {
      const items = await this.getItems(userId);
      const { searchItems } = require('../services/analyzer');
      const keywordResults = searchItems(items, query, filters);
      if (!options.queryEmbedding) return keywordResults;

      const { data, error } = await client.rpc('match_saved_items', {
        p_user_id: userId,
        p_query_embedding: options.queryEmbedding,
        p_match_threshold: filters.semanticThreshold || 0.2,
        p_match_count: filters.limit || 30,
      });
      if (error) throw error;

      return mergeSearchResults({
        items,
        keywordResults,
        semanticMatches: data || [],
        filters,
      });
    },
  };
}

function mapImport(row) {
  return { id: row.id, userId: row.user_id, source: row.source, mode: row.mode, status: row.status };
}

function escapeSupabaseListValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function mapItem(row) {
  return {
    id: row.id,
    userId: row.user_id,
    importId: row.import_id,
    url: row.url,
    contentType: row.content_type,
    caption: row.caption,
    hashtags: row.hashtags || [],
    ownerName: row.owner_name,
    ownerUsername: row.owner_username,
    savedAt: row.saved_at_text,
    collections: row.collections || [],
    platform: row.platform || 'Instagram',
    platformKey: row.platform_key || 'instagram',
    sourceId: row.source_id || row.id,
    sourceTitle: row.source_title || '',
    sourceAuthor: row.source_author || '',
    sourceDescription: row.source_description || '',
    thumbnailUrl: row.thumbnail_url || '',
    status: row.status,
    error: row.error,
  };
}

function mapItemWithAnalysis(row) {
  const item = mapItem(row);
  const analysis = Array.isArray(row.item_analysis) ? row.item_analysis[0] : row.item_analysis;
  item.analysis = analysis ? {
    title: analysis.title,
    summary: analysis.summary,
    transcript: analysis.transcript,
    ocrText: analysis.ocr_text,
    visualDescription: analysis.visual_description,
    brandsMentioned: analysis.brands_mentioned || [],
    toolsMentioned: analysis.tools_mentioned || [],
    reposMentioned: analysis.repos_mentioned || [],
    peopleMentioned: analysis.people_mentioned || [],
    topics: analysis.topics || [],
    tags: analysis.tags || [],
    whyUseful: analysis.why_useful,
  } : null;
  return item;
}

function mapJob(row) {
  return {
    id: row.id,
    userId: row.user_id,
    importId: row.import_id,
    itemId: row.item_id,
    status: row.status,
    attempts: row.attempts,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toJobRow(patch) {
  return {
    status: patch.status,
    attempts: patch.attempts,
    error: patch.error,
  };
}

function toAnalysisRow(analysis) {
  return {
    title: analysis.title,
    summary: analysis.summary,
    transcript: analysis.transcript,
    ocr_text: analysis.ocrText,
    visual_description: analysis.visualDescription,
    brands_mentioned: analysis.brandsMentioned,
    tools_mentioned: analysis.toolsMentioned,
    repos_mentioned: analysis.reposMentioned,
    people_mentioned: analysis.peopleMentioned,
    topics: analysis.topics,
    tags: analysis.tags,
    why_useful: analysis.whyUseful,
  };
}

function mapCredential(row) {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    purpose: row.purpose,
    model: row.model,
    encryptedKey: row.encrypted_key,
    keyHint: row.key_hint,
    status: row.status,
    isPreferred: row.is_preferred,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function credentialWithSecret(row, encryptionKey) {
  const credential = mapCredential(row);
  return {
    ...publicCredential(credential),
    apiKey: decryptSecret(credential.encryptedKey, encryptionKey),
  };
}

function mapCreditPackage(row) {
  return normalizePackage(row);
}

function mapCreditPurchase(row) {
  return {
    id: row.id,
    userId: row.user_id,
    packageId: row.package_id,
    credits: row.credits,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function mapFeedback(row) {
  return {
    id: row.id,
    feature: row.feature,
    message: row.message,
    displayName: row.display_name || 'Anonymous user',
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapProfile(row) {
  return publicProfile({
    userId: row.user_id,
    username: row.username,
    avatarUrl: row.avatar_url || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function matchesFilters(item, filters = {}) {
  if (filters.contentType && item.contentType !== filters.contentType) return false;
  return true;
}

function mergeSearchResults({ items, keywordResults, semanticMatches, filters = {} }) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const scores = new Map();

  keywordResults.forEach((item, index) => {
    const score = 1 + (keywordResults.length - index) / Math.max(keywordResults.length, 1);
    scores.set(item.id, (scores.get(item.id) || 0) + score);
  });

  semanticMatches.forEach((match) => {
    const item = byId.get(match.item_id);
    if (!item || !matchesFilters(item, filters)) return;
    scores.set(item.id, (scores.get(item.id) || 0) + Number(match.similarity || 0) * 2);
  });

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => byId.get(id))
    .filter(Boolean)
    .slice(0, filters.limit || 30);
}

module.exports = {
  createSupabaseStore,
};
