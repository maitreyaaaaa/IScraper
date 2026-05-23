import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Database,
  Download,
  EyeOff,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  GitBranch,
  Hash,
  KeyRound,
  LifeBuoy,
  Loader2,
  Lock,
  Mail,
  Pause,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  Upload,
  User,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';
import {
  approveReviewItem,
  deleteProviderCredential,
  downloadObsidianGraph,
  getItem,
  getItems,
  getKnowledgeGraph,
  getProfile,
  getPublicFeedback,
  getProviderCredentials,
  importInstagramExport,
  queueStorageImport,
  enrichIntentBatch,
  enrichItem,
  revealProviderCredential,
  saveLink,
  saveProfile,
  saveProviderCredential,
  searchItems,
  setApiAccessToken,
  submitPublicFeedback,
  testProviderCredential,
  updateReviewItem,
} from './api';
import { identifyPostHogUser, resetPostHogUser } from './posthog';
import { supabase } from './supabaseClient';

gsap.registerPlugin(ScrollTrigger);

const STATUS_META = {
  needs_review: { color: 'text-accent', icon: FileText },
  done: { color: 'text-primary', icon: CheckCircle2 },
  failed: { color: 'text-destructive', icon: AlertCircle },
  paused: { color: 'text-muted-foreground', icon: Pause },
  paused_needs_billing: { color: 'text-muted-foreground', icon: Pause },
  paused_api_limit: { color: 'text-muted-foreground', icon: Pause },
  paused_missing_provider: { color: 'text-muted-foreground', icon: Pause },
};

const INDEXING_META = {
  metadata_ready: { label: 'Metadata', color: 'text-muted-foreground', icon: FileText },
  text_indexed: { label: 'Text indexed', color: 'text-primary', icon: CheckCircle2 },
  visual_indexing: { label: 'Indexing', color: 'text-accent', icon: Loader2 },
  visual_indexed: { label: 'Visual indexed', color: 'text-primary', icon: Eye },
  deep_indexed: { label: 'Transcript ready', color: 'text-primary', icon: Sparkles },
  index_failed: { label: 'Metadata', color: 'text-destructive', icon: AlertCircle },
};
const ENRICHED_STAGES = new Set(['visual_indexed', 'deep_indexed']);
const STATUSES = ['all', 'needs_review', 'done', 'failed', 'paused'];
const FEEDBACK_FEATURE_OPTIONS = ['Search', 'Dashboard', 'Collections', 'AI summaries', 'Exporting', 'Mobile experience', 'Privacy', 'Other'];
const HERO_PLATFORMS = [
  { name: 'Instagram', src: '/platforms/instagram.svg', bg: 'transparent', scale: 1.08 },
  { name: 'X', src: '/platforms/x.svg', bg: '#fff' },
  { name: 'Facebook', src: '/platforms/facebook.svg', bg: '#1877f2' },
  { name: 'Pinterest', src: '/platforms/pinterest.svg', bg: '#e60023' },
  { name: 'TikTok', src: '/platforms/tiktok.svg', bg: '#000' },
  { name: 'YouTube', src: '/platforms/youtube.svg', bg: '#ff0033' },
];
const IMPORT_STORAGE_BUCKET = import.meta.env.VITE_SUPABASE_IMPORT_BUCKET || 'instagram-assets';
const VERCEL_SAFE_UPLOAD_BYTES = 4 * 1024 * 1024;
const EXPORT_UPLOAD_EXTENSIONS = new Set(['.html', '.htm', '.zip', '.json', '.csv']);
const INSTAGRAM_SAVED_EXPORT_RE = /(^|\/)your_instagram_activity\/saved\/saved_(posts|collections)\.(html|htm|json)$/i;
const INSTAGRAM_SAVED_FILE_RE = /^saved_(posts|collections)\.(html|htm|json)$/i;

function fileImportName(file) {
  return String(file?.webkitRelativePath || file?.name || '').replace(/\\/g, '/');
}

function fileExtension(name = '') {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? `.${match[1]}` : '';
}

function isInstagramSavedFile(file) {
  const name = fileImportName(file);
  const baseName = name.split('/').pop() || name;
  return INSTAGRAM_SAVED_EXPORT_RE.test(name) || INSTAGRAM_SAVED_FILE_RE.test(baseName) || fileExtension(name) === '.zip';
}

function importCandidateFiles(files = [], sourceType = 'auto') {
  const candidates = files.filter((file) => EXPORT_UPLOAD_EXTENSIONS.has(fileExtension(fileImportName(file) || file.name)));
  if (sourceType === 'instagram') return candidates.filter(isInstagramSavedFile);
  if (sourceType === 'pinterest') return candidates;

  const zipFiles = candidates.filter((file) => fileExtension(fileImportName(file) || file.name) === '.zip');
  if (zipFiles.length) return zipFiles;

  const instagramSavedFiles = candidates.filter(isInstagramSavedFile);
  return instagramSavedFiles.length ? instagramSavedFiles : candidates;
}

function validateExportFiles(files = [], sourceType = 'auto') {
  if (!files.length) throw new Error('Upload an Instagram ZIP/HTML/JSON file or your Pinterest export ZIP/JSON/CSV.');
  for (const file of files) {
    if (!EXPORT_UPLOAD_EXTENSIONS.has(fileExtension(fileImportName(file) || file.name))) {
      throw new Error('Upload Instagram HTML files or Pinterest ZIP/JSON/CSV exports. The selected file is missing a supported extension.');
    }
    if (!file.size) {
      throw new Error('The selected export file is empty. Re-export from Instagram or Pinterest, then upload the .html, .zip, .json, or .csv file.');
    }
  }
  if (sourceType === 'instagram' && !files.some(isInstagramSavedFile)) {
    throw new Error('For Instagram, upload the full export ZIP or the saved_posts/saved_collections HTML or JSON file from your_instagram_activity/saved/.');
  }
}

function shouldUseStorageUpload(files = []) {
  const totalBytes = files.reduce((total, file) => total + Number(file.size || 0), 0);
  return totalBytes > VERCEL_SAFE_UPLOAD_BYTES;
}

function safeStorageExtension(name = 'export') {
  const extension = fileExtension(name);
  return EXPORT_UPLOAD_EXTENSIONS.has(extension) ? extension : '.upload';
}

async function uploadImportFilesToStorage({ files, session }) {
  if (!supabase || !session?.user?.id) return null;
  const uploaded = [];
  const batchId = crypto.randomUUID();
  for (const file of files) {
    const originalName = fileImportName(file) || file.name;
    const storagePath = `${session.user.id}/imports/${batchId}/${crypto.randomUUID()}${safeStorageExtension(originalName)}`;
    const { error } = await supabase.storage
      .from(IMPORT_STORAGE_BUCKET)
      .upload(storagePath, file, {
        cacheControl: '3600',
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
    if (error) {
      const message = String(error.message || 'Supabase Storage upload failed.').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      throw new Error(message || 'Supabase Storage upload failed.');
    }
    uploaded.push({
      path: storagePath,
      name: originalName,
      type: file.type || '',
      size: file.size,
    });
  }
  return uploaded;
}

const KEY_SETUP_OPTIONS = {
  openrouter_all: {
    label: 'OpenRouter - recommended',
    shortLabel: 'OpenRouter',
    help: 'Best option. One OpenRouter key powers summaries, image/video reading, and smart search. Add $1-$3 credits in OpenRouter before indexing.',
    credentials: (options) => [
      {
        purpose: 'text',
        provider: 'openrouter',
        model: options?.defaultAppTextModel || 'deepseek/deepseek-v4-pro',
      },
      {
        purpose: 'media',
        provider: 'openrouter',
        model: options?.defaultAppMediaModel || 'google/gemini-3.1-flash-lite-preview',
      },
      {
        purpose: 'embedding',
        provider: 'openrouter',
        model: options?.defaultEmbeddingModel || 'openai/text-embedding-3-small',
      },
    ],
  },
  gemini: {
    label: 'Gemini API key',
    shortLabel: 'Gemini',
    help: 'Good for reading images/videos and basic summaries. It does not enable smart semantic search by itself.',
    credentials: (options) => [
      {
        purpose: 'text',
        provider: 'gemini',
        model: options?.textProviders?.gemini?.defaultModel || 'gemini-1.5-flash',
      },
      {
        purpose: 'media',
        provider: 'gemini',
        model: options?.mediaProviders?.gemini?.defaultModel || 'gemini-1.5-flash',
      },
    ],
  },
  openai: {
    label: 'OpenAI API key',
    shortLabel: 'OpenAI',
    help: 'Works for text summaries and tags only. Use OpenRouter if you want one simple setup for everything.',
    credentials: (options) => [
      {
        purpose: 'text',
        provider: 'openai',
        model: options?.textProviders?.openai?.defaultModel || 'gpt-4o-mini',
      },
    ],
  },
  anthropic: {
    label: 'Anthropic Claude key',
    shortLabel: 'Anthropic',
    help: 'Works for text summaries and tags only.',
    credentials: (options) => [
      {
        purpose: 'text',
        provider: 'anthropic',
        model: options?.textProviders?.anthropic?.defaultModel || 'claude-3-5-haiku-latest',
      },
    ],
  },
  deepseek: {
    label: 'DeepSeek key',
    shortLabel: 'DeepSeek',
    help: 'Works for text summaries and tags only.',
    credentials: (options) => [
      {
        purpose: 'text',
        provider: 'deepseek',
        model: options?.textProviders?.deepseek?.defaultModel || 'deepseek-chat',
      },
    ],
  },
};

const PROVIDER_DISPLAY_LABELS = {
  openrouter: 'OpenRouter',
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  glm: 'Z.ai',
};

function normalizeStatus(status = 'queued') {
  return String(status).startsWith('paused') ? 'paused' : status;
}

function normalizeIndexingStage(stage = 'metadata_ready') {
  return INDEXING_META[stage] ? stage : 'metadata_ready';
}

function shouldEnrichItem(item) {
  return item && item.sourceStatus !== 'needs_review' && !ENRICHED_STAGES.has(item.indexingStage) && item.indexingStage !== 'visual_indexing';
}

function mapItem(item) {
  const analysis = item.analysis || {};
  const indexingStage = normalizeIndexingStage(item.indexingStage);
  return {
    raw: item,
    id: item.id,
    user: item.ownerUsername ? `@${item.ownerUsername}` : item.ownerName || 'unknown',
    title: analysis.title || firstLine(item.caption) || 'Untitled saved item',
    caption: item.caption || '',
    summary: analysis.summary || item.caption || 'No summary yet.',
    transcript: analysis.transcript || '',
    ocr: analysis.ocrText || '',
    visual: analysis.visualDescription || '',
    tools: unique([...(analysis.toolsMentioned || []), ...(analysis.brandsMentioned || [])]),
    brands: analysis.brandsMentioned || [],
    people: analysis.peopleMentioned || [],
    repos: analysis.reposMentioned || [],
    topics: analysis.topics || [],
    tags: unique([...(analysis.tags || []), ...(item.hashtags || [])]),
    collection: item.collections?.[0] || 'Unsorted',
    platform: item.platform || 'Instagram',
    platformKey: item.platformKey || 'instagram',
    sourceId: item.sourceId || item.id,
    sourceTitle: item.sourceTitle || '',
    sourceAuthor: item.sourceAuthor || '',
    sourceDescription: item.sourceDescription || '',
    thumbnailUrl: item.thumbnailUrl || '',
    saved: item.savedAt || '',
    status: normalizeStatus(item.status || 'queued'),
    sourceStatus: item.status || 'queued',
    indexingStage,
    indexingLabel: INDEXING_META[indexingStage].label,
    indexingError: item.indexingError || '',
    url: item.url,
    why: analysis.whyUseful || '',
    error: item.error || '',
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function firstLine(value = '') {
  return String(value).split('\n').find(Boolean)?.slice(0, 90);
}

function BrandLogo({ className = 'h-8 w-28', align = 'left' }) {
  return <img src="/logo.png" alt="IScraper" className={`${className} object-contain ${align === 'center' ? 'object-center' : 'object-left'}`} />;
}

function scrollToSection(event, id) {
  event.preventDefault();
  scrollToLandingSection(id);
}

function scrollToLandingSection(id) {
  document.querySelector(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.history.replaceState(null, '', id);
}

function setManualScrollRestoration() {
  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }
}

function resetPageScroll() {
  setManualScrollRestoration();
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  document.querySelector('.dash-panel')?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

function replaceAppTabUrl(tab) {
  const params = new URLSearchParams(window.location.search);
  if (tab === 'library') {
    params.delete('tab');
  } else {
    params.set('tab', tab);
  }
  const query = params.toString();
  window.history.replaceState({}, ROUTE_TITLES.app, `/app${query ? `?${query}` : ''}`);
}

function RotatingPlatformLogo() {
  const [activeIndex, setActiveIndex] = useState(0);
  const logoRef = useRef(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return undefined;

    const timer = window.setInterval(() => {
      const target = logoRef.current;
      if (!target) {
        setActiveIndex((current) => (current + 1) % HERO_PLATFORMS.length);
        return;
      }

      gsap.timeline()
        .to(target, { yPercent: -115, autoAlpha: 0, duration: 0.35, ease: 'power2.in' })
        .add(() => setActiveIndex((current) => (current + 1) % HERO_PLATFORMS.length))
        .set(target, { yPercent: 115 })
        .to(target, { yPercent: 0, autoAlpha: 1, duration: 0.45, ease: 'power3.out' });
    }, 1600);

    return () => window.clearInterval(timer);
  }, []);

  const platform = HERO_PLATFORMS[activeIndex];

  return (
    <span className="hero-platform-ticker ml-[0.12em] inline-grid translate-y-[0.08em] overflow-hidden rounded-full align-baseline">
      <span
        ref={logoRef}
        className="inline-flex h-[0.86em] w-[0.86em] items-center justify-center rounded-full shadow-[0_0_36px_rgba(255,106,0,0.24)]"
        style={{ background: platform.bg }}
        aria-label={platform.name}
      >
        <img
          src={platform.src}
          alt=""
          className="h-[0.56em] w-[0.56em] object-contain"
          style={{ transform: `scale(${platform.scale || 1})` }}
          draggable="false"
        />
      </span>
    </span>
  );
}

const ROUTE_PATHS = {
  landing: '/',
  app: '/app',
  login: '/login',
  'how-to-use': '/how-to-use',
  terms: '/terms',
  privacy: '/privacy',
  help: '/help',
  security: '/security',
  'data-deletion': '/data-deletion',
  cookies: '/cookies',
};

const ROUTE_TITLES = {
  landing: 'IScraper',
  app: 'IScraper App',
  login: 'Log in to IScraper',
  'how-to-use': 'How to Use IScraper',
  terms: 'IScraper Terms',
  privacy: 'IScraper Privacy',
  help: 'IScraper Help',
  security: 'IScraper Security',
  'data-deletion': 'Delete IScraper Data',
  cookies: 'IScraper Cookies',
};

function legacyRouteFromHash() {
  const hash = window.location.hash || '';
  if (hash === '#app' || hash.startsWith('#app?')) return 'app';
  if (window.location.hash === '#login') return 'login';
  if (window.location.hash === '#how-to-use') return 'how-to-use';
  if (window.location.hash === '#terms') return 'terms';
  if (window.location.hash === '#privacy') return 'privacy';
  if (window.location.hash === '#help') return 'help';
  if (window.location.hash === '#security') return 'security';
  if (window.location.hash === '#data-deletion') return 'data-deletion';
  if (window.location.hash === '#cookies') return 'cookies';
  return 'landing';
}

function getRouteFromLocation() {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  if (path === 'auth/callback') return 'app';
  if (!path) return legacyRouteFromHash();
  return Object.keys(ROUTE_PATHS).find((route) => route !== 'landing' && route === path) || 'landing';
}

function canonicalizeUnknownPath() {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  if (!path || path === 'auth/callback') return;
  const isKnownPath = Object.keys(ROUTE_PATHS).some((route) => route !== 'landing' && route === path);
  if (!isKnownPath) {
    window.history.replaceState({}, ROUTE_TITLES.landing, '/');
  }
}

function appParamsFromLocation() {
  if (window.location.pathname.replace(/\/+$/g, '') === '/app') return new URLSearchParams(window.location.search);
  const hash = window.location.hash || '';
  if (hash.startsWith('#app?')) return new URLSearchParams(hash.slice('#app?'.length));
  return new URLSearchParams();
}

function canonicalizeLegacyHashRoute() {
  const hash = window.location.hash || '';
  if (!hash.startsWith('#')) return;
  const route = legacyRouteFromHash();
  if (route === 'landing') return;
  const query = hash.startsWith('#app?') ? `?${hash.slice('#app?'.length)}` : '';
  window.history.replaceState({}, ROUTE_TITLES[route], `${ROUTE_PATHS[route]}${query}`);
}

function pendingSaveFromLocation() {
  const params = appParamsFromLocation();
  const url = params.get('url') || params.get('saveUrl');
  if (!url) return null;
  return {
    url,
    title: params.get('title') || '',
    description: params.get('description') || '',
    platform: params.get('platform') || '',
    note: params.get('note') || '',
    autoSave: params.get('autoSave') === '1',
  };
}

function itemIdFromLocation() {
  return appParamsFromLocation().get('item') || '';
}

function dashboardTabFromLocation() {
  const tab = appParamsFromLocation().get('tab');
  return ['library', 'graph', 'upload', 'settings'].includes(tab) ? tab : 'library';
}

function cleanAuthCallbackUrl() {
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of ['code', 'state', 'error', 'error_code', 'error_description']) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (url.pathname === '/auth/callback') {
    url.pathname = '/app';
    url.hash = '';
    changed = true;
  }
  if (changed) {
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
  }
}

async function startGoogleSignIn() {
  if (!supabase) throw new Error('Login is not configured yet.');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/app`,
      queryParams: {
        prompt: 'select_account',
      },
    },
  });
  if (error) throw error;
}

async function sendEmailOtp(email) {
  if (!supabase) throw new Error('Login is not configured yet.');
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${window.location.origin}/app`,
    },
  });
  if (error) throw error;
}

async function verifyEmailOtp(email, token) {
  if (!supabase) throw new Error('Login is not configured yet.');
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });
  if (error) throw error;
  return data;
}

function keyValidationMessage(setup, apiKey) {
  const value = String(apiKey || '').trim();
  if (!value) return 'Paste your API key first.';
  if (setup === 'openrouter_all' && !value.startsWith('sk-or-')) return 'This does not look like an OpenRouter key. OpenRouter keys usually start with sk-or-.';
  if (setup === 'gemini' && !value.startsWith('AIza')) return 'This does not look like a Gemini API key. Gemini keys usually start with AIza.';
  if (setup === 'anthropic' && !value.startsWith('sk-ant-')) return 'This does not look like an Anthropic key. Anthropic keys usually start with sk-ant-.';
  if ((setup === 'openai' || setup === 'deepseek') && !value.startsWith('sk-')) return 'This does not look like the right key. This provider usually gives keys starting with sk-.';
  return '';
}

function avatarUrlForSession(session, profile) {
  return profile?.avatarUrl || session?.user?.user_metadata?.avatar_url || session?.user?.user_metadata?.picture || '';
}

function initialForSession(session, profile) {
  return String(profile?.username || session?.user?.user_metadata?.name || session?.user?.email || 'U').trim().charAt(0).toUpperCase();
}

function groupProviderCredentials(credentials = []) {
  return credentials.reduce((groups, credential) => {
    const key = `${credential.provider}:${credential.keyHint}`;
    if (!groups[key]) {
      groups[key] = {
        id: key,
        provider: credential.provider,
        keyHint: credential.keyHint,
        credentials: [],
      };
    }
    groups[key].credentials.push(credential);
    return groups;
  }, {});
}

