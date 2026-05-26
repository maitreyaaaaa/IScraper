const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { decryptSecret, encryptSecret, maskSecret, publicCredential } = require('../services/credentials');
const {
  OPENAI_COMPATIBLE_PROVIDER,
  assertMediaModelAllowed,
  assertOpenAICompatibleConfig,
  assertProviderPurpose,
  normalizeOpenAICompatibleBaseUrl,
  normalizeOpenAICompatibleDisplayName,
} = require('../services/providers');
const { DEFAULT_CREDIT_PACKAGES, FREE_ITEMS_LIMIT, normalizePackage } = require('../services/credits');
const { normalizeUsername, publicProfile } = require('../services/profiles');
const { publicExtensionToken } = require('../services/extensionTokens');
const { searchItemsWithDetails } = require('../services/analyzer');
const {
  DEFAULT_MAX_JOB_ATTEMPTS,
  PAUSED_JOB_STATUSES,
  summarizeJobQueue,
} = require('../services/queue');
const { ACTIVE_DELETION_STATUSES, hashDeletionValue } = require('../services/accountDeletion');
const { NOTE_ASSET_BUCKET, publicNoteAsset } = require('../services/notes');
const { facetsForItems, listItemsPageFromItems, normalizeListOptions } = require('../services/itemList');
const {
  DEFAULT_VISIBLE_COLLECTIONS_LIMIT,
  generateSmartCollectionCandidates,
  publicSmartCollection,
  sortSmartCollections,
} = require('../services/smartCollections');
const { publicArchive } = require('../services/pageArchive');
const { publicLinkHealth, publicReminder } = require('../services/libraryCare');

