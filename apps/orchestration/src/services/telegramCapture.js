const { hashExtensionToken } = require('./extensionTokens');
const { normalizeSavedUrl } = require('./linkSaver');

const TELEGRAM_MESSAGE_MAX = 3900;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

function assertTelegramWebhookSecret(req, config = {}) {
  const expected = String(config.telegramWebhookSecret || '').trim();
  if (!expected) {
    const error = new Error('Telegram save bot is not configured.');
    error.statusCode = 503;
    throw error;
  }
  const provided = String(req.header('x-telegram-bot-api-secret-token') || '').trim();
  if (!provided || provided !== expected) {
    const error = new Error('Telegram webhook secret is invalid.');
    error.statusCode = 401;
    throw error;
  }
}

function parseTelegramUpdate(update = {}) {
  const message = update.message || update.edited_message || update.channel_post || null;
  if (!message?.chat?.id) return null;
  const text = String(message.text || message.caption || '').trim();
  return {
    updateId: update.update_id || null,
    messageId: message.message_id || null,
    chatId: String(message.chat.id),
    chatType: message.chat.type || '',
    username: message.from?.username || message.chat.username || '',
    displayName: [message.from?.first_name || message.chat.first_name, message.from?.last_name || message.chat.last_name]
      .filter(Boolean)
      .join(' ')
      || message.chat.title
      || '',
    text,
    links: extractTelegramLinks(message, text),
  };
}

function extractTelegramLinks(message = {}, text = '') {
  const links = [];
  const sourceText = String(text || '');
  for (const entity of [...(message.entities || []), ...(message.caption_entities || [])]) {
    if (entity.type === 'text_link' && entity.url) links.push(entity.url);
    if (entity.type === 'url' && Number.isFinite(entity.offset) && Number.isFinite(entity.length)) {
      links.push(sourceText.slice(entity.offset, entity.offset + entity.length));
    }
  }
  for (const match of sourceText.matchAll(URL_RE)) links.push(match[0]);

  const seen = new Set();
  return links
    .map((link) => String(link || '').replace(/[.,!?;:]+$/, ''))
    .filter((link) => {
      try {
        const normalized = normalizeSavedUrl(link);
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      } catch {
        return false;
      }
    });
}

function parseTelegramCommand(text = '') {
  const trimmed = String(text || '').trim();
  const match = trimmed.match(/^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+(.+))?$/);
  if (!match) return null;
  return {
    command: match[1].toLowerCase(),
    arg: String(match[2] || '').trim(),
  };
}

function cleanTelegramToken(value = '') {
  const match = String(value || '').trim().match(/isx_[A-Za-z0-9_-]+/);
  return match ? match[0] : '';
}

function telegramReply(text, extra = {}) {
  return {
    ok: true,
    text: String(text || '').slice(0, TELEGRAM_MESSAGE_MAX),
    ...extra,
  };
}

async function sendTelegramReply(config = {}, chatId, text) {
  const token = String(config.telegramBotToken || '').trim();
  if (!token || !chatId || !text || typeof fetch !== 'function') return { skipped: true };
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: String(text).slice(0, TELEGRAM_MESSAGE_MAX),
      disable_web_page_preview: true,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Telegram sendMessage failed: ${response.status} ${body}`.slice(0, 500));
  }
  return response.json().catch(() => ({ ok: true }));
}

function tokenHashFromConnectText(text = '') {
  const command = parseTelegramCommand(text);
  const raw = command?.arg || text;
  const token = cleanTelegramToken(raw);
  return token ? hashExtensionToken(token) : '';
}

module.exports = {
  assertTelegramWebhookSecret,
  parseTelegramUpdate,
  parseTelegramCommand,
  telegramReply,
  sendTelegramReply,
  tokenHashFromConnectText,
};
