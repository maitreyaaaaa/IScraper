const assert = require('node:assert/strict');
const test = require('node:test');

const { selectAllUserSavedItems } = require('../src/stores/supabaseStore');

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
