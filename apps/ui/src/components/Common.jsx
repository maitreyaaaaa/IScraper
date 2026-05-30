import {
  AlertCircle,
  Brain,
  Check,
  ChevronDown,
  FEEDBACK_FEATURE_OPTIONS,
  Loader2,
  Lock,
  ONBOARDING_CONTENT_OPTIONS,
  ONBOARDING_REFERRAL_OPTIONS,
  Sparkles,
  useEffect,
  useRef,
  useState,
} from '../AppShared.jsx';
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
          <span className="h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_16px_rgba(165,255,24,0.45)]" />
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
                selected ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-primary/10 hover:text-primary'
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

function OnboardingPreferencesFields({ form, setForm }) {
  const selectedTypes = new Set(form.contentTypes || []);
  const toggleContentType = (value) => {
    setForm((current) => {
      const next = new Set(current.contentTypes || []);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...current, contentTypes: Array.from(next) };
    });
  };

  return (
    <>
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">What will you save?</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {ONBOARDING_CONTENT_OPTIONS.map(([value, label]) => {
            const selected = selectedTypes.has(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() => toggleContentType(value)}
                className={[
                  'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition',
                  selected ? 'border-primary bg-primary text-primary-foreground' : 'border-white/10 text-muted-foreground hover:border-primary/70 hover:text-foreground',
                ].join(' ')}
              >
                {selected && <Check className="h-3.5 w-3.5" />}
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <label className="block font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">How did you hear about us?</label>
      <select
        value={form.referralSource || ''}
        onChange={(event) => setForm((current) => ({ ...current, referralSource: event.target.value }))}
        className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-sm outline-none focus:border-primary"
      >
        <option value="">Choose one</option>
        {ONBOARDING_REFERRAL_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </>
  );
}

function OnboardingPreferencesPanel({ form, setForm, onSave, onSkip, busy }) {
  return (
    <div className="glow-ring rounded-2xl border border-white/10 bg-black p-6">
      <Sparkles className="h-8 w-8 text-primary" />
      <h2 className="mt-5 font-display text-3xl font-bold tracking-tight">Personalize IScraper</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Choose what you plan to save. This only sets better defaults; you can still save anything later.</p>
      <div className="mt-6 space-y-5">
        <OnboardingPreferencesFields form={form} setForm={setForm} />
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={onSave} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Continue
        </button>
        <button type="button" onClick={onSkip} disabled={busy} className="rounded-xl border border-white/10 px-4 py-3 font-semibold text-muted-foreground transition hover:bg-white/5 hover:text-foreground disabled:opacity-60">Skip for now</button>
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
export { AnimatedFeatureSelect, AuthRequiredPanel, Banner, OnboardingPreferencesFields, OnboardingPreferencesPanel, ProfileRequiredPanel };
