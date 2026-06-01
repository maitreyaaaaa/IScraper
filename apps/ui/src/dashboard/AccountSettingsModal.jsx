import {
  AI_PROCESSING_NOTICE,
  AlertCircle,
  avatarUrlForSession,
  Brain,
  buildDataUsage,
  cancelAccountDeletion,
  CheckCircle2,
  Copy,
  createDataExport,
  deletionStatusCopy,
  deletionStatusLabel,
  Download,
  downloadBlob,
  downloadDataExport,
  exportStatusLabel,
  Eye,
  EyeOff,
  FileText,
  formatUsageDate,
  formatUsageNumber,
  getAccountDeletion,
  getAccountSecurityActivity,
  getAccountSummary,
  getCredits,
  getDataExports,
  getItems,
  getOnboarding,
  getPrivacyExportData,
  getProviderCredentials,
  getUserDataMap,
  groupProviderCredentials,
  identifyPostHogUser,
  initialForSession,
  KeyRound,
  Loader2,
  LoadingSpinner,
  Lock,
  mapItem,
  onboardingFormFromRecord,
  onboardingIsDone,
  ProgressBar,
  PROVIDER_DISPLAY_LABELS,
  PROVIDER_KEY_PRIVACY_NOTICE,
  requestAccountDeletion,
  revealProviderCredential,
  saveOnboarding,
  saveProfile,
  Search,
  securityActivityLabel,
  Settings,
  ShieldCheck,
  SkeletonBlock,
  SkeletonRows,
  Sparkles,
  supabase,
  testProviderCredential,
  useEffect,
  useMemo,
  User,
  useState,
  X,
  Zap,
} from '../AppShared.jsx';
import { Banner, OnboardingPreferencesFields } from '../components/Common.jsx';
function AccountSettingsModal({
  open,
  onClose,
  session,
  profile,
  onboarding: initialOnboarding = null,
  onProfileSaved,
  onOnboardingSaved,
  mode = 'modal',
  extraTabs = [],
  renderExtraTab = null,
  onExtraTabChange = null,
}) {
  const isModal = mode !== 'page';
  const [activeTab, setActiveTab] = useState('account');
  const [profileForm, setProfileForm] = useState({
    username: profile?.username || '',
    avatarUrl: profile?.avatarUrl || avatarUrlForSession(session, profile) || '',
  });
  const [onboarding, setOnboarding] = useState(initialOnboarding);
  const [onboardingForm, setOnboardingForm] = useState(onboardingFormFromRecord(initialOnboarding));
  const [credentials, setCredentials] = useState([]);
  const [usageItems, setUsageItems] = useState([]);
  const [credits, setCredits] = useState(null);
  const [accountSummary, setAccountSummary] = useState(null);
  const [dataMap, setDataMap] = useState(null);
  const [dataExports, setDataExports] = useState([]);
  const [securityActivity, setSecurityActivity] = useState([]);
  const [includeExportFiles, setIncludeExportFiles] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [healthByGroup, setHealthByGroup] = useState({});
  const [revealedByGroup, setRevealedByGroup] = useState({});
  const [confirmRevealGroup, setConfirmRevealGroup] = useState(null);
  const [deletionState, setDeletionState] = useState(null);
  const [deletionLoading, setDeletionLoading] = useState(false);
  const [deletionForm, setDeletionForm] = useState({ reason: '', exportConfirmed: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const avatarUrl = avatarUrlForSession(session, profile);
  const initial = initialForSession(session, profile);
  const groupedCredentials = Object.values(groupProviderCredentials(credentials));
  const email = session?.user?.email || 'Not available';
  const dataUsage = useMemo(() => buildDataUsage(usageItems, credits), [credits, usageItems]);
  const extraTabKeys = useMemo(() => extraTabs.map(([key]) => key).join('|'), [extraTabs]);

  useEffect(() => {
    if (!open || !isModal) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [isModal, onClose, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getOnboarding()
      .then((body) => {
        if (cancelled) return;
        setOnboarding(body.onboarding || null);
        setOnboardingForm(onboardingFormFromRecord(body.onboarding));
      })
      .catch((err) => {
        if (!cancelled && err.status !== 423) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !extraTabKeys.split('|').includes(activeTab)) return;
    onExtraTabChange?.(activeTab);
  }, [activeTab, extraTabKeys, onExtraTabChange, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getProviderCredentials()
      .then((body) => {
        if (!cancelled) setCredentials(body.credentials || []);
      })
      .catch((err) => {
        if (!cancelled && err.status !== 423) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const hasActiveExport = dataExports.some((request) => ['requested', 'building'].includes(request.status));
    if (!hasActiveExport) return undefined;
    let cancelled = false;
    const interval = window.setInterval(() => {
      getDataExports()
        .then((body) => {
          if (!cancelled) setDataExports(body.exports || []);
        })
        .catch((err) => {
          if (!cancelled) setError(err.message);
        });
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [dataExports, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) setDeletionLoading(true);
        return getAccountDeletion();
      })
      .then((body) => {
        if (!cancelled) setDeletionState(body.deletion || null);
      })
      .catch((err) => {
        if (!cancelled && err.status !== 423) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setDeletionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) setUsageLoading(true);
        return Promise.all([
          getItems().catch((err) => (err.status === 423 ? { items: [] } : Promise.reject(err))),
          getCredits(),
          getAccountSummary(),
          getUserDataMap(),
          getDataExports(),
          getAccountSecurityActivity({ limit: 8 }),
        ]);
      })
      .then(([itemsBody, creditsBody, accountBody, dataMapBody, exportsBody, securityBody]) => {
        if (cancelled) return;
        setUsageItems((itemsBody.items || []).map(mapItem));
        setCredits(creditsBody.credits || null);
        setAccountSummary(accountBody.account || null);
        setDataMap(dataMapBody.dataMap || null);
        setDataExports(exportsBody.exports || []);
        setSecurityActivity(securityBody.activity || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setUsageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open || !session) return null;

  const handleAvatarFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Profile picture must be PNG, JPEG, or WebP.');
      return;
    }
    if (file.size > 250 * 1024) {
      setError('Profile picture must be smaller than 250 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setProfileForm((current) => ({ ...current, avatarUrl: String(reader.result || '') }));
    };
    reader.readAsDataURL(file);
  };

  const handleProfileSave = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const body = await saveProfile(profileForm);
      onProfileSaved?.(body.profile);
      identifyPostHogUser(session, body.profile);
      setMessage('Profile saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleOnboardingSettingsSave = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const body = await saveOnboarding(onboardingForm);
      setOnboarding(body.onboarding || null);
      setOnboardingForm(onboardingFormFromRecord(body.onboarding));
      onOnboardingSaved?.(body.onboarding || null);
      setMessage('Personalization saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleHealthCheck = async (group) => {
    setHealthByGroup((current) => ({ ...current, [group.id]: 'checking' }));
    setError('');
    setMessage('');
    try {
      for (const credential of group.credentials) {
        await testProviderCredential(credential.id);
      }
      setHealthByGroup((current) => ({ ...current, [group.id]: 'working' }));
      setMessage(`${PROVIDER_DISPLAY_LABELS[group.provider] || group.provider} key is working.`);
    } catch (err) {
      setHealthByGroup((current) => ({ ...current, [group.id]: 'failed' }));
      setError(err.message || 'This key needs attention.');
    }
  };

  const handleReveal = async (group) => {
    if (confirmRevealGroup !== group.id) {
      setConfirmRevealGroup(group.id);
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const body = await revealProviderCredential(group.credentials[0].id);
      setRevealedByGroup((current) => ({ ...current, [group.id]: body.apiKey || '' }));
      setConfirmRevealGroup(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('Copied.');
    } catch {
      setError('Could not copy automatically. Select the key and copy it manually.');
    }
  };

  const handlePrivacyExport = async () => {
    setExportLoading(true);
    setError('');
    setMessage('');
    try {
      const body = await createDataExport({ includeFiles: includeExportFiles });
      const request = body.export || null;
      const exportsBody = await getDataExports();
      setDataExports(exportsBody.exports || (request ? [request] : []));
      if (request?.status === 'ready') {
        await handleDataExportDownload(request.id);
        setMessage('Your data export ZIP is ready and downloaded.');
      } else {
        setMessage('Your data export request was created. It will be available here when ready.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setExportLoading(false);
    }
  };

  const handleLegacyJsonExport = async () => {
    setExportLoading(true);
    setError('');
    setMessage('');
    try {
      const body = await getPrivacyExportData();
      const exportData = body.export || {};
      downloadBlob(new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }), `iscraper-privacy-export-${new Date().toISOString().slice(0, 10)}.json`);
      setMessage(`Legacy JSON export downloaded with ${exportData.items?.length || 0} saves and ${exportData.imports?.length || 0} imports.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setExportLoading(false);
    }
  };

  const handleDataExportDownload = async (id) => {
    const blob = await downloadDataExport(id);
    downloadBlob(blob, `iscraper-data-export-${new Date().toISOString().slice(0, 10)}.zip`);
  };

  const refreshDeletionState = async () => {
    const body = await getAccountDeletion();
    setDeletionState(body.deletion || null);
    return body.deletion || null;
  };

  const handleDeletionRequest = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const body = await requestAccountDeletion(deletionForm);
      setDeletionState(body.deletion || null);
      setMessage('Deletion request submitted. Risky account activity is now frozen while it waits for review.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeletionCancel = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const body = await cancelAccountDeletion();
      setDeletionState(body.deletion || null);
      setMessage('Deletion request canceled.');
    } catch (err) {
      setError(err.message);
      await refreshDeletionState().catch(() => null);
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    setError('');
    try {
      await supabase.auth.signOut();
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const healthCopy = {
    checking: ['Checking', 'text-primary', Loader2],
    working: ['Working', 'text-primary', CheckCircle2],
    failed: ['Needs attention', 'text-destructive', AlertCircle],
  };
  const visualCoverage = dataUsage.searchable
    ? Math.round((dataUsage.visualReady / dataUsage.searchable) * 100)
    : 0;
  const tabs = [
    ['account', User, 'Account'],
    ['usage', ShieldCheck, 'Privacy'],
    ['profile', Settings, 'Profile'],
    ['personalization', Sparkles, 'Personalization'],
    ['api', KeyRound, 'API Health'],
    ['requests', AlertCircle, 'Requests'],
    ...extraTabs,
  ];

  return (
    <div
      className={isModal ? 'fixed inset-0 z-[220] grid place-items-center bg-black/75 px-3 py-5 backdrop-blur-md' : 'min-h-full bg-black'}
      onMouseDown={(event) => {
        if (isModal && event.target === event.currentTarget) onClose?.();
      }}
    >
      <section className={isModal ? 'flex h-[90vh] w-[94vw] max-w-6xl flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-black text-foreground shadow-[0_30px_120px_rgba(0,0,0,0.75)] md:h-[70vh] md:w-[70vw]' : 'mx-auto flex min-h-full w-full max-w-7xl flex-col bg-black text-foreground'}>
        <header className={`${isModal ? 'p-4 md:p-5' : 'px-6 py-6 md:px-10 md:py-8'} flex items-center justify-between gap-4 border-b border-white/10`}>
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full border border-white/10 bg-primary font-display text-lg font-bold text-primary-foreground">
              {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : initial}
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-bold tracking-tight">Account settings</h2>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
          </div>
          {isModal && (
            <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 text-muted-foreground transition hover:bg-white/10 hover:text-foreground" aria-label="Close settings">
              <X className="h-5 w-5" />
            </button>
          )}
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[14rem_1fr]">
          <nav className="flex gap-2 overflow-x-auto border-b border-white/10 p-3 md:block md:space-y-2 md:overflow-visible md:border-b-0 md:border-r">
            {tabs.map(([key, Icon, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition md:w-full ${
                  activeTab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </nav>

          <div className={`${isModal ? 'p-4 md:p-6' : 'px-6 py-6 md:px-10 md:py-8'} min-h-0 overflow-y-auto`}>
            {(error || message) && (
              <div className="mb-4">
                {error ? <Banner type="error">{error}</Banner> : <Banner>{message}</Banner>}
              </div>
            )}

            {renderExtraTab && extraTabs.some(([key]) => key === activeTab) ? renderExtraTab(activeTab) : (
              <>
            {activeTab === 'account' && (
              <div className="space-y-5">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Account</div>
                  <h3 className="mt-2 font-display text-3xl font-bold tracking-tight">Your login</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    This is the email connected to your login. To use another email, log out and sign in with that email or Google account.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <label className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Email</label>
                  <div className="mt-2 rounded-xl border border-white/10 bg-black px-4 py-3 text-sm">{email}</div>
                </div>
                <button type="button" onClick={handleLogout} disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/40 px-5 py-3 text-sm font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-60">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  Log out
                </button>
              </div>
            )}

            {activeTab === 'usage' && (
              <div className="space-y-5">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Privacy dashboard</div>
                  <h3 className="mt-2 font-display text-3xl font-bold tracking-tight">Your data and access</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    A simple view of what IScraper stores, what is connected, and the controls for export or deletion.
                  </p>
                  <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] p-3 text-xs leading-5 text-muted-foreground">{AI_PROCESSING_NOTICE}</p>
                </div>

                {accountSummary && (
                  <section className="rounded-2xl border border-primary/25 bg-primary/5 p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Account data model</div>
                        <h4 className="mt-2 font-display text-2xl font-bold tracking-tight">Support ID {accountSummary.publicRef || 'Not assigned'}</h4>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          This is the safe account reference for support. Your internal login ID, sessions, tokens, and secrets stay hidden.
                        </p>
                      </div>
                      <div className="grid min-w-52 gap-2 text-sm">
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Imports</span><span className="font-semibold">{formatUsageNumber(accountSummary.counts?.imports || 0)}</span></div>
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Saves</span><span className="font-semibold">{formatUsageNumber(accountSummary.counts?.saves || 0)}</span></div>
                        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Connections</span><span className="font-semibold">{formatUsageNumber((accountSummary.counts?.extensionTokens || 0) + (accountSummary.counts?.captureConnections || 0))}</span></div>
                      </div>
                    </div>
                  </section>
                )}

                <section className="grid gap-3 md:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setActiveTab('requests')}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-primary/40 hover:bg-primary/5"
                  >
                    <Download className="h-5 w-5 text-primary" />
                    <div className="mt-3 font-semibold">Export or delete data</div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">Create a ZIP export, see request status, or start account deletion review.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('api')}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-primary/40 hover:bg-primary/5"
                  >
                    <KeyRound className="h-5 w-5 text-primary" />
                    <div className="mt-3 font-semibold">Connected keys</div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {formatUsageNumber(accountSummary?.counts?.providerCredentials || groupedCredentials.length)} provider keys and {formatUsageNumber(accountSummary?.counts?.extensionTokens || 0)} active extension or agent tokens.
                    </p>
                  </button>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <Zap className="h-5 w-5 text-primary" />
                    <div className="mt-3 font-semibold">Billing and credits</div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {formatUsageNumber(dataUsage.credits.available)} credits available. Credit records are kept for support and accounting.
                    </p>
                  </div>
                </section>

                {dataMap?.categories?.length > 0 && (
                  <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Data map</div>
                        <h4 className="mt-2 font-display text-2xl font-bold tracking-tight">What IScraper keeps</h4>
                      </div>
                      <span className="rounded-full border border-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                        {dataMap.categories.length} categories
                      </span>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {dataMap.categories.map((category) => (
                        <div key={category.key} className="rounded-xl border border-white/10 bg-black/50 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-semibold">{category.label}</div>
                            <span className="rounded-full bg-white/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{category.classification || category.sensitivity}</span>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">{category.description}</p>
                          {category.purpose && <p className="mt-2 text-xs leading-5 text-foreground">Why: {category.purpose}</p>}
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">Kept: {category.retentionPeriod || category.retention}</p>
                          {category.minimization && <p className="mt-2 text-xs leading-5 text-muted-foreground">Limited to: {category.minimization}</p>}
                          <p className="mt-2 text-xs leading-5 text-primary">{category.redaction}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Recent security activity</div>
                      <h4 className="mt-2 font-display text-2xl font-bold tracking-tight">Account safety log</h4>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        Shows sensitive account actions like exports, token changes, provider-key changes, support views, and deletion steps.
                      </p>
                    </div>
                    <span className="rounded-full border border-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      {securityActivity.length} recent
                    </span>
                  </div>
                  <div className="mt-4 space-y-2">
                    {securityActivity.length ? securityActivity.map((event) => (
                      <div key={event.id} className="flex flex-col gap-1 rounded-xl border border-white/10 bg-black/50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="font-semibold capitalize">{securityActivityLabel(event.eventType)}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{event.actorType === 'support' ? 'Support/admin action' : 'Your account action'} - {event.result || 'recorded'}</div>
                        </div>
                        <span className="text-xs text-muted-foreground">{formatUsageDate(event.createdAt)}</span>
                      </div>
                    )) : (
                      <div className="rounded-xl border border-white/10 bg-black/50 p-4 text-sm text-muted-foreground">
                        No recent sensitive actions recorded.
                      </div>
                    )}
                  </div>
                </section>

                {usageLoading ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {Array.from({ length: 4 }, (_, index) => (
                        <SkeletonBlock key={index} className="h-28 rounded-xl" />
                      ))}
                    </div>
                    <div className="mt-4">
                      <SkeletonRows count={3} compact />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        ['All saves', dataUsage.total, Brain],
                        ['Searchable', dataUsage.searchable, Search],
                        ['Needs review', dataUsage.needsReview, FileText],
                        ['Enrichment issues', dataUsage.failed, AlertCircle],
                      ].map(([label, value, Icon]) => (
                        <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</span>
                            <Icon className="h-4 w-4 text-primary" />
                          </div>
                          <div className="mt-3 font-display text-3xl font-bold">{formatUsageNumber(value)}</div>
                        </div>
                      ))}
                    </div>

                    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Indexing coverage</div>
                          <h4 className="mt-2 font-display text-2xl font-bold tracking-tight">{visualCoverage}% visually enriched</h4>
                        </div>
                        <span className="rounded-full border border-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          {formatUsageNumber(dataUsage.indexing)} indexing now
                        </span>
                      </div>
                      <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${visualCoverage}%` }} />
                      </div>
                      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                        <div>
                          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Metadata only</div>
                          <div className="mt-1 font-semibold">{formatUsageNumber(dataUsage.metadataOnly)}</div>
                        </div>
                        <div>
                          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Text indexed</div>
                          <div className="mt-1 font-semibold">{formatUsageNumber(dataUsage.textIndexed)}</div>
                        </div>
                        <div>
                          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Visual ready</div>
                          <div className="mt-1 font-semibold">{formatUsageNumber(dataUsage.visualReady)}</div>
                        </div>
                        <div>
                          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Transcript ready</div>
                          <div className="mt-1 font-semibold">{formatUsageNumber(dataUsage.transcriptReady)}</div>
                        </div>
                      </div>
                    </section>

                    <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
                      <section className="rounded-2xl border border-primary/25 bg-primary/5 p-5">
                        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Credits</div>
                        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                          <div>
                            <div className="font-display text-3xl font-bold">{formatUsageNumber(dataUsage.credits.available)}</div>
                            <div className="mt-1 text-sm text-muted-foreground">available enrichment credits</div>
                          </div>
                        </div>
                        <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-primary" style={{ width: dataUsage.credits.available > 0 ? '100%' : '0%' }} />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          <span>{formatUsageNumber(dataUsage.credits.paid)} paid credits</span>
                        </div>
                      </section>

                      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Library shape</div>
                        <div className="mt-4 grid gap-4 text-sm">
                          <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                            <span className="text-muted-foreground">Platforms</span>
                            <span className="font-semibold">{formatUsageNumber(dataUsage.platforms)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                            <span className="text-muted-foreground">Collections</span>
                            <span className="font-semibold">{formatUsageNumber(dataUsage.collections)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">Latest save</span>
                            <span className="text-right font-semibold">{formatUsageDate(dataUsage.latestDate)}</span>
                          </div>
                        </div>
                      </section>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === 'profile' && (
              <form onSubmit={handleProfileSave} className="space-y-5">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Profile</div>
                  <h3 className="mt-2 font-display text-3xl font-bold tracking-tight">Name and picture</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">This is what IScraper uses inside your account.</p>
                </div>
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Username</label>
                  <input
                    value={profileForm.username}
                    onChange={(event) => setProfileForm((current) => ({ ...current, username: event.target.value.toLowerCase() }))}
                    placeholder="your_username"
                    pattern="[a-z0-9_]{3,24}"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
                    required
                  />
                </div>
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Profile picture</label>
                  <div className="mt-3 flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center">
                    <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full border border-white/10 bg-primary font-display text-2xl font-bold text-primary-foreground">
                      {profileForm.avatarUrl ? <img src={profileForm.avatarUrl} alt="" className="h-full w-full object-cover" /> : initial}
                    </div>
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAvatarFile} className="min-w-0 text-xs text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary-foreground" />
                  </div>
                </div>
                <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Save profile
                </button>
              </form>
            )}

            {activeTab === 'personalization' && (
              <form onSubmit={handleOnboardingSettingsSave} className="space-y-5">
                <OnboardingPreferencesFields form={onboardingForm} setForm={setOnboardingForm} />
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-muted-foreground">
                  {onboardingIsDone(onboarding)
                    ? 'Your onboarding answers are saved. You can update them any time.'
                    : 'You have not completed personalization yet. This is optional.'}
                </div>
                <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Save personalization
                </button>
              </form>
            )}

            {activeTab === 'api' && (
              <div className="space-y-5">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">API Health</div>
                  <h3 className="mt-2 font-display text-3xl font-bold tracking-tight">Your saved keys</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">Keys stay hidden until you choose to reveal one.</p>
                  <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] p-3 text-xs leading-5 text-muted-foreground">{AI_PROCESSING_NOTICE} {PROVIDER_KEY_PRIVACY_NOTICE}</p>
                </div>
                {groupedCredentials.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-muted-foreground">
                    No API keys saved yet. Add OpenRouter from Settings when you are ready.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {groupedCredentials.map((group) => {
                      const revealed = revealedByGroup[group.id] || '';
                      const health = healthByGroup[group.id];
                      const [label, color, HealthIcon] = healthCopy[health] || ['Not checked', 'text-muted-foreground', ShieldCheck];
                      return (
                        <div key={group.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0">
                              <div className="font-semibold">{PROVIDER_DISPLAY_LABELS[group.provider] || group.provider}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{group.credentials.map((credential) => credential.purpose).join(', ')}</div>
                            </div>
                            <span className={`inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs ${color}`}>
                              <HealthIcon className={`h-3.5 w-3.5 ${health === 'checking' ? 'animate-spin' : ''}`} /> {label}
                            </span>
                          </div>
                          <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
                            <div className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black px-4 py-3 font-mono text-xs">
                              {revealed ? <span className="break-all">{revealed}</span> : <span>{group.keyHint}</span>}
                            </div>
                            <div className="flex gap-2">
                              <button type="button" onClick={() => handleHealthCheck(group)} disabled={health === 'checking'} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-3 text-xs font-semibold transition hover:bg-white/5 disabled:opacity-60">
                                {health === 'checking' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                                Check
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (revealed) {
                                    setRevealedByGroup((current) => ({ ...current, [group.id]: '' }));
                                    return;
                                  }
                                  handleReveal(group);
                                }}
                                disabled={busy}
                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-accent/40 px-3 py-3 text-xs font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-60"
                              >
                                {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                {revealed ? 'Hide' : 'Reveal'}
                              </button>
                              {revealed && (
                                <button type="button" onClick={() => handleCopy(revealed)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-3 text-xs font-semibold text-primary-foreground">
                                  <Copy className="h-4 w-4" /> Copy
                                </button>
                              )}
                            </div>
                          </div>
                          {confirmRevealGroup === group.id && !revealed && (
                            <div className="mt-3 rounded-xl border border-accent/40 bg-accent/10 p-3 text-sm leading-6 text-accent">
                              Revealing an API key exposes the full secret on this screen. Only do this on your own device.
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button type="button" onClick={() => handleReveal(group)} className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground">Reveal key</button>
                                <button type="button" onClick={() => setConfirmRevealGroup(null)} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-foreground">Cancel</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'requests' && (
              <div className="space-y-5">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Account requests</div>
                  <h3 className="mt-2 font-display text-3xl font-bold tracking-tight">Data and account deletion</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Deletion is reviewed before execution. Once execution starts, it cannot be canceled from the app.
                  </p>
                </div>

                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Data export</div>
                      <h4 className="mt-2 font-display text-2xl font-bold tracking-tight">Download your IScraper data</h4>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        Create a ZIP export with your account summary, saved library, activity records, AI usage, access metadata, credits, privacy request state, and the data map.
                      </p>
                      <label className="mt-4 flex max-w-xl items-start gap-3 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={includeExportFiles}
                          onChange={(event) => setIncludeExportFiles(event.target.checked)}
                          className="mt-1 h-4 w-4 accent-primary"
                        />
                        <span>
                          Include uploaded files referenced by your saves. Large or unavailable files are skipped and listed in the export manifest.
                        </span>
                      </label>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        onClick={handlePrivacyExport}
                        disabled={exportLoading}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                      >
                        {exportLoading ? <LoadingSpinner /> : <Download className="h-4 w-4" />}
                        {exportLoading ? 'Building export...' : 'Create ZIP export'}
                      </button>
                      <button
                        type="button"
                        onClick={handleLegacyJsonExport}
                        disabled={exportLoading}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-white/5 disabled:opacity-60"
                      >
                        JSON
                      </button>
                    </div>
                  </div>
                  {exportLoading && (
                    <div className="mt-4">
                      <ProgressBar value={null} label="Building export" detail="Preparing your data" />
                    </div>
                  )}
                  {dataExports.length > 0 && (
                    <div className="mt-5 space-y-2">
                      {dataExports.slice(0, 5).map((request) => (
                        <div key={request.id} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{request.id}</div>
                            <div className="mt-1 font-semibold">{exportStatusLabel(request.status)}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Requested {formatUsageDate(request.requestedAt)}
                              {request.expiresAt ? ` - expires ${formatUsageDate(request.expiresAt)}` : ''}
                              {request.metadata?.includeFiles ? ' - includes uploaded files' : ''}
                            </div>
                            {request.steps?.length > 0 && ['requested', 'building'].includes(request.status) && (
                              <div className="mt-2 text-xs text-muted-foreground">
                                {request.steps.filter((step) => step.status === 'ready').length}/{request.steps.length} export sections ready
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] ${
                              request.status === 'failed' ? 'border-destructive/40 text-destructive' : 'border-white/10 text-primary'
                            }`}>
                              {request.status}
                            </span>
                            {request.status === 'ready' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setExportLoading(true);
                                  setError('');
                                  handleDataExportDownload(request.id)
                                    .then(() => setMessage('Data export downloaded.'))
                                    .catch((err) => setError(err.message))
                                    .finally(() => setExportLoading(false));
                                }}
                                disabled={exportLoading}
                                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                              >
                                <Download className="h-3.5 w-3.5" /> Download
                              </button>
                            )}
                          </div>
                          {request.errorMessage && <div className="text-xs text-destructive">{request.errorMessage}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {deletionLoading ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <SkeletonBlock className="h-5 w-48 rounded-full" />
                    <SkeletonBlock className="mt-4 h-8 w-72 max-w-full rounded-full" />
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      {Array.from({ length: 4 }, (_, index) => (
                        <SkeletonBlock key={index} className="h-20 rounded-xl" />
                      ))}
                    </div>
                  </div>
                ) : deletionState?.request ? (
                  <section className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Request {deletionState.request.id}</div>
                        <h4 className="mt-2 font-display text-2xl font-bold tracking-tight">{deletionStatusLabel(deletionState.request.status)}</h4>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {deletionState.request.statusMessage || deletionStatusCopy(deletionState.request.status)}
                        </p>
                      </div>
                      <span className="rounded-full border border-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
                        {deletionState.request.status}
                      </span>
                    </div>

                    <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                      {[
                        ['Requested', deletionState.request.requestedAt],
                        ['Approved', deletionState.request.approvedAt],
                        ['Executing', deletionState.request.executingAt],
                        ['Completed', deletionState.request.completedAt],
                        ['Logged', deletionState.request.loggedAt],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-xl border border-white/10 bg-black/50 p-3">
                          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
                          <div className="mt-1 font-semibold">{value ? formatUsageDate(value) : 'Not yet'}</div>
                        </div>
                      ))}
                    </div>

                    {deletionState.request.steps?.length > 0 && (
                      <div className="mt-5 space-y-2">
                        {deletionState.request.steps.map((step) => (
                          <div key={step.stepKey} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-xs">
                            <span className="font-mono uppercase tracking-[0.16em]">{step.stepKey.replaceAll('_', ' ')}</span>
                            <span className={step.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>{step.status}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {deletionState.request.retentionSummary?.retained?.length > 0 && (
                      <p className="mt-5 text-xs leading-5 text-muted-foreground">
                        Retained categories: {deletionState.request.retentionSummary.retained.join(', ')}.
                      </p>
                    )}

                    {deletionState.canCancel && (
                      <button
                        type="button"
                        onClick={handleDeletionCancel}
                        disabled={busy}
                        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold transition hover:bg-white/5 disabled:opacity-60"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                        Cancel deletion request
                      </button>
                    )}
                  </section>
                ) : (
                  <form onSubmit={handleDeletionRequest} className="space-y-4 rounded-2xl border border-destructive/40 bg-destructive/5 p-5">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-destructive">Deletion request</div>
                      <h4 className="mt-2 font-display text-2xl font-bold tracking-tight">Request account deletion</h4>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        This will freeze imports, search enrichment, API keys, extension access, checkout, and Lens while the request is reviewed.
                        Some security, accounting, backup, log, Stripe, PostHog, email, and AI-provider records may remain outside IScraper.
                      </p>
                    </div>
                    <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/50 p-3 text-sm leading-6 text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={deletionForm.exportConfirmed}
                        onChange={(event) => setDeletionForm((current) => ({ ...current, exportConfirmed: event.target.checked }))}
                        className="mt-1 h-4 w-4 accent-primary"
                        required
                      />
                      <span>I have exported my data or I understand deletion may remove my saved library permanently.</span>
                    </label>
                    <textarea
                      value={deletionForm.reason}
                      onChange={(event) => setDeletionForm((current) => ({ ...current, reason: event.target.value }))}
                      maxLength={500}
                      placeholder="Optional reason for support review"
                      className="min-h-28 w-full resize-none rounded-xl border border-white/10 bg-black px-4 py-3 text-sm leading-6 outline-none focus:border-destructive"
                    />
                    <button
                      type="submit"
                      disabled={busy || !deletionForm.exportConfirmed}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-destructive px-5 py-3 text-sm font-semibold text-white transition hover:scale-[1.01] disabled:opacity-60"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertCircle className="h-4 w-4" />}
                      Submit deletion request
                    </button>
                  </form>
                )}
              </div>
            )}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
export { AccountSettingsModal };
