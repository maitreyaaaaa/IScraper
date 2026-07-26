import {
  ArrowLeft,
  ArrowRight,
  BrandLogo,
  CheckCircle2,
  Mail,
  Sparkles,
} from '../AppShared.jsx';

function PricingPage({ onBack, onOpenHelp }) {
  return (
    <div className="min-h-screen bg-black text-foreground">
      <div className="grid-bg radial-fade pointer-events-none fixed inset-0 opacity-35" />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/85 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <button type="button" onClick={onBack} className="flex min-w-0 items-center gap-3 transition hover:opacity-80">
            <ArrowLeft className="h-5 w-5 shrink-0 text-muted-foreground" />
            <BrandLogo className="h-12 w-40 shrink-0" />
          </button>
          <button type="button" onClick={onOpenHelp} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-white/5">
            <Mail className="h-4 w-4" />
            Contact us
          </button>
        </div>
      </header>

      <main className="relative mx-auto flex min-h-[calc(100vh-6rem)] max-w-6xl flex-col items-center justify-center px-5 py-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.24em] text-primary">
          <Sparkles className="h-4 w-4" />
          Currently
        </div>
        <h1 className="mt-8 font-display text-[clamp(5rem,18vw,14rem)] font-black uppercase leading-[0.78] tracking-tight text-white">
          Free
        </h1>
        <p className="mt-8 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg md:leading-relaxed">
          IScraper is free while we run pilot onboarding, validate real saved-library usage, and measure AI processing costs before public paid plans go live.
        </p>

        <div className="mt-10 flex flex-col items-center gap-4">
          <button type="button" onClick={onOpenHelp} className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-7 py-4 text-sm font-bold text-primary-foreground transition hover:scale-[1.03]">
            Apply for a pilot and founder meeting
            <ArrowRight className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Opens the Contact us page
          </div>
        </div>
      </main>
    </div>
  );
}

export default PricingPage;
