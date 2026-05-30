/* eslint-disable react-refresh/only-export-components */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  Clock,
  Columns2,
  Columns3,
  Copy,
  Database,
  Download,
  EyeOff,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  Folder,
  GitBranch,
  Hash,
  Images,
  KeyRound,
  LifeBuoy,
  List,
  Loader2,
  Lock,
  Mail,
  Mic,
  Pause,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tag,
  ThumbsDown,
  ThumbsUp,
  Upload,
  User,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';
import {
  askLibraryChat,
  archiveItem,
  approveReviewItem,
  cancelAccountDeletion,
  createAgentAccessToken,
  createDataExport,
  createExtensionToken,
  createNote,
  deleteProviderCredential,
  downloadDataExport,
  downloadObsidianGraph,
  getAgentAccessTokens,
  getAccountDeletion,
  getAccountSecurityActivity,
  getAccountSummary,
  getAdminSummary,
  getAdminUserDetailWithKey,
  getAdminUserTimelineWithKey,
  getAdminUsers,
  getDataExports,
  getItem,
  getItems,
  getItemsPage,
  getIndexingSummary,
  getCredits,
  getKnowledgeGraph,
  getOnboarding,
  getProfile,
  getPrivacyExportData,
  getPublicFeedback,
  getProviderCredentials,
  getUserDataMap,
  getSimilarVisuals,
  importInstagramExport,
  queueStorageImport,
  enrichIntentBatch,
  enrichItem,
  revealProviderCredential,
  recordSignInActivity,
  requestAccountDeletion,
  revokeAgentAccessToken,
  getSmartCollectionItems,
  getSmartCollections,
  refreshSmartCollections,
  saveLink,
  saveOnboarding,
  saveProfile,
  saveProviderCredential,
  searchItems,
  searchVisuals,
  setSmartCollectionItemOverride,
  setApiAccessToken,
  submitSearchFeedback,
  submitPublicFeedback,
  testProviderCredential,
  updateSmartCollection,
  updateReviewItem,
  checkLibraryLinks,
  createItemReminder,
  getLibraryCare,
  updateItemReminder,
} from './api';
import SmartCollectionsView from './components/SmartCollectionsView';
import VirtualLibraryGrid from './components/VirtualLibraryGrid';
import {
  AppShellSkeleton,
  DeferredSkeletonCardGrid,
  LoadingSpinner,
  ProgressBar,
  SkeletonBlock,
  SkeletonCardGrid,
  SkeletonRows,
} from './components/LoadingStates';
import { identifyPostHogUser, resetPostHogUser } from './posthog';
import { supabase } from './supabaseClient';

gsap.registerPlugin(ScrollTrigger);

const STATUS_META = {
  needs_review: { color: 'text-muted-foreground', icon: FileText },
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
  visual_indexing: { label: 'Indexing', color: 'text-muted-foreground', icon: Loader2 },
  visual_indexed: { label: 'Visual indexed', color: 'text-primary', icon: Eye },
  deep_indexed: { label: 'Transcript ready', color: 'text-primary', icon: Sparkles },
  index_failed: { label: 'Metadata', color: 'text-destructive', icon: AlertCircle },
};

const ENRICHED_STAGES = new Set(['visual_indexed', 'deep_indexed']);

const DASHBOARD_ENRICHED_STAGES = new Set(['text_indexed', 'visual_indexing', 'visual_indexed', 'deep_indexed']);

const STALE_ENRICHMENT_UI_MS = 15 * 60 * 1000;

const TYPE_FILTERS = ['all', 'uploaded', 'links', 'screenshots', 'voice_notes', 'notes'];

const STATE_FILTERS = ['all', 'searchable', 'failed'];

const SORT_OPTIONS = ['newest', 'oldest'];

const DASHBOARD_TABS = ['library', 'smart', 'care', 'graph', 'upload', 'settings'];

const SEARCH_MODES = ['saved', 'web'];

const LIBRARY_LAYOUT_STORAGE_KEY = 'iscraper.libraryLayout.v1';

const LIBRARY_LAYOUT_OPTIONS = ['grid-2', 'grid-3', 'gallery', 'list'];

const LIBRARY_LAYOUT_ITEMS = [
  { value: 'grid-2', label: '2 columns', shortLabel: '2', icon: Columns2 },
  { value: 'grid-3', label: '3 columns', shortLabel: '3', icon: Columns3 },
  { value: 'gallery', label: 'Gallery', shortLabel: 'Gallery', icon: Images },
  { value: 'list', label: 'List', shortLabel: 'List', icon: List },
];

const NOTE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const VISUAL_SEARCH_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const MAX_NOTE_IMAGES = 5;

const MAX_NOTE_IMAGE_BYTES = 5 * 1024 * 1024;

const MAX_VISUAL_SEARCH_SOURCE_BYTES = 8 * 1024 * 1024;

const MAX_VISUAL_SEARCH_DATA_URL_BYTES = 700 * 1024;

const FEEDBACK_FEATURE_OPTIONS = ['Search', 'Dashboard', 'Collections', 'AI summaries', 'Exporting', 'Mobile experience', 'Privacy', 'Other'];

