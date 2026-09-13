import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  Clock3,
  Film,
  Image,
  Layers3,
  Loader2,
  Send,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { generateContentWorkflow, getWorkflowReadiness, publishContentWorkflow } from '../api';

const FORMAT_OPTIONS = [
  { key: 'reel', label: 'Reel', icon: Film },
  { key: 'carousel', label: 'Carousel', icon: Layers3 },
  { key: 'linkedin', label: 'LinkedIn', icon: BriefcaseBusiness },
];

const CADENCE_OPTIONS = ['Daily at 7 PM', 'Mon/Wed/Fri', 'Weekly sprint', 'Manual queue'];

function WorkflowsTab({ items = [], busy = false, onError, onNotice }) {
  const [brief, setBrief] = useState('Make a reference-led Instagram reel that explains why saved inspiration is useless until it becomes a repeatable content workflow.');
  const [format, setFormat] = useState('reel');
  const [cadence, setCadence] = useState(CADENCE_OPTIONS[2]);
  const [referenceIds, setReferenceIds] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [skills, setSkills] = useState([]);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [approved, setApproved] = useState(false);
  const [mediaUrl, setMediaUrl] = useState('');
  const [publishResult, setPublishResult] = useState(null);

  const referenceCandidates = useMemo(() => items
    .filter((item) => ['reel', 'post', 'image', 'video', 'note'].includes(String(item.contentType || '').toLowerCase()) || item.platformKey === 'instagram')
    .slice(0, 12), [items]);
  const defaultReferenceIds = useMemo(() => referenceCandidates.slice(0, 2).map((item) => item.id), [referenceCandidates]);
  const selectedReferenceIds = referenceIds ?? defaultReferenceIds;

  useEffect(() => {
    let cancelled = false;
    getWorkflowReadiness()
      .then((body) => {
        if (cancelled) return;
        setReadiness(body.readiness || null);
        setSkills(body.skills || []);
      })
      .catch((error) => onError?.(error.message));
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const platformSelection = format === 'linkedin' ? ['linkedin'] : ['instagram'];
  const canGenerate = brief.trim().length > 8 && !loading && !busy;

  async function handleGenerate() {
    if (!canGenerate) return;
    setLoading(true);
    setApproved(false);
    setPublishResult(null);
    try {
      const body = await generateContentWorkflow({
        brief,
        format,
        cadence,
        platforms: platformSelection,
        referenceIds: selectedReferenceIds,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Calcutta',
      });
      setPlan(body.plan);
      setReadiness(body.readiness || readiness);
      onNotice?.(body.plan?.aiMode === 'openrouter' ? 'Workflow generated with OpenRouter.' : 'Workflow generated with fallback planner.');
    } catch (error) {
      onError?.(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePublish() {
    if (!plan) return;
    setPublishing(true);
    setPublishResult(null);
    try {
      const body = await publishContentWorkflow({
        approved,
        platform: platformSelection[0],
        format,
        caption: plan.caption,
        mediaUrl,
      });
      setPublishResult(body.result);
      onNotice?.(body.result?.message || 'Publish request prepared.');
    } catch (error) {
      setPublishResult({ status: 'blocked', message: error.message });
      onError?.(error.message);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <section className="mx-auto max-w-7xl px-5 py-6 md:px-10 md:py-8">
      <div className="grid gap-5 xl:grid-cols-[minmax(360px,0.88fr)_minmax(0,1.12fr)]">
        <div className="space-y-5">
          <div className="rounded-lg border border-white/10 bg-zinc-950 p-5 shadow-2xl shadow-black/30">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Workflows</p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground md:text-4xl">Content command center</h1>
              </div>
              <div className="grid h-12 w-12 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                <Bot className="h-6 w-6" />
              </div>
            </div>
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              className="mt-5 min-h-36 w-full resize-none rounded-lg border border-white/10 bg-black p-4 text-sm leading-6 text-foreground outline-none transition focus:border-primary"
              placeholder="Tell the agent what campaign, audience, product, or story to build."
            />
            <div className="mt-4 grid grid-cols-3 gap-2">
              {FORMAT_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setFormat(option.key)}
                    className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition ${
                      format === option.key ? 'border-primary bg-primary text-primary-foreground' : 'border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="truncate">{option.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {CADENCE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCadence(option)}
                  className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 text-left text-sm transition ${
                    cadence === option ? 'border-sky-300/70 bg-sky-300/10 text-sky-100' : 'border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <CalendarClock className="h-4 w-4 shrink-0" />
                  <span className="truncate">{option}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 font-bold text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
              Generate workflow
            </button>
          </div>

          <div className="rounded-lg border border-white/10 bg-zinc-950 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Reference memory</h2>
              <span className="text-xs text-muted-foreground">{selectedReferenceIds.length}/4 selected</span>
            </div>
            <div className="grid gap-2">
              {referenceCandidates.length ? referenceCandidates.map((item) => {
                const selected = selectedReferenceIds.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setReferenceIds((current) => (
                      selected ? (current ?? defaultReferenceIds).filter((id) => id !== item.id) : [...(current ?? defaultReferenceIds), item.id].slice(0, 4)
                    ))}
                    className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border p-3 text-left transition ${
                      selected ? 'border-primary/60 bg-primary/10' : 'border-white/10 bg-black hover:border-white/20'
                    }`}
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/5 text-muted-foreground">
                      {String(item.contentType || '').toLowerCase().includes('reel') ? <Film className="h-4 w-4" /> : <Image className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{item.title || item.sourceTitle || item.caption || 'Saved reference'}</span>
                      <span className="block truncate text-xs text-muted-foreground">{item.platform || 'Saved'} · {item.contentType || 'post'}</span>
                    </span>
                    {selected && <Check className="h-4 w-4 text-primary" />}
                  </button>
                );
              }) : (
                <div className="rounded-lg border border-dashed border-white/15 p-5 text-sm text-muted-foreground">
                  Add saved reels or images to use live references here.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <ReadinessStrip readiness={readiness} />
          <SkillDeck skills={plan?.skills?.length ? plan.skills : skills} />
          <PlanPreview plan={plan} />
          <PublishPanel
            plan={plan}
            approved={approved}
            setApproved={setApproved}
            mediaUrl={mediaUrl}
            setMediaUrl={setMediaUrl}
            publishing={publishing}
            publishResult={publishResult}
            onPublish={handlePublish}
          />
        </div>
      </div>
    </section>
  );
}

function ReadinessStrip({ readiness }) {
  const cards = [
    readiness?.models?.text,
    readiness?.models?.media,
    readiness?.integrations?.composio,
    readiness?.integrations?.instagram,
    readiness?.integrations?.linkedin,
  ].filter(Boolean);
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg border border-white/10 bg-zinc-950 p-3">
          <div className={`mb-2 flex h-8 w-8 items-center justify-center rounded-lg ${card.configured ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-200'}`}>
            {card.configured ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
          </div>
          <div className="truncate text-xs font-semibold">{card.label}</div>
          <div className="mt-1 truncate text-[11px] text-muted-foreground">{card.model || (card.configured ? 'Ready' : 'Needs setup')}</div>
        </div>
      ))}
    </div>
  );
}

function SkillDeck({ skills = [] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Agent skills</h2>
        <Sparkles className="h-4 w-4 text-primary" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {skills.slice(0, 6).map((skill) => (
          <div key={skill.key || skill.label} className="rounded-lg border border-white/10 bg-black p-3">
            <div className="text-sm font-semibold">{skill.label || skill.key}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">{skill.role || skill.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanPreview({ plan }) {
  if (!plan) {
    return (
      <div className="grid min-h-80 place-items-center rounded-lg border border-dashed border-white/15 bg-zinc-950 p-8 text-center">
        <div>
          <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 text-2xl font-bold">No workflow yet</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Generate one from the prompt and selected references.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{plan.aiMode || 'workflow'}</p>
          <h2 className="mt-1 text-2xl font-bold">{plan.name}</h2>
        </div>
        <span className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">{plan.status}</span>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {(plan.stages || []).map((stage, index) => (
          <div key={stage.key || stage.label || index} className="rounded-lg border border-white/10 bg-black p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">{stage.label}</div>
              <span className="text-[11px] text-muted-foreground">{stage.state}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{stage.detail}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]">
        <div className="rounded-lg border border-white/10 bg-black p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><WandSparkles className="h-4 w-4 text-primary" /> Media prompt</div>
          <p className="text-sm leading-6 text-muted-foreground">{plan.assetPrompt || plan.publishPackage?.mediaPrompt}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-black p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Send className="h-4 w-4 text-sky-300" /> Caption</div>
          <p className="text-sm leading-6 text-muted-foreground">{plan.caption}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(plan.hashtags || []).slice(0, 8).map((tag) => (
              <span key={tag} className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-muted-foreground">{tag}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PublishPanel({ plan, approved, setApproved, mediaUrl, setMediaUrl, publishing, publishResult, onPublish }) {
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Approval and dispatch</h2>
          <p className="text-sm text-muted-foreground">Draft first. Publish only when approved.</p>
        </div>
        <ShieldCheck className="h-5 w-5 text-primary" />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <input
          value={mediaUrl}
          onChange={(event) => setMediaUrl(event.target.value)}
          className="min-h-11 rounded-lg border border-white/10 bg-black px-3 text-sm outline-none transition focus:border-primary"
          placeholder="Generated media URL or Instagram creation ID"
        />
        <button
          type="button"
          onClick={() => setApproved((current) => !current)}
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold transition ${
            approved ? 'border-emerald-300/50 bg-emerald-400/10 text-emerald-200' : 'border-white/10 bg-white/[0.03] text-muted-foreground'
          }`}
        >
          <Check className="h-4 w-4" />
          Approved
        </button>
      </div>
      <button
        type="button"
        onClick={onPublish}
        disabled={!plan || publishing}
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-white px-4 font-bold text-black transition hover:bg-primary disabled:opacity-50"
      >
        {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}
        Queue publish check
      </button>
      {publishResult && (
        <div className="mt-4 rounded-lg border border-white/10 bg-black p-4 text-sm">
          <div className="font-semibold">{publishResult.status || 'status'}</div>
          <p className="mt-1 text-muted-foreground">{publishResult.message}</p>
          {publishResult.missing?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {publishResult.missing.map((item) => (
                <span key={item} className="rounded-md bg-amber-300/10 px-2 py-1 text-xs text-amber-100">{item}</span>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default WorkflowsTab;
