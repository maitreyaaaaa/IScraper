const crypto = require('crypto');
const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const net = require('net');
const { URL } = require('url');
const cheerio = require('cheerio');

const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_TEXT_CHARS = 60000;
const MAX_ARCHIVE_HTML_CHARS = 90000;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_REDIRECTS = 4;
const USER_AGENT = 'IScraper Page Backup/1.0 (+https://iscraper.app)';
const ARCHIVE_STATUSES = new Set(['pending', 'ready', 'failed', 'skipped']);

class PageArchiveError extends Error {
  constructor(code, message, statusCode = null) {
    super(message);
    this.name = 'PageArchiveError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function archiveError(code, message, statusCode = null) {
  return new PageArchiveError(code, message, statusCode);
}

function validatePublicHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw archiveError('invalid_url', 'Only public http and https pages can be backed up.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw archiveError('unsupported_protocol', 'Only public http and https pages can be backed up.');
  }
  const explicitPort = parsed.port ? Number(parsed.port) : null;
  if (explicitPort && !((parsed.protocol === 'http:' && explicitPort === 80) || (parsed.protocol === 'https:' && explicitPort === 443))) {
    throw archiveError('blocked_port', 'This page uses a port that cannot be backed up.');
  }
  return parsed;
}

function isBlockedHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return !normalized || normalized === 'localhost' || normalized.endsWith('.localhost');
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address) {
  const normalized = String(address || '').toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
}

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

async function safeLookup(hostname) {
  if (isBlockedHostname(hostname)) {
    throw archiveError('blocked_host', 'This site cannot be backed up.');
  }
  const records = await dns.lookup(hostname, { all: true, verbatim: false });
  const safe = records.filter((record) => record.address && !isPrivateAddress(record.address));
  if (!safe.length || safe.length !== records.length) {
    throw archiveError('blocked_host', 'This site cannot be backed up.');
  }
  return safe[0];
}

function resolveRedirect(currentUrl, location) {
  if (!location) throw archiveError('bad_redirect', 'This page redirected without a usable destination.');
  return validatePublicHttpUrl(new URL(location, currentUrl).toString()).toString();
}

function requestReadablePage(url, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes || MAX_ARCHIVE_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const method = options.method || 'GET';
  const readBody = options.readBody !== false;
  const requireReadableContent = options.requireReadableContent !== false;

  async function requestOnce(nextUrl, redirectsLeft) {
    const parsed = validatePublicHttpUrl(nextUrl);
    await safeLookup(parsed.hostname);
    const transport = parsed.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };
      const req = transport.request({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: options.accept || 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2',
          'Accept-Language': 'en-US,en;q=0.8',
        },
        lookup: async (hostname, _opts, cb) => {
          try {
            const record = await safeLookup(hostname);
            cb(null, record.address, record.family);
          } catch (error) {
            cb(error);
          }
        },
      }, (res) => {
        const statusCode = Number(res.statusCode || 0);
        if (statusCode >= 300 && statusCode < 400) {
          res.resume();
          if (redirectsLeft <= 0) {
            finish(reject, archiveError('too_many_redirects', 'This page redirected too many times.', statusCode));
            return;
          }
          Promise.resolve()
            .then(() => requestOnce(resolveRedirect(nextUrl, res.headers.location), redirectsLeft - 1))
            .then((result) => finish(resolve, result))
            .catch((error) => finish(reject, error));
          return;
        }
        if (statusCode < 200 || statusCode >= 300) {
          res.resume();
          finish(reject, archiveError('http_status', 'This site did not return a readable page.', statusCode));
          return;
        }
        const contentType = String(res.headers['content-type'] || '').toLowerCase();
        const readable = contentType.includes('text/html') || contentType.includes('application/xhtml+xml') || contentType.includes('text/plain') || !contentType;
        if (requireReadableContent && !readable) {
          res.resume();
          finish(reject, archiveError('unsupported_content_type', 'This page type cannot be backed up.', statusCode));
          return;
        }
        if (!readBody) {
          res.resume();
          finish(resolve, {
            finalUrl: nextUrl,
            statusCode,
            contentType,
            body: '',
          });
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy(archiveError('too_large', 'This page is too large to back up.', statusCode));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          finish(resolve, {
            finalUrl: nextUrl,
            statusCode,
            contentType,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      });
      req.on('timeout', () => req.destroy(archiveError('timeout', 'This site took too long to respond.')));
      req.on('error', (error) => finish(reject, error instanceof PageArchiveError ? error : archiveError('fetch_failed', 'This page could not be backed up.')));
      req.setTimeout(timeoutMs);
      req.end();
    });
  }

  return requestOnce(url, maxRedirects);
}

