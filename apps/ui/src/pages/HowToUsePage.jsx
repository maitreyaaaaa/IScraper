import {
  ArrowLeft,
  ArrowRight,
  BrandLogo,
  ExternalLink,
  gsap,
  KeyRound,
  ScrollTrigger,
  Search,
  Upload,
  useEffect,
  useRef,
  useState,
} from '../AppShared.jsx';
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
export default HowToUsePage;