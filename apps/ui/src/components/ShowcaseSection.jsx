import { useMemo, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowUpRight, BrainCircuit, FileSearch, Network, Sparkles } from 'lucide-react';

gsap.registerPlugin(useGSAP, ScrollTrigger);

const SHOWCASE_ITEMS = [
  {
    id: 'search-index',
    label: '01',
    eyebrow: 'Searchable saved post index',
    title: 'Find the exact saved post in seconds.',
    summary: 'Search by creator, tool, topic, or what the post was actually about.',
    detail:
      'Instead of scrolling through saved posts blindly, the result is a usable index. You can search by idea, workflow, caption language, or the specific tool mentioned in the post.',
    chips: ['Semantic search', 'Topic matches', 'Creator lookup'],
    previewTitle: 'Search result snapshot',
    previewLines: [
      'Query: "gemini prompt workflow for reels"',
      'Match: 12 saved posts with transcript + OCR overlap',
      'Top hit: "Prompt stack for short-form hooks"',
    ],
    statLabel: 'Recall time',
    statValue: '<10 sec',
    icon: FileSearch,
  },
  {
    id: 'obsidian-export',
    label: '02',
    eyebrow: 'Obsidian export',
    title: 'Push the good saves into notes you can reuse.',
    summary: 'Each useful post becomes a clean note instead of staying trapped in Instagram.',
    detail:
      'Harness can turn the saved post into note-ready output with title, summary, transcript, tags, and linked context so the material survives beyond the app.',
    chips: ['Vault ready', 'Linked notes', 'Clean metadata'],
    previewTitle: 'Vault note snapshot',
    previewLines: [
      '[[Instagram Saves]] / Prompting / Creator Systems',
      'Title: Reel about AI offer teardown',
      'Links: [[Hooks]], [[Offer Research]], [[Creator Swipe File]]',
    ],
    statLabel: 'Export shape',
    statValue: 'Structured',
    icon: BrainCircuit,
  },
  {
    id: 'graphify-workflows',
    label: '03',
    eyebrow: 'Graphify workflows',
    title: 'See how creators, ideas, and tactics connect.',
    summary: 'Good posts stop being isolated bookmarks and start forming patterns.',
    detail:
      'When you export into graph workflows, repeated themes become visible: which creators talk about the same tactic, which tools cluster together, and which ideas keep resurfacing.',
    chips: ['Topic clusters', 'Creator links', 'Idea graph'],
    previewTitle: 'Graph workflow snapshot',
    previewLines: [
      'Cluster: Short-form hooks -> offer teardown -> AI scripting',
      'Connected creators: 7',
      'Repeated tactic detected across 19 saves',
    ],
    statLabel: 'Pattern depth',
    statValue: 'Multi-hop',
    icon: Network,
  },
  {
    id: 'ai-enrichment',
    label: '04',
    eyebrow: 'AI enrichment output',
    title: 'Get usable summaries, tags, and next-step context.',
    summary: 'The output is already cleaned enough for prompting, planning, or repurposing.',
    detail:
      'Harness enriches each saved post with transcript, OCR text, summary, likely tools, topics, and why it matters, so you start with structured context instead of raw media.',
    chips: ['Transcript', 'OCR text', 'Why useful'],
    previewTitle: 'Enrichment snapshot',
    previewLines: [
      'Summary: creator explains a three-part ad hook structure',
      'Tags: hooks, direct response, creative testing',
      'Why useful: reusable framework for short-form script briefs',
    ],
    statLabel: 'Output layer',
    statValue: 'AI-ready',
    icon: Sparkles,
  },
];

