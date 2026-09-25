const { randomUUID } = require('node:crypto');

function createAutomationChatRepository({ store, now = () => new Date() }) {
  if (typeof store?.client?.from === 'function') {
    const client = store.client;
    return {
      async list(userId, limit = 10) {
        const { data, error } = await client.from('automation_chats')
          .select('id,user_id,title,model,automation_id,created_at,updated_at')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false })
          .limit(limit);
        if (error) throw error;
        return (data || []).map(mapChatSummary);
      },
      async get(userId, id) {
        const { data, error } = await client.from('automation_chats').select('*')
          .eq('user_id', userId).eq('id', id).maybeSingle();
        if (error) throw error;
        if (!data) return null;
        const messages = await client.from('automation_chat_messages').select('*')
          .eq('user_id', userId).eq('chat_id', id)
          .order('created_at', { ascending: true }).order('id', { ascending: true });
        if (messages.error) throw messages.error;
        return mapChat(data, (messages.data || []).map(mapMessage));
      },
      async create(userId, value) {
        const timestamp = now().toISOString();
        const { data, error } = await client.from('automation_chats').insert({
          id: value.id || randomUUID(), user_id: userId, title: value.title,
          model: value.model, draft: value.draft || null, automation_id: value.automationId || null,
          created_at: timestamp, updated_at: timestamp,
        }).select('*').single();
        if (error) throw error;
        return mapChat(data, []);
      },
      async update(userId, id, patch) {
        const row = { updated_at: now().toISOString() };
        if (Object.hasOwn(patch, 'title')) row.title = patch.title;
        if (Object.hasOwn(patch, 'model')) row.model = patch.model;
        if (Object.hasOwn(patch, 'draft')) row.draft = patch.draft;
        if (Object.hasOwn(patch, 'automationId')) row.automation_id = patch.automationId;
        const { data, error } = await client.from('automation_chats').update(row)
          .eq('user_id', userId).eq('id', id).select('*').maybeSingle();
        if (error) throw error;
        return data ? mapChat(data, []) : null;
      },
      async appendMessage(userId, chatId, message) {
        const { data, error } = await client.from('automation_chat_messages').insert({
          id: message.id || randomUUID(), user_id: userId, chat_id: chatId,
          role: message.role, content: message.text, created_at: now().toISOString(),
        }).select('*').single();
        if (error) throw error;
        return mapMessage(data);
      },
      async delete(userId, id) {
        const { data, error } = await client.from('automation_chats').delete()
          .eq('user_id', userId).eq('id', id).select('id').maybeSingle();
        if (error) throw error;
        return Boolean(data);
      },
    };
  }

  return {
    async list(userId, limit) {
      return (await store.listAutomationChats(userId, limit)).map(mapChatSummary);
    },
    async get(userId, id) {
      const chat = await store.getAutomationChat(userId, id);
      return chat ? mapChat(chat, (chat.messages || []).map(mapMessage)) : null;
    },
    async create(userId, value) {
      const chat = await store.createAutomationChat(userId, value);
      return chat ? mapChat(chat, []) : null;
    },
    async update(userId, id, patch) {
      const chat = await store.updateAutomationChat(userId, id, patch);
      return chat ? mapChat(chat, []) : null;
    },
    async appendMessage(userId, chatId, message) {
      const saved = await store.appendAutomationChatMessage(userId, chatId, message);
      return saved ? mapMessage(saved) : null;
    },
    delete: (userId, id) => store.deleteAutomationChat(userId, id),
  };
}

function mapChatSummary(row) {
  return {
    id: row.id, title: row.title, model: row.model,
    automationId: row.automation_id || row.automationId || null,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
  };
}

function mapChat(row, messages = []) {
  return {
    ...mapChatSummary(row),
    draft: row.draft || null,
    messages,
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    role: row.role,
    text: row.content ?? row.text ?? '',
    createdAt: row.created_at || row.createdAt,
  };
}

module.exports = { createAutomationChatRepository, mapChat, mapChatSummary, mapMessage };
