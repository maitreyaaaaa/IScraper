import {
  AlertCircle,
  ArrowRight,
  cardViewForItem,
  Check,
  CheckCircle2,
  ChevronDown,
  DASHBOARD_ENRICHED_STAGES,
  DeferredSkeletonCardGrid,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  filterLabel,
  firstLine,
  formatBytes,
  formatUsageNumber,
  Images,
  LIBRARY_LAYOUT_ITEMS,
  LIBRARY_LAYOUT_OPTIONS,
  Loader2,
  LoadingSpinner,
  memo,
  Plus,
  ProgressBar,
  Search,
  SORT_OPTIONS,
  Sparkles,
  STALE_ENRICHMENT_UI_MS,
  STATE_FILTERS,
  ThumbsDown,
  ThumbsUp,
  TYPE_FILTERS,
  Upload,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  VirtualLibraryGrid,
  X,
} from '../AppShared.jsx';
import { DashboardFilterSelect, LibraryFilterMenu } from './Filters.jsx';
/* eslint-disable react-refresh/only-export-components */
function summarizeIndexing(items) {
  const activeItems = items
    .filter((item) => item.indexingStage === 'visual_indexing' && !isStaleEnrichmentItem(item))
    .map((item) => ({
      id: item.id,
      title: item.sourceTitle || item.title || firstLine(item.caption) || 'Untitled save',
      source: item.sourceAuthor || item.user || item.platform || 'Saved source',
    }))
    .slice(0, 12);
  const metadata = items.filter((item) => item.indexingStage === 'metadata_ready').length;
  const text = items.filter((item) => item.indexingStage === 'text_indexed').length;
  const visual = items.filter((item) => item.indexingStage === 'visual_indexed').length;
  const deep = items.filter((item) => item.indexingStage === 'deep_indexed').length;
  const indexing = items.filter((item) => item.indexingStage === 'visual_indexing' && !isStaleEnrichmentItem(item)).length;
  const failed = items.filter((item) => item.indexingStage === 'index_failed').length;
  const total = items.filter((item) => item.sourceStatus !== 'needs_review').length;
  const enriched = text + indexing + visual + deep;
  const progress = total > 0 ? Math.round((enriched / total) * 100) : 0;

  return {
    metadata,
    text,
    visual,
    deep,
    indexing,
    failed,
    active: indexing,
    activeTotal: indexing,
    activeItems,
    enriched,
    progress,
  };
}

function activityFromIndexingSummary(summary, fallbackItems = []) {
  if (!summary) return summarizeIndexing(fallbackItems);
  const total = Number(summary.needsReview || 0) + Number(summary.totalJobs || 0);
  const enriched = Number(summary.done || 0) + Number(summary.processing || 0);
  return {
    metadata: Number(summary.queued || summary.waiting || 0),
    text: 0,
    visual: Number(summary.done || 0),
    deep: 0,
    indexing: Number(summary.processing || 0),
    failed: Number(summary.failed || 0),
    active: Number(summary.processing || 0),
    activeTotal: Number(summary.processing || 0),
    activeItems: [],
    enriched,
    progress: total > 0 ? Math.round((enriched / total) * 100) : 0,
  };
}

function suggestedSearchQuery(items = []) {
  const source = items.find((item) => firstUsefulCardChip(item) || item.sourceTitle || item.title || firstLine(item.caption));
  if (!source) return '';
  return firstUsefulCardChip(source) || source.sourceTitle || source.title || firstLine(source.caption) || '';
}

function buildActivationState(items = [], activity = summarizeIndexing(items)) {
  const reviewItems = items.filter((item) => item.sourceStatus === 'needs_review');
  const searchableItems = items.filter((item) => item.sourceStatus !== 'needs_review');
  const metadataOnly = searchableItems.filter((item) => item.indexingStage === 'metadata_ready' || item.indexingStage === 'index_failed').length;
  const enriched = searchableItems.filter((item) => DASHBOARD_ENRICHED_STAGES.has(item.indexingStage)).length;
  const failed = searchableItems.filter((item) => item.indexingStage === 'index_failed' || item.status === 'failed').length;
  const searchQuery = suggestedSearchQuery(searchableItems);

  let currentStep = 'add';
  if (items.length > 0 && reviewItems.length > 0 && searchableItems.length === 0) currentStep = 'approve';
  if (searchableItems.length > 0) currentStep = 'search';

  return {
    currentStep,
    total: items.length,
    needsReview: reviewItems.length,
    searchable: searchableItems.length,
    metadataOnly,
    enriched,
    indexing: activity.activeTotal || 0,
    failed,
    searchQuery,
  };
}

function isStaleEnrichmentItem(item) {
  if (item?.indexingStage !== 'visual_indexing') return false;
  const timestamp = Date.parse(item.lastEnrichmentRequestedAt || item.raw?.lastEnrichmentRequestedAt || item.raw?.updatedAt || '');
  return Number.isFinite(timestamp) && Date.now() - timestamp > STALE_ENRICHMENT_UI_MS;
}

