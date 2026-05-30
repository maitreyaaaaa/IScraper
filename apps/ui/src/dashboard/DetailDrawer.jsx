import {
  Activity,
  AlertCircle,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  getSimilarVisuals,
  gsap,
  Hash,
  INDEXING_META,
  isExtensionCaptureItem,
  isNoteItem,
  Loader2,
  LoadingSpinner,
  mapItem,
  RotateCcw,
  SkeletonCardGrid,
  Sparkles,
  useEffect,
  useMemo,
  useRef,
  useState,
  X,
} from '../AppShared.jsx';
const DETAIL_VERIFY_PATTERN = /\b(price|pricing|offer|deal|discount|sale|available|availability|launch|deadline|apply|application|terms|funding|equity|investment|grant|salary|rate|cost|coupon|waitlist|beta|limited|expires|202[0-9]|203[0-9])\b|[$]\s?\d/i;

function cleanDetailText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function detailCompareKey(value) {
  return cleanDetailText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isWeakDetailText(value) {
  const key = detailCompareKey(value);
  return !key
    || key === 'no summary yet'
    || key === 'untitled saved item'
    || key === 'useful saved instagram reference'
    || key === 'useful saved reference'
    || (key.startsWith('useful for') && key.length < 24);
}

function isRepeatedDetailText(value, previousValues = []) {
  const key = detailCompareKey(value);
  if (!key) return true;
  return previousValues.some((previous) => {
    const previousKey = detailCompareKey(previous);
    if (!previousKey) return false;
    return key === previousKey
      || (key.length > 90 && previousKey.includes(key))
      || (previousKey.length > 90 && key.includes(previousKey));
  });
}

function shortenDetailText(value, maxLength = 420) {
  const text = cleanDetailText(value);
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const boundary = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('; '), slice.lastIndexOf(', '), slice.lastIndexOf(' '));
  return `${slice.slice(0, boundary > 180 ? boundary : maxLength).trim()}...`;
}

function pickDistinctDetailText(candidates, previousValues = [], maxLength = 420) {
  const candidate = candidates.find((value) => !isWeakDetailText(value) && !isRepeatedDetailText(value, previousValues));
  return candidate ? shortenDetailText(candidate, maxLength) : '';
}

