const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSupabaseStore,
  cleanDbText,
  getExistingSavedItemKeys,
  insertSavedItemRows,
  isExpectedSavedItemDuplicateError,
  selectAllUserSavedItems,
  selectUserSavedItemPage,
} = require('../src/stores/supabaseStore');

test('cleanDbText removes broken Unicode surrogates but keeps valid emoji', () => {
  assert.equal(cleanDbText('valid 👩🏻‍💻 text'), 'valid 👩🏻‍💻 text');
  assert.equal(cleanDbText(`bad high ${String.fromCharCode(0xD83D)} text`), 'bad high  text');
  assert.equal(cleanDbText(`bad low ${String.fromCharCode(0xDC00)} text`), 'bad low  text');
});

test('getExistingSavedItemKeys batches duplicate lookups to avoid huge request URLs', async () => {
  const calls = [];
  const client = {
    from(table) {
      return {
        select(columns) {
          this.table = table;
          this.columns = columns;
          return this;
        },
        eq(field, value) {
          this.userFilter = { field, value };
          return this;
        },
        async in(field, values) {
          calls.push({
            table: this.table,
            columns: this.columns,
            userFilter: this.userFilter,
            field,
            count: values.length,
          });
          return {
            data: field === 'url' && values.includes('https://instagram.com/reel/42')
              ? [{ id: '42', url: 'https://instagram.com/reel/42' }]
              : [],
            error: null,
          };
        },
      };
    },
  };

  const ids = Array.from({ length: 245 }, (_, index) => `item-${index}`);
  const urls = Array.from({ length: 245 }, (_, index) => `https://instagram.com/reel/${index}`);
  const existingKeys = await getExistingSavedItemKeys(client, {
    userId: 'user-1',
    ids,
    urls,
  });

  assert.equal(calls.length, 6);
  assert.deepEqual(calls.map((call) => call.field), ['id', 'id', 'id', 'url', 'url', 'url']);
  assert.ok(calls.every((call) => call.count <= 100));
  assert.ok(calls.every((call) => call.table === 'saved_items'));
  assert.ok(calls.every((call) => call.columns === 'id,url'));
  assert.ok(calls.every((call) => call.userFilter.field === 'user_id'));
  assert.ok(calls.every((call) => call.userFilter.value === 'user-1'));
  assert.ok(existingKeys.has('id:42'));
  assert.ok(existingKeys.has('url:https://instagram.com/reel/42'));
});

test('insertSavedItemRows keeps valid rows when duplicate races happen during insert', async () => {
  const rows = [
    { id: 'old', user_id: 'user-1', url: 'https://instagram.com/reel/old' },
    { id: 'new', user_id: 'user-1', url: 'https://instagram.com/reel/new' },
  ];
  const duplicateError = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "saved_items_user_id_url_key"',
    details: 'Key (user_id, url)=(user-1, https://instagram.com/reel/old) already exists.',
  };
  const calls = [];
  const client = {
    from(table) {
      assert.equal(table, 'saved_items');
      return {
        insert(value) {
          this.value = value;
          calls.push(value);
          return this;
        },
        async select(columns) {
          assert.equal(columns, '*');
          if (Array.isArray(this.value)) return { data: null, error: duplicateError };
          if (this.value.id === 'old') return { data: null, error: duplicateError };
          return { data: [this.value], error: null };
        },
      };
    },
  };

  const inserted = await insertSavedItemRows(client, rows);

  assert.deepEqual(inserted, [rows[1]]);
  assert.equal(calls.length, 3);
});

test('saved-item duplicate detection only accepts expected unique conflicts', () => {
  assert.equal(isExpectedSavedItemDuplicateError({
    code: '23505',
    message: 'duplicate key value violates unique constraint "saved_items_pkey"',
    details: 'Key (user_id, id)=(user-1, item-1) already exists.',
  }), true);
  assert.equal(isExpectedSavedItemDuplicateError({
    code: '23505',
    message: 'duplicate key value violates unique constraint "unrelated_unique_key"',
  }), false);
  assert.equal(isExpectedSavedItemDuplicateError({ code: '42501', message: 'permission denied' }), false);
});

