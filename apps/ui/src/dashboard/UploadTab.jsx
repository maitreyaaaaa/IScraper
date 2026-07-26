import {
  AI_PROCESSING_NOTICE,
  Check,
  CheckCircle2,
  Database,
  ExternalLink,
  fileImportName,
  FileText,
  importHealthForFiles,
  Loader2,
  LoadingSpinner,
  MAX_NOTE_IMAGES,
  noteImageError,
  ProgressBar,
  Search,
  Upload,
  useEffect,
  useMemo,
  useRef,
  useState,
  X,
} from '../AppShared.jsx';
import { ImportHealthPanel, IndexingProgressCard } from './LibraryTab.jsx';
function UploadTab({
  files,
  setFiles,
  importSourceType,
  setImportSourceType,
  initialAddMode = 'link',
  linkForm,
  setLinkForm,
  noteForm,
  setNoteForm,
  onSaveLink,
  onCreateNote,
  onImport,
  importProgress,
  pendingReviews,
  onApproveReview,
  onUpdateReview,
  onSelect,
  busy,
  onOpenHowTo,
  indexingActivity,
  activationState,
  onTrySearch,
}) {
  const [dragging, setDragging] = useState(false);
  const [activeAddMode, setActiveAddMode] = useState(() => (['link', 'note', 'upload'].includes(initialAddMode) ? initialAddMode : 'link'));
  const linkInputRef = useRef(null);
  const reviewSectionRef = useRef(null);
  const noteImageInputRef = useRef(null);
  const importInputRef = useRef(null);
  const importHealth = useMemo(() => importHealthForFiles(files, importSourceType), [files, importSourceType]);
  const addModeOptions = [
    { value: 'link', label: 'Paste link', icon: ExternalLink },
    { value: 'note', label: 'Write note', icon: FileText },
    { value: 'upload', label: 'Upload files', icon: Upload },
  ];
  const sourceOptions = [
    { value: 'auto', label: 'Choose for me', help: 'Best if you are not sure.' },
    { value: 'instagram', label: 'Instagram', help: 'For files downloaded from Instagram.' },
    { value: 'pinterest', label: 'Pinterest', help: 'For files downloaded from Pinterest.' },
    { value: 'x', label: 'X', help: 'For bookmark CSV, JSON, JS, TXT, or ZIP files.' },
  ];

  useEffect(() => {
    if (pendingReviews.length > 0) {
      reviewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [pendingReviews.length]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-20">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Add to your library</h1>
          <p className="mt-2 text-sm text-muted-foreground">Save a note, paste a link, or upload files from Instagram, Pinterest, or X.</p>
          <details className="mt-3 max-w-3xl rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-semibold text-foreground">Processing note</summary>
            <p className="mt-2 leading-5">{AI_PROCESSING_NOTICE}</p>
          </details>
        </div>
        <button
          type="button"
          onClick={onOpenHowTo}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-white/5"
        >
          <FileText className="h-4 w-4" /> How to Use
        </button>
      </div>

      <div className="grid gap-2 rounded-2xl border border-white/10 bg-white/[0.025] p-2 md:grid-cols-3">
        {addModeOptions.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setActiveAddMode(value)}
            className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${
              activeAddMode === value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
      {activeAddMode === 'upload' && (
      <>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          setFiles(Array.from(event.dataTransfer.files));
        }}
        className={`rounded-2xl border-2 border-dashed p-12 text-center transition md:p-16 ${dragging ? 'border-primary bg-primary/5' : 'border-white/15'}`}
      >
        <Upload className="mx-auto mb-5 h-10 w-10 text-primary" />
        <h3 className="mb-2 font-display text-xl font-bold">Drop your files here</h3>
        <p className="mb-6 font-mono text-xs text-muted-foreground">Instagram ZIP/HTML/JSON · Pinterest ZIP/JSON/CSV · X bookmark ZIP/JS/JSON/CSV/TXT</p>
        <button
          type="button"
          onClick={onOpenHowTo}
          className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <FileText className="h-3.5 w-3.5" /> Guide
        </button>
        <br />
        <button
          type="button"
          onClick={() => importInputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:scale-[1.02]"
        >
          <Upload className="h-4 w-4" /> Import your data
        </button>
        <input
          ref={importInputRef}
          type="file"
          multiple
          accept=".html,.htm,.zip,.json,.csv,.js,.txt"
          onChange={(event) => {
            setFiles(Array.from(event.target.files || []));
            event.target.value = '';
          }}
          className="hidden"
        />
        {files.length > 0 && (
          <div className="mt-6 space-y-2 text-left">
            {files.map((file) => (
              <div key={`${fileImportName(file)}-${file.size}`} className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-black px-4 py-2 text-sm">
                <span className="min-w-0 truncate font-mono">{fileImportName(file) || file.name}</span>
                <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <div className="mb-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">File source</div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Where did these files come from?</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {sourceOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setImportSourceType(option.value)}
              className={`rounded-xl border px-4 py-3 text-left transition ${
                importSourceType === option.value
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-white/10 bg-black text-muted-foreground hover:border-white/25 hover:text-foreground'
              }`}
            >
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className="mt-1 block text-xs leading-5">{option.help}</span>
            </button>
          ))}
        </div>
      </section>

      <div>
        <button onClick={onImport} disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? <LoadingSpinner /> : <Database className="h-4 w-4" />}
          {importProgress ? importProgress.label : 'Add files to Library'}
        </button>
        {importProgress && (
          <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-4">
            <ProgressBar value={importProgress.value} label={importProgress.label} detail={importProgress.detail} />
          </div>
        )}
        {activationState.searchable > 0 && (
          <button
            type="button"
            onClick={() => onTrySearch(activationState.searchQuery)}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-white/5"
          >
            <Search className="h-4 w-4" />
            Go to Library
          </button>
        )}
      </div>
      </>
      )}

      {activeAddMode === 'note' && (
      <form onSubmit={onCreateNote} className="space-y-4 rounded-2xl border border-primary/30 bg-primary/5 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Create note</div>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Write a note for your library</h2>
          </div>
          <span className="rounded-full border border-white/10 px-3 py-2 text-xs text-muted-foreground">Images: PNG, JPEG, WebP, GIF · 5 MB</span>
        </div>
        <input
          value={noteForm.title}
          onChange={(event) => setNoteForm((current) => ({ ...current, title: event.target.value }))}
          placeholder="Title optional"
          maxLength={160}
          className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
        />
        <textarea
          value={noteForm.body}
          onChange={(event) => setNoteForm((current) => ({ ...current, body: event.target.value }))}
          placeholder="Write the note, context, reminder, or idea..."
          className="min-h-36 w-full resize-y rounded-xl border border-white/10 bg-black px-4 py-3 text-sm leading-6 outline-none focus:border-primary"
        />
        <input
          value={noteForm.links}
          onChange={(event) => setNoteForm((current) => ({ ...current, links: event.target.value }))}
          placeholder="Optional links, separated by spaces"
          className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => noteImageInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-white/5"
          >
            <Upload className="h-4 w-4" /> Add images
          </button>
          <input
            ref={noteImageInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => {
              const selectedImages = Array.from(event.target.files || []);
              setNoteForm((current) => {
                const nextImages = [...current.images];
                for (const file of selectedImages) {
                  const message = noteImageError(file, nextImages.length);
                  if (!message) nextImages.push(file);
                }
                return { ...current, images: nextImages.slice(0, MAX_NOTE_IMAGES) };
              });
              event.target.value = '';
            }}
            className="hidden"
          />
          <span className="text-xs text-muted-foreground">{noteForm.images.length}/{MAX_NOTE_IMAGES} images selected</span>
        </div>
        {noteForm.images.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {noteForm.images.map((file, index) => (
              <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setNoteForm((current) => ({ ...current, images: current.images.filter((_, imageIndex) => imageIndex !== index) }))}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? <LoadingSpinner /> : <FileText className="h-4 w-4" />}
          {busy ? 'Saving note...' : 'Save note to Library'}
        </button>
        {busy && (
          <p className="text-xs text-muted-foreground" role="status">
            Saving now. The button will reset when the save finishes.
          </p>
        )}
      </form>
      )}


      <IndexingProgressCard activity={indexingActivity} />

      {activeAddMode === 'upload' && (files.length > 0 || pendingReviews.length > 0 || indexingActivity.activeTotal > 0) && (
      <>
        <ImportHealthPanel health={importHealth} pendingReviewCount={pendingReviews.length} indexingActivity={indexingActivity} />
      </>
      )}

      {activeAddMode === 'link' && (
      <form onSubmit={onSaveLink} className="space-y-4 rounded-2xl border border-primary/30 bg-primary/5 p-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Save a link</div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Paste a link you want to keep</h2>
        </div>
        <input
          ref={linkInputRef}
          type="url"
          value={linkForm.url}
          onChange={(event) => setLinkForm((current) => ({ ...current, url: event.target.value }))}
          placeholder="https://pinterest.com/pin/..."
          required
          className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
        />
        <input
          value={linkForm.title}
          onChange={(event) => setLinkForm((current) => ({ ...current, title: event.target.value }))}
          placeholder="Title optional"
          maxLength={160}
          className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
        />
        <textarea
          value={linkForm.note}
          onChange={(event) => setLinkForm((current) => ({ ...current, note: event.target.value }))}
          placeholder="Why are you saving this? optional"
          maxLength={500}
          className="min-h-24 w-full resize-none rounded-xl border border-white/10 bg-black px-4 py-3 text-sm leading-6 outline-none focus:border-primary"
        />
        <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? <LoadingSpinner /> : <ExternalLink className="h-4 w-4" />}
          {busy ? 'Saving link...' : 'Save link'}
        </button>
        {busy && (
          <p className="text-xs text-muted-foreground" role="status">
            Saving now. IScraper will keep organizing it after the button resets.
          </p>
        )}
      </form>
      )}

      {pendingReviews.length > 0 && (
        <section ref={reviewSectionRef} className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Advanced cleanup</div>
              <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">{pendingReviews.length} saved links can be cleaned up</h2>
            </div>
            <button
              type="button"
              onClick={async () => {
                for (const item of pendingReviews) {
                  await onApproveReview(item);
                }
              }}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Add all to Library
            </button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {pendingReviews.map((item) => (
              <ReviewCard
                key={item.id}
                item={item}
                busy={busy}
                onSelect={onSelect}
                onUpdate={onUpdateReview}
                onApprove={onApproveReview}
              />
            ))}
          </div>
        </section>
      )}

    </div>
  );
}

function ReviewCard({ item, busy, onSelect, onUpdate, onApprove }) {
  const [draft, setDraft] = useState({
    sourceTitle: item.sourceTitle || item.title || '',
    sourceAuthor: item.sourceAuthor || '',
    sourceDescription: item.sourceDescription || '',
    collection: item.collection === 'Unsorted' ? '' : item.collection,
  });

  const payload = {
    ...draft,
    collections: draft.collection ? [draft.collection] : item.raw?.collections || [],
  };

  return (
    <article className="rounded-2xl border border-white/10 bg-black p-4">
      <div className="mb-4 flex items-start gap-3">
        {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" loading="lazy" /> : null}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-widest text-primary">
            <span>{item.platform}</span>
            <span className="text-muted-foreground">Needs check</span>
          </div>
          <button type="button" onClick={() => onSelect(item)} className="line-clamp-2 text-left font-display text-xl font-bold tracking-tight hover:text-primary">
            {item.sourceTitle || item.title}
          </button>
        </div>
      </div>
      <div className="space-y-3">
        <input
          value={draft.sourceTitle}
          onChange={(event) => setDraft((current) => ({ ...current, sourceTitle: event.target.value }))}
          placeholder="Clean title"
          maxLength={160}
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={draft.sourceAuthor}
            onChange={(event) => setDraft((current) => ({ ...current, sourceAuthor: event.target.value }))}
            placeholder="Creator or source"
            maxLength={120}
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <input
            value={draft.collection}
            onChange={(event) => setDraft((current) => ({ ...current, collection: event.target.value }))}
            placeholder="Collection"
            maxLength={80}
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <textarea
          value={draft.sourceDescription}
          onChange={(event) => setDraft((current) => ({ ...current, sourceDescription: event.target.value }))}
          placeholder="Short note or reason you saved it"
          maxLength={500}
          className="min-h-24 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm leading-6 outline-none focus:border-primary"
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onUpdate(item, payload)}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold disabled:opacity-60"
        >
          <Check className="h-4 w-4" />
          Save edits
        </button>
        <button
          type="button"
          onClick={() => onApprove(item, payload)}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          <CheckCircle2 className="h-4 w-4" />
          Add to Library
        </button>
      </div>
    </article>
  );
}
export { UploadTab };