function humanList(values) {
  const items = values.filter(Boolean);
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

function inferDetailUse(item) {
  const topics = dedupeDetailItems([...(item.topics || []), ...(item.tags || [])]).slice(0, 3);
  const mentions = dedupeDetailItems([...(item.tools || []), ...(item.brands || []), ...(item.repos || [])]).slice(0, 3);
  if (!topics.length && !mentions.length) return '';
  const topicText = topics.length ? `researching ${humanList(topics)}` : '';
  const mentionText = mentions.length ? `tracking ${humanList(mentions)}` : '';
  return `Useful for ${[topicText, mentionText].filter(Boolean).join(' and ')}.`;
}

function dedupeDetailItems(values = [], excludeValues = []) {
  const seen = new Set(excludeValues.map(detailCompareKey));
  const items = [];
  for (const value of values) {
    const item = cleanDetailText(value);
    const key = detailCompareKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

function needsDetailVerification(item) {
  const text = [
    item.title,
    item.sourceTitle,
    item.sourceDescription,
    item.caption,
    item.summary,
    item.why,
    item.visual,
    item.ocr,
  ].filter(Boolean).join(' ');
  return DETAIL_VERIFY_PATTERN.test(text);
}

function buildOriginalDetailRows(item, insightRows = []) {
  const rows = [];
  const seen = insightRows.map((row) => row.text);
  const addRow = (label, value, icon, mono = false) => {
    const text = cleanDetailText(value);
    if (!text || isRepeatedDetailText(text, seen)) return;
    seen.push(text);
    rows.push({ label, text, icon, mono });
  };

  if (isNoteItem(item) && !isExtensionCaptureItem(item)) {
    addRow('Note', item.caption, FileText, true);
    return rows;
  }

  addRow('Source', [item.platform, item.sourceId].filter(Boolean).join(' / '), ExternalLink);
  addRow('Source description', item.sourceDescription, FileText);
  addRow('Caption', item.caption, FileText, true);
  addRow('Transcript', item.transcript, Activity, true);
  addRow('Words on screen', item.ocr, Eye, true);
  addRow('Visual notes', item.visual, Eye);
  return rows;
}

function buildDetailInsight(item) {
  const title = item.sourceTitle || item.title || '';
  const seen = [title];
  const what = pickDistinctDetailText([item.summary, item.visual, item.sourceDescription, item.caption], seen);
  if (what) seen.push(what);

  const why = pickDistinctDetailText([item.why, inferDetailUse(item)], seen, 360);
  if (why) seen.push(why);

  const visual = pickDistinctDetailText([item.visual, item.ocr], [...seen, item.sourceDescription, item.caption], 360);
  if (visual) seen.push(visual);

  const rows = [
    what ? { label: 'What this is', text: what, icon: Sparkles } : null,
    why ? { label: 'Why it matters', text: why, icon: Brain } : null,
    visual ? { label: 'What is shown', text: visual, icon: Eye } : null,
  ].filter(Boolean);

  const mentions = dedupeDetailItems([
    ...(item.tools || []),
    ...(item.brands || []),
    ...(item.people || []),
    ...(item.repos || []),
  ]).slice(0, 24);
  const topics = dedupeDetailItems([...(item.topics || []), ...(item.tags || [])], mentions).slice(0, 18);

  return {
    rows,
    mentions,
    topics,
    originalRows: buildOriginalDetailRows(item, rows),
    verify: needsDetailVerification(item),
  };
}

function DetailDrawer({ item, onClose, onApprove, onArchiveRetry, onRemind, onOpenItem, busy }) {
  const ref = useRef(null);
  const [assetPreview, setAssetPreview] = useState(null);
  const [similarVisuals, setSimilarVisuals] = useState({ itemId: item.id, status: 'loading', items: [], error: '' });
  const indexingMeta = INDEXING_META[item.indexingStage] || INDEXING_META.metadata_ready;
  const IndexingIcon = indexingMeta.icon;
  const capture = isExtensionCaptureItem(item);
  const note = isNoteItem(item) && !capture;
  const imageAssets = (item.assets || []).filter((asset) => asset.assetType === 'image' && asset.url);
  const detailStatusLabel = item.sourceStatus === 'needs_review'
    ? 'Needs check'
    : item.indexingStage === 'visual_indexing'
      ? 'Updating'
      : item.indexingStage === 'index_failed' || item.status === 'failed'
        ? 'Issue'
        : '';
  const insight = useMemo(() => buildDetailInsight(item), [item]);
  useEffect(() => {
    gsap.fromTo(ref.current, { x: '100%' }, { x: 0, duration: 0.5, ease: 'power3.out' });
  }, []);
  useEffect(() => {
    let active = true;
    getSimilarVisuals(item.id, { limit: 6 })
      .then((body) => {
        if (!active) return;
        setSimilarVisuals({
          itemId: item.id,
          status: 'ready',
          items: (body.results || []).map((entry) => ({
            ...mapItem(entry.item),
            similarity: entry.similarity,
          })),
          error: '',
        });
      })
      .catch((err) => {
        if (!active) return;
        setSimilarVisuals({ itemId: item.id, status: 'error', items: [], error: err.message });
      });
    return () => {
      active = false;
    };
  }, [item.id]);
  const visibleSimilarVisuals = similarVisuals.itemId === item.id
    ? similarVisuals
    : { itemId: item.id, status: 'loading', items: [], error: '' };
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
            <div className="mb-2 flex flex-wrap gap-2 font-mono text-xs text-primary">
              <span>{capture ? 'Screen Capture' : note ? 'My Note' : item.platform}</span>
              {item.sourceAuthor ? <span className="text-muted-foreground">/ {item.sourceAuthor}</span> : null}
              {!note && detailStatusLabel && (
                <span className={`inline-flex items-center gap-1 ${indexingMeta.color}`}>
                  <IndexingIcon className={`h-3 w-3 ${item.indexingStage === 'visual_indexing' ? 'animate-spin' : ''}`} />
                  {detailStatusLabel}
                </span>
              )}
            </div>
            {item.thumbnailUrl ? (
              <button
                type="button"
                onClick={() => setAssetPreview({ url: item.thumbnailUrl, label: item.sourceTitle || item.title || 'Screen capture' })}
                className="mb-5 block w-full overflow-hidden rounded-2xl border border-white/10"
              >
                <img src={item.thumbnailUrl} alt="" className="max-h-64 w-full object-cover transition hover:scale-[1.01]" />
              </button>
            ) : null}
            <h2 className="mb-3 font-display text-3xl font-bold tracking-tight">{item.sourceTitle || item.title}</h2>
            {!note && (
              <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary">
                Open original save <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {!note && <ArchivePanel item={item} busy={busy} onRetry={onArchiveRetry} />}
            <ReminderPanel item={item} busy={busy} onRemind={onRemind} />
            {item.sourceStatus === 'needs_review' && (
              <button
                type="button"
                onClick={() => onApprove(item)}
                disabled={busy}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Add to Library
              </button>
            )}
          </div>

          {item.error && <Section icon={AlertCircle} label="Error">{item.error}</Section>}
          {note && <Section icon={FileText} label="Note" mono>{item.caption}</Section>}
          {(note || (capture && !item.thumbnailUrl)) && imageAssets.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {imageAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => setAssetPreview({ url: asset.url, label: item.sourceTitle || item.title || 'Saved image' })}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025] text-left transition hover:border-primary"
                >
                  <img src={asset.url} alt="" className="max-h-64 w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
          {item.indexingError && <Section icon={AlertCircle} label="Update note">{item.indexingError}</Section>}
          {!note && item.indexingStage === 'visual_indexing' && <Section icon={Loader2} label="Updating">We are adding more details for this save now.</Section>}
          {capture && (
            <Section icon={Brain} label="AI image analysis">
              {item.hasAnalysis ? (item.summary || item.visual || item.ocr) : 'Image analysis will appear here when processing finishes.'}
            </Section>
          )}
          {!note && <InsightPanel insight={insight} />}
          {insight.verify && (
            <Section icon={AlertCircle} label="Check before using">
              This save may mention dates, prices, funding, availability, or terms that can change. Verify the original source before acting on it.
            </Section>
          )}
          <SimilarVisualsPanel state={visibleSimilarVisuals} onOpenItem={onOpenItem} />
          <ChipGroup icon={Bot} label="Mentioned" items={insight.mentions} />
          <ChipGroup icon={Hash} label="Topics" items={insight.topics} />
          {!note && <OriginalDetails rows={insight.originalRows} />}
        </div>
      </div>
      {assetPreview && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/85 p-6 backdrop-blur-sm" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="absolute right-5 top-5 rounded-lg border border-white/10 bg-black/70 p-3 text-white hover:bg-white/10" onClick={() => setAssetPreview(null)} aria-label="Close image preview">
            <X className="h-5 w-5" />
          </button>
          <img src={assetPreview.url} alt={assetPreview.label} className="max-h-[88vh] max-w-[92vw] rounded-2xl border border-white/10 object-contain shadow-2xl shadow-black" />
        </div>
      )}
    </div>
  );
}

function ArchivePanel({ item, busy, onRetry }) {
  const archive = item.archive;
  const status = archive?.status || 'none';
  const blocked = ['blocked_host', 'blocked_port', 'unsupported_content_type', 'no_readable_content', 'unsupported_protocol'].includes(archive?.errorCode);
  const ready = status === 'ready';
  const pending = status === 'pending';
  const failed = status === 'failed' || status === 'skipped';
  const label = ready
    ? 'Readable copy saved'
    : pending
      ? 'Saving readable copy...'
      : failed && blocked
        ? 'This site blocked page backup'
        : failed
          ? 'Could not save copy'
          : 'No saved copy yet';
  const help = ready
    ? 'Article text and readable page content are saved in case the original link breaks later.'
    : pending
      ? 'The link is saved now. Page backup runs in the background.'
      : 'Page backup saves article text and readable page content when the site allows it.';

  return (
    <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {ready ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : pending ? <LoadingSpinner className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
            Page backup
          </div>
          <div className="text-sm font-semibold text-foreground">{label}</div>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">{help}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs text-muted-foreground hover:border-primary hover:text-primary">
              Open original <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {!pending && !ready && (
            <button
              type="button"
              onClick={() => onRetry?.(item)}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
            >
              {busy ? <LoadingSpinner className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
              Try again
            </button>
          )}
        </div>
      </div>
      {ready && (
        <details className="mt-5 rounded-xl border border-white/10 bg-black/30 p-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-foreground">
            <span>{archive.title || item.sourceTitle || item.title}</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </summary>
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {archive.siteName ? <span>{archive.siteName}</span> : null}
              {archive.capturedAt ? <span>Saved {new Date(archive.capturedAt).toLocaleDateString()}</span> : null}
              {archive.textLength ? <span>{archive.textLength.toLocaleString()} characters</span> : null}
            </div>
            {archive.excerpt ? <p className="text-sm leading-relaxed text-foreground">{archive.excerpt}</p> : null}
            {archive.contentText ? (
              <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/40 p-4 text-sm leading-relaxed text-muted-foreground">
                {archive.contentText}
              </div>
            ) : null}
          </div>
        </details>
      )}
      {failed && archive?.errorMessage ? (
        <p className="mt-3 text-xs text-muted-foreground">{archive.errorMessage}</p>
      ) : null}
    </div>
  );
}

function ReminderPanel({ item, busy, onRemind }) {
  if (!item?.id) return null;
  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> Reminder
          </div>
          <div className="text-sm font-semibold text-foreground">Bring this back later</div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Useful for links, references, and ideas you want to revisit.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            ['tomorrow', 'Tomorrow'],
            ['week', 'Next week'],
            ['month', 'Next month'],
          ].map(([preset, label]) => (
            <button
              key={preset}
              type="button"
              onClick={() => onRemind?.(item, preset)}
              disabled={busy}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-foreground transition hover:border-primary disabled:opacity-60"
            >
              {busy ? <LoadingSpinner className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SimilarVisualsPanel({ state, onOpenItem }) {
  const loading = state.status === 'loading';
  const items = state.items || [];
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          <Eye className="h-3 w-3" /> Similar visuals
        </div>
        {loading && <LoadingSpinner />}
      </div>
      {state.status === 'error' && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error || 'Could not load similar saves.'}
        </div>
      )}
      {loading && (
        <SkeletonCardGrid count={2} layout="grid-2" />
      )}
      {!loading && state.status !== 'error' && !items.length && (
        <div className="rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3 text-sm text-muted-foreground">
          No similar visual saves yet.
        </div>
      )}
      {items.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((similar) => {
            const reason = similar.similarity?.reasons?.[0] || similar.card?.preview || '';
            const score = Math.min(99, Math.max(1, Math.round(Number(similar.similarity?.score || 0) * 100)));
            return (
              <button
                key={similar.id}
                type="button"
                onClick={() => onOpenItem(similar)}
                className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.025] text-left transition hover:border-primary"
              >
                {similar.thumbnailUrl ? (
                  <img src={similar.thumbnailUrl} alt="" className="h-28 w-full object-cover transition group-hover:scale-[1.02]" loading="lazy" />
                ) : (
                  <div className="grid h-28 place-items-center bg-white/[0.03] text-muted-foreground">
                    <Eye className="h-5 w-5" />
                  </div>
                )}
                <div className="space-y-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-sm font-semibold text-foreground">{similar.sourceTitle || similar.title}</div>
                    <span className="shrink-0 rounded-full border border-primary/30 px-2 py-0.5 font-mono text-[10px] text-primary">{score}%</span>
                  </div>
                  <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{reason}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function InsightPanel({ insight }) {
  if (!insight.rows.length) return null;
  return (
    <div className="space-y-5 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
      {insight.rows.map(({ label, text, icon: Icon }) => (
        <div key={label}>
          <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            <Icon className="h-3 w-3" /> {label}
          </div>
          <div className="text-sm leading-relaxed text-foreground">{text}</div>
        </div>
      ))}
    </div>
  );
}

function OriginalDetails({ rows }) {
  if (!rows.length) return null;
  return (
    <details className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-mono text-xs uppercase tracking-widest text-muted-foreground">
        <span className="inline-flex items-center gap-2"><FileText className="h-3 w-3" /> Original source text</span>
        <ChevronDown className="h-4 w-4" />
      </summary>
      <div className="mt-5 space-y-6">
        {rows.map(({ label, text, icon, mono }) => (
          <Section key={label} icon={icon} label={label} mono={mono}>{text}</Section>
        ))}
      </div>
    </details>
  );
}

function Section({ icon: Icon, label, children, mono }) {
  if (!children) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className={`break-words text-sm leading-relaxed ${mono ? 'whitespace-pre-wrap font-mono text-xs text-muted-foreground' : ''}`}>{children}</div>
    </div>
  );
}

function ChipGroup({ icon: Icon, label, items }) {
  if (!items?.length) return null;
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
export { DetailDrawer };