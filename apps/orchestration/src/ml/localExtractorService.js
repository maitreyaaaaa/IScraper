const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const express = require('express');
const { analyzeTextMetadata } = require('../services/analyzer');
const { normalizeVisualEmbedding } = require('../services/visualEmbeddings');

const DEFAULT_TIMEOUT_MS = 60 * 1000;
const DEFAULT_JSON_LIMIT = '8mb';

function createLocalExtractorApp({
  config = localExtractorConfigFromEnv(),
  runCommand = execFileCommand,
  createTempDir = defaultCreateTempDir,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: config.jsonBodyLimit || DEFAULT_JSON_LIMIT }));
  app.use((req, res, next) => {
    const expected = String(config.apiKey || '').trim();
    if (!expected) return next();
    const provided = String(req.header('x-local-ml-api-key') || '').trim();
    if (!provided || !timingSafeEqual(provided, expected)) {
      return res.status(401).json({ error: 'Local extractor key is invalid.' });
    }
    return next();
  });

  app.get('/health', async (_req, res) => {
    res.json({
      status: 'ok',
      engines: {
        ocr: Boolean(config.tesseractCmd),
        asr: Boolean(config.whisperCmd),
        visualEmbedding: Boolean(config.visualEmbeddingCmd),
      },
    });
  });

  app.post('/v1/image/analyze', async (req, res, next) => {
    try {
      const analysis = await analyzeImagePayload({
        payload: req.body,
        config,
        runCommand,
        createTempDir,
      });
      res.json({ analysis });
    } catch (error) {
      next(error);
    }
  });

  app.post('/v1/media/analyze', async (req, res, next) => {
    try {
      const analysis = await analyzeMediaPayload({
        payload: req.body,
        config,
        runCommand,
        createTempDir,
      });
      res.json({ analysis });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({ error: error.publicMessage || 'Local extraction failed.' });
  });

  return app;
}

async function analyzeImagePayload({ payload, config, runCommand, createTempDir }) {
  const image = payload?.image || {};
  const buffer = Buffer.from(String(image.base64 || ''), 'base64');
  if (!buffer.length) return emptyAnalysis(payload?.item);
  assertPayloadSize(buffer.length, config.maxImageBytes, 'Image');

  const tempDir = await createTempDir('iscraper-ocr-');
  const imagePath = path.join(tempDir, `capture${extensionForMime(image.mimeType || 'image/png')}`);
  await fs.writeFile(imagePath, buffer);
  try {
    const ocrText = await extractImageText({ imagePath, config, runCommand });
    const visualEmbedding = await extractImageEmbedding({ imagePath, config, runCommand });
    return buildAnalysis({ item: payload?.item, ocrText, visualEmbedding, visualEmbeddingModel: config.visualEmbeddingModel });
  } finally {
    await rmSafe(tempDir);
  }
}

async function analyzeMediaPayload({ payload, config, runCommand, createTempDir = defaultCreateTempDir }) {
  const media = Array.isArray(payload?.media) ? payload.media : [];
  const outputs = [];

  for (const entry of media.slice(0, config.maxMediaFiles || 6)) {
    const mediaPath = String(entry?.path || '').trim();
    if (!mediaPath) continue;
    const stat = await fs.stat(mediaPath).catch(() => null);
    if (!stat?.isFile()) continue;
    const kind = entry.kind || mediaKind(mediaPath);
    if (kind === 'video') {
      assertPayloadSize(stat.size, config.maxVideoBytes, 'Video');
      outputs.push({ transcript: await extractVideoTranscript({ mediaPath, config, runCommand, createTempDir }) });
    } else {
      assertPayloadSize(stat.size, config.maxImageBytes, 'Image');
      outputs.push({
        ocrText: await extractImageText({ imagePath: mediaPath, config, runCommand }),
        visualEmbedding: await extractImageEmbedding({ imagePath: mediaPath, config, runCommand }),
      });
    }
  }

  return buildAnalysis({
    item: payload?.item,
    ocrText: outputs.map((entry) => entry.ocrText).filter(Boolean).join('\n\n'),
    transcript: outputs.map((entry) => entry.transcript).filter(Boolean).join('\n\n'),
    visualEmbedding: averageEmbeddings(outputs.map((entry) => entry.visualEmbedding).filter(Boolean)),
    visualEmbeddingModel: config.visualEmbeddingModel,
  });
}

async function extractImageText({ imagePath, config, runCommand }) {
  const cmd = String(config.tesseractCmd || '').trim();
  if (!cmd) return '';
  const result = await runCommand(cmd, [imagePath, 'stdout'], { timeoutMs: config.ocrTimeoutMs || DEFAULT_TIMEOUT_MS });
  return cleanText(result.stdout);
}

