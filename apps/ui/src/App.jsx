import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Database,
  Download,
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
  X,
  Zap,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';
import {
  approveReviewItem,
  createExtensionToken,
  deleteProviderCredential,
  downloadObsidianGraph,
  getItem,
  getItems,
  getKnowledgeGraph,
  getProfile,
  getExtensionTokens,
  getPublicFeedback,
  getProviderCredentials,
  importInstagramExport,
  restartQueue,
  revokeExtensionToken,
  saveLink,
  saveProfile,
  saveProviderCredential,
  searchItems,
  setApiAccessToken,
  submitPublicFeedback,
  testProviderCredential,
  updateReviewItem,
} from './api';
import { supabase } from './supabaseClient';

gsap.registerPlugin(ScrollTrigger);

const STATUS_META = {
  needs_review: { color: 'text-accent', icon: FileText },
  queued: { color: 'text-muted-foreground', icon: Activity },
  downloading: { color: 'text-accent', icon: Loader2 },
  analyzing: { color: 'text-primary', icon: Sparkles },
  done: { color: 'text-primary', icon: CheckCircle2 },
  failed: { color: 'text-destructive', icon: AlertCircle },
  paused: { color: 'text-muted-foreground', icon: Pause },
  paused_needs_billing: { color: 'text-muted-foreground', icon: Pause },
  paused_api_limit: { color: 'text-muted-foreground', icon: Pause },
  paused_missing_provider: { color: 'text-muted-foreground', icon: Pause },
};

const STATUSES = ['all', 'needs_review', 'done', 'analyzing', 'queued', 'downloading', 'failed', 'paused'];
const FEEDBACK_FEATURE_OPTIONS = ['Search', 'Dashboard', 'Collections', 'AI summaries', 'Exporting', 'Mobile experience', 'Privacy', 'Other'];
const EXTENSION_INSTALL_URL = import.meta.env.VITE_EXTENSION_INSTALL_URL || '';
const HERO_PLATFORMS = [
  { name: 'Instagram', src: '/platforms/instagram.svg', bg: 'transparent', scale: 1.08 },
  { name: 'X', src: '/platforms/x.svg', bg: '#fff' },
  { name: 'Facebook', src: '/platforms/facebook.svg', bg: '#1877f2' },
  { name: 'Pinterest', src: '/platforms/pinterest.svg', bg: '#e60023' },
  { name: 'TikTok', src: '/platforms/tiktok.svg', bg: '#000' },
  { name: 'YouTube', src: '/platforms/youtube.svg', bg: '#ff0033' },
];

function normalizeStatus(status = 'queued') {
  return String(status).startsWith('paused') ? 'paused' : status;
}

