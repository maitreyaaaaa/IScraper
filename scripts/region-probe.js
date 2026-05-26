const { performance } = require('node:perf_hooks');

const DEFAULT_TARGETS = ['https://iscraper.vercel.app'];
const targetInput = process.env.REGION_TARGETS || process.env.BASE_URL || DEFAULT_TARGETS.join(',');
const targets = targetInput
  .split(',')
  .map((entry) => entry.trim().replace(/\/$/, ''))
  .filter(Boolean);

const repeat = Math.max(1, Math.min(Number(process.env.REGION_PROBE_REPEAT || 3), 20));
const path = process.env.REGION_PROBE_PATH || '/api/health';

function parseVercelId(value = '') {
  const parts = String(value).split('::');
  return {
    edgePop: parts[0] || '',
    functionRegion: parts[1] || '',
    raw: value || '',
  };
}

async function probe(target) {
  const samples = [];
  for (let index = 0; index < repeat; index += 1) {
    const started = performance.now();
    const response = await fetch(`${target}${path}`, {
      headers: { 'X-IScraper-Client-Action': 'region-probe' },
      cache: 'no-store',
    });
    const durationMs = Math.round(performance.now() - started);
    const vercelId = response.headers.get('x-vercel-id') || '';
    const requestId = response.headers.get('x-request-id') || '';
    const cache = response.headers.get('x-vercel-cache') || '';
    samples.push({
      target,
      path,
      status: response.status,
      durationMs,
      requestId: requestId ? '[present]' : '',
      cache,
      ...parseVercelId(vercelId),
    });
  }
  return samples;
}

function summarize(samples) {
  const durations = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const max = durations.at(-1) || 0;
  const min = durations[0] || 0;
  const avg = durations.length
    ? Math.round(durations.reduce((total, value) => total + value, 0) / durations.length)
    : 0;
  const first = samples[0] || {};
  return {
    target: first.target,
    path: first.path,
    samples: samples.length,
    statusCodes: [...new Set(samples.map((sample) => sample.status))].join(','),
    minMs: min,
    avgMs: avg,
    maxMs: max,
    edgePops: [...new Set(samples.map((sample) => sample.edgePop).filter(Boolean))].join(','),
    functionRegions: [...new Set(samples.map((sample) => sample.functionRegion).filter(Boolean))].join(','),
    requestIdSeen: samples.some((sample) => sample.requestId === '[present]'),
    cacheValues: [...new Set(samples.map((sample) => sample.cache).filter(Boolean))].join(','),
  };
}

async function main() {
  const allSamples = [];
  for (const target of targets) {
    allSamples.push(...await probe(target));
  }
  const summaries = targets.map((target) => summarize(allSamples.filter((sample) => sample.target === target)));
  console.table(summaries);

  if (process.env.REGION_PROBE_JSON === 'true') {
    console.log(JSON.stringify({ summaries, samples: allSamples }, null, 2));
  }

  const failed = allSamples.filter((sample) => sample.status >= 500 || sample.status === 0);
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
