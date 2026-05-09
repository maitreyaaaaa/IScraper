const { createClient } = require('@supabase/supabase-js');
const { decryptSecret, encryptSecret, maskSecret, publicCredential } = require('../services/credentials');
const { assertMediaModelAllowed, assertProviderPurpose } = require('../services/providers');
const { DEFAULT_CREDIT_PACKAGES, FREE_ITEMS_LIMIT, normalizePackage } = require('../services/credits');
const { normalizeUsername, publicProfile } = require('../services/profiles');
const { publicExtensionToken } = require('../services/extensionTokens');

const EXISTING_ITEM_LOOKUP_BATCH_SIZE = 100;
const IMPORT_INSERT_BATCH_SIZE = 500;

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
    async getUserAdminState(userId) {
      const { data, error } = await client
        .from('user_admin_states')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error && error.code === '42P01') return { userId, status: 'active' };
      if (error) throw error;
      return data ? mapUserAdminState(data) : { userId, status: 'active' };
    },
    async setUserBlocked({ userId, blocked, reason, adminActor }) {
      const { data: user, error: userError } = await client.from('users').select('*').eq('id', userId).maybeSingle();
      if (userError) throw userError;
      if (!user) return null;
      await client
        .from('user_admin_states')
        .upsert({
          user_id: userId,
          status: blocked ? 'blocked' : 'active',
          blocked_at: blocked ? new Date().toISOString() : null,
          blocked_reason: blocked ? reason : null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })
        .throwOnError();
      await this.recordUserActivity({
        userId,
        eventType: blocked ? 'admin_blocked' : 'admin_unblocked',
        metadata: { reason, adminActor },
      });
      return this.getAdminUserDetail(userId);
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
    async createExtensionToken(userId, { tokenHash, name, scopes, expiresAt }) {
      const { data, error } = await client
        .from('extension_tokens')
        .insert({
          user_id: userId,
          token_hash: tokenHash,
          name: String(name || 'Browser extension').trim().slice(0, 80),
          scopes,
          expires_at: expiresAt,
        })
        .select('*')
        .single();
      if (error) throw error;
      return publicExtensionToken(mapExtensionToken(data));
    },
    async listExtensionTokens(userId) {
      const { data, error } = await client
        .from('extension_tokens')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(mapExtensionToken).map(publicExtensionToken);
    },
    async revokeExtensionToken(userId, id) {
      const { data, error } = await client
        .from('extension_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('id', id)
        .select('id');
      if (error) throw error;
      return Boolean(data?.length);
    },
    async getUserForExtensionToken(tokenHash, requiredScope = 'lens:search') {
      const { data, error } = await client
        .from('extension_tokens')
        .select('*')
        .eq('token_hash', tokenHash)
        .is('revoked_at', null)
        .maybeSingle();
      if (error) throw error;
      const token = data ? mapExtensionToken(data) : null;
      const expired = token?.expiresAt && new Date(token.expiresAt).getTime() <= Date.now();
      if (!token || expired || !(token.scopes || []).includes(requiredScope)) return null;
      await client
        .from('extension_tokens')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', token.id)
        .throwOnError();
      return { id: token.userId, email: '' };
    },
    async recordLensSearchEvent({ userId, queryType, resultCount }) {
      await client
        .from('lens_search_events')
        .insert({ user_id: userId, query_type: queryType, result_count: Number(resultCount || 0) })
        .throwOnError();
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
    async listAdminFeedback({ limit = 100 } = {}) {
      const { data, error } = await client
        .from('public_feedback')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data.map(mapFeedback);
    },
    async setFeedbackStatus(id, status) {
      const { data, error } = await client
        .from('public_feedback')
        .update({ status })
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? mapFeedback(data) : null;
    },
    async createImport({ userId, source, mode = 'export', fileNames = [] }) {
      const { data, error } = await client
        .from('imports')
        .insert({ user_id: userId, source, mode, file_names: fileNames, status: 'imported' })
        .select('*')
        .single();
      if (error) throw error;
      await this.recordUserActivity({
        userId,
        eventType: 'import_created',
        metadata: { importId: data.id, source, fileCount: fileNames.length },
      });
      return mapImport(data);
    },
    async upsertImportData({ userId, importId, parsed, initialStatus = 'queued' }) {
      if (!parsed.items.length) return [];

      const ids = [...new Set(parsed.items.map((item) => item.id).filter(Boolean))];
      const urls = [...new Set(parsed.items.map((item) => item.url).filter(Boolean))];
      const existingKeys = await getExistingSavedItemKeys(client, { userId, ids, urls });

      const items = parsed.items
        .filter((item) => !existingKeys.has(`id:${item.id}`) && !existingKeys.has(`url:${item.url}`))
        .map((item) => ({
        id: cleanDbText(item.id),
        user_id: userId,
        import_id: importId,
        url: cleanDbText(item.url),
        content_type: cleanDbText(item.contentType),
        caption: cleanDbText(item.caption),
        hashtags: cleanTextArray(item.hashtags),
        owner_name: cleanDbText(item.ownerName),
        owner_username: cleanDbText(item.ownerUsername),
        saved_at_text: cleanDbText(item.savedAt),
        collections: cleanTextArray(item.collections),
        platform: cleanDbText(item.platform || 'Instagram'),
        platform_key: cleanDbText(item.platformKey || 'instagram'),
        source_id: cleanDbText(item.sourceId || item.id),
        source_title: cleanDbText(item.sourceTitle || ''),
        source_author: cleanDbText(item.sourceAuthor || item.ownerUsername || item.ownerName || ''),
        source_description: cleanDbText(item.sourceDescription || ''),
        thumbnail_url: cleanDbText(item.thumbnailUrl || ''),
        status: initialStatus,
      }));
      if (!items.length) return [];
      const inserted = [];
      for (const batch of chunkValues(items, IMPORT_INSERT_BATCH_SIZE)) {
        const { data, error } = await client.from('saved_items').insert(batch).select('*');
        if (error) throw error;
        inserted.push(...(data || []));
      }
      return inserted.map(mapItem);
    },
    async updateSavedItem(userId, id, patch = {}) {
      const { data, error } = await client
        .from('saved_items')
        .update(toSavedItemPatch(patch))
        .eq('user_id', userId)
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? mapItem(data) : null;
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
    async getProcessableJobScopes({ limit = 10 } = {}) {
      const { data, error } = await client
        .from('processing_jobs')
        .select('user_id,import_id')
        .eq('status', 'queued')
        .order('created_at')
        .limit(Math.max(1, Math.min(Number(limit) || 10, 100)));
      if (error) throw error;
      const seen = new Set();
      const scopes = [];
      for (const row of data || []) {
        const key = `${row.user_id}:${row.import_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        scopes.push({ userId: row.user_id, importId: row.import_id });
      }
      return scopes;
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
    async claimJob(userId, id, patch) {
      const { data, error } = await client
        .from('processing_jobs')
        .update(toJobRow(patch))
        .eq('user_id', userId)
        .eq('id', id)
        .eq('status', 'queued')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? mapJob(data) : null;
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
      await this.recordUserActivity({
        userId,
        eventType: 'analysis_used',
        metadata: { itemId, source, provider, model },
      });
      if (source === 'paid') {
        await this.addCreditTransaction({ userId, amount: -1, reason: 'item_analysis', itemId });
      }
    },
    async recordUserActivity({ userId, eventType, metadata = {} }) {
      const { data, error } = await client
        .from('user_activity_events')
        .insert({ user_id: userId, event_type: eventType, metadata })
        .select('*')
        .single();
      if (error && error.code === '42P01') return null;
      if (error) throw error;
      return mapUserActivity(data);
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
    async getAdminSummary() {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [totalUsers, newToday, newThisWeek, totalItems, indexed, queued, failed, needsReview, feedbackTotal, feedbackVisible] = await Promise.all([
        countRows(client, 'users'),
        countRows(client, 'users', (query) => query.gte('created_at', dayAgo)),
        countRows(client, 'users', (query) => query.gte('created_at', weekAgo)),
        countRows(client, 'saved_items'),
        countRows(client, 'saved_items', (query) => query.eq('status', 'done')),
        countRows(client, 'saved_items', (query) => query.eq('status', 'queued')),
        countRows(client, 'saved_items', (query) => query.eq('status', 'failed')),
        countRows(client, 'saved_items', (query) => query.eq('status', 'needs_review')),
        countRows(client, 'public_feedback'),
        countRows(client, 'public_feedback', (query) => query.eq('status', 'visible')),
      ]);
      const usageRows = await selectRows(client, 'analysis_usage_events', 'source', 10000);
      const purchaseRows = await selectRows(client, 'credit_purchases', 'status,amount_cents', 10000);
      const transactionRows = await selectRows(client, 'credit_transactions', 'amount', 10000);
      const usageBySource = countField(usageRows, 'source');
      const completedPurchases = purchaseRows.filter((row) => row.status === 'completed');

      return {
        users: { total: totalUsers, newToday, newThisWeek },
        items: {
          total: totalItems,
          indexed,
          queued,
          failed,
          needsReview,
          byStatus: { done: indexed, queued, failed, needs_review: needsReview },
        },
        credits: {
          freeUsed: usageBySource.free || 0,
          paidUsed: usageBySource.paid || 0,
          byokUsed: usageBySource.byok || 0,
          paidCreditsAvailable: transactionRows.reduce((total, row) => total + Number(row.amount || 0), 0),
        },
        purchases: {
          completed: completedPurchases.length,
          revenueCents: completedPurchases.reduce((total, row) => total + Number(row.amount_cents || 0), 0),
        },
        feedback: { total: feedbackTotal, visible: feedbackVisible },
      };
    },
    async listAdminUsers({ query = '', limit = 50, offset = 0 } = {}) {
      const search = String(query || '').trim();
      let profileUserIds = [];
      if (search) {
        const { data: profileMatches, error: profileError } = await client
          .from('user_profiles')
          .select('user_id')
          .ilike('username', `%${search}%`)
          .limit(100);
        if (profileError) throw profileError;
        profileUserIds = (profileMatches || []).map((row) => row.user_id);
      }

      let usersQuery = client.from('users').select('*', { count: 'exact' }).order('created_at', { ascending: false });
      if (search) {
        const filters = [`email.ilike.%${search}%`];
        if (profileUserIds.length) filters.push(`id.in.(${profileUserIds.join(',')})`);
        usersQuery = usersQuery.or(filters.join(','));
      }
      const { data, error, count } = await usersQuery.range(offset, offset + limit - 1);
      if (error) throw error;
      const users = await Promise.all((data || []).map((user) => this.getAdminUserSummary(user)));
      return { users, total: count || 0, limit, offset };
    },
    async getAdminUserSummary(user) {
      const [profile, credits, itemStats, usageStats, adminState] = await Promise.all([
        this.getProfile(user.id),
        this.getCredits(user.id),
        getUserItemStats(client, user.id),
        getUserUsageStats(client, user.id),
        this.getUserAdminState(user.id),
      ]);
      return {
        id: user.id,
        email: user.email,
        createdAt: user.created_at,
        lastSignInAt: null,
        profile,
        adminState,
        credits,
        itemStats,
        usageStats,
      };
    },
    async getAdminUserDetail(userId) {
      const { data: user, error } = await client.from('users').select('*').eq('id', userId).maybeSingle();
      if (error) throw error;
      if (!user) return null;
      const [summary, transactions, purchases, adjustments] = await Promise.all([
        this.getAdminUserSummary(user),
        selectUserRows(client, 'credit_transactions', userId, '*', 100),
        selectUserRows(client, 'credit_purchases', userId, '*', 50),
        selectUserRows(client, 'admin_credit_adjustments', userId, '*', 50),
      ]);

      return {
        ...summary,
        creditTransactions: transactions.map(mapCreditTransaction),
        purchases: purchases.map(mapCreditPurchase),
        adminAdjustments: adjustments.map(mapAdminCreditAdjustment),
      };
    },
    async listAdminImports({ limit = 50 } = {}) {
      const { data, error } = await client
        .from('imports')
        .select('*, users(id,email)')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return Promise.all((data || []).map(async (row) => {
        const [itemCount, jobs] = await Promise.all([
          countRows(client, 'saved_items', (query) => query.eq('import_id', row.id)),
          selectRows(client, 'processing_jobs', 'status', 10000, (query) => query.eq('import_id', row.id)),
        ]);
        return {
          ...mapImport(row),
          createdAt: row.created_at,
          fileNames: row.file_names || [],
          user: row.users || null,
          itemCount,
          jobStats: countField(jobs, 'status'),
        };
      }));
    },
    async listAdminActivity({ limit = 100 } = {}) {
      const { data, error } = await client
        .from('user_activity_events')
        .select('*, users(id,email)')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error && error.code === '42P01') return [];
      if (error) throw error;
      return data.map((row) => ({ ...mapUserActivity(row), user: row.users || null }));
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

function chunkValues(values, size = EXISTING_ITEM_LOOKUP_BATCH_SIZE) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function addExistingSavedItemKeys(client, { userId, field, values, existingKeys }) {
  for (const batch of chunkValues(values)) {
    const { data, error } = await client
      .from('saved_items')
      .select('id,url')
      .eq('user_id', userId)
      .in(field, batch);
    if (error) throw error;
    for (const row of data || []) {
      existingKeys.add(`id:${row.id}`);
      existingKeys.add(`url:${row.url}`);
    }
  }
}

async function getExistingSavedItemKeys(client, { userId, ids = [], urls = [] }) {
  const existingKeys = new Set();
  await addExistingSavedItemKeys(client, {
    userId,
    field: 'id',
    values: ids,
    existingKeys,
  });
  await addExistingSavedItemKeys(client, {
    userId,
    field: 'url',
    values: urls,
    existingKeys,
  });
  return existingKeys;
}

function cleanDbText(value) {
  if (value == null) return value;
  const text = String(value);
  let clean = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        clean += text[index] + text[index + 1];
        index += 1;
      }
      continue;
    }
    if (code >= 0xDC00 && code <= 0xDFFF) continue;
    clean += text[index];
  }
  return clean;
}

function cleanTextArray(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => cleanDbText(value)).filter(Boolean);
}

async function countRows(client, table, apply = null) {
  let query = client.from(table).select('*', { count: 'exact', head: true });
  if (apply) query = apply(query);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function selectRows(client, table, columns = '*', limit = 1000, apply = null) {
  let query = client.from(table).select(columns).limit(limit);
  if (apply) query = apply(query);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function selectUserRows(client, table, userId, columns = '*', limit = 100) {
  const { data, error } = await client
    .from(table)
    .select(columns)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

function countField(rows, field) {
  return rows.reduce((stats, row) => {
    stats[row[field] || 'unknown'] = (stats[row[field] || 'unknown'] || 0) + 1;
    return stats;
  }, {});
}

async function getUserItemStats(client, userId) {
  const rows = await selectUserRows(client, 'saved_items', userId, 'status', 10000);
  const byStatus = countField(rows, 'status');
  return {
    total: rows.length,
    indexed: byStatus.done || 0,
    queued: byStatus.queued || 0,
    failed: byStatus.failed || 0,
    needsReview: byStatus.needs_review || 0,
    byStatus,
  };
}

async function getUserUsageStats(client, userId) {
  const rows = await selectUserRows(client, 'analysis_usage_events', userId, 'source', 10000);
  return countField(rows, 'source');
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

function toSavedItemPatch(patch = {}) {
  const row = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'importId')) row.import_id = patch.importId;
  if (Object.prototype.hasOwnProperty.call(patch, 'caption')) row.caption = patch.caption;
  if (Object.prototype.hasOwnProperty.call(patch, 'collections')) row.collections = patch.collections;
  if (Object.prototype.hasOwnProperty.call(patch, 'sourceTitle')) row.source_title = patch.sourceTitle;
  if (Object.prototype.hasOwnProperty.call(patch, 'sourceAuthor')) row.source_author = patch.sourceAuthor;
  if (Object.prototype.hasOwnProperty.call(patch, 'sourceDescription')) row.source_description = patch.sourceDescription;
  if (Object.prototype.hasOwnProperty.call(patch, 'thumbnailUrl')) row.thumbnail_url = patch.thumbnailUrl;
  if (Object.prototype.hasOwnProperty.call(patch, 'platform')) row.platform = patch.platform;
  if (Object.prototype.hasOwnProperty.call(patch, 'platformKey')) row.platform_key = patch.platformKey;
  if (Object.prototype.hasOwnProperty.call(patch, 'sourceId')) row.source_id = patch.sourceId;
  if (Object.prototype.hasOwnProperty.call(patch, 'status')) row.status = patch.status;
  if (Object.prototype.hasOwnProperty.call(patch, 'error')) row.error = patch.error;
  return row;
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

function mapCreditTransaction(row) {
  return {
    id: row.id,
    userId: row.user_id,
    amount: row.amount,
    reason: row.reason,
    itemId: row.item_id,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

function mapAdminCreditAdjustment(row) {
  return {
    id: row.id,
    userId: row.user_id,
    amount: row.amount,
    reason: row.reason,
    adminActor: row.admin_actor,
    createdAt: row.created_at,
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

function mapUserAdminState(row) {
  return {
    userId: row.user_id,
    status: row.status || 'active',
    blockedAt: row.blocked_at,
    blockedReason: row.blocked_reason || '',
    updatedAt: row.updated_at,
  };
}

function mapUserActivity(row) {
  return {
    id: row.id,
    userId: row.user_id,
    eventType: row.event_type,
    metadata: row.metadata || {},
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

function mapExtensionToken(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    scopes: row.scopes || [],
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

function matchesFilters(item, filters = {}) {
  if (filters.contentType && item.contentType !== filters.contentType) return false;
  if (filters.status && item.status !== filters.status) return false;
  if (filters.platform && item.platform !== filters.platform) return false;
  if (filters.collection && !(item.collections || []).includes(filters.collection)) return false;
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
  getExistingSavedItemKeys,
  cleanDbText,
};
