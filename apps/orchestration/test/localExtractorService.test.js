const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');

const {
  analyzeImagePayload,
  analyzeMediaPayload,
  averageEmbeddings,
  createLocalExtractorApp,
  localExtractorConfigFromEnv,
  parseVisualEmbeddingOutput,
} = require('../src/ml/localExtractorService');

test('local extractor config reads OCR and ASR engine settings from env', () => {
  const config = localExtractorConfigFromEnv({
    LOCAL_ML_HOST: '127.0.0.1',
    LOCAL_ML_PORT: '4040',
    LOCAL_ML_API_KEY: 'local-key',
    LOCAL_ML_JSON_LIMIT: '2mb',
    LOCAL_ML_MAX_MEDIA_FILES: '3',
    TESSERACT_CMD: 'custom-tesseract',
    WHISPER_CMD: 'custom-whisper',
    WHISPER_MODEL: 'small',
    VISUAL_EMBEDDING_CMD: 'clip-embed',
    VISUAL_EMBEDDING_MODEL: 'clip-vit-base',
    VISUAL_EMBEDDING_TIMEOUT_MS: '45000',
  });

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 4040);
  assert.equal(config.apiKey, 'local-key');
  assert.equal(config.jsonBodyLimit, '2mb');
  assert.equal(config.maxMediaFiles, 3);
  assert.equal(config.tesseractCmd, 'custom-tesseract');
  assert.equal(config.whisperCmd, 'custom-whisper');
  assert.equal(config.whisperModel, 'small');
  assert.equal(config.visualEmbeddingCmd, 'clip-embed');
  assert.equal(config.visualEmbeddingModel, 'clip-vit-base');
  assert.equal(config.visualEmbeddingTimeoutMs, 45000);
});

test('image payload OCR uses configured tesseract command and returns searchable analysis', async () => {
  const commands = [];
  const analysis = await analyzeImagePayload({
    payload: {
      item: { caption: 'Pricing screenshot' },
      image: {
        mimeType: 'image/png',
        base64: Buffer.from('fake-png').toString('base64'),
      },
    },
    config: {
      tesseractCmd: 'tesseract-test',
      maxImageBytes: 1024,
    },
    createTempDir: async () => mkdtempSync(path.join(tmpdir(), 'iscraper-ocr-test-')),
    runCommand: async (command, args) => {
      commands.push({ command, args });
      return { stdout: 'OpenAI Codex launch checklist', stderr: '' };
    },
  });

  assert.equal(commands.length, 1);
  assert.equal(commands[0].command, 'tesseract-test');
  assert.equal(commands[0].args[1], 'stdout');
  assert.equal(analysis.ocrText, 'OpenAI Codex launch checklist');
  assert.ok(analysis.toolsMentioned.includes('OpenAI'));
});

test('image payload can return a local visual embedding', async () => {
  const commands = [];
  const analysis = await analyzeImagePayload({
    payload: {
      item: { caption: 'Moodboard screenshot' },
      image: {
        mimeType: 'image/png',
        base64: Buffer.from('fake-png').toString('base64'),
      },
    },
    config: {
      tesseractCmd: '',
      visualEmbeddingCmd: 'clip-embed-test',
      visualEmbeddingModel: 'clip-vit-base',
      maxImageBytes: 1024,
    },
    createTempDir: async () => mkdtempSync(path.join(tmpdir(), 'iscraper-visual-test-')),
    runCommand: async (command, args) => {
      commands.push({ command, args });
      return { stdout: JSON.stringify({ embedding: [0.1, 0.2, 0.3] }), stderr: '' };
    },
  });

  assert.equal(commands.length, 1);
  assert.equal(commands[0].command, 'clip-embed-test');
  assert.deepEqual(analysis.visualEmbedding, [0.1, 0.2, 0.3]);
  assert.equal(analysis.visualEmbeddingModel, 'clip-vit-base');
});