function mapItem(item) {
  const analysis = item.analysis || {};
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

function openExternalUrl(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
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

function getRouteFromHash() {
  const hash = window.location.hash || '';
  if (hash === '#app' || hash.startsWith('#app?')) return 'app';
  if (window.location.hash === '#how-to-use') return 'how-to-use';
  if (window.location.hash === '#terms') return 'terms';
  if (window.location.hash === '#privacy') return 'privacy';
  if (window.location.hash === '#help') return 'help';
  if (window.location.hash === '#security') return 'security';
  if (window.location.hash === '#data-deletion') return 'data-deletion';
  if (window.location.hash === '#cookies') return 'cookies';
  return 'landing';
}

function pendingSaveFromHash() {
  const hash = window.location.hash || '';
  if (!hash.startsWith('#app?')) return null;
  const params = new URLSearchParams(hash.slice('#app?'.length));
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

function itemIdFromHash() {
  const hash = window.location.hash || '';
  if (!hash.startsWith('#app?')) return '';
  return new URLSearchParams(hash.slice('#app?'.length)).get('item') || '';
}

function extensionConnectFromHash() {
  const hash = window.location.hash || '';
  return hash.startsWith('#app?') && new URLSearchParams(hash.slice('#app?'.length)).get('connectExtension') === '1';
}

function rememberPendingSave() {
  const pending = pendingSaveFromHash();
  if (!pending) return;
  window.localStorage.setItem('iscraper.pendingSaveLink', JSON.stringify(pending));
}

export default function App() {
  const [route, setRoute] = useState(() => {
    rememberPendingSave();
    return getRouteFromHash();
  });

  const navigate = useCallback((nextRoute) => {
    setRoute(nextRoute);
    window.location.hash = ['app', 'how-to-use', 'terms', 'privacy', 'help', 'security', 'data-deletion', 'cookies'].includes(nextRoute) ? nextRoute : '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      rememberPendingSave();
      setRoute(getRouteFromHash());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (route === 'app') return <Dashboard onBack={() => navigate('landing')} onOpenHowTo={() => navigate('how-to-use')} />;
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

function Landing({ onOpenApp, onOpenHowTo, onOpenTerms, onOpenPrivacy, onOpenHelp, onOpenSecurity, onOpenDataDeletion, onOpenCookies }) {
  const root = useRef(null);
  const introRef = useRef(null);
  const cursorRef = useRef(null);
  const heroTitle = useRef(null);
  const [showExtensionPopup, setShowExtensionPopup] = useState(false);
  const [launchOfferDismissed, setLaunchOfferDismissed] = useState(() => window.localStorage.getItem('iscraper.launchOffer.dismissed') === '1');
  const [feedback, setFeedback] = useState([]);
  const [feedbackForm, setFeedbackForm] = useState({ feature: 'Search', message: '' });
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState('');

  useEffect(() => {
    window.history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    getPublicFeedback()
      .then((body) => setFeedback(body.feedback || []))
      .catch(() => setFeedback([]));
  }, []);

  useEffect(() => {
    if (window.localStorage.getItem('iscraper.extensionPromo.dismissed') === '1') return undefined;
    const timer = window.setTimeout(() => setShowExtensionPopup(true), 15000);
    return () => window.clearTimeout(timer);
  }, []);

  const dismissExtensionPopup = () => {
    window.localStorage.setItem('iscraper.extensionPromo.dismissed', '1');
    setShowExtensionPopup(false);
  };

  const dismissLaunchOffer = () => {
    window.localStorage.setItem('iscraper.launchOffer.dismissed', '1');
    setLaunchOfferDismissed(true);
  };

  const openExtensionSection = () => {
    if (EXTENSION_INSTALL_URL) {
      openExternalUrl(EXTENSION_INSTALL_URL);
    } else {
      scrollToLandingSection('#extension');
    }
    dismissExtensionPopup();
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
      <div ref={introRef} className="fixed inset-0 z-[200] grid place-items-center bg-black">
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
          <button
            type="button"
            onClick={onOpenApp}
            className="nav-item pointer-events-auto group inline-flex items-center gap-2 justify-self-end rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-[0_16px_55px_rgba(164,255,18,0.22)] transition hover:scale-[1.03]"
          >
            Open library <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </button>
        </div>
      </header>

      <section className={`landing-hero relative flex min-h-screen items-center overflow-hidden bg-black ${launchOfferDismissed ? 'pt-36' : 'pt-48'}`}>
        <div className="parallax-grid radial-fade grid-bg absolute inset-0 opacity-60" />
        <div
          className="parallax-glow-primary absolute -left-20 -top-32 h-[480px] w-[480px] rounded-full opacity-40 blur-[120px]"
          style={{ background: 'radial-gradient(circle, var(--glow) 0%, transparent 70%)' }}
        />
        <div
          className="parallax-glow-secondary absolute right-0 top-40 h-[520px] w-[520px] rounded-full opacity-30 blur-[140px]"
          style={{ background: 'radial-gradient(circle, var(--glow-2) 0%, transparent 70%)' }}
        />

        <div className="hero-content relative mx-auto w-full max-w-[100rem] overflow-visible px-6 pr-16 md:px-10 md:pr-20 xl:px-14 xl:pr-24">
          <h1
            ref={heroTitle}
            className="overflow-visible text-balance font-display text-[clamp(3rem,10.5vw,11rem)] font-bold leading-[0.95] tracking-tighter"
          >
            {heroWords.map((word, index) => (
              <span key={word} className="mr-[0.18em] inline-block overflow-visible">
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
                onClick={onOpenApp}
                className="glow-ring group inline-flex items-center gap-3 rounded-full bg-primary px-7 py-4 text-base font-semibold text-primary-foreground transition hover:scale-[1.03]"
              >
                Open my library <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
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
              [CheckCircle2, 'First 200 saves included', 'Start with 200 imported saves covered by IScraper before paid credits matter.'],
              [Tag, 'Organized without the cleanup', 'Group saves by themes like travel, food, fitness, shopping, home, business, or inspiration.'],
              [Lock, 'Private by default', 'Your saved export starts on your machine, so your personal taste and plans stay yours.'],
              [ShieldCheck, 'Built around official export', 'Use Instagram export files to build your library without handing over your Instagram login.'],
              [KeyRound, 'Browser extension ready', 'Use the extension to send the current tab into IScraper without giving the extension your account token.'],
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
              Save and search while you browse.
            </h2>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              The IScraper extension lets you save the page you are on, run Lens search on selected text, or drag over an image area and search your private brain.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={openExtensionSection}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-4 text-sm font-semibold text-primary-foreground transition hover:scale-[1.03]"
              >
                {EXTENSION_INSTALL_URL ? 'Install extension' : 'Chrome Store page coming'} <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onOpenApp}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-4 text-sm transition hover:bg-white/5"
              >
                <KeyRound className="h-4 w-4" /> Connect token
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
              Works today on Chromium browsers like Chrome, Edge, Brave, Arc, and Opera. Firefox and Safari need their own store packages before we call them fully supported.
            </p>
            {!EXTENSION_INSTALL_URL && (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Chrome Web Store listing is being prepared. Once approval is live, this button will open the public install page.
              </p>
            )}
          </div>

          <div data-reveal className="grid gap-4 sm:grid-cols-2">
            {[
              [KeyRound, 'Limited token', 'The extension stores only a revokable Lens token, not your Google login.'],
              [Search, 'Selected text search', 'Highlight text on any normal web page and search it across your saved library.'],
              [Eye, 'Image crop Lens', 'Drag over text or an object in an image and search the closest saved posts.'],
              [ShieldCheck, 'Store-ready behavior', 'No background scraping, no automatic page scanning, and no remote extension code.'],
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

      <ExtensionInstallPopup
        visible={showExtensionPopup}
        onInstall={openExtensionSection}
        onOpenHowTo={onOpenHowTo}
        onDismiss={dismissExtensionPopup}
        hasInstallUrl={Boolean(EXTENSION_INSTALL_URL)}
      />
    </div>
  );
}

function ExtensionInstallPopup({ visible, onInstall, onOpenHowTo, onDismiss, hasInstallUrl }) {
  return (
    <aside
      aria-live="polite"
      className={`fixed bottom-5 right-5 z-[120] w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-primary/50 bg-black p-5 shadow-[0_24px_80px_rgba(0,0,0,0.55)] transition duration-500 ${
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-10 opacity-0'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Browser extension</div>
          <h3 className="mt-2 font-display text-2xl font-bold tracking-tight">Take IScraper with you.</h3>
        </div>
        <button type="button" onClick={onDismiss} className="rounded-full border border-white/10 p-2 text-muted-foreground transition hover:text-foreground" aria-label="Close extension popup">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Save pages, Lens-search selected text, and search image crops from Chrome, Edge, Brave, Arc, and other Chromium browsers.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={onInstall} className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground">
          {hasInstallUrl ? 'Install extension' : 'See extension'} <ArrowRight className="h-4 w-4" />
        </button>
        <button type="button" onClick={onOpenHowTo} className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 px-4 py-3 text-sm text-foreground transition hover:bg-white/5">
          <FileText className="h-4 w-4" /> How to use
        </button>
        <button type="button" onClick={onDismiss} className="rounded-full border border-white/10 px-4 py-3 text-sm text-muted-foreground transition hover:text-foreground">
          Later
        </button>
      </div>
    </aside>
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

const HOW_TO_GUIDES = [
  { key: 'instagram', icon: Upload, title: 'Instagram export', copy: 'Get your saved posts file from Instagram and upload it into IScraper.', status: 'Guide ready' },
  { key: 'api-keys', icon: KeyRound, title: 'API keys', copy: 'Add your own AI keys for summaries, media reading, and semantic search.', status: 'Coming soon' },
  { key: 'pinterest', icon: ExternalLink, title: 'Pinterest export', copy: 'Bring saved pins into your library when Pinterest import support is ready.', status: 'Coming soon' },
  { key: 'extension', icon: Search, title: 'Browser extension', copy: 'Save pages, use Lens search, and open results from your browser.', status: 'Coming soon' },
];

function HowToUsePage({ onBack, onOpenApp }) {
  const pageRef = useRef(null);
  const [activeGuide, setActiveGuide] = useState(null);
  const activeGuideDetails = HOW_TO_GUIDES.find((guide) => guide.key === activeGuide);

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
            Guides for imports, API keys, and the extension.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
            Start with Instagram export today. We will keep adding simple guides here for API keys, Pinterest, the browser extension, and other import flows.
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
              We will add the API key, Pinterest, and extension walkthroughs here as those flows are finalized.
            </p>
          </section>
        )}

        {activeGuide && activeGuide !== 'instagram' && (
          <section className="howto-reveal rounded-[2rem] border border-white/10 bg-white/[0.025] p-6 md:p-10">
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-primary">{activeGuideDetails?.status}</div>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight">{activeGuideDetails?.title}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              This guide will live here next. For now, use the Help Center or email us if you get stuck.
            </p>
          </section>
        )}

        {activeGuide === 'instagram' && (
          <>
            <section className="howto-reveal mb-6">
              <div className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Instagram export</div>
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
const SUPPORT_TOPIC_OPTIONS = ['Import help', 'Login or account', 'Extension', 'Search results', 'Billing or credits', 'Other'];

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
    [LifeBuoy, 'Account support', 'Email us if Google login, usernames, profile setup, or extension tokens are not working.'],
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
            If something breaks, you cannot import, or the extension feels confusing, email us and include what you were trying to do.
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
      ['Browser extension', 'The IScraper browser extension is optional. It can save the active page, search selected text, or send a small user-selected screenshot crop to IScraper Lens. It must be used only on pages and content you are allowed to process.'],
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
    intro: 'This policy explains what IScraper collects, why it is collected, and how it is used. It is written for the current product flow: Google/Supabase login, Instagram export upload, saved links, optional browser extension, AI indexing, and private saved libraries.',
    sections: [
      ['Information we collect', 'We collect login details from Supabase/Google such as user ID and email, your chosen username, optional profile picture, feedback you submit, uploaded Instagram export files, saved post metadata, generated summaries, transcripts, OCR, tags, graph data, provider key settings, extension token records, credit records, and basic technical logs.'],
      ['Google login data', 'Google login is used to authenticate you and create your IScraper account. From Google/Supabase we may receive basic account details such as your user ID, email address, name, and profile image if Google provides them. IScraper does not ask for Gmail, Drive, Calendar, contacts, or other Google account content. Google OAuth configuration must use the Supabase callback URL and must include this privacy policy URL before public launch.'],
      ['Instagram data', 'IScraper uses official Instagram export files that you upload. We do not ask for your Instagram password and we removed Instagram login scraping. Your export is used to build your searchable library.'],
      ['AI providers', 'If indexing is enabled, parts of your uploaded content may be sent to configured AI providers such as OpenRouter, Gemini, or your own connected provider key. This is done to generate summaries, transcripts, OCR, tags, and embeddings.'],
      ['Browser extension data', 'The extension runs only when you click it. For saving, it sends the current page URL, title, page metadata, and your optional note to IScraper. For Lens search, it sends selected text or a small screenshot crop that you choose. Screenshot crops are not stored by default; they are used to produce a search query and then discarded.'],
      ['How we use data', 'We use your data to authenticate your account, keep your library separate from other users, process imports, search your saves, build your graph, show anonymous public feedback, prevent abuse, enforce limits, improve reliability, send service messages, respond to support requests, and send product updates or marketing emails only where you have opted in or where legally permitted.'],
      ['Google data limits', 'We do not sell Google login data, use it to build advertising profiles, or transfer it to unrelated third parties for marketing. We use Google login data only for account access, account communication, security, support, and the email uses described in this policy.'],
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
      ['Account protection', 'IScraper uses Supabase Auth and Google sign-in for account access. Users must complete profile setup before importing saved content. Keep your Google account secure because it controls access to your IScraper account.'],
      ['Data separation', 'Production data is stored in Supabase with user ownership checks and row-level security policies. The backend uses the service role only on server-side routes, never in browser code.'],
      ['API keys', 'User AI provider keys are encrypted before storage. Until paid credits are live, IScraper is BYOK-only, so users control the AI providers used for indexing.'],
      ['Extension security', 'The browser extension uses a limited, revokable Lens token instead of your main login token. It does not scan pages in the background and only runs after you click it.'],
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
      ['What we delete', 'We can delete your account profile, saved items, imports, generated summaries, OCR/transcripts, graph data, provider key records, extension tokens, and credit records tied to your account where deletion is legally and technically allowed.'],
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
      ['Analytics and ads', 'IScraper does not currently use advertising cookies or third-party ad tracking cookies. If analytics are added later, this notice should be updated before public use.'],
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

function Dashboard({ onBack, onOpenHowTo }) {
  const [tab, setTab] = useState('library');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [collectionFilter, setCollectionFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [files, setFiles] = useState([]);
  const [linkForm, setLinkForm] = useState({ url: '', title: '', description: '', note: '' });
  const [credentials, setCredentials] = useState([]);
  const [extensionTokens, setExtensionTokens] = useState([]);
  const [newExtensionSecret, setNewExtensionSecret] = useState('');
  const [credentialOptions, setCredentialOptions] = useState(null);
  const [credentialForm, setCredentialForm] = useState({
    purpose: 'text',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-pro',
    apiKey: '',
  });
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileRequired, setProfileRequired] = useState(false);
  const [profileForm, setProfileForm] = useState({ username: '', avatarUrl: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sidebarRef = useRef(null);
  const pendingSaveHandledRef = useRef(false);
  const pendingItemHandledRef = useRef(false);
  const extensionConnectHandledRef = useRef(false);
  const authEnabled = Boolean(supabase);

  const loadItems = useCallback(async () => {
    const body = await getItems();
    setItems((body.items || []).map(mapItem));
  }, []);

  const loadControls = useCallback(async () => {
    const [credentialBody, extensionBody] = await Promise.all([
      getProviderCredentials(),
      getExtensionTokens(),
    ]);
    setCredentials(credentialBody.credentials || []);
    setCredentialOptions(credentialBody.options || null);
    setExtensionTokens(extensionBody.tokens || []);
  }, []);

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
    const initialize = async () => {
      try {
        if (authEnabled) {
          const profileBody = await getProfile();
          applyProfileState(profileBody.profile, profileBody.required);
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
      if (data.session) initialize();
      else setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setApiAccessToken(nextSession?.access_token);
      if (nextSession) initialize();
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
    gsap.fromTo(
      '.dash-panel-inner',
      { opacity: 0.92, y: 6 },
      { opacity: 1, y: 0, duration: 0.18, ease: 'power2.out', clearProps: 'opacity,transform' },
    );
  }, [tab]);

  const collections = useMemo(() => ['all', ...unique(items.map((item) => item.collection))], [items]);
  const platforms = useMemo(() => ['all', ...unique(items.map((item) => item.platform))], [items]);
  const pendingReviews = useMemo(() => items.filter((item) => item.sourceStatus === 'needs_review'), [items]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (collectionFilter !== 'all' && item.collection !== collectionFilter) return false;
      if (platformFilter !== 'all' && item.platform !== platformFilter) return false;
      return true;
    });
  }, [collectionFilter, items, platformFilter, statusFilter]);

  const stats = useMemo(() => ({
    total: items.length,
    done: items.filter((item) => item.status === 'done').length,
    queued: items.filter((item) => item.status === 'queued').length,
    needsReview: items.filter((item) => item.sourceStatus === 'needs_review').length,
    paused: items.filter((item) => item.status === 'paused' || item.status === 'failed').length,
  }), [items]);

  const handleGoogleSignIn = async () => {
    setBusy(true);
    setError('');
    try {
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/#app`,
        },
      });
      if (signInError) throw signInError;
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
    setNotice('');
    try {
      const body = await saveProfile(profileForm);
      applyProfileState(body.profile, false);
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
    setBusy(true);
    setError('');
    try {
      if (!query.trim()) {
        await loadItems();
      } else {
        const body = await searchItems(query);
        setItems((body.results || []).map(mapItem));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveLink = useCallback(async (event, override = null) => {
    event?.preventDefault();
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
      setNotice(duplicate ? 'That link was already in your brain.' : 'Link saved to review. Approve it when you want to index it.');
      setLinkForm({ url: '', title: '', description: '', note: '' });
      window.localStorage.removeItem('iscraper.pendingSaveLink');
      await loadItems();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [linkForm, loadItems]);

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
    const itemId = itemIdFromHash();
    if (!itemId) return;
    pendingItemHandledRef.current = true;
    const timer = window.setTimeout(() => {
      setTab('library');
      getItem(itemId)
        .then((body) => setSelected(mapItem(body.item)))
        .catch((err) => setError(err.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authEnabled, loading, profileRequired, session]);

  useEffect(() => {
    if (extensionConnectHandledRef.current || loading || (authEnabled && (!session || profileRequired))) return;
    if (!extensionConnectFromHash()) return;
    extensionConnectHandledRef.current = true;
    const timer = window.setTimeout(() => {
      setTab('settings');
      setNotice('Create a Lens token here, then paste it into the extension.');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authEnabled, loading, profileRequired, session]);

  const handleImport = async () => {
    if (!files.length) {
      setError('Upload saved_posts.html and optionally saved_collections.html.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await importInstagramExport({ files });
      const newCount = result.newItemCount ?? result.itemCount ?? 0;
      const skippedCount = result.skippedDuplicateCount ?? 0;
      setNotice(`Added ${newCount} new saves. ${skippedCount} already existed. ${result.queuedJobCount ?? result.jobCount ?? 0} queued for indexing.`);
      await loadItems();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRestart = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await restartQueue();
      setNotice('Queue restarted. Refreshing results shortly.');
      window.setTimeout(() => loadItems().catch((err) => setError(err.message)), 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateReview = async (item, updates) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = await updateReviewItem(item.id, updates);
      const nextItem = mapItem(body.item);
      setItems((current) => current.map((entry) => (entry.id === nextItem.id ? nextItem : entry)));
      setSelected((current) => (current?.id === nextItem.id ? nextItem : current));
      setNotice('Review details saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleApproveReview = async (item, updates = {}) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = await approveReviewItem(item.id, { ...updates, startProcessing: true });
      const nextItem = mapItem(body.item);
      setItems((current) => current.map((entry) => (entry.id === nextItem.id ? nextItem : entry)));
      setSelected((current) => (current?.id === nextItem.id ? nextItem : current));
      setNotice((body.queuedJobCount || 0) > 0 ? 'Approved. Indexing has started.' : 'Approved. This save was already indexed.');
      window.setTimeout(() => loadItems().catch((err) => setError(err.message)), 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (item) => {
    setError('');
    try {
      const body = await getItem(item.id);
      setSelected(mapItem(body.item));
    } catch (err) {
      setError(err.message);
    }
  };

  const saveCredential = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    let saved = null;
    try {
      saved = await saveProviderCredential(credentialForm);
      await testProviderCredential(saved.credential.id);
      setCredentialForm((current) => ({ ...current, apiKey: '' }));
      await loadControls();
      setNotice(`Connected. Your ${saved.credential.provider} key works.`);
    } catch (err) {
      setError(saved ? `Key saved, but test failed: ${err.message}` : err.message);
      await loadControls().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const handleCreateExtensionToken = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = await createExtensionToken('IScraper Lens extension');
      setNewExtensionSecret(body.secret || '');
      await loadControls();
      setNotice('Lens token created. Paste it into the browser extension once.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeExtensionToken = async (id) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await revokeExtensionToken(id);
      if (newExtensionSecret) setNewExtensionSecret('');
      await loadControls();
      setNotice('Lens token revoked.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const providerChoices = useMemo(() => {
    if (!credentialOptions) return [];
    if (credentialForm.purpose === 'media') return Object.entries(credentialOptions.mediaProviders || {});
    if (credentialForm.purpose === 'embedding') return Object.entries(credentialOptions.embeddingProviders || {});
    return Object.entries(credentialOptions.textProviders || {});
  }, [credentialForm.purpose, credentialOptions]);

  const applyPurpose = (purpose) => {
    const model = purpose === 'media'
      ? credentialOptions?.defaultAppMediaModel || 'google/gemini-3.1-flash-lite-preview'
      : purpose === 'embedding'
        ? credentialOptions?.defaultEmbeddingModel || 'openai/text-embedding-3-small'
        : credentialOptions?.defaultAppTextModel || 'deepseek/deepseek-v4-pro';
    setCredentialForm({ purpose, provider: 'openrouter', model, apiKey: '' });
  };

  const applyProvider = (provider) => {
    const group = credentialForm.purpose === 'media'
      ? credentialOptions?.mediaProviders
      : credentialForm.purpose === 'embedding'
        ? credentialOptions?.embeddingProviders
        : credentialOptions?.textProviders;
    setCredentialForm((current) => ({ ...current, provider, model: group?.[provider]?.defaultModel || current.model }));
  };

  if (authEnabled && !session) {
    return (
      <div className="grid min-h-screen place-items-center bg-black px-6 text-foreground">
        <div className="glow-ring w-full max-w-md rounded-2xl border border-white/10 bg-black p-8">
          <BrandLogo className="mb-8 h-16 w-56" />
          <h1 className="font-display text-4xl font-bold tracking-tight">Open your library</h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in with Google before importing. Your saved library stays tied to your private account.</p>
          <button type="button" onClick={handleGoogleSignIn} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Continue with Google
          </button>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">By continuing, you agree to the Terms of Service and Privacy Policy.</p>
          {error && <Banner type="error">{error}</Banner>}
          {notice && <Banner>{notice}</Banner>}
        </div>
      </div>
    );
  }

  if (authEnabled && session && profileRequired) {
    return (
      <div className="grid min-h-screen place-items-center bg-black px-6 text-foreground">
        <form onSubmit={handleProfileSave} className="glow-ring w-full max-w-md rounded-2xl border border-white/10 bg-black p-8">
          <BrandLogo className="mb-8 h-16 w-56" />
          <h1 className="font-display text-4xl font-bold tracking-tight">Choose your username</h1>
          <p className="mt-2 text-sm text-muted-foreground">Required before importing. Usernames are unique, so no two users can claim the same one.</p>
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
          {error && <Banner type="error">{error}</Banner>}
          {notice && <Banner>{notice}</Banner>}
        </form>
      </div>
    );
  }

  const navItems = [
    ['library', 'Saved library', Brain],
    ['graph', 'Graph', GitBranch],
    ['upload', 'Add saves', Upload],
    ['settings', 'Keys & privacy', Settings],
  ];

  return (
    <div className="flex min-h-screen bg-black text-foreground">
      <aside ref={sidebarRef} className="hidden w-60 shrink-0 flex-col border-r border-white/5 bg-black md:flex">
        <button onClick={onBack} className="flex items-center gap-3 border-b border-white/5 px-5 py-4 transition hover:opacity-80">
          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          <BrandLogo className="h-14 w-40" />
        </button>
        {profile?.username && (
          <div className="border-b border-white/5 px-5 py-3 text-xs text-muted-foreground">
            Signed in as <span className="font-semibold text-foreground">@{profile.username}</span>
          </div>
        )}
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map(([key, title, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
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

      <main className="min-w-0 flex-1">
        <div className="dash-panel min-h-screen overflow-auto">
          <div className="dash-panel-inner">
            <MobileTopbar onBack={onBack} tab={tab} setTab={setTab} onOpenHowTo={onOpenHowTo} />
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
                {tab === 'library' && (
                  <LibraryTab
                    items={filtered}
                    totalCount={items.length}
                    query={query}
                    setQuery={setQuery}
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
                    onRestart={handleRestart}
                  />
                )}
                {tab === 'graph' && (
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
                {tab === 'upload' && (
                  <UploadTab
                    files={files}
                    setFiles={setFiles}
                    linkForm={linkForm}
                    setLinkForm={setLinkForm}
                    onSaveLink={handleSaveLink}
                    onImport={handleImport}
                    onRestart={handleRestart}
                    pendingReviews={pendingReviews}
                    onApproveReview={handleApproveReview}
                    onUpdateReview={handleUpdateReview}
                    onSelect={openDetail}
                    busy={busy}
                    onOpenHowTo={onOpenHowTo}
                  />
                )}
                {tab === 'settings' && (
                  <SettingsTab
                    credentials={credentials}
                    extensionTokens={extensionTokens}
                    newExtensionSecret={newExtensionSecret}
                    credentialForm={credentialForm}
                    setCredentialForm={setCredentialForm}
                    providerChoices={providerChoices}
                    applyPurpose={applyPurpose}
                    applyProvider={applyProvider}
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
                    onCreateExtensionToken={handleCreateExtensionToken}
                    onRevokeExtensionToken={handleRevokeExtensionToken}
                    onClearExtensionSecret={() => setNewExtensionSecret('')}
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
    </div>
  );
}

function MobileTopbar({ onBack, tab, setTab, onOpenHowTo }) {
  return (
    <div className="sticky top-0 z-30 border-b border-white/10 bg-black/90 p-3 backdrop-blur md:hidden">
      <div className="mb-3 flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" />
          <BrandLogo className="h-10 w-36" />
        </button>
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

function LibraryTab({
  items,
  totalCount,
  query,
  setQuery,
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
  onRestart,
}) {
  const boardRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(80);
  const activeFilters = (statusFilter !== 'all' ? 1 : 0) + (collectionFilter !== 'all' ? 1 : 0) + (platformFilter !== 'all' ? 1 : 0);
  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const searchableCount = items.filter((item) => item.status === 'done').length;
  const indexingNeeded = totalCount > 0 && searchableCount < totalCount;
  const boardStats = useMemo(() => ([
    ['All saves', totalCount],
    ['On this board', items.length],
    ['Searchable', searchableCount],
    ['Needs review', items.filter((item) => item.sourceStatus === 'needs_review').length],
    ]), [items, searchableCount, totalCount]);

  useEffect(() => {
    const cards = boardRef.current?.querySelectorAll('.pin-card');
    if (!cards?.length) return undefined;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
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
            Browse visually first, then open any save for the summary, tags, transcript, source link, and notes.
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
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search recipes, outfits, trips, products..."
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-lg"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setVisibleCount(80);
                setQuery('');
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

      {indexingNeeded && (
        <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Indexing needed</div>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">
              {searchableCount} of {totalCount} saves are searchable
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Search is strongest after OCR, transcript, and summaries are created. Terms like SOC 2 only work reliably once the save has been indexed.
            </p>
          </div>
          <button
            type="button"
            onClick={onRestart}
            disabled={busy}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:scale-[1.02] disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            Start indexing
          </button>
        </div>
      )}

      <div className="sticky top-0 z-20 -mx-4 mt-5 border-y border-white/5 bg-black/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 md:-mx-10 md:px-10">
        <div className="flex flex-col gap-3 text-xs font-mono text-muted-foreground md:flex-row md:items-center md:justify-between">
          <span>{visibleItems.length} showing from {items.length} matching saves</span>
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

function PinCard({ item, index, onClick }) {
  const meta = STATUS_META[item.sourceStatus] || STATUS_META[item.status] || STATUS_META.queued;
  const Icon = meta.icon;
  const highlight = [item.collection, item.tags[0], item.topics[0], item.brands[0], item.tools[0]].filter(Boolean).slice(0, 3);
  const preview = item.sourceDescription || item.visual || item.summary || item.caption || 'Open this save to see what was captured.';
  const backdrop = PIN_BACKDROPS[index % PIN_BACKDROPS.length];
  const height = PIN_HEIGHTS[index % PIN_HEIGHTS.length];
  const cardTitle = item.sourceTitle || item.title;

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
          <div className="mb-4 flex flex-wrap gap-2">
            {highlight.map((tag) => (
              <span key={tag} className="rounded-full bg-black/15 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-black">
                {tag}
              </span>
            ))}
          </div>
          <h3 className="line-clamp-4 font-display text-3xl font-bold leading-[0.95] tracking-tight md:text-4xl">{cardTitle}</h3>
        </div>
      </div>
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="truncate font-mono text-xs text-primary">{item.sourceAuthor || item.user}</span>
          <span className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${meta.color}`}>
            <Icon className={`h-3 w-3 ${['downloading', 'analyzing'].includes(item.status) ? 'animate-spin' : ''}`} />
            {item.sourceStatus}
          </span>
        </div>
        <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{preview}</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {item.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <Hash className="h-3 w-3" /> {tag}
            </span>
          ))}
          {item.brands.slice(0, 2).map((brand) => (
            <span key={brand} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-primary">
              <Tag className="h-3 w-3" /> {brand}
            </span>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          <span>Open save</span>
          <ExternalLink className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
      </div>
    </button>
  );
}

function UploadTab({
  files,
  setFiles,
  linkForm,
  setLinkForm,
  onSaveLink,
  onImport,
  onRestart,
  pendingReviews,
  onApproveReview,
  onUpdateReview,
  onSelect,
  busy,
  onOpenHowTo,
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-20">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Add your saved posts</h1>
          <p className="mt-2 text-sm text-muted-foreground">Paste any link now, review the capture, then approve indexing when it is worth spending AI usage.</p>
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
          Use your free included allowance to build the first version of your searchable brain. Review saves before indexing so the free allowance goes toward posts you actually want.
        </p>
      </div>

      <form onSubmit={onSaveLink} className="space-y-4 rounded-2xl border border-primary/30 bg-primary/5 p-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Save from any platform</div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Add a Pinterest pin, tweet, video, post, or article</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            New web links go into review first. Nothing is indexed until you approve it.
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
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Clean up the title and notes before indexing. This keeps your brain useful and avoids wasting credits.</p>
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
              Index all reviewed
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
        <h3 className="mb-2 font-display text-xl font-bold">Drop your export files here</h3>
        <p className="mb-6 font-mono text-xs text-muted-foreground">saved_posts.html · saved_collections.html</p>
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
          <input type="file" multiple accept=".html" onChange={(event) => setFiles(Array.from(event.target.files || []))} className="hidden" />
        </label>
        {files.length > 0 && (
          <div className="mt-6 space-y-2 text-left">
            {files.map((file) => (
              <div key={file.name} className="flex items-center justify-between rounded-lg border border-white/10 bg-black px-4 py-2 text-sm">
                <span className="font-mono">{file.name}</span>
                <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <button onClick={onImport} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
          Add to library
        </button>
        <button onClick={onRestart} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-5 py-3 font-semibold text-foreground disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
          Start indexing
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
          <Sparkles className="h-4 w-4" />
          Index this
        </button>
      </div>
    </article>
  );
}

function SettingsTab({
  credentials,
  extensionTokens,
  newExtensionSecret,
  credentialForm,
  setCredentialForm,
  providerChoices,
  applyPurpose,
  applyProvider,
  onSave,
  onDelete,
  onTest,
  onCreateExtensionToken,
  onRevokeExtensionToken,
  onClearExtensionSecret,
  busy,
  authEnabled,
  onOpenHowTo,
}) {
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
            Connect your own AI keys before indexing. Until payments are live, IScraper does not spend an app-owned OpenRouter key.
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
          Your first 200 imported saves are included without paid IScraper credits. While payments are still coming soon, add your own AI keys for captions, summaries, media reading, and semantic search.
        </p>
      </div>

      <section className="space-y-4 rounded-2xl border border-white/10 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Browser Lens</div>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Connect the extension</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This creates a limited token for Lens search only. It is not your Google login token, and you can revoke it anytime.
            </p>
          </div>
          <button
            type="button"
            onClick={onCreateExtensionToken}
            disabled={busy}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Create Lens token
          </button>
        </div>

        {newExtensionSecret && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Copy once</div>
            <p className="mb-3 text-xs leading-5 text-muted-foreground">
              Paste this into the extension. For safety, it will not be shown again after you clear it.
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={newExtensionSecret}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black px-3 py-2 font-mono text-xs outline-none"
              />
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(newExtensionSecret)}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={onClearExtensionSecret}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {extensionTokens.map((token) => (
            <div key={token.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black p-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{token.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {token.revokedAt ? 'Revoked' : 'Active'} - {token.scopes.join(', ')} - last used {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : 'never'}
                </div>
              </div>
              {!token.revokedAt && (
                <button
                  type="button"
                  onClick={() => onRevokeExtensionToken(token.id)}
                  className="rounded-lg border border-white/10 p-2 text-destructive"
                  aria-label="Revoke Lens token"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <form onSubmit={onSave} className="space-y-4 rounded-2xl border border-white/10 p-5">
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/10 p-1">
          {['text', 'media', 'embedding'].map((purpose) => (
            <button
              key={purpose}
              type="button"
              onClick={() => applyPurpose(purpose)}
              className={`rounded-lg px-4 py-2 text-sm capitalize ${credentialForm.purpose === purpose ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            >
              {purpose}
            </button>
          ))}
        </div>
        <select value={credentialForm.provider} onChange={(event) => applyProvider(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary">
          {providerChoices.map(([id, provider]) => <option key={id} value={id}>{provider.label}</option>)}
        </select>
        <input
          value={credentialForm.model}
          onChange={(event) => setCredentialForm((current) => ({ ...current, model: event.target.value }))}
          placeholder="Model"
          className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 font-mono text-sm outline-none focus:border-primary"
        />
        <input
          type="password"
          value={credentialForm.apiKey}
          onChange={(event) => setCredentialForm((current) => ({ ...current, apiKey: event.target.value }))}
          placeholder="API key"
          required
          className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 font-mono text-sm outline-none focus:border-primary"
        />
        <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Save and test key
        </button>
      </form>

      <div className="space-y-3">
        {credentials.map((credential) => (
          <div key={credential.id} className="flex items-center gap-3 rounded-xl border border-white/10 p-4">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{credential.provider}</div>
              <div className="truncate text-xs text-muted-foreground">
                {credential.purpose} · {credential.model} · {credential.keyHint}
              </div>
            </div>
            <button onClick={() => onTest(credential.id)} className="rounded-lg border border-white/10 p-2 text-primary" aria-label="Test key">
              <CheckCircle2 className="h-4 w-4" />
            </button>
            <button onClick={() => onDelete(credential.id)} className="rounded-lg border border-white/10 p-2 text-destructive" aria-label="Delete key">
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
              No indexed graph yet. Start indexing saves first, then come back here.
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

function DetailDrawer({ item, onClose, onApprove, busy }) {
  const ref = useRef(null);
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
                Approve and index
              </button>
            )}
          </div>

          {item.error && <Section icon={AlertCircle} label="Error">{item.error}</Section>}
          <Section icon={ExternalLink} label="Source">{[item.platform, item.sourceId].filter(Boolean).join(' / ')}</Section>
          <Section icon={FileText} label="Source description">{item.sourceDescription}</Section>
          <Section icon={Sparkles} label="Summary">{item.summary}</Section>
        <Section icon={Brain} label="Why you saved it">{item.why}</Section>
          <Section icon={FileText} label="Caption" mono>{item.caption}</Section>
          <Section icon={Activity} label="Transcript" mono>{item.transcript}</Section>
        <Section icon={Eye} label="Words on screen" mono>{item.ocr}</Section>
        <Section icon={Eye} label="What is shown">{item.visual}</Section>
        <ChipGroup icon={Bot} label="Products / tools" items={item.tools} />
        <ChipGroup icon={Tag} label="Brands / creators" items={item.brands} />
          <ChipGroup icon={Hash} label="Topics" items={item.topics} />
          <ChipGroup icon={GitBranch} label="Links / names" items={item.repos} />
        </div>
      </div>
    </div>
  );
}

function Section({ icon: Icon, label, children, mono }) {
  if (!children) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className={`text-sm leading-relaxed ${mono ? 'font-mono text-muted-foreground' : ''}`}>{children}</div>
    </div>
  );
}

function ChipGroup({ icon: Icon, label, items }) {
  if (!items.length) return null;
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
