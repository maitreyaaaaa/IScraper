import {
  Folder,
  FolderOpen,
  Hash,
  Layers,
  Pencil,
  Pin,
  PinOff,
  RefreshCcw,
  Sparkles,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import { LoadingSpinner, SkeletonCardGrid, SkeletonRows } from './LoadingStates';

function itemTitle(item) {
  return item?.sourceTitle || item?.title || item?.caption || 'Saved item';
}

function previewImage(item) {
  return item?.thumbnailUrl || item?.assets?.find((asset) => asset.assetType === 'image' && asset.url)?.url || '';
}

function sourceLabels(collection) {
  const platforms = [...new Set((collection.previewItems || []).map((item) => item.platform).filter(Boolean))];
  return platforms.slice(0, 3);
}

function folderGroupFor(collection) {
  const group = collection.folderGroup || collection.generationMetadata?.folderGroup || {};
  return {
    key: group.key || 'smart',
    name: group.name || 'Smart folders',
    rank: Number.isFinite(Number(group.rank)) ? Number(group.rank) : 90,
  };
}

function groupCollections(collections = []) {
  const groups = new Map();
  for (const collection of collections) {
    const group = folderGroupFor(collection);
    const current = groups.get(group.key) || { ...group, collections: [] };
    current.collections.push(collection);
    groups.set(group.key, current);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      collections: group.collections.sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
        return (b.itemCount || 0) - (a.itemCount || 0) || String(a.name).localeCompare(String(b.name));
      }),
    }))
    .sort((a, b) => a.rank - b.rank || String(a.name).localeCompare(String(b.name)));
}

function totalSaves(collections = []) {
  return collections.reduce((sum, collection) => sum + Number(collection.itemCount || 0), 0);
}