test('media payload OCR reads image paths without sending media to a paid model', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'iscraper-media-test-'));
  const imagePath = path.join(dir, 'capture.png');
  writeFileSync(imagePath, 'fake-image');
  const commands = [];

  try {
    const analysis = await analyzeMediaPayload({
      payload: {
        item: { caption: 'Launch notes' },
        media: [{ path: imagePath, kind: 'image' }],
      },
      config: {
        tesseractCmd: 'tesseract-test',
        maxImageBytes: 1024,
        maxMediaFiles: 6,
      },
      runCommand: async (command, args) => {
        commands.push({ command, args });
        return { stdout: 'Supabase launch checklist', stderr: '' };
      },
    });

    assert.equal(commands.length, 1);
    assert.equal(commands[0].args[0], imagePath);
    assert.equal(analysis.ocrText, 'Supabase launch checklist');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('media payload averages compatible image embeddings', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'iscraper-media-visual-test-'));
  const firstPath = path.join(dir, 'first.png');
  const secondPath = path.join(dir, 'second.png');
  writeFileSync(firstPath, 'fake-image-1');
  writeFileSync(secondPath, 'fake-image-2');
  const vectors = new Map([
    [firstPath, [1, 0]],
    [secondPath, [0.8, 0.2]],
  ]);

  try {
    const analysis = await analyzeMediaPayload({
      payload: {
        item: { caption: 'Visual board' },
        media: [{ path: firstPath, kind: 'image' }, { path: secondPath, kind: 'image' }],
      },
      config: {
        tesseractCmd: '',
        visualEmbeddingCmd: 'clip-embed-test',
        visualEmbeddingModel: 'clip-vit-base',
        maxImageBytes: 1024,
        maxMediaFiles: 6,
      },
      runCommand: async (_command, args) => ({
        stdout: JSON.stringify({ imageEmbedding: vectors.get(args[0]) }),
        stderr: '',
      }),
    });

    assert.deepEqual(analysis.visualEmbedding, [0.9, 0.1]);
    assert.equal(analysis.visualEmbeddingModel, 'clip-vit-base');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('visual embedding helpers parse command output', () => {
  assert.deepEqual(parseVisualEmbeddingOutput('[0.1, 0.2]'), [0.1, 0.2]);
  assert.deepEqual(parseVisualEmbeddingOutput('{"visualEmbedding":[0.3,0.4]}'), [0.3, 0.4]);
  assert.deepEqual(averageEmbeddings([[1, 0], [0, 1]]), [0.5, 0.5]);
});

test('media payload ASR reads whisper transcript for video paths', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'iscraper-asr-test-'));
  const videoPath = path.join(dir, 'clip.mp4');
  const transcriptDir = path.join(dir, 'transcript');
  writeFileSync(videoPath, 'fake-video');
  const commands = [];

  try {
    const analysis = await analyzeMediaPayload({
      payload: {
        item: { caption: 'Video note' },
        media: [{ path: videoPath, kind: 'video' }],
      },
      config: {
        whisperCmd: 'whisper-test',
        whisperModel: 'base',
        maxVideoBytes: 1024,
        maxMediaFiles: 6,
      },
      createTempDir: async () => {
        writeFileSync(path.join(dir, '.keep'), '');
        return transcriptDir;
      },
      runCommand: async (command, args) => {
        commands.push({ command, args });
        await fs.mkdir(transcriptDir, { recursive: true });
        writeFileSync(path.join(transcriptDir, 'clip.txt'), 'Spoken product launch notes');
        return { stdout: '', stderr: '' };
      },
    });

    assert.equal(commands.length, 1);
    assert.equal(commands[0].command, 'whisper-test');
    assert.equal(commands[0].args[0], videoPath);
    assert.equal(analysis.transcript, 'Spoken product launch notes');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('local extractor app requires API key when configured', async () => {
  const app = createLocalExtractorApp({
    config: {
      apiKey: 'local-secret',
      jsonBodyLimit: '1mb',
      tesseractCmd: '',
    },
  });
  const server = app.listen(0);

  try {
    const port = server.address().port;
    const denied = await fetch(`http://127.0.0.1:${port}/health`);
    const allowed = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { 'x-local-ml-api-key': 'local-secret' },
    });
    const allowedBody = await allowed.json();

    assert.equal(denied.status, 401);
    assert.equal(allowed.status, 200);
    assert.equal(allowedBody.status, 'ok');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
