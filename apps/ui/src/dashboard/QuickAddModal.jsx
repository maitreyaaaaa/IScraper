import {
  AI_PROCESSING_NOTICE,
  ArrowLeft,
  Database,
  ExternalLink,
  fileImportName,
  FileText,
  filterLabel,
  importCandidateFiles,
  importHealthForFiles,
  Loader2,
  LoadingSpinner,
  MAX_NOTE_IMAGES,
  noteImageError,
  Plus,
  ProgressBar,
  splitQuickAddFiles,
  Upload,
  useCallback,
  useMemo,
  useRef,
  useState,
  X,
} from '../AppShared.jsx';
function QuickAddModal({
  files,
  setFiles,
  importSourceType,
  setImportSourceType,
  linkForm,
  setLinkForm,
  noteForm,
  setNoteForm,
  onSaveLink,
  onCreateNote,
  onImport,
  importProgress,
  busy,
  onOpenHowTo,
  onOpenFullAdd,
  onClose,
  onError,
}) {
  const [mode, setMode] = useState('choose');
  const [showLinkDetails, setShowLinkDetails] = useState(false);
  const [dragging, setDragging] = useState(false);
  const quickFileInputRef = useRef(null);
  const quickNoteImageInputRef = useRef(null);
  const allFileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const noteImageInputRef = useRef(null);
  const importHealth = useMemo(() => importHealthForFiles(files, importSourceType), [files, importSourceType]);

  const addImagesToNote = useCallback((nextImages) => {
    if (!nextImages.length) return;
    setNoteForm((current) => {
      const images = [...current.images];
      const errors = [];
      for (const file of nextImages) {
        const message = noteImageError(file, images.length);
        if (message) {
          errors.push(message);
        } else {
          images.push(file);
        }
      }
      if (errors.length) onError(errors[0]);
      return { ...current, images: images.slice(0, MAX_NOTE_IMAGES) };
    });
  }, [onError, setNoteForm]);

  const handleAnyFiles = useCallback((fileList) => {
    const { images, exports, unsupported } = splitQuickAddFiles(fileList);
    if (images.length) {
      addImagesToNote(images);
      setMode('note');
    }
    if (exports.length) {
      setFiles(exports);
      setImportSourceType('auto');
      setMode('upload');
    }
    if (unsupported.length && !images.length && !exports.length) {
      onError('Upload images, links, or Instagram/Pinterest/X download files.');
    }
  }, [addImagesToNote, onError, setFiles, setImportSourceType]);

  const selectedExportNames = importCandidateFiles(files, importSourceType).slice(0, 5);
  const choices = [
    { mode: 'link', title: 'Paste a link', copy: 'Save one post, product, article, or idea.', icon: ExternalLink },
    { mode: 'note', title: 'Write a note', copy: 'Capture a thought, image, reminder, or useful context.', icon: FileText },
    { mode: 'upload', title: 'Upload files', copy: 'Add Instagram, Pinterest, or X bookmark exports from your device.', icon: Upload },
  ];

  return (
    <div className="fixed inset-0 z-[260] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm md:items-end md:justify-end md:p-6" role="dialog" aria-modal="true" aria-label="Add to your library">
      <div className="flex max-h-[78dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-black shadow-2xl shadow-black md:mb-20 md:w-[26rem] md:rounded-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Quick add</div>
            <h2 className="mt-1 font-display text-2xl font-bold tracking-tight">Add to your Library</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
            aria-label="Close add popup"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {mode !== 'choose' && (
            <button
              type="button"
              onClick={() => setMode('choose')}
              className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
          )}

          {mode === 'choose' && (
            <div className="space-y-3">
              <p className="text-sm leading-6 text-muted-foreground">Pick what you want to add. Open the full Add Saves page when you need folder upload or more options.</p>
              <p className="rounded-xl border border-white/10 bg-white/[0.025] p-3 text-xs leading-5 text-muted-foreground">{AI_PROCESSING_NOTICE}</p>
              {choices.map(({ mode: choiceMode, title, copy, icon: Icon }) => (
                <button
                  key={choiceMode}
                  type="button"
                  onClick={() => setMode(choiceMode)}
                  className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4 text-left transition hover:border-primary/60 hover:bg-primary/5"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-display text-lg font-bold tracking-tight">{title}</span>
                    <span className="mt-1 block text-sm leading-5 text-muted-foreground">{copy}</span>
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => onOpenFullAdd('link')}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
              >
                <Upload className="h-4 w-4" /> Open full Add Saves page
              </button>
            </div>
          )}

          {mode === 'link' && (
            <form onSubmit={(event) => onSaveLink(event, null, { onSuccess: onClose })} className="space-y-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Paste a link</div>
                <h3 className="mt-2 font-display text-2xl font-bold tracking-tight">Save one thing fast</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Paste a post, product, article, video, or any page you want to find later.</p>
                <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] p-3 text-xs leading-5 text-muted-foreground">{AI_PROCESSING_NOTICE}</p>
              </div>
              <input
                type="url"
                value={linkForm.url}
                onChange={(event) => setLinkForm((current) => ({ ...current, url: event.target.value }))}
                placeholder="https://..."
                required
                className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
              />
              {showLinkDetails ? (
                <>
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
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowLinkDetails(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
                >
                  <Plus className="h-4 w-4" /> Add title or note
                </button>
              )}
              <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60">
                {busy ? <LoadingSpinner /> : <ExternalLink className="h-4 w-4" />}
                {busy ? 'Saving link...' : 'Save link'}
              </button>
              {busy && (
                <p className="text-xs text-muted-foreground" role="status">
                  Saving now. IScraper keeps organizing it after the button resets.
                </p>
              )}
            </form>
          )}

          {mode === 'note' && (
            <form onSubmit={(event) => onCreateNote(event, { onSuccess: onClose })} className="space-y-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Write a note</div>
                <h3 className="mt-2 font-display text-2xl font-bold tracking-tight">Save a quick thought</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Add the context you want to remember. Images and links are optional.</p>
                <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] p-3 text-xs leading-5 text-muted-foreground">{AI_PROCESSING_NOTICE}</p>
              </div>
              <textarea
                value={noteForm.body}
                onChange={(event) => setNoteForm((current) => ({ ...current, body: event.target.value }))}
                placeholder="Write the note, reminder, or idea..."
                className="min-h-32 w-full resize-y rounded-xl border border-white/10 bg-black px-4 py-3 text-sm leading-6 outline-none focus:border-primary"
              />
              <input
                value={noteForm.title}
                onChange={(event) => setNoteForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Title optional"
                maxLength={160}
                className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
              />
              <input
                value={noteForm.links}
                onChange={(event) => setNoteForm((current) => ({ ...current, links: event.target.value }))}
                placeholder="Optional links"
                className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => quickNoteImageInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/5"
                >
                  <Upload className="h-4 w-4" /> Add images
                </button>
                <span className="text-xs text-muted-foreground">{noteForm.images.length}/{MAX_NOTE_IMAGES} images selected</span>
                <input
                  ref={quickNoteImageInputRef}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(event) => {
                    addImagesToNote(Array.from(event.target.files || []));
                    event.target.value = '';
                  }}
                  className="hidden"
                />
              </div>
              {noteForm.images.length > 0 && (
                <div className="space-y-2">
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
                {busy ? 'Saving note...' : 'Save note'}
              </button>
              {busy && (
                <p className="text-xs text-muted-foreground" role="status">
                  Saving now. The button will reset when the save finishes.
                </p>
              )}
            </form>
          )}

          {mode === 'upload' && (
            <section className="space-y-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Upload files</div>
                <h3 className="mt-2 font-display text-2xl font-bold tracking-tight">Choose export files</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Use this for Instagram, Pinterest, or X bookmark downloads. For folders, open the full Add Saves page.</p>
                <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] p-3 text-xs leading-5 text-muted-foreground">{AI_PROCESSING_NOTICE}</p>
              </div>
              <button
                type="button"
                onClick={() => quickFileInputRef.current?.click()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground"
              >
                <Upload className="h-4 w-4" /> Choose files
              </button>
              <input
                ref={quickFileInputRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif,.html,.htm,.zip,.json,.csv"
                onChange={(event) => {
                  handleAnyFiles(event.target.files);
                  event.target.value = '';
                }}
                className="hidden"
              />
              <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                <div className="text-sm font-semibold">{importHealth.title}</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{importHealth.copy}</p>
                {selectedExportNames.length > 0 && (
                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {selectedExportNames.map((file) => (
                      <div key={`${fileImportName(file)}-${file.size}`} className="truncate">{fileImportName(file) || file.name}</div>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={async () => {
                  const ok = await onImport();
                  if (ok) onClose();
                }}
                disabled={busy || !files.length}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy ? <LoadingSpinner /> : <Database className="h-4 w-4" />}
                {importProgress ? importProgress.label : 'Add uploaded files'}
              </button>
              {importProgress && (
                <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                  <ProgressBar value={importProgress.value} label={importProgress.label} detail={importProgress.detail} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onOpenFullAdd('upload')}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
                >
                  Full upload
                </button>
                <button
                  type="button"
                  onClick={onOpenHowTo}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
                >
                  <FileText className="h-4 w-4" /> Help
                </button>
              </div>
            </section>
          )}
        </div>

        <div className="hidden">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              handleAnyFiles(event.dataTransfer.files);
            }}
            className={`mb-6 rounded-2xl border-2 border-dashed p-6 text-center transition md:p-8 ${dragging ? 'border-primary bg-primary/10' : 'border-white/15 bg-white/[0.025]'}`}
          >
            <Upload className="mx-auto mb-3 h-8 w-8 text-primary" />
            <h3 className="font-display text-xl font-bold">Drop images, ZIPs, folders, or files here</h3>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Images become note attachments. Instagram, Pinterest, and X bookmark files are detected automatically.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => allFileInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
              >
                <Upload className="h-4 w-4" /> Choose files
              </button>
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-white/5"
              >
                <Database className="h-4 w-4" /> Choose folder
              </button>
              <button
                type="button"
                onClick={onOpenHowTo}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
              >
                <FileText className="h-4 w-4" /> Help
              </button>
            </div>
            <input
              ref={allFileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif,.html,.htm,.zip,.json,.csv"
              onChange={(event) => {
                handleAnyFiles(event.target.files);
                event.target.value = '';
              }}
              className="hidden"
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              webkitdirectory=""
              directory=""
              onChange={(event) => {
                handleAnyFiles(event.target.files);
                event.target.value = '';
              }}
              className="hidden"
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <form onSubmit={(event) => onCreateNote(event, { onSuccess: onClose })} className="space-y-4 rounded-2xl border border-primary/30 bg-primary/5 p-5">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Note</div>
                <h3 className="mt-2 font-display text-2xl font-bold tracking-tight">Save a note, image, or useful link</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Write anything you want to remember. Add images or links when they help.</p>
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
                placeholder="Write your note..."
                className="min-h-36 w-full resize-y rounded-xl border border-white/10 bg-black px-4 py-3 text-sm leading-6 outline-none focus:border-primary"
              />
              <input
                value={noteForm.links}
                onChange={(event) => setNoteForm((current) => ({ ...current, links: event.target.value }))}
                placeholder="Optional links"
                className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 outline-none focus:border-primary"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => noteImageInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/5"
                >
                  <Upload className="h-4 w-4" /> Add images
                </button>
                <span className="text-xs text-muted-foreground">{noteForm.images.length}/{MAX_NOTE_IMAGES} images selected</span>
                <input
                  ref={noteImageInputRef}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(event) => {
                    addImagesToNote(Array.from(event.target.files || []));
                    event.target.value = '';
                  }}
                  className="hidden"
                />
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
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                Save note
              </button>
            </form>

            <div className="space-y-5">
              <form onSubmit={(event) => onSaveLink(event, null, { onSuccess: onClose })} className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Link</div>
                  <h3 className="mt-2 font-display text-2xl font-bold tracking-tight">Save a link</h3>
                </div>
                <input
                  type="url"
                  value={linkForm.url}
                  onChange={(event) => setLinkForm((current) => ({ ...current, url: event.target.value }))}
                  placeholder="https://..."
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
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  Save link
                </button>
              </form>

              <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Instagram, Pinterest, or X</div>
                  <h3 className="mt-2 font-display text-2xl font-bold tracking-tight">Upload a ZIP, folder, or bookmark file</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">Auto-detect is on, so you can upload the file you downloaded.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{importHealth.title}</div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{importHealth.copy}</p>
                    </div>
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted-foreground">
                      {filterLabel(importSourceType)}
                    </span>
                  </div>
                  {selectedExportNames.length > 0 && (
                    <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                      {selectedExportNames.map((file) => (
                        <div key={`${fileImportName(file)}-${file.size}`} className="truncate">{fileImportName(file) || file.name}</div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await onImport();
                    if (ok) onClose();
                  }}
                  disabled={busy || !files.length}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                  Add uploaded files
                </button>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
export { QuickAddModal };