export default function SmartCollectionsView({
  collections,
  selectedCollection,
  items,
  loading,
  itemsLoading,
  busy,
  onRefresh,
  onSelectCollection,
  onUpdateCollection,
  onRemoveItem,
  onOpenItem,
}) {
  const hasCollections = collections.length > 0;
  const groups = groupCollections(collections);

  return (
    <div className="mx-auto max-w-[1480px] px-4 pb-28 pt-8 sm:px-6 md:px-10 md:py-12">
      <div className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Smart Collections</div>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-balance">Personal folders from your saves</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground text-pretty">
            IScraper builds folders only from patterns in your own library: sources, captures, saved folders, topics, tools, people, and brands.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy || loading}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {loading ? <LoadingSpinner /> : <RefreshCcw className="h-4 w-4" />}
          Refresh
        </button>
      </div>

      {loading && !hasCollections ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
          <SkeletonCardGrid count={6} layout="grid-3" />
        </div>
      ) : !hasCollections ? (
        <div className="grid min-h-64 place-items-center rounded-lg border border-white/10 bg-white/[0.025] px-6 text-center">
          <div className="max-w-md">
            <Folder className="mx-auto h-9 w-9 text-primary" />
            <h2 className="mt-4 font-display text-2xl font-bold tracking-tight text-balance">Collections appear after you save or import items.</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground text-pretty">
              Add at least two related searchable saves and IScraper will group them here automatically.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="space-y-7">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Folders" value={collections.length} />
              <Metric label="Groups" value={groups.length} />
              <Metric label="Matched saves" value={totalSaves(collections)} />
            </div>

            {groups.map((group) => (
              <section key={group.key} aria-labelledby={`smart-group-${group.key}`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 id={`smart-group-${group.key}`} className="flex items-center gap-2 font-display text-xl font-bold tracking-tight">
                      <GroupIcon groupKey={group.key} />
                      <span className="truncate">{group.name}</span>
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {group.collections.length} {group.collections.length === 1 ? 'folder' : 'folders'}
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {group.collections.map((collection) => (
                    <FolderTile
                      key={collection.id}
                      collection={collection}
                      selected={selectedCollection?.id === collection.id}
                      onSelect={() => onSelectCollection(collection)}
                      onUpdate={onUpdateCollection}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <aside className="xl:sticky xl:top-6 xl:self-start">
            <CollectionDetail
              collection={selectedCollection}
              items={items}
              loading={itemsLoading}
              busy={busy}
              onOpenItem={onOpenItem}
              onRemoveItem={onRemoveItem}
            />
          </aside>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function GroupIcon({ groupKey }) {
  const iconClass = 'h-4 w-4 shrink-0 text-primary';
  if (groupKey === 'source') return <Layers className={iconClass} />;
  if (groupKey === 'capture') return <FolderOpen className={iconClass} />;
  if (groupKey === 'tool' || groupKey === 'brand') return <Sparkles className={iconClass} />;
  if (groupKey === 'topic') return <Hash className={iconClass} />;
  return <Tags className={iconClass} />;
}

function FolderTile({ collection, selected, onSelect, onUpdate }) {
  const labels = sourceLabels(collection);
  const signals = (collection.matchSignals || collection.generationMetadata?.matchSignals || []).slice(0, 3);
  const rename = (event) => {
    event.stopPropagation();
    const nextName = window.prompt('Rename Smart Collection', collection.name);
    if (nextName && nextName.trim() && nextName.trim() !== collection.name) {
      onUpdate(collection.id, { name: nextName.trim() });
    }
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group flex min-h-[12rem] flex-col rounded-lg border p-4 text-left transition ${
        selected ? 'border-primary bg-primary/10' : 'border-white/10 bg-white/[0.025] hover:border-primary/60 hover:bg-white/[0.045]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/35">
            {selected ? <FolderOpen className="h-5 w-5 text-primary" /> : <Folder className="h-5 w-5 text-primary" />}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              {collection.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-primary" />}
              <h3 className="truncate font-display text-lg font-bold tracking-tight">{collection.name}</h3>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{collection.description || 'Grouped from your saved item details.'}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-primary tabular-nums">
          {collection.itemCount}
        </span>
      </div>

      <div className="mt-4 grid h-14 grid-cols-3 gap-2">
        {(collection.previewItems || []).slice(0, 3).map((item) => (
          <div key={item.id} className="overflow-hidden rounded-lg border border-white/10 bg-black">
            {previewImage(item) ? (
              <img src={previewImage(item)} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="grid h-full place-items-center px-2 text-center text-[10px] leading-4 text-muted-foreground">
                <span className="line-clamp-2">{itemTitle(item)}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-auto pt-4">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(signals.length ? signals : labels.length ? labels : ['Personalized']).map((label) => (
            <span key={label} className="max-w-full truncate rounded-full border border-white/10 px-2 py-1 text-[10px] text-muted-foreground">
              {label}
            </span>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-primary">{selected ? 'Open' : 'Open folder'}</span>
          <div className="flex items-center gap-1">
            <IconButton label="Rename" onClick={rename} icon={Pencil} />
            <IconButton
              label={collection.pinned ? 'Unpin' : 'Pin'}
              onClick={(event) => {
                event.stopPropagation();
                onUpdate(collection.id, { pinned: !collection.pinned });
              }}
              icon={collection.pinned ? PinOff : Pin}
            />
            <IconButton
              label="Hide"
              onClick={(event) => {
                event.stopPropagation();
                onUpdate(collection.id, { hidden: true });
              }}
              icon={X}
            />
          </div>
        </div>
      </div>
    </button>
  );
}

function CollectionDetail({ collection, items, loading, busy, onOpenItem, onRemoveItem }) {
  if (!collection) {
    return (
      <div className="grid min-h-80 place-items-center rounded-lg border border-white/10 bg-white/[0.025] p-6 text-center text-sm text-muted-foreground">
        <div>
          <FolderOpen className="mx-auto h-8 w-8 text-primary" />
          <p className="mt-3">Choose a smart folder to review its saves.</p>
        </div>
      </div>
    );
  }

  const signals = (collection.matchSignals || collection.generationMetadata?.matchSignals || []).slice(0, 5);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">{collection.itemCount} saves</div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-balance">{collection.name}</h2>
          {signals.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {signals.map((signal) => (
                <span key={signal} className="max-w-full truncate rounded-full border border-white/10 px-2 py-1 text-[10px] text-muted-foreground">
                  {signal}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {loading ? (
          <div className="min-h-56">
            <SkeletonRows count={4} />
          </div>
        ) : items.length ? items.map((item) => (
          <div key={item.id} className="rounded-lg border border-white/10 bg-black/45 p-3">
            <button type="button" onClick={() => onOpenItem(item)} className="flex w-full gap-3 text-left">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
                {previewImage(item) ? (
                  <img src={previewImage(item)} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="grid h-full place-items-center">
                    <Folder className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <h3 className="line-clamp-2 font-semibold">{itemTitle(item)}</h3>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.summary || item.sourceDescription || item.caption || item.platform}</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => onRemoveItem(collection.id, item.id)}
              disabled={busy}
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-white/5 hover:text-foreground disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove from folder
            </button>
          </div>
        )) : (
          <p className="rounded-lg border border-white/10 bg-black/45 p-4 text-sm leading-6 text-muted-foreground">
            No saves are currently visible in this folder.
          </p>
        )}
      </div>
    </div>
  );
}

function IconButton({ label, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
