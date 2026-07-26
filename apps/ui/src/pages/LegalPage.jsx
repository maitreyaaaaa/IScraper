import {
  AI_PROCESSING_NOTICE,
  ArrowLeft,
  BrandLogo,
} from '../AppShared.jsx';
const SUPPORT_EMAIL = 'itsallover.2006@gmail.com';
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
      ['AI processing', 'When indexing is enabled, content may be sent to IScraper-configured AI services to create summaries, OCR, transcripts, tags, and search data. AI output can be wrong, incomplete, or outdated, so you should verify important information yourself.'],
      ['Browser extension coming soon', 'The IScraper browser extension is not available for users yet. When released, it will be optional and must be used only on pages and content you are allowed to process.'],
      ['Things you cannot do', 'Do not upload content you do not have rights to use, attack the service, bypass rate limits, scrape or copy other users data, reverse engineer protected parts of the service, or use IScraper for unlawful activity.'],
      ['Credits and paid features', 'AI enrichment may require paid IScraper credits or plan limits. Credit purchases are currently marked as coming soon. If payments are enabled later, pricing, refunds, and billing terms will be shown before purchase.'],
      ['Service changes', 'We may change, pause, or discontinue features. We will try to avoid disrupting your saved library, but we do not guarantee uninterrupted access.'],
      ['Disclaimer', 'IScraper is provided as-is without warranties. To the maximum extent allowed by law, we are not responsible for indirect damages, lost data, lost profits, or decisions made from AI-generated output.'],
      ['Contact', `For support or legal questions, contact us at ${SUPPORT_EMAIL}.`],
    ],
  },
  privacy: {
    eyebrow: 'Privacy Policy',
    title: 'Privacy Policy',
    intro: 'This policy explains what IScraper collects, why it exists, how it is used, and how you can export, correct, or delete account data. It matches the current product: Supabase login, saved/imported content, AI indexing, extension/MCP/Telegram access, billing credits, support-safe logs, and account deletion.',
    sections: [
      ['Data categories', 'We collect account/auth data, profile settings, saved links and notes, import records, uploaded export metadata, generated summaries, transcripts, OCR, tags, embeddings, search and feedback records, extension/MCP/Telegram connection metadata, billing and credit records, support-safe timeline events, request IDs, correlation IDs, security/audit logs, and deletion/export request records.'],
      ['Sources', 'Data comes from you, Supabase Auth, files or links you upload, browser extension or connected access flows you choose to use, AI/indexing results generated for your library, billing/credit actions, product logs, support/admin actions, and security events.'],
      ['Purposes', 'We use data to authenticate your account, keep tenants separate, import and save content, index and search your library, process AI features, operate connected access, handle credits, provide exports/deletion, troubleshoot failed imports/jobs, investigate abuse, secure the service, and meet legal or audit requirements.'],
      ['Account and auth data', 'Supabase Auth is the sign-in source of truth. We store app account records such as user ID, email, public support reference, profile state, username, timestamps, and account/deletion state. IScraper does not ask for Gmail, Drive, Calendar, contacts, or unrelated Google account content.'],
      ['Saved and imported content', 'Your saved library can include URLs, captions, notes, collections, source metadata, uploaded file metadata, screenshots/images you intentionally save, readable page copies, and generated analysis. This content is private to your account unless you explicitly share or export it.'],
      ['AI processing', `${AI_PROCESSING_NOTICE} External AI providers may receive content only for the selected processing purpose.`],
      ['Tokens and connections', 'Extension tokens, MCP/agent tokens, and Telegram connection codes are stored as encrypted values or hashes where appropriate. Raw secrets are not included in exports, logs, frontend state, support views, or admin screens, and revocation is supported.'],
      ['Billing and credits', 'We store credit balances, credit transactions, purchases, checkout status where available, and admin credit adjustments. These records are used for billing, support, fraud prevention, and accounting.'],
      ['Support and admin access', 'Support/admin views are designed to show status, counts, failed jobs, request references, credit state, tokens count, deletion/export state, and support-safe events. Admins should not casually browse private saved content unless there is a specific, logged support or security reason.'],
      ['Logs and reference IDs', 'API requests and background jobs use request IDs and correlation IDs so support can trace issues like failed imports without reading private content. Logs and audit events must not contain raw URLs, captions, OCR, transcripts, prompts, provider responses, file paths, auth headers, tokens, API keys, or encrypted secret values.'],
      ['Cookies and local storage', 'IScraper uses browser storage and Supabase session storage to keep you signed in, preserve app state, remember preferences, and support uploads. Clearing browser storage may sign you out or reset preferences.'],
      ['Analytics and third parties', 'IScraper may use Supabase, IScraper-configured AI providers for processing, storage providers, payment providers when billing is enabled, email/support tools, and privacy-conscious analytics. IScraper does not sell personal information or share it for cross-context behavioral advertising.'],
      ['Your rights', `Where legally applicable, including under California privacy law, you may request access, correction, deletion, and information about data practices. Use self-serve export and deletion in Settings where available, or contact ${SUPPORT_EMAIL} for correction, access questions, or rights requests.`],
      ['Retention', 'Saved user content stays until you delete it or your account is deleted. Export artifacts expire after the configured retention window, currently 7 days. Request logs are kept short-term for security and reliability, support-safe events are kept long enough to troubleshoot account issues, billing/audit/deletion hashes may be retained longer where required for security, legal, tax, fraud prevention, or accountability.'],
      ['Deletion', 'Account deletion removes user content, revokes tokens, disables access, and retains only minimal legal/audit records where required. Deletion-pending accounts can still view privacy information, check/export data, and cancel deletion where allowed.'],
      ['Security', 'We use Supabase Auth, row-level security, user ownership checks, privileged server access kept outside browser code, encryption or hashing for secrets, scoped/revokable tokens, upload limits, rate limits, CORS restrictions, security headers, audit logs, and redaction. No system is perfectly secure, so avoid uploading data you cannot risk processing.'],
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
      ['Data separation', 'Production data is stored in Supabase with user ownership checks and row-level security policies. Privileged database access stays on backend routes and is never exposed in browser code.'],
      ['AI service keys', 'AI service keys are configured on the backend and are never exposed in browser code.'],
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
      ['What we delete', 'We can delete your account profile, saved items, imports, generated summaries, OCR/transcripts, graph data, future extension tokens, and credit records tied to your account where deletion is legally and technically allowed.'],
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
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Last updated May 27, 2026</span>
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
export default LegalPage;
