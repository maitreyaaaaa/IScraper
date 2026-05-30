import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

export function LoadingSpinner({ className = 'h-4 w-4', label = 'Loading' }) {
  return (
    <Loader2
      aria-label={label}
      className={`${className} is-loading-spinner animate-spin`}
    />
  );
}

export function SkeletonBlock({ className = '' }) {
  return <div aria-hidden="true" className={`is-loading-surface ${className}`} />;
}

export function ProgressBar({ value = null, label = '', detail = '' }) {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;

  return (
    <div className="space-y-2" role="status" aria-live="polite">
      {(label || detail) && (
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{label}</span>
          {detail ? <span className="shrink-0">{detail}</span> : null}
        </div>
      )}
      <div className="is-progress-track">
        <div
          className={normalized === null ? 'is-progress-fill is-progress-fill-indeterminate' : 'is-progress-fill'}
          style={normalized === null ? undefined : { width: `${normalized}%` }}
        />
      </div>
    </div>
  );
}

export function SkeletonRows({ count = 4, compact = false }) {
  return (
    <div className="space-y-3" aria-label="Loading rows" role="status">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
          <div className="flex gap-3">
            {!compact && <SkeletonBlock className="h-16 w-16 shrink-0 rounded-lg" />}
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBlock className="h-3.5 w-3/4 rounded-full" />
              <SkeletonBlock className="h-3 w-full rounded-full" />
              <SkeletonBlock className="h-3 w-1/2 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonCardGrid({ count = 6, layout = 'grid-3' }) {
  const gridClass = layout === 'list'
    ? 'grid-cols-1'
    : layout === 'grid-2'
      ? 'sm:grid-cols-2'
      : layout === 'gallery'
        ? 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
        : 'sm:grid-cols-2 lg:grid-cols-3';

  return (
    <div className={`grid gap-5 ${gridClass}`} aria-label="Loading saves" role="status">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={`rounded-2xl border border-white/10 bg-white/[0.025] p-4 ${layout === 'list' ? 'min-h-40' : 'min-h-80'}`}>
          <SkeletonBlock className={layout === 'list' ? 'h-16 rounded-xl' : 'h-36 rounded-xl'} />
          <div className="mt-5 space-y-3">
            <SkeletonBlock className="h-3 w-24 rounded-full" />
            <SkeletonBlock className="h-5 w-4/5 rounded-full" />
            <SkeletonBlock className="h-5 w-3/5 rounded-full" />
            <SkeletonBlock className="h-3 w-full rounded-full" />
            <SkeletonBlock className="h-3 w-2/3 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function useAfterFirstPaint(delay = 120) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let firstFrame;
    let secondFrame;
    let timeoutId;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        timeoutId = window.setTimeout(() => setReady(true), delay);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(timeoutId);
    };
  }, [delay]);

  return ready;
}

export function DeferredSkeletonCardGrid({ count = 6, layout = 'grid-3', delay = 120, minHeight = '22rem' }) {
  const ready = useAfterFirstPaint(delay);

  if (!ready) {
    return <div aria-hidden="true" style={{ minHeight }} />;
  }

  return <SkeletonCardGrid count={count} layout={layout} />;
}

export function AppShellSkeleton() {
  const showBelowFold = useAfterFirstPaint(160);

  return (
    <div className="min-h-screen bg-black px-4 py-8 text-foreground sm:px-6 md:px-10" aria-label="Loading your saved library" role="status">
      <div className="mx-auto max-w-[1480px]">
        <div className="mx-auto max-w-[44rem] py-12 md:py-20">
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
            <SkeletonBlock className="h-10 rounded-xl" />
            <div className="mt-5 flex gap-3">
              <SkeletonBlock className="h-10 w-10 rounded-full" />
              <SkeletonBlock className="h-10 w-44 rounded-full" />
            </div>
          </div>
        </div>
        <div className="mb-5 flex items-center justify-between gap-4">
          <SkeletonBlock className="h-4 w-48 rounded-full" />
          <SkeletonBlock className="hidden h-10 w-64 rounded-full md:block" />
        </div>
        {showBelowFold ? <SkeletonCardGrid count={6} /> : <div aria-hidden="true" className="min-h-80" />}
      </div>
    </div>
  );
}
