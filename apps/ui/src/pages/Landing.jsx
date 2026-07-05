import {
  ArrowRight,
  avatarUrlForSession,
  Bot,
  Brain,
  BrandLogo,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Folder,
  getProfile,
  getPublicFeedback,
  gsap,
  Hash,
  identifyPostHogUser,
  Images,
  initialForSession,
  Loader2,
  Lock,
  Mic,
  recordSessionSignInActivity,
  resetPageScroll,
  resetPostHogUser,
  RotateCcw,
  RotatingOutcomeText,
  RotatingPlatformLogo,
  SAVE_SOURCE_LABELS,
  scrollToSection,
  ScrollTrigger,
  Search,
  setApiAccessToken,
  ShieldCheck,
  Sparkles,
  submitPublicFeedback,
  supabase,
  Tag,
  Upload,
  useEffect,
  useRef,
  useState,
  Zap,
} from '../AppShared.jsx';
import { AnimatedFeatureSelect } from '../components/Common.jsx';
import { AccountSettingsModal } from '../dashboard/AccountSettingsModal.jsx';
const LIBRARY_STARTED_KEY = 'iscraper.libraryStarted';
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
  const [libraryStarted, setLibraryStarted] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const landingAvatarUrl = avatarUrlForSession(landingSession, landingProfile);
  const landingInitial = initialForSession(landingSession, landingProfile);
  const libraryCtaLabel = landingSession || libraryStarted ? 'My library' : 'Start my library';
  const handleLibraryCta = landingSession ? onOpenApp : onOpenLogin;

  useEffect(() => {
    resetPageScroll();
  }, []);

  useEffect(() => {
    setLibraryStarted(window.localStorage.getItem(LIBRARY_STARTED_KEY) === 'true');
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
      recordSessionSignInActivity(session);
      window.localStorage.setItem(LIBRARY_STARTED_KEY, 'true');
      setLibraryStarted(true);
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

      <header className="pointer-events-none absolute left-0 right-0 top-4 z-50">
        <div className="mx-auto grid w-full max-w-[100rem] grid-cols-[auto_1fr_auto] items-center gap-4 px-6 md:px-10 md:pr-20 xl:px-14 xl:pr-24">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="nav-item pointer-events-auto flex items-center"
          >
            <BrandLogo className="h-20 w-64 md:h-[7.5rem] md:w-[24rem]" />
          </button>
          <nav className="pointer-events-auto absolute left-1/2 hidden -translate-x-1/2 rounded-full border border-white/10 bg-black/75 p-1 text-sm font-semibold text-muted-foreground shadow-[0_18px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl md:flex">
            <a href="#features" onClick={(event) => scrollToSection(event, '#features')} className="nav-item rounded-full px-4 py-2 transition hover:bg-white/10 hover:text-foreground">Features</a>
            <a href="#how-it-works" onClick={(event) => scrollToSection(event, '#how-it-works')} className="nav-item rounded-full px-4 py-2 transition hover:bg-white/10 hover:text-foreground">How it works</a>
            <a href="#extension" onClick={(event) => scrollToSection(event, '#extension')} className="nav-item rounded-full px-4 py-2 transition hover:bg-white/10 hover:text-foreground">Extension</a>
            <button type="button" onClick={onOpenHowTo} className="nav-item rounded-full px-4 py-2 transition hover:bg-white/10 hover:text-foreground">How to Use</button>
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
            ) : null}
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
          style={{ background: 'radial-gradient(circle, var(--glow) 0%, transparent 70%)' }}
        />

        <div className="hero-content relative mx-auto w-full max-w-[100rem] overflow-visible px-6 md:px-10 md:pr-20 xl:px-14 xl:pr-24">
          <h1
            ref={heroTitle}
            className="overflow-visible text-balance font-display text-[clamp(3rem,12vw,11rem)] font-bold leading-[0.95] tracking-tighter md:text-[clamp(3rem,10.5vw,11rem)]"
          >
            {heroWords.map((word) => (
              <span key={word} className="mr-[0.18em] inline-block overflow-visible last:mr-0">
                <span className={`word inline-block ${word === 'Lose' ? 'relative isolate' : ''} ${word === 'Post' ? 'rounded-[5px] bg-accent pl-[0.08em] pr-[0.22em] italic text-accent-foreground' : ''}`}>
                  {word === 'Lose' && (
                    <img
                      src="/hero/lose-circle.png"
                      alt=""
                      className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[1.2em] max-w-none -translate-x-1/2 -translate-y-[50%] rotate-[-5deg] opacity-95"
                      draggable="false"
                    />
                  )}
                  <span className={word === 'Lose' ? 'relative z-10' : ''}>{word}</span>
                </span>
                {word === 'on' && <RotatingPlatformLogo />}
              </span>
            ))}
          </h1>

          <div className="mt-12 flex flex-col items-start justify-between gap-8 md:flex-row md:items-start">
            <p className="hero-fade max-w-[21rem] text-lg leading-relaxed text-muted-foreground sm:max-w-xl">
              Save posts, links, screenshots, notes, products, and references in one private library. Find them later by what they are about, not just where you saved them.
            </p>
            <div className="hero-fade flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
              <button
                type="button"
                onClick={handleLibraryCta}
                className="glow-ring group inline-flex items-center justify-center gap-3 rounded-full bg-primary px-7 py-4 text-base font-semibold text-primary-foreground transition hover:scale-[1.03]"
              >
                {libraryCtaLabel} <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
              </button>
              <button type="button" onClick={(event) => scrollToSection(event, '#how-it-works')} className="inline-flex items-center justify-center gap-2 rounded-full border border-accent/45 px-6 py-4 text-sm font-semibold text-accent transition hover:bg-accent/10">
                See how it works
              </button>
              <button type="button" onClick={onOpenHowTo} className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 px-6 py-4 text-sm transition hover:bg-white/5">
                <FileText className="h-4 w-4" /> How to use
              </button>
            </div>
          </div>

          <div className="hero-fade mx-auto mt-24 grid w-full max-w-7xl grid-cols-2 gap-x-4 gap-y-8 text-sm md:grid-cols-4 md:gap-6">
            {[
              ['Saved posts', 'Posts'],
              ['Useful links', 'Links'],
              ['Screen grabs', 'Screenshots'],
              ['Personal notes', 'Notes'],
            ].map(([label, value]) => (
              <div key={label} className="border-l border-white/10 pl-4">
                <div className="font-display text-2xl font-bold tabular-nums sm:text-4xl">{value}</div>
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
              {SAVE_SOURCE_LABELS.map((label) => (
                <span key={`${index}-${label}`} className="text-foreground/20 transition hover:text-primary">
                  {label} <span className="text-primary">✦</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section id="what-you-can-save" className="relative border-b border-white/5 bg-black px-6 py-20 md:py-24">
        <div className="mx-auto max-w-7xl">
          <div data-reveal className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">/ 01 - What you can save</div>
              <h2 className="max-w-3xl font-display text-5xl font-bold tracking-tighter md:text-7xl">
                All the internet stuff your brain refuses to remember.
              </h2>
            </div>
            <p className="max-w-md text-pretty text-muted-foreground">
              Your saves are not gone. They are just buried in too many apps, folders, chats, and screenshots. <RotatingPlatformLogo />
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [ExternalLink, 'Pinterest', 'Moodboards, recipes, outfits, interiors, products, and travel plans.'],
              [Zap, 'YouTube', 'Videos worth saving without turning your browser into a junk drawer.'],
              [Hash, 'X', 'Threads and posts that should not disappear into the feed.'],
              [Images, 'Instagram', 'Reels, posts, and collections you planned to revisit.'],
              [FileText, 'Documents and web', 'Research, shopping links, articles, docs, and sites you want again later.'],
              [Mic, 'Voice notes and notes', 'Quick thoughts, screenshots, and useful context that usually gets lost.'],
            ].map(([Icon, title, description]) => (
              <article key={title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <Icon className="h-5 w-5 text-primary" />
                <h3 className="mt-5 font-display text-2xl font-semibold tracking-tight">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="feature-section relative overflow-hidden bg-black px-6 py-24 md:py-32">
        <div className="pointer-events-none absolute left-1/2 top-10 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />
        <div className="mx-auto max-w-7xl">
          <div data-reveal className="mb-16 flex flex-wrap items-end justify-between gap-8">
            <div>
              <div className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">/ 02 - Why it helps</div>
              <h2 className="max-w-3xl font-display text-5xl font-bold tracking-tighter md:text-7xl">
                Your saves finally <span className="italic text-primary">work for you</span>.
              </h2>
            </div>
            <p className="max-w-md text-pretty text-muted-foreground">No messy folders. No social password handover. No "where did I save that?" panic.</p>
          </div>

          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {[
              [Zap, 'Save from everywhere', 'Paste links, upload exports, add screenshots, or write quick notes in one private place.'],
              [Search, 'Find old saves fast', 'Search by idea, topic, person, brand, product, or the reason you saved it.'],
              [Brain, 'Remember why you saved it', 'Get plain-English context so old posts stop looking like mystery bookmarks.'],
              [Tag, 'Keep messy saves organized', 'Group travel, food, fitness, shopping, work, research, and inspiration without doing the boring cleanup yourself.'],
              [Bot, 'Ask questions about your saves', 'Ask what you saved about a topic and get an answer based on your own library.'],
              [Images, 'Find similar ideas', 'Use a save or screenshot to uncover more things with the same vibe.'],
              [Clock, 'Set reminders for useful saves', 'Bring a save back when it is actually time to use it. Future you gets a small favor.'],
              [ShieldCheck, 'Check your library', 'Spot links and saves that need attention before your collection turns into digital attic dust.'],
              [Lock, 'Private by default', 'Your library belongs to your account, and you choose what becomes searchable.'],
            ].map(([Icon, title, description]) => (
              <div
                key={title}
                className="step-card group relative min-h-56 overflow-hidden rounded-2xl border border-white/10 bg-black/80 p-7 transition-all hover:-translate-y-1 hover:border-primary/60"
              >
                <div
                  className="absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-0 blur-3xl transition-opacity group-hover:opacity-100"
                  style={{ background: 'var(--glow)' }}
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

      <section id="how-it-works" className="relative border-y border-white/10 bg-black px-6 py-24 md:py-32">
        <div className="mx-auto max-w-7xl">
          <div data-reveal className="mb-14 max-w-4xl">
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">/ 03 - How it works</div>
            <h2 className="font-display text-5xl font-bold tracking-tighter md:text-7xl">
              Save it once. Find it when it matters.
            </h2>
            <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
              IScraper turns scattered saves into a private library you can search without becoming your own unpaid filing clerk.
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {[
              [Upload, 'Add your saves', 'Bring in posts, links, screenshots, notes, and exports from the places you already use.'],
              [CheckCircle2, 'Review what matters', 'Keep the useful stuff, clean up titles or notes, and skip what is not worth saving.'],
              [Sparkles, 'IScraper organizes it', 'Your saves get easier to search by topic, person, brand, product, and reason.'],
              [Search, 'Search when you need it', 'Come back days or months later and find the thing without scrolling yourself into a bad mood.'],
            ].map(([Icon, title, description], index) => (
              <article key={title} data-reveal className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <div className="flex items-center justify-between gap-4">
                  <Icon className="h-6 w-6 text-primary" />
                  <span className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">0{index + 1}</span>
                </div>
                <h3 className="mt-8 font-display text-2xl font-semibold tracking-tight">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="extension" className="relative border-y border-white/10 bg-black px-6 py-24 md:py-32">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div data-reveal>
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">/ 04 - Browser extension</div>
            <h2 className="max-w-4xl font-display text-5xl font-bold tracking-tighter md:text-7xl">
              Save the page you are on without opening another tab.
            </h2>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              The browser extension will let you save the current page or capture a screenshot from your browser. It is coming after browser-store approval.
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
              Until then, you can still upload exports, paste links, and add notes from the web app.
            </p>
          </div>

          <div data-reveal className="grid gap-4 sm:grid-cols-2">
            {[
              [Search, 'Save the current page', 'Send the page you are viewing into your private library.'],
              [Eye, 'Capture a screenshot', 'Save a crop of the screen when the useful bit is visual.'],
              [RotateCcw, 'Undo quickly', 'If you save the wrong thing, undo it right away.'],
              [ShieldCheck, 'Built with permission', 'It runs when you click it, not as a hidden background scraper.'],
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
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">/ 05 - What gets easier to find</div>
            <h2 className="max-w-4xl font-display text-5xl font-bold tracking-tighter md:text-7xl">
              For the posts you swore you would come back to.
            </h2>
            <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
              IScraper helps each save carry enough context that you can actually use it later.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 md:grid-cols-3 lg:grid-cols-4">
            {[
              [Sparkles, 'What it is'], [FileText, 'Quick summary'], [FileText, 'What was said'], [Eye, 'Words on screen'],
              [Eye, 'What is shown'], [Tag, 'Creator or brand'], [Bot, 'Product or idea'], [ExternalLink, 'Links or names'],
              [Hash, 'Theme'], [Folder, 'Collection'], [Brain, 'Reason you saved'], [ShieldCheck, 'Original post'],
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
            <div className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">/ 06 - Build with us</div>
            <h2 className="font-display text-5xl font-bold tracking-tighter md:text-7xl">What should we add next?</h2>
            <p className="mt-6 max-w-xl leading-relaxed text-muted-foreground">
              Tell us what would make your saved library more useful. Ideas are shown publicly, but names and profile photos are hidden.
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
          <p data-reveal className="mx-auto mt-8 max-w-xl text-lg text-muted-foreground">Paste one link or upload an export, then turn posts, products, research, screenshots, and ideas into a library you can come back to.</p>
          <div data-reveal className="mt-12 flex flex-wrap items-center justify-center gap-4">
            <button
              type="button"
              onClick={handleLibraryCta}
              className="glow-ring group inline-flex items-center gap-3 rounded-full bg-primary px-9 py-5 text-lg font-semibold text-primary-foreground transition hover:scale-[1.03]"
            >
              {libraryCtaLabel} <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
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
          <div className="flex flex-col items-start gap-4 md:items-end">
            <a
              href="https://www.producthunt.com/products/iscraper/launches/iscraper?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-iscraper"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="IScraper on Product Hunt"
              className="transition hover:opacity-90"
            >
              <img
                alt="IScraper - Turn saved posts into searchable knowledge. | Product Hunt"
                width="203"
                height="44"
                src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1149202&theme=light&t=1783261481088"
                className="h-11 w-auto max-w-full"
              />
            </a>
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
        </div>
      </footer>

    </div>
  );
}
export default Landing;
