import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

function columnCountForWidth(width, layoutMode) {
  if (layoutMode === 'list') return 1;
  if (layoutMode === 'gallery') {
    if (width >= 1536) return 5;
    if (width >= 1180) return 4;
    if (width >= 820) return 3;
    if (width >= 560) return 2;
    return 1;
  }
  if (layoutMode === 'grid-2') return width >= 640 ? 2 : 1;
  if (width >= 1536) return 4;
  if (width >= 900) return 3;
  if (width >= 640) return 2;
  return 1;
}

function cardHeightForLayout(layoutMode, columns) {
  if (layoutMode === 'list') return 172;
  if (layoutMode === 'gallery') {
    if (columns >= 5) return 360;
    if (columns >= 3) return 380;
    if (columns === 2) return 400;
    return 420;
  }
  if (layoutMode === 'grid-2' && columns === 2) return 500;
  if (columns >= 3) return 430;
  if (columns === 2) return 410;
  return 380;
}

export default function VirtualLibraryGrid({
  items,
  scrollRef,
  renderItem,
  layoutMode = 'grid-3',
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}) {
  const parentRef = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const target = parentRef.current;
    if (!target) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(target);
    setWidth(target.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const columns = columnCountForWidth(width, layoutMode);
  const rowGap = layoutMode === 'list' ? 12 : 20;
  const cardHeight = cardHeightForLayout(layoutMode, columns);
  const rowHeight = cardHeight + rowGap;
  const rowCount = Math.ceil(items.length / columns);

  const rows = useMemo(() => {
    return Array.from({ length: rowCount }, (_, rowIndex) => items.slice(rowIndex * columns, rowIndex * columns + columns));
  }, [columns, items, rowCount]);

  // TanStack Virtual intentionally returns imperative functions; keep this component outside React Compiler memoization.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef?.current || null,
    estimateSize: () => rowHeight,
    overscan: 5,
  });
  const virtualRows = virtualizer.getVirtualItems();

  useEffect(() => {
    const lastRow = virtualRows[virtualRows.length - 1];
    if (!lastRow || !hasMore || loadingMore) return;
    if (lastRow.index >= rowCount - 4) onLoadMore?.();
  }, [hasMore, loadingMore, onLoadMore, rowCount, virtualRows]);

  return (
    <div ref={parentRef} className="relative w-full" data-mounted-card-count={virtualRows.length * columns} data-library-layout={layoutMode} data-library-columns={columns}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualRows.map((virtualRow) => (
          <div
            key={virtualRow.key}
            className={`absolute left-0 top-0 grid w-full ${layoutMode === 'list' ? 'gap-3' : 'gap-5'}`}
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              height: cardHeight,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {(rows[virtualRow.index] || []).map((item, columnIndex) => renderItem(item, virtualRow.index * columns + columnIndex, cardHeight))}
          </div>
        ))}
      </div>
      {loadingMore && (
        <div className="mt-4 flex justify-center text-sm text-muted-foreground">Loading more saves...</div>
      )}
    </div>
  );
}
