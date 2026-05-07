const { createClient } = require('@supabase/supabase-js');

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
      const items = parsed.items.map((item) => ({
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
        status: 'queued',
      }));
      if (!items.length) return [];
      const { data, error } = await client.from('saved_items').upsert(items, { onConflict: 'user_id,url' }).select('*');
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
    async saveAnalysis(userId, itemId, analysis) {
      await client
        .from('item_analysis')
        .upsert({ item_id: itemId, user_id: userId, ...toAnalysisRow(analysis) }, { onConflict: 'user_id,item_id' })
        .throwOnError();
      await client.from('saved_items').update({ status: 'done' }).eq('user_id', userId).eq('id', itemId).throwOnError();
      return this.getItem(userId, itemId);
    },
    async markItemFailed(userId, itemId, error) {
      await client.from('saved_items').update({ status: 'failed', error }).eq('user_id', userId).eq('id', itemId).throwOnError();
    },
    async search(userId, query, filters = {}) {
      const items = await this.getItems(userId);
      const { searchItems } = require('../services/analyzer');
      return searchItems(items, query, filters);
    },
  };
}

function mapImport(row) {
  return { id: row.id, userId: row.user_id, source: row.source, mode: row.mode, status: row.status };
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

module.exports = {
  createSupabaseStore,
};
