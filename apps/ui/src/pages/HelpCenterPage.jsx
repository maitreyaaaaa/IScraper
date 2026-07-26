import {
  ArrowLeft,
  BrandLogo,
  FileText,
  LifeBuoy,
  Mail,
  Search,
  ShieldCheck,
  Upload,
  useState,
} from '../AppShared.jsx';
import { AnimatedFeatureSelect } from '../components/Common.jsx';
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
    [ShieldCheck, 'AI processing', 'IScraper handles AI indexing through the app. Settings only cover account, privacy, and library tools.'],
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
              Your email <span className="text-destructive">*</span>
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
export default HelpCenterPage;