function rememberPendingSave() {
  const pending = pendingSaveFromLocation();
  if (!pending) return;
  window.localStorage.setItem('iscraper.pendingSaveLink', JSON.stringify(pending));
}

export default function App() {
  const [route, setRoute] = useState(() => {
    rememberPendingSave();
    return getRouteFromLocation();
  });

  const navigate = useCallback((nextRoute) => {
    const routeName = ROUTE_PATHS[nextRoute] ? nextRoute : 'landing';
    setRoute(routeName);
    window.history.pushState({}, ROUTE_TITLES[routeName], ROUTE_PATHS[routeName]);
    document.title = ROUTE_TITLES[routeName];
    resetPageScroll();
  }, []);

  useLayoutEffect(() => {
    resetPageScroll();
    const frame = window.requestAnimationFrame(resetPageScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [route]);

  useEffect(() => {
    document.title = ROUTE_TITLES[route] || 'IScraper';
  }, [route]);

  useEffect(() => {
    const onRouteChange = () => {
      rememberPendingSave();
      const nextRoute = getRouteFromLocation();
      setRoute(nextRoute);
      canonicalizeLegacyHashRoute();
      canonicalizeUnknownPath();
    };
    canonicalizeLegacyHashRoute();
    canonicalizeUnknownPath();
    window.addEventListener('popstate', onRouteChange);
    window.addEventListener('hashchange', onRouteChange);
    return () => {
      window.removeEventListener('popstate', onRouteChange);
      window.removeEventListener('hashchange', onRouteChange);
    };
  }, []);

  if (route === 'app') return <Dashboard onBack={() => navigate('landing')} onOpenLogin={() => navigate('login')} onOpenHowTo={() => navigate('how-to-use')} />;
  if (route === 'login') return <LoginPage onBack={() => navigate('landing')} onOpenApp={() => navigate('app')} />;
  if (route === 'how-to-use') return <HowToUsePage onBack={() => navigate('landing')} onOpenApp={() => navigate('app')} />;
  if (route === 'terms') return <LegalPage type="terms" onBack={() => navigate('landing')} />;
  if (route === 'privacy') return <LegalPage type="privacy" onBack={() => navigate('landing')} />;
  if (route === 'security') return <LegalPage type="security" onBack={() => navigate('landing')} />;
  if (route === 'data-deletion') return <LegalPage type="dataDeletion" onBack={() => navigate('landing')} />;
  if (route === 'cookies') return <LegalPage type="cookies" onBack={() => navigate('landing')} />;
  if (route === 'help') return <HelpCenterPage onBack={() => navigate('landing')} onOpenApp={() => navigate('app')} onOpenHowTo={() => navigate('how-to-use')} />;
  return (
    <Landing
      onOpenApp={() => navigate('app')}
      onOpenLogin={() => navigate('login')}
      onOpenHowTo={() => navigate('how-to-use')}
      onOpenTerms={() => navigate('terms')}
      onOpenPrivacy={() => navigate('privacy')}
      onOpenHelp={() => navigate('help')}
      onOpenSecurity={() => navigate('security')}
      onOpenDataDeletion={() => navigate('data-deletion')}
      onOpenCookies={() => navigate('cookies')}
    />
  );
}

function LoginPage({ onBack, onOpenApp }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileRequired, setProfileRequired] = useState(false);
  const [profileForm, setProfileForm] = useState({ username: '', avatarUrl: '' });
  const [emailForm, setEmailForm] = useState({ email: '', code: '' });
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState('');

  const applyProfileState = useCallback((nextProfile, required) => {
    setProfile(nextProfile || null);
    setProfileRequired(Boolean(required));
    if (nextProfile) {
      setProfileForm({
        username: nextProfile.username || '',
        avatarUrl: nextProfile.avatarUrl || '',
      });
    }
  }, []);

  const loadProfile = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    setApiAccessToken(data.session?.access_token);
    if (!data.session) {
      resetPostHogUser();
      return;
    }
    const profileBody = await getProfile();
    applyProfileState(profileBody.profile, profileBody.required);
    identifyPostHogUser(data.session, profileBody.profile);
    cleanAuthCallbackUrl();
  }, [applyProfileState]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(loadProfile)
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    if (!supabase) return () => {
      cancelled = true;
    };

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setApiAccessToken(nextSession?.access_token);
      if (nextSession) {
        loadProfile().catch((err) => setError(err.message));
      } else {
        setProfile(null);
        setProfileRequired(false);
        resetPostHogUser();
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const handleGoogleSignIn = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await startGoogleSignIn();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const handleSendEmailCode = async (event) => {
    event.preventDefault();
    const email = emailForm.email.trim().toLowerCase();
    if (!email) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await sendEmailOtp(email);
      setEmailForm((current) => ({ ...current, email, code: '' }));
      setEmailCodeSent(true);
      setNotice('Code sent. Check your email and paste the code here.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyEmailCode = async (event) => {
    event.preventDefault();
    const email = emailForm.email.trim().toLowerCase();
    const code = emailForm.code.trim();
    if (!email || !code) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await verifyEmailOtp(email, code);
      setSession(data.session || null);
      setApiAccessToken(data.session?.access_token);
      await loadProfile();
      setNotice('Signed in.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

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
    try {
      const body = await saveProfile(profileForm);
      applyProfileState(body.profile, false);
      identifyPostHogUser(session, body.profile);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    ['1', 'Sign in', 'Use Google or email code. Use the same login every time.'],
    ['2', 'Choose a username', 'This keeps your private library tied to your account.'],
    ['3', 'Import your saves', 'Upload Instagram ZIP/HTML/JSON or Pinterest export files from the Add saves page.'],
  ];

  return (
    <div className="min-h-screen bg-black text-foreground">
      <div className="grid-bg radial-fade pointer-events-none fixed inset-0 opacity-35" />
      <header className="relative z-10 border-b border-white/10 bg-black/85 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <button type="button" onClick={onBack} className="flex items-center gap-3 transition hover:opacity-80">
            <ArrowLeft className="h-5 w-5 text-muted-foreground" />
            <BrandLogo className="h-12 w-40" />
          </button>
          <button type="button" onClick={onOpenApp} className="rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-white/5">
            Open app
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid min-h-[calc(100vh-5rem)] max-w-7xl items-center gap-10 px-5 py-14 lg:grid-cols-[1fr_0.82fr]">
        <section>
          <div className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Account access</div>
          <h1 className="mt-4 max-w-3xl font-display text-5xl font-bold tracking-tighter md:text-7xl">
            Sign in before you import.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
            You can visit IScraper without logging in, but your saved library, imports, API keys, graph, and indexing are private account features.
          </p>
          <div className="mt-10 grid gap-3">
            {steps.map(([number, title, copy]) => (
              <div key={title} className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary font-display text-lg font-bold text-primary-foreground">{number}</span>
                <div>
                  <h2 className="font-display text-xl font-bold tracking-tight">{title}</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="glow-ring rounded-[2rem] border border-white/10 bg-black p-6 shadow-2xl shadow-black/50 md:p-8">
          {loading ? (
            <div className="grid min-h-80 place-items-center text-muted-foreground">Checking login...</div>
          ) : !supabase ? (
            <div>
              <Lock className="h-8 w-8 text-primary" />
              <h2 className="mt-5 font-display text-3xl font-bold tracking-tight">Login is not configured locally.</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">Production uses Supabase login. Open the app to continue in local mode.</p>
              <button type="button" onClick={onOpenApp} className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground">
                Open app
              </button>
            </div>
          ) : !session ? (
            <div>
              <Lock className="h-8 w-8 text-primary" />
              <h2 className="mt-5 font-display text-3xl font-bold tracking-tight">Welcome back.</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">Sign in to open your private IScraper library.</p>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={busy}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Continue with Google
              </button>
              <div className="my-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-white/10" />
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">or use email</span>
                <span className="h-px flex-1 bg-white/10" />
              </div>
              <form onSubmit={emailCodeSent ? handleVerifyEmailCode : handleSendEmailCode} className="space-y-3">
                <label className="block font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Email</label>
                <input
                  type="email"
                  value={emailForm.email}
                  onChange={(event) => setEmailForm((current) => ({ ...current, email: event.target.value }))}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
                  required
                />
                {emailCodeSent && (
                  <>
                    <label className="block font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Code</label>
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={emailForm.code}
                      onChange={(event) => setEmailForm((current) => ({ ...current, code: event.target.value.replace(/\s/g, '') }))}
                      placeholder="Paste the code from your email"
                      className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 font-mono outline-none focus:border-primary"
                      required
                    />
                  </>
                )}
                <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 font-semibold text-foreground transition hover:bg-white/5 disabled:opacity-60">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  {emailCodeSent ? 'Verify code' : 'Send code'}
                </button>
                {emailCodeSent && (
                  <button
                    type="button"
                    onClick={handleSendEmailCode}
                    disabled={busy}
                    className="w-full text-center text-xs font-semibold text-primary transition hover:text-primary/80 disabled:opacity-60"
                  >
                    Resend code
                  </button>
                )}
              </form>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">By continuing, you agree to the Terms of Service and Privacy Policy.</p>
            </div>
          ) : profileRequired ? (
            <form onSubmit={handleProfileSave}>
              <h2 className="font-display text-3xl font-bold tracking-tight">Choose your username</h2>
              <p className="mt-2 text-sm text-muted-foreground">One last step before importing. Usernames are unique.</p>
              <label className="mt-6 block font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Username</label>
              <input
                value={profileForm.username}
                onChange={(event) => setProfileForm((current) => ({ ...current, username: event.target.value.toLowerCase() }))}
                placeholder="your_username"
                pattern="[a-z0-9_]{3,24}"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
                required
              />
              <label className="mt-5 block font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Profile picture optional</label>
              <div className="mt-2 flex items-center gap-3">
                <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border border-white/10 bg-white/5">
                  {profileForm.avatarUrl ? <img src={profileForm.avatarUrl} alt="" className="h-full w-full object-cover" /> : <Brain className="h-5 w-5 text-muted-foreground" />}
                </div>
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAvatarFile} className="min-w-0 text-xs text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary-foreground" />
              </div>
              <button disabled={busy} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save profile
              </button>
            </form>
          ) : (
            <div>
              <CheckCircle2 className="h-9 w-9 text-primary" />
              <h2 className="mt-5 font-display text-3xl font-bold tracking-tight">You are signed in.</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {profile?.username ? `Signed in as @${profile.username}.` : 'Your session is ready.'}
              </p>
              <button type="button" onClick={onOpenApp} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground">
                Go to library <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
          {notice && <Banner>{notice}</Banner>}
          {error && <Banner type="error">{error}</Banner>}
        </section>
      </main>
    </div>
  );
}

function Landing({ onOpenApp, onOpenLogin, onOpenHowTo, onOpenTerms, onOpenPrivacy, onOpenHelp, onOpenSecurity, onOpenDataDeletion, onOpenCookies }) {
  const root = useRef(null);
  const introRef = useRef(null);
  const cursorRef = useRef(null);
  const heroTitle = useRef(null);
  const [launchOfferDismissed, setLaunchOfferDismissed] = useState(() => window.localStorage.getItem('iscraper.launchOffer.dismissed') === '1');
  const [feedback, setFeedback] = useState([]);
  const [feedbackForm, setFeedbackForm] = useState({ feature: 'Search', message: '' });
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState('');
  const [landingSession, setLandingSession] = useState(null);
  const [landingProfile, setLandingProfile] = useState(null);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const landingAvatarUrl = avatarUrlForSession(landingSession, landingProfile);
  const landingInitial = initialForSession(landingSession, landingProfile);

  useEffect(() => {
    resetPageScroll();
  }, []);

  useEffect(() => {
    if (!supabase) return undefined;
    let cancelled = false;

    const syncSession = async (session) => {
      if (cancelled) return;
      setLandingSession(session || null);
      setApiAccessToken(session?.access_token);
      if (!session) {
        setLandingProfile(null);
        resetPostHogUser();
        return;
      }
      try {
        const body = await getProfile();
        if (!cancelled) {
          setLandingProfile(body.profile || null);
          identifyPostHogUser(session, body.profile);
        }
      } catch {
        if (!cancelled) {
          setLandingProfile(null);
          identifyPostHogUser(session, null);
        }
      }
    };

    supabase.auth.getSession().then(({ data }) => syncSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      syncSession(session);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    getPublicFeedback()
      .then((body) => setFeedback(body.feedback || []))
      .catch(() => setFeedback([]));
  }, []);

  const dismissLaunchOffer = () => {
    window.localStorage.setItem('iscraper.launchOffer.dismissed', '1');
    setLaunchOfferDismissed(true);
  };

  const handleFeedbackSubmit = async (event) => {
    event.preventDefault();
    setFeedbackBusy(true);
    setFeedbackNotice('');
    try {
      const body = await submitPublicFeedback(feedbackForm);
      setFeedback((current) => [body.feedback, ...current]);
      setFeedbackForm((current) => ({ ...current, message: '' }));
      setFeedbackNotice('Added anonymously. Everyone can see the idea, not who wrote it.');
    } catch (error) {
      setFeedbackNotice(error.message);
    } finally {
      setFeedbackBusy(false);
    }
  };

  useEffect(() => {
    const cursor = cursorRef.current;
    if (!cursor) return undefined;
    const move = (event) => {
      gsap.to(cursor, { x: event.clientX, y: event.clientY, duration: 0.25, ease: 'power3.out' });
    };
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, []);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      const words = heroTitle.current?.querySelectorAll('.word');
      const intro = introRef.current;

      mm.add(
        {
          reduceMotion: '(prefers-reduced-motion: reduce)',
          desktop: '(min-width: 900px)',
        },
        (context) => {
          const { reduceMotion, desktop } = context.conditions;

          if (reduceMotion) {
            gsap.set(intro, { autoAlpha: 0, display: 'none' });
            gsap.set(['.hero-fade', '.nav-item', '[data-reveal]', '.step-card', '[data-index-tile]', '.feedback-card'], {
              autoAlpha: 1,
              y: 0,
              scale: 1,
              clearProps: 'transform,opacity,visibility',
            });
            return;
          }

          if (intro) {
            gsap.timeline({ defaults: { ease: 'power3.out' } })
              .set(intro, { yPercent: 0, autoAlpha: 1 })
              .fromTo('.intro-logo', { autoAlpha: 0, scale: 0.92, y: 10 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.55 })
              .to('.intro-logo', { scale: 1.04, duration: 0.45, ease: 'power1.inOut' })
              .to(intro, { yPercent: -100, duration: 1, ease: 'expo.inOut' }, '+=0.15')
              .set(intro, { display: 'none' });
          }

          gsap.from(words || [], {
            yPercent: 110,
            rotate: 6,
            duration: 1.1,
            ease: 'expo.out',
            stagger: 0.08,
            delay: intro ? 1.3 : 0.15,
          });

          gsap.from('.hero-fade', {
            autoAlpha: 0,
            y: 24,
            duration: 1,
            ease: 'power3.out',
            stagger: 0.1,
            delay: intro ? 1.75 : 0.6,
          });

          gsap.to('.parallax-grid', {
            yPercent: desktop ? 12 : 5,
            ease: 'none',
            scrollTrigger: {
              trigger: '.landing-hero',
              start: 'top top',
              end: 'bottom top',
              scrub: 1,
            },
          });

          gsap.to('.parallax-glow-primary', {
            yPercent: desktop ? 28 : 12,
            xPercent: desktop ? 8 : 2,
            ease: 'none',
            scrollTrigger: {
              trigger: '.landing-hero',
              start: 'top top',
              end: 'bottom top',
              scrub: 1.2,
            },
          });

          gsap.to('.parallax-glow-secondary', {
            yPercent: desktop ? -18 : -8,
            xPercent: desktop ? -10 : -3,
            ease: 'none',
            scrollTrigger: {
              trigger: '.landing-hero',
              start: 'top top',
              end: 'bottom top',
              scrub: 1.4,
            },
          });

          gsap.to('.hero-content', {
            yPercent: desktop ? -8 : -3,
            ease: 'none',
            scrollTrigger: {
              trigger: '.landing-hero',
              start: 'top top',
              end: 'bottom top',
              scrub: 1,
            },
          });

          gsap.utils.toArray('[data-reveal]').forEach((el) => {
            gsap.from(el, {
              autoAlpha: 0,
              y: 56,
              duration: 0.9,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: el,
                start: 'top 82%',
                toggleActions: 'play none none reverse',
              },
            });
          });

          gsap.set('.step-card', { autoAlpha: 0, y: 72, scale: 0.96 });
          ScrollTrigger.batch('.step-card', {
            start: 'top 84%',
            once: true,
            onEnter: (batch) => {
              gsap.to(batch, {
                autoAlpha: 1,
                y: 0,
                scale: 1,
                duration: 0.8,
                ease: 'power3.out',
                stagger: 0.12,
                overwrite: true,
              });
            },
          });

          gsap.set('[data-index-tile]', { autoAlpha: 0, y: 44, scale: 0.96 });
          gsap.from('.index-heading', {
            autoAlpha: 0,
            y: 40,
            duration: 0.85,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: '.index-section',
              start: 'top 76%',
              toggleActions: 'play none none none',
            },
          });

          ScrollTrigger.batch('[data-index-tile]', {
            start: 'top 86%',
            once: true,
            interval: 0.08,
            batchMax: desktop ? 4 : 2,
            onEnter: (batch) => {
              gsap.to(batch, {
              autoAlpha: 1,
              y: 0,
              scale: 1,
              duration: 0.75,
              ease: 'power3.out',
                stagger: 0.08,
                overwrite: true,
              });
            },
          });

          gsap.from('.feedback-card', {
            autoAlpha: 0,
            y: 30,
            duration: 0.65,
            ease: 'power3.out',
            stagger: 0.08,
            scrollTrigger: {
              trigger: '#feedback',
              start: 'top 70%',
              toggleActions: 'play none none reverse',
            },
          });

          gsap.to('.cta-bg', {
            yPercent: -12,
            ease: 'none',
            scrollTrigger: {
              trigger: '.cta-section',
              start: 'top bottom',
              end: 'bottom top',
              scrub: 1,
            },
          });

          window.setTimeout(() => ScrollTrigger.refresh(), 250);
        });

      return () => mm.revert();
    }, root);
    return () => ctx.revert();
  }, []);

  const heroWords = ['Never', 'Lose', 'a', 'Post', 'Saved', 'on'];

  return (
    <div ref={root} className="relative bg-black text-foreground overflow-x-hidden">
      <div ref={introRef} className="fixed inset-0 z-[200] hidden place-items-center bg-black md:grid">
        <BrandLogo align="center" className="intro-logo h-24 w-80 opacity-0 md:h-32 md:w-[28rem]" />
      </div>

      <div
        ref={cursorRef}
        className="pointer-events-none fixed left-0 top-0 z-[100] hidden h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary mix-blend-difference md:block"
      />

      {!launchOfferDismissed && (
        <div className="fixed left-0 right-0 top-0 z-[70] bg-orange-500 px-4 py-2 text-black shadow-[0_14px_40px_rgba(249,115,22,0.28)]">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <span className="shrink-0 rounded-full bg-black px-3 py-1 font-mono text-[11px] font-black uppercase tracking-[0.16em] text-orange-500">
              Launch offer
            </span>
            <p className="min-w-0 flex-1 truncate text-base font-bold text-black">
              <span>Your first 200 imported saves are on us.</span>
              <span className="hidden font-semibold text-black/80 sm:inline"> Build your first searchable library before paying IScraper credits.</span>
            </p>
            <button
              type="button"
              onClick={dismissLaunchOffer}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-black/15 text-black transition hover:bg-black hover:text-orange-500"
              aria-label="Dismiss launch offer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <header className={`pointer-events-none fixed left-0 right-0 z-50 px-4 transition-[top] ${launchOfferDismissed ? 'top-4' : 'top-[4.15rem]'}`}>
        <div className="mx-auto grid max-w-7xl grid-cols-[auto_1fr_auto] items-center gap-4">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="nav-item pointer-events-auto flex items-center"
          >
            <BrandLogo className="h-16 w-52 md:h-20 md:w-64" />
          </button>
          <nav className="pointer-events-auto hidden justify-self-center rounded-full border border-white/10 bg-black/75 p-1 text-sm font-semibold text-muted-foreground shadow-[0_18px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl md:flex">
            <a href="#features" onClick={(event) => scrollToSection(event, '#features')} className="nav-item rounded-full px-4 py-2 transition hover:bg-orange-500 hover:text-black">Features</a>
            <a href="#extension" onClick={(event) => scrollToSection(event, '#extension')} className="nav-item rounded-full px-4 py-2 transition hover:bg-orange-500 hover:text-black">Extension</a>
            <a href="#why" onClick={(event) => scrollToSection(event, '#why')} className="nav-item rounded-full px-4 py-2 transition hover:bg-orange-500 hover:text-black">Why</a>
            <a href="#feedback" onClick={(event) => scrollToSection(event, '#feedback')} className="nav-item rounded-full px-4 py-2 transition hover:bg-orange-500 hover:text-black">Feedback</a>
            <button type="button" onClick={onOpenHowTo} className="nav-item rounded-full px-4 py-2 transition hover:bg-orange-500 hover:text-black">How to Use</button>
          </nav>
          <div className="nav-item pointer-events-auto flex items-center gap-2 justify-self-end">
            {landingSession ? (
              <button
                type="button"
                onClick={() => setAccountSettingsOpen(true)}
                className="inline-flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-black/75 text-sm font-bold text-foreground shadow-[0_16px_55px_rgba(0,0,0,0.22)] backdrop-blur transition hover:scale-[1.04] hover:bg-white/10"
                aria-label="Open account settings"
                title={landingProfile?.username ? `@${landingProfile.username}` : 'Open account settings'}
              >
                {landingAvatarUrl ? (
                  <img src={landingAvatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="grid h-full w-full place-items-center bg-primary text-primary-foreground">{landingInitial}</span>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenLogin}
                className="inline-flex rounded-full border border-white/15 bg-black/75 px-4 py-2 text-sm font-bold text-foreground shadow-[0_16px_55px_rgba(0,0,0,0.22)] backdrop-blur transition hover:bg-white/10"
              >
                Log in
              </button>
            )}
            <button
              type="button"
              onClick={onOpenApp}
              className="group hidden items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-[0_16px_55px_rgba(164,255,18,0.22)] transition hover:scale-[1.03] sm:inline-flex"
            >
              Open library <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </button>
          </div>
        </div>
      </header>

      {accountSettingsOpen && (
        <AccountSettingsModal
          open
          onClose={() => setAccountSettingsOpen(false)}
          session={landingSession}
          profile={landingProfile}
          onProfileSaved={(nextProfile) => setLandingProfile(nextProfile)}
        />
      )}

      <section className={`landing-hero relative flex min-h-screen items-center overflow-hidden bg-black ${launchOfferDismissed ? 'pt-28 md:pt-36' : 'pt-40 md:pt-48'}`}>
        <div className="parallax-grid radial-fade grid-bg absolute inset-0 opacity-60" />
        <div
          className="parallax-glow-primary absolute -left-20 -top-32 h-[480px] w-[480px] rounded-full opacity-40 blur-[120px]"
          style={{ background: 'radial-gradient(circle, var(--glow) 0%, transparent 70%)' }}
        />
        <div
          className="parallax-glow-secondary absolute right-0 top-40 h-[520px] w-[520px] rounded-full opacity-30 blur-[140px]"
          style={{ background: 'radial-gradient(circle, var(--glow-2) 0%, transparent 70%)' }}
        />

        <div className="hero-content relative mx-auto w-full max-w-[100rem] overflow-visible px-6 md:px-10 md:pr-20 xl:px-14 xl:pr-24">
          <h1
            ref={heroTitle}
            className="overflow-visible text-balance font-display text-[clamp(3rem,10.5vw,11rem)] font-bold leading-[0.95] tracking-tighter"
          >
            {heroWords.map((word, index) => (
              <span key={word} className="mr-[0.18em] inline-block overflow-visible last:mr-0">
                <span className={`word inline-block ${word === 'Lose' ? 'relative isolate' : ''} ${word === 'Post' ? 'rounded-[5px] bg-orange-500 px-[0.08em] italic text-black' : ''}`}>
                  {word === 'Lose' && (
                    <img
                      src="/hero/lose-circle.png"
                      alt=""
                      className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[1.2em] max-w-none -translate-x-1/2 -translate-y-[45%] rotate-[-5deg] opacity-95"
                      draggable="false"
                    />
                  )}
                  <span className={word === 'Lose' ? 'relative z-10' : ''}>{word}</span>
                </span>
                {index === heroWords.length - 1 && <RotatingPlatformLogo />}
              </span>
            ))}
          </h1>

          <div className="mt-12 flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
            <p className="hero-fade max-w-xl text-lg leading-relaxed text-muted-foreground">
              Recipes, outfits, workouts, trips, products, creators, ideas. Save links from any platform and turn the posts you already saved into a private library you can actually search.
            </p>
            <div className="hero-fade flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={onOpenLogin}
                className="glow-ring group inline-flex items-center gap-3 rounded-full bg-primary px-7 py-4 text-base font-semibold text-primary-foreground transition hover:scale-[1.03]"
              >
                Log in <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
              </button>
              <button type="button" onClick={onOpenApp} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-4 text-sm transition hover:bg-white/5">
                Visit library
              </button>
              <button type="button" onClick={onOpenHowTo} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-4 text-sm transition hover:bg-white/5">
                <FileText className="h-4 w-4" /> How to use
              </button>
            </div>
          </div>

          <div className="hero-fade mt-24 grid grid-cols-2 gap-6 text-sm md:grid-cols-4">
            {[
              ['Saved ideas rescued', 'All'],
              ['Platforms supported', 'Any'],
              ['First saves on us', '200'],
              ['Search in seconds', 'Fast'],
            ].map(([label, value]) => (
              <div key={label} className="border-l border-white/10 pl-4">
                <div className="font-display text-4xl font-bold tabular-nums">{value}</div>
                <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </div>

      </section>

      <section className="relative overflow-hidden border-y border-white/5 bg-black py-8">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-black to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-black to-transparent" />
        <div className="marquee flex gap-12 whitespace-nowrap font-display text-5xl font-bold tracking-tighter md:text-7xl">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="flex gap-12">
              {['pinterest', 'twitter', 'youtube', 'tiktok', 'instagram', 'recipes', 'outfits', 'travel', 'products', 'ideas'].map((label) => (
                <span key={`${index}-${label}`} className="text-foreground/20 transition hover:text-primary">
                  {label} <span className="text-primary">✦</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="feature-section relative overflow-hidden bg-black px-6 py-24 md:py-32">
        <div className="pointer-events-none absolute left-1/2 top-10 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />
        <div className="mx-auto max-w-7xl">
          <div data-reveal className="mb-16 flex flex-wrap items-end justify-between gap-8">
            <div>
              <div className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">/ 01 - Why it helps</div>
              <h2 className="max-w-3xl font-display text-5xl font-bold tracking-tighter md:text-7xl">
                Your saves finally <span className="italic text-primary">work for you</span>.
              </h2>
            </div>
            <p className="max-w-md text-muted-foreground">Stop relying on Instagram's endless saved folder. Find the exact thing when you need it.</p>
          </div>

          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {[
              [Zap, 'Save from any platform', 'Paste a link from Pinterest, X, TikTok, YouTube, Instagram, or any site and keep it in the same searchable brain.'],
              [Brain, 'Know why you saved it', 'Each save can get a plain-English summary, so old posts become useful again instead of forgotten.'],
              [CheckCircle2, 'First 200 saves included', 'Start with 200 imported saves covered by IScraper before paid credits matter. No API key needed for that first allowance.'],
              [Tag, 'Organized without the cleanup', 'Group saves by themes like travel, food, fitness, shopping, home, business, or inspiration.'],
              [Lock, 'Private by default', 'Your saved export starts on your machine, so your personal taste and plans stay yours.'],
              [ShieldCheck, 'Built around official export', 'Use Instagram export files to build your library without handing over your Instagram login.'],
              [KeyRound, 'Browser extension coming soon', 'The extension will let you send the current tab into IScraper after the browser store release.'],
            ].map(([Icon, title, description], index) => (
              <div
                key={title}
                className="step-card group relative min-h-56 overflow-hidden rounded-2xl border border-white/10 bg-black/80 p-7 transition-all hover:-translate-y-1 hover:border-primary/60"
              >
                <div
                  className="absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-0 blur-3xl transition-opacity group-hover:opacity-100"
                  style={{ background: index % 2 ? 'var(--glow-2)' : 'var(--glow)' }}
                />
                <div className="relative">
                  <Icon className="mb-8 h-6 w-6 text-primary" />
                  <h3 className="mb-3 font-display text-2xl font-semibold tracking-tight">{title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="extension" className="relative border-y border-white/10 bg-black px-6 py-24 md:py-32">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div data-reveal>
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">/ 02 - Browser extension - coming soon</div>
            <h2 className="max-w-4xl font-display text-5xl font-bold tracking-tighter md:text-7xl">
              Extension support is coming soon.
            </h2>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              The IScraper extension is not available for users yet. When the browser-store listing is approved, it will let you save pages and run Lens search from your browser.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-full bg-primary px-6 py-4 text-sm font-semibold text-primary-foreground opacity-70"
              >
                Coming soon
              </button>
              <button
                type="button"
                onClick={onOpenHowTo}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-4 text-sm transition hover:bg-white/5"
              >
                <FileText className="h-4 w-4" /> How to use
              </button>
            </div>
            <p className="mt-5 text-sm leading-6 text-muted-foreground">
              Planned for Chromium browsers like Chrome, Edge, Brave, Arc, and Opera after store approval.
            </p>
          </div>

          <div data-reveal className="grid gap-4 sm:grid-cols-2">
            {[
              [KeyRound, 'Limited token - coming soon', 'The planned extension will use a revokable Lens token, not your main login.'],
              [Search, 'Selected text search - coming soon', 'You will be able to highlight text on a page and search it across your saved library.'],
              [Eye, 'Image crop Lens - coming soon', 'You will be able to drag over text or an object in an image and search matching saves.'],
              [ShieldCheck, 'Store review - coming soon', 'The extension needs browser-store approval before normal users can install it.'],
            ].map(([Icon, title, description]) => (
              <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <Icon className="h-6 w-6 text-primary" />
                <h3 className="mt-6 font-display text-2xl font-semibold tracking-tight">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="why" className="index-section relative overflow-hidden bg-black px-6 py-24 md:py-32">
        <div className="index-pin mx-auto max-w-7xl">
          <div className="index-heading mb-16">
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">/ 03 - What becomes searchable</div>
            <h2 className="max-w-4xl font-display text-5xl font-bold tracking-tighter md:text-7xl">
              Turn every save into a <span className="italic text-accent">useful memory</span>.
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 md:grid-cols-3 lg:grid-cols-4">
            {[
              [Sparkles, 'What it is'], [FileText, 'Quick summary'], [FileText, 'What was said'], [Eye, 'Words on screen'],
              [Eye, 'What is shown'], [Tag, 'Creator or brand'], [Bot, 'Product or idea'], [GitBranch, 'Links or names'],
              [Hash, 'Theme'], [Sparkles, 'Collection'], [Brain, 'Reason you saved'], [ShieldCheck, 'Original post'],
            ].map(([Icon, title]) => (
              <div key={title} data-index-tile className="group relative min-h-36 bg-black p-8 transition-colors hover:bg-primary/5">
                <Icon className="h-6 w-6 text-muted-foreground transition-colors group-hover:text-primary" />
                <div className="mt-6 font-display text-xl font-semibold">{title}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="feedback" className="bg-black px-6 py-24 md:py-32">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div data-reveal>
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">/ 04 - Build with us</div>
            <h2 className="font-display text-5xl font-bold tracking-tighter md:text-7xl">What should we add next?</h2>
            <p className="mt-6 max-w-xl leading-relaxed text-muted-foreground">
              Tell us what would make your saved-post library more useful. Ideas are shown publicly, but names and profile photos are hidden.
            </p>

            <form onSubmit={handleFeedbackSubmit} className="feedback-card mt-10 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <label className="block font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Feature area</label>
              <AnimatedFeatureSelect
                value={feedbackForm.feature}
                onChange={(feature) => setFeedbackForm((current) => ({ ...current, feature }))}
              />

              <label className="mt-5 block font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Your idea</label>
              <textarea
                value={feedbackForm.message}
                onChange={(event) => setFeedbackForm((current) => ({ ...current, message: event.target.value }))}
                placeholder="Example: I want smart folders for recipes, outfits, products, and creators."
                maxLength={500}
                required
                className="mt-3 min-h-36 w-full resize-none rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm leading-6 outline-none placeholder:text-muted-foreground focus:border-primary"
              />
              <div className="mt-4 flex items-center justify-between gap-4">
                <span className="text-xs text-muted-foreground">{feedbackForm.message.length}/500 · posted anonymously</span>
                <button disabled={feedbackBusy} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">
                  {feedbackBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Share idea
                </button>
              </div>
              {feedbackNotice && <p className="mt-4 text-sm text-muted-foreground">{feedbackNotice}</p>}
            </form>
          </div>

          <div className="feedback-card rounded-3xl border border-white/10 bg-white/[0.025] p-4 md:p-6">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Public ideas</div>
                <h3 className="mt-2 font-display text-2xl font-bold">Anonymous feedback board</h3>
              </div>
              <span className="rounded-full bg-primary/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-primary">{feedback.length} ideas</span>
            </div>

            <div className="max-h-[36rem] space-y-3 overflow-y-auto pr-1">
              {feedback.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 p-8 text-sm leading-6 text-muted-foreground">
                  No ideas yet. Be the first to suggest what should be built next.
                </div>
              ) : (
                feedback.map((entry) => (
                  <article key={entry.id} className="rounded-2xl border border-white/10 bg-black p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <span className="rounded-full bg-white/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        {entry.displayName || 'Anonymous user'}
                      </span>
                      <span className="rounded-full bg-primary/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-primary">
                        {entry.feature || 'Feature idea'}
                      </span>
                    </div>
                    <p className="text-sm leading-6 text-foreground/90">{entry.message}</p>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="cta-section relative overflow-hidden border-t border-white/5 bg-black px-6 py-32 md:py-40">
        <div className="cta-bg radial-fade grid-bg absolute inset-0 opacity-50" />
        <div className="relative mx-auto max-w-5xl text-center">
          <h2 data-reveal className="text-balance font-display text-6xl font-bold tracking-tighter md:text-8xl">
            Your best saves are already there. <br />Make them <span className="text-glow italic text-primary">useful</span>.
          </h2>
          <p data-reveal className="mx-auto mt-8 max-w-xl text-lg text-muted-foreground">Paste one link or upload an export, then turn saved posts into a library you can come back to.</p>
          <div data-reveal className="mt-12 flex flex-wrap items-center justify-center gap-4">
            <button
              type="button"
              onClick={onOpenApp}
              className="glow-ring group inline-flex items-center gap-3 rounded-full bg-primary px-9 py-5 text-lg font-semibold text-primary-foreground transition hover:scale-[1.03]"
            >
              Build my library <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
            </button>
            <button
              type="button"
              onClick={onOpenHowTo}
              className="inline-flex items-center gap-3 rounded-full border border-white/15 px-7 py-5 text-base font-semibold text-foreground transition hover:bg-white/5"
            >
              <FileText className="h-5 w-5" /> How to Use
            </button>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 px-6 py-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
          <BrandLogo className="h-10 w-32" />
          <div className="flex flex-wrap gap-4">
            <button type="button" onClick={onOpenHowTo} className="transition hover:text-primary">How to Use</button>
            <button type="button" onClick={onOpenHelp} className="transition hover:text-primary">Help Center</button>
            <button type="button" onClick={onOpenTerms} className="transition hover:text-primary">Terms of Service</button>
            <button type="button" onClick={onOpenPrivacy} className="transition hover:text-primary">Privacy Policy</button>
            <button type="button" onClick={onOpenSecurity} className="transition hover:text-primary">Security</button>
            <button type="button" onClick={onOpenDataDeletion} className="transition hover:text-primary">Data Deletion</button>
            <button type="button" onClick={onOpenCookies} className="transition hover:text-primary">Cookies</button>
          </div>
        </div>
      </footer>

    </div>
  );
}

const HOW_TO_STEPS = [
  {
    image: '/how-to/1000347058.jpg',
    title: 'Open Instagram settings',
    copy: 'Go to Instagram settings. Tap the search box at the top.',
  },
  {
    image: '/how-to/1000347059.jpg',
    title: 'Search export',
    copy: 'Type "Export Your Information". Tap the result called Export your information.',
  },
  {
    image: '/how-to/1000347060.jpg',
    title: 'Create the export',
    copy: 'Tap the blue Create export button.',
  },
  {
    image: '/how-to/1000347061.jpg',
    title: 'Choose your device',
    copy: 'Tap Export to device. This means Instagram will make a file you can download.',
  },
  {
    image: '/how-to/1000347062.jpg',
    title: 'Only choose Saved',
    copy: 'Tap Customize information. Pick Saved only. Then tap Save.',
  },
  {
    image: '/how-to/1000347063.jpg',
    title: 'Check the export settings',
    copy: 'Make sure it says Saved, Last year, and HTML. HTML is the file type this app reads.',
  },
  {
    image: '/how-to/1000347064.jpg',
    title: 'Start the export',
    copy: 'Tap Start export. Instagram will prepare your saved posts file.',
  },
  {
    image: '/how-to/1000347065.jpg',
    title: 'Confirm it is you',
    copy: 'Instagram may ask for your password. Enter it in Instagram, then wait for the download notification.',
  },
];

const OPENROUTER_STEPS = [
  {
    image: '/how-to/openrouter-01.png',
    title: 'Open OpenRouter',
    copy: <>Open your browser and go to <a href="https://openrouter.ai" target="_blank" rel="noreferrer" className="font-semibold text-primary underline underline-offset-4">openrouter.ai</a>.</>,
    url: 'openrouter.ai',
  },
  {
    image: '/how-to/openrouter-02.png',
    title: 'Click Get API Key',
    copy: 'On the OpenRouter homepage, click Get API Key.',
  },
  {
    image: '/how-to/openrouter-03.png',
    title: 'Use the API key button',
    copy: 'Click the Get API Key button in the hero section.',
  },
  {
    image: '/how-to/openrouter-04.png',
    title: 'Sign in',
    copy: 'Sign in with Google, GitHub, MetaMask, or email. If you do not have an account, create one.',
  },
  {
    image: '/how-to/openrouter-05.png',
    title: 'Open API Keys',
    copy: 'After login, you should land on API Keys. If not, open API Keys from the left sidebar.',
  },
  {
    image: '/how-to/openrouter-06.png',
    title: 'Create a new key',
    copy: 'Click New Key.',
  },
  {
    image: '/how-to/openrouter-07.png',
    title: 'Name the key',
    copy: 'Give it any name you like. Leave the credit limit blank unless you want a hard spending limit. Then click Create.',
  },
  {
    image: '/how-to/openrouter-08.png',
    title: 'Copy the key',
    copy: 'Copy the key now. You will not be able to see it again after closing this window.',
  },
  {
    image: '/how-to/openrouter-09.png',
    title: 'Save it in IScraper',
    copy: 'Go back to IScraper, open Keys & privacy, choose OpenRouter, paste the key once, and save it. IScraper chooses the right models automatically.',
  },
  {
    image: '/how-to/openrouter-10.png',
    title: 'Open Credits',
    copy: 'Back in OpenRouter, use the left sidebar and click Credits.',
  },
  {
    image: '/how-to/openrouter-11.png',
    title: 'Add credits',
    copy: 'Click Add Credits.',
  },
  {
    image: '/how-to/openrouter-12.png',
    title: 'Add $1-$3',
    copy: 'Add a payment method and buy 1 to 3 dollars of credits. That is enough to start testing.',
  },
];

const PINTEREST_STEPS = [
  {
    image: '/how-to/pinterest-01.png',
    title: 'Open Pinterest',
    copy: 'Open Pinterest while signed in to the account you want to export.',
  },
  {
    image: '/how-to/pinterest-02.png',
    title: 'Open settings',
    copy: 'Click the settings gear in the left sidebar.',
  },
  {
    image: '/how-to/pinterest-03.png',
    title: 'Go to Settings',
    copy: 'In Settings & Support, click Settings.',
  },
  {
    image: '/how-to/pinterest-04.png',
    title: 'Open Privacy and data',
    copy: 'Find the Privacy and data section in Pinterest settings.',
  },
  {
    image: '/how-to/pinterest-05.png',
    title: 'Find Request your data',
    copy: 'Scroll until you see Request your data.',
  },
  {
    image: '/how-to/pinterest-06.png',
    title: 'Click Request data',
    copy: 'Click Request data. Pinterest will prepare a copy of your account data.',
  },
  {
    image: '/how-to/pinterest-07.png',
    title: 'Confirm the request',
    copy: 'Pinterest will show that the request was received and the next steps will come by email.',
  },
  {
    image: '/how-to/pinterest-08.png',
    title: 'Check your email',
    copy: 'Pinterest sends an email saying your data request has been received. The download email comes later.',
    wide: true,
    mockEmail: true,
  },
  {
    image: '/how-to/pinterest-09.png',
    title: 'Open the ready email',
    copy: 'When Pinterest emails you that your data is ready, open the email and click the red button to view your data.',
    wide: true,
  },
  {
    image: '/how-to/pinterest-10.png',
    title: 'Enter your email',
    copy: 'Type the same email address you used for Pinterest, then click Submit.',
    wide: true,
  },
  {
    image: '/how-to/pinterest-11.png',
    title: 'Choose one verification option',
    copy: 'Choose any 1 option from the two: log in with Google or email yourself a one-time verification code. Then tick the SendSafely terms checkbox.',
  },
  {
    image: '/how-to/pinterest-12.png',
    title: 'Open the secure message',
    copy: 'After verification, SendSafely shows your secure message and the attached Pinterest export file.',
    wide: true,
  },
  {
    image: '/how-to/pinterest-13.png',
    title: 'Download pinterest.zip',
    copy: 'Click the download icon beside pinterest.zip and save the file somewhere easy to find.',
    wide: true,
  },
  {
    image: '/how-to/pinterest-14.png',
    title: 'Upload your files here',
    copy: 'Open IScraper, go to Add saves, and upload your Pinterest ZIP file there.',
    wide: true,
  },
];

const HOW_TO_GUIDES = [
  { key: 'instagram', icon: Upload, title: 'Instagram export', copy: 'Get your saved posts file from Instagram and upload it into IScraper.', status: 'Guide ready' },
  { key: 'api-keys', icon: KeyRound, title: 'API keys', copy: 'Method 1: use OpenRouter for summaries, tags, and semantic search.', status: 'Guide ready' },
  { key: 'pinterest', icon: ExternalLink, title: 'Pinterest export', copy: 'Request and download your Pinterest data export.', status: 'Guide ready' },
  { key: 'extension', icon: Search, title: 'Browser extension', copy: 'Coming soon: save pages, use Lens search, and open results from your browser.', status: 'Coming soon' },
];

function HowToUsePage({ onBack, onOpenApp }) {
  const pageRef = useRef(null);
  const [activeGuide, setActiveGuide] = useState(null);
  const activeGuideDetails = HOW_TO_GUIDES.find((guide) => guide.key === activeGuide);
  const openKeysPrivacy = () => {
    window.history.pushState({}, 'IScraper App', '/app?tab=settings');
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ctx = gsap.context(() => {
      if (reduceMotion) {
        gsap.set(['.howto-reveal', '.howto-shot', '.howto-copy'], { autoAlpha: 1, x: 0, y: 0 });
        return;
      }

      gsap.from('.howto-reveal', {
        autoAlpha: 0,
        y: 34,
        duration: 0.75,
        ease: 'power3.out',
        stagger: 0.08,
      });

      gsap.utils.toArray('.howto-step').forEach((step) => {
        const shot = step.querySelector('.howto-shot');
        const copy = step.querySelector('.howto-copy');
        const reverse = step.dataset.reverse === 'true';

        gsap.fromTo(
          shot,
          { autoAlpha: 0, x: reverse ? 70 : -70, y: 16 },
          {
            autoAlpha: 1,
            x: 0,
            y: 0,
            duration: 0.85,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: step,
              start: 'top 72%',
              toggleActions: 'play none none reverse',
            },
          },
        );

        gsap.fromTo(
          copy,
          { autoAlpha: 0, x: reverse ? -70 : 70, y: 16 },
          {
            autoAlpha: 1,
            x: 0,
            y: 0,
            duration: 0.85,
            ease: 'power3.out',
            delay: 0.08,
            scrollTrigger: {
              trigger: step,
              start: 'top 72%',
              toggleActions: 'play none none reverse',
            },
          },
        );
      });

      window.setTimeout(() => ScrollTrigger.refresh(), 250);
    }, pageRef);

    return () => ctx.revert();
  }, [activeGuide]);

  return (
    <div ref={pageRef} className="min-h-screen overflow-hidden bg-black text-foreground">
      <div className="grid-bg radial-fade pointer-events-none fixed inset-0 opacity-40" />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/85 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <button type="button" onClick={onBack} className="flex items-center gap-3 transition hover:opacity-80">
            <ArrowLeft className="h-5 w-5 text-muted-foreground" />
            <BrandLogo className="h-12 w-40" />
          </button>
          <button type="button" onClick={onOpenApp} className="hidden rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:scale-[1.02] sm:inline-flex">
            Open app
          </button>
        </div>
      </header>

      <main className="relative mx-auto max-w-7xl px-5 py-14 md:py-20">
        <section className="howto-reveal mb-14 max-w-4xl">
          <div className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">How to use IScraper</div>
          <h1 className="font-display text-5xl font-bold tracking-tighter md:text-7xl">
            Guides for imports, API keys, and upcoming features.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
            Start with Instagram export today. We will keep adding simple guides here for API keys, Pinterest, the browser extension, and other import flows as they become available.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {HOW_TO_GUIDES.map(({ key, icon: Icon, title, copy, status }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveGuide((current) => (current === key ? null : key))}
                className={`group rounded-2xl border p-5 text-left transition hover:-translate-y-0.5 ${
                  activeGuide === key ? 'border-primary bg-primary/10' : 'border-white/10 bg-white/[0.03] hover:border-primary/60'
                }`}
              >
                <Icon className="h-5 w-5 text-primary" />
                <div className="mt-4 flex items-center justify-between gap-3">
                  <h2 className="font-display text-xl font-bold tracking-tight">{title}</h2>
                  <span className={`rounded-full px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] ${
                    activeGuide === key || status === 'Guide ready' ? 'bg-primary text-primary-foreground' : 'bg-white/10 text-muted-foreground'
                  }`}>
                    {status}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p>
              </button>
            ))}
          </div>
        </section>

        {!activeGuide && (
          <section className="howto-reveal rounded-[2rem] border border-white/10 bg-white/[0.025] p-6 md:p-10">
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Choose a guide</div>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight">Click Instagram export to see the import steps.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              We will add Pinterest and extension walkthroughs here as those flows are finalized.
            </p>
          </section>
        )}

        {activeGuide && activeGuide !== 'instagram' && activeGuide !== 'api-keys' && activeGuide !== 'pinterest' && activeGuide !== 'extension' && (
          <section className="howto-reveal rounded-[2rem] border border-white/10 bg-white/[0.025] p-6 md:p-10">
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-primary">{activeGuideDetails?.status}</div>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight">{activeGuideDetails?.title}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              This guide will live here next. For now, use the Help Center or email us if you get stuck.
            </p>
          </section>
        )}

        {activeGuide === 'api-keys' && (
          <>
            <section className="howto-reveal mb-6">
              <div className="font-mono text-xs uppercase tracking-[0.3em] text-primary">API keys / Method 1</div>
              <h2 className="mt-3 font-display text-3xl font-bold tracking-tight md:text-5xl">Use OpenRouter with IScraper.</h2>
            </section>

            <div className="space-y-6 md:space-y-0">
              {OPENROUTER_STEPS.map((step, index) => (
                <article
                  key={step.image}
                  data-reverse={index % 2 === 1}
                  className="howto-step grid min-h-[calc(100vh-5rem)] items-center gap-8 py-10 md:grid-cols-2 md:gap-14 md:py-16"
                >
                  <div className={`howto-shot ${index % 2 === 1 ? 'md:order-2' : ''}`}>
                    <div className="mx-auto max-w-[22rem] overflow-hidden rounded-[1.75rem] shadow-2xl shadow-black/50 md:max-w-[42rem]">
                      <img src={step.image} alt={`Step ${index + 1}: ${step.title}`} className="max-h-[68vh] w-full object-contain" loading={index < 2 ? 'eager' : 'lazy'} />
                    </div>
                    {step.url && (
                      <div className="mx-auto mt-4 flex max-w-[42rem] items-center gap-3 rounded-full border border-white/10 bg-white/[0.06] px-4 py-3 font-mono text-sm text-foreground shadow-xl shadow-black/30">
                        <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                        <span className="text-muted-foreground">https://</span>
                        <span className="font-semibold">{step.url}</span>
                      </div>
                    )}
                  </div>
                  <div className={`howto-copy flex flex-col justify-center p-2 md:p-10 ${index % 2 === 1 ? 'md:order-1' : ''}`}>
                    <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary font-display text-2xl font-bold text-primary-foreground">
                      {index + 1}
                    </div>
                    <h2 className="font-display text-3xl font-bold tracking-tight md:text-5xl">{step.title}</h2>
                    <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">{step.copy}</p>
                  </div>
                </article>
              ))}
            </div>

            <section className="howto-reveal mt-14 rounded-[2rem] border border-primary/30 bg-primary p-6 text-black md:p-10">
              <h2 className="font-display text-4xl font-bold tracking-tight">OpenRouter alternatives</h2>
              <p className="mt-3 max-w-2xl text-base leading-7">
                You can also use{' '}
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="font-bold underline underline-offset-4">Gemini</a>,{' '}
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="font-bold underline underline-offset-4">OpenAI</a>,{' '}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="font-bold underline underline-offset-4">Anthropic</a>, or{' '}
                <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer" className="font-bold underline underline-offset-4">DeepSeek</a>{' '}
                keys. They follow a similar process: create an account, create an API key, add credits or billing if needed, then paste the key in IScraper.
              </p>
              <button type="button" onClick={openKeysPrivacy} className="mt-6 inline-flex items-center gap-3 rounded-full bg-black px-6 py-4 font-semibold text-white transition hover:scale-[1.02]">
                Open Keys & privacy <ArrowRight className="h-5 w-5" />
              </button>
            </section>
          </>
        )}

        {activeGuide === 'pinterest' && (
          <>
            <section className="howto-reveal mb-6">
              <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.3em] text-primary">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#e60023]">
                  <img src="/platforms/pinterest.svg" alt="" className="h-5 w-5" />
                </span>
                Pinterest export
              </div>
              <h2 className="mt-3 font-display text-3xl font-bold tracking-tight md:text-5xl">Request and download your Pinterest data.</h2>
            </section>

            <div className="space-y-6 md:space-y-0">
              {PINTEREST_STEPS.map((step, index) => (
                <article
                  key={step.image}
                  data-reverse={index % 2 === 1}
                  className="howto-step grid min-h-[calc(100vh-5rem)] items-center gap-8 py-10 md:grid-cols-2 md:gap-14 md:py-16"
                >
                  <div className={`howto-shot ${index % 2 === 1 ? 'md:order-2' : ''}`}>
                    {step.mockEmail ? (
                      <div className="mx-auto w-full max-w-[46rem] rounded-2xl border border-white/10 bg-white p-4 text-black shadow-2xl shadow-black/50">
                        <div className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4">
                          <span className="h-4 w-4 shrink-0 rounded-sm border border-zinc-300" />
                          <span className="text-zinc-400">☆</span>
                          <span className="shrink-0 font-bold">Pinterest</span>
                          <span className="min-w-0 flex-1 truncate text-sm">
                            <strong>Your data request has been received!</strong>
                            <span className="text-zinc-600"> - Your data request has been received and is being processed. You will rec...</span>
                          </span>
                          <span className="shrink-0 font-semibold">02:25</span>
                        </div>
                      </div>
                    ) : (
                      <div className={`mx-auto overflow-hidden rounded-[1.75rem] shadow-2xl shadow-black/50 ${
                        step.wide ? 'max-w-[28rem] md:max-w-[58rem]' : 'max-w-[22rem] md:max-w-[42rem]'
                      }`}>
                        <img src={step.image} alt={`Step ${index + 1}: ${step.title}`} className={`${step.wide ? 'max-h-[42vh]' : 'max-h-[68vh]'} w-full object-contain`} loading={index < 2 ? 'eager' : 'lazy'} />
                      </div>
                    )}
                  </div>
                  <div className={`howto-copy flex flex-col justify-center p-2 md:p-10 ${index % 2 === 1 ? 'md:order-1' : ''}`}>
                    <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary font-display text-2xl font-bold text-primary-foreground">
                      {index + 1}
                    </div>
                    <h2 className="font-display text-3xl font-bold tracking-tight md:text-5xl">{step.title}</h2>
                    <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">{step.copy}</p>
                  </div>
                </article>
              ))}
            </div>

            <section className="howto-reveal mt-14 rounded-[2rem] border border-primary/30 bg-primary p-6 text-black md:p-10">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-white">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#e60023]">
                  <img src="/platforms/pinterest.svg" alt="" className="h-5 w-5" />
                </span>
              </div>
              <h2 className="font-display text-4xl font-bold tracking-tight">Upload your files here</h2>
              <p className="mt-3 max-w-2xl text-base leading-7">
                When Pinterest sends your download, upload the ZIP in Add saves. IScraper accepts Pinterest export files and Instagram export files.
              </p>
            </section>
          </>
        )}

        {activeGuide === 'extension' && (
          <section className="howto-reveal rounded-[2rem] border border-white/10 bg-white/[0.025] p-6 md:p-10">
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Browser extension - coming soon</div>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight md:text-5xl">The extension guide is coming soon.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
              The extension is not available for users yet. Once the browser-store listing is approved, this page will show the install and setup steps.
            </p>
            <span className="mt-8 inline-flex rounded-full bg-white/10 px-5 py-3 text-sm font-semibold text-muted-foreground">
              Coming soon
            </span>
          </section>
        )}

        {activeGuide === 'instagram' && (
          <>
            <section className="howto-reveal mb-6">
              <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.3em] text-primary">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white">
                  <img src="/platforms/instagram.svg" alt="" className="h-6 w-6" />
                </span>
                Instagram export
              </div>
              <h2 className="mt-3 font-display text-3xl font-bold tracking-tight md:text-5xl">Get your Instagram saved posts file.</h2>
            </section>

            <div className="space-y-6 md:space-y-0">
              {HOW_TO_STEPS.map((step, index) => (
                <article
                  key={step.image}
                  data-reverse={index % 2 === 1}
                  className="howto-step grid min-h-[calc(100vh-5rem)] items-center gap-8 py-10 md:grid-cols-2 md:gap-14 md:py-16"
                >
                  <div className={`howto-shot ${index % 2 === 1 ? 'md:order-2' : ''}`}>
                    <div className="mx-auto max-w-[18rem] overflow-hidden rounded-[1.75rem] shadow-2xl shadow-black/50 md:max-w-[21rem]">
                      <img src={step.image} alt={`Step ${index + 1}: ${step.title}`} className="max-h-[68vh] w-full object-contain" loading={index < 2 ? 'eager' : 'lazy'} />
                    </div>
                  </div>
                  <div className={`howto-copy flex flex-col justify-center p-2 md:p-10 ${index % 2 === 1 ? 'md:order-1' : ''}`}>
                    <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary font-display text-2xl font-bold text-primary-foreground">
                      {index + 1}
                    </div>
                    <h2 className="font-display text-3xl font-bold tracking-tight md:text-5xl">{step.title}</h2>
                    <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">{step.copy}</p>
                  </div>
                </article>
              ))}
            </div>

            <section className="howto-reveal mt-14 rounded-[2rem] border border-primary/30 bg-primary p-6 text-black md:p-10">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-white">
                <img src="/platforms/instagram.svg" alt="" className="h-9 w-9" />
              </div>
              <h2 className="font-display text-4xl font-bold tracking-tight">After Instagram sends the file</h2>
              <p className="mt-3 max-w-2xl text-base leading-7">
                Download the export from Instagram, come back to IScraper, open your library, and upload the saved HTML files.
              </p>
              <button type="button" onClick={onOpenApp} className="mt-6 inline-flex items-center gap-3 rounded-full bg-black px-6 py-4 font-semibold text-white transition hover:scale-[1.02]">
                Open my library <ArrowRight className="h-5 w-5" />
              </button>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

const SUPPORT_EMAIL = 'itsallover.2006@gmail.com';
const SUPPORT_TOPIC_OPTIONS = ['Import help', 'Login or account', 'Extension coming soon', 'Search results', 'Billing or credits', 'Other'];

function HelpCenterPage({ onBack, onOpenApp, onOpenHowTo }) {
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('IScraper support request')}`;
  const [supportForm, setSupportForm] = useState({
    email: '',
    topic: 'Import help',
    message: '',
  });
  const helpTopics = [
    [Upload, 'Import help', 'Use the Instagram export guide if you are stuck getting your saved posts file.'],
    [KeyRound, 'AI keys', 'IScraper is BYOK right now. Add your own text, media, and embedding keys in Keys & privacy.'],
    [Search, 'Search problems', 'If results feel wrong, make sure the saves were indexed. Search improves after summaries, OCR, and tags exist.'],
    [LifeBuoy, 'Account support', 'Email us if login, usernames, profile setup, or imports are not working.'],
  ];

  const handleSupportSubmit = (event) => {
    event.preventDefault();
    const body = [
      `Reply-to email: ${supportForm.email}`,
      `Topic: ${supportForm.topic}`,
      '',
      supportForm.message,
    ].join('\n');
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`IScraper support: ${supportForm.topic}`)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <div className="min-h-screen bg-black text-foreground">
      <div className="grid-bg radial-fade pointer-events-none fixed inset-0 opacity-40" />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/85 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <button type="button" onClick={onBack} className="flex items-center gap-3 transition hover:opacity-80">
            <ArrowLeft className="h-5 w-5 text-muted-foreground" />
            <BrandLogo className="h-12 w-40" />
          </button>
          <button type="button" onClick={onOpenApp} className="hidden rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:scale-[1.02] sm:inline-flex">
            Open app
          </button>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-5 py-16 md:py-24">
        <section className="max-w-4xl">
          <div className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">Help Center</div>
          <h1 className="font-display text-5xl font-bold tracking-tighter md:text-7xl">Need help with IScraper?</h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            If something breaks, you cannot import, or an upcoming feature feels confusing, email us and include what you were trying to do.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={mailto}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-4 text-sm font-semibold text-primary-foreground transition hover:scale-[1.03]"
            >
              <Mail className="h-4 w-4" /> Email support
            </a>
            <button
              type="button"
              onClick={onOpenHowTo}
              className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-4 text-sm transition hover:bg-white/5"
            >
              <FileText className="h-4 w-4" /> Instagram export guide
            </button>
          </div>
        </section>

        <section className="mt-16 grid gap-5 md:grid-cols-2">
          {helpTopics.map(([Icon, title, copy]) => (
            <article key={title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <Icon className="h-6 w-6 text-primary" />
              <h2 className="mt-6 font-display text-2xl font-bold tracking-tight">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy}</p>
            </article>
          ))}
        </section>

        <section className="mt-10 rounded-2xl border border-primary/30 bg-primary/5 p-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Contact</div>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight">Support email</h2>
          <a href={mailto} className="mt-4 inline-flex break-all text-lg font-semibold text-primary hover:underline">
            {SUPPORT_EMAIL}
          </a>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Best message format: your account email, what you clicked, what you expected, and a screenshot if possible.
          </p>

          <form onSubmit={handleSupportSubmit} className="mt-6 grid gap-3">
            <label className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              Your email <span className="text-orange-500">*</span>
            </label>
            <input
              type="email"
              value={supportForm.email}
              onChange={(event) => setSupportForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="Your email so we can reply"
              required
              className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm outline-none focus:border-primary"
            />
            <AnimatedFeatureSelect
              value={supportForm.topic}
              options={SUPPORT_TOPIC_OPTIONS}
              onChange={(topic) => setSupportForm((current) => ({ ...current, topic }))}
            />
            <textarea
              value={supportForm.message}
              onChange={(event) => setSupportForm((current) => ({ ...current, message: event.target.value }))}
              placeholder="Tell us what happened."
              maxLength={1200}
              required
              className="min-h-36 w-full resize-none rounded-xl border border-white/10 bg-black px-4 py-3 text-sm leading-6 outline-none focus:border-primary"
            />
            <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:scale-[1.02]">
              <Mail className="h-4 w-4" /> Send to support email
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

const LEGAL_CONTENT = {
  terms: {
    eyebrow: 'Terms of Service',
    title: 'Terms of Service',
    intro: 'These terms explain the rules for using IScraper. They are a practical starting point, not a substitute for advice from your lawyer.',
    sections: [
      ['Using IScraper', 'IScraper helps you upload your official Instagram export, save links from other platforms, and turn saved posts into a private searchable library. You are responsible for using the app lawfully and only uploading or saving content you have the right to use.'],
      ['Accounts', 'You must sign in before importing saved posts. You are responsible for activity on your account and for keeping your login secure. Usernames must be unique and may be changed if they impersonate someone, violate rights, or create abuse.'],
      ['Your content', 'Your Instagram export, saved links, captions, notes, summaries, graph data, username, and optional profile picture remain your content. You give IScraper permission to process that content only to provide the app features.'],
      ['Emails and updates', 'We may send account, security, product, billing, import, and support emails to the email address on your account. We may also send product updates or marketing emails where you have opted in or where the law allows it, and those marketing emails must include a way to unsubscribe.'],
      ['AI processing', 'When indexing is enabled, content may be sent to configured AI providers to create summaries, OCR, transcripts, tags, and search data. AI output can be wrong, incomplete, or outdated, so you should verify important information yourself.'],
      ['Browser extension coming soon', 'The IScraper browser extension is not available for users yet. When released, it will be optional and must be used only on pages and content you are allowed to process.'],
      ['Things you cannot do', 'Do not upload content you do not have rights to use, attack the service, bypass rate limits, scrape or copy other users data, reverse engineer protected parts of the service, or use IScraper for unlawful activity.'],
      ['Credits and paid features', 'The first 200 imported saved items are currently included without paid IScraper credits, subject to abuse prevention and fair-use limits. Credit purchases are currently marked as coming soon. If payments are enabled later, pricing, refunds, and billing terms will be shown before purchase.'],
      ['Service changes', 'We may change, pause, or discontinue features. We will try to avoid disrupting your saved library, but we do not guarantee uninterrupted access.'],
      ['Disclaimer', 'IScraper is provided as-is without warranties. To the maximum extent allowed by law, we are not responsible for indirect damages, lost data, lost profits, or decisions made from AI-generated output.'],
      ['Contact', `For support or legal questions, contact us at ${SUPPORT_EMAIL}.`],
    ],
  },
  privacy: {
    eyebrow: 'Privacy Policy',
    title: 'Privacy Policy',
    intro: 'This policy explains what IScraper collects, why it is collected, and how it is used. It is written for the current product flow: Supabase login with Google or email, Instagram export upload, saved links, AI indexing, private saved libraries, and the browser extension that is coming soon.',
    sections: [
      ['Information we collect', 'We collect login details from Supabase and the login method you choose, such as user ID and email, your chosen username, optional profile picture, feedback you submit, uploaded Instagram export files, saved post metadata, generated summaries, transcripts, OCR, tags, graph data, provider key settings, credit records, and basic technical logs. Extension token records may be added when the extension launches.'],
      ['Login data', 'Google or email login is used to authenticate you and create your IScraper account. From Supabase and Google, when used, we may receive basic account details such as your user ID, email address, name, and profile image if Google provides them. IScraper does not ask for Gmail, Drive, Calendar, contacts, or other Google account content.'],
      ['Instagram data', 'IScraper uses official Instagram export files that you upload. We do not ask for your Instagram password and we removed Instagram login scraping. Your export is used to build your searchable library.'],
      ['AI providers', 'If indexing is enabled, parts of your uploaded content may be sent to configured AI providers such as OpenRouter, Gemini, or your own connected provider key. This is done to generate summaries, transcripts, OCR, tags, and embeddings.'],
      ['Browser extension data - coming soon', 'The browser extension is not available for users yet. When released, it is planned to run only after you click it and use limited data such as the current page URL, selected text, or a user-selected screenshot crop.'],
      ['How we use data', 'We use your data to authenticate your account, keep your library separate from other users, process imports, search your saves, build your graph, show anonymous public feedback, prevent abuse, enforce limits, improve reliability, send service messages, respond to support requests, and send product updates or marketing emails only where you have opted in or where legally permitted.'],
      ['Login data limits', 'We do not sell login data, use it to build advertising profiles, or transfer it to unrelated third parties for marketing. We use login data only for account access, account communication, security, support, and the email uses described in this policy.'],
      ['What is public', 'Public feedback is visible to everyone, but it is shown without your name or profile photo. Your saved library, username setup data, provider keys, credits, and imports are not meant to be public.'],
      ['Security', 'We use Supabase Auth, row-level ownership rules, encrypted provider-key storage, rate limits, upload limits, CORS restrictions, and security headers. No system is perfectly secure, so do not upload highly sensitive data unless you accept that risk.'],
      ['Retention and deletion', 'Your saved library stays until you delete it or request deletion. Public feedback may remain visible unless removed by an operator. Before public launch, we should add a clear account/data deletion contact or self-serve deletion flow.'],
      ['Children', 'IScraper is not directed to children under 13. Do not use the service if you are not old enough to consent under your local law.'],
      ['Contact', `For privacy requests, contact us at ${SUPPORT_EMAIL}.`],
    ],
  },
  security: {
    eyebrow: 'Security',
    title: 'Security',
    intro: 'This page explains the practical security controls IScraper uses and how to report a security issue.',
    sections: [
      ['Account protection', 'IScraper uses Supabase Auth with Google or email sign-in for account access. Users must complete profile setup before importing saved content. Keep your login method secure because it controls access to your IScraper account.'],
      ['Data separation', 'Production data is stored in Supabase with user ownership checks and row-level security policies. The backend uses the service role only on server-side routes, never in browser code.'],
      ['API keys', 'User AI provider keys are encrypted before storage. The first included indexing allowance can use IScraper provider keys; users can still add their own keys when they want provider control.'],
      ['Extension security - coming soon', 'The browser extension is planned to use a limited, revokable Lens token instead of your main login token. It will not be available to users until browser-store release.'],
      ['Abuse prevention', 'IScraper uses upload limits, rate limits, URL safety checks, CORS restrictions, and security headers to reduce common abuse and accidental exposure.'],
      ['Report a security issue', `Email ${SUPPORT_EMAIL} with the subject "IScraper security report". Include the affected page, steps to reproduce, and impact. Do not publicly disclose an issue until we have had a chance to fix it.`],
    ],
  },
  dataDeletion: {
    eyebrow: 'Data Deletion',
    title: 'Data Deletion',
    intro: 'Use this page to request deletion of your IScraper account data, saved library, feedback, and connected settings.',
    sections: [
      ['How to request deletion', `Email ${SUPPORT_EMAIL} from the email address connected to your IScraper account. Use the subject "Delete my IScraper data". Include your username if you have one.`],
      ['What we delete', 'We can delete your account profile, saved items, imports, generated summaries, OCR/transcripts, graph data, provider key records, future extension tokens, and credit records tied to your account where deletion is legally and technically allowed.'],
      ['Public feedback', 'Anonymous public feedback may be harder to identify if it was not tied to your account. If you want a specific feedback item removed, include the exact text or a screenshot.'],
      ['Timing', 'We will review deletion requests as soon as practical. Some logs, backups, or legal records may remain for a limited time where required for security, fraud prevention, accounting, or legal compliance.'],
      ['Before deletion', 'Export anything you want to keep before requesting deletion. Once data is deleted, we may not be able to restore it.'],
    ],
  },
  cookies: {
    eyebrow: 'Cookie Notice',
    title: 'Cookie Notice',
    intro: 'This page explains the simple storage IScraper currently uses in the browser.',
    sections: [
      ['Essential storage', 'IScraper may use browser storage and Supabase Auth session storage to keep you signed in and remember app state. This is needed for the app to work.'],
      ['Local preferences', 'The site may remember small preferences such as dismissed popups, pending save links, and temporary UI state in local storage.'],
      ['Analytics and ads', 'IScraper may use privacy-conscious analytics to understand basic product usage. IScraper does not currently use advertising cookies.'],
      ['Browser controls', 'You can clear cookies and local storage from your browser settings. Doing this may sign you out or reset app preferences.'],
      ['Contact', `Questions about cookies or browser storage can be sent to ${SUPPORT_EMAIL}.`],
    ],
  },
};

function LegalPage({ type, onBack }) {
  const content = LEGAL_CONTENT[type] || LEGAL_CONTENT.terms;
  return (
    <div className="min-h-screen bg-black text-foreground">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/85 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <button type="button" onClick={onBack} className="flex items-center gap-3 transition hover:opacity-80">
            <ArrowLeft className="h-5 w-5 text-muted-foreground" />
            <BrandLogo className="h-12 w-40" />
          </button>
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Last updated May 8, 2026</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-14 md:py-20">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">{content.eyebrow}</p>
        <h1 className="mt-3 font-display text-5xl font-bold tracking-tighter md:text-7xl">{content.title}</h1>
        <p className="mt-6 max-w-3xl text-base leading-8 text-muted-foreground">{content.intro}</p>
        <div className="mt-12 space-y-5">
          {content.sections.map(([title, body]) => (
            <section key={title} className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
              <h2 className="font-display text-2xl font-bold tracking-tight">{title}</h2>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">{body}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

function AnimatedFeatureSelect({ value, onChange, options = FEEDBACK_FEATURE_OPTIONS }) {
  const [open, setOpen] = useState(false);
  const selectRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (!selectRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={selectRef} className="relative mt-3">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`group flex w-full items-center justify-between rounded-2xl border bg-black px-4 py-3 text-left text-sm outline-none transition duration-200 ${
          open ? 'border-primary shadow-[0_0_0_4px_rgba(165,255,24,0.12)]' : 'border-white/10 hover:border-primary/70'
        }`}
      >
        <span className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-orange-500 shadow-[0_0_16px_rgba(255,106,0,0.75)]" />
          {value}
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition duration-200 ${open ? 'rotate-180 text-primary' : 'group-hover:text-primary'}`} />
      </button>

      <div
        role="listbox"
        className={`absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-2xl border border-primary/40 bg-black/95 p-2 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur transition duration-200 ${
          open ? 'pointer-events-auto translate-y-0 scale-100 opacity-100' : 'pointer-events-none -translate-y-2 scale-[0.98] opacity-0'
        }`}
      >
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition duration-150 ${
                selected ? 'bg-orange-500 text-black' : 'text-foreground hover:bg-orange-500/15 hover:text-orange-300'
              }`}
            >
              <span>{option}</span>
              {selected && <Check className="h-4 w-4" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DashboardFilterSelect({ label, value, options, onChange, ariaLabel, icon: Icon }) {
  const [open, setOpen] = useState(false);
  const selectRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (!selectRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={selectRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`group flex min-w-36 items-center gap-2 rounded-full border bg-black px-3 py-2 text-left transition duration-200 ${
          open ? 'border-primary shadow-[0_0_0_4px_rgba(165,255,24,0.12)]' : 'border-white/10 hover:border-primary/70'
        }`}
      >
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />}
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{value}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition duration-200 ${open ? 'rotate-180 text-primary' : 'group-hover:text-primary'}`} />
      </button>

      <div
        role="listbox"
        className={`absolute right-0 top-[calc(100%+0.5rem)] z-50 max-h-72 min-w-full overflow-y-auto rounded-2xl border border-primary/40 bg-black/95 p-2 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur transition duration-200 ${
          open ? 'pointer-events-auto translate-y-0 scale-100 opacity-100' : 'pointer-events-none -translate-y-2 scale-[0.98] opacity-0'
        }`}
      >
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-xs transition duration-150 ${
                selected ? 'bg-orange-500 text-black' : 'text-foreground hover:bg-orange-500/15 hover:text-orange-300'
              }`}
            >
              <span>{option}</span>
              {selected && <Check className="h-4 w-4" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Dashboard({ onBack, onOpenLogin, onOpenHowTo }) {
  const [tab, setTab] = useState(() => dashboardTabFromLocation());
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [collectionFilter, setCollectionFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [items, setItems] = useState([]);
  const [searchResults, setSearchResults] = useState(null);
  const [selected, setSelected] = useState(null);
  const [files, setFiles] = useState([]);
  const [importSourceType, setImportSourceType] = useState('auto');
  const [linkForm, setLinkForm] = useState({ url: '', title: '', description: '', note: '' });
  const [credentials, setCredentials] = useState([]);
  const [credentialOptions, setCredentialOptions] = useState(null);
  const [credentialForm, setCredentialForm] = useState({
    setup: 'openrouter_all',
    apiKey: '',
  });
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileRequired, setProfileRequired] = useState(false);
  const [profileForm, setProfileForm] = useState({ username: '', avatarUrl: '' });
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sidebarRef = useRef(null);
  const pendingSaveHandledRef = useRef(false);
  const pendingItemHandledRef = useRef(false);
  const activeSearchRef = useRef(0);
  const authEnabled = Boolean(supabase);
  const signedIn = !authEnabled || Boolean(session);
  const canUsePrivateActions = signedIn && (!authEnabled || !profileRequired);
  const dashboardAvatarUrl = avatarUrlForSession(session, profile);
  const dashboardInitial = initialForSession(session, profile);

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

  const loadItems = useCallback(async () => {
    const body = await getItems();
    setItems((body.items || []).map(mapItem));
  }, []);

  const loadControls = useCallback(async () => {
    const credentialBody = await getProviderCredentials();
    setCredentials(credentialBody.credentials || []);
    setCredentialOptions(credentialBody.options || null);
  }, []);

  const mergeUpdatedItem = useCallback((updated) => {
    const nextItem = mapItem(updated);
    setItems((current) => current.map((entry) => (entry.id === nextItem.id ? nextItem : entry)));
    setSearchResults((current) => (current ? current.map((entry) => (entry.id === nextItem.id ? nextItem : entry)) : current));
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
          const profileBody = await getProfile();
          applyProfileState(profileBody.profile, profileBody.required);
          identifyPostHogUser(currentSession, profileBody.profile);
          if (profileBody.required) return;
        }
        await Promise.all([loadItems(), loadControls()]);
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
        setSearchResults(null);
        setCredentials([]);
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
        setSearchResults(null);
        setCredentials([]);
        setProfile(null);
        setProfileRequired(false);
        setLoading(false);
        resetPostHogUser();
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [authEnabled, loadControls, loadItems]);

  useEffect(() => {
    gsap.set([sidebarRef.current, '.dash-panel', '.dash-panel-inner'], { clearProps: 'opacity,transform' });
  }, []);

  useEffect(() => {
    const onDashboardLocationChange = () => {
      setTab(dashboardTabFromLocation());
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
    gsap.fromTo(
      '.dash-panel-inner',
      { opacity: 0.92, y: 6 },
      { opacity: 1, y: 0, duration: 0.18, ease: 'power2.out', clearProps: 'opacity,transform' },
    );
  }, [tab]);

  const boardItems = searchResults || items;
  const searchActive = searchResults !== null;
  const collections = useMemo(() => ['all', ...unique(boardItems.map((item) => item.collection))], [boardItems]);
  const platforms = useMemo(() => ['all', ...unique(boardItems.map((item) => item.platform))], [boardItems]);
  const pendingReviews = useMemo(() => items.filter((item) => item.sourceStatus === 'needs_review'), [items]);

  const filtered = useMemo(() => {
    return boardItems.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (collectionFilter !== 'all' && item.collection !== collectionFilter) return false;
      if (platformFilter !== 'all' && item.platform !== platformFilter) return false;
      return true;
    });
  }, [boardItems, collectionFilter, platformFilter, statusFilter]);

  const stats = useMemo(() => ({
    total: items.length,
    done: items.filter((item) => item.status === 'done').length,
    enriched: items.filter((item) => ENRICHED_STAGES.has(item.indexingStage)).length,
    needsReview: items.filter((item) => item.sourceStatus === 'needs_review').length,
    paused: items.filter((item) => item.status === 'paused' || item.status === 'failed').length,
  }), [items]);
  const indexingActivity = useMemo(() => summarizeIndexing(items), [items]);

  useEffect(() => {
    if (!canUsePrivateActions || indexingActivity.activeTotal <= 0) return undefined;
    const timer = window.setInterval(() => {
      loadItems().catch((err) => setError(err.message));
    }, 3500);
    return () => window.clearInterval(timer);
  }, [canUsePrivateActions, indexingActivity.activeTotal, loadItems]);

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
      await Promise.all([loadItems(), loadControls()]);
      setNotice('Profile saved. Your private library is ready.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSearch = async (event) => {
    event?.preventDefault();
    if (!requireSignIn('search your library')) return;
    const searchRun = activeSearchRef.current + 1;
    activeSearchRef.current = searchRun;
    setBusy(true);
    setError('');
    try {
      if (!query.trim()) {
        setSearchResults(null);
        await loadItems();
      } else {
        const body = await searchItems(query);
        const mappedResults = (body.results || []).map(mapItem);
        setSearchResults(mappedResults);
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
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveLink = useCallback(async (event, override = null) => {
    event?.preventDefault();
    if (!requireSignIn('save links')) return;
    if (!requireProfile('save links')) return;
    const payload = override || linkForm;
    if (!String(payload.url || '').trim()) {
      setError('Paste a link first.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await saveLink({ ...payload, startProcessing: false });
      const duplicate = result.skippedDuplicateCount > 0;
      setNotice(duplicate ? 'That link was already in your brain.' : 'Link saved to review. Approve it when you want it searchable.');
      setLinkForm({ url: '', title: '', description: '', note: '' });
      window.localStorage.removeItem('iscraper.pendingSaveLink');
      await loadItems();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [linkForm, loadItems, requireProfile, requireSignIn]);

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
        replaceAppTabUrl('upload');
        resetPageScroll();
        setLinkForm({
          url: pending.url || '',
          title: pending.title || '',
          description: pending.description || '',
          note: pending.note || '',
        });
        if (pending.autoSave) {
          handleSaveLink(null, pending);
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
    if (!requireSignIn('import saves')) return;
    if (!requireProfile('import saves')) return;
    if (!files.length) {
      setError('Upload an Instagram ZIP/HTML/JSON file or your Pinterest export ZIP/JSON/CSV.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const selectedFiles = importCandidateFiles(files, importSourceType);
      validateExportFiles(selectedFiles, importSourceType);
      if (selectedFiles.length > 20) {
        throw new Error('Upload at most 20 export files at once. For full exports, upload the original ZIP instead of every folder file.');
      }
      const storageFiles = shouldUseStorageUpload(selectedFiles)
        ? await uploadImportFilesToStorage({ files: selectedFiles, session })
        : null;
      const result = storageFiles
        ? await queueStorageImport({ files: storageFiles, sourceType: importSourceType })
        : await importInstagramExport({ files: selectedFiles, sourceType: importSourceType });
      if (result.importQueued) {
        setNotice('Upload received. Parsing from Supabase Storage now.');
      } else {
        const newCount = result.newItemCount ?? result.itemCount ?? 0;
        const skippedCount = result.skippedDuplicateCount ?? 0;
        setNotice(`Added ${newCount} new saves. ${skippedCount} already existed. They are searchable from metadata.`);
      }
      await loadItems();
    } catch (err) {
      setError(err.message);
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
      setNotice('Approved. Searchable from metadata. Open it to enrich.');
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
    const plannedCredentials = selectedSetup.credentials(credentialOptions);
    const validationMessage = keyValidationMessage(credentialForm.setup, credentialForm.apiKey);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    setBusy(true);
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
      setNotice(`${selectedSetup.shortLabel} key saved. IScraper will use our default models automatically.`);
    } catch (err) {
      setError(savedCredentials.length ? `Some key settings were saved, but one failed: ${err.message}` : err.message);
      await loadControls().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const navItems = [
    ['library', 'Saved library', Brain],
    ['graph', 'Graph', GitBranch],
    ['upload', 'Add saves', Upload],
    ['settings', 'Keys & privacy', Settings],
  ];

  const selectTab = useCallback((nextTab) => {
    if (!['library', 'graph', 'upload', 'settings'].includes(nextTab)) return;
    setTab(nextTab);
    replaceAppTabUrl(nextTab);
    resetPageScroll();
  }, []);

  useLayoutEffect(() => {
    resetPageScroll();
    const frame = window.requestAnimationFrame(resetPageScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [tab]);

  return (
    <div className="flex h-screen overflow-hidden bg-black text-foreground">
      <aside ref={sidebarRef} className="hidden h-screen w-60 shrink-0 flex-col overflow-hidden border-r border-white/5 bg-black md:flex">
        <button onClick={onBack} className="flex items-center gap-3 border-b border-white/5 px-5 py-4 transition hover:opacity-80">
          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          <BrandLogo className="h-14 w-40" />
        </button>
        {profile?.username && (
          <button
            type="button"
            onClick={() => setAccountSettingsOpen(true)}
            className="flex w-full items-center gap-3 border-b border-white/5 px-5 py-3 text-left text-xs text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-white/10 bg-primary text-sm font-bold text-primary-foreground">
              {dashboardAvatarUrl ? <img src={dashboardAvatarUrl} alt="" className="h-full w-full object-cover" /> : dashboardInitial}
            </span>
            <span className="min-w-0">
              <span className="block">Signed in as</span>
              <span className="block truncate font-semibold text-foreground">@{profile.username}</span>
            </span>
          </button>
        )}
        {authEnabled && !session && (
          <div className="border-b border-white/5 px-5 py-3">
            <button
              type="button"
              onClick={onOpenLogin}
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Sign in
            </button>
          </div>
        )}
        {authEnabled && session && profileRequired && (
          <div className="border-b border-white/5 px-5 py-3 text-xs leading-5 text-muted-foreground">
            Choose a username before importing or saving.
          </div>
        )}
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map(([key, title, Icon]) => (
            <button
              key={key}
              onClick={() => selectTab(key)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                tab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" /> {title}
            </button>
          ))}
          <button
            type="button"
            onClick={onOpenHowTo}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
          >
            <FileText className="h-4 w-4" /> How to Use
          </button>
        </nav>
        <div className="border-t border-white/5 p-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {stats.total} saves · {stats.done} searchable
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="dash-panel h-screen overflow-y-auto overflow-x-hidden">
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
              <div className="grid min-h-screen place-items-center text-muted-foreground">Loading your saved index...</div>
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
                {canUsePrivateActions && tab === 'library' && (
                  <LibraryTab
                    items={filtered}
                    totalCount={items.length}
                    searchActive={searchActive}
                    searchResultCount={boardItems.length}
                    query={query}
                    setQuery={setQuery}
                    onClearSearch={() => {
                      activeSearchRef.current += 1;
                      setSearchResults(null);
                      setQuery('');
                    }}
                    onSearch={handleSearch}
                    busy={busy}
                    statusFilter={statusFilter}
                    setStatusFilter={setStatusFilter}
                    collectionFilter={collectionFilter}
                    setCollectionFilter={setCollectionFilter}
                    collections={collections}
                    platformFilter={platformFilter}
                    setPlatformFilter={setPlatformFilter}
                    platforms={platforms}
                    onSelect={openDetail}
                    indexingActivity={indexingActivity}
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
                    files={files}
                    setFiles={setFiles}
                    importSourceType={importSourceType}
                    setImportSourceType={setImportSourceType}
                    linkForm={linkForm}
                    setLinkForm={setLinkForm}
                    onSaveLink={handleSaveLink}
                    onImport={handleImport}
                    pendingReviews={pendingReviews}
                    onApproveReview={handleApproveReview}
                    onUpdateReview={handleUpdateReview}
                    onSelect={openDetail}
                    busy={busy}
                    onOpenHowTo={onOpenHowTo}
                    indexingActivity={indexingActivity}
                  />
                )}
                {authEnabled && !session && tab === 'settings' && (
                  <AuthRequiredPanel
                    title="Sign in to manage keys."
                    copy="API keys and privacy settings belong to your account."
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
                    credentialForm={credentialForm}
                    setCredentialForm={setCredentialForm}
                    onSave={saveCredential}
                    onDelete={async (id) => {
                      setBusy(true);
                      await deleteProviderCredential(id).then(loadControls).catch((err) => setError(err.message));
                      setBusy(false);
                    }}
                    onTest={async (id) => {
                      setBusy(true);
                      await testProviderCredential(id).then(() => setNotice('Provider key works.')).catch((err) => setError(err.message));
                      setBusy(false);
                    }}
                    busy={busy}
                    authEnabled={authEnabled}
                    onOpenHowTo={onOpenHowTo}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {selected && <DetailDrawer item={selected} onClose={() => setSelected(null)} onApprove={handleApproveReview} busy={busy} />}
      {accountSettingsOpen && (
        <AccountSettingsModal
          open
          onClose={() => setAccountSettingsOpen(false)}
          session={session}
          profile={profile}
          onProfileSaved={(nextProfile) => {
            applyProfileState(nextProfile, false);
            setNotice('Profile saved.');
          }}
        />
      )}
    </div>
  );
}

function AccountSettingsModal({ open, onClose, session, profile, onProfileSaved }) {
  const [activeTab, setActiveTab] = useState('account');
  const [profileForm, setProfileForm] = useState({
    username: profile?.username || '',
    avatarUrl: profile?.avatarUrl || avatarUrlForSession(session, profile) || '',
  });
  const [credentials, setCredentials] = useState([]);
  const [healthByGroup, setHealthByGroup] = useState({});
  const [revealedByGroup, setRevealedByGroup] = useState({});
  const [confirmRevealGroup, setConfirmRevealGroup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const avatarUrl = avatarUrlForSession(session, profile);
  const initial = initialForSession(session, profile);
  const groupedCredentials = Object.values(groupProviderCredentials(credentials));
  const email = session?.user?.email || 'Not available';

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getProviderCredentials()
      .then((body) => {
        if (!cancelled) setCredentials(body.credentials || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
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

  const handleLogout = async () => {
    setBusy(true);
    setError('');
    try {
      await supabase.auth.signOut();
      onClose();
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

  return (
    <div
      className="fixed inset-0 z-[220] grid place-items-center bg-black/75 px-3 py-5 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="flex h-[90vh] w-[94vw] max-w-6xl flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-black text-foreground shadow-[0_30px_120px_rgba(0,0,0,0.75)] md:h-[70vh] md:w-[70vw]">
        <header className="flex items-center justify-between gap-4 border-b border-white/10 p-4 md:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full border border-white/10 bg-primary font-display text-lg font-bold text-primary-foreground">
              {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : initial}
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-bold tracking-tight">Account settings</h2>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 text-muted-foreground transition hover:bg-white/10 hover:text-foreground" aria-label="Close settings">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[13rem_1fr]">
          <nav className="flex gap-2 overflow-x-auto border-b border-white/10 p-3 md:block md:space-y-2 md:overflow-visible md:border-b-0 md:border-r">
            {[
              ['account', User, 'Account'],
              ['profile', Settings, 'Profile'],
              ['api', KeyRound, 'API Health'],
            ].map(([key, Icon, label]) => (
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

          <div className="min-h-0 overflow-y-auto p-4 md:p-6">
            {(error || message) && (
              <div className="mb-4">
                {error ? <Banner type="error">{error}</Banner> : <Banner>{message}</Banner>}
              </div>
            )}

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

            {activeTab === 'api' && (
              <div className="space-y-5">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">API Health</div>
                  <h3 className="mt-2 font-display text-3xl font-bold tracking-tight">Your saved keys</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">Keys stay hidden until you choose to reveal one.</p>
                </div>
                {groupedCredentials.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-muted-foreground">
                    No API keys saved yet. Add OpenRouter from Keys & privacy when you are ready.
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
                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-3 text-xs font-semibold transition hover:bg-white/5 disabled:opacity-60"
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
                            <div className="mt-3 rounded-xl border border-orange-500/40 bg-orange-500/10 p-3 text-sm leading-6 text-orange-100">
                              Revealing an API key exposes the full secret on this screen. Only do this on your own device.
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button type="button" onClick={() => handleReveal(group)} className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-black">Reveal key</button>
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
          </div>
        </div>
      </section>
    </div>
  );
}

function AuthRequiredPanel({ title, copy, busy, onSignIn }) {
  return (
    <div className="grid min-h-[70vh] place-items-center px-6 py-16">
      <div className="glow-ring w-full max-w-md rounded-2xl border border-white/10 bg-black p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-primary" />
        <h1 className="mt-5 font-display text-4xl font-bold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy}</p>
        <button
          type="button"
          onClick={onSignIn}
          disabled={busy}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Sign in
        </button>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">By continuing, you agree to the Terms of Service and Privacy Policy.</p>
      </div>
    </div>
  );
}

function ProfileRequiredPanel({ profileForm, setProfileForm, onAvatarFile, onSave, busy }) {
  return (
    <div className="grid min-h-[70vh] place-items-center px-6 py-16">
      <form onSubmit={onSave} className="glow-ring w-full max-w-md rounded-2xl border border-white/10 bg-black p-8">
        <h1 className="font-display text-4xl font-bold tracking-tight">Choose your username</h1>
        <p className="mt-2 text-sm text-muted-foreground">Required before importing. Usernames are unique.</p>
        <label className="mt-6 block font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Username</label>
        <input
          value={profileForm.username}
          onChange={(event) => setProfileForm((current) => ({ ...current, username: event.target.value.toLowerCase() }))}
          placeholder="your_username"
          pattern="[a-z0-9_]{3,24}"
          className="mt-2 w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
          required
        />
        <label className="mt-5 block font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Profile picture optional</label>
        <div className="mt-2 flex items-center gap-3">
          <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border border-white/10 bg-white/5">
            {profileForm.avatarUrl ? <img src={profileForm.avatarUrl} alt="" className="h-full w-full object-cover" /> : <Brain className="h-5 w-5 text-muted-foreground" />}
          </div>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onAvatarFile} className="min-w-0 text-xs text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary-foreground" />
        </div>
        <button disabled={busy} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save profile
        </button>
      </form>
    </div>
  );
}

function MobileTopbar({ onBack, tab, setTab, onOpenHowTo, session, profile, onOpenAccount }) {
  const avatarUrl = avatarUrlForSession(session, profile);
  const initial = initialForSession(session, profile);
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
      <div className="grid grid-cols-4 gap-2">
        {[
          ['library', 'Library'],
          ['graph', 'Graph'],
          ['upload', 'Add'],
          ['settings', 'Privacy'],
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

function summarizeIndexing(items) {
  const metadata = items.filter((item) => item.indexingStage === 'metadata_ready').length;
  const text = items.filter((item) => item.indexingStage === 'text_indexed').length;
  const visual = items.filter((item) => item.indexingStage === 'visual_indexed').length;
  const deep = items.filter((item) => item.indexingStage === 'deep_indexed').length;
  const indexing = items.filter((item) => item.indexingStage === 'visual_indexing').length;
  const failed = items.filter((item) => item.indexingStage === 'index_failed').length;
  const total = items.filter((item) => item.sourceStatus !== 'needs_review').length;
  const enriched = visual + deep;
  const progress = total > 0 ? Math.round(((text + enriched) / total) * 100) : 0;

  return {
    metadata,
    text,
    visual,
    deep,
    indexing,
    failed,
    active: indexing,
    activeTotal: indexing,
    enriched,
    progress,
  };
}

function IndexingProgressCard({ activity }) {
  if (!activity.activeTotal) return null;

  const progress = Math.min(99, Math.max(2, activity.progress));

  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-primary/30 bg-primary/5 p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Enrichment in progress</div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">
            {activity.activeTotal} saves are being enriched
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Search stays available while opened items get visual, OCR, or transcript context when the model can access it.
          </p>
        </div>
        <div className="grid min-w-36 gap-1 rounded-xl border border-white/10 bg-black px-4 py-3 text-center">
          <span className="font-display text-3xl font-bold text-primary">{activity.active}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">active now</span>
        </div>
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>{activity.indexing} indexing</span>
        <span>{activity.visual} visual indexed</span>
        <span>{activity.deep} transcript ready</span>
      </div>
    </div>
  );
}

function LibraryTab({
  items,
  totalCount,
  searchActive,
  searchResultCount,
  query,
  setQuery,
  onClearSearch,
  onSearch,
  busy,
  statusFilter,
  setStatusFilter,
  collectionFilter,
  setCollectionFilter,
  collections,
  platformFilter,
  setPlatformFilter,
  platforms,
  onSelect,
  indexingActivity,
}) {
  const boardRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(80);
  const activeFilters = (statusFilter !== 'all' ? 1 : 0) + (collectionFilter !== 'all' ? 1 : 0) + (platformFilter !== 'all' ? 1 : 0);
  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const searchableCount = items.filter((item) => item.sourceStatus !== 'needs_review').length;
  const enrichedCount = items.filter((item) => ENRICHED_STAGES.has(item.indexingStage)).length;
  const boardStats = useMemo(() => ([
    ['All saves', totalCount],
    ['On this board', items.length],
    ['Searchable', searchableCount],
    ['Enriched', enrichedCount],
    ]), [enrichedCount, items.length, searchableCount, totalCount]);

  useEffect(() => {
    const cards = boardRef.current?.querySelectorAll('.pin-card');
    if (!cards?.length) return undefined;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || cards.length > 48) {
      gsap.set(cards, { autoAlpha: 1, y: 0, scale: 1, clearProps: 'transform,opacity,visibility' });
      return undefined;
    }

    gsap.fromTo(
      cards,
      { autoAlpha: 0, y: 28, scale: 0.98 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: 'power3.out', stagger: 0.035, clearProps: 'transform,opacity,visibility' },
    );
    return undefined;
  }, [collectionFilter, items, platformFilter, statusFilter, visibleCount]);

  return (
    <div className="mx-auto max-w-[1480px] px-4 py-8 sm:px-6 md:px-10 md:py-12">
      <div className="mb-7 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Saved board</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-6xl">Your saves, laid out like ideas.</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
            Captions, hashtags, collections, and source metadata search instantly. Open a save when you want deeper visual or transcript context.
          </p>
        </div>

        <form
          onSubmit={(event) => {
            setVisibleCount(80);
            onSearch(event);
          }}
          className="flex min-h-16 w-full items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 shadow-2xl shadow-black/40 transition focus-within:border-primary xl:max-w-xl"
        >
          <Search className="h-5 w-5 shrink-0 text-primary" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              if (!nextQuery.trim() && searchActive) {
                setVisibleCount(80);
                onClearSearch();
              }
            }}
            placeholder="Search recipes, outfits, trips, products..."
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-lg"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setVisibleCount(80);
                onClearSearch();
              }}
              className="rounded-full p-1 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button type="submit" className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:scale-[1.02]">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
          </button>
        </form>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {boardStats.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</div>
            <div className="mt-2 font-display text-3xl font-bold">{value}</div>
          </div>
        ))}
      </div>

      <IndexingProgressCard activity={indexingActivity} />

      <div className="sticky top-0 z-20 -mx-4 mt-5 border-y border-white/5 bg-black/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 md:-mx-10 md:px-10">
        <div className="flex flex-col gap-3 text-xs font-mono text-muted-foreground md:flex-row md:items-center md:justify-between">
          <span>
            {visibleItems.length} showing from {items.length} matching saves
            {searchActive ? ` · ${searchResultCount} search results from ${totalCount} total saves` : ''}
          </span>
          <div className="flex flex-wrap gap-2">
            <DashboardFilterSelect
              label="Status"
              ariaLabel="Filter by status"
              icon={Filter}
              value={statusFilter}
              options={STATUSES}
              onChange={(nextStatus) => {
                  setVisibleCount(80);
                  setStatusFilter(nextStatus);
                }}
            />
            <DashboardFilterSelect
              label="Platform"
              ariaLabel="Filter by platform"
              value={platformFilter}
              options={platforms}
              onChange={(nextPlatform) => {
                  setVisibleCount(80);
                  setPlatformFilter(nextPlatform);
                }}
            />
            <DashboardFilterSelect
              label="Collection"
              ariaLabel="Filter by collection"
              value={collectionFilter}
              options={collections}
              onChange={(nextCollection) => {
                  setVisibleCount(80);
                  setCollectionFilter(nextCollection);
                }}
            />
            {activeFilters > 0 && <span className="rounded-full bg-primary px-3 py-2 text-primary-foreground">{activeFilters} active</span>}
          </div>
        </div>
      </div>

      <div className="mt-8">
        {items.length === 0 ? (
          <div className="rounded-[2rem] border border-dashed border-white/10 p-20 text-center text-muted-foreground">
            Nothing searchable yet, or nothing matches your filters.
          </div>
        ) : (
          <div ref={boardRef} className="columns-1 gap-5 sm:columns-2 lg:columns-3 2xl:columns-4">
            {visibleItems.map((item, index) => <PinCard key={item.id} item={item} index={index} onClick={() => onSelect(item)} />)}
          </div>
        )}
      </div>

      {visibleItems.length < items.length && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setVisibleCount((count) => count + 80)}
            className="rounded-full border border-white/10 bg-white/[0.04] px-6 py-3 text-sm font-semibold transition hover:border-primary hover:text-primary"
          >
            Show more saves
          </button>
        </div>
      )}
    </div>
  );
}

const PIN_BACKDROPS = [
  '#d6ff24',
  '#f4f4f0',
  '#ff6a00',
  '#29ffc6',
  '#ffb347',
  '#ff8a1f',
];

const PIN_HEIGHTS = ['min-h-72', 'min-h-96', 'min-h-80', 'min-h-[28rem]', 'min-h-64', 'min-h-[24rem]'];

function firstUsefulCardChip(item) {
  return [item.collection, item.tags[0], item.topics[0], item.brands[0], item.tools[0]]
    .map((value) => String(value || '').trim())
    .find((value) => value && value !== 'Unsorted');
}

function shortCardText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function PinCard({ item, index, onClick }) {
  const meta = item.sourceStatus === 'needs_review'
    ? STATUS_META.needs_review
    : INDEXING_META[item.indexingStage] || INDEXING_META.metadata_ready;
  const Icon = meta.icon;
  const chip = firstUsefulCardChip(item);
  const preview = shortCardText(item.sourceDescription || item.visual || item.summary || item.caption || 'Open this save to see what was captured.');
  const backdrop = PIN_BACKDROPS[index % PIN_BACKDROPS.length];
  const height = PIN_HEIGHTS[index % PIN_HEIGHTS.length];
  const cardTitle = shortCardText(item.sourceTitle || item.title || 'Saved post');
  const source = shortCardText(item.sourceAuthor || item.user || item.platform || 'Saved source');

  return (
    <button
      type="button"
      onClick={onClick}
      className="pin-card group mb-5 block w-full break-inside-avoid overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.035] text-left shadow-2xl shadow-black/30 transition duration-300 hover:-translate-y-1 hover:border-primary/60 hover:bg-white/[0.055]"
    >
      <div className={`relative flex ${height} flex-col justify-between overflow-hidden p-5 text-black`} style={{ background: backdrop }}>
        {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50 mix-blend-multiply" loading="lazy" /> : null}
        <div className="absolute inset-0 opacity-25 grid-bg" />
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/45 blur-2xl" />
        <div className="relative flex items-center justify-between gap-3">
          <span className="rounded-full bg-black/75 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-white">{item.platform}</span>
          <span className="rounded-full bg-white/70 p-2 text-black">
            <Eye className="h-4 w-4" />
          </span>
        </div>
        <div className="relative">
          {chip && (
            <span className="mb-3 inline-flex max-w-full rounded-full bg-black/15 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-black">
              <span className="truncate">{chip}</span>
            </span>
          )}
          <h3 className="line-clamp-3 font-display text-3xl font-bold leading-none tracking-tight md:text-[2.35rem]">{cardTitle}</h3>
        </div>
      </div>
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="truncate font-mono text-xs text-primary">{source}</span>
          <span className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${meta.color}`}>
            <Icon className={`h-3 w-3 ${item.indexingStage === 'visual_indexing' ? 'animate-spin' : ''}`} />
            {item.sourceStatus === 'needs_review' ? 'Review' : meta.label}
          </span>
        </div>
        <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{preview}</p>
        <div className="mt-4 flex items-center justify-end border-t border-white/10 pt-4 text-muted-foreground">
          <ExternalLink className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
      </div>
    </button>
  );
}

function UploadTab({
  files,
  setFiles,
  importSourceType,
  setImportSourceType,
  linkForm,
  setLinkForm,
  onSaveLink,
  onImport,
  pendingReviews,
  onApproveReview,
  onUpdateReview,
  onSelect,
  busy,
  onOpenHowTo,
  indexingActivity,
}) {
  const [dragging, setDragging] = useState(false);
  const sourceOptions = [
    { value: 'auto', label: 'Auto-detect', help: 'Best for full export ZIPs.' },
    { value: 'instagram', label: 'Instagram', help: 'Looks in your_instagram_activity/saved/.' },
    { value: 'pinterest', label: 'Pinterest', help: 'Reads Pinterest ZIP, JSON, CSV, or HTML.' },
  ];
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-20">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Add your saved posts</h1>
          <p className="mt-2 text-sm text-muted-foreground">Paste links or upload exports. Saves are added and searchable from metadata first, then enriched when opened.</p>
        </div>
        <button
          type="button"
          onClick={onOpenHowTo}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-white/5"
        >
          <FileText className="h-4 w-4" /> How to Use
        </button>
      </div>

      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Launch offer</div>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">First 200 imported saves are on us.</h2>
          </div>
          <span className="rounded-full bg-primary px-4 py-2 font-display text-xl font-bold text-primary-foreground">200</span>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Use your free included allowance for posts you actually open or inspect. Imports stay instantly searchable from captions, hashtags, collections, and source metadata.
        </p>
      </div>

      <IndexingProgressCard activity={indexingActivity} />

      <form onSubmit={onSaveLink} className="space-y-4 rounded-2xl border border-primary/30 bg-primary/5 p-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Save from any platform</div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Add a Pinterest pin, tweet, video, post, or article</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            New web links go into review first. Approving makes their captured metadata searchable.
          </p>
        </div>
        <input
          type="url"
          value={linkForm.url}
          onChange={(event) => setLinkForm((current) => ({ ...current, url: event.target.value }))}
          placeholder="https://pinterest.com/pin/..."
          required
          className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
        />
        <input
          value={linkForm.title}
          onChange={(event) => setLinkForm((current) => ({ ...current, title: event.target.value }))}
          placeholder="Title optional"
          maxLength={160}
          className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
        />
        <textarea
          value={linkForm.note}
          onChange={(event) => setLinkForm((current) => ({ ...current, note: event.target.value }))}
          placeholder="Why are you saving this? optional"
          maxLength={500}
          className="min-h-24 w-full resize-none rounded-xl border border-white/10 bg-black px-4 py-3 text-sm leading-6 outline-none focus:border-primary"
        />
        <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
          Save to review inbox
        </button>
      </form>

      {pendingReviews.length > 0 && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Review inbox</div>
              <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">{pendingReviews.length} saves waiting</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Clean up the title and notes before making the save searchable.</p>
            </div>
            <button
              type="button"
              onClick={async () => {
                for (const item of pendingReviews) {
                  await onApproveReview(item);
                }
              }}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Approve all reviewed
            </button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {pendingReviews.map((item) => (
              <ReviewCard
                key={item.id}
                item={item}
                busy={busy}
                onSelect={onSelect}
                onUpdate={onUpdateReview}
                onApprove={onApproveReview}
              />
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <div className="mb-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Export source</div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Choose what you are importing</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {sourceOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setImportSourceType(option.value)}
              className={`rounded-xl border px-4 py-3 text-left transition ${
                importSourceType === option.value
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-white/10 bg-black text-muted-foreground hover:border-white/25 hover:text-foreground'
              }`}
            >
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className="mt-1 block text-xs leading-5">{option.help}</span>
            </button>
          ))}
        </div>
      </section>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          setFiles(Array.from(event.dataTransfer.files));
        }}
        className={`rounded-2xl border-2 border-dashed p-12 text-center transition md:p-16 ${dragging ? 'border-primary bg-primary/5' : 'border-white/15'}`}
      >
        <Upload className="mx-auto mb-5 h-10 w-10 text-primary" />
        <h3 className="mb-2 font-display text-xl font-bold">Upload your files here</h3>
        <p className="mb-6 font-mono text-xs text-muted-foreground">Instagram ZIP/HTML/JSON · Pinterest ZIP/JSON/CSV</p>
        <button
          type="button"
          onClick={onOpenHowTo}
          className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <FileText className="h-3.5 w-3.5" /> Need the export steps?
        </button>
        <br />
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:scale-[1.02]">
          Choose export files
          <input type="file" multiple accept=".html,.htm,.zip,.json,.csv" onChange={(event) => setFiles(Array.from(event.target.files || []))} className="hidden" />
        </label>
        <label className="ml-3 inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 px-6 py-3 text-sm font-semibold text-foreground transition hover:bg-white/5">
          Choose export folder
          <input type="file" multiple webkitdirectory="" directory="" onChange={(event) => setFiles(Array.from(event.target.files || []))} className="hidden" />
        </label>
        {files.length > 0 && (
          <div className="mt-6 space-y-2 text-left">
            {files.map((file) => (
              <div key={`${fileImportName(file)}-${file.size}`} className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-black px-4 py-2 text-sm">
                <span className="min-w-0 truncate font-mono">{fileImportName(file) || file.name}</span>
                <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <button onClick={onImport} disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
          Add and search from metadata
        </button>
      </div>
    </div>
  );
}

function ReviewCard({ item, busy, onSelect, onUpdate, onApprove }) {
  const [draft, setDraft] = useState({
    sourceTitle: item.sourceTitle || item.title || '',
    sourceAuthor: item.sourceAuthor || '',
    sourceDescription: item.sourceDescription || '',
    collection: item.collection === 'Unsorted' ? '' : item.collection,
  });

  const payload = {
    ...draft,
    collections: draft.collection ? [draft.collection] : item.raw?.collections || [],
  };

  return (
    <article className="rounded-2xl border border-white/10 bg-black p-4">
      <div className="mb-4 flex items-start gap-3">
        {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" loading="lazy" /> : null}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-widest text-primary">
            <span>{item.platform}</span>
            <span className="text-muted-foreground">{item.sourceStatus}</span>
          </div>
          <button type="button" onClick={() => onSelect(item)} className="line-clamp-2 text-left font-display text-xl font-bold tracking-tight hover:text-primary">
            {item.sourceTitle || item.title}
          </button>
        </div>
      </div>
      <div className="space-y-3">
        <input
          value={draft.sourceTitle}
          onChange={(event) => setDraft((current) => ({ ...current, sourceTitle: event.target.value }))}
          placeholder="Clean title"
          maxLength={160}
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={draft.sourceAuthor}
            onChange={(event) => setDraft((current) => ({ ...current, sourceAuthor: event.target.value }))}
            placeholder="Creator or source"
            maxLength={120}
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <input
            value={draft.collection}
            onChange={(event) => setDraft((current) => ({ ...current, collection: event.target.value }))}
            placeholder="Collection"
            maxLength={80}
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <textarea
          value={draft.sourceDescription}
          onChange={(event) => setDraft((current) => ({ ...current, sourceDescription: event.target.value }))}
          placeholder="Short note or reason you saved it"
          maxLength={500}
          className="min-h-24 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm leading-6 outline-none focus:border-primary"
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onUpdate(item, payload)}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold disabled:opacity-60"
        >
          <Check className="h-4 w-4" />
          Save edits
        </button>
        <button
          type="button"
          onClick={() => onApprove(item, payload)}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          <CheckCircle2 className="h-4 w-4" />
          Approve
        </button>
      </div>
    </article>
  );
}

function SettingsTab({
  credentials,
  credentialForm,
  setCredentialForm,
  onSave,
  onDelete,
  onTest,
  busy,
  authEnabled,
  onOpenHowTo,
}) {
  const selectedSetup = KEY_SETUP_OPTIONS[credentialForm.setup] || KEY_SETUP_OPTIONS.openrouter_all;
  const [providerWarning, setProviderWarning] = useState(null);
  const groupedCredentials = credentials.reduce((groups, credential) => {
    const key = `${credential.provider}:${credential.keyHint}`;
    if (!groups[key]) {
      groups[key] = {
        id: key,
        provider: credential.provider,
        keyHint: credential.keyHint,
        credentials: [],
      };
    }
    groups[key].credentials.push(credential);
    return groups;
  }, {});

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-20">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-4xl font-bold tracking-tight">Keys & privacy</h1>
            <span className="rounded-full bg-primary px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-primary-foreground">
              BYOK only
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Paste a valid key once. IScraper picks the right models for you.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenHowTo}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-white/5"
        >
          <FileText className="h-4 w-4" /> How to Use
        </button>
      </div>

      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Credit system status</div>
          <span className="rounded-full bg-white px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-black">
            Coming soon
          </span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Your first 200 imported saves are included without paid IScraper credits. You can add your own provider key later if you want provider control or higher personal limits.
        </p>
      </div>

      <section className="space-y-4 rounded-2xl border border-primary/30 bg-primary/5 p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Valid keys</div>
        <h2 className="font-display text-2xl font-bold tracking-tight">Use these keys only</h2>
        <div className="grid gap-3">
          {[
            ['OpenRouter', 'Recommended. One key covers summaries, image/video reading, and smart search.'],
            ['Gemini API', 'Good for image/video reading and basic summaries. No smart semantic search by itself.'],
            ['OpenAI / Anthropic / DeepSeek', 'Text summaries only. Not the best first setup.'],
          ].map(([title, copy]) => (
            <div key={title} className="rounded-xl border border-white/10 bg-black p-4">
              <div className="font-semibold">{title}</div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-white/10 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Browser extension</div>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Coming soon</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Extension tokens and Lens search from the browser will be available after the extension is published in the browser stores.
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-white/10 px-5 py-3 text-sm font-semibold text-muted-foreground">
            Coming soon
          </span>
        </div>
      </section>

      <form onSubmit={onSave} className="space-y-4 rounded-2xl border border-white/10 p-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Add key</div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Choose where your key is from</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            You do not need to choose a model. We handle that.
          </p>
        </div>
        <div className="grid gap-2 rounded-xl border border-white/10 p-1">
          {Object.entries(KEY_SETUP_OPTIONS).map(([setup, option]) => (
            <button
              key={setup}
              type="button"
              onClick={() => {
                if (setup !== 'openrouter_all' && credentialForm.setup === 'openrouter_all') {
                  setProviderWarning(setup);
                  return;
                }
                setCredentialForm((current) => ({ ...current, setup }));
              }}
              className={`rounded-lg px-4 py-3 text-left text-sm transition ${
                credentialForm.setup === setup
                  ? setup === 'openrouter_all'
                    ? 'bg-orange-500 text-black'
                    : 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
              }`}
            >
              <span className="block font-semibold">{option.label}</span>
              <span className={`mt-1 block text-xs leading-5 ${credentialForm.setup === setup ? 'text-black/75' : 'text-muted-foreground'}`}>{option.help}</span>
            </button>
          ))}
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-muted-foreground">
          Selected: <span className="font-semibold text-foreground">{selectedSetup.label}</span>. {selectedSetup.help}
        </div>
        <input
          type="password"
          value={credentialForm.apiKey}
          onChange={(event) => setCredentialForm((current) => ({ ...current, apiKey: event.target.value }))}
          placeholder="Paste API key"
          required
          className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 font-mono text-sm outline-none focus:border-primary"
        />
        <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Save key
        </button>
      </form>

      <div className="space-y-3">
        {Object.values(groupedCredentials).map((group) => (
          <div key={group.id} className="flex items-center gap-3 rounded-xl border border-white/10 p-4">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{PROVIDER_DISPLAY_LABELS[group.provider] || group.provider}</div>
              <div className="truncate text-xs text-muted-foreground">
                {group.credentials.map((credential) => credential.purpose).join(', ')} - {group.keyHint}
              </div>
            </div>
            <button onClick={() => onTest(group.credentials[0].id)} className="rounded-lg border border-white/10 p-2 text-primary" aria-label="Test key">
              <CheckCircle2 className="h-4 w-4" />
            </button>
            <button
              onClick={async () => {
                for (const credential of group.credentials) {
                  await onDelete(credential.id);
                }
              }}
              className="rounded-lg border border-white/10 p-2 text-destructive"
              aria-label="Delete key"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {authEnabled && (
        <button onClick={() => supabase.auth.signOut()} className="w-full rounded-xl border border-white/10 px-5 py-3 text-sm text-muted-foreground">
          Sign out
        </button>
      )}

      {providerWarning && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-orange-500/50 bg-black p-6 shadow-[0_24px_80px_rgba(0,0,0,0.65)]">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-orange-400">Recommended setup</div>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight">OpenRouter is the best setup.</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              OpenRouter is the simplest choice because one key can handle summaries, image/video reading, and smart search. Other keys may work, but output can be limited.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setCredentialForm((current) => ({ ...current, setup: 'openrouter_all' }));
                  setProviderWarning(null);
                }}
                className="rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-black"
              >
                Use OpenRouter
              </button>
              <button
                type="button"
                onClick={() => {
                  setCredentialForm((current) => ({ ...current, setup: providerWarning }));
                  setProviderWarning(null);
                }}
                className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-foreground"
              >
                Continue anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GraphTab({ onSelectItem }) {
  const [graph, setGraph] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const touchGestureRef = useRef(null);
  const prompt = [
    'I have exported my IScraper Obsidian graph to this path:',
    '',
    'PASTE_EXPORTED_GRAPH_ZIP_PATH_HERE',
    '',
    'Please import it into my Obsidian vault. Unzip the export if needed, create or update notes, preserve wikilinks, keep the IScraper Items and IScraper Graph folders, and do not delete existing vault files unless I explicitly ask.',
  ].join('\n');

  useEffect(() => {
    let cancelled = false;
    getKnowledgeGraph()
      .then((body) => {
        if (!cancelled) setGraph(body.graph);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleExport = async () => {
    setError('');
    try {
      const blob = await downloadObsidianGraph();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'iscraper-obsidian-graph.zip';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCopyPrompt = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const conceptNodes = graph?.nodes?.filter((node) => node.type !== 'item') || [];
  const itemNodes = graph?.nodes?.filter((node) => node.type === 'item') || [];
  const selectedNode = graph?.nodes?.find((node) => node.id === selectedNodeId) || null;
  const selectedNeighborIds = useMemo(() => {
    if (!selectedNodeId || !graph) return new Set();
    return new Set(graph.links.flatMap((link) => (
      link.source === selectedNodeId ? [link.target] : link.target === selectedNodeId ? [link.source] : []
    )));
  }, [graph, selectedNodeId]);
  const selectedConnections = useMemo(() => {
    if (!selectedNodeId || !graph) return [];
    return graph.links
      .filter((link) => link.source === selectedNodeId || link.target === selectedNodeId)
      .map((link) => {
        const otherId = link.source === selectedNodeId ? link.target : link.source;
        return graph.nodes.find((node) => node.id === otherId);
      })
      .filter(Boolean)
      .slice(0, 18);
  }, [graph, selectedNodeId]);

  const clampZoom = (value) => Math.max(0.55, Math.min(2.6, Number(value.toFixed(2))));

  const changeZoom = (delta) => {
    setZoom((current) => clampZoom(current + delta));
  };

  const getTouchDistance = (touches) => {
    const first = touches[0];
    const second = touches[1];
    return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
  };

  const handleGraphTouchStart = (event) => {
    if (event.touches.length >= 2) {
      dragRef.current = null;
      touchGestureRef.current = {
        mode: 'pinch',
        distance: getTouchDistance(event.touches),
        zoom,
      };
      return;
    }

    const touch = event.touches[0];
    touchGestureRef.current = {
      mode: 'pan',
      x: touch.clientX,
      y: touch.clientY,
      pan,
    };
  };

  const handleGraphTouchMove = (event) => {
    if (!touchGestureRef.current) return;
    event.preventDefault();

    if (event.touches.length >= 2) {
      const gesture = touchGestureRef.current.mode === 'pinch'
        ? touchGestureRef.current
        : { mode: 'pinch', distance: getTouchDistance(event.touches), zoom };
      touchGestureRef.current = gesture;
      const nextDistance = getTouchDistance(event.touches);
      setZoom(clampZoom(gesture.zoom * (nextDistance / Math.max(gesture.distance, 1))));
      return;
    }

    if (event.touches.length === 1 && touchGestureRef.current.mode === 'pan') {
      const touch = event.touches[0];
      setPan({
        x: touchGestureRef.current.pan.x + touch.clientX - touchGestureRef.current.x,
        y: touchGestureRef.current.pan.y + touch.clientY - touchGestureRef.current.y,
      });
    }
  };

  const handleGraphTouchEnd = (event) => {
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      touchGestureRef.current = { mode: 'pan', x: touch.clientX, y: touch.clientY, pan };
      return;
    }
    touchGestureRef.current = null;
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedNodeId(null);
  };

  return (
    <div className="mx-auto max-w-[1480px] space-y-6 px-4 py-8 sm:px-6 md:px-10 md:py-12">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Graph brain</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-6xl">Your indexed saves as a knowledge map.</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
            Nodes are built from indexed titles, topics, tags, brands, people, and collections. Export it when you want Obsidian or an AI agent to work with your saved-library graph.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button onClick={handleExport} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:scale-[1.02]">
            <Download className="h-4 w-4" />
            Export Obsidian graph
          </button>
          <button onClick={handleCopyPrompt} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-foreground transition hover:border-primary hover:text-primary">
            <Check className="h-4 w-4" />
            {copied ? 'Copied' : 'Copy AI prompt'}
          </button>
        </div>
      </div>

      {error && <Banner type="error">{error}</Banner>}

      <div className="grid gap-3 sm:grid-cols-3">
        <GraphStat label="Indexed saves" value={graph?.stats?.indexedItems ?? 0} />
        <GraphStat label="Concept nodes" value={graph?.stats?.conceptNodes ?? 0} />
        <GraphStat label="Graph links" value={graph?.stats?.links ?? 0} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="relative min-h-[520px] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
          <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-black/80 p-1 backdrop-blur">
            <button type="button" onClick={() => changeZoom(0.18)} className="rounded-full p-2 text-muted-foreground transition hover:bg-white/10 hover:text-primary" aria-label="Zoom in">
              <ZoomIn className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => changeZoom(-0.18)} className="rounded-full p-2 text-muted-foreground transition hover:bg-white/10 hover:text-primary" aria-label="Zoom out">
              <ZoomOut className="h-4 w-4" />
            </button>
            <button type="button" onClick={resetView} className="rounded-full p-2 text-muted-foreground transition hover:bg-white/10 hover:text-primary" aria-label="Reset graph view">
              <RotateCcw className="h-4 w-4" />
            </button>
            <span className="pr-3 font-mono text-[10px] text-muted-foreground">{Math.round(zoom * 100)}%</span>
          </div>
          <div className="absolute bottom-4 left-4 z-10 flex flex-wrap gap-2">
            {['item', 'topic', 'tag', 'brand', 'tool', 'person', 'collection'].map((type) => (
              <span key={type} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/70 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: graphNodeColor(type) }} />
                {type}
              </span>
            ))}
          </div>
          {busy ? (
            <div className="grid min-h-[520px] place-items-center text-muted-foreground">Loading graph...</div>
          ) : !graph?.nodes?.length ? (
            <div className="grid min-h-[520px] place-items-center px-8 text-center text-muted-foreground">
              No graph nodes yet. Add searchable saves first, then come back here.
            </div>
          ) : (
            <svg
              viewBox="0 0 1000 620"
              className="h-full min-h-[520px] w-full touch-none cursor-grab active:cursor-grabbing"
              onTouchStart={handleGraphTouchStart}
              onTouchMove={handleGraphTouchMove}
              onTouchEnd={handleGraphTouchEnd}
              onTouchCancel={() => {
                touchGestureRef.current = null;
              }}
              onPointerDown={(event) => {
                if (event.pointerType === 'touch') return;
                if (event.target.closest?.('[data-graph-node]')) return;
                event.currentTarget.setPointerCapture?.(event.pointerId);
                dragRef.current = { x: event.clientX, y: event.clientY, pan };
              }}
              onPointerMove={(event) => {
                if (event.pointerType === 'touch') return;
                if (!dragRef.current) return;
                const dx = event.clientX - dragRef.current.x;
                const dy = event.clientY - dragRef.current.y;
                setPan({ x: dragRef.current.pan.x + dx, y: dragRef.current.pan.y + dy });
              }}
              onPointerUp={(event) => {
                if (event.pointerType === 'touch') return;
                if (dragRef.current) event.currentTarget.releasePointerCapture?.(event.pointerId);
                dragRef.current = null;
              }}
              onPointerLeave={() => {
                dragRef.current = null;
              }}
            >
              <rect width="1000" height="620" fill="transparent" />
              <g transform={`translate(${500 + pan.x} ${310 + pan.y}) scale(${zoom})`}>
              {graph.links.map((link) => {
                const source = layout.get(link.source);
                const target = layout.get(link.target);
                if (!source || !target) return null;
                const isActive = selectedNodeId && (link.source === selectedNodeId || link.target === selectedNodeId);
                return (
                  <line
                    key={link.id}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={isActive ? 'rgba(165,255,24,0.75)' : 'rgba(165,255,24,0.18)'}
                    strokeWidth={isActive ? 2 : 0.9}
                  />
                );
              })}
              {graph.nodes.map((node) => {
                const point = layout.get(node.id);
                if (!point) return null;
                const isItem = node.type === 'item';
                const isSelected = selectedNodeId === node.id;
                const isNeighbor = selectedNeighborIds.has(node.id);
                const dim = selectedNodeId && !isSelected && !isNeighbor;
                const radius = isItem ? 9 : Math.min(17, 5 + Math.sqrt(node.weight || 1) * 3);
                const showLabel = isSelected || isNeighbor || isItem || (node.weight || 0) >= 3;
                const color = graphNodeColor(node.type);
                return (
                  <g
                    key={node.id}
                    data-graph-node
                    transform={`translate(${point.x} ${point.y})`}
                    className="cursor-pointer"
                    opacity={dim ? 0.22 : 1}
                    onClick={() => {
                      setSelectedNodeId((current) => (current === node.id ? null : node.id));
                    }}
                  >
                    <circle r={radius + (isSelected ? 9 : 5)} fill={color} opacity="0.16" />
                    <circle r={radius} fill={color} stroke={isSelected ? '#ffffff' : 'rgba(0,0,0,0.55)'} strokeWidth={isSelected ? 2 : 1} />
                    {showLabel && (
                      <text y={radius + 16} textAnchor="middle" className="pointer-events-none select-none fill-white text-[10px] font-semibold">
                        {node.label.slice(0, 24)}
                      </text>
                    )}
                  </g>
                );
              })}
              </g>
            </svg>
          )}
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
            <div className="flex items-start gap-3">
              <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: graphNodeColor(selectedNode?.type || 'item') }} />
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">
                  {selectedNode ? selectedNode.type : 'Selection'}
                </div>
                <h2 className="mt-1 line-clamp-2 font-display text-2xl font-bold tracking-tight">
                  {selectedNode ? selectedNode.label : 'Click a node'}
                </h2>
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {selectedNode
                ? selectedNode.type === 'item'
                  ? selectedNode.summary || 'No summary available.'
                  : `${selectedNode.itemCount || selectedConnections.length} linked saves or concepts.`
                : 'Click any node to show details, highlight local connections, and inspect nearby saves.'}
            </p>
            {selectedNode?.url && (
              <a href={selectedNode.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-xs text-primary">
                Open original post <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {selectedNode?.type === 'item' && (
              <button type="button" onClick={() => onSelectItem(selectedNode.itemId)} className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
                Open save detail
              </button>
            )}
            {selectedConnections.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Connected nodes</div>
                <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                  {selectedConnections.map((node) => (
                    <button key={node.id} type="button" onClick={() => setSelectedNodeId(node.id)} className="flex w-full items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-left text-xs transition hover:border-primary">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: graphNodeColor(node.type) }} />
                      <span className="min-w-0 flex-1 truncate">{node.label}</span>
                      <span className="text-[10px] uppercase text-muted-foreground">{node.type}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
            <h2 className="font-display text-2xl font-bold tracking-tight">AI-agent prompt</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">After export, paste the downloaded file path into this prompt before giving it to Claude, Codex, Cursor, or another local-file agent.</p>
            <textarea readOnly value={prompt} className="mt-4 h-56 w-full resize-none rounded-xl border border-white/10 bg-black p-4 font-mono text-xs leading-5 text-muted-foreground outline-none" />
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
            <h2 className="font-display text-2xl font-bold tracking-tight">Top concepts</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {conceptNodes.slice(0, 24).map((node) => (
                <span key={node.id} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-muted-foreground">
                  {node.label}
                </span>
              ))}
              {!conceptNodes.length && <span className="text-sm text-muted-foreground">No concept nodes yet.</span>}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
            <h2 className="font-display text-2xl font-bold tracking-tight">Indexed saves</h2>
            <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
              {itemNodes.slice(0, 40).map((node) => (
                <button key={node.id} onClick={() => onSelectItem(node.itemId)} className="block w-full rounded-xl border border-white/10 p-3 text-left transition hover:border-primary">
                  <div className="line-clamp-1 text-sm font-semibold">{node.label}</div>
                  <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{node.summary}</div>
                </button>
              ))}
              {!itemNodes.length && <span className="text-sm text-muted-foreground">No indexed saves yet.</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GraphStat({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 p-4">
      <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-2 font-display text-3xl font-bold">{value}</div>
    </div>
  );
}

function graphNodeColor(type) {
  const colors = {
    item: '#f4f4ef',
    topic: '#a5ff18',
    tag: '#22d3ee',
    brand: '#60a5fa',
    tool: '#f97316',
    person: '#f472b6',
    collection: '#c084fc',
  };
  return colors[type] || '#a5ff18';
}

function layoutGraph(graph) {
  const points = new Map();
  const nodes = graph?.nodes || [];
  const links = graph?.links || [];
  if (!nodes.length) return points;

  const simulationNodes = nodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / nodes.length;
    const radius = node.type === 'item' ? 190 : 80 + ((index * 37) % 130);
    return {
      ...node,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });
  const simulationLinks = links.map((link) => ({ source: link.source, target: link.target }));
  const simulation = forceSimulation(simulationNodes)
    .force('link', forceLink(simulationLinks).id((node) => node.id).distance((link) => {
      const source = typeof link.source === 'object' ? link.source : null;
      const target = typeof link.target === 'object' ? link.target : null;
      return source?.type === 'item' || target?.type === 'item' ? 82 : 48;
    }).strength(0.28))
    .force('charge', forceManyBody().strength((node) => (node.type === 'item' ? -360 : -160)))
    .force('collide', forceCollide().radius((node) => (node.type === 'item' ? 34 : 20)).strength(0.9))
    .force('center', forceCenter(0, 0))
    .stop();

  for (let index = 0; index < 260; index += 1) simulation.tick();

  const xs = simulationNodes.map((node) => node.x);
  const ys = simulationNodes.map((node) => node.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(860 / Math.max(maxX - minX, 1), 500 / Math.max(maxY - minY, 1), 1.6);

  for (const node of simulationNodes) {
    points.set(node.id, {
      x: (node.x - (minX + maxX) / 2) * scale,
      y: (node.y - (minY + maxY) / 2) * scale,
    });
  }
  return points;
}

const DETAIL_VERIFY_PATTERN = /\b(price|pricing|offer|deal|discount|sale|available|availability|launch|deadline|apply|application|terms|funding|equity|investment|grant|salary|rate|cost|coupon|waitlist|beta|limited|expires|202[0-9]|203[0-9])\b|[$]\s?\d/i;

function cleanDetailText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function detailCompareKey(value) {
  return cleanDetailText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isWeakDetailText(value) {
  const key = detailCompareKey(value);
  return !key
    || key === 'no summary yet'
    || key === 'untitled saved item'
    || key === 'useful saved instagram reference'
    || key === 'useful saved reference'
    || (key.startsWith('useful for') && key.length < 24);
}

function isRepeatedDetailText(value, previousValues = []) {
  const key = detailCompareKey(value);
  if (!key) return true;
  return previousValues.some((previous) => {
    const previousKey = detailCompareKey(previous);
    if (!previousKey) return false;
    return key === previousKey
      || (key.length > 90 && previousKey.includes(key))
      || (previousKey.length > 90 && key.includes(previousKey));
  });
}

function shortenDetailText(value, maxLength = 420) {
  const text = cleanDetailText(value);
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const boundary = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('; '), slice.lastIndexOf(', '), slice.lastIndexOf(' '));
  return `${slice.slice(0, boundary > 180 ? boundary : maxLength).trim()}...`;
}

function pickDistinctDetailText(candidates, previousValues = [], maxLength = 420) {
  const candidate = candidates.find((value) => !isWeakDetailText(value) && !isRepeatedDetailText(value, previousValues));
  return candidate ? shortenDetailText(candidate, maxLength) : '';
}

function humanList(values) {
  const items = values.filter(Boolean);
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

function inferDetailUse(item) {
  const topics = dedupeDetailItems([...(item.topics || []), ...(item.tags || [])]).slice(0, 3);
  const mentions = dedupeDetailItems([...(item.tools || []), ...(item.brands || []), ...(item.repos || [])]).slice(0, 3);
  if (!topics.length && !mentions.length) return '';
  const topicText = topics.length ? `researching ${humanList(topics)}` : '';
  const mentionText = mentions.length ? `tracking ${humanList(mentions)}` : '';
  return `Useful for ${[topicText, mentionText].filter(Boolean).join(' and ')}.`;
}

function dedupeDetailItems(values = [], excludeValues = []) {
  const seen = new Set(excludeValues.map(detailCompareKey));
  const items = [];
  for (const value of values) {
    const item = cleanDetailText(value);
    const key = detailCompareKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

function needsDetailVerification(item) {
  const text = [
    item.title,
    item.sourceTitle,
    item.sourceDescription,
    item.caption,
    item.summary,
    item.why,
    item.visual,
    item.ocr,
  ].filter(Boolean).join(' ');
  return DETAIL_VERIFY_PATTERN.test(text);
}

function buildOriginalDetailRows(item, insightRows = []) {
  const rows = [];
  const seen = insightRows.map((row) => row.text);
  const addRow = (label, value, icon, mono = false) => {
    const text = cleanDetailText(value);
    if (!text || isRepeatedDetailText(text, seen)) return;
    seen.push(text);
    rows.push({ label, text, icon, mono });
  };

  addRow('Source', [item.platform, item.sourceId].filter(Boolean).join(' / '), ExternalLink);
  addRow('Source description', item.sourceDescription, FileText);
  addRow('Caption', item.caption, FileText, true);
  addRow('Transcript', item.transcript, Activity, true);
  addRow('Words on screen', item.ocr, Eye, true);
  addRow('Visual notes', item.visual, Eye);
  return rows;
}

function buildDetailInsight(item) {
  const title = item.sourceTitle || item.title || '';
  const seen = [title];
  const what = pickDistinctDetailText([item.summary, item.visual, item.sourceDescription, item.caption], seen);
  if (what) seen.push(what);

  const why = pickDistinctDetailText([item.why, inferDetailUse(item)], seen, 360);
  if (why) seen.push(why);

  const visual = pickDistinctDetailText([item.visual, item.ocr], [...seen, item.sourceDescription, item.caption], 360);
  if (visual) seen.push(visual);

  const rows = [
    what ? { label: 'What this is', text: what, icon: Sparkles } : null,
    why ? { label: 'Why it matters', text: why, icon: Brain } : null,
    visual ? { label: 'What is shown', text: visual, icon: Eye } : null,
  ].filter(Boolean);

  const mentions = dedupeDetailItems([
    ...(item.tools || []),
    ...(item.brands || []),
    ...(item.people || []),
    ...(item.repos || []),
  ]).slice(0, 24);
  const topics = dedupeDetailItems([...(item.topics || []), ...(item.tags || [])], mentions).slice(0, 18);

  return {
    rows,
    mentions,
    topics,
    originalRows: buildOriginalDetailRows(item, rows),
    verify: needsDetailVerification(item),
  };
}

function DetailDrawer({ item, onClose, onApprove, busy }) {
  const ref = useRef(null);
  const indexingMeta = INDEXING_META[item.indexingStage] || INDEXING_META.metadata_ready;
  const IndexingIcon = indexingMeta.icon;
  const insight = useMemo(() => buildDetailInsight(item), [item]);
  useEffect(() => {
    gsap.fromTo(ref.current, { x: '100%' }, { x: 0, duration: 0.5, ease: 'power3.out' });
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/70 backdrop-blur-sm" />
      <div ref={ref} onClick={(event) => event.stopPropagation()} className="w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-black">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/90 px-8 py-5 backdrop-blur">
          <span className="font-mono text-xs text-muted-foreground">{item.id}</span>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-white/5" aria-label="Close detail">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-8 p-8">
          <div>
            <div className="mb-2 flex flex-wrap gap-2 font-mono text-xs text-primary">
              <span>{item.platform}</span>
              {item.sourceAuthor ? <span className="text-muted-foreground">/ {item.sourceAuthor}</span> : null}
              <span className={`inline-flex items-center gap-1 ${indexingMeta.color}`}>
                <IndexingIcon className={`h-3 w-3 ${item.indexingStage === 'visual_indexing' ? 'animate-spin' : ''}`} />
                {indexingMeta.label}
              </span>
            </div>
            {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className="mb-5 max-h-64 w-full rounded-2xl object-cover" /> : null}
            <h2 className="mb-3 font-display text-3xl font-bold tracking-tight">{item.sourceTitle || item.title}</h2>
            <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary">
              Open original save <ExternalLink className="h-3 w-3" />
            </a>
            {item.sourceStatus === 'needs_review' && (
              <button
                type="button"
                onClick={() => onApprove(item)}
                disabled={busy}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Approve and make searchable
              </button>
            )}
          </div>

          {item.error && <Section icon={AlertCircle} label="Error">{item.error}</Section>}
          {item.indexingError && <Section icon={AlertCircle} label="Enrichment note">{item.indexingError}</Section>}
          {item.indexingStage === 'visual_indexing' && <Section icon={Loader2} label="Enrichment">Understanding this save now. Metadata search stays available.</Section>}
          <InsightPanel insight={insight} />
          {insight.verify && (
            <Section icon={AlertCircle} label="Check before using">
              This save may mention dates, prices, funding, availability, or terms that can change. Verify the original source before acting on it.
            </Section>
          )}
          <ChipGroup icon={Bot} label="Mentioned" items={insight.mentions} />
          <ChipGroup icon={Hash} label="Topics" items={insight.topics} />
          <OriginalDetails rows={insight.originalRows} />
        </div>
      </div>
    </div>
  );
}

function InsightPanel({ insight }) {
  if (!insight.rows.length) return null;
  return (
    <div className="space-y-5 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
      {insight.rows.map(({ label, text, icon: Icon }) => (
        <div key={label}>
          <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            <Icon className="h-3 w-3" /> {label}
          </div>
          <div className="text-sm leading-relaxed text-foreground">{text}</div>
        </div>
      ))}
    </div>
  );
}

function OriginalDetails({ rows }) {
  if (!rows.length) return null;
  return (
    <details className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-mono text-xs uppercase tracking-widest text-muted-foreground">
        <span className="inline-flex items-center gap-2"><FileText className="h-3 w-3" /> Original source text</span>
        <ChevronDown className="h-4 w-4" />
      </summary>
      <div className="mt-5 space-y-6">
        {rows.map(({ label, text, icon, mono }) => (
          <Section key={label} icon={icon} label={label} mono={mono}>{text}</Section>
        ))}
      </div>
    </details>
  );
}

function Section({ icon: Icon, label, children, mono }) {
  if (!children) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className={`break-words text-sm leading-relaxed ${mono ? 'whitespace-pre-wrap font-mono text-xs text-muted-foreground' : ''}`}>{children}</div>
    </div>
  );
}

function ChipGroup({ icon: Icon, label, items }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <span key={item} className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 font-mono text-xs text-primary">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function Banner({ children, type = 'notice' }) {
  const isError = type === 'error';
  return (
    <div className={`mt-4 flex items-center gap-2 rounded-xl border p-4 text-sm ${
      isError ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-primary/30 bg-primary/5 text-primary'
    }`}>
      {isError ? <AlertCircle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
      {children}
    </div>
  );
}
