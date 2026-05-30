import {
  Check,
  ChevronDown,
  Filter,
  filterLabel,
  STATE_FILTERS,
  TYPE_FILTERS,
  useEffect,
  useRef,
  useState,
} from '../AppShared.jsx';
function DashboardFilterSelect({ label, value, options, onChange, ariaLabel, icon: Icon }) {
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
    <div ref={selectRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`group flex min-w-36 items-center gap-2 rounded-full border bg-black px-3 py-2 text-left transition duration-200 ${
          open ? 'border-primary shadow-[0_0_0_4px_rgba(165,255,24,0.12)]' : 'border-white/10 hover:border-primary/70'
        }`}
      >
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />}
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{filterLabel(value)}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition duration-200 ${open ? 'rotate-180 text-primary' : 'group-hover:text-primary'}`} />
      </button>

      <div
        role="listbox"
        className={`absolute right-0 top-[calc(100%+0.5rem)] z-50 max-h-72 min-w-full overflow-y-auto rounded-2xl border border-primary/40 bg-black/95 p-2 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur transition duration-200 ${
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
              className={`flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-xs transition duration-150 ${
                selected ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-primary/10 hover:text-primary'
              }`}
            >
              <span>{filterLabel(option)}</span>
              {selected && <Check className="h-4 w-4" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LibraryFilterGroup({ label, value, options, onChange, active, onOpen, onClose }) {
  return (
    <section className="relative">
      <button
        type="button"
        aria-expanded={active}
        onClick={onOpen}
        onFocus={onOpen}
        onMouseEnter={onOpen}
        className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
          active
            ? 'border-primary/70 bg-white/[0.04] text-foreground'
            : 'border-white/10 text-muted-foreground hover:border-primary/60 hover:bg-white/[0.03] hover:text-foreground'
        }`}
      >
        <span className="min-w-0">
          <span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-primary/80">{label}</span>
          <span className="mt-1 block truncate text-xs font-semibold">{filterLabel(value)}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition ${active ? 'rotate-90 text-primary' : ''}`} />
      </button>

      <div
        className={`absolute right-[calc(100%+0.55rem)] top-0 z-[240] max-h-72 w-56 overflow-y-auto rounded-2xl border border-primary/30 bg-black/95 p-2 shadow-[0_24px_80px_rgba(0,0,0,0.75)] backdrop-blur transition duration-150 ${
          active ? 'pointer-events-auto translate-x-0 opacity-100' : 'pointer-events-none translate-x-2 opacity-0'
        }`}
      >
        <div className="mb-1 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-primary">{label}</div>
        <div className="grid gap-1">
          {options.map((option) => {
            const selected = option === value;
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onChange(option);
                  onClose();
                }}
                className={`flex min-h-9 items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs font-semibold transition ${
                  selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                }`}
              >
                <span className="truncate">{filterLabel(option)}</span>
                {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function LibraryFilterMenu({
  activeFilters,
  typeFilter,
  setTypeFilter,
  stateFilter,
  setStateFilter,
  platformFilter,
  setPlatformFilter,
  platforms,
  collectionFilter,
  setCollectionFilter,
  collections,
}) {
  const [open, setOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState('');
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (!menuRef.current?.contains(event.target)) {
        setActiveGroup('');
        setOpen(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setActiveGroup('');
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const filterGroups = [
    { id: 'type', label: 'Type', value: typeFilter, options: TYPE_FILTERS, onChange: setTypeFilter },
    { id: 'status', label: 'Status', value: stateFilter, options: STATE_FILTERS, onChange: setStateFilter },
    { id: 'platform', label: 'Platform', value: platformFilter, options: platforms, onChange: setPlatformFilter },
    { id: 'collection', label: 'Collection', value: collectionFilter, options: collections, onChange: setCollectionFilter },
  ];

  const clearFilters = () => {
    setTypeFilter('all');
    setStateFilter('all');
    setPlatformFilter('all');
    setCollectionFilter('all');
  };

  const toggleMenu = () => {
    if (open) setActiveGroup('');
    setOpen((current) => !current);
  };

  return (
    <div ref={menuRef} className="relative z-[120]">
      <button
        type="button"
        aria-label="Open library filters"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggleMenu}
        className={`relative grid h-11 w-11 place-items-center rounded-full border bg-black transition ${
          open || activeFilters > 0 ? 'border-primary text-primary' : 'border-white/10 text-muted-foreground hover:border-primary/70 hover:text-primary'
        }`}
      >
        <Filter className="h-4 w-4" />
        {activeFilters > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {activeFilters}
          </span>
        )}
      </button>

      <div
        role="dialog"
        aria-label="Library filters"
        className={`absolute right-0 top-[calc(100%+0.6rem)] z-[220] w-64 rounded-2xl border border-white/10 bg-black/95 p-3 shadow-[0_24px_80px_rgba(0,0,0,0.75)] backdrop-blur transition duration-200 ${
          open ? 'pointer-events-auto translate-y-0 scale-100 opacity-100' : 'pointer-events-none -translate-y-2 scale-[0.98] opacity-0'
        }`}
      >
        <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Filters</div>
          {activeFilters > 0 && (
            <button type="button" onClick={clearFilters} className="text-xs font-semibold text-muted-foreground transition hover:text-foreground">
              Clear
            </button>
          )}
        </div>
        <div className="grid gap-2">
          {filterGroups.map((group) => (
            <LibraryFilterGroup
              key={group.id}
              label={group.label}
              value={group.value}
              options={group.options}
              onChange={group.onChange}
              active={activeGroup === group.id}
              onOpen={() => setActiveGroup(group.id)}
              onClose={() => setActiveGroup('')}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
export { DashboardFilterSelect, LibraryFilterGroup, LibraryFilterMenu };