function fakePagedClient(totalRows) {
  const calls = [];
  const rows = Array.from({ length: totalRows }, (_, index) => ({ id: `item-${index}` }));
  const query = {
    select() { return this; },
    eq() { return this; },
    order() { return this; },
    range(from, to) {
      calls.push([from, to]);
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
  };
  return {
    calls,
    from(table) {
      assert.equal(table, 'saved_items');
      return query;
    },
  };
}

test('selectAllUserSavedItems pages beyond Supabase default 1000-row response size', async () => {
  const client = fakePagedClient(2456);

  const rows = await selectAllUserSavedItems(client, 'user-1');

  assert.equal(rows.length, 2456);
  assert.deepEqual(client.calls, [
    [0, 999],
    [1000, 1999],
    [2000, 2999],
  ]);
});

test('selectUserSavedItemPage applies range-backed filters and returns total count', async () => {
  const calls = [];
  const rows = [{ id: 'web-1', user_id: 'user-1', platform: 'Web', collections: ['Research'] }];
  const query = {
    select(columns, options) {
      calls.push(['select', columns, options]);
      return this;
    },
    eq(field, value) {
      calls.push(['eq', field, value]);
      return this;
    },
    or(value) {
      calls.push(['or', value]);
      return this;
    },
    order(field, options) {
      calls.push(['order', field, options]);
      return this;
    },
    range(from, to) {
      calls.push(['range', from, to]);
      return Promise.resolve({ data: rows, count: 23, error: null });
    },
  };
  const client = {
    from(table) {
      calls.push(['from', table]);
      return query;
    },
  };

  const page = await selectUserSavedItemPage(client, 'user-1', {
    limit: 10,
    offset: 20,
    sort: 'updated',
    type: 'links',
    state: 'all',
    collection: 'all',
    platform: 'all',
  });

  assert.deepEqual(page, { rows, count: 23 });
  assert.deepEqual(calls, [
    ['from', 'saved_items'],
    ['select', 'id,user_id,import_id,url,content_type,caption,hashtags,owner_name,owner_username,saved_at_text,collections,platform,platform_key,source_id,source_title,source_author,source_description,thumbnail_url,status,error,created_at,updated_at,item_analysis(title,summary,transcript,ocr_text,visual_description,brands_mentioned,tools_mentioned,repos_mentioned,people_mentioned,topics,tags,why_useful),item_assets(*)', { count: 'exact' }],
    ['eq', 'user_id', 'user-1'],
    ['or', 'platform_key.eq.web,id.like.web-%'],
    ['order', 'updated_at', { ascending: false }],
    ['order', 'id', { ascending: true }],
    ['range', 20, 29],
  ]);
});

test('Supabase saved item selection does not expose internal analysis processing level', async () => {
  const calls = [];
  const query = {
    select(columns, options) {
      calls.push(['select', columns, options]);
      return this;
    },
    eq() {
      return this;
    },
    order() {
      return this;
    },
    range() {
      return Promise.resolve({ data: [], count: 0, error: null });
    },
  };
  const client = {
    from(table) {
      calls.push(['from', table]);
      return query;
    },
  };

  await selectUserSavedItemPage(client, 'user-1', {
    limit: 1,
    offset: 0,
    sort: 'newest',
    type: 'all',
    state: 'all',
    collection: 'all',
    platform: 'all',
  });

  const selectCall = calls.find((call) => call[0] === 'select');
  assert.equal(selectCall[1].includes('processing_level'), false);
});

test('Supabase analysis metadata reader maps internal hashes without public item selection', async () => {
  const calls = [];
  const query = {
    select(columns) {
      calls.push(['select', columns]);
      return this;
    },
    eq(field, value) {
      calls.push(['eq', field, value]);
      return this;
    },
    maybeSingle() {
      calls.push(['maybeSingle']);
      return Promise.resolve({
        data: {
          processing_level: 'ml',
          source_content_hash: 'source-hash',
          embedding_content_hash: 'embedding-hash',
        },
        error: null,
      });
    },
  };
  const store = createSupabaseStore({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'service-role-key',
  });
  store.client.from = (table) => {
    calls.push(['from', table]);
    return query;
  };

  const metadata = await store.getAnalysisMetadata('user-1', 'item-1');

  assert.deepEqual(metadata, {
    processingLevel: 'ml',
    sourceContentHash: 'source-hash',
    embeddingContentHash: 'embedding-hash',
  });
  assert.deepEqual(calls, [
    ['from', 'item_analysis'],
    ['select', 'processing_level, source_content_hash, embedding_content_hash'],
    ['eq', 'user_id', 'user-1'],
    ['eq', 'item_id', 'item-1'],
    ['maybeSingle'],
  ]);
});

test('Supabase visual embedding writer keeps vectors in derived table', async () => {
  const calls = [];
  const query = {
    upsert(value, options) {
      calls.push(['upsert', value, options]);
      return this;
    },
    throwOnError() {
      calls.push(['throwOnError']);
      return Promise.resolve();
    },
  };
  const store = createSupabaseStore({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'service-role-key',
  });
  store.client.from = (table) => {
    calls.push(['from', table]);
    return query;
  };

  await store.saveVisualEmbedding('user-1', 'item-1', {
    embedding: [0.1, 0.2, 0.3],
    contentHash: 'source-hash',
    model: 'clip-vit-base',
  });

  assert.deepEqual(calls, [
    ['from', 'item_visual_embeddings'],
    ['upsert', {
      item_id: 'item-1',
      user_id: 'user-1',
      embedding: [0.1, 0.2, 0.3],
      content_hash: 'source-hash',
      embedding_model: 'clip-vit-base',
    }, { onConflict: 'user_id,item_id' }],
    ['throwOnError'],
  ]);
});
