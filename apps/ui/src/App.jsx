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
  Pause,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  ShieldCheck,
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
  archiveItem,
  approveReviewItem,
  cancelAccountDeletion,
  createExtensionToken,
  createNote,
  deleteProviderCredential,
  downloadObsidianGraph,
  getAccountDeletion,
  getItem,
  getItems,
  getItemsPage,
  getIndexingSummary,
  getCredits,
  getKnowledgeGraph,
  getProfile,
  getPrivacyExportData,
  getPublicFeedback,
  getProviderCredentials,
  importInstagramExport,
  queueStorageImport,
  enrichIntentBatch,
  enrichItem,
  revealProviderCredential,
  requestAccountDeletion,
  getSmartCollectionItems,
  getSmartCollections,
  refreshSmartCollections,
  saveLink,
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
const DASHBOARD_ENRICHED_STAGES = new Set(['text_indexed', 'visual_indexing', 'visual_indexed', 'deep_indexed']);
const STALE_ENRICHMENT_UI_MS = 15 * 60 * 1000;
const TYPE_FILTERS = ['all', 'uploaded', 'links', 'notes'];
const STATE_FILTERS = ['all', 'needs_review', 'searchable', 'enriched', 'failed'];
const SORT_OPTIONS = ['newest', 'oldest'];
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
  return item?.contentType === 'note' || item?.platformKey === 'iscraper-note';
}

function isExtensionCaptureItem(item) {
  return item?.platformKey === 'iscraper-extension-capture';
}

function itemTypeMatches(item, typeFilter) {
  if (typeFilter === 'all') return true;
  if (typeFilter === 'notes') return isNoteItem(item);
  if (typeFilter === 'links') return item.platformKey === 'web' || String(item.id || '').startsWith('web-');
  if (typeFilter === 'uploaded') return !isNoteItem(item) && item.platformKey !== 'web' && !String(item.id || '').startsWith('web-');
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

function sortedItems(items, sortOrder) {
  const copy = [...items];
  if (sortOrder === 'oldest') {
    return copy.sort((a, b) => String(a.raw?.createdAt || a.saved || '').localeCompare(String(b.raw?.createdAt || b.saved || '')));
  }
  if (sortOrder === 'updated') {
    return copy.sort((a, b) => String(b.raw?.updatedAt || b.raw?.createdAt || b.saved || '').localeCompare(String(a.raw?.updatedAt || a.raw?.createdAt || a.saved || '')));
  }
  if (sortOrder === 'title') {
    return copy.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  }
  return copy.sort((a, b) => String(b.raw?.createdAt || b.saved || '').localeCompare(String(a.raw?.createdAt || a.saved || '')));
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
    links: 'Links',
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
    pending_approval: 'Waiting for review',
    approved: 'Approved for deletion',
    executing: 'Deletion in progress',
    completed: 'Account deleted',
    partially_failed: 'Needs admin retry',
    canceled: 'Request canceled',
  })[status] || 'Deletion request';
}

