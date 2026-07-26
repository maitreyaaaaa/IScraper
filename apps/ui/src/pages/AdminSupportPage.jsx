import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Bot,
  Database,
  deletionStatusCopy,
  deletionStatusLabel,
  ExternalLink,
  formatUsageDate,
  getAdminSummary,
  getAdminUserDetailWithKey,
  getAdminUsers,
  getAdminUserTimelineWithKey,
  Loader2,
  Search,
  securityActivityLabel,
  ShieldCheck,
  Upload,
  useEffect,
  useState,
  Zap,
} from '../AppShared.jsx';
import { Banner } from '../components/Common.jsx';
function AdminSupportPage({ onBack }) {
  const [adminKey, setAdminKey] = useState(() => {
    try {
      return window.sessionStorage.getItem('iscraper-admin-key') || '';
    } catch {
      return '';
    }
  });
  const [query, setQuery] = useState('');
  const [summary, setSummary] = useState(null);
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [detail, setDetail] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const selectedUser = detail || users.find((user) => user.id === selectedUserId) || null;

  const saveAdminKey = (value) => {
    setAdminKey(value);
    try {
      if (value) window.sessionStorage.setItem('iscraper-admin-key', value);
      else window.sessionStorage.removeItem('iscraper-admin-key');
    } catch {
      // Session storage is optional; the API key still works for the current render.
    }
  };

  const loadUsers = async (event) => {
    event?.preventDefault();
    setLoading(true);
    setError('');
    try {
      const [summaryBody, usersBody] = await Promise.all([
        getAdminSummary(adminKey),
        getAdminUsers(adminKey, { query, limit: 25 }),
      ]);
      setSummary(summaryBody.summary || null);
      setUsers(usersBody.users || []);
      if (!selectedUserId && usersBody.users?.[0]) setSelectedUserId(usersBody.users[0].id);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!adminKey || !selectedUserId) return;
    let cancelled = false;
    Promise.all([
      getAdminUserDetailWithKey(adminKey, selectedUserId),
      getAdminUserTimelineWithKey(adminKey, selectedUserId, { limit: 50 }),
    ])
      .then(([detailBody, timelineBody]) => {
        if (cancelled) return;
        setDetail(detailBody.user || null);
        setTimeline(timelineBody.timeline || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adminKey, selectedUserId]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-white/10 bg-black/80 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">Admin user support</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Support-safe account detail: status, counts, credits, imports, failed jobs, deletion state, tokens count, and recent events. Private saved content is not shown here.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-semibold text-primary">
            <ShieldCheck className="h-4 w-4" /> Admin-only API
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[22rem_1fr]">
        <aside className="space-y-4">
          <form onSubmit={loadUsers} className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Admin API key</label>
            <input
              type="text"
              name="admin-key-context"
              autoComplete="username"
              value="IScraper admin API"
              readOnly
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
            />
            <input
              type="password"
              name="admin-api-key"
              autoComplete="new-password"
              value={adminKey}
              onChange={(event) => saveAdminKey(event.target.value)}
              placeholder="Paste admin key"
              className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm outline-none focus:border-primary"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search email or username"
              className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm outline-none focus:border-primary"
            />
            <button disabled={!adminKey || loading} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Load users
            </button>
          </form>

          {summary && (
            <div className="grid grid-cols-2 gap-2">
              {[
                ['Users', summary.users?.total],
                ['Imports', summary.imports?.total],
                ['Jobs failed', summary.jobs?.failed],
                ['Revenue', summary.credits?.revenueCents ? `$${(summary.credits.revenueCents / 100).toFixed(2)}` : '$0.00'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="mt-1 font-display text-xl font-bold">{value ?? 0}</div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {users.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => setSelectedUserId(user.id)}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  selectedUserId === user.id ? 'border-primary bg-primary/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                }`}
              >
                <div className="truncate text-sm font-semibold">{user.email}</div>
                <div className="mt-1 text-xs text-muted-foreground">{user.profile?.username || 'No username'} - {user.itemStats?.total || 0} saves</div>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-w-0 space-y-5">
          {error && <Banner type="error">{error}</Banner>}
          {!selectedUser ? (
            <div className="grid min-h-96 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-sm text-muted-foreground">
              Enter the admin key and load users.
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Support-safe detail</div>
                    <h2 className="mt-2 truncate font-display text-3xl font-bold tracking-tight">{selectedUser.email}</h2>
                    <p className="mt-2 text-sm text-muted-foreground">User ID: <span className="font-mono">{selectedUser.id}</span></p>
                  </div>
                  <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                    {selectedUser.adminState?.status || 'active'}
                  </span>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ['Saves', selectedUser.itemStats?.total || 0, Database],
                    ['Imports', selectedUser.counts?.imports || 0, Upload],
                    ['Failed jobs', selectedUser.jobStats?.failed || 0, AlertCircle],
                    ['Credits', selectedUser.credits?.totalAvailableCredits || 0, Zap],
                    ['Active tokens', selectedUser.counts?.extensionTokens || 0, Bot],
                    ['Connections', selectedUser.counts?.captureConnections || 0, ExternalLink],
                    ['Last activity', selectedUser.lastActivity?.createdAt ? formatUsageDate(selectedUser.lastActivity.createdAt) : 'None', Activity],
                  ].map(([label, value, Icon]) => (
                    <div key={label} className="rounded-xl border border-white/10 bg-black/50 p-4">
                      <Icon className="h-4 w-4 text-primary" />
                      <div className="mt-3 text-xs text-muted-foreground">{label}</div>
                      <div className="mt-1 text-lg font-bold">{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <h3 className="font-display text-2xl font-bold tracking-tight">Deletion state</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {selectedUser.deletion?.request ? deletionStatusCopy(selectedUser.deletion.request.status) : 'No active deletion request.'}
                  </p>
                  {selectedUser.deletion?.request && (
                    <div className="mt-4 rounded-xl border border-white/10 bg-black/50 p-4 text-sm">
                      <div className="font-semibold">{deletionStatusLabel(selectedUser.deletion.request.status)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">Requested {formatUsageDate(selectedUser.deletion.request.requestedAt)}</div>
                    </div>
                  )}
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <h3 className="font-display text-2xl font-bold tracking-tight">Support boundary</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    This page intentionally shows metadata, counts, failed states, and safe events only. Opening private saved content requires a separate support or security reason and should be logged.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-2xl font-bold tracking-tight">Recent support timeline</h3>
                  <span className="text-xs text-muted-foreground">{timeline.length} events</span>
                </div>
                <div className="mt-4 space-y-2">
                  {timeline.length ? timeline.map((event) => (
                    <div key={event.id} className="rounded-xl border border-white/10 bg-black/50 p-3 text-sm">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <div className="font-semibold capitalize">{securityActivityLabel(event.eventType)}</div>
                        <span className="text-xs text-muted-foreground">{formatUsageDate(event.createdAt)}</span>
                      </div>
                      {Object.keys(event.metadata || {}).length > 0 && (
                        <pre className="mt-2 max-h-28 overflow-auto rounded-lg bg-black p-2 text-xs leading-5 text-muted-foreground">{JSON.stringify(event.metadata, null, 2)}</pre>
                      )}
                    </div>
                  )) : (
                    <div className="rounded-xl border border-white/10 bg-black/50 p-4 text-sm text-muted-foreground">No support events yet.</div>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
export default AdminSupportPage;