function ShowcaseSection() {
  const [activeId, setActiveId] = useState(SHOWCASE_ITEMS[0].id);
  const sectionRef = useRef(null);
  const previewRef = useRef(null);
  const reduceMotionRef = useRef(false);
  const activeItem = useMemo(
    () => SHOWCASE_ITEMS.find((item) => item.id === activeId) || SHOWCASE_ITEMS[0],
    [activeId]
  );

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add(
        {
          reduceMotion: '(prefers-reduced-motion: reduce)',
        },
        (context) => {
          const { reduceMotion } = context.conditions;
          reduceMotionRef.current = reduceMotion;
          const section = sectionRef.current;

          if (!section) {
            return undefined;
          }

          const header = section.querySelector('.showcase-section-header');
          const shell = section.querySelector('.showcase-shell');
          const cards = gsap.utils.toArray(section.querySelectorAll('.showcase-card'));

          if (reduceMotion) {
            gsap.set([header, shell, cards], { clearProps: 'all', autoAlpha: 1 });
            return undefined;
          }

          gsap.set(header, { autoAlpha: 0, y: 24 });
          gsap.set(shell, { autoAlpha: 0, y: 32 });
          gsap.set(cards, { autoAlpha: 0, y: 24 });

          const timeline = gsap.timeline({
            scrollTrigger: {
              trigger: section,
              start: 'top 72%',
              once: true,
            },
          });

          timeline.to(header, {
            autoAlpha: 1,
            y: 0,
            duration: 0.7,
            ease: 'power2.out',
          });

          timeline.to(
            shell,
            {
              autoAlpha: 1,
              y: 0,
              duration: 0.8,
              ease: 'power2.out',
            },
            '-=0.42'
          );

          timeline.to(
            cards,
            {
              autoAlpha: 1,
              y: 0,
              duration: 0.48,
              ease: 'power2.out',
              stagger: 0.08,
            },
            '-=0.5'
          );

          return () => {
            timeline.kill();
          };
        }
      );

      return () => {
        mm.revert();
      };
    },
    { scope: sectionRef }
  );

  useGSAP(
    () => {
      const preview = previewRef.current;

      if (!preview || reduceMotionRef.current) {
        return undefined;
      }

      const parts = preview.querySelectorAll('.showcase-preview-topline, .showcase-preview h3, .showcase-preview-list, .showcase-preview-meta');
      const timeline = gsap.timeline();

      timeline.fromTo(
        preview,
        { boxShadow: '0 18px 54px rgba(0, 0, 0, 0.3)' },
        {
          boxShadow: '0 30px 90px rgba(0, 0, 0, 0.48)',
          duration: 0.3,
          ease: 'power2.out',
        }
      );

      timeline.fromTo(
        parts,
        { autoAlpha: 0, y: 10 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.28,
          ease: 'power2.out',
          stagger: 0.04,
          clearProps: 'opacity,visibility,transform',
        },
        0.04
      );

      return () => {
        timeline.kill();
      };
    },
    { scope: sectionRef, dependencies: [activeId] }
  );

  return (
    <section ref={sectionRef} className="showcase-section" aria-labelledby="showcase-section-title">
      <div className="showcase-section-header">
        <span className="showcase-section-label">Showcase</span>
        <h2 id="showcase-section-title">The outcome is usable memory, not just another import screen.</h2>
        <p>Open any result to inspect what Harness gives you after the raw Instagram save is processed.</p>
      </div>

      <div className="showcase-shell">
        <div className="showcase-card-grid" aria-label="Harness result showcase">
          {SHOWCASE_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeId;
            const detailId = `showcase-detail-${item.id}`;

            return (
              <article key={item.id} className={`showcase-card${isActive ? ' is-active' : ''}`}>
                <button
                  type="button"
                  className="showcase-card-trigger cursor-target"
                  onClick={() => setActiveId(item.id)}
                  onMouseEnter={() => setActiveId(item.id)}
                  onFocus={() => setActiveId(item.id)}
                  aria-expanded={isActive}
                  aria-controls={detailId}
                  style={{
                    all: 'unset',
                    display: 'grid',
                    gap: '10px',
                    width: '100%',
                    cursor: 'pointer',
                  }}
                >
                  <span className="showcase-card-topline">
                    <span>{item.label}</span>
                    <Icon size={17} />
                  </span>
                  <span className="showcase-card-eyebrow">{item.eyebrow}</span>
                  <strong>{item.title}</strong>
                  <span className="showcase-card-summary">{item.summary}</span>

                  <span className="showcase-chip-row" aria-hidden="true">
                    {item.chips.map((chip) => (
                      <span key={chip} className="showcase-chip">
                        {chip}
                      </span>
                    ))}
                  </span>
                </button>

                <div
                  id={detailId}
                  className={`showcase-card-detail${isActive ? ' is-open' : ''}`}
                  aria-hidden={!isActive}
                >
                  <span className="showcase-card-detail-inner">{item.detail}</span>
                  <span className="showcase-card-link">
                    Inspect result
                    <ArrowUpRight size={14} />
                  </span>
                </div>
              </article>
            );
          })}
        </div>

        <article ref={previewRef} className="showcase-preview" aria-labelledby="showcase-preview-title">
          <div className="showcase-preview-topline">
            <span>{activeItem.eyebrow}</span>
            <span>{activeItem.statLabel}</span>
          </div>
          <h3 id="showcase-preview-title">{activeItem.previewTitle}</h3>
          <ul className="showcase-preview-list">
            {activeItem.previewLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <div className="showcase-preview-meta">
            <div className="showcase-preview-stat">
              <span>Outcome</span>
              <strong>{activeItem.statValue}</strong>
            </div>
            <div className="showcase-preview-tags">
              {activeItem.chips.map((chip) => (
                <span key={chip} className="showcase-preview-tag">
                  {chip}
                </span>
              ))}
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

export default ShowcaseSection;