async function extractVideoTranscript({ mediaPath, config, runCommand, createTempDir = defaultCreateTempDir }) {
  const cmd = String(config.whisperCmd || '').trim();
  if (!cmd) return '';
  const tempDir = await createTempDir('iscraper-asr-');
  try {
    const model = String(config.whisperModel || 'base').trim();
    await runCommand(cmd, [
      mediaPath,
      '--model',
      model,
      '--output_format',
      'txt',
      '--output_dir',
      tempDir,
      '--fp16',
      'False',
    ], { timeoutMs: config.asrTimeoutMs || 5 * DEFAULT_TIMEOUT_MS });
    const transcriptPath = path.join(tempDir, `${path.parse(mediaPath).name}.txt`);
    return cleanText(await fs.readFile(transcriptPath, 'utf8').catch(() => ''));
  } finally {
    await rmSafe(tempDir);
  }
}

async function extractImageEmbedding({ imagePath, config, runCommand }) {
  const cmd = String(config.visualEmbeddingCmd || '').trim();
  if (!cmd) return null;
  const result = await runCommand(cmd, [imagePath], { timeoutMs: config.visualEmbeddingTimeoutMs || DEFAULT_TIMEOUT_MS });
  return parseVisualEmbeddingOutput(result.stdout);
}

function parseVisualEmbeddingOutput(output) {
  const raw = String(output || '').trim();
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return normalizeVisualEmbedding(parsed.embedding || parsed.visualEmbedding || parsed.imageEmbedding || parsed);
}

function averageEmbeddings(embeddings = []) {
  const normalized = embeddings.filter((entry) => Array.isArray(entry) && entry.length);
  if (!normalized.length) return null;
  const dimensions = normalized[0].length;
  const compatible = normalized.filter((entry) => entry.length === dimensions);
  if (!compatible.length) return null;
  return compatible[0].map((_, index) => (
    compatible.reduce((total, vector) => total + vector[index], 0) / compatible.length
  ));
}

function buildAnalysis({ item = {}, ocrText = '', transcript = '', visualEmbedding = null, visualEmbeddingModel = 'local-ml-visual' } = {}) {
  const analysis = analyzeTextMetadata({
    caption: item.caption || '',
    ocrText,
    transcript,
  });
  const normalized = {
    ...analysis,
    ocrText: cleanText(ocrText),
    transcript: cleanText(transcript),
  };
  if (visualEmbedding) {
    normalized.visualEmbedding = visualEmbedding;
    normalized.visualEmbeddingModel = visualEmbeddingModel;
  }
  return normalized;
}

function emptyAnalysis(item = {}) {
  return buildAnalysis({ item });
}

function localExtractorConfigFromEnv(env = process.env) {
  return {
    host: env.LOCAL_ML_HOST || '127.0.0.1',
    port: Number(env.LOCAL_ML_PORT || 3037),
    apiKey: env.LOCAL_ML_API_KEY || '',
    jsonBodyLimit: env.LOCAL_ML_JSON_LIMIT || DEFAULT_JSON_LIMIT,
    tesseractCmd: env.TESSERACT_CMD || 'tesseract',
    whisperCmd: env.WHISPER_CMD || '',
    whisperModel: env.WHISPER_MODEL || 'base',
    visualEmbeddingCmd: env.VISUAL_EMBEDDING_CMD || '',
    visualEmbeddingModel: env.VISUAL_EMBEDDING_MODEL || 'local-ml-visual',
    maxMediaFiles: Number(env.LOCAL_ML_MAX_MEDIA_FILES || 6),
    maxImageBytes: Number(env.LOCAL_ML_MAX_IMAGE_BYTES || 20 * 1024 * 1024),
    maxVideoBytes: Number(env.LOCAL_ML_MAX_VIDEO_BYTES || 250 * 1024 * 1024),
    ocrTimeoutMs: Number(env.LOCAL_ML_OCR_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    asrTimeoutMs: Number(env.LOCAL_ML_ASR_TIMEOUT_MS || 5 * DEFAULT_TIMEOUT_MS),
    visualEmbeddingTimeoutMs: Number(env.VISUAL_EMBEDDING_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  };
}

function execFileCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function defaultCreateTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function timingSafeEqual(value, expected) {
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function assertPayloadSize(size, maxBytes, label) {
  const max = Number(maxBytes) || 0;
  if (max > 0 && size > max) {
    const error = new Error(`${label} is too large for local extraction.`);
    error.statusCode = 413;
    error.publicMessage = error.message;
    throw error;
  }
}

function extensionForMime(mimeType) {
  const lower = String(mimeType || '').toLowerCase();
  if (lower.includes('webp')) return '.webp';
  if (lower.includes('jpeg') || lower.includes('jpg')) return '.jpg';
  return '.png';
}

function mediaKind(mediaPath) {
  return /\.(mp4|mov|webm|m4v)$/i.test(String(mediaPath || '')) ? 'video' : 'image';
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function rmSafe(target) {
  await fs.rm(target, { recursive: true, force: true }).catch(() => {});
}

module.exports = {
  analyzeImagePayload,
  analyzeMediaPayload,
  averageEmbeddings,
  createLocalExtractorApp,
  extractImageText,
  extractImageEmbedding,
  extractVideoTranscript,
  localExtractorConfigFromEnv,
  parseVisualEmbeddingOutput,
};