function compactText(value, limit = MAX_ARCHIVE_TEXT_CHARS) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, limit);
}

function textFromMeta($, selectors) {
  for (const selector of selectors) {
    const value = $(selector).attr('content') || $(selector).text();
    const cleaned = compactText(value, 500);
    if (cleaned) return cleaned;
  }
  return '';
}

function scoreNode($, element) {
  const node = $(element);
  const text = compactText(node.text(), MAX_ARCHIVE_TEXT_CHARS);
  const paragraphs = node.find('p').length;
  const headings = node.find('h1,h2,h3').length;
  return text.length + paragraphs * 220 + headings * 80;
}

function bestReadableRoot($) {
  const candidates = $('article, main, [role="main"], .article-content, .entry-content, .post-content, .content, body').toArray();
  if (!candidates.length) return $('body');
  const best = candidates
    .map((element) => ({ element, score: scoreNode($, element) }))
    .sort((a, b) => b.score - a.score)[0];
  return $(best.element);
}

function htmlFromText(text) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
    .slice(0, MAX_ARCHIVE_HTML_CHARS);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeCanonicalUrl(value, fallbackUrl) {
  if (!value) return '';
  try {
    return validatePublicHttpUrl(new URL(value, fallbackUrl).toString()).toString();
  } catch {
    return '';
  }
}

function extractReadableCopy({ body, sourceUrl, finalUrl, statusCode, contentType }) {
  const isPlainText = String(contentType || '').toLowerCase().includes('text/plain');
  if (isPlainText) {
    const contentText = compactText(body);
    if (contentText.length < 80) throw archiveError('no_readable_content', 'No readable page text was found.', statusCode);
    return buildArchivePayload({
      sourceUrl,
      finalUrl,
      canonicalUrl: finalUrl,
      title: contentText.split('\n').find(Boolean)?.slice(0, 180) || 'Saved copy',
      siteName: new URL(finalUrl || sourceUrl).hostname,
      excerpt: contentText.slice(0, 280),
      contentText,
      contentHtml: htmlFromText(contentText),
      httpStatus: statusCode,
    });
  }

  const $ = cheerio.load(body || '');
  $('script,style,noscript,iframe,form,input,button,svg,canvas,video,audio,source,object,embed').remove();
  const root = bestReadableRoot($);
  const pieces = [];
  root.find('h1,h2,h3,p,li,blockquote,pre').each((_, element) => {
    const text = compactText($(element).text(), 4000);
    if (text) pieces.push(text);
  });
  const fallbackText = compactText(root.text());
  const contentText = compactText(pieces.length ? pieces.join('\n\n') : fallbackText);
  if (contentText.length < 80) throw archiveError('no_readable_content', 'No readable page text was found.', statusCode);

  const canonical = safeCanonicalUrl($('link[rel="canonical"]').attr('href'), finalUrl || sourceUrl);
  return buildArchivePayload({
    sourceUrl,
    finalUrl,
    canonicalUrl: canonical || finalUrl,
    title: textFromMeta($, [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'title',
      'h1',
    ]) || 'Saved copy',
    byline: textFromMeta($, [
      'meta[name="author"]',
      'meta[property="article:author"]',
      '[rel="author"]',
    ]),
    siteName: textFromMeta($, ['meta[property="og:site_name"]']) || new URL(finalUrl || sourceUrl).hostname,
    excerpt: textFromMeta($, [
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
    ]) || contentText.slice(0, 280),
    contentText,
    contentHtml: htmlFromText(contentText),
    httpStatus: statusCode,
  });
}

function buildArchivePayload(payload) {
  const contentText = compactText(payload.contentText);
  const contentHtml = String(payload.contentHtml || '').slice(0, MAX_ARCHIVE_HTML_CHARS);
  return {
    status: 'ready',
    sourceUrl: payload.sourceUrl,
    finalUrl: payload.finalUrl,
    canonicalUrl: payload.canonicalUrl || payload.finalUrl || payload.sourceUrl,
    title: compactText(payload.title, 240),
    byline: compactText(payload.byline, 160),
    siteName: compactText(payload.siteName, 160),
    excerpt: compactText(payload.excerpt, 500),
    contentText,
    contentHtml,
    textLength: contentText.length,
    byteSize: Buffer.byteLength(`${contentText}${contentHtml}`, 'utf8'),
    contentHash: crypto.createHash('sha256').update(contentText).digest('hex'),
    httpStatus: payload.httpStatus || null,
    errorCode: '',
    errorMessage: '',
    capturedAt: new Date().toISOString(),
  };
}

