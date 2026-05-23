const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanDbText, getExistingSavedItemKeys, selectAllUserSavedItems } = require('../src/stores/supabaseStore');

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