const ONBOARDING_CONTENT_OPTIONS = [
  ['instagram', 'Instagram'],
  ['pinterest', 'Pinterest'],
  ['web_pages_links', 'Web pages / links'],
  ['screenshots', 'Screenshots'],
  ['documents_pdfs', 'Documents / PDFs'],
  ['voice_notes', 'Voice notes'],
  ['notes', 'Notes'],
  ['inspiration_ideas', 'Inspiration / ideas'],
  ['videos_social_posts', 'Videos / social posts'],
];

const ONBOARDING_REFERRAL_OPTIONS = [
  ['whatsapp_friend', 'WhatsApp / friend'],
  ['instagram', 'Instagram'],
  ['youtube', 'YouTube'],
  ['tiktok', 'TikTok'],
  ['x_twitter', 'X / Twitter'],
  ['reddit', 'Reddit'],
  ['linkedin', 'LinkedIn'],
  ['google_search', 'Google search'],
  ['product_hunt', 'Product Hunt'],
  ['school_college', 'School / college'],
  ['other', 'Other'],
];

const HERO_PLATFORMS = [
  { name: 'Instagram', src: '/platforms/instagram.svg', bg: 'transparent', scale: 1.08 },
  { name: 'X', src: '/platforms/x.svg', bg: '#fff' },
  { name: 'Facebook', src: '/platforms/facebook.svg', bg: '#1877f2' },
  { name: 'Pinterest', src: '/platforms/pinterest.svg', bg: '#e60023' },
  { name: 'Reddit', src: '/platforms/reddit.svg', bg: '#ff4500' },
  { name: 'LinkedIn', src: '/platforms/linkedin.svg', bg: '#0a66c2' },
  { name: 'TikTok', src: '/platforms/tiktok.svg', bg: '#000' },
  { name: 'YouTube', src: '/platforms/youtube.svg', bg: '#ff0033' },
  { name: 'Substack', src: '/platforms/substack.svg', bg: '#ff6719', scale: 0.92 },
];

const HERO_OUTCOME_WORDS = ['usable', 'searchable', 'exportable', 'organized', 'summarized', 'findable'];

const SAVE_SOURCE_LABELS = [
  'pinterest',
  'youtube',
  'x',
  'instagram',
  'documents',
  'web',
  'voice notes',
  'tiktok',
  'articles',
  'products',
  'screenshots',
  'notes',
];

const IMPORT_PROGRESS_STAGES = {
  checking: { value: 8, label: 'Checking files' },
  uploading: { value: 32, label: 'Uploading files' },
  reading: { value: 56, label: 'Reading export' },
  adding: { value: 78, label: 'Adding saves' },
  indexing: { value: 92, label: 'Queueing indexing' },
  done: { value: 100, label: 'Done' },
};

const IMPORT_STORAGE_BUCKET = import.meta.env.VITE_SUPABASE_IMPORT_BUCKET || 'instagram-assets';

const VERCEL_SAFE_UPLOAD_BYTES = 4 * 1024 * 1024;

const EXPORT_UPLOAD_EXTENSIONS = new Set(['.html', '.htm', '.zip', '.json', '.csv', '.js', '.txt']);

const INSTAGRAM_SAVED_EXPORT_RE = /(^|\/)your_instagram_activity\/saved\/saved_(posts|collections)\.(html|htm|json)$/i;

const INSTAGRAM_SAVED_FILE_RE = /^saved_(posts|collections)\.(html|htm|json)$/i;

const X_BOOKMARK_FILE_RE = /(^|\/)(data\/)?(bookmarks?|x[-_ ]?bookmarks?|twitter[-_ ]?bookmarks?|pauch[-_ ]?.*)\.(json|js|csv|txt)$/i;

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

function isXBookmarkFile(file) {
  const name = fileImportName(file);
  const baseName = name.split('/').pop() || name;
  return X_BOOKMARK_FILE_RE.test(name) || X_BOOKMARK_FILE_RE.test(baseName) || fileExtension(name) === '.zip';
}

function importCandidateFiles(files = [], sourceType = 'auto') {
  const candidates = files.filter((file) => EXPORT_UPLOAD_EXTENSIONS.has(fileExtension(fileImportName(file) || file.name)));
  if (sourceType === 'instagram') return candidates.filter(isInstagramSavedFile);
  if (sourceType === 'pinterest') return candidates;
  if (sourceType === 'x') return candidates;

  const zipFiles = candidates.filter((file) => fileExtension(fileImportName(file) || file.name) === '.zip');
  if (zipFiles.length) return zipFiles;

  const instagramSavedFiles = candidates.filter(isInstagramSavedFile);
  if (instagramSavedFiles.length) return instagramSavedFiles;
  const xBookmarkFiles = candidates.filter(isXBookmarkFile);
  return xBookmarkFiles.length ? xBookmarkFiles : candidates;
}

function validateExportFiles(files = [], sourceType = 'auto') {
  if (!files.length) throw new Error('Upload Instagram, Pinterest, or X bookmark export files.');
  for (const file of files) {
    if (!EXPORT_UPLOAD_EXTENSIONS.has(fileExtension(fileImportName(file) || file.name))) {
      throw new Error('Upload ZIP, HTML, JSON, CSV, JS, or TXT export files.');
    }
    if (!file.size) {
      throw new Error('The selected export file is empty. Re-export from Instagram, Pinterest, or X, then upload the file again.');
    }
  }
  if (sourceType === 'instagram' && !files.some(isInstagramSavedFile)) {
    throw new Error('For Instagram, upload the full export ZIP or the saved_posts/saved_collections HTML or JSON file from your_instagram_activity/saved/.');
  }
}

