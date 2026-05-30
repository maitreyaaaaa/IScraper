import {
  Check,
  Download,
  downloadObsidianGraph,
  ExternalLink,
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  getKnowledgeGraph,
  RotateCcw,
  SkeletonBlock,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  ZoomIn,
  ZoomOut,
} from '../AppShared.jsx';
import { Banner } from '../components/Common.jsx';
const GRAPH_UI_NODE_LIMIT = 240;

const GRAPH_UI_LINK_LIMIT = 420;

function capGraphForUi(graph) {
  if (!graph?.nodes?.length) return graph;
  if (graph.nodes.length <= GRAPH_UI_NODE_LIMIT && (graph.links || []).length <= GRAPH_UI_LINK_LIMIT) return graph;
  const nodes = [...graph.nodes]
    .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))
    .slice(0, GRAPH_UI_NODE_LIMIT);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = (graph.links || [])
    .filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target))
    .slice(0, GRAPH_UI_LINK_LIMIT);
  return {
    ...graph,
    nodes,
    links,
    capped: true,
    originalNodeCount: graph.nodes.length,
    originalLinkCount: graph.links?.length || 0,
  };
}

function GraphTab({ onSelectItem }) {
  const [graph, setGraph] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [graphSidebarTab, setGraphSidebarTab] = useState('details');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const graphViewportRef = useRef(null);
  const dragRef = useRef(null);
  const touchGestureRef = useRef(null);
  const prompt = [
    'I have exported my IScraper Obsidian graph to this path:',
    '',
    'PASTE_EXPORTED_GRAPH_ZIP_PATH_HERE',
    '',
    'Please import it into my Obsidian vault. Unzip the export if needed, create or update notes, preserve wikilinks, keep the IScraper Items and IScraper Graph folders, and do not delete existing vault files unless I explicitly ask.',
  ].join('\n');

  useEffect(() => {
    let cancelled = false;
    getKnowledgeGraph()
      .then((body) => {
        if (!cancelled) setGraph(capGraphForUi(body.graph));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  const handleExport = async () => {
    setError('');
    try {
      const blob = await downloadObsidianGraph();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'iscraper-obsidian-graph.zip';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCopyPrompt = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const conceptNodes = graph?.nodes?.filter((node) => node.type !== 'item') || [];
  const itemNodes = graph?.nodes?.filter((node) => node.type === 'item') || [];
  const selectedNode = graph?.nodes?.find((node) => node.id === selectedNodeId) || null;
  const graphSidebarTabs = [
    { key: 'details', label: 'Details' },
    { key: 'explore', label: 'Explore' },
    { key: 'export', label: 'Export' },
  ];
  const selectedNeighborIds = useMemo(() => {
    if (!selectedNodeId || !graph) return new Set();
    return new Set(graph.links.flatMap((link) => (
      link.source === selectedNodeId ? [link.target] : link.target === selectedNodeId ? [link.source] : []
    )));
  }, [graph, selectedNodeId]);
  const selectedConnections = useMemo(() => {
    if (!selectedNodeId || !graph) return [];
    return graph.links
      .filter((link) => link.source === selectedNodeId || link.target === selectedNodeId)
      .map((link) => {
        const otherId = link.source === selectedNodeId ? link.target : link.source;
        return graph.nodes.find((node) => node.id === otherId);
      })
      .filter(Boolean)
      .slice(0, 18);
  }, [graph, selectedNodeId]);

  const clampZoom = (value) => Math.max(0.55, Math.min(2.6, Number(value.toFixed(2))));

  const changeZoom = (delta) => {
    setZoom((current) => {
      const nextZoom = clampZoom(current + delta);
      zoomRef.current = nextZoom;
      return nextZoom;
    });
  };

  const zoomGraphAt = useCallback((clientX, clientY, deltaY, viewport) => {
    if (!viewport || deltaY === 0) return;
    const rect = viewport.getBoundingClientRect();
    const pointerX = ((clientX - rect.left) / Math.max(rect.width, 1)) * 1000;
    const pointerY = ((clientY - rect.top) / Math.max(rect.height, 1)) * 620;
    const delta = Math.max(-1, Math.min(1, deltaY));
    const scaleFactor = delta > 0 ? 0.9 : 1.1;

    const currentZoom = zoomRef.current;
    const currentPan = panRef.current;
    const nextZoom = clampZoom(currentZoom * scaleFactor);
    if (nextZoom === currentZoom) return;

    const localX = (pointerX - 500 - currentPan.x) / currentZoom;
    const localY = (pointerY - 310 - currentPan.y) / currentZoom;
    const nextPan = {
      x: pointerX - 500 - localX * nextZoom,
      y: pointerY - 310 - localY * nextZoom,
    };
    zoomRef.current = nextZoom;
    panRef.current = nextPan;
    setZoom(nextZoom);
    setPan(nextPan);
  }, []);

  useEffect(() => {
    const viewport = graphViewportRef.current;
    if (!viewport) return undefined;
    const handleWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();
      zoomGraphAt(event.clientX, event.clientY, event.deltaY, viewport);
    };
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [zoomGraphAt]);

  const getTouchDistance = (touches) => {
    const first = touches[0];
    const second = touches[1];
    return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
  };

  const handleGraphTouchStart = (event) => {
    if (event.touches.length >= 2) {
      dragRef.current = null;
      touchGestureRef.current = {
        mode: 'pinch',
        distance: getTouchDistance(event.touches),
        zoom,
      };
      return;
    }

    const touch = event.touches[0];
    touchGestureRef.current = {
      mode: 'pan',
      x: touch.clientX,
      y: touch.clientY,
      pan,
    };
  };

  const handleGraphTouchMove = (event) => {
    if (!touchGestureRef.current) return;
    event.preventDefault();

    if (event.touches.length >= 2) {
      const gesture = touchGestureRef.current.mode === 'pinch'
        ? touchGestureRef.current
        : { mode: 'pinch', distance: getTouchDistance(event.touches), zoom };
      touchGestureRef.current = gesture;
      const nextDistance = getTouchDistance(event.touches);
      setZoom(clampZoom(gesture.zoom * (nextDistance / Math.max(gesture.distance, 1))));
      return;
    }

    if (event.touches.length === 1 && touchGestureRef.current.mode === 'pan') {
      const touch = event.touches[0];
      setPan({
        x: touchGestureRef.current.pan.x + touch.clientX - touchGestureRef.current.x,
        y: touchGestureRef.current.pan.y + touch.clientY - touchGestureRef.current.y,
      });
    }
  };

  const handleGraphTouchEnd = (event) => {
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      touchGestureRef.current = { mode: 'pan', x: touch.clientX, y: touch.clientY, pan };
      return;
    }
    touchGestureRef.current = null;
  };

  const resetView = () => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedNodeId(null);
  };

  return (
    <div className="mx-auto max-w-[1480px] space-y-6 px-4 py-8 sm:px-6 md:px-10 md:py-12">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">Knowledge graph</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-6xl">Your indexed saves as a knowledge map.</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
            Nodes are built from indexed titles, topics, tags, brands, people, and collections. Export it when you want Obsidian or an AI agent to work with your saved-library graph.
          </p>
        </div>
      </div>

      {error && <Banner type="error">{error}</Banner>}

      <div className="grid gap-3 sm:grid-cols-3">
        {busy ? (
          <>
            <SkeletonBlock className="h-24 rounded-xl" />
            <SkeletonBlock className="h-24 rounded-xl" />
            <SkeletonBlock className="h-24 rounded-xl" />
          </>
        ) : (
          <>
            <GraphStat label="Indexed saves" value={graph?.stats?.indexedItems ?? 0} />
            <GraphStat label="Concept nodes" value={graph?.stats?.conceptNodes ?? 0} />
            <GraphStat label="Graph links" value={graph?.stats?.links ?? 0} />
          </>
        )}
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div ref={graphViewportRef} className="relative h-[340px] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025] shadow-2xl shadow-black/25 sm:h-[380px] lg:h-[430px] xl:h-[460px]">
          <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-black/80 p-1 backdrop-blur">
            <button type="button" onClick={() => changeZoom(0.18)} className="rounded-full p-2 text-muted-foreground transition hover:bg-white/10 hover:text-primary" aria-label="Zoom in">
              <ZoomIn className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => changeZoom(-0.18)} className="rounded-full p-2 text-muted-foreground transition hover:bg-white/10 hover:text-primary" aria-label="Zoom out">
              <ZoomOut className="h-4 w-4" />
            </button>
            <button type="button" onClick={resetView} className="rounded-full p-2 text-muted-foreground transition hover:bg-white/10 hover:text-primary" aria-label="Reset graph view">
              <RotateCcw className="h-4 w-4" />
            </button>
            <span className="pr-3 font-mono text-[10px] text-muted-foreground">{Math.round(zoom * 100)}%</span>
          </div>
          <div className="absolute bottom-4 left-4 z-10 flex flex-wrap gap-2">
            {['item', 'topic', 'tag', 'brand', 'tool', 'person', 'collection'].map((type) => (
              <span key={type} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/70 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: graphNodeColor(type) }} />
                {type}
              </span>
            ))}
          </div>
          {busy ? (
            <div className="h-full p-5">
              <SkeletonBlock className="h-full rounded-xl" />
            </div>
          ) : !graph?.nodes?.length ? (
            <div className="grid h-full place-items-center px-8 text-center text-muted-foreground">
              No graph nodes yet. Add searchable saves first, then come back here.
            </div>
          ) : (
            <svg
              viewBox="0 0 1000 620"
              className="h-full w-full touch-none select-none cursor-grab active:cursor-grabbing"
              style={{ userSelect: 'none' }}
              onTouchStart={handleGraphTouchStart}
              onTouchMove={handleGraphTouchMove}
              onTouchEnd={handleGraphTouchEnd}
              onTouchCancel={() => {
                touchGestureRef.current = null;
              }}
              onPointerDown={(event) => {
                if (event.pointerType === 'touch') return;
                event.preventDefault();
                const nodeId = event.target.closest?.('[data-graph-node]')?.getAttribute('data-node-id') || '';
                event.currentTarget.setPointerCapture?.(event.pointerId);
                dragRef.current = {
                  x: event.clientX,
                  y: event.clientY,
                  pan: panRef.current,
                  nodeId,
                  moved: false,
                };
              }}
              onPointerMove={(event) => {
                if (event.pointerType === 'touch') return;
                if (!dragRef.current) return;
                const dx = event.clientX - dragRef.current.x;
                const dy = event.clientY - dragRef.current.y;
                if (Math.hypot(dx, dy) > 3) {
                  dragRef.current.moved = true;
                }
                const nextPan = { x: dragRef.current.pan.x + dx, y: dragRef.current.pan.y + dy };
                panRef.current = nextPan;
                setPan(nextPan);
              }}
              onPointerUp={(event) => {
                if (event.pointerType === 'touch') return;
                const gesture = dragRef.current;
                if (gesture) event.currentTarget.releasePointerCapture?.(event.pointerId);
                dragRef.current = null;
                if (gesture?.nodeId && !gesture.moved) {
                  setGraphSidebarTab('details');
                  setSelectedNodeId((current) => (current === gesture.nodeId ? null : gesture.nodeId));
                }
              }}
              onPointerLeave={() => {
                dragRef.current = null;
              }}
            >
              <rect width="1000" height="620" fill="transparent" />
              <g transform={`translate(${500 + pan.x} ${310 + pan.y}) scale(${zoom})`}>
              {graph.links.map((link) => {
                const source = layout.get(link.source);
                const target = layout.get(link.target);
                if (!source || !target) return null;
                const isActive = selectedNodeId && (link.source === selectedNodeId || link.target === selectedNodeId);
                return (
                  <line
                    key={link.id}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={isActive ? 'rgba(165,255,24,0.75)' : 'rgba(165,255,24,0.18)'}
                    strokeWidth={isActive ? 2 : 0.9}
                  />
                );
              })}
              {graph.nodes.map((node) => {
                const point = layout.get(node.id);
                if (!point) return null;
                const isItem = node.type === 'item';
                const isSelected = selectedNodeId === node.id;
                const isNeighbor = selectedNeighborIds.has(node.id);
                const dim = selectedNodeId && !isSelected && !isNeighbor;
                const radius = isItem ? 9 : Math.min(17, 5 + Math.sqrt(node.weight || 1) * 3);
                const showLabel = isSelected || isNeighbor || isItem || (node.weight || 0) >= 3;
                const color = graphNodeColor(node.type);
                return (
                  <g
                    key={node.id}
                    data-graph-node
                    data-node-id={node.id}
                    transform={`translate(${point.x} ${point.y})`}
                    className="cursor-pointer"
                    opacity={dim ? 0.22 : 1}
                  >
                    <circle r={radius + (isSelected ? 9 : 5)} fill={color} opacity="0.16" />
                    <circle r={radius} fill={color} stroke={isSelected ? '#ffffff' : 'rgba(0,0,0,0.55)'} strokeWidth={isSelected ? 2 : 1} />
                    {showLabel && (
                      <text y={radius + 16} textAnchor="middle" className="pointer-events-none select-none fill-white text-[10px] font-semibold">
                        {node.label.slice(0, 24)}
                      </text>
                    )}
                  </g>
                );
              })}
              </g>
            </svg>
          )}
        </div>

        <aside className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-black p-1">
            {graphSidebarTabs.map((sidebarTab) => (
              <button
                key={sidebarTab.key}
                type="button"
                onClick={() => setGraphSidebarTab(sidebarTab.key)}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  graphSidebarTab === sidebarTab.key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                }`}
              >
                {sidebarTab.label}
              </button>
            ))}
          </div>

          {graphSidebarTab === 'details' && (
            <div className="mt-5">
              <div className="flex items-start gap-3">
                <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: graphNodeColor(selectedNode?.type || 'item') }} />
                <div className="min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">
                    {selectedNode ? selectedNode.type : 'Selection'}
                  </div>
                  <h2 className="mt-1 line-clamp-2 font-display text-xl font-bold tracking-tight">
                    {selectedNode ? selectedNode.label : 'Click a node'}
                  </h2>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {selectedNode
                  ? selectedNode.type === 'item'
                    ? selectedNode.summary || 'No summary available.'
                    : `${selectedNode.itemCount || selectedConnections.length} linked saves or concepts.`
                  : 'Click any node to show details and nearby connections.'}
              </p>
              {selectedNode?.url && (
                <a href={selectedNode.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-xs text-primary">
                  Open original post <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {selectedNode?.type === 'item' && (
                <button type="button" onClick={() => onSelectItem(selectedNode.itemId)} className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
                  Open save detail
                </button>
              )}
              <div className="mt-5 border-t border-white/10 pt-4">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Connected nodes</div>
                {selectedConnections.length > 0 ? (
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {selectedConnections.map((node) => (
                      <button key={node.id} type="button" onClick={() => setSelectedNodeId(node.id)} className="flex w-full items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-left text-xs transition hover:border-primary">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: graphNodeColor(node.type) }} />
                        <span className="min-w-0 flex-1 truncate">{node.label}</span>
                        <span className="text-[10px] uppercase text-muted-foreground">{node.type}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-muted-foreground">
                    {selectedNode ? 'No nearby nodes found.' : 'Select a node to see its connections.'}
                  </p>
                )}
              </div>
            </div>
          )}

          {graphSidebarTab === 'explore' && (
            <div className="mt-5 space-y-5">
              <section>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Top concepts</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {conceptNodes.slice(0, 24).map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => {
                        setSelectedNodeId(node.id);
                        setGraphSidebarTab('details');
                      }}
                      className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary hover:text-foreground"
                    >
                      {node.label}
                    </button>
                  ))}
                  {!conceptNodes.length && <span className="text-sm text-muted-foreground">No concept nodes yet.</span>}
                </div>
              </section>

              <section className="border-t border-white/10 pt-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Indexed saves</div>
                <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
                  {itemNodes.slice(0, 40).map((node) => (
                    <button key={node.id} onClick={() => onSelectItem(node.itemId)} className="block w-full rounded-xl border border-white/10 p-3 text-left transition hover:border-primary">
                      <div className="line-clamp-1 text-sm font-semibold">{node.label}</div>
                      <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{node.summary}</div>
                    </button>
                  ))}
                  {!itemNodes.length && <span className="text-sm text-muted-foreground">No indexed saves yet.</span>}
                </div>
              </section>
            </div>
          )}

          {graphSidebarTab === 'export' && (
            <div className="mt-5 space-y-4">
              <div>
                <h2 className="font-display text-xl font-bold tracking-tight">Export for Obsidian or AI tools</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Download your graph, then use the prompt below with a local-file agent.
                </p>
              </div>
              <div className="grid gap-2">
                <button onClick={handleExport} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:scale-[1.01]">
                  <Download className="h-4 w-4" />
                  Export Obsidian graph
                </button>
                <button onClick={handleCopyPrompt} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-foreground transition hover:border-primary hover:text-primary">
                  <Check className="h-4 w-4" />
                  {copied ? 'Copied' : 'Copy AI prompt'}
                </button>
              </div>
              <textarea readOnly value={prompt} className="h-64 w-full resize-none rounded-xl border border-white/10 bg-black p-4 font-mono text-xs leading-5 text-muted-foreground outline-none" />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function GraphStat({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 p-4">
      <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-2 font-display text-3xl font-bold">{value}</div>
    </div>
  );
}

function graphNodeColor(type) {
  const colors = {
    item: '#f4f4ef',
    topic: '#a5ff18',
    tag: '#22d3ee',
    brand: '#60a5fa',
    tool: '#94a3b8',
    person: '#f472b6',
    collection: '#c084fc',
  };
  return colors[type] || '#a5ff18';
}

function layoutGraph(graph) {
  const points = new Map();
  const nodes = graph?.nodes || [];
  const links = graph?.links || [];
  if (!nodes.length) return points;

  const simulationNodes = nodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / nodes.length;
    const radius = node.type === 'item' ? 190 : 80 + ((index * 37) % 130);
    return {
      ...node,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });
  const simulationLinks = links.map((link) => ({ source: link.source, target: link.target }));
  const simulation = forceSimulation(simulationNodes)
    .force('link', forceLink(simulationLinks).id((node) => node.id).distance((link) => {
      const source = typeof link.source === 'object' ? link.source : null;
      const target = typeof link.target === 'object' ? link.target : null;
      return source?.type === 'item' || target?.type === 'item' ? 82 : 48;
    }).strength(0.28))
    .force('charge', forceManyBody().strength((node) => (node.type === 'item' ? -360 : -160)))
    .force('collide', forceCollide().radius((node) => (node.type === 'item' ? 34 : 20)).strength(0.9))
    .force('center', forceCenter(0, 0))
    .stop();

  for (let index = 0; index < 260; index += 1) simulation.tick();

  const xs = simulationNodes.map((node) => node.x);
  const ys = simulationNodes.map((node) => node.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(860 / Math.max(maxX - minX, 1), 500 / Math.max(maxY - minY, 1), 1.6);

  for (const node of simulationNodes) {
    points.set(node.id, {
      x: (node.x - (minX + maxX) / 2) * scale,
      y: (node.y - (minY + maxY) / 2) * scale,
    });
  }
  return points;
}
export { GraphTab };