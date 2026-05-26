const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { createWorkerRuntime, getWorkerStatus, runWorkerPass } = require('../src/runtime/workerRuntime');
const { createLocalStore } = require('../src/stores/localStore');
const { checkWorkerPreflight } = require('../src/worker/preflight');
const { createShutdownController } = require('../src/worker/indexing-runner');

function seedQueuedJob(store, dir) {
  const userId = 'ops-user';
  store.ensureUser(userId, 'ops-user@example.com');
  const entry = store.createImport({ userId, source: 'manual-link', fileNames: ['ops.json'] });
  const items = store.upsertImportData({
    userId,
    importId: entry.id,
    initialStatus: 'queued',
    parsed: {
      collections: [],
      items: [{
        id: 'ops-worker-job',
        url: 'https://example.com/ops-worker-job',
        contentType: 'unknown',
        caption: 'Operations smoke test item',
        hashtags: [],
        collections: [],
      }],
    },
  });
  store.createJobs({ userId, importId: entry.id, items });
  return { userId, importId: entry.id, videoDir: path.join(dir, 'videos') };
}

test('worker preflight fails closed without leaking secret values', () => {
  const result = checkWorkerPreflight({
    storageMode: 'local',
    supabaseServiceRoleKey: 'super-secret-service-role',
    credentialEncryptionKey: 'super-secret-encryption-key',
    openRouterApiKey: 'super-secret-openrouter-key',
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.ok, false);
  assert.match(serialized, /STORAGE_MODE/);
  assert.match(serialized, /SUPABASE_URL/);
  assert.equal(serialized.includes('super-secret-service-role'), false);
  assert.equal(serialized.includes('super-secret-encryption-key'), false);
  assert.equal(serialized.includes('super-secret-openrouter-key'), false);
});

test('worker preflight accepts Supabase mode with a text indexing provider path', () => {
  const result = checkWorkerPreflight({
    storageMode: 'supabase',
    supabaseUrl: 'https://project.supabase.co',
    supabaseServiceRoleKey: 'super-secret-service-role',
    credentialEncryptionKey: 'super-secret-encryption-key',
    openRouterApiKey: 'super-secret-openrouter-key',
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.ok, true);
  assert.equal(serialized.includes('super-secret-service-role'), false);
  assert.equal(serialized.includes('super-secret-encryption-key'), false);
  assert.equal(serialized.includes('super-secret-openrouter-key'), false);
});

test('local worker smoke pass claims one job and returns aggregate-only status', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-ops-'));
  const store = createLocalStore({ dataPath: dir });

  try {
    const seed = seedQueuedJob(store, dir);
    const runtime = createWorkerRuntime({
      store,
      config: {
        videoDir: seed.videoDir,
        workerBatchSize: 1,
        workerScanLimit: 1,
        workerGlobalConcurrency: 1,
        workerPerUserConcurrency: 1,
        workerMaxAttempts: 3,
      },
    });

    const pass = await runWorkerPass({ runtime, maxJobs: 1, scopeLimit: 1 });
    const jobs = store.getJobs(seed.userId);
    const status = await getWorkerStatus({ runtime });
    const serializedStatus = JSON.stringify(status);

    assert.equal(pass.scopeCount, 1);
    assert.equal(jobs[0].attempts, 1);
    assert.equal(jobs[0].status, 'paused_missing_provider');
    assert.equal(status.queue.paused, 1);
    assert.equal(serializedStatus.includes('Operations smoke test item'), false);
    assert.equal(serializedStatus.includes('https://example.com/ops-worker-job'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('indexing runner --once exits after one bounded local pass', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'insta-brain-cli-'));

  try {
    const result = spawnSync(process.execPath, ['src/worker/indexing-runner.js', '--once'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        DATA_PATH: dir,
        STORAGE_MODE: 'local',
        POSTHOG_ENABLED: 'false',
        WORKER_BATCH_SIZE: '1',
        WORKER_SCAN_LIMIT: '1',
        WORKER_IDLE_MS: '1000',
      },
      encoding: 'utf8',
      timeout: 10_000,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shutdown controller interrupts idle sleep and logs only aggregate signal data', async () => {
  const events = [];
  const controller = createShutdownController({
    observability: {
      warn: (event, properties) => events.push({ event, properties }),
    },
  });

  const sleepStartedAt = Date.now();
  const sleeping = controller.sleep(10_000);
  controller.requestShutdown('SIGTERM');
  await sleeping;
  const elapsedMs = Date.now() - sleepStartedAt;
  const serialized = JSON.stringify(events);

  assert.equal(controller.shouldContinue(), false);
  assert.equal(events[0].event, 'worker shutdown requested');
  assert.equal(events[0].properties.signal, 'SIGTERM');
  assert.equal(elapsedMs < 1000, true);
  assert.equal(serialized.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
  assert.equal(serialized.includes('OPENROUTER_API_KEY'), false);
});

test('Render worker blueprint uses the loop command and keeps secrets unsynced', () => {
  const blueprint = readFileSync(path.join(__dirname, '../../../render.yaml'), 'utf8');

  assert.match(blueprint, /type:\s*worker/);
  assert.match(blueprint, /name:\s*iscraper-indexing-worker/);
  assert.match(blueprint, /numInstances:\s*1/);
  assert.match(blueprint, /startCommand:\s*npm run worker:loop/);
  assert.match(blueprint, /key:\s*SUPABASE_SERVICE_ROLE_KEY\s*\r?\n\s*sync:\s*false/);
  assert.match(blueprint, /key:\s*CREDENTIAL_ENCRYPTION_KEY\s*\r?\n\s*sync:\s*false/);
  assert.equal(blueprint.includes('super-secret'), false);
});
