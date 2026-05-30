import {
  AlertCircle,
  appParamsFromLocation,
  approveReviewItem,
  AppShellSkeleton,
  archiveItem,
  ArrowLeft,
  askLibraryChat,
  avatarUrlForSession,
  Brain,
  BrandLogo,
  checkLibraryLinks,
  ChevronDown,
  cleanAuthCallbackUrl,
  clearAppQueryParams,
  createAgentAccessToken,
  createExtensionToken,
  createItemReminder,
  createNote,
  DASHBOARD_ENRICHED_STAGES,
  DASHBOARD_TABS,
  dashboardTabFromLocation,
  Database,
  deleteProviderCredential,
  enrichIntentBatch,
  enrichItem,
  FileText,
  Folder,
  forgetPendingExtensionConnect,
  getAgentAccessTokens,
  getIndexingSummary,
  getItem,
  getItems,
  getItemsPage,
  getLibraryCare,
  getOnboarding,
  getProfile,
  getProviderCredentials,
  getSmartCollectionItems,
  getSmartCollections,
  GitBranch,
  gsap,
  identifyPostHogUser,
  imageFileToVisualSearchDataUrl,
  IMPORT_PROGRESS_STAGES,
  importCandidateFiles,
  importInstagramExport,
  INDEXING_META,
  initialForSession,
  itemCollections,
  itemIdFromLocation,
  itemMatchesCollection,
  itemStateMatches,
  itemTypeMatches,
  KEY_SETUP_OPTIONS,
  KeyRound,
  keyValidationMessage,
  LIBRARY_LAYOUT_STORAGE_KEY,
  libraryLayoutFromLocation,
  Loader2,
  Lock,
  mapItem,
  normalizeLibraryLayout,
  onboardingFormFromRecord,
  onboardingIsDone,
  PanelLeftClose,
  PanelLeftOpen,
  pendingExtensionConnectFromStorage,
  platformOptionsForItems,
  Plus,
  queueStorageImport,
  recordSessionSignInActivity,
  refreshSmartCollections,
  replaceAppTabUrl,
  resetPageScroll,
  resetPostHogUser,
  revokeAgentAccessToken,
  saveLink,
  saveOnboarding,
  saveProfile,
  saveProviderCredential,
  SEARCH_MODES,
  searchItems,
  searchVisuals,
  sendExtensionConnection,
  setApiAccessToken,
  setSmartCollectionItemOverride,
  Settings,
  ShieldCheck,
  shouldEnrichItem,
  shouldUseStorageUpload,
  SlidersHorizontal,
  SmartCollectionsView,
  sortedItems,
  STATE_FILTERS,
  submitSearchFeedback,
  supabase,
  testProviderCredential,
  TYPE_FILTERS,
  unique,
  updateItemReminder,
  updateReviewItem,
  updateSmartCollection,
  Upload,
  uploadImportFilesToStorage,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  validateExportFiles,
  visualSearchImageError,
} from '../AppShared.jsx';
import { AuthRequiredPanel, Banner, OnboardingPreferencesPanel, ProfileRequiredPanel } from '../components/Common.jsx';
import LibraryTab, {
  activityFromIndexingSummary,
  buildActivationState,
  createLibraryChatMessage,
  LibraryChatPanel,
  webSearchProgress,
  webStepStatusFromAi,
} from './LibraryTab.jsx';
import { LibraryCheckupTab } from './LibraryCheckupTab.jsx';
import { UploadTab } from './UploadTab.jsx';
import { SettingsTab } from './SettingsTab.jsx';
import { GraphTab } from './GraphTab.jsx';
import { DetailDrawer } from './DetailDrawer.jsx';
import { QuickAddModal } from './QuickAddModal.jsx';
import { AccountSettingsModal } from './AccountSettingsModal.jsx';
function Dashboard({ onBack, onOpenLogin, onOpenHowTo }) {
  const [tab, setTab] = useState(() => dashboardTabFromLocation());
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const [collectionFilter, setCollectionFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [libraryLayout, setLibraryLayout] = useState(() => libraryLayoutFromLocation());
  const [items, setItems] = useState([]);
  const [libraryItems, setLibraryItems] = useState([]);
  const [libraryTotalCount, setLibraryTotalCount] = useState(0);
  const [libraryNextCursor, setLibraryNextCursor] = useState(null);
  const [libraryFacets, setLibraryFacets] = useState({ collections: ['all'], platforms: ['all'] });
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryHasLoaded, setLibraryHasLoaded] = useState(false);
  const [smartCollections, setSmartCollections] = useState([]);
  const [smartCollectionsLoading, setSmartCollectionsLoading] = useState(false);
  const [selectedSmartCollection, setSelectedSmartCollection] = useState(null);
  const [smartCollectionItems, setSmartCollectionItems] = useState([]);
  const [smartCollectionItemsLoading, setSmartCollectionItemsLoading] = useState(false);
  const [libraryCare, setLibraryCare] = useState(null);
  const [libraryCareLoading, setLibraryCareLoading] = useState(false);
  const [indexingSummary, setIndexingSummary] = useState(null);
  const [searchResults, setSearchResults] = useState(null);
  const [searchMeta, setSearchMeta] = useState({ eventId: '', ai: null, feedback: {} });
  const [searchMode, setSearchMode] = useState('saved');
  const [libraryChat, setLibraryChat] = useState({ open: false, query: '', messages: [], loading: false, error: '' });
  const [visualSearch, setVisualSearch] = useState(null);
  const [visualSearchLoading, setVisualSearchLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [files, setFiles] = useState([]);
  const [importProgress, setImportProgress] = useState(null);
  const [importSourceType, setImportSourceType] = useState('auto');
  const [linkForm, setLinkForm] = useState({ url: '', title: '', description: '', note: '' });
  const [uploadInitialMode, setUploadInitialMode] = useState('link');
  const [noteForm, setNoteForm] = useState({ title: '', body: '', links: '', images: [] });
  const [credentials, setCredentials] = useState([]);
  const [agentTokens, setAgentTokens] = useState([]);
  const [controlsLoaded, setControlsLoaded] = useState(false);
  const [agentTokenName, setAgentTokenName] = useState('Codex / Cursor / Claude');
  const [createdAgentAccess, setCreatedAgentAccess] = useState(null);
  const [credentialOptions, setCredentialOptions] = useState(null);
  const [credentialForm, setCredentialForm] = useState({
    setup: 'openrouter_all',
    apiKey: '',
    displayName: '',
    baseUrl: '',
    model: '',
  });
  const [credentialSaveSuccess, setCredentialSaveSuccess] = useState(false);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileRequired, setProfileRequired] = useState(false);
  const [profileForm, setProfileForm] = useState({ username: '', avatarUrl: '' });
  const [onboarding, setOnboarding] = useState(null);
  const [onboardingForm, setOnboardingForm] = useState(onboardingFormFromRecord(null));
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [sidebarHoverExpanded, setSidebarHoverExpanded] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const sidebarRef = useRef(null);
  const sidebarHoverTimerRef = useRef(null);
  const dashPanelRef = useRef(null);
  const pendingSaveHandledRef = useRef(false);
  const pendingItemHandledRef = useRef(false);
  const pendingExtensionConnectHandledRef = useRef(false);
  const activeSearchRef = useRef(0);
  const authEnabled = Boolean(supabase);
  const signedIn = !authEnabled || Boolean(session);
  const shouldShowOnboardingPrompt = authEnabled && Boolean(session) && !profileRequired && !onboardingIsDone(onboarding);
  const canUsePrivateActions = signedIn && (!authEnabled || !profileRequired);
  const dashboardAvatarUrl = avatarUrlForSession(session, profile);
  const dashboardInitial = initialForSession(session, profile);
  const updateCredentialForm = useCallback((updater) => {
    setCredentialSaveSuccess(false);
    setCredentialForm(updater);
  }, []);

  const requireSignIn = useCallback((action = 'do this') => {
    if (!authEnabled || session) return true;
    setError(`Sign in to ${action}.`);
    setNotice('');
    return false;
  }, [authEnabled, session]);

  const requireProfile = useCallback((action = 'do this') => {
    if (!authEnabled || !session || !profileRequired) return true;
    setError(`Choose a username before you ${action}.`);
    setNotice('');
    return false;
  }, [authEnabled, profileRequired, session]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LIBRARY_LAYOUT_STORAGE_KEY, normalizeLibraryLayout(libraryLayout));
    } catch {
      // Layout preference is cosmetic; ignore private-mode storage failures.
    }
  }, [libraryLayout]);

  const loadItems = useCallback(async () => {
    const body = await getItems();
    const nextItems = (body.items || []).map(mapItem);
    const itemsById = new Map(nextItems.map((item) => [item.id, item]));
    setItems(nextItems);
    setSelected((current) => (current ? itemsById.get(current.id) || current : current));
    setSearchResults((current) => (current
      ? current.map((entry) => {
          const updated = itemsById.get(entry.id);
          return updated ? { ...updated, searchMatch: entry.searchMatch } : entry;
        })
      : current));
  }, []);

  const loadLibraryPage = useCallback(async ({ reset = false, cursor = null } = {}) => {
    setLibraryLoading(true);
    try {
      const body = await getItemsPage({
        limit: 60,
        cursor,
        sort: sortOrder,
        type: typeFilter,
        state: stateFilter,
        collection: collectionFilter,
        platform: platformFilter,
      });
      const nextItems = (body.items || []).map(mapItem);
      setLibraryItems((current) => {
        if (reset) return nextItems;
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...nextItems.filter((item) => !seen.has(item.id))];
      });
      setLibraryTotalCount(body.totalCount ?? nextItems.length);
      setLibraryNextCursor(body.nextCursor || null);
      setLibraryFacets({
        collections: body.facets?.collections?.length ? body.facets.collections : ['all'],
        platforms: body.facets?.platforms?.length ? body.facets.platforms : ['all'],
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLibraryHasLoaded(true);
      setLibraryLoading(false);
    }
  }, [collectionFilter, platformFilter, sortOrder, stateFilter, typeFilter]);

  const mapSmartCollection = useCallback((collection) => ({
    ...collection,
    previewItems: (collection.previewItems || []).map(mapItem),
  }), []);

  const loadSmartCollections = useCallback(async () => {
    setSmartCollectionsLoading(true);
    try {
      const body = await getSmartCollections();
      const nextCollections = (body.collections || []).map(mapSmartCollection);
      setSmartCollections(nextCollections);
      setSelectedSmartCollection((current) => {
        if (!current) return nextCollections[0] || null;
        return nextCollections.find((collection) => collection.id === current.id) || nextCollections[0] || null;
      });
      return nextCollections;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setSmartCollectionsLoading(false);
    }
  }, [mapSmartCollection]);

  const refreshSaveSurfaces = useCallback((successLabel = 'Saved') => {
    Promise.all([loadItems(), loadLibraryPage({ reset: true }), loadSmartCollections()])
      .catch((err) => setError(`${successLabel}, but the library refresh failed: ${err.message}`));
  }, [loadItems, loadLibraryPage, loadSmartCollections]);

  const loadSmartCollectionItems = useCallback(async (collectionId) => {
    if (!collectionId) {
      setSmartCollectionItems([]);
      return;
    }
    setSmartCollectionItemsLoading(true);
    try {
      const body = await getSmartCollectionItems(collectionId, { limit: 60 });
      setSmartCollectionItems((body.items || []).map(mapItem));
      if (body.collection) setSelectedSmartCollection(mapSmartCollection(body.collection));
    } catch (err) {
      setError(err.message);
      setSmartCollectionItems([]);
    } finally {
      setSmartCollectionItemsLoading(false);
    }
  }, [mapSmartCollection]);

  const loadLibraryCare = useCallback(async () => {
    setLibraryCareLoading(true);
    try {
      const body = await getLibraryCare();
      setLibraryCare(body);
      return body;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLibraryCareLoading(false);
    }
  }, []);

  const clearSearchState = useCallback(() => {
    activeSearchRef.current += 1;
    setSearchResults(null);
    setSearchMeta({ eventId: '', ai: null, feedback: {} });
    setSearchMode('saved');
    setLibraryChat({ open: false, query: '', messages: [], loading: false, error: '' });
    setVisualSearch(null);
    setVisualSearchLoading(false);
    setQuery('');
  }, []);

  const loadControls = useCallback(async () => {
    const [credentialBody, agentBody] = await Promise.all([
      getProviderCredentials(),
      getAgentAccessTokens(),
    ]);
    setCredentials(credentialBody.credentials || []);
    setCredentialOptions(credentialBody.options || null);
    setAgentTokens(agentBody.tokens || []);
    setControlsLoaded(true);
  }, []);

  const mergeUpdatedItem = useCallback((updated) => {
    const nextItem = mapItem(updated);
    setItems((current) => current.map((entry) => (entry.id === nextItem.id ? nextItem : entry)));
    setSearchResults((current) => (current ? current.map((entry) => (entry.id === nextItem.id ? { ...nextItem, searchMatch: entry.searchMatch } : entry)) : current));
    setSelected((current) => (current?.id === nextItem.id ? nextItem : current));
    return nextItem;
  }, []);

  const handleEnrichItem = useCallback(async (item, options = {}) => {
    if (!item || !shouldEnrichItem(item)) return null;
    try {
      const body = await enrichItem(item.id, options);
      return body.item ? mergeUpdatedItem(body.item) : null;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [mergeUpdatedItem]);

  const handleArchiveRetry = useCallback(async (item) => {
    if (!item || !requireSignIn('save a readable copy')) return null;
    if (!requireProfile('save a readable copy')) return null;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = await archiveItem(item.id);
      const nextItem = body.item ? mergeUpdatedItem(body.item) : null;
      setNotice(body.archive?.status === 'ready' ? 'Readable copy saved.' : 'Could not save a readable copy for this site.');
      return nextItem;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [mergeUpdatedItem, requireProfile, requireSignIn]);

  const handleCheckLibraryLinks = useCallback(async () => {
    if (!requireSignIn('check your library')) return;
    if (!requireProfile('check your library')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = await checkLibraryLinks(20);
      setLibraryCare(body);
      const checked = body.checked?.length || 0;
      setNotice(checked ? `Checked ${checked} saved links.` : 'Your recent link checks are up to date.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [requireProfile, requireSignIn]);

  const handleCreateReminder = useCallback(async (item, preset = 'week') => {
    if (!item || !requireSignIn('set reminders')) return null;
    if (!requireProfile('set reminders')) return null;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = await createItemReminder(item.id, { preset });
      setNotice(preset === 'tomorrow' ? 'Reminder set for tomorrow.' : preset === 'month' ? 'Reminder set for next month.' : 'Reminder set for next week.');
      await loadLibraryCare();
      return body.reminder;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [loadLibraryCare, requireProfile, requireSignIn]);

  const handleUpdateReminder = useCallback(async (reminderId, status = 'done') => {
    if (!requireSignIn('update reminders')) return null;
    if (!requireProfile('update reminders')) return null;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = await updateItemReminder(reminderId, { status });
      await loadLibraryCare();
      setNotice(status === 'dismissed' ? 'Reminder hidden.' : 'Reminder completed.');
      return body.reminder;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [loadLibraryCare, requireProfile, requireSignIn]);

  const applyProfileState = (nextProfile, required) => {
    setProfile(nextProfile || null);
    setProfileRequired(Boolean(required));
    if (nextProfile) {
      setProfileForm({
        username: nextProfile.username || '',
        avatarUrl: nextProfile.avatarUrl || '',
      });
    }
  };

  useEffect(() => {
    let cancelled = false;
    const initialize = async (currentSession) => {
      try {
        if (authEnabled) {
          recordSessionSignInActivity(currentSession);
          const [profileBody, onboardingBody] = await Promise.all([
            getProfile(),
            getOnboarding().catch(() => ({ onboarding: null })),
          ]);
          applyProfileState(profileBody.profile, profileBody.required);
          setOnboarding(onboardingBody.onboarding || null);
          setOnboardingForm(onboardingFormFromRecord(onboardingBody.onboarding));
          identifyPostHogUser(currentSession, profileBody.profile);
          if (profileBody.required) return;
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (!authEnabled) {
      initialize();
      return () => {
        cancelled = true;
      };
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setApiAccessToken(data.session?.access_token);
        if (data.session) {
          initialize(data.session).finally(() => cleanAuthCallbackUrl());
        } else {
          setItems([]);
          setLibraryItems([]);
          setLibraryTotalCount(0);
          setLibraryNextCursor(null);
          setLibraryHasLoaded(false);
          setSmartCollections([]);
          setSelectedSmartCollection(null);
          setSmartCollectionItems([]);
          setLibraryCare(null);
          setSearchResults(null);
          setLibraryChat({ open: false, query: '', messages: [], loading: false, error: '' });
          setVisualSearch(null);
          setVisualSearchLoading(false);
          setCredentials([]);
          setCredentialOptions(null);
          setAgentTokens([]);
          setControlsLoaded(false);
          setCreatedAgentAccess(null);
          setOnboarding(null);
          setOnboardingForm(onboardingFormFromRecord(null));
          setLoading(false);
        resetPostHogUser();
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setApiAccessToken(nextSession?.access_token);
      if (nextSession) {
        initialize(nextSession).finally(() => cleanAuthCallbackUrl());
      } else {
        setItems([]);
        setLibraryItems([]);
        setLibraryTotalCount(0);
        setLibraryNextCursor(null);
        setLibraryHasLoaded(false);
        setSmartCollections([]);
        setSelectedSmartCollection(null);
        setSmartCollectionItems([]);
        setLibraryCare(null);
        setSearchResults(null);
        setLibraryChat({ open: false, query: '', messages: [], loading: false, error: '' });
        setVisualSearch(null);
        setVisualSearchLoading(false);
        setCredentials([]);
        setCredentialOptions(null);
        setAgentTokens([]);
        setControlsLoaded(false);
        setCreatedAgentAccess(null);
        setProfile(null);
        setProfileRequired(false);
        setOnboarding(null);
        setOnboardingForm(onboardingFormFromRecord(null));
        setLoading(false);
        resetPostHogUser();
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [authEnabled]);

  useEffect(() => {
    if (loading || !canUsePrivateActions) return undefined;
    let cancelled = false;
    let firstFrame;
    let secondFrame;

    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (cancelled) return;
        loadItems().catch((err) => {
          if (!cancelled) setError(err.message);
        });
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [canUsePrivateActions, loadItems, loading]);

  useEffect(() => {
    if (loading || !canUsePrivateActions || controlsLoaded) return undefined;
    let cancelled = false;
    let firstFrame;
    let secondFrame;
    let idleId;
    let timeoutId;

    const run = () => {
      if (cancelled) return;
      loadControls().catch((err) => {
        if (!cancelled && tab === 'settings') setError(err.message);
      });
    };

    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (tab === 'settings') {
          run();
          return;
        }
        if ('requestIdleCallback' in window) {
          idleId = window.requestIdleCallback(run, { timeout: 2000 });
        } else {
          timeoutId = window.setTimeout(run, 600);
        }
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      if (idleId) window.cancelIdleCallback?.(idleId);
      window.clearTimeout(timeoutId);
    };
  }, [canUsePrivateActions, controlsLoaded, loadControls, loading, tab]);

  useEffect(() => {
    gsap.set([sidebarRef.current, '.dash-panel', '.dash-panel-inner'], { clearProps: 'opacity,transform' });
  }, []);

  useEffect(() => {
    const onDashboardLocationChange = () => {
      setTab(dashboardTabFromLocation());
      if (appParamsFromLocation().get('tab') === 'gallery') {
        setLibraryLayout('gallery');
      }
      resetPageScroll();
    };
    window.addEventListener('popstate', onDashboardLocationChange);
    window.addEventListener('hashchange', onDashboardLocationChange);
    return () => {
      window.removeEventListener('popstate', onDashboardLocationChange);
      window.removeEventListener('hashchange', onDashboardLocationChange);
    };
  }, []);

  useEffect(() => {
    if (!canUsePrivateActions || searchResults !== null) return;
    loadLibraryPage({ reset: true });
  }, [canUsePrivateActions, loadLibraryPage, searchResults]);

  useEffect(() => {
    if (!canUsePrivateActions || tab !== 'smart') return;
    loadSmartCollections();
  }, [canUsePrivateActions, loadSmartCollections, tab]);

  useEffect(() => {
    if (!canUsePrivateActions || tab !== 'smart') return;
    loadSmartCollectionItems(selectedSmartCollection?.id);
  }, [canUsePrivateActions, loadSmartCollectionItems, selectedSmartCollection?.id, tab]);

  useEffect(() => {
    if (!canUsePrivateActions || tab !== 'care') return;
    loadLibraryCare();
  }, [canUsePrivateActions, loadLibraryCare, tab]);

  useEffect(() => {
    if (!canUsePrivateActions || pendingExtensionConnectHandledRef.current) return;
    const pendingConnect = pendingExtensionConnectFromStorage();
    if (!pendingConnect) return;

    pendingExtensionConnectHandledRef.current = true;
    setError('');
    setNotice('Connecting the Chrome extension to this IScraper account...');

    createExtensionToken('Chrome extension')
      .then((body) => sendExtensionConnection({
        extensionId: pendingConnect.extensionId,
        secret: body.secret,
        token: body.token,
        session,
      }))
      .then(() => {
        forgetPendingExtensionConnect();
        clearAppQueryParams(['connectExtension', 'extensionId']);
        setNotice('Chrome extension connected. You can close this tab and capture from the extension.');
      })
      .catch((err) => {
        pendingExtensionConnectHandledRef.current = false;
        setError(err.message || 'Could not connect the Chrome extension.');
        setNotice('');
      });
  }, [canUsePrivateActions, session]);

  useEffect(() => {
    gsap.fromTo(
      '.dash-panel-inner',
      { opacity: 0.92, y: 6 },
      { opacity: 1, y: 0, duration: 0.18, ease: 'power2.out', clearProps: 'opacity,transform' },
    );
  }, [tab]);

  const searchActive = searchResults !== null;
  const boardItems = searchActive ? searchResults : libraryItems;
  const collections = useMemo(() => (
    searchActive ? ['all', ...unique(boardItems.flatMap(itemCollections)).sort((a, b) => String(a).localeCompare(String(b)))] : libraryFacets.collections
  ), [boardItems, libraryFacets.collections, searchActive]);
  const platforms = useMemo(() => (
    searchActive ? platformOptionsForItems(boardItems) : libraryFacets.platforms
  ), [boardItems, libraryFacets.platforms, searchActive]);
  const pendingReviews = useMemo(() => items.filter((item) => item.sourceStatus === 'needs_review'), [items]);

  useEffect(() => {
    if (!TYPE_FILTERS.includes(typeFilter)) setTypeFilter('all');
    if (!STATE_FILTERS.includes(stateFilter)) setStateFilter('all');
    if (!collections.includes(collectionFilter)) setCollectionFilter('all');
    if (!platforms.includes(platformFilter)) setPlatformFilter('all');
  }, [collectionFilter, collections, platformFilter, platforms, stateFilter, typeFilter]);

  const filtered = useMemo(() => {
    if (!searchActive) return libraryItems;
    return sortedItems(boardItems.filter((item) => {
      if (!itemTypeMatches(item, typeFilter)) return false;
      if (!itemStateMatches(item, stateFilter)) return false;
      if (!itemMatchesCollection(item, collectionFilter)) return false;
      if (platformFilter !== 'all' && item.platform !== platformFilter) return false;
      return true;
    }), sortOrder);
  }, [boardItems, collectionFilter, libraryItems, platformFilter, searchActive, sortOrder, stateFilter, typeFilter]);

  const stats = useMemo(() => ({
    total: items.length,
    done: items.filter((item) => item.status === 'done').length,
    enriched: items.filter((item) => DASHBOARD_ENRICHED_STAGES.has(item.indexingStage)).length,
    needsReview: items.filter((item) => item.sourceStatus === 'needs_review').length,
    paused: items.filter((item) => item.status === 'paused' || item.status === 'failed').length,
  }), [items]);
  const indexingActivity = useMemo(() => activityFromIndexingSummary(indexingSummary, items), [indexingSummary, items]);
  const activationState = useMemo(() => buildActivationState(items, indexingActivity), [indexingActivity, items]);

  useEffect(() => {
    if (!canUsePrivateActions) return undefined;
    let cancelled = false;
    const refreshSummary = () => {
      getIndexingSummary()
        .then((body) => {
          if (!cancelled) setIndexingSummary(body.summary || null);
        })
        .catch((err) => {
          if (!cancelled) setError(err.message);
        });
    };
    refreshSummary();
    const timer = window.setInterval(() => {
      refreshSummary();
    }, indexingActivity.activeTotal > 0 ? 3500 : 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [canUsePrivateActions, indexingActivity.activeTotal]);

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
    setNotice('');
    try {
      const body = await saveProfile(profileForm);
      applyProfileState(body.profile, false);
      identifyPostHogUser(session, body.profile);
      await Promise.all([loadItems(), loadControls(), loadLibraryPage({ reset: true })]);
      setNotice('Profile saved. Your private library is ready.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleOnboardingSave = async ({ skipped = false } = {}) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = await saveOnboarding({
        ...onboardingForm,
        skipped,
      });
      setOnboarding(body.onboarding || null);
      setOnboardingForm(onboardingFormFromRecord(body.onboarding));
      setNotice(skipped ? 'Personalization skipped. You can update it later in account settings.' : 'Personalization saved.');
    } catch (err) {
      setError(err.message);
      setNotice('You can keep using IScraper and update personalization later.');
    } finally {
      setBusy(false);
    }
  };

  const handleSearch = useCallback(async (event) => {
    event?.preventDefault();
    if (!requireSignIn('search your library')) return;
    const searchText = String(event?.searchQuery ?? query).trim();
    const mode = SEARCH_MODES.includes(event?.searchMode) ? event.searchMode : searchMode;
    const searchRun = activeSearchRef.current + 1;
    activeSearchRef.current = searchRun;
    setBusy(true);
    setError('');
    try {
      if (!searchText) {
        setSearchResults(null);
        setSearchMeta({ eventId: '', ai: null, feedback: {} });
        setLibraryChat({ open: false, query: '', messages: [], loading: false, error: '' });
        setVisualSearch(null);
        setVisualSearchLoading(false);
        await loadItems();
      } else {
        setVisualSearch(null);
        setVisualSearchLoading(false);
        setSearchMode(mode);
        if (mode === 'web') {
          const initialUserMessage = createLibraryChatMessage('user', searchText);
          setLibraryChat({
            open: true,
            mode: 'web',
            query: searchText,
            messages: [initialUserMessage],
            loading: true,
            error: '',
            progress: webSearchProgress('loading', 'pending'),
          });
          const savedBody = await searchItems(searchText, {}, { includeAi: false });
          if (activeSearchRef.current !== searchRun) return;
          const savedResults = (savedBody.results || []).map(mapItem);
          setSearchResults(savedResults);
          setSearchMeta({ eventId: savedBody.searchEventId || '', ai: null, feedback: {} });
          setLibraryChat((current) => ({
            ...current,
            progress: webSearchProgress('done', 'loading'),
          }));
          const chatBody = await askLibraryChat(searchText, [{ role: 'user', content: searchText }], { includeWeb: true });
          if (activeSearchRef.current !== searchRun) return;
          const chatResults = (chatBody.results || []).map(mapItem);
          const nextResults = chatResults.length ? chatResults : savedResults;
          const assistantMessage = createLibraryChatMessage(
            'assistant',
            chatBody.ai?.answer || chatBody.ai?.error || 'I found matching saves. Ask a follow-up and I will answer from your Library.',
            { ai: chatBody.ai || null, results: nextResults }
          );
          setSearchResults(nextResults);
          setSearchMeta({ eventId: chatBody.searchEventId || '', ai: chatBody.ai || null, feedback: {} });
          setLibraryChat((current) => ({
            ...current,
            mode: 'web',
            query: searchText,
            messages: [initialUserMessage, assistantMessage],
            loading: false,
            error: '',
            progress: webSearchProgress('done', webStepStatusFromAi(chatBody.ai)),
          }));
        } else {
          const body = await searchItems(searchText, {}, { includeAi: true });
          const mappedResults = (body.results || []).map(mapItem);
          setSearchResults(mappedResults);
          setSearchMeta({ eventId: body.searchEventId || '', ai: body.ai || null, feedback: {} });
          setLibraryChat({ open: false, query: searchText, messages: [], loading: false, error: '' });
          const suggestedIds = (body.suggestedEnrichmentIds || mappedResults.filter(shouldEnrichItem).slice(0, 3).map((item) => item.id)).slice(0, 3);
          if (suggestedIds.length) {
            enrichIntentBatch(suggestedIds)
              .then((batch) => {
                if (activeSearchRef.current !== searchRun) return;
                for (const result of batch.results || []) {
                  if (result.item) mergeUpdatedItem(result.item);
                }
              })
              .catch(() => {});
          }
        }
      }
    } catch (err) {
      setError(err.message);
      if (mode === 'web') {
        setLibraryChat((current) => ({
          ...current,
          loading: false,
          error: err.message,
          progress: webSearchProgress(
            current.progress?.find((step) => step.key === 'saved')?.status === 'done' ? 'done' : 'failed',
            'failed'
          ),
        }));
      }
    } finally {
      setBusy(false);
    }
  }, [loadItems, mergeUpdatedItem, query, requireSignIn, searchMode]);

  const openSearchFollowUp = useCallback(() => {
    const cleanQuery = String(query || libraryChat.query || '').trim();
    const baseResults = searchResults || items;
    const messages = [];
    if (cleanQuery) messages.push(createLibraryChatMessage('user', cleanQuery));
    if (searchMeta.ai?.answer || searchMeta.ai?.error) {
      messages.push(createLibraryChatMessage(
        'assistant',
        searchMeta.ai.answer || searchMeta.ai.error,
        { ai: searchMeta.ai, results: baseResults }
      ));
    }
    setSearchMode('web');
    setLibraryChat({
      open: true,
      mode: 'web',
      query: cleanQuery,
      messages,
      loading: false,
      error: '',
      progress: null,
    });
  }, [items, libraryChat.query, query, searchMeta.ai, searchResults]);

  const handleSearchModeChange = useCallback((mode) => {
    if (!SEARCH_MODES.includes(mode)) return;
    setSearchMode(mode);
    setLibraryChat((current) => ({ ...current, mode, open: false, loading: false, error: '', progress: null }));
  }, []);

  const handleLibraryChatSubmit = useCallback(async (question) => {
    const cleanQuestion = String(question || '').trim();
    if (!cleanQuestion || !requireSignIn('ask your library')) return;
    const includeWeb = libraryChat.mode === 'web' || searchMode === 'web';

    const userMessage = createLibraryChatMessage('user', cleanQuestion);
    const requestMessages = [...libraryChat.messages, userMessage]
      .filter((message) => ['user', 'assistant'].includes(message.role))
      .map((message) => ({ role: message.role, content: message.content }));

    setLibraryChat((current) => ({
      ...current,
      open: true,
      messages: [...current.messages, userMessage],
      loading: true,
      error: '',
      progress: includeWeb ? webSearchProgress('loading', 'pending') : current.progress,
    }));

    try {
      if (includeWeb) {
        const savedBody = await searchItems(cleanQuestion, {}, { includeAi: false });
        const savedResults = (savedBody.results || []).map(mapItem);
        setSearchResults(savedResults);
        setSearchMeta({ eventId: savedBody.searchEventId || '', ai: null, feedback: {} });
        setLibraryChat((current) => ({
          ...current,
          progress: webSearchProgress('done', 'loading'),
        }));
      }
      const body = await askLibraryChat(cleanQuestion, requestMessages, includeWeb ? { includeWeb: true } : {});
      const mappedResults = (body.results || []).map(mapItem);
      const assistantMessage = createLibraryChatMessage(
        'assistant',
        body.ai?.answer || 'I could not find enough saved-library context to answer that.',
        { ai: body.ai || null, results: mappedResults }
      );
      setLibraryChat((current) => ({
        ...current,
        query: cleanQuestion,
        messages: [...current.messages, assistantMessage],
        loading: false,
        error: '',
        progress: includeWeb ? webSearchProgress('done', webStepStatusFromAi(body.ai)) : current.progress,
      }));
    } catch (err) {
      setLibraryChat((current) => ({
        ...current,
        loading: false,
        error: err.message,
        progress: includeWeb ? webSearchProgress(
          current.progress?.find((step) => step.key === 'saved')?.status === 'done' ? 'done' : 'failed',
          'failed'
        ) : current.progress,
      }));
    }
  }, [libraryChat.messages, libraryChat.mode, requireSignIn, searchMode]);

  const handleSearchFeedback = async (itemId, rating) => {
    if (!searchMeta.eventId) return;
    setSearchMeta((current) => ({
      ...current,
      feedback: { ...current.feedback, [itemId]: { rating, status: 'saving' } },
    }));
    try {
      await submitSearchFeedback({
        searchEventId: searchMeta.eventId,
        itemId,
        rating,
      });
      setSearchMeta((current) => ({
        ...current,
        feedback: { ...current.feedback, [itemId]: { rating, status: 'saved' } },
      }));
    } catch (err) {
      setSearchMeta((current) => ({
        ...current,
        feedback: { ...current.feedback, [itemId]: { rating, status: 'failed', message: err.message } },
      }));
    }
  };

  const handleSaveLink = useCallback(async (event, override = null, options = {}) => {
    event?.preventDefault();
    if (!requireSignIn('save links')) return false;
    if (!requireProfile('save links')) return false;
    const payload = override || linkForm;
    if (!String(payload.url || '').trim()) {
      setError('Paste a link first.');
      return false;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const requiresReview = options.review === true;
      const result = await saveLink({ ...payload, review: requiresReview, startProcessing: false });
      const duplicate = result.skippedDuplicateCount > 0;
      const queued = result.item?.status === 'queued' || result.queuedJobCount > 0;
      const backingUp = result.item?.archive?.status === 'pending';
      if (result.item) {
        const nextItem = mapItem(result.item);
        setItems((current) => [nextItem, ...current.filter((entry) => entry.id !== nextItem.id)]);
        setLibraryItems((current) => {
          if (!itemTypeMatches(nextItem, typeFilter)) return current;
          return [nextItem, ...current.filter((entry) => entry.id !== nextItem.id)];
        });
      }
      setNotice(duplicate
        ? 'That link was already in your library.'
        : backingUp
          ? 'Saved. IScraper is improving the title, source, and collections in the background.'
          : queued
            ? 'Saved. IScraper is organizing and indexing it in the background.'
            : 'Saved to your Library.');
      setLinkForm({ url: '', title: '', description: '', note: '' });
      window.localStorage.removeItem('iscraper.pendingSaveLink');
      options.onSuccess?.();
      refreshSaveSurfaces('Saved');
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [linkForm, refreshSaveSurfaces, requireProfile, requireSignIn, typeFilter]);

  const handleCreateNote = useCallback(async (event, options = {}) => {
    event.preventDefault();
    if (!requireSignIn('create notes')) return false;
    if (!requireProfile('create notes')) return false;
    const body = noteForm.body.trim();
    const title = noteForm.title.trim();
    const links = noteForm.links.split(/\s+/).map((link) => link.trim()).filter(Boolean);
    if (!body && !links.length && !noteForm.images.length) {
      setError('Write a note, add a link, or attach an image before saving.');
      setNotice('');
      return false;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await createNote({ title, body, links, images: noteForm.images });
      const nextItem = mapItem(result.item);
      setItems((current) => [nextItem, ...current.filter((entry) => entry.id !== nextItem.id)]);
      setLibraryItems((current) => {
        if (!itemTypeMatches(nextItem, typeFilter)) return current;
        return [nextItem, ...current.filter((entry) => entry.id !== nextItem.id)];
      });
      setNoteForm({ title: '', body: '', links: '', images: [] });
      setTab('library');
      replaceAppTabUrl('library');
      setTypeFilter('notes');
      setNotice('Note saved to Library.');
      options.onSuccess?.();
      refreshSaveSurfaces('Note saved');
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [noteForm, refreshSaveSurfaces, requireProfile, requireSignIn, typeFilter]);

  useEffect(() => {
    if (pendingSaveHandledRef.current || loading || (authEnabled && (!session || profileRequired))) return;
    const raw = window.localStorage.getItem('iscraper.pendingSaveLink');
    if (!raw) return;
    let timer = null;
    try {
      const pending = JSON.parse(raw);
      pendingSaveHandledRef.current = true;
      timer = window.setTimeout(() => {
        setTab('upload');
        setUploadInitialMode('link');
        replaceAppTabUrl('upload');
        resetPageScroll();
        setLinkForm({
          url: pending.url || '',
          title: pending.title || '',
          description: pending.description || '',
          note: pending.note || '',
        });
        if (pending.autoSave) {
          handleSaveLink(null, pending, { review: false });
        }
      }, 0);
    } catch {
      window.localStorage.removeItem('iscraper.pendingSaveLink');
    }
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [authEnabled, handleSaveLink, loading, profileRequired, session]);

  useEffect(() => {
    if (pendingItemHandledRef.current || loading || (authEnabled && (!session || profileRequired))) return;
    const itemId = itemIdFromLocation();
    if (!itemId) return;
    pendingItemHandledRef.current = true;
    const timer = window.setTimeout(() => {
      setTab('library');
      replaceAppTabUrl('library');
      resetPageScroll();
      getItem(itemId)
        .then((body) => setSelected(mapItem(body.item)))
        .catch((err) => setError(err.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authEnabled, loading, profileRequired, session]);

  const handleImport = async () => {
    if (!requireSignIn('import saves')) return false;
    if (!requireProfile('import saves')) return false;
    if (!files.length) {
      setError('Upload Instagram, Pinterest, or X bookmark export files.');
      return false;
    }
    const setImportStage = (stage, detail = '') => {
      const meta = IMPORT_PROGRESS_STAGES[stage] || IMPORT_PROGRESS_STAGES.checking;
      setImportProgress({ stage, label: meta.label, value: meta.value, detail });
    };
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setImportStage('checking', `${files.length} selected`);
      const selectedFiles = importCandidateFiles(files, importSourceType);
      validateExportFiles(selectedFiles, importSourceType);
      if (selectedFiles.length > 20) {
        throw new Error('Upload at most 20 export files at once. For full exports, upload the original ZIP instead of every folder file.');
      }
      setImportStage('uploading', `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'}`);
      const storageFiles = shouldUseStorageUpload(selectedFiles)
        ? await uploadImportFilesToStorage({ files: selectedFiles, session })
        : null;
      setImportStage('reading', storageFiles ? 'Storage import queued' : 'Parsing selected files');
      const result = storageFiles
        ? await queueStorageImport({ files: storageFiles, sourceType: importSourceType })
        : await importInstagramExport({ files: selectedFiles, sourceType: importSourceType });
      if (result.importQueued) {
        setImportStage('indexing', 'Import will finish in the background');
        setNotice('Upload received. Parsing from Supabase Storage now.');
      } else {
        setImportStage('adding', 'Saving new items');
        const newCount = result.newItemCount ?? result.itemCount ?? 0;
        const skippedCount = result.skippedDuplicateCount ?? 0;
        setNotice(`Added ${newCount} new saves. ${skippedCount} already existed.`);
      }
      setImportStage('done', 'Ready');
      window.setTimeout(() => setImportProgress(null), 2200);
      refreshSaveSurfaces('Import finished');
      return true;
    } catch (err) {
      setError(err.message);
      setImportProgress(null);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateReview = async (item, updates) => {
    if (!requireSignIn('edit reviewed saves')) return;
    if (!requireProfile('edit reviewed saves')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = await updateReviewItem(item.id, updates);
      const nextItem = mapItem(body.item);
      setItems((current) => current.map((entry) => (entry.id === nextItem.id ? nextItem : entry)));
      setSearchResults((current) => (current ? current.map((entry) => (entry.id === nextItem.id ? nextItem : entry)) : current));
      setSelected((current) => (current?.id === nextItem.id ? nextItem : current));
      setNotice('Review details saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleApproveReview = async (item, updates = {}) => {
    if (!requireSignIn('index saves')) return;
    if (!requireProfile('index saves')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = await approveReviewItem(item.id, { ...updates, startProcessing: true });
      const nextItem = mapItem(body.item);
      setItems((current) => current.map((entry) => (entry.id === nextItem.id ? nextItem : entry)));
      setSearchResults((current) => (current ? current.map((entry) => (entry.id === nextItem.id ? nextItem : entry)) : current));
      setSelected((current) => (current?.id === nextItem.id ? nextItem : current));
      setNotice('Added to Library. Search for it when you need it.');
      await loadSmartCollections();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (item) => {
    if (!requireSignIn('open saved details')) return;
    setError('');
    try {
      const body = await getItem(item.id);
      const nextItem = mapItem(body.item);
      setSelected(nextItem);
      if (shouldEnrichItem(nextItem)) {
        setItems((current) => current.map((entry) => (
          entry.id === nextItem.id ? { ...nextItem, indexingStage: 'visual_indexing', indexingLabel: INDEXING_META.visual_indexing.label } : entry
        )));
        setSearchResults((current) => (current ? current.map((entry) => (
          entry.id === nextItem.id ? { ...nextItem, indexingStage: 'visual_indexing', indexingLabel: INDEXING_META.visual_indexing.label } : entry
        )) : current));
        setSelected((current) => (current?.id === nextItem.id
          ? { ...nextItem, indexingStage: 'visual_indexing', indexingLabel: INDEXING_META.visual_indexing.label }
          : current));
        handleEnrichItem(nextItem);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const saveCredential = async (event) => {
    event.preventDefault();
    if (!requireSignIn('save API keys')) return;
    if (!requireProfile('save API keys')) return;
    const selectedSetup = KEY_SETUP_OPTIONS[credentialForm.setup] || KEY_SETUP_OPTIONS.openrouter_all;
    const plannedCredentials = selectedSetup.credentials(credentialOptions, credentialForm);
    const validationMessage = keyValidationMessage(credentialForm.setup, credentialForm.apiKey, credentialForm);
    if (validationMessage) {
      setCredentialSaveSuccess(false);
      setError(validationMessage);
      return;
    }
    setBusy(true);
    setCredentialSaveSuccess(false);
    setError('');
    setNotice('');
    const savedCredentials = [];
    try {
      for (const entry of plannedCredentials) {
        const saved = await saveProviderCredential({
          ...entry,
          apiKey: credentialForm.apiKey,
        });
        savedCredentials.push(saved.credential);
      }
      await loadControls();
      setCredentialForm((current) => ({ ...current, apiKey: '' }));
      setCredentialSaveSuccess(true);
      setNotice(`${selectedSetup.shortLabel} key saved. IScraper will use it when it can.`);
    } catch (err) {
      setCredentialSaveSuccess(false);
      setError(savedCredentials.length ? `Some key settings were saved, but one failed: ${err.message}` : err.message);
      await loadControls().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAgentAccess = async (event) => {
    event.preventDefault();
    if (!requireSignIn('connect agent access')) return;
    if (!requireProfile('connect agent access')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = await createAgentAccessToken(agentTokenName);
      setCreatedAgentAccess(body);
      await loadControls();
      setNotice('Agent access token created. Copy it now; IScraper only shows it once.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeAgentAccess = async (id) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await revokeAgentAccessToken(id);
      setCreatedAgentAccess((current) => (current?.token?.id === id ? null : current));
      await loadControls();
      setNotice('Agent access revoked.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSmartRefresh = useCallback(async () => {
    if (!requireSignIn('refresh Smart Collections')) return;
    if (!requireProfile('refresh Smart Collections')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = await refreshSmartCollections();
      const nextCollections = (body.collections || []).map(mapSmartCollection);
      setSmartCollections(nextCollections);
      setSelectedSmartCollection((current) => (
        current ? nextCollections.find((collection) => collection.id === current.id) || nextCollections[0] || null : nextCollections[0] || null
      ));
      setNotice('Smart Collections refreshed.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [mapSmartCollection, requireProfile, requireSignIn]);

  const handleSmartUpdate = useCallback(async (id, patch) => {
    if (!requireSignIn('edit Smart Collections')) return;
    if (!requireProfile('edit Smart Collections')) return;
    setBusy(true);
    setError('');
    try {
      const body = await updateSmartCollection(id, patch);
      const nextCollection = mapSmartCollection(body.collection);
      setSmartCollections((current) => {
        const next = current
          .map((collection) => (collection.id === id ? nextCollection : collection))
          .filter((collection) => !collection.hidden);
        return next.length ? next : current.filter((collection) => collection.id !== id);
      });
      setSelectedSmartCollection((current) => (current?.id === id ? (nextCollection.hidden ? null : nextCollection) : current));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [mapSmartCollection, requireProfile, requireSignIn]);

  const handleSmartRemoveItem = useCallback(async (collectionId, itemId) => {
    if (!requireSignIn('edit Smart Collections')) return;
    if (!requireProfile('edit Smart Collections')) return;
    setBusy(true);
    setError('');
    try {
      const body = await setSmartCollectionItemOverride(collectionId, itemId, 'exclude');
      const nextCollection = mapSmartCollection(body.collection);
      setSmartCollections((current) => current.map((collection) => (collection.id === collectionId ? nextCollection : collection)));
      setSelectedSmartCollection((current) => (current?.id === collectionId ? nextCollection : current));
      await loadSmartCollectionItems(collectionId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [loadSmartCollectionItems, mapSmartCollection, requireProfile, requireSignIn]);

  const navItems = [
    ['library', 'Saved library', Brain],
    ['smart', 'Smart Collections', Folder],
    ['upload', 'Add saves', Upload],
  ];
  const advancedNavItems = [
    ['care', 'Library checkup', ShieldCheck],
    ['graph', 'Graph view', GitBranch],
    ['settings', 'AI keys', KeyRound],
  ];
  const SidebarToggleIcon = sidebarExpanded ? PanelLeftClose : PanelLeftOpen;
  const advancedActive = advancedNavItems.some(([key]) => key === tab);
  const sidebarVisibleExpanded = sidebarExpanded || sidebarHoverExpanded;
  const advancedMenuOpen = sidebarVisibleExpanded && advancedOpen;

  const selectTab = useCallback((nextTab, options = {}) => {
    if (!DASHBOARD_TABS.includes(nextTab)) return;
    if (nextTab === 'upload') setUploadInitialMode(options.initialAddMode || 'link');
    if (sidebarHoverTimerRef.current) {
      window.clearTimeout(sidebarHoverTimerRef.current);
      sidebarHoverTimerRef.current = null;
    }
    setSidebarHoverExpanded(false);
    setAdvancedOpen(false);
    setTab(nextTab);
    replaceAppTabUrl(nextTab);
    resetPageScroll();
  }, []);

  const handleVisualSearch = useCallback(async (file) => {
    if (!requireSignIn('search by image')) return;
    if (!requireProfile('search by image')) return;
    const validationMessage = visualSearchImageError(file);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    const searchRun = activeSearchRef.current + 1;
    activeSearchRef.current = searchRun;
    setBusy(true);
    setVisualSearchLoading(true);
    setError('');
    setNotice('');
    try {
      const imageDataUrl = await imageFileToVisualSearchDataUrl(file);
      const body = await searchVisuals(imageDataUrl, { limit: 24 });
      if (activeSearchRef.current !== searchRun) return;
      const mappedResults = (body.results || []).map(mapItem);
      setQuery('');
      setSearchResults(mappedResults);
      setSearchMeta({ eventId: body.searchEventId || '', ai: null, feedback: {} });
      setLibraryChat({ open: false, query: '', messages: [], loading: false, error: '' });
      setVisualSearch({
        imageDataUrl,
        fileName: file.name || 'Uploaded image',
        analysis: body.visualSearch || null,
        resultCount: mappedResults.length,
      });
      selectTab('library');
      setNotice(mappedResults.length ? `Found ${mappedResults.length} saved visuals with a similar vibe.` : 'No similar saved visuals found yet.');
    } catch (err) {
      setError(err.message);
    } finally {
      setVisualSearchLoading(false);
      setBusy(false);
    }
  }, [requireProfile, requireSignIn, selectTab]);

  const tryActivationSearch = useCallback((searchText) => {
    const nextQuery = String(searchText || '').trim();
    selectTab('library');
    if (!nextQuery) return;
    setSearchMode('saved');
    setQuery(nextQuery);
    handleSearch({ preventDefault: () => {}, searchQuery: nextQuery, searchMode: 'saved' });
  }, [handleSearch, selectTab]);

  useLayoutEffect(() => {
    resetPageScroll();
    const frame = window.requestAnimationFrame(resetPageScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [tab]);

  useEffect(() => () => {
    if (sidebarHoverTimerRef.current) window.clearTimeout(sidebarHoverTimerRef.current);
  }, []);

  const handleSidebarToggle = () => {
    if (sidebarHoverTimerRef.current) window.clearTimeout(sidebarHoverTimerRef.current);
    setSidebarHoverExpanded(false);
    setSidebarExpanded((current) => !current);
  };

  const handleSidebarMouseEnter = () => {
    if (sidebarExpanded) return;
    if (sidebarHoverTimerRef.current) window.clearTimeout(sidebarHoverTimerRef.current);
    setSidebarHoverExpanded(true);
  };

  const handleSidebarMouseLeave = () => {
    if (sidebarExpanded) return;
    if (sidebarHoverTimerRef.current) window.clearTimeout(sidebarHoverTimerRef.current);
    sidebarHoverTimerRef.current = window.setTimeout(() => {
      setAdvancedOpen(false);
      setSidebarHoverExpanded(false);
      sidebarHoverTimerRef.current = null;
    }, 280);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-black text-foreground">
      <aside
        ref={sidebarRef}
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={handleSidebarMouseLeave}
        className={`hidden h-screen shrink-0 flex-col overflow-hidden border-r border-white/5 bg-black transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] md:flex ${
          sidebarVisibleExpanded ? 'w-60' : 'w-[76px]'
        }`}
      >
        <div className={`flex border-b border-white/5 p-3 ${sidebarVisibleExpanded ? 'items-center gap-2' : 'flex-col items-center gap-2'}`}>
          <button
            type="button"
            onClick={onBack}
            title="Back to home"
            aria-label="Back to home"
            className={`flex min-h-11 items-center rounded-lg transition hover:bg-white/5 hover:text-foreground ${
              sidebarVisibleExpanded ? 'min-w-0 flex-1 gap-3 px-2' : 'h-11 w-11 justify-center'
            }`}
          >
            <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
            {sidebarVisibleExpanded && <BrandLogo className="h-14 w-40 min-w-0" />}
          </button>
          <button
            type="button"
            onClick={handleSidebarToggle}
            aria-label={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-expanded={sidebarExpanded}
            title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-white/5 hover:text-primary"
          >
            <SidebarToggleIcon className="h-5 w-5" />
          </button>
        </div>
        {profile?.username && (
          <button
            type="button"
            onClick={() => setAccountSettingsOpen(true)}
            title={`Signed in as @${profile.username}`}
            aria-label={`Open account settings for @${profile.username}`}
            className={`flex w-full items-center border-b border-white/5 text-left text-xs text-muted-foreground transition hover:bg-white/5 hover:text-foreground ${
              sidebarVisibleExpanded ? 'gap-3 px-5 py-3' : 'justify-center px-3 py-3'
            }`}
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-white/10 bg-primary text-sm font-bold text-primary-foreground">
              {dashboardAvatarUrl ? <img src={dashboardAvatarUrl} alt="" className="h-full w-full object-cover" /> : dashboardInitial}
            </span>
            {sidebarVisibleExpanded && (
              <span className="min-w-0">
                <span className="block">Signed in as</span>
                <span className="block truncate font-semibold text-foreground">@{profile.username}</span>
              </span>
            )}
          </button>
        )}
        {authEnabled && !session && (
          <div className={`border-b border-white/5 py-3 ${sidebarVisibleExpanded ? 'px-5' : 'px-3'}`}>
            <button
              type="button"
              onClick={onOpenLogin}
              disabled={busy}
              title="Sign in"
              aria-label="Sign in"
              className={`inline-flex w-full items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60 ${
                sidebarVisibleExpanded ? 'gap-2 px-4 py-2.5' : 'h-11 px-0'
              }`}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              {sidebarVisibleExpanded && 'Sign in'}
            </button>
          </div>
        )}
        {authEnabled && session && profileRequired && (
          <div
            title="Choose a username before importing or saving."
            className={`border-b border-white/5 text-xs leading-5 text-muted-foreground ${sidebarVisibleExpanded ? 'px-5 py-3' : 'grid place-items-center px-3 py-3'}`}
          >
            {sidebarVisibleExpanded ? 'Choose a username before importing or saving.' : <AlertCircle className="h-4 w-4" />}
          </div>
        )}
        <nav className={`flex-1 space-y-1 p-3 ${sidebarVisibleExpanded ? '' : 'flex flex-col items-center'}`}>
          {navItems.map(([key, title, Icon]) => (
            <button
              key={key}
              onClick={() => selectTab(key)}
              title={title}
              aria-label={title}
              aria-current={tab === key ? 'page' : undefined}
              className={`flex items-center rounded-lg text-sm transition ${
                tab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
              } ${
                sidebarVisibleExpanded ? 'w-full gap-3 px-3 py-2.5' : 'h-11 w-11 justify-center'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {sidebarVisibleExpanded && <span className="truncate">{title}</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={onOpenHowTo}
            title="How to Use"
            aria-label="How to Use"
            className={`flex items-center rounded-lg text-sm text-muted-foreground transition hover:bg-white/5 hover:text-foreground ${
              sidebarVisibleExpanded ? 'w-full gap-3 px-3 py-2.5' : 'h-11 w-11 justify-center'
            }`}
          >
            <FileText className="h-4 w-4 shrink-0" />
            {sidebarVisibleExpanded && <span className="truncate">How to Use</span>}
          </button>
        </nav>
        <div className={`border-t border-white/5 p-3 ${sidebarVisibleExpanded ? '' : 'flex flex-col items-center'}`}>
          <div className={`flex ${sidebarVisibleExpanded ? 'items-center gap-2' : 'flex-col items-center gap-2'}`}>
            <button
              type="button"
              onClick={() => {
                if (authEnabled && !session) {
                  onOpenLogin();
                  return;
                }
                if (!session) {
                  selectTab('settings');
                  return;
                }
                setAccountSettingsOpen(true);
              }}
              title="Settings"
              aria-label="Open settings"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-white/5 hover:text-primary"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setAdvancedOpen((current) => !current)}
              title={sidebarVisibleExpanded ? undefined : 'Advanced Options'}
              aria-label="Advanced Options"
              aria-expanded={advancedMenuOpen}
              className={`flex min-h-11 items-center rounded-lg text-sm transition ${
                advancedActive ? 'text-primary' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
              } ${
                sidebarVisibleExpanded ? 'min-w-0 flex-1 justify-between gap-2 px-3 py-2.5' : 'h-11 w-11 justify-center'
              }`}
            >
              <span className={`flex min-w-0 items-center ${sidebarVisibleExpanded ? 'gap-3' : ''}`}>
                <SlidersHorizontal className="h-4 w-4 shrink-0" />
                {sidebarVisibleExpanded && <span className="truncate">Advanced Options</span>}
              </span>
              {sidebarVisibleExpanded && (
                <ChevronDown className={`h-4 w-4 shrink-0 transition ${advancedMenuOpen ? 'rotate-90' : '-rotate-90'}`} />
              )}
            </button>
          </div>
          {advancedMenuOpen && (
            <div
              className="fixed bottom-16 z-[80] w-60 rounded-2xl border border-white/10 bg-black/95 p-2 shadow-2xl shadow-black/70 backdrop-blur"
              style={{ left: sidebarVisibleExpanded ? '15.75rem' : '5.25rem' }}
            >
              <div className="mb-1 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
                Advanced Options
              </div>
              {advancedNavItems.map(([key, title, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    selectTab(key);
                    setAdvancedOpen(false);
                  }}
                  title={sidebarVisibleExpanded ? undefined : title}
                  aria-label={title}
                  aria-current={tab === key ? 'page' : undefined}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                    tab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div
          title={`${stats.total} saved items`}
          className={`border-t border-white/5 p-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground ${
            sidebarVisibleExpanded ? '' : 'grid place-items-center'
          }`}
        >
          {sidebarVisibleExpanded ? `${stats.total} saved items` : <Database className="h-4 w-4" />}
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {canUsePrivateActions && (
          <button
            type="button"
            onClick={() => setQuickAddOpen(true)}
            className="fixed bottom-6 right-6 z-40 inline-flex h-16 w-16 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-2xl shadow-accent/30 transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-black"
            aria-label="Add to your library"
            title="Add to your library"
          >
            <Plus className="h-7 w-7" />
          </button>
        )}
        <div ref={dashPanelRef} className="dash-panel h-screen overflow-y-auto overflow-x-hidden">
          <div className="dash-panel-inner">
            <MobileTopbar
              onBack={onBack}
              tab={tab}
              setTab={selectTab}
              onOpenHowTo={onOpenHowTo}
              session={session}
              profile={profile}
              onOpenAccount={() => setAccountSettingsOpen(true)}
            />
            {(error || notice) && (
              <div className="mx-auto max-w-6xl px-6 pt-6 md:px-12">
                {error && <Banner type="error">{error}</Banner>}
                {notice && <Banner>{notice}</Banner>}
              </div>
            )}
            {loading ? (
              <AppShellSkeleton />
            ) : (
              <>
                {authEnabled && !session && tab === 'library' && (
                  <AuthRequiredPanel
                    title="Your library is private."
                    copy="You can visit this page, but your saved posts only load after sign-in."
                    busy={busy}
                    onSignIn={onOpenLogin}
                  />
                )}
                {authEnabled && session && profileRequired && tab === 'library' && (
                  <ProfileRequiredPanel
                    profileForm={profileForm}
                    setProfileForm={setProfileForm}
                    onAvatarFile={handleAvatarFile}
                    onSave={handleProfileSave}
                    busy={busy}
                  />
                )}
                {shouldShowOnboardingPrompt && (
                  <div className="mx-auto max-w-4xl px-6 py-6 md:px-12">
                    <OnboardingPreferencesPanel
                      form={onboardingForm}
                      setForm={setOnboardingForm}
                      onSave={() => handleOnboardingSave()}
                      onSkip={() => handleOnboardingSave({ skipped: true })}
                      busy={busy}
                    />
                  </div>
                )}
                {canUsePrivateActions && tab === 'library' && (
                  <LibraryTab
                    items={filtered}
                    totalCount={searchActive ? items.length : libraryTotalCount}
                    searchActive={searchActive}
                    searchResultCount={boardItems.length}
                    query={query}
                    setQuery={setQuery}
                    onClearSearch={clearSearchState}
                    onSearch={handleSearch}
                    searchMode={searchMode}
                    onSearchModeChange={handleSearchModeChange}
                    onFollowUp={openSearchFollowUp}
                    onVisualSearch={handleVisualSearch}
                    visualSearch={visualSearch}
                    visualSearchLoading={visualSearchLoading}
                    busy={busy}
                    typeFilter={typeFilter}
                    setTypeFilter={setTypeFilter}
                    stateFilter={stateFilter}
                    setStateFilter={setStateFilter}
                    sortOrder={sortOrder}
                    setSortOrder={setSortOrder}
                    collectionFilter={collectionFilter}
                    setCollectionFilter={setCollectionFilter}
                    collections={collections}
                    platformFilter={platformFilter}
                    setPlatformFilter={setPlatformFilter}
                    platforms={platforms}
                    libraryLayout={libraryLayout}
                    setLibraryLayout={setLibraryLayout}
                    onSelect={openDetail}
                    indexingActivity={indexingActivity}
                    activationState={activationState}
                    onOpenAdd={() => selectTab('upload')}
                    searchAi={searchMeta.ai}
                    libraryChatOpen={libraryChat.open}
                    onOpenLibraryChat={() => setLibraryChat((current) => ({ ...current, open: true }))}
                    searchFeedback={searchMeta.feedback}
                    onSearchFeedback={handleSearchFeedback}
                    scrollRef={dashPanelRef}
                    hasMore={!searchActive && Boolean(libraryNextCursor)}
                    loadingMore={libraryLoading}
                    initialLoading={!searchActive && !libraryHasLoaded && libraryItems.length === 0}
                    onLoadMore={() => {
                      if (!libraryLoading && libraryNextCursor) loadLibraryPage({ cursor: libraryNextCursor });
                    }}
                  />
                )}
                {authEnabled && !session && tab === 'smart' && (
                  <AuthRequiredPanel
                    title="Sign in to view Smart Collections."
                    copy="Smart Collections are built from your private saved library."
                    busy={busy}
                    onSignIn={onOpenLogin}
                  />
                )}
                {authEnabled && session && profileRequired && tab === 'smart' && (
                  <ProfileRequiredPanel
                    profileForm={profileForm}
                    setProfileForm={setProfileForm}
                    onAvatarFile={handleAvatarFile}
                    onSave={handleProfileSave}
                    busy={busy}
                  />
                )}
                {canUsePrivateActions && tab === 'smart' && (
                  <SmartCollectionsView
                    collections={smartCollections}
                    selectedCollection={selectedSmartCollection}
                    items={smartCollectionItems}
                    loading={smartCollectionsLoading}
                    itemsLoading={smartCollectionItemsLoading}
                    busy={busy}
                    onRefresh={handleSmartRefresh}
                    onSelectCollection={setSelectedSmartCollection}
                    onUpdateCollection={handleSmartUpdate}
                    onRemoveItem={handleSmartRemoveItem}
                    onOpenItem={openDetail}
                  />
                )}
                {authEnabled && !session && tab === 'care' && (
                  <AuthRequiredPanel
                    title="Sign in to check your library."
                    copy="Library checkup works on your private saved links and reminders."
                    busy={busy}
                    onSignIn={onOpenLogin}
                  />
                )}
                {authEnabled && session && profileRequired && tab === 'care' && (
                  <ProfileRequiredPanel
                    profileForm={profileForm}
                    setProfileForm={setProfileForm}
                    onAvatarFile={handleAvatarFile}
                    onSave={handleProfileSave}
                    busy={busy}
                  />
                )}
                {canUsePrivateActions && tab === 'care' && (
                  <LibraryCheckupTab
                    care={libraryCare}
                    loading={libraryCareLoading}
                    busy={busy}
                    onCheckLinks={handleCheckLibraryLinks}
                    onOpenItem={openDetail}
                    onRemind={handleCreateReminder}
                    onUpdateReminder={handleUpdateReminder}
                  />
                )}
                {authEnabled && !session && tab === 'graph' && (
                  <AuthRequiredPanel
                    title="Sign in to view your graph."
                    copy="The graph is built from your private saved library."
                    busy={busy}
                    onSignIn={onOpenLogin}
                  />
                )}
                {authEnabled && session && profileRequired && tab === 'graph' && (
                  <ProfileRequiredPanel
                    profileForm={profileForm}
                    setProfileForm={setProfileForm}
                    onAvatarFile={handleAvatarFile}
                    onSave={handleProfileSave}
                    busy={busy}
                  />
                )}
                {canUsePrivateActions && tab === 'graph' && (
                  <GraphTab
                    onSelectItem={async (itemId) => {
                      setError('');
                      try {
                        const body = await getItem(itemId);
                        setSelected(mapItem(body.item));
                      } catch (err) {
                        setError(err.message);
                      }
                    }}
                  />
                )}
                {authEnabled && !session && tab === 'upload' && (
                  <AuthRequiredPanel
                    title="Sign in before importing."
                    copy="Imports are tied to your private account, so sign-in is required."
                    busy={busy}
                    onSignIn={onOpenLogin}
                  />
                )}
                {authEnabled && session && profileRequired && tab === 'upload' && (
                  <ProfileRequiredPanel
                    profileForm={profileForm}
                    setProfileForm={setProfileForm}
                    onAvatarFile={handleAvatarFile}
                    onSave={handleProfileSave}
                    busy={busy}
                  />
                )}
                {canUsePrivateActions && tab === 'upload' && (
                  <UploadTab
                    key={uploadInitialMode}
                    files={files}
                    setFiles={setFiles}
                    importSourceType={importSourceType}
                    setImportSourceType={setImportSourceType}
                    initialAddMode={uploadInitialMode}
                    linkForm={linkForm}
                    setLinkForm={setLinkForm}
                    noteForm={noteForm}
                    setNoteForm={setNoteForm}
                    onSaveLink={handleSaveLink}
                    onCreateNote={handleCreateNote}
                    onImport={handleImport}
                    importProgress={importProgress}
                    pendingReviews={pendingReviews}
                    onApproveReview={handleApproveReview}
                    onUpdateReview={handleUpdateReview}
                    onSelect={openDetail}
                    busy={busy}
                    onOpenHowTo={onOpenHowTo}
                    indexingActivity={indexingActivity}
                    activationState={activationState}
                    onTrySearch={tryActivationSearch}
                  />
                )}
                {authEnabled && !session && tab === 'settings' && (
                  <AuthRequiredPanel
                    title="Sign in to manage AI keys."
                    copy="AI keys belong to your private account."
                    busy={busy}
                    onSignIn={onOpenLogin}
                  />
                )}
                {authEnabled && session && profileRequired && tab === 'settings' && (
                  <ProfileRequiredPanel
                    profileForm={profileForm}
                    setProfileForm={setProfileForm}
                    onAvatarFile={handleAvatarFile}
                    onSave={handleProfileSave}
                    busy={busy}
                  />
                )}
                {canUsePrivateActions && tab === 'settings' && (
                  <SettingsTab
                    credentials={credentials}
                    agentTokens={agentTokens}
                    agentTokenName={agentTokenName}
                    setAgentTokenName={setAgentTokenName}
                    createdAgentAccess={createdAgentAccess}
                    onCreateAgentAccess={handleCreateAgentAccess}
                    onRevokeAgentAccess={handleRevokeAgentAccess}
                    credentialForm={credentialForm}
                    setCredentialForm={updateCredentialForm}
                    credentialSaveSuccess={credentialSaveSuccess}
                    onSave={saveCredential}
                    onDelete={async (id) => {
                      setBusy(true);
                      try {
                        await deleteProviderCredential(id);
                        await loadControls();
                      } catch (err) {
                        setError(err.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                    onTest={async (id) => {
                      setBusy(true);
                      try {
                        await testProviderCredential(id);
                        setNotice('Provider key works.');
                      } catch (err) {
                        setError(err.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                    busy={busy}
                    authEnabled={authEnabled}
                    onOpenHowTo={onOpenHowTo}
                    onNotice={setNotice}
                    onError={setError}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </main>

      <LibraryChatPanel
        chat={libraryChat}
        items={searchResults || items}
        onAsk={handleLibraryChatSubmit}
        onClose={() => setLibraryChat((current) => ({ ...current, open: false }))}
        onSelect={openDetail}
      />

      {quickAddOpen && (
        <QuickAddModal
          files={files}
          setFiles={setFiles}
          importSourceType={importSourceType}
          setImportSourceType={setImportSourceType}
          linkForm={linkForm}
          setLinkForm={setLinkForm}
          noteForm={noteForm}
          setNoteForm={setNoteForm}
          onSaveLink={handleSaveLink}
          onCreateNote={handleCreateNote}
          onImport={handleImport}
          importProgress={importProgress}
          busy={busy}
          onOpenHowTo={onOpenHowTo}
          onOpenFullAdd={(initialAddMode = 'upload') => {
            setQuickAddOpen(false);
            selectTab('upload', { initialAddMode });
          }}
          onClose={() => setQuickAddOpen(false)}
          onError={setError}
        />
      )}
      {selected && (
        <DetailDrawer
          item={selected}
          onClose={() => setSelected(null)}
          onApprove={handleApproveReview}
          onArchiveRetry={handleArchiveRetry}
          onRemind={handleCreateReminder}
          onOpenItem={openDetail}
          busy={busy}
        />
      )}
      {accountSettingsOpen && (
        <AccountSettingsModal
          open
          onClose={() => setAccountSettingsOpen(false)}
          session={session}
          profile={profile}
          onboarding={onboarding}
          onProfileSaved={(nextProfile) => {
            applyProfileState(nextProfile, false);
            setNotice('Profile saved.');
          }}
          onOnboardingSaved={(nextOnboarding) => {
            setOnboarding(nextOnboarding || null);
            setOnboardingForm(onboardingFormFromRecord(nextOnboarding));
            setNotice('Personalization saved.');
          }}
        />
      )}
    </div>
  );
}

function MobileTopbar({ onBack, tab, setTab, onOpenHowTo, session, profile, onOpenAccount }) {
  const avatarUrl = avatarUrlForSession(session, profile);
  const initial = initialForSession(session, profile);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedActive = tab === 'care' || tab === 'graph' || tab === 'settings';
  return (
    <div className="sticky top-0 z-30 border-b border-white/10 bg-black/90 p-3 backdrop-blur md:hidden">
      <div className="mb-3 flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" />
          <BrandLogo className="h-10 w-36" />
        </button>
        {session && (
          <button
            type="button"
            onClick={onOpenAccount}
            className="grid h-10 w-10 place-items-center overflow-hidden rounded-full border border-white/10 bg-primary text-sm font-bold text-primary-foreground"
            aria-label="Open account settings"
          >
            {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : initial}
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          ['library', 'Library'],
          ['smart', 'Smart'],
          ['upload', 'Add'],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-current={tab === key ? 'page' : undefined}
            className={`rounded-lg px-3 py-2 text-xs ${tab === key ? 'bg-primary text-primary-foreground' : 'border border-white/10 text-muted-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-2 rounded-lg border border-white/10">
        <button
          type="button"
          onClick={() => setAdvancedOpen((current) => !current)}
          aria-expanded={advancedOpen || advancedActive}
          className={`flex w-full items-center justify-between px-3 py-2 text-xs ${
            advancedActive ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <span className="inline-flex items-center gap-2">
            <Settings className="h-3.5 w-3.5" />
            Advanced Options
          </span>
          <ChevronDown className={`h-3.5 w-3.5 transition ${advancedOpen || advancedActive ? 'rotate-180' : ''}`} />
        </button>
        {(advancedOpen || advancedActive) && (
          <div className="grid grid-cols-2 gap-2 border-t border-white/10 p-2">
            {[
              ['care', 'Checkup'],
              ['graph', 'Graph view'],
              ['settings', 'AI keys'],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-lg px-3 py-2 text-xs ${tab === key ? 'bg-primary text-primary-foreground' : 'border border-white/10 text-muted-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onOpenHowTo}
        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-muted-foreground"
      >
        <FileText className="h-3.5 w-3.5" /> How to Use
      </button>
    </div>
  );
}
export default Dashboard;