function importHealthForFiles(files = [], sourceType = 'auto') {
  const selectedFiles = importCandidateFiles(files, sourceType);
  const totalBytes = selectedFiles.reduce((total, file) => total + Number(file.size || 0), 0);
  const largeUpload = shouldUseStorageUpload(selectedFiles);

  if (!files.length) {
    return {
      state: 'waiting',
      title: 'Waiting for an export',
      copy: 'Choose a ZIP, JSON, CSV, or saved-posts HTML file to run the import check.',
      selectedCount: 0,
      totalBytes: 0,
      largeUpload: false,
    };
  }

  try {
    validateExportFiles(selectedFiles, sourceType);
    if (selectedFiles.length > 20) {
      throw new Error('Upload at most 20 export files at once. For full exports, upload the original ZIP instead of every folder file.');
    }
    return {
      state: 'ready',
      title: `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} ready`,
      copy: largeUpload
        ? 'Large imports will upload first, then parse in the background.'
        : 'These files look ready to add.',
      selectedCount: selectedFiles.length,
      totalBytes,
      largeUpload,
    };
  } catch (err) {
    return {
      state: 'blocked',
      title: 'Import check failed',
      copy: err.message,
      selectedCount: selectedFiles.length,
      totalBytes,
      largeUpload,
    };
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
        model: options?.textProviders?.openai?.defaultModel || 'gpt-4o',
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
  glm: {
    label: 'GLM / Z.ai key',
    shortLabel: 'GLM / Z.ai',
    help: 'Works for text summaries and tags only.',
    credentials: (options) => [
      {
        purpose: 'text',
        provider: 'glm',
        model: options?.textProviders?.glm?.defaultModel || 'z-ai/glm-5.1',
      },
    ],
  },
  openai_compatible: {
    label: 'OpenAI-compatible service',
    shortLabel: 'OpenAI-compatible',
    help: 'Advanced option for services that let apps use an OpenAI-style chat API.',
    advanced: true,
    credentials: (_options, form) => [
      {
        purpose: 'text',
        provider: 'openai_compatible',
        model: String(form.model || '').trim(),
        baseUrl: String(form.baseUrl || '').trim(),
        displayName: String(form.displayName || '').trim(),
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
  openai_compatible: 'OpenAI-compatible service',
};

const OPENAI_COMPATIBLE_NOTE = 'Advanced option. This can work if your service supports OpenAI-style chat APIs. It is usually for text summaries only unless you know your model supports images, video, or embeddings.';

const AI_PROCESSING_NOTICE = 'When you index saves, content may be processed by your selected AI providers or IScraper\'s configured provider to summarize, transcribe, OCR, embed, tag, visually analyze, and power search.';

const PROVIDER_KEY_PRIVACY_NOTICE = 'Provider keys are encrypted after saving, shown later only as metadata, and used only for the selected processing purpose.';

const PROVIDER_WARNING_COPY = {
  anthropic: {
    title: 'Claude is text-only here.',
    body: 'This key can help IScraper understand text, captions, and notes. It will not help index Reels or videos. It will not read images, extract text from screenshots, or power smart search by itself.',
  },
  openai: {
    title: 'OpenAI is limited in this setup.',
    body: 'This key can help with text summaries and tags. In this setup, it does not fully handle Reels/video indexing or smart search by itself.',
  },
  gemini: {
    title: 'Gemini is not the full setup.',
    body: 'This key can help IScraper read images and some video content, plus create basic summaries. It does not power smart search by itself.',
  },
  deepseek: {
    title: 'DeepSeek is mainly for text.',
    body: 'This key can help summarize captions, notes, and saved-page text. It will not read Reels/videos or images, and it will not power smart search by itself.',
  },
  glm: {
    title: 'GLM / Z.ai is mainly for text.',
    body: 'This key can help summarize captions, notes, and saved-page text. It will not read Reels/videos or images, and it will not power smart search by itself.',
  },
};

function normalizeStatus(status = 'queued') {
  return String(status).startsWith('paused') ? 'paused' : status;
}

function normalizeIndexingStage(stage = 'metadata_ready') {
  return INDEXING_META[stage] ? stage : 'metadata_ready';
}

function indexingStageFromStatus(status = 'queued', analysis = null) {
  if (status === 'failed') return 'index_failed';
  if (status === 'done') {
    if (analysis?.transcript) return 'deep_indexed';
    if (analysis?.visualDescription || analysis?.ocrText) return 'visual_indexed';
    return 'text_indexed';
  }
  if (status === 'downloading' || status === 'analyzing') return 'visual_indexing';
  return 'metadata_ready';
}

function shouldEnrichItem(item) {
  return item && item.sourceStatus !== 'needs_review' && !ENRICHED_STAGES.has(item.indexingStage) && item.indexingStage !== 'visual_indexing';
}

function mapItem(item) {
  const analysis = item.analysis || {};
  const firstImageAsset = (item.assets || []).find((asset) => asset.assetType === 'image' && asset.url);
  const indexingStage = normalizeIndexingStage(item.indexingStage || indexingStageFromStatus(item.status, analysis));
  const mapped = {
    raw: item,
    id: item.id,
    hasAnalysis: Boolean(item.analysis),
    contentType: item.contentType || '',
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
    thumbnailUrl: item.thumbnailUrl || firstImageAsset?.url || '',
    assets: item.assets || [],
    archive: normalizeArchive(item.archive),
    note: item.note || null,
    saved: item.savedAt || '',
    status: normalizeStatus(item.status || 'queued'),
    sourceStatus: item.status || 'queued',
    indexingStage,
    indexingLabel: INDEXING_META[indexingStage].label,
    indexingError: item.indexingError || '',
    lastEnrichmentRequestedAt: item.lastEnrichmentRequestedAt || '',
    url: item.url,
    why: analysis.whyUseful || '',
    error: item.error || '',
    searchMatch: item.searchMatch || null,
  };
  mapped.card = cardViewForItem(mapped);
  return mapped;
}

function normalizeArchive(archive) {
  if (!archive) return null;
  return {
    ...archive,
    status: archive.status || 'failed',
    title: archive.title || '',
    siteName: archive.siteName || '',
    excerpt: archive.excerpt || '',
    contentText: archive.contentText || '',
    errorCode: archive.errorCode || '',
    errorMessage: archive.errorMessage || '',
    capturedAt: archive.capturedAt || null,
    textLength: Number(archive.textLength || 0),
    byteSize: Number(archive.byteSize || 0),
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isNoteItem(item) {
  return !isExtensionCaptureItem(item) && (item?.contentType === 'note' || item?.platformKey === 'iscraper-note');
}

function isExtensionCaptureItem(item) {
  return item?.platformKey === 'iscraper-extension-capture';
}

function isLinkItem(item) {
  return item?.platformKey === 'web' || String(item?.id || '').startsWith('web-');
}

function isVoiceNoteItem(item) {
  return ['voice', 'voice_note', 'audio'].includes(item?.contentType) || item?.platformKey === 'iscraper-voice-note';
}

function itemTypeMatches(item, typeFilter) {
  if (typeFilter === 'all') return true;
  if (typeFilter === 'notes') return isNoteItem(item);
  if (typeFilter === 'links') return isLinkItem(item);
  if (typeFilter === 'screenshots') return isExtensionCaptureItem(item);
  if (typeFilter === 'voice_notes') return isVoiceNoteItem(item);
  if (typeFilter === 'uploaded') return !isNoteItem(item) && !isLinkItem(item) && !isExtensionCaptureItem(item) && !isVoiceNoteItem(item);
  return true;
}

function itemStateMatches(item, stateFilter) {
  if (stateFilter === 'all') return true;
  if (stateFilter === 'needs_review') return item.sourceStatus === 'needs_review';
  if (stateFilter === 'searchable') return item.sourceStatus !== 'needs_review';
  if (stateFilter === 'enriched') return DASHBOARD_ENRICHED_STAGES.has(item.indexingStage);
  if (stateFilter === 'failed') return item.indexingStage === 'index_failed' || item.status === 'failed' || item.status === 'paused';
  return true;
}

function itemCollections(item) {
  return unique([...(item.raw?.collections || []), item.collection].filter((value) => value && value !== 'Unsorted'));
}

function itemMatchesCollection(item, collectionFilter) {
  return collectionFilter === 'all' || itemCollections(item).includes(collectionFilter);
}

function platformOptionsForItems(items = []) {
  return ['all', ...unique(items
    .filter((item) => !isNoteItem(item))
    .map((item) => item.platform)
    .filter((value) => value && !['Example', 'IScraper Notes'].includes(value)))
    .sort((a, b) => String(a).localeCompare(String(b)))];
}

function sortedItems(items, sortOrder) {
  const copy = [...items];
  const savedDate = (item) => item.saved || item.raw?.savedAt || item.raw?.createdAt || '';
  if (sortOrder === 'oldest') {
    return copy.sort((a, b) => String(savedDate(a)).localeCompare(String(savedDate(b))));
  }
  if (sortOrder === 'updated') {
    return copy.sort((a, b) => String(b.raw?.updatedAt || savedDate(b)).localeCompare(String(a.raw?.updatedAt || savedDate(a))));
  }
  if (sortOrder === 'title') {
    return copy.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  }
  return copy.sort((a, b) => String(savedDate(b)).localeCompare(String(savedDate(a))));
}

function noteImageError(file, existingCount = 0) {
  if (!NOTE_IMAGE_TYPES.has(file.type)) return 'Notes support PNG, JPEG, WebP, or GIF images only. Video notes are not supported yet.';
  if (file.size > MAX_NOTE_IMAGE_BYTES) return 'Note images must be 5 MB or smaller.';
  if (existingCount >= MAX_NOTE_IMAGES) return `Notes support up to ${MAX_NOTE_IMAGES} images.`;
  return '';
}

function visualSearchImageError(file) {
  if (!VISUAL_SEARCH_IMAGE_TYPES.has(file.type)) return 'Same Vibe Search supports PNG, JPEG, or WebP images.';
  if (file.size > MAX_VISUAL_SEARCH_SOURCE_BYTES) return 'Use an image smaller than 8 MB for Same Vibe Search.';
  return '';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not open that image.'));
    };
    image.src = url;
  });
}

async function imageFileToVisualSearchDataUrl(file) {
  if (file.size <= MAX_VISUAL_SEARCH_DATA_URL_BYTES * 0.72) {
    return readFileAsDataUrl(file);
  }

  const image = await loadImageFromFile(file);
  const maxSide = 1000;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare that image for search.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  for (const quality of [0.82, 0.72, 0.62, 0.52]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length < MAX_VISUAL_SEARCH_DATA_URL_BYTES) return dataUrl;
  }

  throw new Error('That image is still too large after resizing. Try a smaller screenshot or crop.');
}

function firstUsefulCardChip(item) {
  return item.platform || item.sourceType || (item.collections?.[0]) || item.status || 'Saved';
}

function shortCardText(value = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > 150 ? `${text.slice(0, 147).trim()}...` : text;
}

function cardViewForItem(item) {
  const capture = isExtensionCaptureItem(item);
  const note = isNoteItem(item) && !capture;
  const meta = item.sourceStatus === 'needs_review'
    ? STATUS_META.needs_review
    : INDEXING_META[item.indexingStage] || INDEXING_META.metadata_ready;
  const statusLabel = item.sourceStatus === 'needs_review'
    ? 'Needs check'
    : item.indexingStage === 'visual_indexing'
      ? 'Updating'
      : item.indexingStage === 'index_failed' || item.status === 'failed'
        ? 'Issue'
        : '';
  const linkCount = item.note?.links?.length || (note ? [...String(item.caption || '').matchAll(/https?:\/\/[^\s<>"')\]]+/gi)].length : 0);
  return {
    capture,
    note,
    meta,
    statusLabel,
    chip: capture ? 'Screen Capture' : note ? 'My Note' : firstUsefulCardChip(item),
    preview: shortCardText(item.summary || item.visual || item.sourceDescription || item.caption || (note ? 'Open this note to see the full text.' : 'Open this save to see what was captured.')),
    title: shortCardText(item.sourceTitle || item.title || (note ? 'Untitled note' : 'Saved post')),
    source: note ? 'Saved by you' : capture ? 'Chrome extension' : shortCardText(item.sourceAuthor || item.user || item.platform || 'Saved source'),
    imageCount: item.assets?.filter((asset) => asset.assetType === 'image').length || 0,
    linkCount,
  };
}

function splitQuickAddFiles(fileList = []) {
  const files = Array.from(fileList || []);
  return {
    images: files.filter((file) => NOTE_IMAGE_TYPES.has(file.type)),
    exports: files.filter((file) => EXPORT_UPLOAD_EXTENSIONS.has(fileExtension(fileImportName(file) || file.name))),
    unsupported: files.filter((file) => !NOTE_IMAGE_TYPES.has(file.type) && !EXPORT_UPLOAD_EXTENSIONS.has(fileExtension(fileImportName(file) || file.name))),
  };
}

function filterLabel(value) {
  const labels = {
    all: 'All',
    uploaded: 'Uploaded',
    links: 'All Links',
    screenshots: 'Screenshots',
    voice_notes: 'Voice Notes',
    notes: 'My Notes',
    needs_review: 'Needs check',
    searchable: 'In Library',
    enriched: 'More details',
    failed: 'Failed',
    newest: 'Newest',
    oldest: 'Oldest',
    updated: 'Recently updated',
    title: 'Title',
    'grid-2': '2 columns',
    'grid-3': '3 columns',
    gallery: 'Gallery',
    list: 'List',
  };
  return labels[value] || String(value || '').replace(/_/g, ' ');
}

function normalizeLibraryLayout(value) {
  return LIBRARY_LAYOUT_OPTIONS.includes(value) ? value : 'grid-3';
}

function readStoredLibraryLayout() {
  try {
    return normalizeLibraryLayout(window.localStorage.getItem(LIBRARY_LAYOUT_STORAGE_KEY));
  } catch {
    return 'grid-3';
  }
}

function firstLine(value = '') {
  return String(value).split('\n').find(Boolean)?.slice(0, 90);
}

function formatUsageNumber(value = 0) {
  return Number(value || 0).toLocaleString();
}

function formatBytes(value = 0) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUsageDate(value) {
  if (!value) return 'No saves yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No saves yet';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function deletionStatusLabel(status) {
  return ({
    requested: 'Request received',
    frozen: 'Account frozen',
    pending_approval: 'Waiting for review',
    approved: 'Approved for deletion',
    executing: 'Deletion in progress',
    completed: 'Account deleted',
    failed: 'Needs admin retry',
    logged: 'Deletion logged',
    partially_failed: 'Needs admin retry',
    canceled: 'Request canceled',
  })[status] || 'Deletion request';
}

function deletionStatusCopy(status) {
  return ({
    requested: 'Your request has been received and risky account activity is frozen.',
    frozen: 'Risky account activity is frozen while the request waits for review.',
    pending_approval: 'Your request is waiting for admin review. You can still cancel it from this screen.',
    approved: 'An admin approved this request. Execution can start at any time.',
    executing: 'Deletion is running. This state is read-only.',
    completed: 'Deletion is complete. Only minimal audit and retention records remain.',
    failed: 'Deletion failed during execution. Support can retry the executor from the admin review flow.',
    logged: 'Deletion is complete and logged. Only minimal legal and audit records remain.',
    partially_failed: 'Some deletion steps failed. An admin can retry the executor.',
    canceled: 'This deletion request was canceled.',
  })[status] || 'Deletion status is available here.';
}

function exportStatusLabel(status) {
  return ({
    requested: 'Queued',
    building: 'Building export',
    ready: 'Ready to download',
    failed: 'Export failed',
    expired: 'Expired',
  })[status] || 'Export request';
}

function securityActivityLabel(eventType = '') {
  return String(eventType || 'security_event')
    .replace(/^admin_/, 'support ')
    .replace(/^account_/, 'account ')
    .replace(/^data_/, 'data ')
    .replace(/^provider_/, 'provider ')
    .replace(/^extension_/, 'extension ')
    .replace(/^token_/, 'token ')
    .replaceAll('_', ' ');
}

function buildDataUsage(items = [], credits = null) {
  const searchableItems = items.filter((item) => item.sourceStatus !== 'needs_review');
  const visualReady = items.filter((item) => ['visual_indexed', 'deep_indexed'].includes(item.indexingStage)).length;
  const transcriptReady = items.filter((item) => item.indexingStage === 'deep_indexed').length;
  const latestDate = items
    .map((item) => item.raw?.createdAt || item.raw?.updatedAt || item.saved)
    .filter(Boolean)
    .sort((a, b) => String(b).localeCompare(String(a)))[0];

  return {
    total: items.length,
    searchable: searchableItems.length,
    metadataOnly: items.filter((item) => item.indexingStage === 'metadata_ready').length,
    textIndexed: items.filter((item) => item.indexingStage === 'text_indexed').length,
    visualReady,
    transcriptReady,
    indexing: items.filter((item) => item.indexingStage === 'visual_indexing').length,
    failed: items.filter((item) => item.indexingStage === 'index_failed' || item.status === 'failed').length,
    needsReview: items.filter((item) => item.sourceStatus === 'needs_review').length,
    platforms: unique(items.map((item) => item.platform)).length,
    collections: unique(items.map((item) => item.collection).filter((value) => value && value !== 'Unsorted')).length,
    latestDate,
    credits: {
      freeUsed: credits?.freeItemsUsed || 0,
      freeLimit: credits?.freeItemsLimit || 0,
      freeRemaining: credits?.freeItemsRemaining || 0,
      paid: credits?.paidCredits || 0,
      available: credits?.totalAvailableCredits || 0,
    },
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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

function RotatingOutcomeText() {
  const [activeIndex, setActiveIndex] = useState(0);
  const wordRef = useRef(null);
  const word = HERO_OUTCOME_WORDS[activeIndex];

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return undefined;

    const timer = window.setInterval(() => {
      const target = wordRef.current;
      if (!target) {
        setActiveIndex((current) => (current + 1) % HERO_OUTCOME_WORDS.length);
        return;
      }

      gsap.timeline()
        .to(target, { yPercent: -115, autoAlpha: 0, duration: 0.35, ease: 'power2.in' })
        .add(() => setActiveIndex((current) => (current + 1) % HERO_OUTCOME_WORDS.length))
        .set(target, { yPercent: 115 })
        .to(target, { yPercent: 0, autoAlpha: 1, duration: 0.45, ease: 'power3.out' });
    }, 1700);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <span className="inline-grid min-w-[6.4em] justify-items-center overflow-visible px-[0.08em] py-[0.06em] align-baseline text-center text-glow italic text-primary">
      <span ref={wordRef} className="inline-block whitespace-nowrap" aria-live="polite">
        {word}<span className="text-foreground">.</span>
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
  admin: '/admin',
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
  admin: 'IScraper Admin',
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
  if (window.location.hash === '#admin') return 'admin';
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
  const sharedText = params.get('text') || '';
  const url = params.get('url') || params.get('saveUrl') || firstUrlInText(sharedText);
  if (!url) return null;
  const note = params.get('note') || sharedText.replace(url, '').trim();
  return {
    url,
    title: params.get('title') || '',
    description: params.get('description') || '',
    platform: params.get('platform') || '',
    note,
    author: params.get('author') || '',
    thumbnailUrl: params.get('thumbnailUrl') || '',
    source: params.get('source') || '',
    clientActionId: params.get('clientActionId') || '',
    autoSave: params.get('autoSave') === '1',
  };
}

function firstUrlInText(value = '') {
  const match = String(value || '').match(/https?:\/\/[^\s<>"')\]]+/i);
  return match ? match[0].replace(/[.,!?;:]+$/, '') : '';
}

function itemIdFromLocation() {
  return appParamsFromLocation().get('item') || '';
}

function dashboardTabFromLocation() {
  const tab = appParamsFromLocation().get('tab');
  return DASHBOARD_TABS.includes(tab) ? tab : 'library';
}

function libraryLayoutFromLocation() {
  return appParamsFromLocation().get('tab') === 'gallery' ? 'gallery' : readStoredLibraryLayout();
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

function clearAppQueryParams(keys = []) {
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of keys) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (changed) {
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
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

function keyValidationMessage(setup, apiKey, form = {}) {
  const value = String(apiKey || '').trim();
  if (!value) return 'Paste your API key first.';
  if (setup === 'openai_compatible') {
    if (!String(form.baseUrl || '').trim()) return 'Paste the base URL for your OpenAI-compatible service.';
    if (!String(form.model || '').trim()) return 'Enter the model ID for your OpenAI-compatible service.';
    try {
      const parsed = new URL(String(form.baseUrl || '').trim());
      if (parsed.protocol !== 'https:') return 'The base URL must start with https://.';
    } catch {
      return 'The base URL must be a valid URL.';
    }
  }
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

function onboardingFormFromRecord(onboarding) {
  return {
    contentTypes: Array.isArray(onboarding?.contentTypes) ? onboarding.contentTypes : [],
    referralSource: onboarding?.referralSource || '',
  };
}

function onboardingIsDone(onboarding) {
  return Boolean(onboarding?.completedAt || onboarding?.skippedAt);
}

const recordedSignInActivitySessions = new Set();

function recordSessionSignInActivity(session) {
  if (!session?.user?.id) return;
  const key = `${session.user.id}:${session.expires_at || String(session.access_token || '').slice(-16)}`;
  if (recordedSignInActivitySessions.has(key)) return;
  recordedSignInActivitySessions.add(key);
  recordSignInActivity().catch(() => recordedSignInActivitySessions.delete(key));
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

const EXTENSION_CONNECT_STORAGE_KEY = 'iscraper.pendingExtensionConnect';

function extensionConnectFromLocation() {
  const params = appParamsFromLocation();
  if (params.get('connectExtension') !== '1') return null;
  const extensionId = String(params.get('extensionId') || '').trim();
  if (!/^[a-z]{32}$/.test(extensionId)) return null;
  return {
    extensionId,
    requestedAt: new Date().toISOString(),
  };
}

function rememberPendingExtensionConnect() {
  const pending = extensionConnectFromLocation();
  if (!pending) return;
  window.localStorage.setItem(EXTENSION_CONNECT_STORAGE_KEY, JSON.stringify(pending));
}

function pendingExtensionConnectFromStorage() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(EXTENSION_CONNECT_STORAGE_KEY) || 'null');
    if (!parsed?.extensionId || !/^[a-z]{32}$/.test(parsed.extensionId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function forgetPendingExtensionConnect() {
  window.localStorage.removeItem(EXTENSION_CONNECT_STORAGE_KEY);
}

function sendExtensionConnection({ extensionId, secret, token, session }) {
  return new Promise((resolve, reject) => {
    if (!globalThis.chrome?.runtime?.sendMessage) {
      reject(new Error('Open this page in Chrome with the IScraper extension installed.'));
      return;
    }
    globalThis.chrome.runtime.sendMessage(extensionId, {
      type: 'ISCRAPER_EXTENSION_CONNECTED',
      payload: {
        token: secret,
        tokenId: token?.id || '',
        appUrl: window.location.origin,
        email: session?.user?.email || '',
      },
    }, (response) => {
      const runtimeError = globalThis.chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message || 'Chrome could not connect to the extension.'));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || 'The extension did not accept the connection.'));
        return;
      }
      resolve(response);
    });
  });
}

export {
  Activity,
  AI_PROCESSING_NOTICE,
  AlertCircle,
  appParamsFromLocation,
  approveReviewItem,
  AppShellSkeleton,
  archiveItem,
  ArrowLeft,
  ArrowRight,
  askLibraryChat,
  avatarUrlForSession,
  Bot,
  Brain,
  BrandLogo,
  buildDataUsage,
  cancelAccountDeletion,
  canonicalizeLegacyHashRoute,
  canonicalizeUnknownPath,
  cardViewForItem,
  Check,
  CheckCircle2,
  checkLibraryLinks,
  ChevronDown,
  cleanAuthCallbackUrl,
  clearAppQueryParams,
  Clock,
  Columns2,
  Columns3,
  Copy,
  createAgentAccessToken,
  createDataExport,
  createExtensionToken,
  createItemReminder,
  createNote,
  DASHBOARD_ENRICHED_STAGES,
  DASHBOARD_TABS,
  dashboardTabFromLocation,
  Database,
  DeferredSkeletonCardGrid,
  deleteProviderCredential,
  deletionStatusCopy,
  deletionStatusLabel,
  Download,
  downloadBlob,
  downloadDataExport,
  downloadObsidianGraph,
  ENRICHED_STAGES,
  enrichIntentBatch,
  enrichItem,
  EXPORT_UPLOAD_EXTENSIONS,
  exportStatusLabel,
  EXTENSION_CONNECT_STORAGE_KEY,
  extensionConnectFromLocation,
  ExternalLink,
  Eye,
  EyeOff,
  FEEDBACK_FEATURE_OPTIONS,
  fileExtension,
  fileImportName,
  FileText,
  Filter,
  filterLabel,
  firstLine,
  firstUrlInText,
  Folder,
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forgetPendingExtensionConnect,
  formatBytes,
  formatUsageDate,
  formatUsageNumber,
  getAccountDeletion,
  getAccountSecurityActivity,
  getAccountSummary,
  getAdminSummary,
  getAdminUserDetailWithKey,
  getAdminUsers,
  getAdminUserTimelineWithKey,
  getAgentAccessTokens,
  getCredits,
  getDataExports,
  getIndexingSummary,
  getItem,
  getItems,
  getItemsPage,
  getKnowledgeGraph,
  getLibraryCare,
  getOnboarding,
  getPrivacyExportData,
  getProfile,
  getProviderCredentials,
  getPublicFeedback,
  getRouteFromLocation,
  getSimilarVisuals,
  getSmartCollectionItems,
  getSmartCollections,
  getUserDataMap,
  GitBranch,
  groupProviderCredentials,
  gsap,
  Hash,
  HERO_OUTCOME_WORDS,
  HERO_PLATFORMS,
  identifyPostHogUser,
  imageFileToVisualSearchDataUrl,
  Images,
  IMPORT_PROGRESS_STAGES,
  IMPORT_STORAGE_BUCKET,
  importCandidateFiles,
  importHealthForFiles,
  importInstagramExport,
  INDEXING_META,
  indexingStageFromStatus,
  initialForSession,
  INSTAGRAM_SAVED_EXPORT_RE,
  INSTAGRAM_SAVED_FILE_RE,
  isExtensionCaptureItem,
  isInstagramSavedFile,
  isLinkItem,
  isNoteItem,
  isVoiceNoteItem,
  isXBookmarkFile,
  itemCollections,
  itemIdFromLocation,
  itemMatchesCollection,
  itemStateMatches,
  itemTypeMatches,
  KEY_SETUP_OPTIONS,
  KeyRound,
  keyValidationMessage,
  legacyRouteFromHash,
  LIBRARY_LAYOUT_ITEMS,
  LIBRARY_LAYOUT_OPTIONS,
  LIBRARY_LAYOUT_STORAGE_KEY,
  libraryLayoutFromLocation,
  LifeBuoy,
  List,
  Loader2,
  loadImageFromFile,
  LoadingSpinner,
  Lock,
  Mail,
  mapItem,
  MAX_NOTE_IMAGE_BYTES,
  MAX_NOTE_IMAGES,
  MAX_VISUAL_SEARCH_DATA_URL_BYTES,
  MAX_VISUAL_SEARCH_SOURCE_BYTES,
  memo,
  Mic,
  normalizeArchive,
  normalizeIndexingStage,
  normalizeLibraryLayout,
  normalizeStatus,
  NOTE_IMAGE_TYPES,
  noteImageError,
  ONBOARDING_CONTENT_OPTIONS,
  ONBOARDING_REFERRAL_OPTIONS,
  onboardingFormFromRecord,
  onboardingIsDone,
  OPENAI_COMPATIBLE_NOTE,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  pendingExtensionConnectFromStorage,
  pendingSaveFromLocation,
  platformOptionsForItems,
  Plus,
  ProgressBar,
  PROVIDER_DISPLAY_LABELS,
  PROVIDER_KEY_PRIVACY_NOTICE,
  PROVIDER_WARNING_COPY,
  queueStorageImport,
  readFileAsDataUrl,
  readStoredLibraryLayout,
  recordedSignInActivitySessions,
  recordSessionSignInActivity,
  recordSignInActivity,
  refreshSmartCollections,
  rememberPendingExtensionConnect,
  rememberPendingSave,
  replaceAppTabUrl,
  requestAccountDeletion,
  resetPageScroll,
  resetPostHogUser,
  revealProviderCredential,
  revokeAgentAccessToken,
  RotateCcw,
  RotatingOutcomeText,
  RotatingPlatformLogo,
  ROUTE_PATHS,
  ROUTE_TITLES,
  safeStorageExtension,
  SAVE_SOURCE_LABELS,
  saveLink,
  saveOnboarding,
  saveProfile,
  saveProviderCredential,
  scrollToLandingSection,
  scrollToSection,
  ScrollTrigger,
  Search,
  SEARCH_MODES,
  searchItems,
  searchVisuals,
  securityActivityLabel,
  sendEmailOtp,
  sendExtensionConnection,
  setApiAccessToken,
  setManualScrollRestoration,
  setSmartCollectionItemOverride,
  Settings,
  ShieldCheck,
  shouldEnrichItem,
  shouldUseStorageUpload,
  SkeletonBlock,
  SkeletonCardGrid,
  SkeletonRows,
  SlidersHorizontal,
  SmartCollectionsView,
  SORT_OPTIONS,
  sortedItems,
  Sparkles,
  splitQuickAddFiles,
  STALE_ENRICHMENT_UI_MS,
  startGoogleSignIn,
  STATE_FILTERS,
  STATUS_META,
  submitPublicFeedback,
  submitSearchFeedback,
  supabase,
  Tag,
  testProviderCredential,
  ThumbsDown,
  ThumbsUp,
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
  User,
  useRef,
  useState,
  validateExportFiles,
  VERCEL_SAFE_UPLOAD_BYTES,
  verifyEmailOtp,
  VirtualLibraryGrid,
  VISUAL_SEARCH_IMAGE_TYPES,
  visualSearchImageError,
  X,
  X_BOOKMARK_FILE_RE,
  Zap,
  ZoomIn,
  ZoomOut,
};