const EXISTING_ITEM_LOOKUP_BATCH_SIZE = 100;
const IMPORT_INSERT_BATCH_SIZE = 500;
const JOB_INSERT_BATCH_SIZE = 500;
const SEARCH_ITEM_COLUMNS = [
  'id',
  'user_id',
  'import_id',
  'url',
  'content_type',
  'caption',
  'hashtags',
  'owner_name',
  'owner_username',
  'saved_at_text',
  'collections',
  'platform',
  'platform_key',
  'source_id',
  'source_title',
  'source_author',
  'source_description',
  'thumbnail_url',
  'status',
  'error',
  'created_at',
  'updated_at',
  'item_analysis(title,summary,transcript,ocr_text,visual_description,brands_mentioned,tools_mentioned,repos_mentioned,people_mentioned,topics,tags,why_useful)',
].join(',');

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
      await this.assertUserNotDeleted(userId, email);
      await this.ensureUserRecord(userId, email);
    },
    async ensureUserRecord(userId, email) {
      const [
        { data: userRow, error: userError },
        { data: creditRow, error: creditError },
      ] = await Promise.all([
        client.from('users').select('id,email').eq('id', userId).maybeSingle(),
        client.from('user_credit_accounts').select('user_id').eq('user_id', userId).maybeSingle(),
      ]);
      if (userError) throw userError;
      if (creditError) throw creditError;

      const writes = [];
      if (!userRow || userRow.email !== email) {
        writes.push(client.from('users').upsert({ id: userId, email }, { onConflict: 'id' }).throwOnError());
      }
      if (!creditRow) {
        writes.push(
          client
            .from('user_credit_accounts')
            .upsert({ user_id: userId, free_items_limit: FREE_ITEMS_LIMIT }, { onConflict: 'user_id' })
            .throwOnError(),
        );
      }
      if (writes.length) await Promise.all(writes);
    },
    async assertUserNotDeleted(userId, email) {
      const userIdHash = hashDeletionValue(userId);
      const emailHash = hashDeletionValue(email);
      const { data: auditRows, error } = await client
        .from('account_deletion_audit')
        .select('id')
        .eq('status', 'completed')
        .or(`user_id_hash.eq.${userIdHash},email_hash.eq.${emailHash}`)
        .limit(1);
      if (error && error.code === '42P01') return;
      if (error) throw error;
      if (auditRows?.length) {
        const deleted = new Error('This account has been deleted. Contact support if this looks wrong.');
        deleted.statusCode = 410;
        throw deleted;
      }
      const { data: detachedRequests, error: requestError } = await client
        .from('account_deletion_requests')
        .select('id,status')
        .is('user_id', null)
        .in('status', [...ACTIVE_DELETION_STATUSES, 'completed'])
        .or(`user_id_hash.eq.${userIdHash},email_hash.eq.${emailHash}`)
        .limit(1);
      if (requestError && requestError.code === '42P01') return;
      if (requestError) throw requestError;
      if (detachedRequests?.length) {
        const deleted = new Error('This account is pending deletion or has been deleted. Contact support if this looks wrong.');
        deleted.statusCode = detachedRequests[0].status === 'completed' ? 410 : 423;
        throw deleted;
      }
    },
    async getActiveDeletionRequest(userId) {
      const { data, error } = await client
        .from('account_deletion_requests')
        .select('*, account_deletion_steps(*)')
        .eq('user_id', userId)
        .in('status', [...ACTIVE_DELETION_STATUSES])
        .order('requested_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error && error.code === '42P01') return null;
      if (error) throw error;
      return data ? mapDeletionRequest(data) : null;
    },
    async getDeletionRequestById(id) {
      const { data, error } = await client
        .from('account_deletion_requests')
        .select('*, account_deletion_steps(*)')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data ? mapDeletionRequest(data) : null;
    },
    async createDeletionRequest({ userId, email, reason = '', exportConfirmed = false }) {
      const active = await this.getActiveDeletionRequest(userId);
      if (active) return active;
      const row = {
        user_id: userId,
        user_id_hash: hashDeletionValue(userId),
        email_hash: hashDeletionValue(email),
        status: 'pending_approval',
        reason: String(reason || '').trim().slice(0, 500),
        export_confirmed: Boolean(exportConfirmed),
        status_message: 'Deletion request is waiting for admin review.',
      };
      const { data, error } = await client
        .from('account_deletion_requests')
        .insert(row)
        .select('*, account_deletion_steps(*)')
        .single();
      if (error?.code === '23505') return this.getActiveDeletionRequest(userId);
      if (error) throw error;
      return mapDeletionRequest(data);
    },
    async cancelDeletionRequestForUser(userId) {
      const active = await this.getActiveDeletionRequest(userId);
      if (!active || !['requested', 'pending_approval'].includes(active.status)) return null;
      const { data, error } = await client
        .from('account_deletion_requests')
        .update({
          status: 'canceled',
          canceled_at: new Date().toISOString(),
          status_message: 'Deletion request canceled by user.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', active.id)
        .select('*, account_deletion_steps(*)')
        .single();
      if (error) throw error;
      return mapDeletionRequest(data);
    },
    async listDeletionRequests({ limit = 50 } = {}) {
      const { data, error } = await client
        .from('account_deletion_requests')
        .select('*, account_deletion_steps(*)')
        .order('requested_at', { ascending: false })
        .limit(Math.max(1, Math.min(Number(limit) || 50, 100)));
      if (error) throw error;
      return (data || []).map(mapDeletionRequest);
    },
    async approveDeletionRequest({ id, adminActor }) {
      const { data, error } = await client
        .from('account_deletion_requests')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          admin_actor: adminActor,
          status_message: 'Deletion request approved. Waiting for execution.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .in('status', ['requested', 'pending_approval', 'partially_failed'])
        .select('*, account_deletion_steps(*)')
        .maybeSingle();
      if (error) throw error;
      return data ? mapDeletionRequest(data) : this.getDeletionRequestById(id);
    },
    async cancelDeletionRequestAsAdmin({ id, adminActor, reason = '' }) {
      const existing = await this.getDeletionRequestById(id);
      if (!existing) return null;
      if (['executing', 'completed'].includes(existing.status)) return existing;
      const { data, error } = await client
        .from('account_deletion_requests')
        .update({
          status: 'canceled',
          canceled_at: new Date().toISOString(),
          admin_actor: adminActor,
          status_message: String(reason || 'Deletion request canceled by admin.').slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*, account_deletion_steps(*)')
        .maybeSingle();
      if (error) throw error;
      return data ? mapDeletionRequest(data) : this.getDeletionRequestById(id);
    },
    async markDeletionRequestExecuting(id) {
      const { data, error } = await client
        .from('account_deletion_requests')
        .update({
          status: 'executing',
          executing_at: new Date().toISOString(),
          status_message: 'Deletion is executing.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*, account_deletion_steps(*)')
        .single();
      if (error) throw error;
      return mapDeletionRequest(data);
    },
    async markDeletionRequestPartiallyFailed(id, message) {
      const { data, error } = await client
        .from('account_deletion_requests')
        .update({
          status: 'partially_failed',
          status_message: String(message || 'Deletion partially failed. Admin retry is required.').slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*, account_deletion_steps(*)')
        .single();
      if (error) throw error;
      return mapDeletionRequest(data);
    },
    async recordDeletionStep({ requestId, stepKey, status, error = '', metadata = {} }) {
      const nowIso = new Date().toISOString();
      const row = {
        request_id: requestId,
        step_key: stepKey,
        status,
        redacted_error: error || null,
        metadata,
        updated_at: nowIso,
      };
      if (status === 'running') row.started_at = nowIso;
      if (['completed', 'failed', 'skipped'].includes(status)) row.finished_at = nowIso;
      const { data: existing, error: existingError } = await client
        .from('account_deletion_steps')
        .select('attempts,metadata')
        .eq('request_id', requestId)
        .eq('step_key', stepKey)
        .maybeSingle();
      if (existingError) throw existingError;
      row.attempts = Number(existing?.attempts || 0) + (status === 'running' ? 1 : 0);
      row.metadata = { ...(existing?.metadata || {}), ...(metadata || {}) };
      const { data, error: upsertError } = await client
        .from('account_deletion_steps')
        .upsert(row, { onConflict: 'request_id,step_key' })
        .select('*')
        .single();
      if (upsertError) throw upsertError;
      return mapDeletionStep(data);
    },
    async freezeUserForDeletion(userId) {
      const timestamp = new Date().toISOString();
      const [tokenResult, credentialResult, jobResult] = await Promise.all([
        client.from('extension_tokens').update({ revoked_at: timestamp }).eq('user_id', userId).is('revoked_at', null).select('id'),
        client.from('user_provider_credentials').update({ status: 'disabled', updated_at: timestamp }).eq('user_id', userId).neq('status', 'disabled').select('id'),
        client
          .from('processing_jobs')
          .update({ status: 'failed', error: 'Account deletion requested.', lease_owner: null, lease_token: null, lease_expires_at: null, next_attempt_at: null, updated_at: timestamp })
          .eq('user_id', userId)
          .in('status', ['queued', 'downloading', 'analyzing', ...PAUSED_JOB_STATUSES])
          .select('id'),
      ]);
      [tokenResult, credentialResult, jobResult].forEach(({ error }) => {
        if (error) throw error;
      });
      return {
        revokedTokens: tokenResult.data?.length || 0,
        disabledCredentials: credentialResult.data?.length || 0,
        canceledJobs: jobResult.data?.length || 0,
      };
    },
    async deleteUserStorageObjects(userId) {
      if (!client.storage) return { deletedObjects: 0, buckets: [], skipped: true };
      const buckets = ['import-uploads', 'instagram-assets', NOTE_ASSET_BUCKET];
      let deletedObjects = 0;
      const bucketResults = [];
      for (const bucket of buckets) {
        const paths = await listStoragePathsForPrefix(client, bucket, userId);
        for (let index = 0; index < paths.length; index += 100) {
          const batch = paths.slice(index, index + 100);
          if (!batch.length) continue;
          const { error } = await client.storage.from(bucket).remove(batch);
          if (error) throw error;
          deletedObjects += batch.length;
        }
        bucketResults.push({ bucket, deletedObjects: paths.length });
      }
      return { deletedObjects, buckets: bucketResults };
    },
    async deleteUserContentData(userId) {
      const tables = ['search_result_feedback', 'search_events', 'processing_jobs', 'smart_collection_items', 'smart_collections', 'item_embeddings', 'item_analysis', 'item_assets', 'item_archives', 'link_health_checks', 'item_reminders', 'saved_items', 'collections', 'imports', 'lens_search_events'];
      return deleteUserRowsFromTables(client, userId, tables);
    },
    async deleteUserAccessData(userId) {
      return deleteUserRowsFromTables(client, userId, ['capture_connections', 'user_provider_credentials', 'extension_tokens', 'user_ai_keys']);
    },
    async deleteUserProfileData(userId) {
      const retainedPurchases = await retainCompletedCreditPurchases(client, userId);
      const deleted = await deleteUserRowsFromTables(client, userId, [
        'user_profiles',
        'user_admin_states',
        'user_activity_events',
        'analysis_usage_events',
        'credit_transactions',
        'admin_credit_adjustments',
        'user_credit_accounts',
      ]);
      const pendingPurchases = await deleteUserRowsFromTables(client, userId, ['credit_purchases']);
      return { ...deleted, credit_purchases: pendingPurchases.credit_purchases || 0, retainedCreditPurchases: retainedPurchases };
    },
    async deleteAuthUser(userId) {
      const { error } = await client.auth.admin.deleteUser(userId);
      if (error && !/not found/i.test(error.message || '')) throw error;
      return { deleted: true };
    },
    async completeDeletionRequest(id, { actor, retentionSummary }) {
      const request = await this.getDeletionRequestById(id);
      if (!request) return null;
      await client
        .from('account_deletion_audit')
        .insert({
          request_id: request.id,
          user_id_hash: request.userIdHash,
          email_hash: request.emailHash,
          status: 'completed',
          actor,
          retained_categories: retentionSummary?.retained || [],
          summary: retentionSummary || {},
        })
        .throwOnError();
      if (request.userId) {
        await client.from('users').delete().eq('id', request.userId).throwOnError();
      }
      const { data, error } = await client
        .from('account_deletion_requests')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          status_message: 'Account deletion completed.',
          retention_summary: retentionSummary || {},
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*, account_deletion_steps(*)')
        .single();
      if (error) throw error;
      return mapDeletionRequest(data);
    },
    async getPrivacyExport(userId) {
      const [items, itemArchives, linkHealthChecks, itemReminders, imports, collections, smartCollections, smartCollectionItems, credentials, extensionTokens, captureConnections, searchEvents, searchFeedback, profile, credits, deletionRequest] = await Promise.all([
        this.getItems(userId),
        selectAllUserRows(client, 'item_archives', userId, '*', (query) => query.order('updated_at', { ascending: false })),
        selectAllUserRows(client, 'link_health_checks', userId, '*', (query) => query.order('checked_at', { ascending: false })),
        selectAllUserRows(client, 'item_reminders', userId, '*', (query) => query.order('remind_at', { ascending: false })),
        selectAllUserRows(client, 'imports', userId, '*', (query) => query.order('created_at', { ascending: false })),
        selectAllUserRows(client, 'collections', userId, '*', (query) => query.order('created_at', { ascending: false })),
        selectAllUserRows(client, 'smart_collections', userId, '*', (query) => query.order('updated_at', { ascending: false })),
        selectAllUserRows(client, 'smart_collection_items', userId, '*', (query) => query.order('updated_at', { ascending: false })),
        this.listProviderCredentials(userId),
        this.listExtensionTokens(userId),
        this.listCaptureConnections(userId),
        selectAllUserRows(client, 'search_events', userId, '*', (query) => query.order('created_at', { ascending: false })),
        selectAllUserRows(client, 'search_result_feedback', userId, '*', (query) => query.order('created_at', { ascending: false })),
        this.getProfile(userId),
        this.getCredits(userId),
        this.getActiveDeletionRequest(userId),
      ]);
      return {
        exportedAt: new Date().toISOString(),
        items,
        itemArchives: itemArchives.map((row) => mapArchiveRow(row, { includeContent: true })),
        linkHealthChecks: linkHealthChecks.map(mapLinkHealthRow),
        itemReminders: itemReminders.map(mapReminderRow),
        imports: imports.map(mapImport),
        collections,
        smartCollections,
        smartCollectionItems,
        credits,
        providerCredentials: credentials,
        extensionTokens,
        captureConnections,
        searchEvents: searchEvents.map(mapSearchEvent),
        searchFeedback: searchFeedback.map(mapSearchFeedback),
        profile,
        deletion: deletionRequest,
      };
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
    async upsertCaptureConnection(userId, { provider, externalId, tokenHash, username = '', displayName = '' }) {
      const normalizedProvider = String(provider || '').trim().toLowerCase();
      const normalizedExternalId = String(externalId || '').trim();
      if (!normalizedProvider || !normalizedExternalId || !tokenHash) return null;
      const { data, error } = await client
        .from('capture_connections')
        .upsert({
          user_id: userId,
          provider: normalizedProvider,
          external_id: normalizedExternalId,
          token_hash: tokenHash,
          username: cleanDbText(username).slice(0, 120),
          display_name: cleanDbText(displayName).slice(0, 160),
          revoked_at: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'provider,external_id' })
        .select('*')
        .single();
      if (error) throw error;
      return publicCaptureConnection(mapCaptureConnection(data));
    },
    async getCaptureConnection(provider, externalId) {
      const { data, error } = await client
        .from('capture_connections')
        .select('*')
        .eq('provider', String(provider || '').trim().toLowerCase())
        .eq('external_id', String(externalId || '').trim())
        .is('revoked_at', null)
        .maybeSingle();
      if (error) throw error;
      return data ? mapCaptureConnection(data) : null;
    },
    async markCaptureConnectionUsed(id) {
      const { data, error } = await client
        .from('capture_connections')
        .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? publicCaptureConnection(mapCaptureConnection(data)) : null;
    },
    async revokeCaptureConnection(provider, externalId) {
      const { data, error } = await client
        .from('capture_connections')
        .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('provider', String(provider || '').trim().toLowerCase())
        .eq('external_id', String(externalId || '').trim())
        .is('revoked_at', null)
        .select('id');
      if (error) throw error;
      return Boolean(data?.length);
    },
    async listCaptureConnections(userId) {
      const { data, error } = await client
        .from('capture_connections')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data.map(mapCaptureConnection).map(publicCaptureConnection);
    },
    async recordLensSearchEvent({ userId, queryType, resultCount }) {
      await client
        .from('lens_search_events')
        .insert({ user_id: userId, query_type: queryType, result_count: Number(resultCount || 0) })
        .throwOnError();
    },
    async recordSearchEvent({ id, userId, query, queryLength = 0, filters = {}, resultCount = 0, includeAi = false, resultIds = [] }) {
      const { data, error } = await client
        .from('search_events')
        .insert({
          id,
          user_id: userId,
          query: cleanDbText(query).slice(0, 240),
          query_length: Number(queryLength || 0),
          filters,
          result_count: Number(resultCount || 0),
          include_ai: Boolean(includeAi),
          result_ids: Array.isArray(resultIds) ? resultIds.slice(0, 30) : [],
        })
        .select('*')
        .single();
      if (error) throw error;
      return mapSearchEvent(data);
    },
    async recordSearchFeedback({ userId, searchEventId, itemId, rating, reason = '' }) {
      const item = await this.getItem(userId, itemId);
      if (!item) {
        const error = new Error('Saved item not found.');
        error.statusCode = 404;
        throw error;
      }
      const { data: searchEvent, error: searchEventError } = await client
        .from('search_events')
        .select('id,result_ids')
        .eq('user_id', userId)
        .eq('id', searchEventId)
        .maybeSingle();
      if (searchEventError) throw searchEventError;
      if (!searchEvent || !(searchEvent.result_ids || []).includes(itemId)) {
        const error = new Error('Search feedback must reference one of your current search results.');
        error.statusCode = 400;
        throw error;
      }
      const { data, error } = await client
        .from('search_result_feedback')
        .insert({
          user_id: userId,
          search_event_id: searchEventId,
          item_id: itemId,
          rating,
          reason: cleanDbText(reason).slice(0, 300),
        })
        .select('*')
        .single();
      if (error) throw error;
      return mapSearchFeedback(data);
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
    async createImport({ userId, source, mode = 'export', fileNames = [], status = 'imported', storageFiles = [] }) {
      const { data, error } = await client
        .from('imports')
        .insert({ user_id: userId, source, mode, file_names: fileNames, status, storage_files: storageFiles })
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
    async getImport(userId, id) {
      const { data, error } = await client
        .from('imports')
        .select('*')
        .eq('user_id', userId)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data ? mapImport(data) : null;
    },
    async getPendingStorageImports({ limit = 1 } = {}) {
      const { data, error } = await client
        .from('imports')
        .select('*')
        .eq('status', 'queued_storage')
        .order('created_at')
        .limit(Math.max(1, Math.min(Number(limit) || 1, 20)));
      if (error) throw error;
      return (data || []).map(mapImport);
    },
    async claimStorageImport(id) {
      const { data, error } = await client
        .from('imports')
        .update({ status: 'processing_storage', error: null })
        .eq('id', id)
        .eq('status', 'queued_storage')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? mapImport(data) : null;
    },
    async updateImportStatus(id, status, errorMessage = null) {
      const { data, error } = await client
        .from('imports')
        .update({ status, error: errorMessage })
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? mapImport(data) : null;
    },
    async upsertImportData({ userId, importId, parsed, initialStatus = 'queued', duplicateMode = 'skipExisting' }) {
      if (!parsed.items.length) return [];

      const ids = [...new Set(parsed.items.map((item) => item.id).filter(Boolean))];
      const urls = [...new Set(parsed.items.map((item) => item.url).filter(Boolean))];
      const existingKeys = await getExistingSavedItemKeys(client, { userId, ids, urls });
      const shouldSkipExisting = duplicateMode === 'skipExisting';

      const items = parsed.items
        .filter((item) => !shouldSkipExisting || (!existingKeys.has(`id:${item.id}`) && !existingKeys.has(`url:${item.url}`)))
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
      const inserted = await insertSavedItemRows(client, items);
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
      const jobs = [];
      for (const batch of chunkValues(rows, JOB_INSERT_BATCH_SIZE)) {
        const { data, error } = await client.from('processing_jobs').upsert(batch, { onConflict: 'import_id,item_id' }).select('*');
        if (error) throw error;
        jobs.push(...(data || []));
      }
      return jobs.map(mapJob);
    },
    async getItems(userId) {
      const rows = await selectAllUserSavedItems(client, userId);
      return Promise.all(rows.map((row) => mapItemWithAnalysis(row, client)));
    },
    async listItemsPage(userId, options = {}) {
      const normalized = normalizeListOptions(options);
      const recordTiming = typeof options.recordTiming === 'function' ? options.recordTiming : null;
      const pageStartedAt = process.hrtime.bigint();
      const { rows, count } = await selectUserSavedItemPage(client, userId, normalized);
      if (recordTiming) recordTiming('listPageFetchMs', pageStartedAt);
      const mapStartedAt = process.hrtime.bigint();
      const items = await Promise.all(rows.map((row) => mapItemWithAnalysis(row, client)));
      if (recordTiming) recordTiming('listPageMapMs', mapStartedAt);
      const facetStartedAt = process.hrtime.bigint();
      const facetRows = await selectUserRows(client, 'saved_items', userId, 'collections,platform', 10000);
      if (recordTiming) recordTiming('listFacetFetchMs', facetStartedAt);
      const facets = facetsForItems(facetRows.map((row) => ({
        collections: row.collections || [],
        platform: row.platform || 'Instagram',
      })));
      return {
        items,
        nextCursor: encodePageCursor(normalized.offset + items.length, count || 0),
        totalCount: count || 0,
        facets,
        serverTime: new Date().toISOString(),
      };
    },
    async refreshSmartCollections(userId) {
      const generatedAt = new Date().toISOString();
      const candidates = generateSmartCollectionCandidates(await this.getItems(userId));
      let existingRows = [];
      try {
        const { data, error } = await client
          .from('smart_collections')
          .select('*')
          .eq('user_id', userId);
        if (error) throw error;
        existingRows = data || [];
      } catch (error) {
        if (isMissingTableError(error)) return [];
        throw error;
      }

      const bySlug = new Map(existingRows.map((row) => [row.slug, row]));
      const collections = [];
      for (const candidate of candidates) {
        const existing = bySlug.get(candidate.slug);
        if (existing) {
          const { data, error } = await client
            .from('smart_collections')
            .update({
              source_type: candidate.sourceType,
              generation_metadata: candidate.generationMetadata || {},
              updated_at: generatedAt,
            })
            .eq('user_id', userId)
            .eq('id', existing.id)
            .select('*')
            .single();
          if (error) throw error;
          collections.push(mapSmartCollectionRow(data));
        } else {
          const { data, error } = await client
            .from('smart_collections')
            .insert({
              user_id: userId,
              slug: candidate.slug,
              name: candidate.name,
              description: candidate.description,
              source_type: candidate.sourceType,
              generation_metadata: candidate.generationMetadata || {},
              created_at: generatedAt,
              updated_at: generatedAt,
            })
            .select('*')
            .single();
          if (error) throw error;
          collections.push(mapSmartCollectionRow(data));
        }
      }

      const collectionIds = collections.map((collection) => collection.id);
      if (collectionIds.length) {
        const { error } = await client
          .from('smart_collection_items')
          .delete()
          .eq('user_id', userId)
          .in('collection_id', collectionIds)
          .eq('source', 'auto');
        if (error) throw error;
      }

      const { data: manualRows, error: manualError } = await client
        .from('smart_collection_items')
        .select('*')
        .eq('user_id', userId)
        .in('source', ['manual_include', 'manual_exclude']);
      if (manualError) throw manualError;
      const manualExcludes = new Set((manualRows || [])
        .filter((row) => row.source === 'manual_exclude')
        .map((row) => `${row.collection_id}:${row.item_id}`));
      const rows = [];
      const collectionBySlug = new Map(collections.map((collection) => [collection.slug, collection]));
      for (const candidate of candidates) {
        const collection = collectionBySlug.get(candidate.slug);
        if (!collection) continue;
        for (const item of candidate.items) {
          if (manualExcludes.has(`${collection.id}:${item.itemId}`)) continue;
          rows.push({
            user_id: userId,
            collection_id: collection.id,
            item_id: item.itemId,
            confidence: item.confidence,
            reason: item.reason,
            source: 'auto',
            created_at: generatedAt,
            updated_at: generatedAt,
          });
        }
      }
      if (rows.length) {
        const { error } = await client
          .from('smart_collection_items')
          .insert(rows);
        if (error) throw error;
      }

      return this.listSmartCollections(userId);
    },
    async listSmartCollections(userId, { limit = DEFAULT_VISIBLE_COLLECTIONS_LIMIT, includeHidden = false } = {}) {
      try {
        let collectionQuery = client
          .from('smart_collections')
          .select('*')
          .eq('user_id', userId);
        if (!includeHidden) collectionQuery = collectionQuery.eq('hidden', false);
        const [{ data: collectionRows, error: collectionError }, { data: membershipRows, error: membershipError }, items] = await Promise.all([
          collectionQuery,
          client.from('smart_collection_items').select('*').eq('user_id', userId),
          this.getItems(userId),
        ]);
        if (collectionError) throw collectionError;
        if (membershipError) throw membershipError;
        const itemById = new Map(items.map((item) => [item.id, item]));
        const membershipsByCollection = groupBy((membershipRows || []).map(mapSmartCollectionItemRow), 'collectionId');
        const collections = (collectionRows || [])
          .map(mapSmartCollectionRow)
          .map((collection) => publicSmartCollection(collection, membershipsByCollection.get(collection.id) || [], itemById))
          .filter((collection) => collection.itemCount > 0);
        return sortSmartCollections(collections).slice(0, Math.max(1, Math.min(Number(limit) || DEFAULT_VISIBLE_COLLECTIONS_LIMIT, 100)));
      } catch (error) {
        if (isMissingTableError(error)) return [];
        throw error;
      }
    },
    async listSmartCollectionItems(userId, collectionId, options = {}) {
      try {
        const [{ data: row, error: collectionError }, { data: membershipRows, error: membershipError }, items] = await Promise.all([
          client.from('smart_collections').select('*').eq('user_id', userId).eq('id', collectionId).maybeSingle(),
          client.from('smart_collection_items').select('*').eq('user_id', userId).eq('collection_id', collectionId),
          this.getItems(userId),
        ]);
        if (collectionError) throw collectionError;
        if (membershipError) throw membershipError;
        if (!row) return null;
        const excluded = new Set((membershipRows || []).filter((entry) => entry.source === 'manual_exclude').map((entry) => entry.item_id));
        const active = new Set((membershipRows || [])
          .filter((entry) => entry.source !== 'manual_exclude' && !excluded.has(entry.item_id))
          .map((entry) => entry.item_id));
        const collectionItems = items.filter((item) => active.has(item.id));
        const collection = mapSmartCollectionRow(row);
        return {
          collection: publicSmartCollection(
            collection,
            (membershipRows || []).map(mapSmartCollectionItemRow),
            new Map(items.map((item) => [item.id, item])),
          ),
          ...listItemsPageFromItems(collectionItems, options),
        };
      } catch (error) {
        if (isMissingTableError(error)) return null;
        throw error;
      }
    },
    async updateSmartCollection(userId, id, patch = {}) {
      const row = {};
      if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
        const name = cleanDbText(String(patch.name || '').replace(/\s+/g, ' ').trim()).slice(0, 80);
        if (name) row.name = name;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'description')) {
        row.description = cleanDbText(String(patch.description || '').replace(/\s+/g, ' ').trim()).slice(0, 240);
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'pinned')) row.pinned = Boolean(patch.pinned);
      if (Object.prototype.hasOwnProperty.call(patch, 'hidden')) row.hidden = Boolean(patch.hidden);
      row.updated_at = new Date().toISOString();
      const { data, error } = await client
        .from('smart_collections')
        .update(row)
        .eq('user_id', userId)
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (error && isMissingTableError(error)) return null;
      if (error) throw error;
      if (!data) return null;
      const collection = mapSmartCollectionRow(data);
      const { data: membershipRows, error: membershipError } = await client
        .from('smart_collection_items')
        .select('*')
        .eq('user_id', userId)
        .eq('collection_id', id);
      if (membershipError) throw membershipError;
      const items = await this.getItems(userId);
      return publicSmartCollection(collection, (membershipRows || []).map(mapSmartCollectionItemRow), new Map(items.map((item) => [item.id, item])));
    },
    async setSmartCollectionItemOverride(userId, collectionId, itemId, action = 'exclude') {
      const normalizedAction = ['include', 'exclude', 'auto'].includes(action) ? action : 'exclude';
      const [collection, item] = await Promise.all([
        this.listSmartCollectionItems(userId, collectionId, { limit: 1 }),
        this.getItem(userId, itemId),
      ]);
      if (!collection || !item) return null;
      const { error: deleteError } = await client
        .from('smart_collection_items')
        .delete()
        .eq('user_id', userId)
        .eq('collection_id', collectionId)
        .eq('item_id', itemId)
        .neq('source', 'auto');
      if (deleteError) throw deleteError;
      if (normalizedAction !== 'auto') {
        const source = normalizedAction === 'include' ? 'manual_include' : 'manual_exclude';
        const { error } = await client
          .from('smart_collection_items')
          .insert({
            user_id: userId,
            collection_id: collectionId,
            item_id: itemId,
            confidence: 1,
            reason: normalizedAction === 'include' ? 'Added by you.' : 'Removed by you.',
            source,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        if (error) throw error;
      }
      const next = await this.listSmartCollectionItems(userId, collectionId, { limit: 1 });
      return next?.collection || null;
    },
    async getItem(userId, id) {
      const { data, error } = await client
        .from('saved_items')
        .select('*, item_analysis(*), item_assets(*), item_archives(*)')
        .eq('user_id', userId)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data ? mapItemWithAnalysis(data, client) : null;
    },
    async createNoteItem(userId, item) {
      const { data, error } = await client
        .from('saved_items')
        .insert({
          id: cleanDbText(item.id),
          user_id: userId,
          import_id: null,
          url: cleanDbText(item.url),
          content_type: cleanDbText(item.contentType),
          caption: cleanDbText(item.caption),
          hashtags: cleanTextArray(item.hashtags),
          owner_name: cleanDbText(item.ownerName),
          owner_username: cleanDbText(item.ownerUsername),
          saved_at_text: cleanDbText(item.savedAt),
          collections: cleanTextArray(item.collections),
          platform: cleanDbText(item.platform),
          platform_key: cleanDbText(item.platformKey),
          source_id: cleanDbText(item.sourceId),
          source_title: cleanDbText(item.sourceTitle),
          source_author: cleanDbText(item.sourceAuthor),
          source_description: cleanDbText(item.sourceDescription),
          thumbnail_url: cleanDbText(item.thumbnailUrl || ''),
          status: 'done',
        })
        .select('*, item_analysis(*), item_assets(*)')
        .maybeSingle();
      if (error) throw error;
      return data ? mapItemWithAnalysis(data, client) : null;
    },
    async addItemAsset(userId, itemId, asset) {
      const { data, error } = await client
        .from('item_assets')
        .insert({
          user_id: userId,
          item_id: itemId,
          asset_type: cleanDbText(asset.assetType || 'image'),
          storage_path: cleanDbText(asset.storagePath),
          mime_type: cleanDbText(asset.mimeType || ''),
        })
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? mapAsset(data, client) : null;
    },
    async listItemAssets(userId, itemId) {
      const { data, error } = await client
        .from('item_assets')
        .select('*')
        .eq('user_id', userId)
        .eq('item_id', itemId)
        .order('created_at');
      if (error) throw error;
      return Promise.all((data || []).map((row) => mapAsset(row, client)));
    },
    async getItemArchive(userId, itemId) {
      const { data, error } = await client
        .from('item_archives')
        .select('*')
        .eq('user_id', userId)
        .eq('item_id', itemId)
        .maybeSingle();
      if (error && isMissingTableError(error)) return null;
      if (error) throw error;
      return data ? mapArchiveRow(data, { includeContent: true }) : null;
    },
    async upsertItemArchive(userId, itemId, archive = {}) {
      const existing = await this.getItem(userId, itemId);
      if (!existing) return null;
      const row = toArchiveRow(userId, itemId, archive, existing.url);
      const { data, error } = await client
        .from('item_archives')
        .upsert(row, { onConflict: 'user_id,item_id' })
        .select('*')
        .maybeSingle();
      if (error && isMissingTableError(error)) return null;
      if (error) throw error;
      return data ? mapArchiveRow(data, { includeContent: true }) : null;
    },
    async listLinkHealthChecks(userId) {
      const rows = await selectAllUserRows(client, 'link_health_checks', userId, '*', (query) => query.order('checked_at', { ascending: false }));
      return rows.map(mapLinkHealthRow);
    },
    async upsertLinkHealthCheck(userId, itemId, check = {}) {
      const existing = await this.getItem(userId, itemId);
      if (!existing) return null;
      const row = toLinkHealthRow(userId, itemId, check, existing.url);
      const { data, error } = await client
        .from('link_health_checks')
        .upsert(row, { onConflict: 'user_id,item_id' })
        .select('*')
        .maybeSingle();
      if (error && isMissingTableError(error)) return null;
      if (error) throw error;
      return data ? mapLinkHealthRow(data) : null;
    },
    async listItemReminders(userId, { status = null } = {}) {
      let query = client
        .from('item_reminders')
        .select('*')
        .eq('user_id', userId)
        .order('remind_at', { ascending: true })
        .limit(500);
      if (status) query = query.eq('status', status);
      const { data, error } = await query;
      if (error && isMissingTableError(error)) return [];
      if (error) throw error;
      return (data || []).map(mapReminderRow);
    },
    async createItemReminder(userId, itemId, reminder = {}) {
      const existing = await this.getItem(userId, itemId);
      if (!existing) return null;
      const { data, error } = await client
        .from('item_reminders')
        .upsert({
          user_id: userId,
          item_id: itemId,
          status: 'pending',
          remind_at: reminder.remindAt,
          reason: cleanDbText(reminder.reason || 'remind_later'),
          note: cleanDbText(reminder.note || ''),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,item_id,reason,remind_at' })
        .select('*')
        .maybeSingle();
      if (error && isMissingTableError(error)) return null;
      if (error) throw error;
      return data ? mapReminderRow(data) : null;
    },
    async updateItemReminder(userId, id, patch = {}) {
      const row = { updated_at: new Date().toISOString() };
      if (Object.prototype.hasOwnProperty.call(patch, 'status')) row.status = cleanDbText(patch.status);
      if (Object.prototype.hasOwnProperty.call(patch, 'completedAt')) row.completed_at = patch.completedAt;
      const { data, error } = await client
        .from('item_reminders')
        .update(row)
        .eq('user_id', userId)
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (error && isMissingTableError(error)) return null;
      if (error) throw error;
      return data ? mapReminderRow(data) : null;
    },
    async removeItemAssets(userId, itemId, assetIds = []) {
      let query = client
        .from('item_assets')
        .delete()
        .eq('user_id', userId)
        .eq('item_id', itemId);
      if (assetIds.length) query = query.in('id', assetIds);
      const { data, error } = await query.select('*');
      if (error) throw error;
      return Promise.all((data || []).map((row) => mapAsset(row, client)));
    },
    async deleteSavedItem(userId, id) {
      const existing = await this.getItem(userId, id);
      if (!existing) return null;
      const { error } = await client
        .from('saved_items')
        .delete()
        .eq('user_id', userId)
        .eq('id', id);
      if (error) throw error;
      return existing;
    },
    async getJobs(userId, importId = null) {
      let query = client.from('processing_jobs').select('*').eq('user_id', userId);
      if (importId) query = query.eq('import_id', importId);
      const { data, error } = await query.order('created_at');
      if (error) throw error;
      return data.map(mapJob);
    },
    async getProcessableJobScopes({ limit = 10, perUserConcurrency = 1, maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS } = {}) {
      const { data, error } = await client.rpc('list_processable_job_scopes', {
        p_limit: Math.max(1, Math.min(Number(limit) || 10, 100)),
        p_per_user_concurrency: Math.max(1, Math.min(Number(perUserConcurrency) || 1, 10)),
        p_max_attempts: Math.max(1, Math.min(Number(maxAttempts) || DEFAULT_MAX_JOB_ATTEMPTS, 20)),
      });
      if (error) throw error;
      return (data || []).map((row) => ({
        userId: row.user_id,
        importId: row.import_id,
        waitingCount: Number(row.waiting_count || 0),
      }));
    },
    async getJob(userId, id) {
      const { data, error } = await client.from('processing_jobs').select('*').eq('user_id', userId).eq('id', id).maybeSingle();
      if (error) throw error;
      return data ? mapJob(data) : null;
    },
    async claimNextJobs({
      userId,
      importId = null,
      limit = 5,
      leaseOwner = 'worker',
      leaseMs = 15 * 60 * 1000,
      perUserConcurrency = 1,
      maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS,
    } = {}) {
      const leaseToken = crypto.randomUUID();
      const { data, error } = await client.rpc('claim_processing_jobs', {
        p_user_id: userId,
        p_import_id: importId,
        p_limit: Math.max(1, Math.min(Number(limit) || 5, 100)),
        p_lease_owner: leaseOwner,
        p_lease_token: leaseToken,
        p_lease_expires_at: new Date(Date.now() + leaseMs).toISOString(),
        p_per_user_concurrency: Math.max(1, Math.min(Number(perUserConcurrency) || 1, 10)),
        p_max_attempts: Math.max(1, Math.min(Number(maxAttempts) || DEFAULT_MAX_JOB_ATTEMPTS, 20)),
      });
      if (error) throw error;
      return (data || []).map(mapJob);
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
    async updateClaimedJob(userId, id, leaseToken, patch) {
      const { data, error } = await client
        .from('processing_jobs')
        .update(toJobRow(patch))
        .eq('user_id', userId)
        .eq('id', id)
        .eq('lease_token', leaseToken)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? mapJob(data) : null;
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
        .update({
          status: 'queued',
          attempts: 0,
          error: null,
          lease_owner: null,
          lease_token: null,
          lease_expires_at: null,
          next_attempt_at: null,
          claimed_at: null,
          completed_at: null,
          last_error_at: null,
        })
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
    async getIndexingSummary(userId) {
      const statuses = ['queued', 'downloading', 'analyzing', 'done', 'failed', ...PAUSED_JOB_STATUSES];
      const byStatus = Object.fromEntries(statuses.map((status) => [status, 0]));
      const jobs = await selectAllUserRows(client, 'processing_jobs', userId, 'status, attempts, lease_expires_at, next_attempt_at', (query) => query.in('status', statuses));
      const nowMs = Date.now();
      for (const job of jobs || []) {
        const activeExpired = ['downloading', 'analyzing'].includes(job.status)
          && (!job.lease_expires_at || Date.parse(job.lease_expires_at) <= nowMs);
        const retryPending = job.status === 'queued' && job.next_attempt_at && Date.parse(job.next_attempt_at) > nowMs;
        const status = activeExpired || retryPending ? 'queued' : job.status;
        byStatus[status] = (byStatus[status] || 0) + 1;
      }
      const retrying = (jobs || []).filter((job) => job.status === 'queued' && job.next_attempt_at && Date.parse(job.next_attempt_at) > nowMs).length;
      const exhausted = (jobs || []).filter((job) => job.status === 'failed' && (Number(job.attempts) || 0) >= DEFAULT_MAX_JOB_ATTEMPTS).length;
      const retryableFailed = (jobs || []).filter((job) => job.status === 'failed' && (Number(job.attempts) || 0) < DEFAULT_MAX_JOB_ATTEMPTS).length;
      const needsReview = await countRows(client, 'saved_items', (query) => query.eq('user_id', userId).eq('status', 'needs_review'));
      const paused = PAUSED_JOB_STATUSES.reduce((total, status) => total + (byStatus[status] || 0), 0);
      return {
        totalJobs: Object.values(byStatus).reduce((total, count) => total + count, 0),
        needsReview,
        waiting: Math.max((byStatus.queued || 0) - retrying, 0),
        queued: Math.max((byStatus.queued || 0) - retrying, 0),
        retrying,
        processing: (byStatus.downloading || 0) + (byStatus.analyzing || 0),
        downloading: byStatus.downloading || 0,
        analyzing: byStatus.analyzing || 0,
        done: byStatus.done || 0,
        failed: byStatus.failed || 0,
        retryableFailed,
        exhausted,
        paused,
        pausedMissingProvider: byStatus.paused_missing_provider || 0,
        pausedNeedsBilling: byStatus.paused_needs_billing || 0,
        pausedApiLimit: byStatus.paused_api_limit || 0,
        byStatus,
      };
    },
    async getWorkerQueueStatus({ maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS } = {}) {
      const rows = await selectAllRows(
        client,
        'processing_jobs',
        'status, attempts, lease_expires_at, next_attempt_at, created_at',
        (query) => query.in('status', ['queued', 'downloading', 'analyzing', 'done', 'failed', ...PAUSED_JOB_STATUSES]),
      );
      const jobs = rows.map((row) => ({
        status: row.status,
        attempts: row.attempts,
        leaseExpiresAt: row.lease_expires_at,
        nextAttemptAt: row.next_attempt_at,
        createdAt: row.created_at,
      }));
      return summarizeJobQueue(jobs, { maxAttempts });
    },
    async saveAnalysis(userId, itemId, analysis) {
      await client
        .from('item_analysis')
        .upsert({ item_id: itemId, user_id: userId, ...toAnalysisRow(analysis) }, { onConflict: 'user_id,item_id' })
        .throwOnError();
      await client.from('saved_items').update({ status: 'done' }).eq('user_id', userId).eq('id', itemId).throwOnError();
      const item = await this.getItem(userId, itemId);
      await this.refreshSmartCollections(userId);
      return item;
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

      const freeItemsLimit = FREE_ITEMS_LIMIT;
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
    async saveProviderCredential(userId, { provider, purpose, model, apiKey, encryptionKey, status = 'active', isPreferred = true, baseUrl = '', displayName = '' }) {
      assertProviderPurpose(provider, purpose);
      if (purpose === 'media' && provider === 'openrouter') assertMediaModelAllowed(model);
      assertOpenAICompatibleConfig({ provider, purpose, model, baseUrl });
      if (!apiKey) throw new Error('API key is required.');
      const normalizedBaseUrl = provider === OPENAI_COMPATIBLE_PROVIDER ? normalizeOpenAICompatibleBaseUrl(baseUrl) : null;
      const normalizedDisplayName = provider === OPENAI_COMPATIBLE_PROVIDER ? normalizeOpenAICompatibleDisplayName(displayName) : null;

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
        base_url: normalizedBaseUrl,
        display_name: normalizedDisplayName,
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
      const keywordResults = searchItemsWithDetails(items, query, filters);
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
    async searchLean(userId, query, filters = {}, options = {}) {
      const fetchStartedAt = process.hrtime.bigint();
      const rows = await selectLeanSearchRows(client, userId, query, filters, options);
      if (typeof options.recordTiming === 'function') options.recordTiming('searchItemFetchMs', fetchStartedAt);
      const mapStartedAt = process.hrtime.bigint();
      const items = await Promise.all(rows.map((row) => mapItemWithAnalysis(row, null)));
      if (typeof options.recordTiming === 'function') options.recordTiming('searchItemMapMs', mapStartedAt);
      const scoreStartedAt = process.hrtime.bigint();
      const results = searchItemsWithDetails(items, query, filters);
      if (typeof options.recordTiming === 'function') options.recordTiming('searchKeywordScoreMs', scoreStartedAt);
      return results;
    },
  };
}

function mapImport(row) {
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source,
    mode: row.mode,
    status: row.status,
    fileNames: row.file_names || [],
    storageFiles: row.storage_files || [],
    error: row.error || null,
  };
}

function mapDeletionRequest(row) {
  const steps = Array.isArray(row.account_deletion_steps)
    ? row.account_deletion_steps.map(mapDeletionStep).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    : [];
  return {
    id: row.id,
    userId: row.user_id,
    userIdHash: row.user_id_hash,
    emailHash: row.email_hash,
    status: row.status,
    reason: row.reason || '',
    exportConfirmed: Boolean(row.export_confirmed),
    requestedAt: row.requested_at,
    approvedAt: row.approved_at,
    executingAt: row.executing_at,
    completedAt: row.completed_at,
    canceledAt: row.canceled_at,
    adminActor: row.admin_actor,
    statusMessage: row.status_message || '',
    retentionSummary: row.retention_summary || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    steps,
  };
}

function mapDeletionStep(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    stepKey: row.step_key,
    status: row.status,
    attempts: row.attempts || 0,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    redactedError: row.redacted_error || '',
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function chunkValues(values, size = EXISTING_ITEM_LOOKUP_BATCH_SIZE) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function isExpectedSavedItemDuplicateError(error) {
  if (!error || error.code !== '23505') return false;
  const text = [
    error.message,
    error.details,
    error.hint,
    error.constraint,
    error.constraint_name,
  ].filter(Boolean).join(' ').toLowerCase();
  return text.includes('saved_items_pkey')
    || text.includes('saved_items_user_id_url_key')
    || text.includes('key (user_id, id)')
    || text.includes('key (user_id, url)')
    || text.includes('(user_id, id)')
    || text.includes('(user_id, url)');
}

async function insertSavedItemBatchSkippingDuplicates(client, batch) {
  const { data, error } = await client.from('saved_items').insert(batch).select('*');
  if (!error) return data || [];
  if (!isExpectedSavedItemDuplicateError(error)) throw error;

  const inserted = [];
  for (const row of batch) {
    const { data: rowData, error: rowError } = await client.from('saved_items').insert(row).select('*');
    if (rowError) {
      if (isExpectedSavedItemDuplicateError(rowError)) continue;
      throw rowError;
    }
    inserted.push(...(Array.isArray(rowData) ? rowData : rowData ? [rowData] : []));
  }
  return inserted;
}

async function insertSavedItemRows(client, rows) {
  const inserted = [];
  for (const batch of chunkValues(rows, IMPORT_INSERT_BATCH_SIZE)) {
    inserted.push(...await insertSavedItemBatchSkippingDuplicates(client, batch));
  }
  return inserted;
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

async function selectAllUserSavedItems(client, userId) {
  const pageSize = 1000;
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('saved_items')
      .select('*, item_analysis(*), item_assets(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;

    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

async function selectSearchableSavedItems(client, userId) {
  const pageSize = 1000;
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('saved_items')
      .select(SEARCH_ITEM_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;

    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

async function selectLeanSearchRows(client, userId, query, filters = {}, options = {}) {
  if (!String(query || '').trim()) return selectSearchableSavedItems(client, userId);

  const candidateStartedAt = process.hrtime.bigint();
  const candidates = await selectCandidateSearchableSavedItems(client, userId, query, options.searchCandidateLimit || 300);
  if (typeof options.recordTiming === 'function') {
    options.recordTiming('searchCandidateFetchMs', candidateStartedAt);
  }

  const desired = Math.max(1, Math.min(Number(filters.limit) || 30, 100));
  if (candidates.length >= desired) return candidates;
  return selectSearchableSavedItems(client, userId);
}

async function selectCandidateSearchableSavedItems(client, userId, query, limit = 300) {
  const tokens = searchableQueryTokens(query);
  if (!tokens.length) return [];
  const columns = ['caption', 'source_title', 'source_description', 'source_author', 'owner_name', 'owner_username', 'platform'];
  const clauses = [];
  for (const token of tokens) {
    for (const column of columns) clauses.push(`${column}.ilike.%${token}%`);
  }
  const { data, error } = await client
    .from('saved_items')
    .select(SEARCH_ITEM_COLUMNS)
    .eq('user_id', userId)
    .or(clauses.join(','))
    .order('created_at', { ascending: false })
    .limit(Math.max(30, Math.min(Number(limit) || 300, 1000)));
  if (error) throw error;
  return data || [];
}

function searchableQueryTokens(query) {
  return [...new Set(String(query || '').toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) || [])]
    .slice(0, 4);
}

function encodePageCursor(offset, totalCount) {
  if (!Number.isInteger(offset) || offset <= 0 || offset >= totalCount) return null;
  return Buffer.from(JSON.stringify({ offset })).toString('base64url');
}

function applySavedItemListFilters(query, options) {
  if (options.type === 'notes') {
    query = query.or('content_type.eq.note,platform_key.eq.iscraper-note');
  } else if (options.type === 'links') {
    query = query.or('platform_key.eq.web,id.like.web-%');
  } else if (options.type === 'uploaded') {
    query = query.neq('content_type', 'note').neq('platform_key', 'iscraper-note').neq('platform_key', 'web');
  }

  if (options.state === 'needs_review') {
    query = query.eq('status', 'needs_review');
  } else if (options.state === 'searchable') {
    query = query.neq('status', 'needs_review');
  } else if (options.state === 'enriched') {
    query = query.in('status', ['done', 'downloading', 'analyzing']);
  } else if (options.state === 'failed') {
    query = query.in('status', ['failed', 'paused']);
  }

  if (options.collection !== 'all') query = query.contains('collections', [options.collection]);
  if (options.platform !== 'all') query = query.eq('platform', options.platform);
  return query;
}

function applySavedItemListSort(query, sort) {
  if (sort === 'oldest') return query.order('created_at', { ascending: true }).order('id', { ascending: true });
  if (sort === 'updated') return query.order('updated_at', { ascending: false }).order('id', { ascending: true });
  if (sort === 'title') return query.order('source_title', { ascending: true, nullsFirst: false }).order('id', { ascending: true });
  return query.order('created_at', { ascending: false }).order('id', { ascending: true });
}

async function selectUserSavedItemPage(client, userId, options) {
  let query = client
    .from('saved_items')
    .select('*, item_analysis(*), item_assets(*)', { count: 'exact' })
    .eq('user_id', userId);
  query = applySavedItemListFilters(query, options);
  query = applySavedItemListSort(query, options.sort);
  const { data, error, count } = await query.range(options.offset, options.offset + options.limit - 1);
  if (error) throw error;
  return { rows: data || [], count: count || 0 };
}

function isMissingTableError(error) {
  return error?.code === '42P01';
}

function groupBy(rows = [], key) {
  return rows.reduce((groups, row) => {
    const value = row[key];
    const group = groups.get(value) || [];
    group.push(row);
    groups.set(value, group);
    return groups;
  }, new Map());
}

function mapSmartCollectionRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description || '',
    slug: row.slug,
    sourceType: row.source_type || 'auto',
    pinned: Boolean(row.pinned),
    hidden: Boolean(row.hidden),
    generationMetadata: row.generation_metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSmartCollectionItemRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    collectionId: row.collection_id,
    itemId: row.item_id,
    confidence: Number(row.confidence || 0),
    reason: row.reason || '',
    source: row.source || 'auto',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function selectAllUserRows(client, table, userId, columns = '*', apply = null) {
  const pageSize = 1000;
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    let query = client
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .range(from, from + pageSize - 1);
    if (apply) query = apply(query);
    const { data, error } = await query;
    if (error && error.code === '42P01') return rows;
    if (error) throw error;

    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

async function selectAllRows(client, table, columns = '*', apply = null) {
  const pageSize = 1000;
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    let query = client
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (apply) query = apply(query);
    const { data, error } = await query;
    if (error && error.code === '42P01') return rows;
    if (error) throw error;

    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

async function deleteUserRowsFromTables(client, userId, tables) {
  const deleted = {};
  for (const table of tables) {
    const { data, error } = await client.from(table).delete().eq('user_id', userId).select('user_id');
    if (error && error.code === '42P01') {
      deleted[table] = 0;
      continue;
    }
    if (error) throw error;
    deleted[table] = data?.length || 0;
  }
  return deleted;
}

async function retainCompletedCreditPurchases(client, userId) {
  const { data, error } = await client
    .from('credit_purchases')
    .update({
      user_id: null,
      metadata: {
        accountDeleted: true,
        retentionReason: 'payment_accounting',
      },
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .in('status', ['completed', 'refunded'])
    .select('id');
  if (error && error.code === '42P01') return 0;
  if (error) throw error;
  return data?.length || 0;
}

async function listStoragePathsForPrefix(client, bucket, prefix) {
  const paths = [];

  async function walk(folder) {
    const { data, error } = await client.storage.from(bucket).list(folder, { limit: 1000 });
    if (error) {
      if (/not found/i.test(error.message || '')) return;
      throw error;
    }
    for (const entry of data || []) {
      const name = entry.name || '';
      if (!name) continue;
      const fullPath = folder ? `${folder}/${name}` : name;
      if (entry.id || entry.metadata || entry.updated_at || entry.created_at) {
        paths.push(fullPath);
      } else {
        await walk(fullPath);
      }
    }
  }

  await walk(String(prefix || '').replace(/^\/+|\/+$/g, ''));
  return paths;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function mapAsset(row, client = null) {
  let url = '';
  if (row.storage_path?.startsWith('data:')) {
    url = row.storage_path;
  } else if (client?.storage && row.storage_path) {
    const { data } = await client.storage.from(NOTE_ASSET_BUCKET).createSignedUrl(row.storage_path, 60 * 60);
    url = data?.signedUrl || '';
  }
  return publicNoteAsset({
    id: row.id,
    userId: row.user_id,
    itemId: row.item_id,
    assetType: row.asset_type,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    url,
    createdAt: row.created_at,
  });
}

async function mapItemWithAnalysis(row, client = null) {
  const item = mapItem(row);
  const analysis = Array.isArray(row.item_analysis) ? row.item_analysis[0] : row.item_analysis;
  const assets = Array.isArray(row.item_assets) ? row.item_assets : [];
  const archive = Array.isArray(row.item_archives) ? row.item_archives[0] : row.item_archives;
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
  item.assets = await Promise.all(assets.map((asset) => mapAsset(asset, client)));
  item.archive = archive ? mapArchiveRow(archive, { includeContent: Boolean(row.item_archives) }) : null;
  return item;
}

function mapArchiveRow(row, { includeContent = false } = {}) {
  const archive = publicArchive({
    id: row.id,
    itemId: row.item_id,
    status: row.status,
    sourceUrl: row.source_url,
    finalUrl: row.final_url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    byline: row.byline,
    siteName: row.site_name,
    excerpt: row.excerpt,
    contentText: row.content_text,
    contentHtml: row.content_html,
    textLength: row.text_length,
    byteSize: row.byte_size,
    contentHash: row.content_hash,
    httpStatus: row.http_status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }, { includeContent });
  return archive;
}

function toArchiveRow(userId, itemId, archive = {}, fallbackUrl = '') {
  const row = {
    user_id: userId,
    item_id: itemId,
    status: cleanDbText(archive.status || 'pending'),
    source_url: cleanDbText(archive.sourceUrl || fallbackUrl),
    updated_at: new Date().toISOString(),
  };
  const fields = [
    ['finalUrl', 'final_url'],
    ['canonicalUrl', 'canonical_url'],
    ['title', 'title'],
    ['byline', 'byline'],
    ['siteName', 'site_name'],
    ['excerpt', 'excerpt'],
    ['contentText', 'content_text'],
    ['contentHtml', 'content_html'],
    ['contentHash', 'content_hash'],
    ['errorCode', 'error_code'],
    ['errorMessage', 'error_message'],
    ['capturedAt', 'captured_at'],
  ];
  for (const [camel, snake] of fields) {
    if (Object.prototype.hasOwnProperty.call(archive, camel)) row[snake] = cleanDbText(archive[camel]);
  }
  if (Object.prototype.hasOwnProperty.call(archive, 'textLength')) row.text_length = Number(archive.textLength || 0);
  if (Object.prototype.hasOwnProperty.call(archive, 'byteSize')) row.byte_size = Number(archive.byteSize || 0);
  if (Object.prototype.hasOwnProperty.call(archive, 'httpStatus')) row.http_status = archive.httpStatus == null ? null : Number(archive.httpStatus);
  return row;
}

function mapLinkHealthRow(row) {
  return publicLinkHealth({
    id: row.id,
    itemId: row.item_id,
    status: row.status,
    url: row.url,
    finalUrl: row.final_url,
    httpStatus: row.http_status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    checkedAt: row.checked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toLinkHealthRow(userId, itemId, check = {}, fallbackUrl = '') {
  return {
    user_id: userId,
    item_id: itemId,
    status: cleanDbText(check.status || 'unknown'),
    url: cleanDbText(check.sourceUrl || check.url || fallbackUrl),
    final_url: cleanDbText(check.finalUrl || ''),
    http_status: check.httpStatus == null ? null : Number(check.httpStatus),
    error_code: cleanDbText(check.errorCode || ''),
    error_message: cleanDbText(check.errorMessage || ''),
    checked_at: check.checkedAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function mapReminderRow(row) {
  return publicReminder({
    id: row.id,
    itemId: row.item_id,
    status: row.status,
    remindAt: row.remind_at,
    reason: row.reason,
    note: row.note,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
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
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    nextAttemptAt: row.next_attempt_at,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
    lastErrorAt: row.last_error_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toJobRow(patch) {
  const row = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'status')) row.status = patch.status;
  if (Object.prototype.hasOwnProperty.call(patch, 'attempts')) row.attempts = patch.attempts;
  if (Object.prototype.hasOwnProperty.call(patch, 'error')) row.error = patch.error;
  if (Object.prototype.hasOwnProperty.call(patch, 'leaseOwner')) row.lease_owner = patch.leaseOwner;
  if (Object.prototype.hasOwnProperty.call(patch, 'leaseToken')) row.lease_token = patch.leaseToken;
  if (Object.prototype.hasOwnProperty.call(patch, 'leaseExpiresAt')) row.lease_expires_at = patch.leaseExpiresAt;
  if (Object.prototype.hasOwnProperty.call(patch, 'nextAttemptAt')) row.next_attempt_at = patch.nextAttemptAt;
  if (Object.prototype.hasOwnProperty.call(patch, 'claimedAt')) row.claimed_at = patch.claimedAt;
  if (Object.prototype.hasOwnProperty.call(patch, 'completedAt')) row.completed_at = patch.completedAt;
  if (Object.prototype.hasOwnProperty.call(patch, 'lastErrorAt')) row.last_error_at = patch.lastErrorAt;
  return row;
}

function toSavedItemPatch(patch = {}) {
  const row = { updated_at: new Date().toISOString() };
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
    baseUrl: row.base_url || null,
    displayName: row.display_name || null,
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

function mapSearchEvent(row) {
  return {
    id: row.id,
    userId: row.user_id,
    query: row.query || '',
    queryLength: row.query_length || 0,
    filters: row.filters || {},
    resultCount: row.result_count || 0,
    includeAi: Boolean(row.include_ai),
    resultIds: row.result_ids || [],
    createdAt: row.created_at,
  };
}

function mapSearchFeedback(row) {
  return {
    id: row.id,
    userId: row.user_id,
    searchEventId: row.search_event_id,
    itemId: row.item_id,
    rating: row.rating,
    reason: row.reason || '',
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

function mapCaptureConnection(row) {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    externalId: row.external_id,
    tokenHash: row.token_hash,
    username: row.username || '',
    displayName: row.display_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

function publicCaptureConnection(row) {
  return {
    id: row.id,
    provider: row.provider,
    externalId: row.externalId,
    username: row.username || '',
    displayName: row.displayName || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt || null,
    revokedAt: row.revokedAt || null,
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
  const matches = new Map();

  keywordResults.forEach((item, index) => {
    const score = 1 + (keywordResults.length - index) / Math.max(keywordResults.length, 1);
    scores.set(item.id, (scores.get(item.id) || 0) + score);
    if (item.searchMatch) matches.set(item.id, item.searchMatch);
  });

  semanticMatches.forEach((match) => {
    const item = byId.get(match.item_id);
    if (!item || !matchesFilters(item, filters)) return;
    const similarity = Number(match.similarity || 0);
    scores.set(item.id, (scores.get(item.id) || 0) + similarity * 2);
    const current = matches.get(item.id) || { score: 0, matchedTerms: [], matchedFields: [], matchTypes: [] };
    matches.set(item.id, {
      ...current,
      score: (current.score || 0) + similarity * 20,
      semanticSimilarity: similarity,
      matchTypes: [...new Set([...(current.matchTypes || []), 'semantic'])],
    });
  });

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => {
      const item = byId.get(id);
      return item ? { ...item, searchMatch: matches.get(id) || null } : null;
    })
    .filter(Boolean)
    .slice(0, filters.limit || 30);
}

module.exports = {
  createSupabaseStore,
  getExistingSavedItemKeys,
  insertSavedItemRows,
  isExpectedSavedItemDuplicateError,
  cleanDbText,
  selectAllUserSavedItems,
  selectUserSavedItemPage,
};
