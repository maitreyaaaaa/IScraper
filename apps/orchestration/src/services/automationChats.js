const { randomUUID } = require('node:crypto');
const { createAutomationChatRepository } = require('../repositories/automationChatRepository');
const { validateAutomationInput } = require('./automations');

const CHAT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createAutomationChats({ store, automations, now = () => new Date() }) {
  const repository = createAutomationChatRepository({ store, now });

  return {
    list(userId, limit = 10) {
      return repository.list(userId, clampInteger(limit, 10, 1, 20));
    },
    async create(userId, input = {}) {
      return repository.create(userId, {
        id: randomUUID(),
        title: 'New automation',
        model: clean(input.model, 160) || 'openai/gpt-4o-mini',
        draft: null,
        automationId: null,
      });
    },
    get(userId, id) {
      assertChatId(id);
      return repository.get(userId, id);
    },
    async update(userId, id, input = {}) {
      assertChatId(id);
      const existing = await repository.get(userId, id);
      if (!existing) return null;
      const patch = {};
      if (Object.hasOwn(input, 'model')) patch.model = clean(input.model, 160) || existing.model;
      if (Object.hasOwn(input, 'draft')) patch.draft = input.draft === null ? null : sanitizeDraft(input.draft, now());
      if (Object.hasOwn(input, 'automationId')) {
        const automationId = input.automationId ? String(input.automationId) : null;
        if (automationId && !CHAT_ID_PATTERN.test(automationId)) throw httpError('Automation ID is invalid.', 400);
        if (automationId && !await automations.get(userId, automationId)) return null;
        patch.automationId = automationId;
      }
      if (!Object.keys(patch).length) throw httpError('Include a model, draft, or automationId to update.', 400);
      return repository.update(userId, id, patch);
    },
    async appendMessage(userId, id, input = {}) {
      assertChatId(id);
      const chat = await repository.get(userId, id);
      if (!chat) return null;
      const role = input.role;
      if (!['user', 'assistant'].includes(role)) throw httpError('Message role must be user or assistant.', 400);
      const text = cleanMessageText(input.text, 8000);
      if (!text) throw httpError('Message text is required.', 400);
      const message = await repository.appendMessage(userId, id, { role, text });
      const title = role === 'user' && chat.title === 'New automation'
        ? text.replace(/\s+/g, ' ').slice(0, 72).trim() || 'New automation'
        : chat.title;
      await repository.update(userId, id, { title });
      return message;
    },
    async delete(userId, id) {
      assertChatId(id);
      return repository.delete(userId, id);
    },
  };
}

function sanitizeDraft(value, at) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.id) {
    throw httpError('A valid unsaved automation draft is required.', 400);
  }
  const validated = validateAutomationInput({ ...value, status: 'active' }, at);
  return { ...validated, id: null, status: 'draft', nextRunAt: null };
}

function assertChatId(value) {
  if (!CHAT_ID_PATTERN.test(String(value || ''))) throw httpError('Automation chat not found.', 404);
}

function clean(value, maxLength) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanMessageText(value, maxLength) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

module.exports = { createAutomationChats, sanitizeDraft };
