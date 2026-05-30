import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  formatUsageDate,
  formatUsageNumber,
  LoadingSpinner,
  ProgressBar,
  ShieldCheck,
  SkeletonRows,
  Zap,
} from '../AppShared.jsx';
function LibraryCheckupTab({ care, loading, busy, onCheckLinks, onOpenItem, onRemind, onUpdateReminder }) {
  const cleanup = care?.cleanup || { duplicateGroups: [], brokenLinks: [], duplicateGroupCount: 0, brokenLinkCount: 0, checkedLinkCount: 0 };
  const resurface = care?.resurface || { dueReminders: [], oldItems: [], weeklyItems: [], randomItem: null };
  const oldSaves = resurface.oldItems || [];
  const weeklyItems = resurface.weeklyItems || [];
  const duplicateGroups = cleanup.duplicateGroups || [];
  const brokenLinks = cleanup.brokenLinks || [];
  const hasCleanResults = duplicateGroups.length > 0 || brokenLinks.length > 0;
  return (
    <div className="mx-auto max-w-[1320px] px-4 pb-28 pt-8 sm:px-6 md:px-10 md:py-12">
      <div className="mb-6 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
        <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="p-6 md:p-8">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <ShieldCheck className="h-3.5 w-3.5" />
              Library checkup
            </div>
            <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">Clean up and rediscover</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Find possible duplicates, links that may not open, and older saves worth revisiting. Nothing changes unless you choose what to do.
            </p>
          </div>
          <div className="border-t border-white/10 bg-black/30 p-6 md:p-8 lg:border-l lg:border-t-0">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <CheckupMetric icon={Copy} label="Possible duplicates" value={cleanup.duplicateGroupCount || 0} />
              <CheckupMetric icon={ExternalLink} label="Links that may not open" value={cleanup.brokenLinkCount || 0} />
              <CheckupMetric icon={Clock} label="Reminders ready" value={resurface.dueReminders?.length || 0} />
            </div>
            <button
              type="button"
              onClick={onCheckLinks}
              disabled={busy || loading}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {busy || loading ? <LoadingSpinner /> : <ShieldCheck className="h-4 w-4" />}
              {busy || loading ? 'Checking library...' : 'Check my library'}
            </button>
            {(busy || loading) && (
              <div className="mt-4">
                <ProgressBar value={null} label="Checking links" detail="Keeping your current results visible" />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        <section className="space-y-5">
          <SectionHeader icon={ShieldCheck} title="Clean up your saved links" copy="Review possible duplicates and original links that may not open." />
          {loading && !hasCleanResults ? (
            <SkeletonRows count={4} />
          ) : !hasCleanResults && (
            <EmptyCheckup icon={CheckCircle2} title="Your library looks clean for now." copy="Run a check whenever you want to look for possible duplicates or links that may not open." />
          )}
          {duplicateGroups.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Possible duplicates</h3>
              {duplicateGroups.slice(0, 8).map((group) => (
                <div key={group.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">{group.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{group.duplicateCount + 1} saves from {group.host}</div>
                    </div>
                    <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs text-amber-200">Review first</span>
                  </div>
                  <div className="mt-4 grid gap-2">
                    {group.items.map((item) => (
                      <CareItemRow key={item.id} item={item} reason={item.id === group.keepItemId ? 'Oldest saved copy' : 'Possible extra copy'} onOpen={onOpenItem} onRemind={onRemind} busy={busy} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {brokenLinks.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Links that may not open</h3>
              {brokenLinks.slice(0, 10).map((entry) => (
                <CareItemRow
                  key={entry.itemId}
                  item={entry.item}
                  reason={entry.httpStatus ? `Original returned ${entry.httpStatus}` : 'The original page may be unavailable'}
                  onOpen={onOpenItem}
                  onRemind={onRemind}
                  busy={busy}
                />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-5">
          <SectionHeader icon={Clock} title="Rediscover old saves" copy="Bring back useful things you saved but have not opened lately." />
          {loading && !resurface.dueReminders?.length && !oldSaves.length && !weeklyItems.length && !resurface.randomItem && (
            <SkeletonRows count={4} />
          )}
          {resurface.dueReminders?.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Reminders ready</h3>
              {resurface.dueReminders.map((entry) => (
                <CareItemRow
                  key={entry.id}
                  item={entry.item}
                  reason={`Reminder for ${formatUsageDate(entry.remindAt)}`}
                  onOpen={onOpenItem}
                  onRemind={onRemind}
                  busy={busy}
                  extraAction={(
                    <button type="button" onClick={() => onUpdateReminder(entry.id, 'done')} disabled={busy} className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-foreground hover:border-primary disabled:opacity-60">
                      Done
                    </button>
                  )}
                />
              ))}
            </div>
          )}
          {resurface.randomItem && (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
                <Zap className="h-4 w-4" /> Surprise me with an old save
              </div>
              <CareItemRow item={resurface.randomItem} reason="Picked for today" onOpen={onOpenItem} onRemind={onRemind} busy={busy} />
            </div>
          )}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Saved 3+ months ago</h3>
            {oldSaves.length ? oldSaves.map((item) => (
              <CareItemRow key={item.id} item={item} reason="Saved 3+ months ago" onOpen={onOpenItem} onRemind={onRemind} busy={busy} />
            )) : !loading ? <EmptyCheckup icon={Clock} title="No older saves yet." copy="This section fills in as your library grows." /> : null}
          </div>
          {weeklyItems.length > 0 && (
            <details className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-foreground">
                <span>Show me a few old saves each week</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </summary>
              <div className="mt-4 grid gap-2">
                {weeklyItems.map((item) => (
                  <CareItemRow key={item.id} item={item} reason="This week's rediscovery" onOpen={onOpenItem} onRemind={onRemind} busy={busy} />
                ))}
              </div>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}

function CheckupMetric({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/35 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="font-display text-2xl font-bold text-foreground">{formatUsageNumber(value)}</div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, copy }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-primary">
        <Icon className="h-3.5 w-3.5" /> {title}
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{copy}</p>
    </div>
  );
}

function EmptyCheckup({ icon: Icon, title, copy }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center">
      <Icon className="mx-auto h-5 w-5 text-primary" />
      <div className="mt-3 text-sm font-semibold text-foreground">{title}</div>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{copy}</p>
    </div>
  );
}

function CareItemRow({ item, reason, onOpen, onRemind, busy, extraAction = null }) {
  if (!item) return null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/35 p-3 sm:flex-row sm:items-center">
      <button type="button" onClick={() => onOpen?.(item)} className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm font-semibold text-foreground">{item.title || 'Untitled save'}</div>
        <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>{reason}</span>
          {item.collection ? <span>{item.collection}</span> : null}
          {item.createdAt ? <span>Saved {formatUsageDate(item.createdAt)}</span> : null}
        </div>
      </button>
      <div className="flex shrink-0 flex-wrap gap-2">
        {extraAction}
        <button type="button" onClick={() => onRemind?.(item, 'week')} disabled={busy} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-foreground hover:border-primary disabled:opacity-60">
          <Clock className="h-3 w-3" /> Remind me later
        </button>
        <button type="button" onClick={() => onOpen?.(item)} className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">
          Open <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
export { LibraryCheckupTab };