import { Folder, Loader2, Pencil, Pin, PinOff, RefreshCcw, Search, Trash2, X } from 'lucide-react';

function itemTitle(item) {
  return item?.sourceTitle || item?.title || item?.caption || 'Saved item';
}

function previewImage(item) {
  return item?.thumbnailUrl || item?.assets?.find((asset) => asset.assetType === 'image' && asset.url)?.url || '';
}

function sourceIcons(collection) {
  const platforms = [...new Set((collection.previewItems || []).map((item) => item.platform).filter(Boolean))];
  return platforms.slice(0, 3);
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

  return (
    <div className="mx-auto max-w-[1480px] px-4 pb-28 pt-8 sm:px-6 md:px-10 md:py-12">
      <div className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">Smart Collections</div>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">Auto-organized spaces</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            IScraper groups saved items by topics, platforms, imports, and indexed details. Rename, pin, hide, or remove items without changing your saved imports.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy || loading}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          Refresh
        </button>
      </div>

      {loading && !hasCollections ? (
        <div className="grid min-h-64 place-items-center rounded-xl border border-white/10 bg-white/[0.025] text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Loading Smart Collections...
          </span>
        </div>
      ) : !hasCollections ? (
        <div className="grid min-h-64 place-items-center rounded-xl border border-white/10 bg-white/[0.025] px-6 text-center">
          <div className="max-w-md">
            <Folder className="mx-auto h-9 w-9 text-primary" />
            <h2 className="mt-4 font-display text-2xl font-bold tracking-tight">Collections appear after you save or import items.</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Add at least two related searchable saves and IScraper will group them here automatically.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_28rem]">
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {collections.map((collection) => (
              <CollectionCard
                key={collection.id}
                collection={collection}
                selected={selectedCollection?.id === collection.id}
                onSelect={() => onSelectCollection(collection)}
                onUpdate={onUpdateCollection}
              />
            ))}
          </div>

          <aside className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
            {selectedCollection ? (
              <CollectionDetail
                collection={selectedCollection}
                items={items}
                loading={itemsLoading}
                busy={busy}
                onOpenItem={onOpenItem}
                onRemoveItem={onRemoveItem}
              />
            ) : (
              <div className="grid min-h-80 place-items-center text-center text-sm text-muted-foreground">
                <div>
                  <Search className="mx-auto h-8 w-8 text-primary" />
                  <p className="mt-3">Choose a collection to review its saves.</p>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function CollectionCard({ collection, selected, onSelect, onUpdate }) {
  const platforms = sourceIcons(collection);
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
      className={`group overflow-hidden rounded-xl border p-4 text-left transition ${
        selected ? 'border-primary bg-primary/10' : 'border-white/10 bg-white/[0.025] hover:border-primary/60 hover:bg-white/[0.045]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {collection.pinned && <Pin className="h-3.5 w-3.5 text-primary" />}
            <h2 className="truncate font-display text-xl font-bold tracking-tight">{collection.name}</h2>
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{collection.description || 'Grouped from your saved item details.'}</p>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-primary">
          {collection.itemCount}
        </span>
      </div>

      <div className="mt-4 grid h-24 grid-cols-3 gap-2">
        {(collection.previewItems || []).slice(0, 3).map((item) => (
          <div key={item.id} className="overflow-hidden rounded-lg border border-white/10 bg-black">
            {previewImage(item) ? (
              <img src={previewImage(item)} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="grid h-full place-items-center px-2 text-center text-[10px] leading-4 text-muted-foreground">
                {itemTitle(item)}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {platforms.length ? platforms.map((platform) => (
            <span key={platform} className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-muted-foreground">{platform}</span>
          )) : (
            <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-muted-foreground">Mixed</span>
          )}
        </div>
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
    </button>
  );
}

function CollectionDetail({ collection, items, loading, busy, onOpenItem, onRemoveItem }) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">{collection.itemCount} saves</div>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">{collection.name}</h2>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {loading ? (
          <div className="grid min-h-56 place-items-center text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Loading saves...
            </span>
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
              Remove from collection
            </button>
          </div>
        )) : (
          <p className="rounded-lg border border-white/10 bg-black/45 p-4 text-sm leading-6 text-muted-foreground">
            No saves are currently visible in this collection.
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
