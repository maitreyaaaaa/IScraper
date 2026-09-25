const { randomUUID } = require('node:crypto');

function createAutomationRepository({ store, now = () => new Date() }) {
  if (typeof store?.client?.from === 'function') {
    const client = store.client;
    return {
      async list(userId) {
        const { data, error } = await client.from('automations').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(100);
        if (error) throw error;
        return (data || []).map(mapAutomation);
      },
      async get(userId, id) {
        const { data, error } = await client.from('automations').select('*').eq('user_id', userId).eq('id', id).maybeSingle();
        if (error) throw error;
        return data ? mapAutomation(data) : null;
      },
      async save(userId, automation) {
        const timestamp = now().toISOString();
        const row = toAutomationRow(automation, userId, timestamp);
        const { data, error } = await client.from('automations').upsert(row, { onConflict: 'id,user_id' }).select('*').single();
        if (error) throw error;
        return mapAutomation(data);
      },
      async createRun(userId, automationId, triggerType) {
        const { data, error } = await client.from('automation_runs').insert({
          id: randomUUID(), user_id: userId, automation_id: automationId, trigger_type: triggerType,
          status: 'running', activity: [{ state: 'received', at: now().toISOString() }], started_at: now().toISOString(),
        }).select('*').single();
        if (error) throw error;
        return mapRun(data);
      },
      async updateRun(userId, runId, patch) {
        const { data, error } = await client.from('automation_runs').update(toRunRow(patch, now().toISOString())).eq('user_id', userId).eq('id', runId).select('*').maybeSingle();
        if (error) throw error;
        return data ? mapRun(data) : null;
      },
      async listRuns(userId, automationId, limit = 25) {
        const { data, error } = await client.from('automation_runs').select('*').eq('user_id', userId).eq('automation_id', automationId).order('started_at', { ascending: false }).limit(limit);
        if (error) throw error;
        return (data || []).map(mapRun);
      },
      async listAllRuns(userId, options = {}) {
        const { page = 1, limit = 25, status = '', automationId = '', from = '', to = '' } = options;
        let query = client.from('automation_runs').select('*', { count: 'exact' }).eq('user_id', userId);
        if (status) query = query.eq('status', status);
        if (automationId) query = query.eq('automation_id', automationId);
        if (from) query = query.gte('started_at', from);
        if (to) query = query.lte('started_at', to);
        const start = (page - 1) * limit;
        const { data, error, count } = await query.order('started_at', { ascending: false })
          .range(start, start + limit - 1);
        if (error) throw error;
        const runs = (data || []).map(mapRun);
        const automationIds = [...new Set(runs.map((run) => run.automationId).filter(Boolean))];
        let names = new Map();
        if (automationIds.length) {
          const automationResult = await client.from('automations').select('id,name')
            .eq('user_id', userId).in('id', automationIds);
          if (automationResult.error) throw automationResult.error;
          names = new Map((automationResult.data || []).map((automation) => [automation.id, automation.name]));
        }
        return {
          runs: runs.map((run) => ({ ...run, automationName: names.get(run.automationId) || 'Deleted automation' })),
          page,
          limit,
          total: Number(count) || 0,
          hasMore: start + runs.length < (Number(count) || 0),
        };
      },
      async delete(userId, id) {
        const { data, error } = await client.from('automations').delete().eq('user_id', userId).eq('id', id).select('id').maybeSingle();
        if (error) throw error;
        return Boolean(data);
      },
      async claimDue(limit = 5) {
        const { data, error } = await client.rpc('claim_due_automations', { p_limit: limit });
        if (error) throw error;
        return (data || []).map(mapAutomation);
      },
      async completeSchedule(userId, id, leaseToken) {
        const automation = await this.get(userId, id);
        if (!automation || !leaseToken) return false;
        const nextRunAt = new Date(now().getTime() + (Number(automation.triggerConfig.everyMinutes) || 1440) * 60_000).toISOString();
        const { data, error } = await client.from('automations').update({
          next_run_at: nextRunAt,
          schedule_lease_until: null,
          schedule_lease_token: null,
          updated_at: now().toISOString(),
        }).eq('id', id).eq('user_id', userId).eq('schedule_lease_token', leaseToken).select('id').maybeSingle();
        if (error) throw error;
        return Boolean(data);
      },
    };
  }

  return {
    list: (userId) => store.listAutomations(userId),
    get: (userId, id) => store.getAutomation(userId, id),
    save: (userId, automation) => store.saveAutomation(userId, automation),
    createRun: (userId, automationId, triggerType) => store.createAutomationRun(userId, automationId, triggerType),
    updateRun: (userId, runId, patch) => store.updateAutomationRun(userId, runId, patch),
    listRuns: (userId, automationId, limit) => store.listAutomationRuns(userId, automationId, limit),
    listAllRuns: (userId, options) => store.listAllAutomationRuns(userId, options),
    delete: (userId, id) => store.deleteAutomation(userId, id),
    claimDue: (limit) => store.claimDueAutomations(limit),
    completeSchedule: (userId, id, leaseToken) => store.completeAutomationSchedule(userId, id, leaseToken),
  };
}

function toAutomationRow(value, userId, timestamp) {
  return {
    id: value.id,
    user_id: userId,
    name: value.name,
    prompt: value.prompt,
    trigger_type: value.triggerType,
    trigger_config: value.triggerConfig || {},
    gmail_query: value.gmailQuery || '',
    max_messages: value.maxMessages,
    model: value.model,
    status: value.status,
    next_run_at: value.nextRunAt || null,
    schedule_lease_until: value.scheduleLeaseUntil || null,
    schedule_lease_token: value.scheduleLeaseToken || null,
    created_at: value.createdAt || timestamp,
    updated_at: timestamp,
  };
}

function toRunRow(patch, timestamp) {
  const row = { updated_at: timestamp };
  if (patch.status) row.status = patch.status;
  if (Object.prototype.hasOwnProperty.call(patch, 'summary')) row.summary = patch.summary;
  if (Object.prototype.hasOwnProperty.call(patch, 'error')) row.error = patch.error;
  if (Object.prototype.hasOwnProperty.call(patch, 'activity')) row.activity = patch.activity;
  if (Object.prototype.hasOwnProperty.call(patch, 'finishedAt')) row.finished_at = patch.finishedAt;
  return row;
}

function mapAutomation(row) {
  return {
    id: row.id, userId: row.user_id, name: row.name, prompt: row.prompt,
    triggerType: row.trigger_type, triggerConfig: row.trigger_config || {},
    gmailQuery: row.gmail_query || '', maxMessages: row.max_messages,
    model: row.model, status: row.status, nextRunAt: row.next_run_at || null,
    scheduleLeaseUntil: row.schedule_lease_until || null, scheduleLeaseToken: row.schedule_lease_token || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapRun(row) {
  return {
    id: row.id, automationId: row.automation_id, triggerType: row.trigger_type,
    status: row.status, summary: row.summary || '', error: row.error || '',
    activity: Array.isArray(row.activity) ? row.activity : [],
    automationName: row.automation_name || row.automationName || '',
    startedAt: row.started_at, finishedAt: row.finished_at || null,
  };
}

module.exports = { createAutomationRepository, mapAutomation, mapRun };
