import {
  ArrowLeft,
  BrandLogo,
  CheckCircle2,
  Mail,
  Sparkles,
  Zap,
} from '../AppShared.jsx';

const SUPPORT_EMAIL = 'itsallover.2006@gmail.com';

function PricingPage({ onBack, onOpenApp, onOpenHelp }) {
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('IScraper pricing question')}`;

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
          <div className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">Pricing</div>
          <h1 className="font-display text-4xl font-bold leading-tight tracking-tighter sm:text-5xl md:text-7xl">
            Simple pricing for your private save library.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground md:mt-6 md:text-lg md:leading-relaxed">
            IScraper is moving to app-managed AI processing. Paid plans and credit packages will be shown here before billing is enabled.
          </p>
        </section>

        <section className="mt-10 grid gap-5 md:mt-16 md:grid-cols-3">
          {[
            [Sparkles, 'Private library', 'Import exports, save links, write notes, and keep references in one searchable workspace.'],
            [Zap, 'AI indexing', 'Summaries, OCR, tags, visual analysis, and embeddings are handled by IScraper configured services.'],
            [CheckCircle2, 'No key setup', 'You do not need to bring provider keys. Pricing will cover app-managed processing.'],
          ].map(([Icon, title, copy]) => (
            <article key={title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <Icon className="h-6 w-6 text-primary" />
              <h2 className="mt-6 font-display text-2xl font-bold tracking-tight">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy}</p>
            </article>
          ))}
        </section>

        <section className="mt-10 rounded-2xl border border-primary/30 bg-primary/5 p-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Questions</div>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight">Contact us about pricing</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            For early access, billing questions, or plan details, contact us and include what you want to import or index.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href={mailto} className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-4 text-sm font-semibold text-primary-foreground transition hover:scale-[1.03]">
              <Mail className="h-4 w-4" /> Email us
            </a>
            <button type="button" onClick={onOpenHelp} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-4 text-sm transition hover:bg-white/5">
              Contact page
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

export default PricingPage;
