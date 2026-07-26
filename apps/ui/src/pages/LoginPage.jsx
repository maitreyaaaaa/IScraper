import {
  ArrowLeft,
  ArrowRight,
  Brain,
  BrandLogo,
  CheckCircle2,
  cleanAuthCallbackUrl,
  getProfile,
  identifyPostHogUser,
  Loader2,
  Lock,
  Mail,
  recordSessionSignInActivity,
  resetPostHogUser,
  saveProfile,
  sendEmailOtp,
  setApiAccessToken,
  startGoogleSignIn,
  supabase,
  useCallback,
  useEffect,
  useState,
  verifyEmailOtp,
} from '../AppShared.jsx';
import { Banner } from '../components/Common.jsx';
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
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    setApiAccessToken(data.session?.access_token);
    if (!data.session) {
      resetPostHogUser();
      return { session: null, profile: null, profileRequired: false };
    }
    recordSessionSignInActivity(data.session);
    const profileBody = await getProfile();
    applyProfileState(profileBody.profile, profileBody.required);
    identifyPostHogUser(data.session, profileBody.profile);
    cleanAuthCallbackUrl();
    return {
      session: data.session,
      profile: profileBody.profile || null,
      profileRequired: Boolean(profileBody.required),
    };
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
      setNotice('Code sent. Check your email.');
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
      const profileState = await loadProfile();
      setNotice(profileState?.profileRequired ? 'Email verified.' : 'Signed in.');
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

      <main className="relative z-10 mx-auto flex min-h-[calc(100vh-5rem)] max-w-7xl items-center justify-center px-5 py-14">
        <section className="glow-ring w-full max-w-xl rounded-[2rem] border border-white/10 bg-black p-6 shadow-2xl shadow-black/50 md:p-8">
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
                    <label className="block font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Email code</label>
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
                  {emailCodeSent ? 'Continue' : 'Send code'}
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
              <h2 className="font-display text-3xl font-bold tracking-tight">Choose username</h2>
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
                Continue
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

export default LoginPage;
