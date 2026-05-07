import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  Database,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  GitBranch,
  Hash,
  KeyRound,
  Loader2,
  Lock,
  Pause,
  PlayCircle,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import {
  deleteProviderCredential,
  getCredits,
  getItem,
  getItems,
  getPublicFeedback,
  getProviderCredentials,
  importInstagramExport,
  restartQueue,
  saveProviderCredential,
  searchItems,
  setApiAccessToken,
  submitPublicFeedback,
  testProviderCredential,
} from './api';
import { supabase } from './supabaseClient';

gsap.registerPlugin(ScrollTrigger);

const STATUS_META = {
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

const STATUSES = ['all', 'done', 'analyzing', 'queued', 'downloading', 'failed', 'paused'];

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

function BrandLogo({ className = 'h-8 w-28' }) {
  return <img src="/logo.png" alt="IScraper" className={`${className} object-contain object-left`} />;
}

function scrollToSection(event, id) {
  event.preventDefault();
  document.querySelector(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.history.replaceState(null, '', id);
}

export default function App() {
  const [route, setRoute] = useState(() => (window.location.hash === '#app' ? 'app' : 'landing'));

  const navigate = useCallback((nextRoute) => {
    setRoute(nextRoute);
    window.location.hash = nextRoute === 'app' ? 'app' : '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash === '#app' ? 'app' : 'landing');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route === 'app' ? <Dashboard onBack={() => navigate('landing')} /> : <Landing onOpenApp={() => navigate('app')} />;
}

function Landing({ onOpenApp }) {
  const root = useRef(null);
  const introRef = useRef(null);
  const cursorRef = useRef(null);
  const heroTitle = useRef(null);
  const [feedback, setFeedback] = useState([]);
  const [feedbackForm, setFeedbackForm] = useState({ feature: 'Search', message: '' });
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState('');

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

  const heroWords = ['Never', 'Lose', 'A', 'Saved', 'Post.'];

  return (
    <div ref={root} className="relative bg-black text-foreground overflow-x-hidden">
      <div ref={introRef} className="fixed inset-0 z-[200] grid place-items-center bg-black">
        <BrandLogo className="intro-logo h-24 w-80 opacity-0 md:h-32 md:w-[28rem]" />
      </div>

      <div
        ref={cursorRef}
        className="pointer-events-none fixed left-0 top-0 z-[100] hidden h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary mix-blend-difference md:block"
      />

      <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/5 bg-black/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <button type="button" className="nav-item flex items-center">
            <BrandLogo className="h-12 w-44" />
          </button>
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#features" onClick={(event) => scrollToSection(event, '#features')} className="nav-item transition hover:text-foreground">Features</a>
            <a href="#why" onClick={(event) => scrollToSection(event, '#why')} className="nav-item transition hover:text-foreground">Why</a>
            <a href="#feedback" onClick={(event) => scrollToSection(event, '#feedback')} className="nav-item transition hover:text-foreground">Feedback</a>
          </nav>
          <button
            type="button"
            onClick={onOpenApp}
            className="nav-item group inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:scale-[1.03]"
          >
            Open library <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </button>
        </div>
      </header>

      <section className="landing-hero relative flex min-h-screen items-center overflow-hidden bg-black pt-24">
        <div className="parallax-grid radial-fade grid-bg absolute inset-0 opacity-60" />
        <div
          className="parallax-glow-primary absolute -left-20 -top-32 h-[480px] w-[480px] rounded-full opacity-40 blur-[120px]"
          style={{ background: 'radial-gradient(circle, var(--glow) 0%, transparent 70%)' }}
        />
        <div
          className="parallax-glow-secondary absolute right-0 top-40 h-[520px] w-[520px] rounded-full opacity-30 blur-[140px]"
          style={{ background: 'radial-gradient(circle, var(--glow-2) 0%, transparent 70%)' }}
        />

        <div className="hero-content relative mx-auto w-full max-w-7xl px-6">
          <h1
            ref={heroTitle}
            className="text-balance font-display text-[clamp(3rem,11vw,12rem)] font-bold leading-[0.85] tracking-tighter"
          >
            {heroWords.map((word, index) => (
              <span key={word} className="mr-[0.18em] inline-block overflow-hidden">
                <span className={`word inline-block ${index === 4 ? 'text-glow italic text-primary' : ''}`}>{word}</span>
              </span>
            ))}
          </h1>

          <div className="mt-12 flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
            <p className="hero-fade max-w-xl text-lg leading-relaxed text-muted-foreground">
              Recipes, outfits, workouts, trips, products, creators, ideas. Turn the posts you already saved into a private library you can actually search.
            </p>
            <div className="hero-fade flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={onOpenApp}
                className="glow-ring group inline-flex items-center gap-3 rounded-full bg-primary px-7 py-4 text-base font-semibold text-primary-foreground transition hover:scale-[1.03]"
              >
                Open my library <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
              </button>
              <a href="#features" className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-4 text-sm transition hover:bg-white/5">
                <PlayCircle className="h-4 w-4" /> See how it works
              </a>
            </div>
          </div>

          <div className="hero-fade mt-24 grid grid-cols-2 gap-6 text-sm md:grid-cols-4">
            {[
              ['Saved ideas rescued', 'All'],
              ['Upload needed', 'Once'],
              ['Private by default', 'Yes'],
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
              {['recipes', 'outfits', 'travel', 'workouts', 'products', 'creators', 'ideas', 'places', 'captions', 'text'].map((label) => (
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
              [Zap, 'Find it before the moment passes', 'Search by what you remember: the dish, the outfit, the place, the creator, or the words on screen.'],
              [Brain, 'Know why you saved it', 'Each save can get a plain-English summary, so old posts become useful again instead of forgotten.'],
              [Tag, 'Organized without the cleanup', 'Group saves by themes like travel, food, fitness, shopping, home, business, or inspiration.'],
              [Lock, 'Private by default', 'Your saved export starts on your machine, so your personal taste and plans stay yours.'],
              [ShieldCheck, 'Built around official export', 'Use Instagram export files to build your library without handing over your Instagram login.'],
              [KeyRound, 'Upgrade when you want deeper notes', 'Connect your own AI keys only if you want richer summaries, visible-text reading, and media analysis.'],
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

      <section id="why" className="index-section relative overflow-hidden bg-black px-6 py-24 md:py-32">
        <div className="index-pin mx-auto max-w-7xl">
          <div className="index-heading mb-16">
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">/ 02 - What becomes searchable</div>
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
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">/ 03 - Build with us</div>
            <h2 className="font-display text-5xl font-bold tracking-tighter md:text-7xl">What should we add next?</h2>
            <p className="mt-6 max-w-xl leading-relaxed text-muted-foreground">
              Tell us what would make your saved-post library more useful. Ideas are shown publicly, but names and profile photos are hidden.
            </p>

            <form onSubmit={handleFeedbackSubmit} className="feedback-card mt-10 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <label className="block font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Feature area</label>
              <select
                value={feedbackForm.feature}
                onChange={(event) => setFeedbackForm((current) => ({ ...current, feature: event.target.value }))}
                className="mt-3 w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm outline-none focus:border-primary"
              >
                {['Search', 'Dashboard', 'Collections', 'AI summaries', 'Exporting', 'Mobile experience', 'Privacy', 'Other'].map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>

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
          <p data-reveal className="mx-auto mt-8 max-w-xl text-lg text-muted-foreground">One upload turns your saved folder from a pile of posts into a library you can come back to.</p>
          <div data-reveal className="mt-12 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={onOpenApp}
              className="glow-ring group inline-flex items-center gap-3 rounded-full bg-primary px-9 py-5 text-lg font-semibold text-primary-foreground transition hover:scale-[1.03]"
            >
              Build my library <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Dashboard({ onBack }) {
  const [tab, setTab] = useState('library');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [collectionFilter, setCollectionFilter] = useState('all');
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [files, setFiles] = useState([]);
  const [credentials, setCredentials] = useState([]);
  const [credentialOptions, setCredentialOptions] = useState(null);
  const [credits, setCredits] = useState(null);
  const [credentialForm, setCredentialForm] = useState({
    purpose: 'text',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-pro',
    apiKey: '',
  });
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sidebarRef = useRef(null);
  const authEnabled = Boolean(supabase);

  const loadItems = useCallback(async () => {
    const body = await getItems();
    setItems((body.items || []).map(mapItem));
  }, []);

  const loadControls = useCallback(async () => {
    const [credentialBody, creditBody] = await Promise.all([getProviderCredentials(), getCredits()]);
    setCredentials(credentialBody.credentials || []);
    setCredentialOptions(credentialBody.options || null);
    setCredits(creditBody.credits || null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
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

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (collectionFilter !== 'all' && item.collection !== collectionFilter) return false;
      return true;
    });
  }, [collectionFilter, items, statusFilter]);

  const stats = useMemo(() => ({
    total: items.length,
    done: items.filter((item) => item.status === 'done').length,
    queued: items.filter((item) => item.status === 'queued').length,
    paused: items.filter((item) => item.status === 'paused' || item.status === 'failed').length,
  }), [items]);

  const handleSignIn = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { error: signInError } = await supabase.auth.signInWithOtp({ email });
      if (signInError) throw signInError;
      setNotice('Check your email for the sign-in link.');
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
      setNotice(`Imported ${result.itemCount} items. Restart the queue to analyze them.`);
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

  const providerChoices = useMemo(() => {
    if (!credentialOptions) return [];
    return Object.entries(credentialForm.purpose === 'media' ? credentialOptions.mediaProviders || {} : credentialOptions.textProviders || {});
  }, [credentialForm.purpose, credentialOptions]);

  const applyPurpose = (purpose) => {
    const model = purpose === 'media'
      ? credentialOptions?.defaultAppMediaModel || 'google/gemini-3.1-flash-lite-preview'
      : credentialOptions?.defaultAppTextModel || 'deepseek/deepseek-v4-pro';
    setCredentialForm({ purpose, provider: 'openrouter', model, apiKey: '' });
  };

  const applyProvider = (provider) => {
    const group = credentialForm.purpose === 'media' ? credentialOptions?.mediaProviders : credentialOptions?.textProviders;
    setCredentialForm((current) => ({ ...current, provider, model: group?.[provider]?.defaultModel || current.model }));
  };

  if (authEnabled && !session) {
    return (
      <div className="grid min-h-screen place-items-center bg-black px-6 text-foreground">
        <form onSubmit={handleSignIn} className="glow-ring w-full max-w-md rounded-2xl border border-white/10 bg-black p-8">
          <BrandLogo className="mb-8 h-16 w-56" />
          <h1 className="font-display text-4xl font-bold tracking-tight">Open your library</h1>
          <p className="mt-2 text-sm text-muted-foreground">Keep your saved posts private, searchable, and easy to revisit.</p>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="mt-6 w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
            required
          />
          <button className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Send my private link
          </button>
          {error && <Banner type="error">{error}</Banner>}
          {notice && <Banner>{notice}</Banner>}
        </form>
      </div>
    );
  }

  const navItems = [
    ['library', 'Saved library', Brain],
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
        </nav>
        <div className="border-t border-white/5 p-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {stats.total} saves · {stats.done} searchable
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="dash-panel min-h-screen overflow-auto">
          <div className="dash-panel-inner">
            <MobileTopbar onBack={onBack} tab={tab} setTab={setTab} />
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
                    onSelect={openDetail}
                  />
                )}
                {tab === 'upload' && (
                  <UploadTab
                    files={files}
                    setFiles={setFiles}
                    onImport={handleImport}
                    onRestart={handleRestart}
                    busy={busy}
                  />
                )}
                {tab === 'settings' && (
                  <SettingsTab
                    credits={credits}
                    credentials={credentials}
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
                    busy={busy}
                    authEnabled={authEnabled}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {selected && <DetailDrawer item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function MobileTopbar({ onBack, tab, setTab }) {
  return (
    <div className="sticky top-0 z-30 border-b border-white/10 bg-black/90 p-3 backdrop-blur md:hidden">
      <div className="mb-3 flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" />
          <BrandLogo className="h-10 w-36" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          ['library', 'Library'],
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
  onSelect,
}) {
  const boardRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(80);
  const activeFilters = (statusFilter !== 'all' ? 1 : 0) + (collectionFilter !== 'all' ? 1 : 0);
  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const boardStats = useMemo(() => ([
    ['All saves', totalCount],
    ['On this board', items.length],
    ['Searchable', items.filter((item) => item.status === 'done').length],
    ['Needs attention', items.filter((item) => item.status === 'failed' || item.status === 'paused').length],
    ]), [items, totalCount]);

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
  }, [collectionFilter, items, statusFilter, visibleCount]);

  return (
    <div className="mx-auto max-w-[1480px] px-4 py-8 sm:px-6 md:px-10 md:py-12">
      <div className="mb-7 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Saved board</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-6xl">Your Instagram saves, laid out like ideas.</h1>
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

      <div className="sticky top-0 z-20 -mx-4 mt-5 border-y border-white/5 bg-black/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 md:-mx-10 md:px-10">
        <div className="flex flex-col gap-3 text-xs font-mono text-muted-foreground md:flex-row md:items-center md:justify-between">
          <span>{visibleItems.length} showing from {items.length} matching saves</span>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 rounded-full border border-white/10 bg-black px-3 py-2">
              <Filter className="h-3.5 w-3.5" />
              <select
                value={statusFilter}
                onChange={(event) => {
                  setVisibleCount(80);
                  setStatusFilter(event.target.value);
                }}
                className="bg-black outline-none"
              >
                {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </label>
            <select
              value={collectionFilter}
              onChange={(event) => {
                setVisibleCount(80);
                setCollectionFilter(event.target.value);
              }}
              className="rounded-full border border-white/10 bg-black px-3 py-2 outline-none"
            >
              {collections.map((collection) => <option key={collection} value={collection}>{collection}</option>)}
            </select>
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
  '#ff84dd',
  '#29ffc6',
  '#ffb347',
  '#bea8ff',
];

const PIN_HEIGHTS = ['min-h-72', 'min-h-96', 'min-h-80', 'min-h-[28rem]', 'min-h-64', 'min-h-[24rem]'];

function PinCard({ item, index, onClick }) {
  const meta = STATUS_META[item.sourceStatus] || STATUS_META[item.status] || STATUS_META.queued;
  const Icon = meta.icon;
  const highlight = [item.collection, item.tags[0], item.topics[0], item.brands[0], item.tools[0]].filter(Boolean).slice(0, 3);
  const preview = item.visual || item.summary || item.caption || 'Open this save to see what was captured.';
  const backdrop = PIN_BACKDROPS[index % PIN_BACKDROPS.length];
  const height = PIN_HEIGHTS[index % PIN_HEIGHTS.length];

  return (
    <button
      type="button"
      onClick={onClick}
      className="pin-card group mb-5 block w-full break-inside-avoid overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.035] text-left shadow-2xl shadow-black/30 transition duration-300 hover:-translate-y-1 hover:border-primary/60 hover:bg-white/[0.055]"
    >
      <div className={`relative flex ${height} flex-col justify-between overflow-hidden p-5 text-black`} style={{ background: backdrop }}>
        <div className="absolute inset-0 opacity-25 grid-bg" />
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/45 blur-2xl" />
        <div className="relative flex items-center justify-between gap-3">
          <span className="rounded-full bg-black/75 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-white">{item.collection}</span>
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
          <h3 className="line-clamp-4 font-display text-3xl font-bold leading-[0.95] tracking-tight md:text-4xl">{item.title}</h3>
        </div>
      </div>
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="font-mono text-xs text-primary">{item.user}</span>
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

function UploadTab({ files, setFiles, onImport, onRestart, busy }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-20">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-tight">Add your saved posts</h1>
        <p className="mt-2 text-sm text-muted-foreground">Upload your Instagram export once. The app turns it into a searchable library.</p>
      </div>

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

function SettingsTab({
  credits,
  credentials,
  credentialForm,
  setCredentialForm,
  providerChoices,
  applyPurpose,
  applyProvider,
  onSave,
  onDelete,
  onTest,
  busy,
  authEnabled,
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-20">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-tight">Keys & privacy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Connect optional AI keys when you want richer summaries and deeper media notes.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Credit label="Free analyses left" value={credits ? `${credits.freeItemsRemaining}/${credits.freeItemsLimit}` : '200/200'} />
        <Credit label="Paid credits" value={credits?.paidCredits ?? 0} />
      </div>

      <form onSubmit={onSave} className="space-y-4 rounded-2xl border border-white/10 p-5">
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 p-1">
          {['text', 'media'].map((purpose) => (
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

function Credit({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 p-4">
      <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-2 font-display text-3xl font-bold">{value}</div>
    </div>
  );
}

function DetailDrawer({ item, onClose }) {
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
            <div className="mb-2 font-mono text-xs text-primary">{item.user}</div>
            <h2 className="mb-3 font-display text-3xl font-bold tracking-tight">{item.title}</h2>
            <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary">
              Open original post <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {item.error && <Section icon={AlertCircle} label="Error">{item.error}</Section>}
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