async function captureReadableCopy(url, options = {}) {
  const parsed = validatePublicHttpUrl(url);
  const response = await requestReadablePage(parsed.toString(), options);
  return extractReadableCopy({
    body: response.body,
    sourceUrl: parsed.toString(),
    finalUrl: response.finalUrl,
    statusCode: response.statusCode,
    contentType: response.contentType,
  });
}

async function checkPageReachable(url, options = {}) {
  const parsed = validatePublicHttpUrl(url);
  try {
    const response = await requestReadablePage(parsed.toString(), {
      method: 'HEAD',
      readBody: false,
      requireReadableContent: false,
      timeoutMs: options.timeoutMs || 5000,
      maxRedirects: options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
      accept: '*/*',
    });
    return {
      status: 'ok',
      sourceUrl: parsed.toString(),
      finalUrl: response.finalUrl,
      httpStatus: response.statusCode,
      errorCode: '',
      errorMessage: '',
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof PageArchiveError && [405, 501].includes(Number(error.statusCode || 0))) {
      try {
        const response = await requestReadablePage(parsed.toString(), {
          method: 'GET',
          readBody: false,
          requireReadableContent: false,
          timeoutMs: options.timeoutMs || 5000,
          maxRedirects: options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
          maxBytes: 2048,
          accept: '*/*',
        });
        return {
          status: 'ok',
          sourceUrl: parsed.toString(),
          finalUrl: response.finalUrl,
          httpStatus: response.statusCode,
          errorCode: '',
          errorMessage: '',
          checkedAt: new Date().toISOString(),
        };
      } catch (fallbackError) {
        return linkHealthFromError(parsed.toString(), fallbackError);
      }
    }
    return linkHealthFromError(parsed.toString(), error);
  }
}

function linkHealthFromError(sourceUrl, error) {
  const statusCode = Number(error?.statusCode || 0);
  const strongBroken = [404, 410].includes(statusCode);
  return {
    status: strongBroken ? 'broken' : 'unknown',
    sourceUrl,
    finalUrl: '',
    httpStatus: statusCode || null,
    errorCode: error?.code || 'check_failed',
    errorMessage: strongBroken ? 'This link no longer works.' : 'This link could not be checked right now.',
    checkedAt: new Date().toISOString(),
  };
}

function publicArchive(archive, { includeContent = true } = {}) {
  if (!archive) return null;
  const normalizedStatus = ARCHIVE_STATUSES.has(archive.status) ? archive.status : 'failed';
  const base = {
    id: archive.id || '',
    itemId: archive.itemId || archive.item_id || '',
    status: normalizedStatus,
    sourceUrl: archive.sourceUrl || archive.source_url || '',
    finalUrl: archive.finalUrl || archive.final_url || '',
    canonicalUrl: archive.canonicalUrl || archive.canonical_url || '',
    title: archive.title || '',
    byline: archive.byline || '',
    siteName: archive.siteName || archive.site_name || '',
    excerpt: archive.excerpt || '',
    textLength: Number(archive.textLength ?? archive.text_length ?? 0),
    byteSize: Number(archive.byteSize ?? archive.byte_size ?? 0),
    httpStatus: archive.httpStatus ?? archive.http_status ?? null,
    errorCode: archive.errorCode || archive.error_code || '',
    errorMessage: archive.errorMessage || archive.error_message || '',
    capturedAt: archive.capturedAt || archive.captured_at || null,
    createdAt: archive.createdAt || archive.created_at || null,
    updatedAt: archive.updatedAt || archive.updated_at || null,
  };
  if (includeContent) {
    base.contentText = archive.contentText || archive.content_text || '';
    base.contentHtml = archive.contentHtml || archive.content_html || '';
    base.contentHash = archive.contentHash || archive.content_hash || '';
  }
  return base;
}

function shouldAttemptPageArchive(item) {
  if (!item?.url || item.contentType === 'note' || item.platformKey === 'iscraper-note') return false;
  try {
    validatePublicHttpUrl(item.url);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  ARCHIVE_STATUSES,
  PageArchiveError,
  checkPageReachable,
  captureReadableCopy,
  extractReadableCopy,
  publicArchive,
  shouldAttemptPageArchive,
  validatePublicHttpUrl,
};