function IndexingProgressCard({ activity }) {
  if (!activity.activeTotal) return null;

  const progress = Math.min(99, Math.max(2, activity.progress));

  return (
    <details className="group mt-5 w-full max-w-xl rounded-2xl border border-primary/30 bg-primary/5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <LoadingSpinner />
          </span>
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Enrichment</div>
            <div className="truncate text-sm font-semibold">{activity.activeTotal} active now</div>
          </div>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition group-open:rotate-180 group-open:text-primary" />
      </summary>
      <div className="space-y-3 border-t border-primary/20 px-4 pb-4 pt-3">
        <ProgressBar value={progress} />
        <div className="flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          <span>{activity.indexing} indexing</span>
          <span>{activity.visual} visual indexed</span>
          <span>{activity.deep} transcript ready</span>
        </div>
        <div className="space-y-2">
          {activity.activeItems.map((item) => (
            <div key={item.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-xs">
              <LoadingSpinner className="h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0">
                <div className="truncate font-semibold">{item.title}</div>
                <div className="truncate text-[11px] text-muted-foreground">{item.source}</div>
              </div>
            </div>
          ))}
          {activity.activeTotal > activity.activeItems.length && (
            <div className="text-xs text-muted-foreground">
              {activity.activeTotal - activity.activeItems.length} more saves are still being updated.
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

function ImportHealthPanel({ health, pendingReviewCount, indexingActivity }) {
  const healthMeta = {
    waiting: { icon: FileText, color: 'text-muted-foreground', label: 'Waiting' },
    ready: { icon: CheckCircle2, color: 'text-primary', label: 'Ready' },
    blocked: { icon: AlertCircle, color: 'text-destructive', label: 'Blocked' },
  }[health.state] || { icon: FileText, color: 'text-muted-foreground', label: 'Waiting' };
  const Icon = healthMeta.icon;
  const checks = [
    ['Files', health.title, Icon, healthMeta.color],
    ['Review', `${formatUsageNumber(pendingReviewCount)} waiting`, CheckCircle2, pendingReviewCount ? 'text-muted-foreground' : 'text-primary'],
    ['Indexing', `${formatUsageNumber(indexingActivity.activeTotal)} active`, indexingActivity.activeTotal ? Loader2 : CheckCircle2, indexingActivity.activeTotal ? 'text-muted-foreground' : 'text-primary'],
  ];

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Status</div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">File status</h2>
        </div>
        {health.selectedCount > 0 && (
          <span className="rounded-full border border-white/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {formatUsageNumber(health.selectedCount)} selected / {formatBytes(health.totalBytes)}
          </span>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {checks.map(([label, title, CheckIcon, color]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-black/40 p-4">
            <div className={`mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] ${color}`}>
              <CheckIcon className={`h-3.5 w-3.5 ${CheckIcon === Loader2 ? 'animate-spin' : ''}`} /> {label}
            </div>
            <div className="text-sm font-semibold">{title}</div>
          </div>
        ))}
      </div>
      {health.largeUpload && (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Large uploads may take a little longer. You can keep this page open while we prepare them.
        </p>
      )}
    </section>
  );
}

function MobileFilterGroup({ label, value, options, onChange }) {
  return (
    <section className="space-y-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">{label}</div>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${
              value === option
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-white/10 bg-white/[0.025] text-muted-foreground hover:border-primary/60 hover:text-foreground'
            }`}
          >
            <span className="truncate">{filterLabel(option)}</span>
            {value === option && <Check className="h-4 w-4 shrink-0" />}
          </button>
        ))}
      </div>
    </section>
  );
}

function MobileFiltersSheet({ open, onClose, groups, activeFilters }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm md:hidden" role="dialog" aria-modal="true" aria-label="Library filters">
      <div className="max-h-[82dvh] w-full overflow-hidden rounded-t-2xl border border-white/10 bg-black shadow-2xl shadow-black">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Library</div>
            <h2 className="mt-1 font-display text-2xl font-bold tracking-tight">Filters</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
            aria-label="Close filters"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[calc(82dvh-9.5rem)] space-y-6 overflow-y-auto p-5 pb-24">
          {groups.map((group) => (
            <MobileFilterGroup key={group.label} {...group} />
          ))}
        </div>
        <div className="border-t border-white/10 p-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground"
          >
            Apply {activeFilters > 0 ? `(${activeFilters})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

function LibraryLayoutControl({ value, onChange }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black p-1" aria-label="Library layout">
      {LIBRARY_LAYOUT_ITEMS.map(({ value: option, shortLabel, icon: Icon }) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            title={filterLabel(option)}
            onClick={() => onChange(option)}
            className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${
              selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-white/10 hover:text-foreground'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{shortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

function LibraryTab({
  items,
  totalCount,
  searchActive,
  searchResultCount,
  searchAi,
  searchMode,
  onSearchModeChange,
  onFollowUp,
  libraryChatOpen,
  onOpenLibraryChat,
  searchFeedback,
  query,
  setQuery,
  onClearSearch,
  onSearch,
  onVisualSearch,
  visualSearch,
  visualSearchLoading,
  busy,
  typeFilter,
  setTypeFilter,
  stateFilter,
  setStateFilter,
  sortOrder,
  setSortOrder,
  collectionFilter,
  setCollectionFilter,
  collections,
  platformFilter,
  setPlatformFilter,
  platforms,
  libraryLayout,
  setLibraryLayout,
  onSelect,
  indexingActivity,
  activationState,
  onOpenAdd,
  onSearchFeedback,
  scrollRef,
  hasMore = false,
  loadingMore = false,
  initialLoading = false,
  onLoadMore,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const visualSearchInputRef = useRef(null);
  const activeFilters = (typeFilter !== 'all' ? 1 : 0) + (stateFilter !== 'all' ? 1 : 0) + (collectionFilter !== 'all' ? 1 : 0) + (platformFilter !== 'all' ? 1 : 0);
  const updateFilter = useCallback((setter) => (value) => {
    setter(value);
  }, []);
  const mobileFilterGroups = useMemo(() => [
    { label: 'Type', value: typeFilter, options: TYPE_FILTERS, onChange: updateFilter(setTypeFilter) },
    { label: 'Status', value: stateFilter, options: STATE_FILTERS, onChange: updateFilter(setStateFilter) },
    { label: 'Platform', value: platformFilter, options: platforms, onChange: updateFilter(setPlatformFilter) },
    { label: 'Collection', value: collectionFilter, options: collections, onChange: updateFilter(setCollectionFilter) },
    { label: 'Sort', value: sortOrder, options: SORT_OPTIONS, onChange: updateFilter(setSortOrder) },
    { label: 'Layout', value: libraryLayout, options: LIBRARY_LAYOUT_OPTIONS, onChange: updateFilter(setLibraryLayout) },
  ], [collectionFilter, collections, libraryLayout, platformFilter, platforms, sortOrder, stateFilter, typeFilter, updateFilter, setCollectionFilter, setLibraryLayout, setPlatformFilter, setSortOrder, setStateFilter, setTypeFilter]);

  return (
    <div className="mx-auto max-w-[1480px] px-4 pb-28 pt-4 sm:px-6 md:px-10 md:pt-0">
      <section className="flex min-h-[66dvh] items-center justify-center py-6 md:min-h-[70dvh]">
        <div className="w-full max-w-[44rem]">
          <form
            onSubmit={(event) => {
              onSearch(event);
            }}
            className="w-full rounded-2xl border border-white/10 bg-white/[0.035] p-4 shadow-2xl shadow-black/40 transition focus-within:border-primary focus-within:bg-white/[0.05] md:p-5"
          >
          <textarea
            autoFocus
            rows={1}
            aria-label={searchMode === 'web' ? 'Ask web search' : 'Search saved items'}
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              if (!nextQuery.trim() && searchActive) {
                onClearSearch();
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return;
              event.preventDefault();
              onSearch(event);
            }}
            placeholder={searchMode === 'web' ? 'Ask a follow-up or research your saved library...' : 'Search your saved posts, links, and notes...'}
            className="min-h-10 w-full resize-none bg-transparent text-base leading-6 outline-none placeholder:text-muted-foreground md:min-h-12 md:text-lg"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <input
                ref={visualSearchInputRef}
                type="file"
                aria-label="Upload image for visual search"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  setUploadMenuOpen(false);
                  if (file) onVisualSearch(file);
                }}
              />
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setUploadMenuOpen((open) => !open)}
                  disabled={busy}
                  className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-black text-primary transition hover:border-primary hover:bg-primary/10 disabled:opacity-60"
                  aria-label="Open upload options"
                  aria-expanded={uploadMenuOpen}
                  aria-haspopup="menu"
                >
                  <Plus className="h-4 w-4" />
                </button>
                {uploadMenuOpen && (
                  <div
                    className="absolute bottom-full left-0 z-20 mb-2 min-w-32 rounded-xl border border-white/10 bg-black p-2 shadow-2xl shadow-black/50"
                    role="menu"
                    aria-label="Upload options"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setUploadMenuOpen(false);
                        visualSearchInputRef.current?.click();
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-foreground transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      role="menuitem"
                    >
                      <Upload className="h-4 w-4 text-primary" />
                      Upload
                    </button>
                  </div>
                )}
              </div>
              <div className="inline-flex rounded-full border border-white/10 bg-black p-1" aria-label="Search mode">
                {[
                  ['saved', 'Saved'],
                  ['web', 'Web search'],
                ].map(([mode, label]) => {
                  const active = searchMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onSearchModeChange(mode)}
                      className={`min-h-9 rounded-full px-4 text-sm font-semibold transition ${
                        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-white/10 hover:text-foreground'
                      }`}
                      aria-pressed={active}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {searchActive && (
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {visualSearch ? `${searchResultCount} visual matches` : `${searchResultCount} matching saves`}
                </span>
              )}
              {(busy || visualSearchLoading) && (
                <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" role="status">
                  <LoadingSpinner className="h-3.5 w-3.5" />
                  {visualSearchLoading ? 'Uploading image...' : searchMode === 'web' ? 'Searching web...' : 'Searching...'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    onClearSearch();
                  }}
                  className="grid h-8 w-8 place-items-center rounded-full border border-white/10 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          </form>
        {visualSearch && (
          <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4 md:flex-row md:items-center">
            <img src={visualSearch.imageDataUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Same Vibe Search</div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Using your uploaded image to find saved visuals with similar visual notes, text, topics, brands, and tags.
              </p>
              {visualSearch.analysis?.visualDescription && (
                <p className="mt-2 line-clamp-2 text-sm text-foreground">{visualSearch.analysis.visualDescription}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClearSearch}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-white/10 px-4 text-sm font-semibold text-foreground transition hover:bg-white/5"
            >
              <X className="h-4 w-4" /> Clear
            </button>
          </div>
        )}
        {visualSearchLoading && !visualSearch && (
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
            <ProgressBar value={null} label="Upload" detail="Finding similar saves" />
          </div>
        )}
        </div>
      </section>

      {searchActive && !visualSearch && searchMode === 'saved' && (
        <div className="mx-auto max-w-4xl">
          {searchAi ? (
            <SearchAiPanel ai={searchAi} items={items} onSelect={onSelect} onFollowUp={onFollowUp} inline />
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-5 text-sm leading-6 text-muted-foreground">
              Showing saved matches now. The AI answer will appear here when AI search is configured and enough saved context is available.
            </div>
          )}
        </div>
      )}

      <div className="mx-auto max-w-4xl">
        <IndexingProgressCard activity={indexingActivity} />
      </div>

      {searchActive && searchMode === 'web' && (
        <div className="mx-auto mt-5 max-w-4xl">
          <button
            type="button"
            onClick={onOpenLibraryChat}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary/15"
          >
            <Sparkles className="h-4 w-4" />
            {libraryChatOpen ? 'AI answer is open' : searchAi?.answer ? 'Open AI answer' : 'Ask AI about these results'}
          </button>
        </div>
      )}

      <div className="mt-4 w-full">
        <div className="flex flex-col gap-3 text-xs font-mono text-muted-foreground md:flex-row md:items-center md:justify-between">
          <span className="shrink-0 leading-5">
            {items.length} shown from {totalCount || items.length} saves
            {searchActive ? ` - ${searchResultCount} search results from ${totalCount} total saves` : ''}
          </span>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/10 px-4 py-2 font-sans text-sm font-semibold text-foreground transition hover:border-primary md:hidden"
          >
            <Filter className="h-4 w-4 text-primary" />
            Filters {activeFilters > 0 ? `(${activeFilters})` : ''}
          </button>
          <div className="hidden items-center justify-end gap-2 md:ml-auto md:flex">
            <LibraryLayoutControl value={libraryLayout} onChange={setLibraryLayout} />
            <LibraryFilterMenu
              activeFilters={activeFilters}
              typeFilter={typeFilter}
              setTypeFilter={setTypeFilter}
              stateFilter={stateFilter}
              setStateFilter={setStateFilter}
              platformFilter={platformFilter}
              setPlatformFilter={setPlatformFilter}
              platforms={platforms}
              collectionFilter={collectionFilter}
              setCollectionFilter={setCollectionFilter}
              collections={collections}
            />
            <DashboardFilterSelect
              label="Sort"
              ariaLabel="Sort library"
              icon={ChevronDown}
              value={sortOrder}
              options={SORT_OPTIONS}
              onChange={(nextSort) => {
                  setSortOrder(nextSort);
                }}
            />
          </div>
        </div>
      </div>

      <MobileFiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        groups={mobileFilterGroups}
        activeFilters={activeFilters}
      />

      <div className="mt-10 md:mt-[7dvh]">
        {initialLoading ? (
          <DeferredSkeletonCardGrid count={libraryLayout === 'list' ? 3 : 6} layout={libraryLayout} />
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center md:p-14">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
              {searchActive && searchResultCount === 0 ? <Search className="h-5 w-5" /> : <Upload className="h-5 w-5" />}
            </div>
            <h3 className="mt-4 font-display text-2xl font-bold tracking-tight">
              {typeFilter === 'notes' && !searchActive
                ? 'No notes yet'
                : searchActive && searchResultCount === 0
                ? 'No matching saves yet'
                : activeFilters > 0
                  ? 'No saves match these filters'
                  : activationState.needsReview
                    ? 'Check one saved link to add it'
                    : 'Add one save to get started'}
            </h3>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              {searchActive && searchResultCount === 0
                ? activationState.searchable
                  ? `${formatUsageNumber(activationState.searchable)} saves are in your Library. Try another title, creator, tag, or collection.`
                  : 'Nothing is in your Library search yet. Add or confirm a save first, then search again.'
                : typeFilter === 'notes'
                  ? 'Create a note from the Add tab and it will appear here immediately.'
                : activeFilters > 0
                  ? 'Clear the active filters or switch back to All to see your saved library.'
                  : activationState.needsReview
                    ? 'Open Add saves, check one saved link, and add it to your Library.'
                    : 'Paste a link or upload your files, then add the saves you want to keep.'}
            </p>
            {(!searchActive || activationState.searchable === 0) && (
              <button
                type="button"
                onClick={onOpenAdd}
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
              >
                <Upload className="h-4 w-4" /> {typeFilter === 'notes' ? 'Create note' : 'Add saves'}
              </button>
            )}
          </div>
        ) : (
          <VirtualLibraryGrid
            items={items}
            scrollRef={scrollRef}
            layoutMode={libraryLayout}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={onLoadMore}
            renderItem={(item, index, cardHeight) => (
              libraryLayout === 'list' ? (
                <LibraryListRow
                  key={item.id}
                  item={item}
                  height={cardHeight}
                  onClick={onSelect}
                  searchActive={searchActive}
                  feedback={searchFeedback?.[item.id]}
                  onSearchFeedback={onSearchFeedback}
                />
              ) : libraryLayout === 'gallery' ? (
                <GalleryCard
                  key={item.id}
                  item={item}
                  height={cardHeight}
                  onClick={onSelect}
                  searchActive={searchActive}
                  feedback={searchFeedback?.[item.id]}
                  onSearchFeedback={onSearchFeedback}
                />
              ) : (
                <PinCard
                  key={item.id}
                  item={item}
                  index={index}
                  height={cardHeight}
                  onClick={onSelect}
                  searchActive={searchActive}
                  feedback={searchFeedback?.[item.id]}
                  onSearchFeedback={onSearchFeedback}
                />
              )
            )}
          />
        )}
      </div>

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="rounded-full border border-white/10 bg-white/[0.04] px-6 py-3 text-sm font-semibold transition hover:border-primary hover:text-primary"
          >
            {loadingMore ? 'Loading...' : 'Show more saves'}
          </button>
        </div>
      )}
    </div>
  );
}

const PIN_BACKDROPS = [
  '#d6ff24',
  '#f4f4f0',
  '#a5ff18',
  '#29ffc6',
  '#e5e7eb',
  '#86efac',
];

function firstUsefulCardChip(item) {
  return [item.collection, item.tags[0], item.topics[0], item.brands[0], item.tools[0]]
    .map((value) => String(value || '').trim())
    .find((value) => value && value !== 'Unsorted');
}

function firstSearchReason(item) {
  const match = item.searchMatch;
  const field = match?.matchedFields?.[0];
  if (match?.type === 'visual' && field?.snippet) return field.snippet;
  if (field?.label && field?.terms?.length) return `Matched ${field.label.toLowerCase()}: ${field.terms.slice(0, 3).join(', ')}`;
  if (field?.label) return `Matched ${field.label.toLowerCase()}`;
  if (match?.matchTypes?.includes('semantic')) return 'Matched related meaning';
  return '';
}

function createLibraryChatMessage(role, content, extra = {}) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content: String(content || '').trim(),
    ...extra,
  };
}

function webSearchProgress(savedStatus = 'pending', webStatus = 'pending') {
  return [
    { key: 'saved', label: 'Searching your saved', status: savedStatus },
    { key: 'web', label: 'Searching the web', status: webStatus },
  ];
}

function webStepStatusFromAi(ai) {
  if (ai?.error) return 'failed';
  if (ai?.answer) return 'done';
  return 'failed';
}

function SearchAiPanel({ ai, items, onSelect, onFollowUp, inline = false }) {
  if (!ai) return null;
  const webCitations = (ai.webCitations || ai.sources || []).filter((citation) => citation.url);
  const sourceLabel = ai.mode === 'web' ? 'From your saved + web' : 'From your saved items';
  if (ai.error) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-5 text-sm leading-6 text-muted-foreground">
        <div>{ai.error}</div>
        {inline && onFollowUp && (
          <button
            type="button"
            onClick={onFollowUp}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 font-semibold text-primary transition hover:bg-primary/15"
          >
            <Sparkles className="h-4 w-4" /> Follow-up
          </button>
        )}
      </div>
    );
  }
  const citations = (ai.citations || []).filter((citation) => items.some((item) => item.id === citation.id));
  if (!ai.answer) return null;
  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-primary">
          <Sparkles className="h-3.5 w-3.5" /> {sourceLabel}
        </div>
        {inline && onFollowUp && (
          <button
            type="button"
            onClick={onFollowUp}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110"
          >
            <Sparkles className="h-4 w-4" /> Follow-up
          </button>
        )}
      </div>
      <p className="text-sm leading-6 text-foreground">{ai.answer}</p>
      {citations.length > 0 && (
      <div className="mt-4 flex flex-wrap gap-2">
        {citations.slice(0, 4).map((citation) => {
          const item = items.find((entry) => entry.id === citation.id);
          return (
            <a
              key={citation.id}
              href={item?.url || '#'}
              target={item?.url ? '_blank' : undefined}
              rel={item?.url ? 'noreferrer' : undefined}
              onClick={(event) => {
                if (!item?.url) {
                  event.preventDefault();
                  if (item) onSelect(item);
                }
              }}
              className="max-w-full rounded-full border border-white/10 px-3 py-1.5 text-left text-xs text-muted-foreground transition hover:border-primary hover:text-foreground"
              title={citation.reason || citation.snippet}
            >
              <span className="inline-flex items-center gap-1">
                <span className="line-clamp-1">{citation.title || item?.sourceTitle || item?.title || 'Saved item'}</span>
                {item?.url ? <ExternalLink className="h-3 w-3 shrink-0" /> : null}
              </span>
            </a>
          );
        })}
      </div>
      )}
      {webCitations.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {webCitations.slice(0, 5).map((citation) => (
            <a
              key={citation.url}
              href={citation.url}
              target="_blank"
              rel="noreferrer"
              className="max-w-full rounded-full border border-white/10 px-3 py-1.5 text-left text-xs text-muted-foreground transition hover:border-primary hover:text-foreground"
              title={citation.snippet || citation.title}
            >
              <span className="inline-flex items-center gap-1">
                <span className="line-clamp-1">{citation.title || citation.url}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatProgressSteps({ steps = [] }) {
  if (!steps.length) return null;
  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3" role="status" aria-live="polite">
      {steps.map((step) => {
        const done = step.status === 'done';
        const failed = step.status === 'failed';
        return (
          <div key={step.key} className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${
              done
                ? 'border-primary bg-primary text-primary-foreground'
                : failed
                  ? 'border-destructive/50 bg-destructive/10 text-destructive'
                  : 'border-white/10 bg-black text-muted-foreground'
            }`}>
              {done ? <Check className="h-3.5 w-3.5" /> : failed ? <AlertCircle className="h-3.5 w-3.5" /> : step.status === 'loading' ? <LoadingSpinner className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            </span>
            <span>{step.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function LibraryChatPanel({ chat, items, onAsk, onClose, onSelect }) {
  const [draft, setDraft] = useState('');
  const draftRef = useRef(null);
  const open = Boolean(chat?.open);
  const messages = chat?.messages || [];
  const suggestions = messages
    .slice()
    .reverse()
    .find((message) => message.role === 'assistant' && message.ai?.suggestions?.length)?.ai?.suggestions || [];

  const submit = (event) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || chat.loading) return;
    setDraft('');
    onAsk(text);
  };

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => draftRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  if (!open) return null;

  return (
    <aside className="fixed inset-0 z-40 flex justify-end bg-black/45 backdrop-blur-sm md:bg-black/20" aria-label="Ask your Library">
      <div className="flex h-full w-full max-w-[30rem] flex-col border-l border-white/10 bg-black shadow-2xl shadow-black">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
          <div>
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-primary">
              <Sparkles className="h-3.5 w-3.5" /> AI Library
            </div>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Ask your saves</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">Answers use your saved items and cite the saves they came from.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
            aria-label="Close AI Library panel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.map((message) => {
            const messageItems = message.results?.length ? message.results : items;
            if (message.role === 'user') {
              return (
                <div key={message.id} className="ml-auto max-w-[85%] rounded-2xl bg-primary px-4 py-3 text-sm font-medium leading-6 text-primary-foreground">
                  {message.content}
                </div>
              );
            }
            return (
              <div key={message.id} className="max-w-full">
                {message.ai ? (
                  <SearchAiPanel ai={message.ai} items={messageItems} onSelect={onSelect} />
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-5 text-sm leading-6 text-muted-foreground">
                    {message.content}
                  </div>
                )}
              </div>
            );
          })}
          {chat.loading && (
            chat.progress?.length ? <ChatProgressSteps steps={chat.progress} /> : (
              <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3 text-sm text-muted-foreground">
                <LoadingSpinner /> Searching your Library...
              </div>
            )
          )}
          {!chat.loading && chat.progress?.length ? <ChatProgressSteps steps={chat.progress} /> : null}
          {chat.error && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {chat.error}
            </div>
          )}
        </div>

        <div className="border-t border-white/10 p-4">
          {suggestions.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {suggestions.slice(0, 3).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => onAsk(suggestion)}
                  disabled={chat.loading}
                  className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary hover:text-foreground disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={submit} className="flex items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.035] p-2 focus-within:border-primary">
            <textarea
              ref={draftRef}
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey) return;
                event.preventDefault();
                submit(event);
              }}
              placeholder="Ask a follow-up..."
              className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={!draft.trim() || chat.loading}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Ask follow-up"
            >
              {chat.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

function SearchResultFeedback({ itemId, value, onVote }) {
  const saving = value?.status === 'saving';
  const saved = value?.status === 'saved';
  const failed = value?.status === 'failed';
  return (
    <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
      <span className={`text-[11px] ${failed ? 'text-destructive' : 'text-muted-foreground'}`}>
        {saving ? 'Saving vote...' : saved ? 'Vote saved' : failed ? 'Vote failed' : 'This result'}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onVote(itemId, 'helpful');
          }}
          disabled={saving}
          className={`grid h-8 w-8 place-items-center rounded-full border border-white/10 transition hover:border-primary hover:text-primary ${value?.rating === 'helpful' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          aria-label="Mark this result helpful"
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onVote(itemId, 'not_helpful');
          }}
          disabled={saving}
          className={`grid h-8 w-8 place-items-center rounded-full border border-white/10 transition hover:border-destructive hover:text-destructive ${value?.rating === 'not_helpful' ? 'bg-destructive text-white' : 'text-muted-foreground'}`}
          aria-label="Mark this result not helpful"
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function CompactSearchResultFeedback({ itemId, value, onVote }) {
  const saving = value?.status === 'saving';
  const saved = value?.status === 'saved';
  const failed = value?.status === 'failed';
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className={`hidden text-[11px] sm:inline ${failed ? 'text-destructive' : 'text-muted-foreground'}`}>
        {saving ? 'Saving' : saved ? 'Saved' : failed ? 'Failed' : 'Result'}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onVote(itemId, 'helpful');
          }}
          disabled={saving}
          className={`grid h-8 w-8 place-items-center rounded-full border border-white/10 transition hover:border-primary hover:text-primary ${value?.rating === 'helpful' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          aria-label="Mark this result helpful"
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onVote(itemId, 'not_helpful');
          }}
          disabled={saving}
          className={`grid h-8 w-8 place-items-center rounded-full border border-white/10 transition hover:border-destructive hover:text-destructive ${value?.rating === 'not_helpful' ? 'bg-destructive text-white' : 'text-muted-foreground'}`}
          aria-label="Mark this result not helpful"
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

const LibraryListRow = memo(function LibraryListRow({ item, height = 172, onClick, searchActive = false, feedback = null, onSearchFeedback = null }) {
  const card = item.card || cardViewForItem(item);
  const { capture, note, meta } = card;
  const Icon = meta.icon;
  const searchReason = searchActive ? firstSearchReason(item) : '';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick(item);
        }
      }}
      className="group grid w-full grid-cols-[1fr_auto] gap-4 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-left shadow-[0_10px_28px_rgba(0,0,0,0.20)] transition-colors hover:border-primary/60 hover:bg-white/[0.055]"
      style={{ height, contain: 'layout paint style' }}
      data-library-list-row="true"
    >
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-primary">
            {capture ? 'Screen Capture' : note ? 'My Note' : item.platform}
          </span>
          {card.chip && (
            <span className="max-w-[11rem] truncate rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-muted-foreground">
              {card.chip}
            </span>
          )}
          {card.statusLabel && (
            <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${meta.color}`}>
              <Icon className={`h-3 w-3 ${item.indexingStage === 'visual_indexing' ? 'animate-spin' : ''}`} />
              {card.statusLabel}
            </span>
          )}
        </div>
        <h3 className="truncate font-display text-xl font-bold tracking-tight text-foreground md:text-2xl">{card.title}</h3>
        <div className="mt-1 truncate font-mono text-xs text-primary">{card.source}</div>
        <p className="mt-2 line-clamp-2 text-sm leading-5 text-muted-foreground">{searchReason ? `Why it matched: ${searchReason}` : card.preview}</p>
      </div>
      <div className="flex min-w-0 shrink-0 flex-col items-end justify-between gap-3">
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt=""
            className="h-16 w-16 rounded-xl object-cover opacity-85 sm:h-20 sm:w-20"
            loading="lazy"
            decoding="async"
            width="96"
            height="96"
          />
        ) : (
          <div className="grid h-16 w-16 place-items-center rounded-xl border border-white/10 bg-white/[0.035] text-muted-foreground sm:h-20 sm:w-20">
            {note ? <FileText className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </div>
        )}
        {searchActive && onSearchFeedback ? (
          <CompactSearchResultFeedback itemId={item.id} value={feedback} onVote={onSearchFeedback} />
        ) : (
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
        )}
      </div>
    </div>
  );
});

const GalleryCard = memo(function GalleryCard({ item, height = 380, onClick, searchActive = false, feedback = null, onSearchFeedback = null }) {
  const card = item.card || cardViewForItem(item);
  const { capture, note, meta } = card;
  const Icon = meta.icon;
  const searchReason = searchActive ? firstSearchReason(item) : '';
  const hasPreview = Boolean(item.thumbnailUrl);
  const statusText = item.sourceStatus === 'needs_review' ? 'Needs check' : card.statusLabel || (hasPreview ? 'Preview ready' : 'Preview pending');

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${card.title || 'saved item'} in Gallery`}
      onClick={() => onClick(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick(item);
        }
      }}
      className="group flex w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] text-left shadow-[0_12px_32px_rgba(0,0,0,0.24)] outline-none transition hover:border-primary/60 hover:bg-white/[0.055] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
      style={{ height, contain: 'layout paint style' }}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#10100f]">
        {hasPreview ? (
          <img
            src={item.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.025]"
            loading="lazy"
            decoding="async"
            width="420"
            height="300"
          />
        ) : (
          <div className="grid h-full place-items-center bg-[linear-gradient(135deg,#141414_0%,#20201d_48%,#111_100%)] p-6">
            <div className="text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/[0.045] text-primary">
                {note ? <FileText className="h-5 w-5" /> : <Images className="h-5 w-5" />}
              </span>
              <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Preview pending</div>
              <p className="mt-2 line-clamp-3 text-sm leading-5 text-foreground">{card.preview}</p>
            </div>
          </div>
        )}
        <div className="absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-2">
          <span className="max-w-full rounded-full bg-black/75 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-white backdrop-blur">
            <span className="block truncate">{capture ? 'Screen capture' : note ? 'My note' : item.platform}</span>
          </span>
          {card.imageCount > 1 && (
            <span className="rounded-full bg-black/75 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-white backdrop-blur">
              {card.imageCount} images
            </span>
          )}
        </div>
        <div className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-white/85 text-black shadow-lg shadow-black/30">
          <Icon className={`h-4 w-4 ${meta.icon === Loader2 ? 'animate-spin' : ''}`} />
        </div>
      </div>
      <div className="flex min-h-[132px] flex-col p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="min-w-0 truncate font-mono text-[11px] uppercase tracking-[0.18em] text-primary">{card.source}</span>
          <span className="shrink-0 rounded-full border border-white/10 px-2 py-1 text-[10px] text-muted-foreground">
            {statusText}
          </span>
        </div>
        <h3 className="line-clamp-2 font-display text-xl font-bold leading-tight tracking-tight">{card.title}</h3>
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{searchReason ? `Why it matched: ${searchReason}` : card.preview}</p>
        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          {card.chip ? (
            <span className="min-w-0 truncate rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-muted-foreground">{card.chip}</span>
          ) : (
            <span />
          )}
          {searchActive && onSearchFeedback ? (
            <CompactSearchResultFeedback itemId={item.id} value={feedback} onVote={onSearchFeedback} />
          ) : (
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
          )}
        </div>
      </div>
    </div>
  );
});

const PinCard = memo(function PinCard({ item, index, height = 420, onClick, searchActive = false, feedback = null, onSearchFeedback = null }) {
  const card = item.card || cardViewForItem(item);
  const { capture, note, meta } = card;
  const Icon = meta.icon;
  const backdrop = PIN_BACKDROPS[index % PIN_BACKDROPS.length];
  const searchReason = searchActive ? firstSearchReason(item) : '';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick(item);
        }
      }}
      className="pin-card group block w-full overflow-hidden rounded-[1.25rem] border border-white/10 bg-white/[0.035] text-left shadow-[0_12px_32px_rgba(0,0,0,0.24)] transition-colors duration-200 hover:border-primary/60 hover:bg-white/[0.055]"
      style={{ height, contain: 'layout paint style' }}
    >
      <div className="relative flex h-[62%] min-h-0 flex-col justify-between overflow-hidden p-5 text-black" style={{ background: capture ? '#070707' : note ? 'linear-gradient(135deg, #f7f2df 0%, #d8f99d 100%)' : backdrop }}>
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover ${capture ? 'opacity-85' : 'opacity-45'}`}
            loading="lazy"
            decoding="async"
            width="480"
            height="300"
          />
        ) : null}
        {!capture && <div className="absolute inset-0 opacity-10 grid-bg" />}
        <div className="relative flex items-center justify-between gap-3">
          <span className="rounded-full bg-black/75 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-white">{capture ? 'Screen Capture' : note ? 'My Note' : item.platform}</span>
          <span className="rounded-full bg-white/80 p-2 text-black">
            {note ? <FileText className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </span>
        </div>
        <div className={`relative ${capture ? 'text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.75)]' : ''}`}>
          {card.chip && (
            <span className={`mb-3 inline-flex max-w-full rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-widest ${capture ? 'bg-black/70 text-white' : 'bg-black/15 text-black'}`}>
              <span className="truncate">{card.chip}</span>
            </span>
          )}
          <h3 className="line-clamp-3 font-display text-3xl font-bold leading-none tracking-tight md:text-[2.15rem]">{card.title}</h3>
        </div>
      </div>
      <div className="flex h-[38%] min-h-0 flex-col p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="truncate font-mono text-xs text-primary">{card.source}</span>
          {!note && card.statusLabel && (
            <span className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${meta.color}`}>
              <Icon className={`h-3 w-3 ${item.indexingStage === 'visual_indexing' ? 'animate-spin' : ''}`} />
              {card.statusLabel}
            </span>
          )}
        </div>
        <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{card.preview}</p>
        {note && (card.imageCount > 0 || card.linkCount > 0) && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {card.linkCount > 0 && <span className="rounded-full border border-white/10 px-2.5 py-1">{card.linkCount} links</span>}
            {card.imageCount > 0 && <span className="rounded-full border border-white/10 px-2.5 py-1">{card.imageCount} images</span>}
          </div>
        )}
        {searchReason && (
          <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs leading-5 text-muted-foreground">
            Why it matched: {searchReason}
          </p>
        )}
        {searchActive && onSearchFeedback && (
          <SearchResultFeedback itemId={item.id} value={feedback} onVote={onSearchFeedback} />
        )}
        <div className="mt-auto flex items-center justify-end border-t border-white/10 pt-3 text-muted-foreground">
          <ExternalLink className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
      </div>
    </div>
  );
});
export {
  activityFromIndexingSummary,
  buildActivationState,
  createLibraryChatMessage,
  ImportHealthPanel,
  IndexingProgressCard,
  LibraryChatPanel,
  webSearchProgress,
  webStepStatusFromAi,
};
export default LibraryTab;
