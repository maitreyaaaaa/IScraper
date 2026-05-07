import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Brain,
  CheckCircle2,
  Database,
  KeyRound,
  FileSearch,
  FolderUp,
  Loader2,
  Play,
  Search,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import {
  getItem,
  getItems,
  getCredits,
  getProviderCredentials,
  importInstagramExport,
  processImport,
  deleteProviderCredential,
  saveProviderCredential,
  setApiAccessToken,
  searchItems,
  testProviderCredential,
} from './api';
import { supabase } from './supabaseClient';
import './App.css';

function App() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState([]);
  const [mode, setMode] = useState('export');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [activeImport, setActiveImport] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [credentials, setCredentials] = useState([]);
  const [credentialOptions, setCredentialOptions] = useState(null);
  const [credits, setCredits] = useState(null);
  const [credentialForm, setCredentialForm] = useState({
    purpose: 'text',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-pro',
    apiKey: '',
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const authEnabled = Boolean(supabase);

  const loadItems = useCallback(async () => {
    const body = await getItems();
    setItems(body.items || []);
  }, []);

  const loadAccountControls = useCallback(async () => {
    const [credentialBody, creditBody] = await Promise.all([getProviderCredentials(), getCredits()]);
    setCredentials(credentialBody.credentials || []);
    setCredentialOptions(credentialBody.options || null);
    setCredits(creditBody.credits || null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const initializeLocal = async () => {
      try {
        await Promise.all([loadItems(), loadAccountControls()]);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (!authEnabled) {
      initializeLocal();
      return () => {
        cancelled = true;
      };
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setApiAccessToken(data.session?.access_token);
      if (data.session) {
        Promise.all([loadItems(), loadAccountControls()])
          .catch((err) => setError(err.message))
          .finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setApiAccessToken(nextSession?.access_token);
      if (nextSession) loadItems().catch((err) => setError(err.message));
      if (nextSession) loadAccountControls().catch((err) => setError(err.message));
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [authEnabled, loadAccountControls, loadItems]);

  const handleSignIn = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: signInError } = await supabase.auth.signInWithOtp({ email });
      if (signInError) throw signInError;
      setError('Check your email for the sign-in link.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const stats = useMemo(() => {
    const done = items.filter((item) => item.status === 'done').length;
    const failed = items.filter((item) => item.status === 'failed').length;
    const queued = items.filter((item) => item.status === 'queued').length;
    const paused = items.filter((item) => String(item.status || '').startsWith('paused')).length;
    return { total: items.length, done, failed, queued, paused };
  }, [items]);

  const providerChoices = useMemo(() => {
    if (!credentialOptions) return [];
    if (credentialForm.purpose === 'media') return Object.entries(credentialOptions.mediaProviders || {});
    return Object.entries(credentialOptions.textProviders || {});
  }, [credentialForm.purpose, credentialOptions]);

  const applyPurpose = (purpose) => {
    const provider = purpose === 'media' ? 'openrouter' : 'openrouter';
    const model =
      purpose === 'media'
        ? credentialOptions?.defaultAppMediaModel || 'google/gemini-3.1-flash-lite-preview'
        : credentialOptions?.defaultAppTextModel || 'deepseek/deepseek-v4-pro';
    setCredentialForm({ purpose, provider, model, apiKey: '' });
  };

  const applyProvider = (provider) => {
    const group = credentialForm.purpose === 'media' ? credentialOptions?.mediaProviders : credentialOptions?.textProviders;
    setCredentialForm((current) => ({
      ...current,
      provider,
      model: group?.[provider]?.defaultModel || current.model,
    }));
  };

  const handleImport = async () => {
    if (!files.length) {
      setError('Upload saved_posts.html and optionally saved_collections.html.');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await importInstagramExport({ files, mode, confirmEmail });
      setActiveImport(result.import);
      await loadItems();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleProcess = async () => {
    if (!activeImport) {
      setError('Import files first, then start processing.');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    try {
      await processImport(activeImport.id);
      window.setTimeout(() => loadItems().catch((err) => setError(err.message)), 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCredential = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    let saved = null;
    try {
      saved = await saveProviderCredential(credentialForm);
      await testProviderCredential(saved.credential.id);
      setCredentialForm((current) => ({ ...current, apiKey: '' }));
      await loadAccountControls();
      setNotice(`Connected. Your ${saved.credential.provider} key works end-to-end.`);
    } catch (err) {
      setError(saved ? `Key saved, but connection failed: ${err.message}` : err.message);
      await loadAccountControls().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCredential = async (id) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await deleteProviderCredential(id);
      await loadAccountControls();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleTestCredential = async (id) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await testProviderCredential(id);
      setNotice(`Connected. Your ${result.provider} key works end-to-end.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSearch = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!query.trim()) {
        await loadItems();
      } else {
        const body = await searchItems(query);
        setItems(body.results || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (id) => {
    setError('');
    try {
      const body = await getItem(id);
      setSelectedItem(body.item);
    } catch (err) {
      setError(err.message);
    }
  };

  if (authEnabled && !session) {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={handleSignIn}>
          <Brain size={32} />
          <h1>Instagram Brain</h1>
          <p>Sign in to keep your saved reels private and searchable.</p>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
          />
          <button className="primary-button" disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : null}
            Send sign-in link
          </button>
          {error && <div className="error-banner">{error}</div>}
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Brain size={28} />
          <div>
            <strong>Instagram Brain</strong>
            <span>Saved reels index</span>
          </div>
        </div>
        {authEnabled && (
          <button className="secondary-button" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        )}

        <div className="stat-grid">
          <Stat label="Total" value={stats.total} />
          <Stat label="Indexed" value={stats.done} />
          <Stat label="Queued" value={stats.queued} />
          <Stat label="Paused" value={stats.paused || stats.failed} />
        </div>

        <section className="panel">
          <h2>Import</h2>
          <div className="segmented">
            <button className={mode === 'export' ? 'active' : ''} onClick={() => setMode('export')}>
              Export
            </button>
            <button className={mode === 'login-scrape' ? 'active danger' : 'danger'} onClick={() => setMode('login-scrape')}>
              Login scrape
            </button>
          </div>

          {mode === 'login-scrape' && (
            <div className="risk-box">
              <ShieldAlert size={18} />
              <p>Instagram may challenge, restrict, or ban accounts that use scraping. Type your account email to continue.</p>
              <input
                value={confirmEmail}
                onChange={(event) => setConfirmEmail(event.target.value)}
                placeholder="your@email.com"
              />
            </div>
          )}

          <label className="file-drop">
            <FolderUp size={22} />
            <span>{files.length ? `${files.length} file selected` : 'Choose saved_posts / collections HTML'}</span>
            <input
              type="file"
              accept=".html"
              multiple
              onChange={(event) => setFiles([...event.target.files])}
            />
          </label>

          <button className="primary-button" disabled={busy} onClick={handleImport}>
            {busy ? <Loader2 className="spin" size={16} /> : <Database size={16} />}
            Import files
          </button>

          <button className="secondary-button" disabled={busy || !activeImport} onClick={handleProcess}>
            {busy ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
            Process queue
          </button>
        </section>

        <section className="panel provider-panel">
          <h2>Providers & Credits</h2>
          <div className="credit-strip">
            <span>Free items</span>
            <strong>{credits ? `${credits.freeItemsRemaining}/${credits.freeItemsLimit}` : '200/200'}</strong>
          </div>
          <div className="credit-strip">
            <span>Paid credits</span>
            <strong>{credits?.paidCredits ?? 0}</strong>
          </div>

          <form className="credential-form" onSubmit={handleSaveCredential}>
            <div className="segmented">
              <button type="button" className={credentialForm.purpose === 'text' ? 'active' : ''} onClick={() => applyPurpose('text')}>
                Text
              </button>
              <button type="button" className={credentialForm.purpose === 'media' ? 'active' : ''} onClick={() => applyPurpose('media')}>
                Media
              </button>
            </div>
            <select value={credentialForm.provider} onChange={(event) => applyProvider(event.target.value)}>
              {providerChoices.map(([id, provider]) => (
                <option value={id} key={id}>
                  {provider.label}
                </option>
              ))}
            </select>
            <input
              value={credentialForm.model}
              onChange={(event) => setCredentialForm((current) => ({ ...current, model: event.target.value }))}
              placeholder="Model"
              list={credentialForm.purpose === 'media' ? 'media-models' : undefined}
            />
            <datalist id="media-models">
              {(credentialOptions?.mediaModelAllowlist || []).map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            <input
              type="password"
              value={credentialForm.apiKey}
              onChange={(event) => setCredentialForm((current) => ({ ...current, apiKey: event.target.value }))}
              placeholder="API key"
              required
            />
            <button className="primary-button" disabled={busy}>
              {busy ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
              Save key
            </button>
          </form>

          <div className="credential-list">
            {credentials.map((credential) => (
              <div className="credential-row" key={credential.id}>
                <div>
                  <strong>{credential.provider}</strong>
                  <span>{credential.purpose} · {credential.model} · {credential.keyHint}</span>
                </div>
                <button type="button" onClick={() => handleTestCredential(credential.id)} aria-label="Test key">
                  <CheckCircle2 size={15} />
                </button>
                <button type="button" onClick={() => handleDeleteCredential(credential.id)} aria-label="Delete key">
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        </section>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <form className="search-form" onSubmit={handleSearch}>
            <Search size={19} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Claude, GitHub repo, agent memory..."
            />
            <button type="submit" disabled={busy}>
              {busy ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
              Search
            </button>
          </form>
        </header>

        {error && (
          <div className="error-banner">
            <AlertTriangle size={18} />
            {error}
          </div>
        )}
        {notice && (
          <div className="notice-banner">
            <CheckCircle2 size={18} />
            {notice}
          </div>
        )}

        {loading ? (
          <div className="empty-state">Loading your saved index...</div>
        ) : items.length ? (
          <div className="item-grid">
            {items.map((item) => (
              <ItemCard key={`${item.userId || 'local'}:${item.id}`} item={item} onOpen={() => openDetail(item.id)} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <FileSearch size={34} />
            No saved items indexed yet.
          </div>
        )}
      </main>

      {selectedItem && <DetailPanel item={selectedItem} onClose={() => setSelectedItem(null)} />}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ItemCard({ item, onOpen }) {
  const analysis = item.analysis || {};
  const tags = [...(analysis.brandsMentioned || []), ...(analysis.topics || []), ...(item.hashtags || [])].slice(0, 4);

  return (
    <article className="item-card" onClick={onOpen}>
      <div className="card-topline">
        <span className={`status ${item.status || 'queued'}`}>{item.status || 'queued'}</span>
        <span>{item.contentType}</span>
      </div>
      <h3>{analysis.title || firstLine(item.caption) || 'Untitled saved item'}</h3>
      <p>{analysis.summary || item.caption || 'No caption available.'}</p>
      <div className="tag-row">
        {tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
    </article>
  );
}

function DetailPanel({ item, onClose }) {
  const analysis = item.analysis || {};

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="detail-drawer" onClick={(event) => event.stopPropagation()}>
        <button className="icon-button" onClick={onClose} aria-label="Close detail">
          <X size={18} />
        </button>
        <span className={`status ${item.status || 'queued'}`}>{item.status || 'queued'}</span>
        <h2>{analysis.title || firstLine(item.caption) || 'Saved item'}</h2>
        <a className="external-link" href={item.url} target="_blank" rel="noreferrer">
          Open Instagram <ArrowUpRight size={15} />
        </a>

        <DetailBlock title="Summary" value={analysis.summary} />
        <DetailBlock title="Caption" value={item.caption} />
        <DetailBlock title="Transcript" value={analysis.transcript} />
        <DetailBlock title="Text from post" value={analysis.ocrText} />
        <DetailBlock title="Visual notes" value={analysis.visualDescription} />
        <DetailList title="Brands / tools" values={[...(analysis.brandsMentioned || []), ...(analysis.toolsMentioned || [])]} />
        <DetailList title="Repos / people" values={[...(analysis.reposMentioned || []), ...(analysis.peopleMentioned || [])]} />
        <DetailList title="Topics / tags" values={[...(analysis.topics || []), ...(analysis.tags || [])]} />
        <DetailBlock title="Why useful" value={analysis.whyUseful} />
      </aside>
    </div>
  );
}

function DetailBlock({ title, value }) {
  if (!value) return null;
  return (
    <section className="detail-block">
      <h3>{title}</h3>
      <p>{value}</p>
    </section>
  );
}

function DetailList({ title, values }) {
  const unique = [...new Set(values.filter(Boolean))];
  if (!unique.length) return null;
  return (
    <section className="detail-block">
      <h3>{title}</h3>
      <div className="tag-row expanded">
        {unique.map((value) => (
          <span key={value}>{value}</span>
        ))}
      </div>
    </section>
  );
}

function firstLine(value = '') {
  return value.split('\n').find(Boolean)?.slice(0, 90);
}

export default App;
