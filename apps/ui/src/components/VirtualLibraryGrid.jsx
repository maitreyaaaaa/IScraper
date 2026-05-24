import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

function columnCountForWidth(width) {
  if (width >= 1536) return 4;
  if (width >= 1024) return 3;
  if (width >= 640) return 2;
  return 1;
}

function cardHeightForColumns(columns) {
  if (columns >= 3) return 430;
  if (columns === 2) return 410;
  return 380;
}

export default function VirtualLibraryGrid({
  items,
  scrollRef,
  renderItem,
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

  const columns = columnCountForWidth(width);
  const rowGap = 20;
  const cardHeight = cardHeightForColumns(columns);
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
    <div ref={parentRef} className="relative w-full" data-mounted-card-count={virtualRows.length * columns}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualRows.map((virtualRow) => (
          <div
            key={virtualRow.key}
            className="absolute left-0 top-0 grid w-full gap-5"
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