function deletionStatusCopy(status) {
  return ({
    requested: 'Your request has been received and risky account activity is frozen.',
    pending_approval: 'Your request is waiting for admin review. You can still cancel it from this screen.',
    approved: 'An admin approved this request. Execution can start at any time.',
    executing: 'Deletion is running. This state is read-only.',
    completed: 'Deletion is complete. Only minimal audit and retention records remain.',
    partially_failed: 'Some deletion steps failed. An admin can retry the executor.',
    canceled: 'This deletion request was canceled.',
  })[status] || 'Deletion status is available here.';
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
  return ['library', 'gallery', 'smart', 'care', 'graph', 'upload', 'settings'].includes(tab) ? tab : 'library';
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

export default function App() {
  const [route, setRoute] = useState(() => {
    rememberPendingSave();
    rememberPendingExtensionConnect();
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
      rememberPendingExtensionConnect();
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

      <header className="pointer-events-none fixed left-0 right-0 top-4 z-50 px-4">
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
            <button type="button" className="nav-item rounded-full px-4 py-2 transition hover:bg-orange-500 hover:text-black">Pricing</button>
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

      <section className="landing-hero relative flex min-h-screen items-center overflow-hidden bg-black pt-28 md:pt-36">
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
              Stop digging through old saves. IScraper keeps the posts, links, products, and ideas you care about in one private place, so you can find them again when you need them.
            </p>
            <div className="hero-fade flex flex-wrap items-center gap-4">
              {landingSession ? (
                <button
                  type="button"
                  onClick={onOpenApp}
                  className="glow-ring group inline-flex items-center gap-3 rounded-full bg-primary px-7 py-4 text-base font-semibold text-primary-foreground transition hover:scale-[1.03]"
                >
                  Open library <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onOpenLogin}
                  className="glow-ring group inline-flex items-center gap-3 rounded-full bg-primary px-7 py-4 text-base font-semibold text-primary-foreground transition hover:scale-[1.03]"
                >
                  Log in <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
                </button>
              )}
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
              ['Library modes', '3'],
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
            <p className="max-w-md text-muted-foreground">Stop losing useful saves inside platform folders, screenshots, and browser tabs. Find the exact thing when you need it.</p>
          </div>

          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {[
              [Zap, 'Save from any platform', 'Paste a link from Pinterest, X, TikTok, YouTube, Instagram, or any site and keep it in the same searchable library.'],
              [Brain, 'Know why you saved it', 'Each save can get a plain-English summary, so old posts, links, and references become useful again instead of forgotten.'],
              [CheckCircle2, 'Review before indexing', 'Imported saves can be checked before they become searchable, so your library stays intentional and clean.'],
              [Tag, 'Organized without the cleanup', 'Group saves by themes like travel, food, fitness, shopping, home, business, or inspiration.'],
              [Lock, 'Private by default', 'Your library belongs to your account. Saves happen only after you explicitly authorize them.'],
              [ShieldCheck, 'Built around official exports', 'Use Instagram and Pinterest exports without handing over social-platform passwords.'],
              [Search, 'Lens and AI search', 'Search by words, selected text, or a screenshot crop, then see why results matched and which saves support an AI answer.'],
              [GitBranch, 'Export your graph', 'Turn indexed saves into an Obsidian-ready graph when you want an AI agent or vault to work with your library.'],
              [KeyRound, 'Browser capture coming soon', 'The extension roadmap adds one-click saving for screenshots, selected text, images, and videos after browser-store release.'],
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
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">/ 02 - Browser extension</div>
            <h2 className="max-w-4xl font-display text-5xl font-bold tracking-tighter md:text-7xl">
              Capture from Chrome without opening IScraper.
            </h2>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              The extension is built around two actions: Capture URL and Screen Capture. Users connect their IScraper account once, then saves run in the background from the browser.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-full bg-primary px-6 py-4 text-sm font-semibold text-primary-foreground opacity-70"
              >
                Store review next
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
              [KeyRound, 'Email account sign-in', 'Connect once with the same email account used for IScraper.'],
              [Search, 'Capture URL', 'Save the current tab URL and metadata directly to your library.'],
              [Eye, 'Screen Capture', 'Drag a crop area and save the image with a 5-second Undo action.'],
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
              Turn every save into a <span className="italic text-accent">usable reference</span>.
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
            Your best references are already saved. <br />Make them <RotatingOutcomeText />
          </h2>
          <p data-reveal className="mx-auto mt-8 max-w-xl text-lg text-muted-foreground">Paste one link or upload an export, then turn saved posts, products, creators, research, and ideas into a library you can come back to.</p>
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
    copy: 'Go back to IScraper, open Settings, choose OpenRouter, paste the key once, and save it. IScraper chooses the right models automatically.',
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
    title: 'Upload your files',
    copy: 'Open IScraper, go to Add saves, and upload your Pinterest ZIP file there.',
    wide: true,
  },
];

const HOW_TO_GUIDES = [
  { key: 'instagram', icon: Upload, title: 'Instagram export', copy: 'Get your saved posts file from Instagram and upload it into IScraper.', status: 'Guide ready' },
  { key: 'api-keys', icon: KeyRound, title: 'API keys', copy: 'Method 1: use OpenRouter for summaries, tags, and semantic search.', status: 'Guide ready' },
  { key: 'pinterest', icon: ExternalLink, title: 'Pinterest export', copy: 'Request and download your Pinterest data export.', status: 'Guide ready' },
  { key: 'extension', icon: Search, title: 'Browser extension', copy: 'Coming soon for normal users: save pages, use Lens, and later capture screenshots, text, images, and videos.', status: 'Coming soon' },
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

      <main className="relative mx-auto max-w-7xl px-5 py-10 md:py-20">
        <section className="howto-reveal mb-10 max-w-4xl md:mb-14">
          <div className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">How to use IScraper</div>
          <h1 className="font-display text-4xl font-bold leading-tight tracking-tighter sm:text-5xl md:text-7xl">
            Guides for imports, API keys, and upcoming features.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground md:mt-6 md:text-lg md:leading-8">
            Start with Instagram or Pinterest exports, then add links manually when you want one-off saves. We will keep adding simple guides here for API keys, the browser extension, and other capture flows as they become available.
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
                Open Settings <ArrowRight className="h-5 w-5" />
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
              <h2 className="font-display text-4xl font-bold tracking-tight">Upload your files</h2>
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
              The extension is not available for normal users yet. Once the browser-store listing is approved, this page will show install steps for saving pages and using Lens. One-click screenshot, selected-text, image, and video capture will follow as extension capture modes mature.
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
    [Upload, 'Import and save help', 'Use the Instagram or Pinterest guides for exports, or paste a single link from the Add saves tab.'],
    [KeyRound, 'AI keys', 'IScraper is BYOK right now. Add your own text, media, and embedding keys in Settings.'],
    [Search, 'Search and Lens problems', 'If results feel wrong, make sure saves were approved and indexed. Search improves after summaries, OCR, tags, and Lens analysis exist.'],
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

      <main className="relative mx-auto max-w-6xl px-5 py-10 md:py-24">
        <section className="max-w-4xl">
          <div className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">Help Center</div>
          <h1 className="font-display text-4xl font-bold leading-tight tracking-tighter sm:text-5xl md:text-7xl">Need help with IScraper?</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground md:mt-6 md:text-lg md:leading-relaxed">
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
              <FileText className="h-4 w-4" /> Import guides
            </button>
          </div>
        </section>

        <section className="mt-10 grid gap-5 md:mt-16 md:grid-cols-2">
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
      ['Using IScraper', 'IScraper helps you upload official exports, save links from other platforms, and turn saved posts and references into a private searchable library. You are responsible for using the app lawfully and only uploading or saving content you have the right to use.'],
      ['Accounts', 'You must sign in before importing saved posts. You are responsible for activity on your account and for keeping your login secure. Usernames must be unique and may be changed if they impersonate someone, violate rights, or create abuse.'],
      ['Your content', 'Your exports, saved links, captions, notes, summaries, graph data, username, and optional profile picture remain your content. You give IScraper permission to process that content only to provide the app features.'],
      ['Emails and updates', 'We may send account, security, product, billing, import, and support emails to the email address on your account. We may also send product updates or marketing emails where you have opted in or where the law allows it, and those marketing emails must include a way to unsubscribe.'],
      ['AI processing', 'When indexing is enabled, content may be sent to configured AI providers to create summaries, OCR, transcripts, tags, and search data. AI output can be wrong, incomplete, or outdated, so you should verify important information yourself.'],
      ['Browser extension coming soon', 'The IScraper browser extension is not available for users yet. When released, it will be optional and must be used only on pages and content you are allowed to process.'],
      ['Things you cannot do', 'Do not upload content you do not have rights to use, attack the service, bypass rate limits, scrape or copy other users data, reverse engineer protected parts of the service, or use IScraper for unlawful activity.'],
      ['Credits and paid features', 'AI enrichment may require connected provider keys or paid IScraper credits. Credit purchases are currently marked as coming soon. If payments are enabled later, pricing, refunds, and billing terms will be shown before purchase.'],
      ['Service changes', 'We may change, pause, or discontinue features. We will try to avoid disrupting your saved library, but we do not guarantee uninterrupted access.'],
      ['Disclaimer', 'IScraper is provided as-is without warranties. To the maximum extent allowed by law, we are not responsible for indirect damages, lost data, lost profits, or decisions made from AI-generated output.'],
      ['Contact', `For support or legal questions, contact us at ${SUPPORT_EMAIL}.`],
    ],
  },
  privacy: {
    eyebrow: 'Privacy Policy',
    title: 'Privacy Policy',
    intro: 'This policy explains what IScraper collects, why it is collected, and how it is used. It is written for the current product flow: Supabase login with Google or email, Instagram and Pinterest export uploads, saved links, AI indexing, private saved libraries, and the browser extension that is coming soon.',
    sections: [
      ['Information we collect', 'We collect login details from Supabase and the login method you choose, such as user ID and email, your chosen username, optional profile picture, feedback you submit, uploaded export files, saved link metadata, generated summaries, transcripts, OCR, tags, graph data, provider key settings, credit records, and basic technical logs. Extension token records may be added when the extension launches.'],
      ['Login data', 'Google or email login is used to authenticate you and create your IScraper account. From Supabase and Google, when used, we may receive basic account details such as your user ID, email address, name, and profile image if Google provides them. IScraper does not ask for Gmail, Drive, Calendar, contacts, or other Google account content.'],
      ['Export and saved-link data', 'IScraper uses official export files and saved links that you upload or submit. We do not ask for your social-platform passwords and we removed Instagram login scraping. Your exports and links are used to build your searchable library.'],
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
      ['API keys', 'User AI provider keys are encrypted before storage. Users can add their own keys when they want provider control for AI enrichment.'],
      ['Extension security - coming soon', 'The browser extension uses a scoped extension session created after account sign-in. It does not store your main web-app login token and will not be available to users until browser-store release.'],
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
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{filterLabel(value)}</span>
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
              <span>{filterLabel(option)}</span>
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
  const [typeFilter, setTypeFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');
  const [collectionFilter, setCollectionFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [libraryLayout, setLibraryLayout] = useState(() => readStoredLibraryLayout());
  const [items, setItems] = useState([]);
  const [libraryItems, setLibraryItems] = useState([]);
  const [libraryTotalCount, setLibraryTotalCount] = useState(0);
  const [libraryNextCursor, setLibraryNextCursor] = useState(null);
  const [libraryFacets, setLibraryFacets] = useState({ collections: ['all'], platforms: ['all'] });
  const [libraryLoading, setLibraryLoading] = useState(false);
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
  const [visualSearch, setVisualSearch] = useState(null);
  const [selected, setSelected] = useState(null);
  const [files, setFiles] = useState([]);
  const [importSourceType, setImportSourceType] = useState('auto');
  const [linkForm, setLinkForm] = useState({ url: '', title: '', description: '', note: '' });
  const [uploadInitialMode, setUploadInitialMode] = useState('upload');
  const [noteForm, setNoteForm] = useState({ title: '', body: '', links: '', images: [] });
  const [credentials, setCredentials] = useState([]);
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
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
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
    setVisualSearch(null);
    setQuery('');
  }, []);

  const loadControls = useCallback(async () => {
    const credentialBody = await getProviderCredentials();
    setCredentials(credentialBody.credentials || []);
    setCredentialOptions(credentialBody.options || null);
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
          setLibraryItems([]);
          setLibraryTotalCount(0);
          setLibraryNextCursor(null);
          setSmartCollections([]);
          setSelectedSmartCollection(null);
          setSmartCollectionItems([]);
          setLibraryCare(null);
          setSearchResults(null);
          setVisualSearch(null);
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
        setLibraryItems([]);
        setLibraryTotalCount(0);
        setLibraryNextCursor(null);
        setSmartCollections([]);
        setSelectedSmartCollection(null);
        setSmartCollectionItems([]);
        setLibraryCare(null);
        setSearchResults(null);
        setVisualSearch(null);
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
    searchActive ? ['all', ...unique(boardItems.map((item) => item.collection))] : libraryFacets.collections
  ), [boardItems, libraryFacets.collections, searchActive]);
  const platforms = useMemo(() => (
    searchActive ? ['all', ...unique(boardItems.map((item) => item.platform))] : libraryFacets.platforms
  ), [boardItems, libraryFacets.platforms, searchActive]);
  const pendingReviews = useMemo(() => items.filter((item) => item.sourceStatus === 'needs_review'), [items]);

  const filtered = useMemo(() => {
    if (!searchActive) return libraryItems;
    return sortedItems(boardItems.filter((item) => {
      if (!itemTypeMatches(item, typeFilter)) return false;
      if (!itemStateMatches(item, stateFilter)) return false;
      if (collectionFilter !== 'all' && item.collection !== collectionFilter) return false;
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

  const handleSearch = useCallback(async (event) => {
    event?.preventDefault();
    if (!requireSignIn('search your library')) return;
    const searchText = String(event?.searchQuery ?? query).trim();
    const searchRun = activeSearchRef.current + 1;
    activeSearchRef.current = searchRun;
    setBusy(true);
    setError('');
    try {
      if (!searchText) {
        setSearchResults(null);
        setSearchMeta({ eventId: '', ai: null, feedback: {} });
        setVisualSearch(null);
        await loadItems();
      } else {
        setVisualSearch(null);
        const body = await searchItems(searchText, {}, { includeAi: true });
        const mappedResults = (body.results || []).map(mapItem);
        setSearchResults(mappedResults);
        setSearchMeta({ eventId: body.searchEventId || '', ai: body.ai || null, feedback: {} });
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
  }, [loadItems, mergeUpdatedItem, query, requireSignIn]);

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
      const result = await saveLink({ ...payload, review: options.review === true, startProcessing: false });
      const duplicate = result.skippedDuplicateCount > 0;
      const queued = result.item?.status === 'queued' || result.queuedJobCount > 0;
      const backingUp = result.item?.archive?.status === 'pending';
      setNotice(duplicate
        ? 'That link was already in your library.'
        : backingUp
          ? 'Link saved to your Library. Readable copy is saving in the background.'
          : queued
            ? 'Link saved to your Library and queued for indexing.'
            : 'Link saved to your Library.');
      setLinkForm({ url: '', title: '', description: '', note: '' });
      window.localStorage.removeItem('iscraper.pendingSaveLink');
      await Promise.all([loadItems(), loadLibraryPage({ reset: true }), loadSmartCollections()]);
      options.onSuccess?.();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [linkForm, loadItems, loadLibraryPage, loadSmartCollections, requireProfile, requireSignIn]);

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
      setNoteForm({ title: '', body: '', links: '', images: [] });
      setTab('library');
      replaceAppTabUrl('library');
      setTypeFilter('notes');
      setNotice('Note saved to Library.');
      await loadSmartCollections();
      options.onSuccess?.();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [loadSmartCollections, noteForm, requireProfile, requireSignIn]);

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
        setNotice(`Added ${newCount} new saves. ${skippedCount} already existed.`);
      }
      await Promise.all([loadItems(), loadLibraryPage({ reset: true }), loadSmartCollections()]);
      return true;
    } catch (err) {
      setError(err.message);
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
      setNotice('Added to Library.');
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
    ['gallery', 'Gallery', Images],
    ['smart', 'Smart Collections', Folder],
    ['care', 'Library checkup', ShieldCheck],
    ['upload', 'Add saves', Upload],
  ];
  const advancedNavItems = [
    ['graph', 'Graph view', GitBranch],
    ['settings', 'BYOK', Settings],
  ];
  const SidebarToggleIcon = sidebarExpanded ? PanelLeftClose : PanelLeftOpen;
  const advancedActive = advancedNavItems.some(([key]) => key === tab);
  const sidebarVisibleExpanded = sidebarExpanded || sidebarHoverExpanded;
  const advancedExpanded = sidebarVisibleExpanded && (advancedOpen || advancedActive);

  const selectTab = useCallback((nextTab) => {
    if (!['library', 'gallery', 'smart', 'care', 'graph', 'upload', 'settings'].includes(nextTab)) return;
    if (nextTab === 'upload') setUploadInitialMode('upload');
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
      setBusy(false);
    }
  }, [requireProfile, requireSignIn, selectTab]);

  const tryActivationSearch = useCallback((searchText) => {
    const nextQuery = String(searchText || '').trim();
    selectTab('library');
    if (!nextQuery) return;
    setQuery(nextQuery);
    handleSearch({ preventDefault: () => {}, searchQuery: nextQuery });
  }, [handleSearch, selectTab]);

  useLayoutEffect(() => {
    resetPageScroll();
    const frame = window.requestAnimationFrame(resetPageScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [tab]);

  useEffect(() => {
    if (advancedActive) setAdvancedOpen(true);
  }, [advancedActive]);

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
      setSidebarHoverExpanded(false);
    }, 500);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-black text-foreground">
      <aside
        ref={sidebarRef}
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={handleSidebarMouseLeave}
        className={`hidden h-screen shrink-0 flex-col overflow-hidden border-r border-white/5 bg-black transition-[width] duration-200 md:flex ${
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
            aria-label="Open account settings"
            className={`flex items-center rounded-lg text-sm text-muted-foreground transition hover:bg-white/5 hover:text-foreground ${
              sidebarVisibleExpanded ? 'w-full gap-3 px-3 py-2.5' : 'h-11 w-11 justify-center'
            }`}
          >
            <Settings className="h-4 w-4 shrink-0" />
            {sidebarVisibleExpanded && <span className="truncate">Settings</span>}
          </button>
        </nav>
        <div className={`border-t border-white/5 p-3 ${sidebarVisibleExpanded ? '' : 'flex flex-col items-center'}`}>
          <button
            type="button"
            onClick={() => {
              if (!sidebarVisibleExpanded) {
                setSidebarExpanded(true);
                setAdvancedOpen(true);
                return;
              }
              setAdvancedOpen((current) => !current);
            }}
            title="Advanced Options"
            aria-label="Advanced Options"
            aria-expanded={advancedExpanded}
            className={`flex items-center rounded-lg text-sm transition ${
              advancedActive ? 'text-primary' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
            } ${
              sidebarVisibleExpanded ? 'w-full justify-between gap-3 px-3 py-2.5' : 'h-11 w-11 justify-center'
            }`}
          >
            <span className={`flex items-center ${sidebarVisibleExpanded ? 'gap-3' : ''}`}>
              <Settings className="h-4 w-4 shrink-0" />
              {sidebarVisibleExpanded && <span className="truncate">Advanced Options</span>}
            </span>
            {sidebarVisibleExpanded && (
              <ChevronDown className={`h-4 w-4 shrink-0 transition ${advancedExpanded ? 'rotate-180' : ''}`} />
            )}
          </button>
          {advancedExpanded && (
            <div className={`mt-1 space-y-1 ${sidebarVisibleExpanded ? '' : 'flex flex-col items-center'}`}>
              {advancedNavItems.map(([key, title, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectTab(key)}
                  title={title}
                  aria-label={title}
                  aria-current={tab === key ? 'page' : undefined}
                  className={`flex items-center rounded-lg text-sm transition ${
                    tab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                  } ${
                    sidebarVisibleExpanded ? 'w-full gap-3 px-3 py-2.5 pl-7' : 'h-11 w-11 justify-center'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {sidebarVisibleExpanded && <span className="truncate">{title}</span>}
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
            className="fixed bottom-6 right-6 z-40 inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-2xl shadow-primary/30 transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-black"
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
                    totalCount={searchActive ? items.length : libraryTotalCount}
                    searchActive={searchActive}
                    searchResultCount={boardItems.length}
                    query={query}
                    setQuery={setQuery}
                    onClearSearch={clearSearchState}
                    onSearch={handleSearch}
                    onVisualSearch={handleVisualSearch}
                    visualSearch={visualSearch}
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
                    searchFeedback={searchMeta.feedback}
                    onSearchFeedback={handleSearchFeedback}
                    scrollRef={dashPanelRef}
                    hasMore={!searchActive && Boolean(libraryNextCursor)}
                    loadingMore={libraryLoading}
                    onLoadMore={() => {
                      if (!libraryLoading && libraryNextCursor) loadLibraryPage({ cursor: libraryNextCursor });
                    }}
                  />
                )}
                {authEnabled && !session && tab === 'gallery' && (
                  <AuthRequiredPanel
                    title="Sign in to view Gallery."
                    copy="Gallery is a private visual view of your saved library."
                    busy={busy}
                    onSignIn={onOpenLogin}
                  />
                )}
                {authEnabled && session && profileRequired && tab === 'gallery' && (
                  <ProfileRequiredPanel
                    profileForm={profileForm}
                    setProfileForm={setProfileForm}
                    onAvatarFile={handleAvatarFile}
                    onSave={handleProfileSave}
                    busy={busy}
                  />
                )}
                {canUsePrivateActions && tab === 'gallery' && (
                  <GalleryTab
                    items={filtered}
                    totalCount={searchActive ? items.length : libraryTotalCount}
                    searchActive={searchActive}
                    searchResultCount={boardItems.length}
                    query={query}
                    visualSearch={visualSearch}
                    onClearSearch={clearSearchState}
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
                    onSelect={openDetail}
                    indexingActivity={indexingActivity}
                    activationState={activationState}
                    onOpenAdd={() => selectTab('upload')}
                    onOpenLibrarySearch={() => selectTab('library')}
                    scrollRef={dashPanelRef}
                    hasMore={!searchActive && Boolean(libraryNextCursor)}
                    loadingMore={libraryLoading}
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
                    title="Sign in to open Settings."
                    copy="Settings belong to your private account."
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
                    setCredentialForm={updateCredentialForm}
                    credentialSaveSuccess={credentialSaveSuccess}
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
                    onNotice={setNotice}
                    onError={setError}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </main>

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
          busy={busy}
          onOpenHowTo={onOpenHowTo}
          onOpenFullAdd={() => {
            setQuickAddOpen(false);
            selectTab('upload');
          }}
          onClose={() => setQuickAddOpen(false)}
          onError={setError}
        />
      )}
      {selected && <DetailDrawer item={selected} onClose={() => setSelected(null)} onApprove={handleApproveReview} onArchiveRetry={handleArchiveRetry} onRemind={handleCreateReminder} busy={busy} />}
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
  const [usageItems, setUsageItems] = useState([]);
  const [credits, setCredits] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);
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
        if (!cancelled && err.status !== 423) setError(err.message);
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
        return Promise.all([getItems(), getCredits()]);
      })
      .then(([itemsBody, creditsBody]) => {
        if (cancelled) return;
        setUsageItems((itemsBody.items || []).map(mapItem));
        setCredits(creditsBody.credits || null);
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
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const body = await getPrivacyExportData();
      const exportData = body.export || {};
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `iscraper-privacy-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage(`Privacy export downloaded with ${exportData.items?.length || 0} saves and ${exportData.imports?.length || 0} imports.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
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
  const visualCoverage = dataUsage.searchable
    ? Math.round((dataUsage.visualReady / dataUsage.searchable) * 100)
    : 0;

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
              ['usage', Database, 'Data & usage'],
              ['profile', Settings, 'Profile'],
              ['api', KeyRound, 'API Health'],
              ['requests', AlertCircle, 'Requests'],
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

            {activeTab === 'usage' && (
              <div className="space-y-5">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Data & usage</div>
                  <h3 className="mt-2 font-display text-3xl font-bold tracking-tight">Your library health</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    A quick view of what is saved, what is searchable, and how much enrichment capacity remains.
                  </p>
                </div>

                {usageLoading ? (
                  <div className="grid min-h-56 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      Loading usage...
                    </span>
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

            {activeTab === 'api' && (
              <div className="space-y-5">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">API Health</div>
                  <h3 className="mt-2 font-display text-3xl font-bold tracking-tight">Your saved keys</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">Keys stay hidden until you choose to reveal one.</p>
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
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Privacy export</div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        Download a complete JSON export before requesting deletion. It includes all saved items and all imports returned by the backend export endpoint.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handlePrivacyExport}
                      disabled={busy}
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      Export data
                    </button>
                  </div>
                </section>

                {deletionLoading ? (
                  <div className="grid min-h-36 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      Loading deletion status...
                    </span>
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

function QuickAddModal({
  files,
  setFiles,
  importSourceType,
  setImportSourceType,
  linkForm,
  setLinkForm,
  noteForm,
  setNoteForm,
  onSaveLink,
  onCreateNote,
  onImport,
  busy,
  onOpenHowTo,
  onOpenFullAdd,
  onClose,
  onError,
}) {
  const [mode, setMode] = useState('choose');
  const [showLinkDetails, setShowLinkDetails] = useState(false);
  const [dragging, setDragging] = useState(false);
  const quickFileInputRef = useRef(null);
  const quickNoteImageInputRef = useRef(null);
  const allFileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const noteImageInputRef = useRef(null);
  const importHealth = useMemo(() => importHealthForFiles(files, importSourceType), [files, importSourceType]);

  const addImagesToNote = useCallback((nextImages) => {
    if (!nextImages.length) return;
    setNoteForm((current) => {
      const images = [...current.images];
      const errors = [];
      for (const file of nextImages) {
        const message = noteImageError(file, images.length);
        if (message) {
          errors.push(message);
        } else {
          images.push(file);
        }
      }
      if (errors.length) onError(errors[0]);
      return { ...current, images: images.slice(0, MAX_NOTE_IMAGES) };
    });
  }, [onError, setNoteForm]);

  const handleAnyFiles = useCallback((fileList) => {
    const { images, exports, unsupported } = splitQuickAddFiles(fileList);
    if (images.length) {
      addImagesToNote(images);
      setMode('note');
    }
    if (exports.length) {
      setFiles(exports);
      setImportSourceType('auto');
      setMode('upload');
    }
    if (unsupported.length && !images.length && !exports.length) {
      onError('Upload images, links, or Instagram/Pinterest/X download files.');
    }
  }, [addImagesToNote, onError, setFiles, setImportSourceType]);

  const selectedExportNames = importCandidateFiles(files, importSourceType).slice(0, 5);
  const choices = [
    { mode: 'link', title: 'Paste a link', copy: 'Save one post, product, article, or idea.', icon: ExternalLink },
    { mode: 'note', title: 'Write a note', copy: 'Capture a thought, image, reminder, or useful context.', icon: FileText },
    { mode: 'upload', title: 'Upload files', copy: 'Add Instagram, Pinterest, or X bookmark exports from your device.', icon: Upload },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm md:items-end md:justify-end md:p-6" role="dialog" aria-modal="true" aria-label="Add to your library">
      <div className="flex max-h-[78dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-black shadow-2xl shadow-black md:mb-20 md:w-[26rem] md:rounded-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Quick add</div>
            <h2 className="mt-1 font-display text-2xl font-bold tracking-tight">Add to your Library</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
            aria-label="Close add popup"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {mode !== 'choose' && (
            <button
              type="button"
              onClick={() => setMode('choose')}
              className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
          )}

          {mode === 'choose' && (
            <div className="space-y-3">
              <p className="text-sm leading-6 text-muted-foreground">Pick what you want to add. Open the full Add Saves page when you need folder upload or more options.</p>
              {choices.map(({ mode: choiceMode, title, copy, icon: Icon }) => (
                <button
                  key={choiceMode}
                  type="button"
                  onClick={() => setMode(choiceMode)}
                  className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4 text-left transition hover:border-primary/60 hover:bg-primary/5"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-display text-lg font-bold tracking-tight">{title}</span>
                    <span className="mt-1 block text-sm leading-5 text-muted-foreground">{copy}</span>
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={onOpenFullAdd}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
              >
                <Upload className="h-4 w-4" /> Open full Add Saves page
              </button>
            </div>
          )}

          {mode === 'link' && (
            <form onSubmit={(event) => onSaveLink(event, null, { onSuccess: onClose })} className="space-y-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Paste a link</div>
                <h3 className="mt-2 font-display text-2xl font-bold tracking-tight">Save one thing fast</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Paste a post, product, article, video, or any page you want to find later.</p>
              </div>
              <input
                type="url"
                value={linkForm.url}
                onChange={(event) => setLinkForm((current) => ({ ...current, url: event.target.value }))}
                placeholder="https://..."
                required
                className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
              />
              {showLinkDetails ? (
                <>
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
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowLinkDetails(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
                >
                  <Plus className="h-4 w-4" /> Add title or note
                </button>
              )}
              <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                Save link
              </button>
            </form>
          )}

          {mode === 'note' && (
            <form onSubmit={(event) => onCreateNote(event, { onSuccess: onClose })} className="space-y-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Write a note</div>
                <h3 className="mt-2 font-display text-2xl font-bold tracking-tight">Save a quick thought</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Add the context you want to remember. Images and links are optional.</p>
              </div>
              <textarea
                value={noteForm.body}
                onChange={(event) => setNoteForm((current) => ({ ...current, body: event.target.value }))}
                placeholder="Write the note, reminder, or idea..."
                className="min-h-32 w-full resize-y rounded-xl border border-white/10 bg-black px-4 py-3 text-sm leading-6 outline-none focus:border-primary"
              />
              <input
                value={noteForm.title}
                onChange={(event) => setNoteForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Title optional"
                maxLength={160}
                className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
              />
              <input
                value={noteForm.links}
                onChange={(event) => setNoteForm((current) => ({ ...current, links: event.target.value }))}
                placeholder="Optional links"
                className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => quickNoteImageInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/5"
                >
                  <Upload className="h-4 w-4" /> Add images
                </button>
                <span className="text-xs text-muted-foreground">{noteForm.images.length}/{MAX_NOTE_IMAGES} images selected</span>
                <input
                  ref={quickNoteImageInputRef}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(event) => {
                    addImagesToNote(Array.from(event.target.files || []));
                    event.target.value = '';
                  }}
                  className="hidden"
                />
              </div>
              {noteForm.images.length > 0 && (
                <div className="space-y-2">
                  {noteForm.images.map((file, index) => (
                    <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => setNoteForm((current) => ({ ...current, images: current.images.filter((_, imageIndex) => imageIndex !== index) }))}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                Save note
              </button>
            </form>
          )}

          {mode === 'upload' && (
            <section className="space-y-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Upload files</div>
                <h3 className="mt-2 font-display text-2xl font-bold tracking-tight">Choose export files</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Use this for Instagram, Pinterest, or X bookmark downloads. For folders, open the full Add Saves page.</p>
              </div>
              <button
                type="button"
                onClick={() => quickFileInputRef.current?.click()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground"
              >
                <Upload className="h-4 w-4" /> Choose files
              </button>
              <input
                ref={quickFileInputRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif,.html,.htm,.zip,.json,.csv"
                onChange={(event) => {
                  handleAnyFiles(event.target.files);
                  event.target.value = '';
                }}
                className="hidden"
              />
              <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                <div className="text-sm font-semibold">{importHealth.title}</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{importHealth.copy}</p>
                {selectedExportNames.length > 0 && (
                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {selectedExportNames.map((file) => (
                      <div key={`${fileImportName(file)}-${file.size}`} className="truncate">{fileImportName(file) || file.name}</div>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={async () => {
                  const ok = await onImport();
                  if (ok) onClose();
                }}
                disabled={busy || !files.length}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                Add uploaded files
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onOpenFullAdd}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
                >
                  Full upload
                </button>
                <button
                  type="button"
                  onClick={onOpenHowTo}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
                >
                  <FileText className="h-4 w-4" /> Help
                </button>
              </div>
            </section>
          )}
        </div>

        <div className="hidden">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              handleAnyFiles(event.dataTransfer.files);
            }}
            className={`mb-6 rounded-2xl border-2 border-dashed p-6 text-center transition md:p-8 ${dragging ? 'border-primary bg-primary/10' : 'border-white/15 bg-white/[0.025]'}`}
          >
            <Upload className="mx-auto mb-3 h-8 w-8 text-primary" />
            <h3 className="font-display text-xl font-bold">Drop images, ZIPs, folders, or files here</h3>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Images become note attachments. Instagram, Pinterest, and X bookmark files are detected automatically.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => allFileInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
              >
                <Upload className="h-4 w-4" /> Choose files
              </button>
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-white/5"
              >
                <Database className="h-4 w-4" /> Choose folder
              </button>
              <button
                type="button"
                onClick={onOpenHowTo}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
              >
                <FileText className="h-4 w-4" /> Help
              </button>
            </div>
            <input
              ref={allFileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif,.html,.htm,.zip,.json,.csv"
              onChange={(event) => {
                handleAnyFiles(event.target.files);
                event.target.value = '';
              }}
              className="hidden"
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              webkitdirectory=""
              directory=""
              onChange={(event) => {
                handleAnyFiles(event.target.files);
                event.target.value = '';
              }}
              className="hidden"
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <form onSubmit={(event) => onCreateNote(event, { onSuccess: onClose })} className="space-y-4 rounded-2xl border border-primary/30 bg-primary/5 p-5">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Note</div>
                <h3 className="mt-2 font-display text-2xl font-bold tracking-tight">Save a note, image, or useful link</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Write anything you want to remember. Add images or links when they help.</p>
              </div>
              <input
                value={noteForm.title}
                onChange={(event) => setNoteForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Title optional"
                maxLength={160}
                className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
              />
              <textarea
                value={noteForm.body}
                onChange={(event) => setNoteForm((current) => ({ ...current, body: event.target.value }))}
                placeholder="Write your note..."
                className="min-h-36 w-full resize-y rounded-xl border border-white/10 bg-black px-4 py-3 text-sm leading-6 outline-none focus:border-primary"
              />
              <input
                value={noteForm.links}
                onChange={(event) => setNoteForm((current) => ({ ...current, links: event.target.value }))}
                placeholder="Optional links"
                className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => noteImageInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/5"
                >
                  <Upload className="h-4 w-4" /> Add images
                </button>
                <span className="text-xs text-muted-foreground">{noteForm.images.length}/{MAX_NOTE_IMAGES} images selected</span>
                <input
                  ref={noteImageInputRef}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(event) => {
                    addImagesToNote(Array.from(event.target.files || []));
                    event.target.value = '';
                  }}
                  className="hidden"
                />
              </div>
              {noteForm.images.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {noteForm.images.map((file, index) => (
                    <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => setNoteForm((current) => ({ ...current, images: current.images.filter((_, imageIndex) => imageIndex !== index) }))}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                Save note
              </button>
            </form>

            <div className="space-y-5">
              <form onSubmit={(event) => onSaveLink(event, null, { onSuccess: onClose })} className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Link</div>
                  <h3 className="mt-2 font-display text-2xl font-bold tracking-tight">Save a link</h3>
                </div>
                <input
                  type="url"
                  value={linkForm.url}
                  onChange={(event) => setLinkForm((current) => ({ ...current, url: event.target.value }))}
                  placeholder="https://..."
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
                  Save link
                </button>
              </form>

              <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Instagram, Pinterest, or X</div>
                  <h3 className="mt-2 font-display text-2xl font-bold tracking-tight">Upload a ZIP, folder, or bookmark file</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">Auto-detect is on, so you can upload the file you downloaded.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{importHealth.title}</div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{importHealth.copy}</p>
                    </div>
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted-foreground">
                      {filterLabel(importSourceType)}
                    </span>
                  </div>
                  {selectedExportNames.length > 0 && (
                    <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                      {selectedExportNames.map((file) => (
                        <div key={`${fileImportName(file)}-${file.size}`} className="truncate">{fileImportName(file) || file.name}</div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await onImport();
                    if (ok) onClose();
                  }}
                  disabled={busy || !files.length}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                  Add uploaded files
                </button>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LibraryCheckupTab({ care, loading, busy, onCheckLinks, onOpenItem, onRemind, onUpdateReminder }) {
  const cleanup = care?.cleanup || { duplicateGroups: [], brokenLinks: [], duplicateGroupCount: 0, brokenLinkCount: 0, checkedLinkCount: 0 };
  const resurface = care?.resurface || { dueReminders: [], oldItems: [], weeklyItems: [], randomItem: null };
  const oldSaves = resurface.oldItems || [];
  const weeklyItems = resurface.weeklyItems || [];
  const duplicateGroups = cleanup.duplicateGroups || [];
  const brokenLinks = cleanup.brokenLinks || [];
  const hasCleanResults = duplicateGroups.length > 0 || brokenLinks.length > 0;
  return (
    <div className="mx-auto max-w-[1320px] px-4 pb-28 pt-8 sm:px-6 md:px-10 md:py-12">
      <div className="mb-6 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
        <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="p-6 md:p-8">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <ShieldCheck className="h-3.5 w-3.5" />
              Library checkup
            </div>
            <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">Clean up and rediscover</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Find possible duplicates, links that may not open, and older saves worth revisiting. Nothing changes unless you choose what to do.
            </p>
          </div>
          <div className="border-t border-white/10 bg-black/30 p-6 md:p-8 lg:border-l lg:border-t-0">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <CheckupMetric icon={Copy} label="Possible duplicates" value={cleanup.duplicateGroupCount || 0} />
              <CheckupMetric icon={ExternalLink} label="Links that may not open" value={cleanup.brokenLinkCount || 0} />
              <CheckupMetric icon={Clock} label="Reminders ready" value={resurface.dueReminders?.length || 0} />
            </div>
            <button
              type="button"
              onClick={onCheckLinks}
              disabled={busy || loading}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {busy || loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Check my library
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        <section className="space-y-5">
          <SectionHeader icon={ShieldCheck} title="Clean up your saved links" copy="Review possible duplicates and original links that may not open." />
          {!hasCleanResults && (
            <EmptyCheckup icon={CheckCircle2} title="Your library looks clean for now." copy="Run a check whenever you want to look for possible duplicates or links that may not open." />
          )}
          {duplicateGroups.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Possible duplicates</h3>
              {duplicateGroups.slice(0, 8).map((group) => (
                <div key={group.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">{group.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{group.duplicateCount + 1} saves from {group.host}</div>
                    </div>
                    <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs text-amber-200">Review first</span>
                  </div>
                  <div className="mt-4 grid gap-2">
                    {group.items.map((item) => (
                      <CareItemRow key={item.id} item={item} reason={item.id === group.keepItemId ? 'Oldest saved copy' : 'Possible extra copy'} onOpen={onOpenItem} onRemind={onRemind} busy={busy} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {brokenLinks.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Links that may not open</h3>
              {brokenLinks.slice(0, 10).map((entry) => (
                <CareItemRow
                  key={entry.itemId}
                  item={entry.item}
                  reason={entry.httpStatus ? `Original returned ${entry.httpStatus}` : 'The original page may be unavailable'}
                  onOpen={onOpenItem}
                  onRemind={onRemind}
                  busy={busy}
                />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-5">
          <SectionHeader icon={Clock} title="Rediscover old saves" copy="Bring back useful things you saved but have not opened lately." />
          {resurface.dueReminders?.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Reminders ready</h3>
              {resurface.dueReminders.map((entry) => (
                <CareItemRow
                  key={entry.id}
                  item={entry.item}
                  reason={`Reminder for ${formatUsageDate(entry.remindAt)}`}
                  onOpen={onOpenItem}
                  onRemind={onRemind}
                  busy={busy}
                  extraAction={(
                    <button type="button" onClick={() => onUpdateReminder(entry.id, 'done')} disabled={busy} className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-foreground hover:border-primary disabled:opacity-60">
                      Done
                    </button>
                  )}
                />
              ))}
            </div>
          )}
          {resurface.randomItem && (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                <Zap className="h-4 w-4" /> Surprise me with an old save
              </div>
              <CareItemRow item={resurface.randomItem} reason="Picked for today" onOpen={onOpenItem} onRemind={onRemind} busy={busy} />
            </div>
          )}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Saved 3+ months ago</h3>
            {oldSaves.length ? oldSaves.map((item) => (
              <CareItemRow key={item.id} item={item} reason="Saved 3+ months ago" onOpen={onOpenItem} onRemind={onRemind} busy={busy} />
            )) : <EmptyCheckup icon={Clock} title="No older saves yet." copy="This section fills in as your library grows." />}
          </div>
          {weeklyItems.length > 0 && (
            <details className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-foreground">
                <span>Show me a few old saves each week</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </summary>
              <div className="mt-4 grid gap-2">
                {weeklyItems.map((item) => (
                  <CareItemRow key={item.id} item={item} reason="This week's rediscovery" onOpen={onOpenItem} onRemind={onRemind} busy={busy} />
                ))}
              </div>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}

function CheckupMetric({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/35 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="font-display text-2xl font-bold text-foreground">{formatUsageNumber(value)}</div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, copy }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-primary">
        <Icon className="h-3.5 w-3.5" /> {title}
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{copy}</p>
    </div>
  );
}

function EmptyCheckup({ icon: Icon, title, copy }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center">
      <Icon className="mx-auto h-5 w-5 text-primary" />
      <div className="mt-3 text-sm font-semibold text-foreground">{title}</div>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{copy}</p>
    </div>
  );
}

function CareItemRow({ item, reason, onOpen, onRemind, busy, extraAction = null }) {
  if (!item) return null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/35 p-3 sm:flex-row sm:items-center">
      <button type="button" onClick={() => onOpen?.(item)} className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm font-semibold text-foreground">{item.title || 'Untitled save'}</div>
        <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>{reason}</span>
          {item.collection ? <span>{item.collection}</span> : null}
          {item.createdAt ? <span>Saved {formatUsageDate(item.createdAt)}</span> : null}
        </div>
      </button>
      <div className="flex shrink-0 flex-wrap gap-2">
        {extraAction}
        <button type="button" onClick={() => onRemind?.(item, 'week')} disabled={busy} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-foreground hover:border-primary disabled:opacity-60">
          <Clock className="h-3 w-3" /> Remind me later
        </button>
        <button type="button" onClick={() => onOpen?.(item)} className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">
          Open <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function MobileTopbar({ onBack, tab, setTab, onOpenHowTo, session, profile, onOpenAccount }) {
  const avatarUrl = avatarUrlForSession(session, profile);
  const initial = initialForSession(session, profile);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedActive = tab === 'graph' || tab === 'settings';
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
      <div className="grid grid-cols-5 gap-2">
        {[
          ['library', 'Library'],
          ['gallery', 'Gallery'],
          ['smart', 'Smart'],
          ['care', 'Check'],
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
              ['graph', 'Graph view'],
              ['settings', 'BYOK'],
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

function summarizeIndexing(items) {
  const activeItems = items
    .filter((item) => item.indexingStage === 'visual_indexing' && !isStaleEnrichmentItem(item))
    .map((item) => ({
      id: item.id,
      title: item.sourceTitle || item.title || firstLine(item.caption) || 'Untitled save',
      source: item.sourceAuthor || item.user || item.platform || 'Saved source',
    }))
    .slice(0, 12);
  const metadata = items.filter((item) => item.indexingStage === 'metadata_ready').length;
  const text = items.filter((item) => item.indexingStage === 'text_indexed').length;
  const visual = items.filter((item) => item.indexingStage === 'visual_indexed').length;
  const deep = items.filter((item) => item.indexingStage === 'deep_indexed').length;
  const indexing = items.filter((item) => item.indexingStage === 'visual_indexing' && !isStaleEnrichmentItem(item)).length;
  const failed = items.filter((item) => item.indexingStage === 'index_failed').length;
  const total = items.filter((item) => item.sourceStatus !== 'needs_review').length;
  const enriched = text + indexing + visual + deep;
  const progress = total > 0 ? Math.round((enriched / total) * 100) : 0;

  return {
    metadata,
    text,
    visual,
    deep,
    indexing,
    failed,
    active: indexing,
    activeTotal: indexing,
    activeItems,
    enriched,
    progress,
  };
}

function activityFromIndexingSummary(summary, fallbackItems = []) {
  if (!summary) return summarizeIndexing(fallbackItems);
  const total = Number(summary.needsReview || 0) + Number(summary.totalJobs || 0);
  const enriched = Number(summary.done || 0) + Number(summary.processing || 0);
  return {
    metadata: Number(summary.queued || summary.waiting || 0),
    text: 0,
    visual: Number(summary.done || 0),
    deep: 0,
    indexing: Number(summary.processing || 0),
    failed: Number(summary.failed || 0),
    active: Number(summary.processing || 0),
    activeTotal: Number(summary.processing || 0),
    activeItems: [],
    enriched,
    progress: total > 0 ? Math.round((enriched / total) * 100) : 0,
  };
}

function suggestedSearchQuery(items = []) {
  const source = items.find((item) => firstUsefulCardChip(item) || item.sourceTitle || item.title || firstLine(item.caption));
  if (!source) return '';
  return firstUsefulCardChip(source) || source.sourceTitle || source.title || firstLine(source.caption) || '';
}

function buildActivationState(items = [], activity = summarizeIndexing(items)) {
  const reviewItems = items.filter((item) => item.sourceStatus === 'needs_review');
  const searchableItems = items.filter((item) => item.sourceStatus !== 'needs_review');
  const metadataOnly = searchableItems.filter((item) => item.indexingStage === 'metadata_ready' || item.indexingStage === 'index_failed').length;
  const enriched = searchableItems.filter((item) => DASHBOARD_ENRICHED_STAGES.has(item.indexingStage)).length;
  const failed = searchableItems.filter((item) => item.indexingStage === 'index_failed' || item.status === 'failed').length;
  const searchQuery = suggestedSearchQuery(searchableItems);

  let currentStep = 'add';
  if (items.length > 0 && reviewItems.length > 0 && searchableItems.length === 0) currentStep = 'approve';
  if (searchableItems.length > 0) currentStep = 'search';

  return {
    currentStep,
    total: items.length,
    needsReview: reviewItems.length,
    searchable: searchableItems.length,
    metadataOnly,
    enriched,
    indexing: activity.activeTotal || 0,
    failed,
    searchQuery,
  };
}

function isStaleEnrichmentItem(item) {
  if (item?.indexingStage !== 'visual_indexing') return false;
  const timestamp = Date.parse(item.lastEnrichmentRequestedAt || item.raw?.lastEnrichmentRequestedAt || item.raw?.updatedAt || '');
  return Number.isFinite(timestamp) && Date.now() - timestamp > STALE_ENRICHMENT_UI_MS;
}

function IndexingProgressCard({ activity }) {
  if (!activity.activeTotal) return null;

  const progress = Math.min(99, Math.max(2, activity.progress));

  return (
    <details className="group mt-5 w-full max-w-xl rounded-2xl border border-primary/30 bg-primary/5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Enrichment</div>
            <div className="truncate text-sm font-semibold">{activity.activeTotal} active now</div>
          </div>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition group-open:rotate-180 group-open:text-primary" />
      </summary>
      <div className="space-y-3 border-t border-primary/20 px-4 pb-4 pt-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          <span>{activity.indexing} indexing</span>
          <span>{activity.visual} visual indexed</span>
          <span>{activity.deep} transcript ready</span>
        </div>
        <div className="space-y-2">
          {activity.activeItems.map((item) => (
            <div key={item.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-xs">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
              <div className="min-w-0">
                <div className="truncate font-semibold">{item.title}</div>
                <div className="truncate text-[11px] text-muted-foreground">{item.source}</div>
              </div>
            </div>
          ))}
          {activity.activeTotal > activity.activeItems.length && (
            <div className="text-xs text-muted-foreground">
              {activity.activeTotal - activity.activeItems.length} more saves are still being updated.
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

function ImportHealthPanel({ health, pendingReviewCount, indexingActivity }) {
  const healthMeta = {
    waiting: { icon: FileText, color: 'text-muted-foreground', label: 'Waiting' },
    ready: { icon: CheckCircle2, color: 'text-primary', label: 'Ready' },
    blocked: { icon: AlertCircle, color: 'text-destructive', label: 'Blocked' },
  }[health.state] || { icon: FileText, color: 'text-muted-foreground', label: 'Waiting' };
  const Icon = healthMeta.icon;
  const checks = [
    ['Ready to save', health.title, health.copy, Icon, healthMeta.color],
    ['Needs your OK', `${formatUsageNumber(pendingReviewCount)} waiting`, pendingReviewCount ? 'Review these saved links before they appear in your library.' : 'Nothing is waiting for you right now.', CheckCircle2, pendingReviewCount ? 'text-accent' : 'text-primary'],
    ['Still updating', `${formatUsageNumber(indexingActivity.activeTotal)} active`, indexingActivity.activeTotal ? 'We are adding more details in the background.' : 'Nothing is updating in the background right now.', indexingActivity.activeTotal ? Loader2 : CheckCircle2, indexingActivity.activeTotal ? 'text-accent' : 'text-primary'],
  ];

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Before saving</div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">We will check the files first</h2>
        </div>
        {health.selectedCount > 0 && (
          <span className="rounded-full border border-white/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {formatUsageNumber(health.selectedCount)} selected / {formatBytes(health.totalBytes)}
          </span>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {checks.map(([label, title, copy, CheckIcon, color]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-black/40 p-4">
            <div className={`mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] ${color}`}>
              <CheckIcon className={`h-3.5 w-3.5 ${CheckIcon === Loader2 ? 'animate-spin' : ''}`} /> {label}
            </div>
            <div className="text-sm font-semibold">{title}</div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{copy}</p>
          </div>
        ))}
      </div>
      {health.largeUpload && (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Large uploads may take a little longer. You can keep this page open while we prepare them.
        </p>
      )}
    </section>
  );
}

function MobileFilterGroup({ label, value, options, onChange }) {
  return (
    <section className="space-y-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">{label}</div>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${
              value === option
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-white/10 bg-white/[0.025] text-muted-foreground hover:border-primary/60 hover:text-foreground'
            }`}
          >
            <span className="truncate">{filterLabel(option)}</span>
            {value === option && <Check className="h-4 w-4 shrink-0" />}
          </button>
        ))}
      </div>
    </section>
  );
}

function MobileFiltersSheet({ open, onClose, groups, activeFilters }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm md:hidden" role="dialog" aria-modal="true" aria-label="Library filters">
      <div className="max-h-[82dvh] w-full overflow-hidden rounded-t-2xl border border-white/10 bg-black shadow-2xl shadow-black">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Library</div>
            <h2 className="mt-1 font-display text-2xl font-bold tracking-tight">Filters</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
            aria-label="Close filters"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[calc(82dvh-9.5rem)] space-y-6 overflow-y-auto p-5 pb-24">
          {groups.map((group) => (
            <MobileFilterGroup key={group.label} {...group} />
          ))}
        </div>
        <div className="border-t border-white/10 p-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground"
          >
            Apply {activeFilters > 0 ? `(${activeFilters})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

function LibraryLayoutControl({ value, onChange }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black p-1" aria-label="Library layout">
      {LIBRARY_LAYOUT_ITEMS.map(({ value: option, shortLabel, icon: Icon }) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            title={filterLabel(option)}
            onClick={() => onChange(option)}
            className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${
              selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-white/10 hover:text-foreground'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{shortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

function LibraryTab({
  items,
  totalCount,
  searchActive,
  searchResultCount,
  searchAi,
  searchFeedback,
  query,
  setQuery,
  onClearSearch,
  onSearch,
  onVisualSearch,
  visualSearch,
  busy,
  typeFilter,
  setTypeFilter,
  stateFilter,
  setStateFilter,
  sortOrder,
  setSortOrder,
  collectionFilter,
  setCollectionFilter,
  collections,
  platformFilter,
  setPlatformFilter,
  platforms,
  libraryLayout,
  setLibraryLayout,
  onSelect,
  indexingActivity,
  activationState,
  onOpenAdd,
  onSearchFeedback,
  scrollRef,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const visualSearchInputRef = useRef(null);
  const activeFilters = (typeFilter !== 'all' ? 1 : 0) + (stateFilter !== 'all' ? 1 : 0) + (collectionFilter !== 'all' ? 1 : 0) + (platformFilter !== 'all' ? 1 : 0);
  const updateFilter = useCallback((setter) => (value) => {
    setter(value);
  }, []);
  const mobileFilterGroups = useMemo(() => [
    { label: 'Type', value: typeFilter, options: TYPE_FILTERS, onChange: updateFilter(setTypeFilter) },
    { label: 'Status', value: stateFilter, options: STATE_FILTERS, onChange: updateFilter(setStateFilter) },
    { label: 'Platform', value: platformFilter, options: platforms, onChange: updateFilter(setPlatformFilter) },
    { label: 'Collection', value: collectionFilter, options: collections, onChange: updateFilter(setCollectionFilter) },
    { label: 'Sort', value: sortOrder, options: SORT_OPTIONS, onChange: updateFilter(setSortOrder) },
    { label: 'Layout', value: libraryLayout, options: LIBRARY_LAYOUT_OPTIONS, onChange: updateFilter(setLibraryLayout) },
  ], [collectionFilter, collections, libraryLayout, platformFilter, platforms, sortOrder, stateFilter, typeFilter, updateFilter, setCollectionFilter, setLibraryLayout, setPlatformFilter, setSortOrder, setStateFilter, setTypeFilter]);

  return (
    <div className="mx-auto max-w-[1480px] px-4 pb-28 pt-8 sm:px-6 md:px-10 md:py-12">
      <div className="mb-7">
        <form
          onSubmit={(event) => {
            onSearch(event);
          }}
          className="w-full rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/40 transition focus-within:border-primary focus-within:bg-white/[0.05] md:p-6"
        >
          <textarea
            autoFocus
            rows={2}
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              if (!nextQuery.trim() && searchActive) {
                onClearSearch();
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return;
              event.preventDefault();
              onSearch(event);
            }}
            placeholder="Search your saved posts, links, and notes..."
            className="min-h-16 w-full resize-none bg-transparent text-lg leading-7 outline-none placeholder:text-muted-foreground md:min-h-20 md:text-2xl"
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 px-4 text-sm font-medium text-foreground">
                <Search className="h-4 w-4 text-primary" />
                Search
              </span>
              <input
                ref={visualSearchInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) onVisualSearch(file);
                }}
              />
              <button
                type="button"
                onClick={() => visualSearchInputRef.current?.click()}
                disabled={busy}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 px-4 text-sm font-medium text-foreground transition hover:border-primary hover:bg-white/5 disabled:opacity-60"
              >
                <Images className="h-4 w-4 text-primary" />
                Same vibe
              </button>
              {searchActive && (
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {visualSearch ? `${searchResultCount} visual matches` : `${searchResultCount} matching saves`}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    onClearSearch();
                  }}
                  className="grid h-9 w-9 place-items-center rounded-full border border-white/10 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <button type="submit" className="grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground transition hover:scale-[1.03] disabled:opacity-60" aria-label="Search saves" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </form>
        {visualSearch && (
          <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4 md:flex-row md:items-center">
            <img src={visualSearch.imageDataUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Same Vibe Search</div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Using your uploaded image to find saved visuals with similar visual notes, text, topics, brands, and tags.
              </p>
              {visualSearch.analysis?.visualDescription && (
                <p className="mt-2 line-clamp-2 text-sm text-foreground">{visualSearch.analysis.visualDescription}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClearSearch}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-white/10 px-4 text-sm font-semibold text-foreground transition hover:bg-white/5"
            >
              <X className="h-4 w-4" /> Clear
            </button>
          </div>
        )}
      </div>

      <IndexingProgressCard activity={indexingActivity} />

      {searchActive && (
        <SearchAiPanel ai={searchAi} items={items} onSelect={onSelect} />
      )}

      <div className="sticky top-0 z-20 -mx-4 mt-5 border-y border-white/5 bg-black/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 md:-mx-10 md:px-10">
        <div className="flex flex-col gap-3 text-xs font-mono text-muted-foreground md:flex-row md:items-center md:justify-between">
          <span>
            {items.length} shown from {totalCount || items.length} saves
            {searchActive ? ` · ${searchResultCount} search results from ${totalCount} total saves` : ''}
          </span>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/10 px-4 py-2 font-sans text-sm font-semibold text-foreground transition hover:border-primary md:hidden"
          >
            <Filter className="h-4 w-4 text-primary" />
            Filters {activeFilters > 0 ? `(${activeFilters})` : ''}
          </button>
          <div className="hidden flex-wrap gap-2 md:flex">
            <LibraryLayoutControl value={libraryLayout} onChange={setLibraryLayout} />
            <DashboardFilterSelect
              label="Type"
              ariaLabel="Filter by content type"
              icon={Filter}
              value={typeFilter}
              options={TYPE_FILTERS}
              onChange={(nextType) => {
                  setTypeFilter(nextType);
                }}
            />
            <DashboardFilterSelect
              label="Status"
              ariaLabel="Filter by status"
              icon={CheckCircle2}
              value={stateFilter}
              options={STATE_FILTERS}
              onChange={(nextState) => {
                  setStateFilter(nextState);
                }}
            />
            <DashboardFilterSelect
              label="Platform"
              ariaLabel="Filter by platform"
              value={platformFilter}
              options={platforms}
              onChange={(nextPlatform) => {
                  setPlatformFilter(nextPlatform);
                }}
            />
            <DashboardFilterSelect
              label="Collection"
              ariaLabel="Filter by collection"
              value={collectionFilter}
              options={collections}
              onChange={(nextCollection) => {
                  setCollectionFilter(nextCollection);
                }}
            />
            <DashboardFilterSelect
              label="Sort"
              ariaLabel="Sort library"
              icon={ChevronDown}
              value={sortOrder}
              options={SORT_OPTIONS}
              onChange={(nextSort) => {
                  setSortOrder(nextSort);
                }}
            />
            {activeFilters > 0 && <span className="rounded-full bg-primary px-3 py-2 text-primary-foreground">{activeFilters} active</span>}
          </div>
        </div>
      </div>

      <MobileFiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        groups={mobileFilterGroups}
        activeFilters={activeFilters}
      />

      <div className="mt-8">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center md:p-14">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
              {searchActive && searchResultCount === 0 ? <Search className="h-5 w-5" /> : <Upload className="h-5 w-5" />}
            </div>
            <h3 className="mt-4 font-display text-2xl font-bold tracking-tight">
              {typeFilter === 'notes' && !searchActive
                ? 'No notes yet'
                : searchActive && searchResultCount === 0
                ? 'No matching saves yet'
                : activeFilters > 0
                  ? 'No saves match these filters'
                  : activationState.needsReview
                    ? 'Check one saved link to add it'
                    : 'Add one save to get started'}
            </h3>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              {searchActive && searchResultCount === 0
                ? activationState.searchable
                  ? `${formatUsageNumber(activationState.searchable)} saves are in your Library. Try another title, creator, tag, or collection.`
                  : 'Nothing is in your Library search yet. Add or confirm a save first, then search again.'
                : typeFilter === 'notes'
                  ? 'Create a note from the Add tab and it will appear here immediately.'
                : activeFilters > 0
                  ? 'Clear the active filters or switch back to All to see your saved library.'
                  : activationState.needsReview
                    ? 'Open Add saves, check one saved link, and add it to your Library.'
                    : 'Paste a link or upload your files, then add the saves you want to keep.'}
            </p>
            {(!searchActive || activationState.searchable === 0) && (
              <button
                type="button"
                onClick={onOpenAdd}
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
              >
                <Upload className="h-4 w-4" /> {typeFilter === 'notes' ? 'Create note' : 'Add saves'}
              </button>
            )}
          </div>
        ) : (
          <VirtualLibraryGrid
            items={items}
            scrollRef={scrollRef}
            layoutMode={libraryLayout}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={onLoadMore}
            renderItem={(item, index, cardHeight) => (
              libraryLayout === 'list' ? (
                <LibraryListRow
                  key={item.id}
                  item={item}
                  height={cardHeight}
                  onClick={onSelect}
                  searchActive={searchActive}
                  feedback={searchFeedback?.[item.id]}
                  onSearchFeedback={onSearchFeedback}
                />
              ) : libraryLayout === 'gallery' ? (
                <GalleryCard
                  key={item.id}
                  item={item}
                  height={cardHeight}
                  onClick={onSelect}
                  searchActive={searchActive}
                  feedback={searchFeedback?.[item.id]}
                  onSearchFeedback={onSearchFeedback}
                />
              ) : (
                <PinCard
                  key={item.id}
                  item={item}
                  index={index}
                  height={cardHeight}
                  onClick={onSelect}
                  searchActive={searchActive}
                  feedback={searchFeedback?.[item.id]}
                  onSearchFeedback={onSearchFeedback}
                />
              )
            )}
          />
        )}
      </div>

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="rounded-full border border-white/10 bg-white/[0.04] px-6 py-3 text-sm font-semibold transition hover:border-primary hover:text-primary"
          >
            {loadingMore ? 'Loading...' : 'Show more saves'}
          </button>
        </div>
      )}
    </div>
  );
}

function GalleryTab({
  items,
  totalCount,
  searchActive,
  searchResultCount,
  query,
  visualSearch,
  onClearSearch,
  typeFilter,
  setTypeFilter,
  stateFilter,
  setStateFilter,
  sortOrder,
  setSortOrder,
  collectionFilter,
  setCollectionFilter,
  collections,
  platformFilter,
  setPlatformFilter,
  platforms,
  onSelect,
  indexingActivity,
  activationState,
  onOpenAdd,
  onOpenLibrarySearch,
  scrollRef,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = (typeFilter !== 'all' ? 1 : 0) + (stateFilter !== 'all' ? 1 : 0) + (collectionFilter !== 'all' ? 1 : 0) + (platformFilter !== 'all' ? 1 : 0);
  const visualPreviewCount = items.filter((item) => Boolean(item.thumbnailUrl)).length;
  const pendingPreviewCount = Math.max(0, items.length - visualPreviewCount);
  const updateFilter = useCallback((setter) => (value) => {
    setter(value);
  }, []);
  const mobileFilterGroups = useMemo(() => [
    { label: 'Type', value: typeFilter, options: TYPE_FILTERS, onChange: updateFilter(setTypeFilter) },
    { label: 'Status', value: stateFilter, options: STATE_FILTERS, onChange: updateFilter(setStateFilter) },
    { label: 'Platform', value: platformFilter, options: platforms, onChange: updateFilter(setPlatformFilter) },
    { label: 'Collection', value: collectionFilter, options: collections, onChange: updateFilter(setCollectionFilter) },
    { label: 'Sort', value: sortOrder, options: SORT_OPTIONS, onChange: updateFilter(setSortOrder) },
  ], [collectionFilter, collections, platformFilter, platforms, sortOrder, stateFilter, typeFilter, updateFilter, setCollectionFilter, setPlatformFilter, setSortOrder, setStateFilter, setTypeFilter]);

  return (
    <div className="mx-auto max-w-[1520px] px-4 pb-28 pt-8 sm:px-6 md:px-10 md:py-12">
      <div className="mb-6 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
        <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="p-6 md:p-8">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Images className="h-3.5 w-3.5" />
              Private visual view
            </div>
            <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">Gallery</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              A visual board for screenshots, products, memes, UI references, and image-heavy saves from the same private library.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-white/10 bg-black px-3 py-2 text-muted-foreground">
                {items.length} shown from {totalCount || items.length} saves
              </span>
              <span className="rounded-full border border-white/10 bg-black px-3 py-2 text-muted-foreground">
                {visualPreviewCount} with previews
              </span>
              {pendingPreviewCount > 0 && (
                <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-amber-200">
                  {pendingPreviewCount} preview pending
                </span>
              )}
            </div>
          </div>
          <div className="border-t border-white/10 bg-black/30 p-6 md:p-8 lg:border-l lg:border-t-0">
            <div className="flex h-full flex-col justify-between gap-5">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Creator board</div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Open a card to inspect the original save, source, notes, collection, status, and full image preview.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onOpenAdd}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                >
                  <Plus className="h-4 w-4" /> Add saves
                </button>
                <button
                  type="button"
                  onClick={onOpenLibrarySearch}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-foreground transition hover:border-primary"
                >
                  <Search className="h-4 w-4" /> Search library
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <IndexingProgressCard activity={indexingActivity} />

      {searchActive && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4 text-sm">
          <span className="min-w-0 text-muted-foreground">
            {visualSearch
              ? `Showing Same Vibe matches for ${visualSearch.fileName}: ${searchResultCount} matches.`
              : `Showing Library search results${query ? ` for "${query}"` : ''}: ${searchResultCount} matches.`}
          </span>
          <button
            type="button"
            onClick={onClearSearch}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-white/5"
          >
            <X className="h-3.5 w-3.5" /> Clear search
          </button>
        </div>
      )}

      <div className="sticky top-0 z-20 -mx-4 mt-5 border-y border-white/5 bg-black/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 md:-mx-10 md:px-10">
        <div className="flex flex-col gap-3 text-xs font-mono text-muted-foreground md:flex-row md:items-center md:justify-between">
          <span>
            Visual board | {items.length} shown{activeFilters > 0 ? ` | ${activeFilters} filters active` : ''}
          </span>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/10 px-4 py-2 font-sans text-sm font-semibold text-foreground transition hover:border-primary md:hidden"
          >
            <Filter className="h-4 w-4 text-primary" />
            Filters {activeFilters > 0 ? `(${activeFilters})` : ''}
          </button>
          <div className="hidden flex-wrap gap-2 md:flex">
            <DashboardFilterSelect label="Type" ariaLabel="Filter by content type" icon={Filter} value={typeFilter} options={TYPE_FILTERS} onChange={setTypeFilter} />
            <DashboardFilterSelect label="Status" ariaLabel="Filter by status" icon={CheckCircle2} value={stateFilter} options={STATE_FILTERS} onChange={setStateFilter} />
            <DashboardFilterSelect label="Platform" ariaLabel="Filter by platform" value={platformFilter} options={platforms} onChange={setPlatformFilter} />
            <DashboardFilterSelect label="Collection" ariaLabel="Filter by collection" value={collectionFilter} options={collections} onChange={setCollectionFilter} />
            <DashboardFilterSelect label="Sort" ariaLabel="Sort gallery" icon={ChevronDown} value={sortOrder} options={SORT_OPTIONS} onChange={setSortOrder} />
            {activeFilters > 0 && <span className="rounded-full bg-primary px-3 py-2 text-primary-foreground">{activeFilters} active</span>}
          </div>
        </div>
      </div>

      <MobileFiltersSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} groups={mobileFilterGroups} activeFilters={activeFilters} />

      <div className="mt-8">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center md:p-14">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
              <Images className="h-5 w-5" />
            </div>
            <h3 className="mt-4 font-display text-2xl font-bold tracking-tight">
              {searchActive && searchResultCount === 0
                ? 'No visual matches yet'
                : activeFilters > 0
                  ? 'No saves match these filters'
                  : activationState.needsReview
                    ? 'Check one save to build your Gallery'
                    : 'Add visual saves to start'}
            </h3>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              {searchActive && searchResultCount === 0
                ? 'Clear the Library search or try another term from the Saved library tab.'
                : activeFilters > 0
                  ? 'Clear filters or switch back to All to see your visual board.'
                  : activationState.needsReview
                    ? 'Open Add saves, check one saved link, and add it to your Library.'
                    : 'Paste a link, upload Instagram, Pinterest, or X files, or create a note with images.'}
            </p>
            <button
              type="button"
              onClick={onOpenAdd}
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
            >
              <Upload className="h-4 w-4" /> Add saves
            </button>
          </div>
        ) : (
          <VirtualLibraryGrid
            items={items}
            scrollRef={scrollRef}
            layoutMode="gallery"
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={onLoadMore}
            renderItem={(item, index, cardHeight) => (
              <GalleryCard
                key={item.id}
                item={item}
                height={cardHeight}
                onClick={onSelect}
                searchActive={searchActive}
              />
            )}
          />
        )}
      </div>

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="rounded-full border border-white/10 bg-white/[0.04] px-6 py-3 text-sm font-semibold transition hover:border-primary hover:text-primary"
          >
            {loadingMore ? 'Loading...' : 'Show more saves'}
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

function firstUsefulCardChip(item) {
  return [item.collection, item.tags[0], item.topics[0], item.brands[0], item.tools[0]]
    .map((value) => String(value || '').trim())
    .find((value) => value && value !== 'Unsorted');
}

function shortCardText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function firstSearchReason(item) {
  const match = item.searchMatch;
  const field = match?.matchedFields?.[0];
  if (match?.type === 'visual' && field?.snippet) return field.snippet;
  if (field?.label && field?.terms?.length) return `Matched ${field.label.toLowerCase()}: ${field.terms.slice(0, 3).join(', ')}`;
  if (field?.label) return `Matched ${field.label.toLowerCase()}`;
  if (match?.matchTypes?.includes('semantic')) return 'Matched related meaning';
  return '';
}

function SearchAiPanel({ ai, items, onSelect }) {
  if (!ai) return null;
  if (ai.error) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-5 text-sm text-muted-foreground">
        {ai.error}
      </div>
    );
  }
  const citations = (ai.citations || []).filter((citation) => items.some((item) => item.id === citation.id));
  if (!ai.answer || !citations.length) return null;
  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
      <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-primary">
        <Sparkles className="h-3.5 w-3.5" /> From your saved items
      </div>
      <p className="text-sm leading-6 text-foreground">{ai.answer}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {citations.slice(0, 4).map((citation) => {
          const item = items.find((entry) => entry.id === citation.id);
          return (
            <button
              key={citation.id}
              type="button"
              onClick={() => item && onSelect(item)}
              className="max-w-full rounded-full border border-white/10 px-3 py-1.5 text-left text-xs text-muted-foreground transition hover:border-primary hover:text-foreground"
              title={citation.reason || citation.snippet}
            >
              <span className="line-clamp-1">{citation.title || item?.sourceTitle || item?.title || 'Saved item'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SearchResultFeedback({ itemId, value, onVote }) {
  const saving = value?.status === 'saving';
  const saved = value?.status === 'saved';
  const failed = value?.status === 'failed';
  return (
    <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
      <span className={`text-[11px] ${failed ? 'text-destructive' : 'text-muted-foreground'}`}>
        {saving ? 'Saving vote...' : saved ? 'Vote saved' : failed ? 'Vote failed' : 'This result'}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onVote(itemId, 'helpful');
          }}
          disabled={saving}
          className={`grid h-8 w-8 place-items-center rounded-full border border-white/10 transition hover:border-primary hover:text-primary ${value?.rating === 'helpful' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          aria-label="Mark this result helpful"
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onVote(itemId, 'not_helpful');
          }}
          disabled={saving}
          className={`grid h-8 w-8 place-items-center rounded-full border border-white/10 transition hover:border-destructive hover:text-destructive ${value?.rating === 'not_helpful' ? 'bg-destructive text-white' : 'text-muted-foreground'}`}
          aria-label="Mark this result not helpful"
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function CompactSearchResultFeedback({ itemId, value, onVote }) {
  const saving = value?.status === 'saving';
  const saved = value?.status === 'saved';
  const failed = value?.status === 'failed';
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className={`hidden text-[11px] sm:inline ${failed ? 'text-destructive' : 'text-muted-foreground'}`}>
        {saving ? 'Saving' : saved ? 'Saved' : failed ? 'Failed' : 'Result'}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onVote(itemId, 'helpful');
          }}
          disabled={saving}
          className={`grid h-8 w-8 place-items-center rounded-full border border-white/10 transition hover:border-primary hover:text-primary ${value?.rating === 'helpful' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          aria-label="Mark this result helpful"
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onVote(itemId, 'not_helpful');
          }}
          disabled={saving}
          className={`grid h-8 w-8 place-items-center rounded-full border border-white/10 transition hover:border-destructive hover:text-destructive ${value?.rating === 'not_helpful' ? 'bg-destructive text-white' : 'text-muted-foreground'}`}
          aria-label="Mark this result not helpful"
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

const LibraryListRow = memo(function LibraryListRow({ item, height = 172, onClick, searchActive = false, feedback = null, onSearchFeedback = null }) {
  const card = item.card || cardViewForItem(item);
  const { capture, note, meta } = card;
  const Icon = meta.icon;
  const searchReason = searchActive ? firstSearchReason(item) : '';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick(item);
        }
      }}
      className="group grid w-full grid-cols-[1fr_auto] gap-4 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-left shadow-[0_10px_28px_rgba(0,0,0,0.20)] transition-colors hover:border-primary/60 hover:bg-white/[0.055]"
      style={{ height, contain: 'layout paint style' }}
      data-library-list-row="true"
    >
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-primary">
            {capture ? 'Screen Capture' : note ? 'My Note' : item.platform}
          </span>
          {card.chip && (
            <span className="max-w-[11rem] truncate rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-muted-foreground">
              {card.chip}
            </span>
          )}
          {card.statusLabel && (
            <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${meta.color}`}>
              <Icon className={`h-3 w-3 ${item.indexingStage === 'visual_indexing' ? 'animate-spin' : ''}`} />
              {card.statusLabel}
            </span>
          )}
        </div>
        <h3 className="truncate font-display text-xl font-bold tracking-tight text-foreground md:text-2xl">{card.title}</h3>
        <div className="mt-1 truncate font-mono text-xs text-primary">{card.source}</div>
        <p className="mt-2 line-clamp-2 text-sm leading-5 text-muted-foreground">{searchReason || card.preview}</p>
      </div>
      <div className="flex min-w-0 shrink-0 flex-col items-end justify-between gap-3">
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt=""
            className="h-16 w-16 rounded-xl object-cover opacity-85 sm:h-20 sm:w-20"
            loading="lazy"
            decoding="async"
            width="96"
            height="96"
          />
        ) : (
          <div className="grid h-16 w-16 place-items-center rounded-xl border border-white/10 bg-white/[0.035] text-muted-foreground sm:h-20 sm:w-20">
            {note ? <FileText className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </div>
        )}
        {searchActive && onSearchFeedback ? (
          <CompactSearchResultFeedback itemId={item.id} value={feedback} onVote={onSearchFeedback} />
        ) : (
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
        )}
      </div>
    </div>
  );
});

const GalleryCard = memo(function GalleryCard({ item, height = 380, onClick, searchActive = false, feedback = null, onSearchFeedback = null }) {
  const card = item.card || cardViewForItem(item);
  const { capture, note, meta } = card;
  const Icon = meta.icon;
  const searchReason = searchActive ? firstSearchReason(item) : '';
  const hasPreview = Boolean(item.thumbnailUrl);
  const statusText = item.sourceStatus === 'needs_review' ? 'Needs check' : card.statusLabel || (hasPreview ? 'Preview ready' : 'Preview pending');

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${card.title || 'saved item'} in Gallery`}
      onClick={() => onClick(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick(item);
        }
      }}
      className="group flex w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] text-left shadow-[0_12px_32px_rgba(0,0,0,0.24)] outline-none transition hover:border-primary/60 hover:bg-white/[0.055] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
      style={{ height, contain: 'layout paint style' }}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#10100f]">
        {hasPreview ? (
          <img
            src={item.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.025]"
            loading="lazy"
            decoding="async"
            width="420"
            height="300"
          />
        ) : (
          <div className="grid h-full place-items-center bg-[linear-gradient(135deg,#141414_0%,#20201d_48%,#111_100%)] p-6">
            <div className="text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/[0.045] text-primary">
                {note ? <FileText className="h-5 w-5" /> : <Images className="h-5 w-5" />}
              </span>
              <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Preview pending</div>
              <p className="mt-2 line-clamp-3 text-sm leading-5 text-foreground">{card.preview}</p>
            </div>
          </div>
        )}
        <div className="absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-2">
          <span className="max-w-full rounded-full bg-black/75 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-white backdrop-blur">
            <span className="block truncate">{capture ? 'Screen capture' : note ? 'My note' : item.platform}</span>
          </span>
          {card.imageCount > 1 && (
            <span className="rounded-full bg-black/75 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-white backdrop-blur">
              {card.imageCount} images
            </span>
          )}
        </div>
        <div className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-white/85 text-black shadow-lg shadow-black/30">
          <Icon className={`h-4 w-4 ${meta.icon === Loader2 ? 'animate-spin' : ''}`} />
        </div>
      </div>
      <div className="flex min-h-[132px] flex-col p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="min-w-0 truncate font-mono text-[11px] uppercase tracking-[0.18em] text-primary">{card.source}</span>
          <span className={`shrink-0 rounded-full border border-white/10 px-2 py-1 text-[10px] ${item.sourceStatus === 'needs_review' ? 'text-accent' : 'text-muted-foreground'}`}>
            {statusText}
          </span>
        </div>
        <h3 className="line-clamp-2 font-display text-xl font-bold leading-tight tracking-tight">{card.title}</h3>
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{searchReason || card.preview}</p>
        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          {card.chip ? (
            <span className="min-w-0 truncate rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-muted-foreground">{card.chip}</span>
          ) : (
            <span />
          )}
          {searchActive && onSearchFeedback ? (
            <CompactSearchResultFeedback itemId={item.id} value={feedback} onVote={onSearchFeedback} />
          ) : (
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
          )}
        </div>
      </div>
    </div>
  );
});

const PinCard = memo(function PinCard({ item, index, height = 420, onClick, searchActive = false, feedback = null, onSearchFeedback = null }) {
  const card = item.card || cardViewForItem(item);
  const { capture, note, meta } = card;
  const Icon = meta.icon;
  const backdrop = PIN_BACKDROPS[index % PIN_BACKDROPS.length];
  const searchReason = searchActive ? firstSearchReason(item) : '';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick(item);
        }
      }}
      className="pin-card group block w-full overflow-hidden rounded-[1.25rem] border border-white/10 bg-white/[0.035] text-left shadow-[0_12px_32px_rgba(0,0,0,0.24)] transition-colors duration-200 hover:border-primary/60 hover:bg-white/[0.055]"
      style={{ height, contain: 'layout paint style' }}
    >
      <div className="relative flex h-[62%] min-h-0 flex-col justify-between overflow-hidden p-5 text-black" style={{ background: capture ? '#070707' : note ? 'linear-gradient(135deg, #f7f2df 0%, #d8f99d 100%)' : backdrop }}>
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover ${capture ? 'opacity-85' : 'opacity-45'}`}
            loading="lazy"
            decoding="async"
            width="480"
            height="300"
          />
        ) : null}
        {!capture && <div className="absolute inset-0 opacity-10 grid-bg" />}
        <div className="relative flex items-center justify-between gap-3">
          <span className="rounded-full bg-black/75 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-white">{capture ? 'Screen Capture' : note ? 'My Note' : item.platform}</span>
          <span className="rounded-full bg-white/80 p-2 text-black">
            {note ? <FileText className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </span>
        </div>
        <div className={`relative ${capture ? 'text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.75)]' : ''}`}>
          {card.chip && (
            <span className={`mb-3 inline-flex max-w-full rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-widest ${capture ? 'bg-black/70 text-white' : 'bg-black/15 text-black'}`}>
              <span className="truncate">{card.chip}</span>
            </span>
          )}
          <h3 className="line-clamp-3 font-display text-3xl font-bold leading-none tracking-tight md:text-[2.15rem]">{card.title}</h3>
        </div>
      </div>
      <div className="flex h-[38%] min-h-0 flex-col p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="truncate font-mono text-xs text-primary">{card.source}</span>
          {!note && card.statusLabel && (
            <span className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${meta.color}`}>
              <Icon className={`h-3 w-3 ${item.indexingStage === 'visual_indexing' ? 'animate-spin' : ''}`} />
              {card.statusLabel}
            </span>
          )}
        </div>
        <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{card.preview}</p>
        {note && (card.imageCount > 0 || card.linkCount > 0) && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {card.linkCount > 0 && <span className="rounded-full border border-white/10 px-2.5 py-1">{card.linkCount} links</span>}
            {card.imageCount > 0 && <span className="rounded-full border border-white/10 px-2.5 py-1">{card.imageCount} images</span>}
          </div>
        )}
        {searchReason && (
          <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs leading-5 text-muted-foreground">
            {searchReason}
          </p>
        )}
        {searchActive && onSearchFeedback && (
          <SearchResultFeedback itemId={item.id} value={feedback} onVote={onSearchFeedback} />
        )}
        <div className="mt-auto flex items-center justify-end border-t border-white/10 pt-3 text-muted-foreground">
          <ExternalLink className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
      </div>
    </div>
  );
});

function UploadTab({
  files,
  setFiles,
  importSourceType,
  setImportSourceType,
  initialAddMode = 'upload',
  linkForm,
  setLinkForm,
  noteForm,
  setNoteForm,
  onSaveLink,
  onCreateNote,
  onImport,
  pendingReviews,
  onApproveReview,
  onUpdateReview,
  onSelect,
  busy,
  onOpenHowTo,
  indexingActivity,
  activationState,
  onTrySearch,
}) {
  const [dragging, setDragging] = useState(false);
  const [activeAddMode, setActiveAddMode] = useState(() => (['link', 'note', 'upload'].includes(initialAddMode) ? initialAddMode : 'upload'));
  const linkInputRef = useRef(null);
  const noteImageInputRef = useRef(null);
  const importHealth = useMemo(() => importHealthForFiles(files, importSourceType), [files, importSourceType]);
  const addModeOptions = [
    { value: 'link', label: 'Paste link', icon: ExternalLink },
    { value: 'note', label: 'Write note', icon: FileText },
    { value: 'upload', label: 'Upload files', icon: Upload },
  ];
  const sourceOptions = [
    { value: 'auto', label: 'Choose for me', help: 'Best if you are not sure.' },
    { value: 'instagram', label: 'Instagram', help: 'For files downloaded from Instagram.' },
    { value: 'pinterest', label: 'Pinterest', help: 'For files downloaded from Pinterest.' },
    { value: 'x', label: 'X bookmarks', help: 'For bookmark CSV, JSON, JS, TXT, or ZIP files.' },
  ];
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-20">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Add to your library</h1>
          <p className="mt-2 text-sm text-muted-foreground">Save a note, paste a link, or upload files from Instagram, Pinterest, or X.</p>
        </div>
        <button
          type="button"
          onClick={onOpenHowTo}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-white/5"
        >
          <FileText className="h-4 w-4" /> How to Use
        </button>
      </div>

      <div className="grid gap-2 rounded-2xl border border-white/10 bg-white/[0.025] p-2 md:grid-cols-3">
        {addModeOptions.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setActiveAddMode(value)}
            className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${
              activeAddMode === value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
      {activeAddMode === 'upload' && (
      <>
      

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
        <h3 className="mb-2 font-display text-xl font-bold">Drop your files here</h3>
        <p className="mb-6 font-mono text-xs text-muted-foreground">Instagram ZIP/HTML/JSON · Pinterest ZIP/JSON/CSV · X bookmark ZIP/JS/JSON/CSV/TXT</p>
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
          <input type="file" multiple accept=".html,.htm,.zip,.json,.csv,.js,.txt" onChange={(event) => setFiles(Array.from(event.target.files || []))} className="hidden" />
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

      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <div className="mb-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">File source</div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Where did these files come from?</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
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

      <div>
        <button onClick={onImport} disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
          Add files to Library
        </button>
        {activationState.searchable > 0 && (
          <button
            type="button"
            onClick={() => onTrySearch(activationState.searchQuery)}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-white/5"
          >
            <Search className="h-4 w-4" />
            Go to Library
          </button>
        )}
      </div>
      </>
      )}

      {activeAddMode === 'note' && (
      <form onSubmit={onCreateNote} className="space-y-4 rounded-2xl border border-primary/30 bg-primary/5 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Create note</div>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Write a note for your library</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Notes appear in your Library right away. You can add links and small images.
            </p>
          </div>
          <span className="rounded-full border border-white/10 px-3 py-2 text-xs text-muted-foreground">Images: PNG, JPEG, WebP, GIF · 5 MB</span>
        </div>
        <input
          value={noteForm.title}
          onChange={(event) => setNoteForm((current) => ({ ...current, title: event.target.value }))}
          placeholder="Title optional"
          maxLength={160}
          className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
        />
        <textarea
          value={noteForm.body}
          onChange={(event) => setNoteForm((current) => ({ ...current, body: event.target.value }))}
          placeholder="Write the note, context, reminder, or idea..."
          className="min-h-36 w-full resize-y rounded-xl border border-white/10 bg-black px-4 py-3 text-sm leading-6 outline-none focus:border-primary"
        />
        <input
          value={noteForm.links}
          onChange={(event) => setNoteForm((current) => ({ ...current, links: event.target.value }))}
          placeholder="Optional links, separated by spaces"
          className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => noteImageInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-white/5"
          >
            <Upload className="h-4 w-4" /> Add images
          </button>
          <input
            ref={noteImageInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => {
              const selectedImages = Array.from(event.target.files || []);
              setNoteForm((current) => {
                const nextImages = [...current.images];
                for (const file of selectedImages) {
                  const message = noteImageError(file, nextImages.length);
                  if (!message) nextImages.push(file);
                }
                return { ...current, images: nextImages.slice(0, MAX_NOTE_IMAGES) };
              });
              event.target.value = '';
            }}
            className="hidden"
          />
          <span className="text-xs text-muted-foreground">{noteForm.images.length}/{MAX_NOTE_IMAGES} images selected</span>
        </div>
        {noteForm.images.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {noteForm.images.map((file, index) => (
              <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setNoteForm((current) => ({ ...current, images: current.images.filter((_, imageIndex) => imageIndex !== index) }))}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          Save note to Library
        </button>
      </form>
      )}


      <IndexingProgressCard activity={indexingActivity} />

      {activeAddMode === 'upload' && (
      <>
        <ImportHealthPanel health={importHealth} pendingReviewCount={pendingReviews.length} indexingActivity={indexingActivity} />
      </>
      )}

      {activeAddMode === 'link' && (
      <form onSubmit={onSaveLink} className="space-y-4 rounded-2xl border border-primary/30 bg-primary/5 p-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Save a link</div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Paste a link you want to keep</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            We will show you what we found before it is added to your Library.
          </p>
        </div>
        <input
          ref={linkInputRef}
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
          Save link
        </button>
      </form>
      )}

      {pendingReviews.length > 0 && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Confirm links</div>
              <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">{pendingReviews.length} saved links need a quick check</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Check the title and note, then add them to your Library.</p>
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
              Add all to Library
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
            <span className="text-muted-foreground">Needs check</span>
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
          Add to Library
        </button>
      </div>
    </article>
  );
}

function SettingsTab({
  credentials,
  credentialForm,
  setCredentialForm,
  credentialSaveSuccess,
  onSave,
  onDelete,
  onTest,
  busy,
  authEnabled,
  onOpenHowTo,
  onNotice,
  onError,
}) {
  const selectedSetup = KEY_SETUP_OPTIONS[credentialForm.setup] || KEY_SETUP_OPTIONS.openrouter_all;
  const [providerWarning, setProviderWarning] = useState(null);
  const [telegramCode, setTelegramCode] = useState('');
  const [captureBusy, setCaptureBusy] = useState(false);
  const providerWarningCopy = providerWarning ? PROVIDER_WARNING_COPY[providerWarning] : null;
  const groupedCredentials = credentials.reduce((groups, credential) => {
    const key = `${credential.provider}:${credential.keyHint}:${credential.baseUrl || ''}:${credential.displayName || ''}`;
    if (!groups[key]) {
      groups[key] = {
        id: key,
        provider: credential.provider,
        baseUrl: credential.baseUrl,
        displayName: credential.displayName,
        keyHint: credential.keyHint,
        credentials: [],
      };
    }
    groups[key].credentials.push(credential);
    return groups;
  }, {});
  const createTelegramCode = async () => {
    setCaptureBusy(true);
    onError?.('');
    try {
      const body = await createExtensionToken('Telegram save bot', ['saves:create']);
      setTelegramCode(body.secret || '');
      onNotice?.('Telegram bot link code created. Send it to the bot with /connect.');
    } catch (err) {
      onError?.(err.message || 'Could not create a Telegram bot link code.');
    } finally {
      setCaptureBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-20">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-4xl font-bold tracking-tight">Settings</h1>
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
          AI enrichment can use your saved provider keys. Paid IScraper credits are coming soon for users who do not want to bring their own key.
        </p>
      </div>

      <section className="space-y-4 rounded-2xl border border-white/10 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Browser extension</div>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Capture extension</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The extension connects through your IScraper account and supports Capture URL plus Screen Capture after browser-store release.
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-white/10 px-5 py-3 text-sm font-semibold text-muted-foreground">
            Coming soon
          </span>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-white/10 p-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Fast capture</div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Mobile share and Telegram</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            IScraper can receive shared links from supported mobile browsers. Telegram bot linking uses a private code from this account.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
            <div className="flex items-center gap-2 font-semibold">
              <ExternalLink className="h-4 w-4 text-primary" /> Mobile share-sheet
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              When IScraper is installed as an app, supported Android browsers can share links into the Add Saves screen.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
            <div className="flex items-center gap-2 font-semibold">
              <Bot className="h-4 w-4 text-primary" /> Telegram save bot
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Create a code, send <span className="font-mono text-foreground">/connect</span> plus the code to the bot, then forward links.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={createTelegramCode}
          disabled={busy || captureBusy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60"
        >
          {captureBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
          Create Telegram bot link code
        </button>
        {telegramCode && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Private bot link code</div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-white/10 bg-black px-3 py-2 text-xs text-foreground">
                /connect {telegramCode}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(`/connect ${telegramCode}`).then(() => onNotice?.('Telegram connect command copied.'));
                }}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-white/5"
              >
                <Copy className="h-4 w-4" /> Copy
              </button>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">Treat this like a password. This code only allows saving links into your account.</p>
          </div>
        )}
      </section>

      <form onSubmit={onSave} className="space-y-4 rounded-2xl border border-white/10 p-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Add key</div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Choose where your key is from</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            For built-in providers, IScraper chooses the model. Advanced OpenAI-compatible services need their base URL and model ID.
          </p>
        </div>
        <div className="grid gap-2 rounded-xl border border-white/10 p-1">
          {Object.entries(KEY_SETUP_OPTIONS).map(([setup, option]) => (
            <button
              key={setup}
              type="button"
              onClick={() => {
                if (PROVIDER_WARNING_COPY[setup] && credentialForm.setup !== setup) {
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
        {credentialForm.setup === 'openai_compatible' && (
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm leading-6 text-muted-foreground">{OPENAI_COMPATIBLE_NOTE}</p>
            <input
              value={credentialForm.displayName}
              onChange={(event) => setCredentialForm((current) => ({ ...current, displayName: event.target.value }))}
              placeholder="Service name optional, e.g. Groq or Together"
              className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm outline-none focus:border-primary"
            />
            <input
              type="url"
              value={credentialForm.baseUrl}
              onChange={(event) => setCredentialForm((current) => ({ ...current, baseUrl: event.target.value }))}
              placeholder="Base URL, e.g. https://api.example.com/v1"
              required
              className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 font-mono text-sm outline-none focus:border-primary"
            />
            <input
              value={credentialForm.model}
              onChange={(event) => setCredentialForm((current) => ({ ...current, model: event.target.value }))}
              placeholder="Model ID, e.g. provider/model-name"
              required
              className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 font-mono text-sm outline-none focus:border-primary"
            />
          </div>
        )}
        <div className={`space-y-3 rounded-xl border p-4 transition ${
          credentialSaveSuccess ? 'border-emerald-400 bg-emerald-500/15' : 'border-white/10 bg-transparent'
        }`}>
          {credentialSaveSuccess && (
            <div className="rounded-lg border border-emerald-300/40 bg-emerald-400/15 px-4 py-3 text-sm leading-6 text-emerald-100">
              <div className="font-display text-xl font-black tracking-tight text-emerald-200">SUCCESS</div>
              <div>Your key was saved. IScraper will use it when it can.</div>
            </div>
          )}
          <input
            type="password"
            value={credentialForm.apiKey}
            onChange={(event) => setCredentialForm((current) => ({ ...current, apiKey: event.target.value }))}
            placeholder="Paste API key"
            required
            className={`w-full rounded-xl border bg-black px-4 py-3 font-mono text-sm outline-none ${
              credentialSaveSuccess ? 'border-emerald-400 focus:border-emerald-300' : 'border-white/10 focus:border-primary'
            }`}
          />
        </div>
        <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Save key
        </button>
      </form>

      <div className="space-y-3">
        {Object.values(groupedCredentials).map((group) => (
          <div key={group.id} className="flex items-center gap-3 rounded-xl border border-white/10 p-4">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{group.displayName || PROVIDER_DISPLAY_LABELS[group.provider] || group.provider}</div>
              <div className="truncate text-xs text-muted-foreground">
                {group.credentials.map((credential) => credential.purpose).join(', ')} - {group.keyHint}
                {group.baseUrl ? ` - ${group.baseUrl}` : ''}
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

      {providerWarningCopy && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-red-500/60 bg-black p-6 shadow-[0_24px_80px_rgba(0,0,0,0.65)]">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-red-400">Before you continue</div>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-red-100">{providerWarningCopy.title}</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {providerWarningCopy.body} For the easiest full setup, use OpenRouter.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setCredentialForm((current) => ({ ...current, setup: 'openrouter_all' }));
                  setProviderWarning(null);
                }}
                className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
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

const GRAPH_UI_NODE_LIMIT = 240;
const GRAPH_UI_LINK_LIMIT = 420;

function capGraphForUi(graph) {
  if (!graph?.nodes?.length) return graph;
  if (graph.nodes.length <= GRAPH_UI_NODE_LIMIT && (graph.links || []).length <= GRAPH_UI_LINK_LIMIT) return graph;
  const nodes = [...graph.nodes]
    .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))
    .slice(0, GRAPH_UI_NODE_LIMIT);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = (graph.links || [])
    .filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target))
    .slice(0, GRAPH_UI_LINK_LIMIT);
  return {
    ...graph,
    nodes,
    links,
    capped: true,
    originalNodeCount: graph.nodes.length,
    originalLinkCount: graph.links?.length || 0,
  };
}

function GraphTab({ onSelectItem }) {
  const [graph, setGraph] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [graphSidebarTab, setGraphSidebarTab] = useState('details');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const graphViewportRef = useRef(null);
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
        if (!cancelled) setGraph(capGraphForUi(body.graph));
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

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

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
  const graphSidebarTabs = [
    { key: 'details', label: 'Details' },
    { key: 'explore', label: 'Explore' },
    { key: 'export', label: 'Export' },
  ];
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
    setZoom((current) => {
      const nextZoom = clampZoom(current + delta);
      zoomRef.current = nextZoom;
      return nextZoom;
    });
  };

  const zoomGraphAt = useCallback((clientX, clientY, deltaY, viewport) => {
    if (!viewport || deltaY === 0) return;
    const rect = viewport.getBoundingClientRect();
    const pointerX = ((clientX - rect.left) / Math.max(rect.width, 1)) * 1000;
    const pointerY = ((clientY - rect.top) / Math.max(rect.height, 1)) * 620;
    const delta = Math.max(-1, Math.min(1, deltaY));
    const scaleFactor = delta > 0 ? 0.9 : 1.1;

    const currentZoom = zoomRef.current;
    const currentPan = panRef.current;
    const nextZoom = clampZoom(currentZoom * scaleFactor);
    if (nextZoom === currentZoom) return;

    const localX = (pointerX - 500 - currentPan.x) / currentZoom;
    const localY = (pointerY - 310 - currentPan.y) / currentZoom;
    const nextPan = {
      x: pointerX - 500 - localX * nextZoom,
      y: pointerY - 310 - localY * nextZoom,
    };
    zoomRef.current = nextZoom;
    panRef.current = nextPan;
    setZoom(nextZoom);
    setPan(nextPan);
  }, []);

  useEffect(() => {
    const viewport = graphViewportRef.current;
    if (!viewport) return undefined;
    const handleWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();
      zoomGraphAt(event.clientX, event.clientY, event.deltaY, viewport);
    };
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [zoomGraphAt]);

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
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedNodeId(null);
  };

  return (
    <div className="mx-auto max-w-[1480px] space-y-6 px-4 py-8 sm:px-6 md:px-10 md:py-12">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Knowledge graph</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-6xl">Your indexed saves as a knowledge map.</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
            Nodes are built from indexed titles, topics, tags, brands, people, and collections. Export it when you want Obsidian or an AI agent to work with your saved-library graph.
          </p>
        </div>
      </div>

      {error && <Banner type="error">{error}</Banner>}

      <div className="grid gap-3 sm:grid-cols-3">
        <GraphStat label="Indexed saves" value={graph?.stats?.indexedItems ?? 0} />
        <GraphStat label="Concept nodes" value={graph?.stats?.conceptNodes ?? 0} />
        <GraphStat label="Graph links" value={graph?.stats?.links ?? 0} />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div ref={graphViewportRef} className="relative h-[340px] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025] shadow-2xl shadow-black/25 sm:h-[380px] lg:h-[430px] xl:h-[460px]">
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
            <div className="grid h-full place-items-center text-muted-foreground">Loading graph...</div>
          ) : !graph?.nodes?.length ? (
            <div className="grid h-full place-items-center px-8 text-center text-muted-foreground">
              No graph nodes yet. Add searchable saves first, then come back here.
            </div>
          ) : (
            <svg
              viewBox="0 0 1000 620"
              className="h-full w-full touch-none select-none cursor-grab active:cursor-grabbing"
              style={{ userSelect: 'none' }}
              onTouchStart={handleGraphTouchStart}
              onTouchMove={handleGraphTouchMove}
              onTouchEnd={handleGraphTouchEnd}
              onTouchCancel={() => {
                touchGestureRef.current = null;
              }}
              onPointerDown={(event) => {
                if (event.pointerType === 'touch') return;
                event.preventDefault();
                const nodeId = event.target.closest?.('[data-graph-node]')?.getAttribute('data-node-id') || '';
                event.currentTarget.setPointerCapture?.(event.pointerId);
                dragRef.current = {
                  x: event.clientX,
                  y: event.clientY,
                  pan: panRef.current,
                  nodeId,
                  moved: false,
                };
              }}
              onPointerMove={(event) => {
                if (event.pointerType === 'touch') return;
                if (!dragRef.current) return;
                const dx = event.clientX - dragRef.current.x;
                const dy = event.clientY - dragRef.current.y;
                if (Math.hypot(dx, dy) > 3) {
                  dragRef.current.moved = true;
                }
                const nextPan = { x: dragRef.current.pan.x + dx, y: dragRef.current.pan.y + dy };
                panRef.current = nextPan;
                setPan(nextPan);
              }}
              onPointerUp={(event) => {
                if (event.pointerType === 'touch') return;
                const gesture = dragRef.current;
                if (gesture) event.currentTarget.releasePointerCapture?.(event.pointerId);
                dragRef.current = null;
                if (gesture?.nodeId && !gesture.moved) {
                  setGraphSidebarTab('details');
                  setSelectedNodeId((current) => (current === gesture.nodeId ? null : gesture.nodeId));
                }
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
                    data-node-id={node.id}
                    transform={`translate(${point.x} ${point.y})`}
                    className="cursor-pointer"
                    opacity={dim ? 0.22 : 1}
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

        <aside className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-black p-1">
            {graphSidebarTabs.map((sidebarTab) => (
              <button
                key={sidebarTab.key}
                type="button"
                onClick={() => setGraphSidebarTab(sidebarTab.key)}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  graphSidebarTab === sidebarTab.key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                }`}
              >
                {sidebarTab.label}
              </button>
            ))}
          </div>

          {graphSidebarTab === 'details' && (
            <div className="mt-5">
              <div className="flex items-start gap-3">
                <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: graphNodeColor(selectedNode?.type || 'item') }} />
                <div className="min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">
                    {selectedNode ? selectedNode.type : 'Selection'}
                  </div>
                  <h2 className="mt-1 line-clamp-2 font-display text-xl font-bold tracking-tight">
                    {selectedNode ? selectedNode.label : 'Click a node'}
                  </h2>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {selectedNode
                  ? selectedNode.type === 'item'
                    ? selectedNode.summary || 'No summary available.'
                    : `${selectedNode.itemCount || selectedConnections.length} linked saves or concepts.`
                  : 'Click any node to show details and nearby connections.'}
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
              <div className="mt-5 border-t border-white/10 pt-4">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Connected nodes</div>
                {selectedConnections.length > 0 ? (
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {selectedConnections.map((node) => (
                      <button key={node.id} type="button" onClick={() => setSelectedNodeId(node.id)} className="flex w-full items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-left text-xs transition hover:border-primary">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: graphNodeColor(node.type) }} />
                        <span className="min-w-0 flex-1 truncate">{node.label}</span>
                        <span className="text-[10px] uppercase text-muted-foreground">{node.type}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-muted-foreground">
                    {selectedNode ? 'No nearby nodes found.' : 'Select a node to see its connections.'}
                  </p>
                )}
              </div>
            </div>
          )}

          {graphSidebarTab === 'explore' && (
            <div className="mt-5 space-y-5">
              <section>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Top concepts</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {conceptNodes.slice(0, 24).map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => {
                        setSelectedNodeId(node.id);
                        setGraphSidebarTab('details');
                      }}
                      className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary hover:text-foreground"
                    >
                      {node.label}
                    </button>
                  ))}
                  {!conceptNodes.length && <span className="text-sm text-muted-foreground">No concept nodes yet.</span>}
                </div>
              </section>

              <section className="border-t border-white/10 pt-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Indexed saves</div>
                <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
                  {itemNodes.slice(0, 40).map((node) => (
                    <button key={node.id} onClick={() => onSelectItem(node.itemId)} className="block w-full rounded-xl border border-white/10 p-3 text-left transition hover:border-primary">
                      <div className="line-clamp-1 text-sm font-semibold">{node.label}</div>
                      <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{node.summary}</div>
                    </button>
                  ))}
                  {!itemNodes.length && <span className="text-sm text-muted-foreground">No indexed saves yet.</span>}
                </div>
              </section>
            </div>
          )}

          {graphSidebarTab === 'export' && (
            <div className="mt-5 space-y-4">
              <div>
                <h2 className="font-display text-xl font-bold tracking-tight">Export for Obsidian or AI tools</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Download your graph, then use the prompt below with a local-file agent.
                </p>
              </div>
              <div className="grid gap-2">
                <button onClick={handleExport} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:scale-[1.01]">
                  <Download className="h-4 w-4" />
                  Export Obsidian graph
                </button>
                <button onClick={handleCopyPrompt} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-foreground transition hover:border-primary hover:text-primary">
                  <Check className="h-4 w-4" />
                  {copied ? 'Copied' : 'Copy AI prompt'}
                </button>
              </div>
              <textarea readOnly value={prompt} className="h-64 w-full resize-none rounded-xl border border-white/10 bg-black p-4 font-mono text-xs leading-5 text-muted-foreground outline-none" />
            </div>
          )}
        </aside>
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

  if (isNoteItem(item) && !isExtensionCaptureItem(item)) {
    addRow('Note', item.caption, FileText, true);
    return rows;
  }

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

function DetailDrawer({ item, onClose, onApprove, onArchiveRetry, onRemind, busy }) {
  const ref = useRef(null);
  const [assetPreview, setAssetPreview] = useState(null);
  const indexingMeta = INDEXING_META[item.indexingStage] || INDEXING_META.metadata_ready;
  const IndexingIcon = indexingMeta.icon;
  const capture = isExtensionCaptureItem(item);
  const note = isNoteItem(item) && !capture;
  const imageAssets = (item.assets || []).filter((asset) => asset.assetType === 'image' && asset.url);
  const detailStatusLabel = item.sourceStatus === 'needs_review'
    ? 'Needs check'
    : item.indexingStage === 'visual_indexing'
      ? 'Updating'
      : item.indexingStage === 'index_failed' || item.status === 'failed'
        ? 'Issue'
        : '';
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
              <span>{capture ? 'Screen Capture' : note ? 'My Note' : item.platform}</span>
              {item.sourceAuthor ? <span className="text-muted-foreground">/ {item.sourceAuthor}</span> : null}
              {!note && detailStatusLabel && (
                <span className={`inline-flex items-center gap-1 ${indexingMeta.color}`}>
                  <IndexingIcon className={`h-3 w-3 ${item.indexingStage === 'visual_indexing' ? 'animate-spin' : ''}`} />
                  {detailStatusLabel}
                </span>
              )}
            </div>
            {item.thumbnailUrl ? (
              <button
                type="button"
                onClick={() => setAssetPreview({ url: item.thumbnailUrl, label: item.sourceTitle || item.title || 'Screen capture' })}
                className="mb-5 block w-full overflow-hidden rounded-2xl border border-white/10"
              >
                <img src={item.thumbnailUrl} alt="" className="max-h-64 w-full object-cover transition hover:scale-[1.01]" />
              </button>
            ) : null}
            <h2 className="mb-3 font-display text-3xl font-bold tracking-tight">{item.sourceTitle || item.title}</h2>
            {!note && (
              <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary">
                Open original save <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {!note && <ArchivePanel item={item} busy={busy} onRetry={onArchiveRetry} />}
            <ReminderPanel item={item} busy={busy} onRemind={onRemind} />
            {item.sourceStatus === 'needs_review' && (
              <button
                type="button"
                onClick={() => onApprove(item)}
                disabled={busy}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Add to Library
              </button>
            )}
          </div>

          {item.error && <Section icon={AlertCircle} label="Error">{item.error}</Section>}
          {note && <Section icon={FileText} label="Note" mono>{item.caption}</Section>}
          {(note || (capture && !item.thumbnailUrl)) && imageAssets.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {imageAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => setAssetPreview({ url: asset.url, label: item.sourceTitle || item.title || 'Saved image' })}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025] text-left transition hover:border-primary"
                >
                  <img src={asset.url} alt="" className="max-h-64 w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
          {item.indexingError && <Section icon={AlertCircle} label="Update note">{item.indexingError}</Section>}
          {!note && item.indexingStage === 'visual_indexing' && <Section icon={Loader2} label="Updating">We are adding more details for this save now.</Section>}
          {capture && (
            <Section icon={Brain} label="AI image analysis">
              {item.hasAnalysis ? (item.summary || item.visual || item.ocr) : 'Image analysis will appear here when processing finishes.'}
            </Section>
          )}
          {!note && <InsightPanel insight={insight} />}
          {insight.verify && (
            <Section icon={AlertCircle} label="Check before using">
              This save may mention dates, prices, funding, availability, or terms that can change. Verify the original source before acting on it.
            </Section>
          )}
          <ChipGroup icon={Bot} label="Mentioned" items={insight.mentions} />
          <ChipGroup icon={Hash} label="Topics" items={insight.topics} />
          {!note && <OriginalDetails rows={insight.originalRows} />}
        </div>
      </div>
      {assetPreview && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/85 p-6 backdrop-blur-sm" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="absolute right-5 top-5 rounded-lg border border-white/10 bg-black/70 p-3 text-white hover:bg-white/10" onClick={() => setAssetPreview(null)} aria-label="Close image preview">
            <X className="h-5 w-5" />
          </button>
          <img src={assetPreview.url} alt={assetPreview.label} className="max-h-[88vh] max-w-[92vw] rounded-2xl border border-white/10 object-contain shadow-2xl shadow-black" />
        </div>
      )}
    </div>
  );
}

function ArchivePanel({ item, busy, onRetry }) {
  const archive = item.archive;
  const status = archive?.status || 'none';
  const blocked = ['blocked_host', 'blocked_port', 'unsupported_content_type', 'no_readable_content', 'unsupported_protocol'].includes(archive?.errorCode);
  const ready = status === 'ready';
  const pending = status === 'pending';
  const failed = status === 'failed' || status === 'skipped';
  const label = ready
    ? 'Readable copy saved'
    : pending
      ? 'Saving readable copy...'
      : failed && blocked
        ? 'This site blocked page backup'
        : failed
          ? 'Could not save copy'
          : 'No saved copy yet';
  const help = ready
    ? 'Article text and readable page content are saved in case the original link breaks later.'
    : pending
      ? 'The link is saved now. Page backup runs in the background.'
      : 'Page backup saves article text and readable page content when the site allows it.';

  return (
    <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {ready ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : pending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : <FileText className="h-3.5 w-3.5" />}
            Page backup
          </div>
          <div className="text-sm font-semibold text-foreground">{label}</div>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">{help}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs text-muted-foreground hover:border-primary hover:text-primary">
              Open original <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {!pending && !ready && (
            <button
              type="button"
              onClick={() => onRetry?.(item)}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              Try again
            </button>
          )}
        </div>
      </div>
      {ready && (
        <details className="mt-5 rounded-xl border border-white/10 bg-black/30 p-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-foreground">
            <span>{archive.title || item.sourceTitle || item.title}</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </summary>
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {archive.siteName ? <span>{archive.siteName}</span> : null}
              {archive.capturedAt ? <span>Saved {new Date(archive.capturedAt).toLocaleDateString()}</span> : null}
              {archive.textLength ? <span>{archive.textLength.toLocaleString()} characters</span> : null}
            </div>
            {archive.excerpt ? <p className="text-sm leading-relaxed text-foreground">{archive.excerpt}</p> : null}
            {archive.contentText ? (
              <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/40 p-4 text-sm leading-relaxed text-muted-foreground">
                {archive.contentText}
              </div>
            ) : null}
          </div>
        </details>
      )}
      {failed && archive?.errorMessage ? (
        <p className="mt-3 text-xs text-muted-foreground">{archive.errorMessage}</p>
      ) : null}
    </div>
  );
}

function ReminderPanel({ item, busy, onRemind }) {
  if (!item?.id) return null;
  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> Reminder
          </div>
          <div className="text-sm font-semibold text-foreground">Bring this back later</div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Useful for links, references, and ideas you want to revisit.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            ['tomorrow', 'Tomorrow'],
            ['week', 'Next week'],
            ['month', 'Next month'],
          ].map(([preset, label]) => (
            <button
              key={preset}
              type="button"
              onClick={() => onRemind?.(item, preset)}
              disabled={busy}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-foreground transition hover:border-primary disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
              {label}
            </button>
          ))}
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
