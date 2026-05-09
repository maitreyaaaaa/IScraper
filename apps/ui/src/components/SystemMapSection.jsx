import { useMemo, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight, BrainCircuit, DatabaseZap, Network, SearchCheck, Sparkles } from 'lucide-react';

gsap.registerPlugin(useGSAP, ScrollTrigger);

const SYSTEM_STEPS = [
  {
    id: 'saved-posts',
    label: '01',
    title: 'Saved posts',
    eyebrow: 'Raw input',
    summary: 'Bring in the saves you already collected.',
    detail:
      'IScraper starts with the raw export: post URLs, captions, and the media you actually cared enough to save. Nothing useful is assumed yet.',
    outputs: ['URLs', 'Captions', 'Media files'],
    icon: SearchCheck,
  },
  {
    id: 'analysis',
    label: '02',
    title: 'Analysis',
    eyebrow: 'Structured layer',
    summary: 'Each saved post gets turned into readable metadata.',
    detail:
      'The system extracts transcript, OCR text, summary, tags, tools, topics, and people so the post stops being an opaque bookmark.',
    outputs: ['Transcript', 'Summary', 'Tags'],
    icon: Sparkles,
  },
  {
    id: 'queryable-knowledge',
    label: '03',
    title: 'Queryable knowledge',
    eyebrow: 'Working memory',
    summary: 'Your saves become something you can actually search and reuse.',
    detail:
      'Once the analysis is stored cleanly, you can query by topic, creator, workflow, brand, or idea instead of scrolling through a dead list.',
    outputs: ['Search index', 'Linked notes', 'Reusable context'],
    icon: DatabaseZap,
  },
  {
    id: 'workflows',
    label: '04',
    title: 'Obsidian / Graphify / AI workflows',
    eyebrow: 'Downstream use',
    summary: 'The output feeds the tools where the work happens next.',
    detail:
      'That knowledge can move into Obsidian notes, Graphify connections, and AI workflows that cluster, remix, and build on what you saved.',
    outputs: ['Obsidian', 'Graphify', 'AI agents'],
    icon: Network,
  },
];

function SystemMapSection() {
  const [activeStepId, setActiveStepId] = useState(SYSTEM_STEPS[0].id);
  const sectionRef = useRef(null);
  const nodeRefs = useRef(new Map());
  const detailRef = useRef(null);
  const reduceMotionRef = useRef(false);
  const previousActiveStepIdRef = useRef(activeStepId);
  const activeStep = SYSTEM_STEPS.find((step) => step.id === activeStepId) || SYSTEM_STEPS[0];
  const detailOutputs = useMemo(() => activeStep.outputs, [activeStep.outputs]);

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

          const header = section.querySelector('.system-map-header');
          const shell = section.querySelector('.system-map-shell');
          const nodes = gsap.utils.toArray(section.querySelectorAll('.system-map-node'));
          const connectors = gsap.utils.toArray(section.querySelectorAll('.system-map-connector'));

          if (reduceMotion) {
            gsap.set([header, shell, nodes, connectors], { clearProps: 'all', autoAlpha: 1 });
            return undefined;
          }

          gsap.set(header, { autoAlpha: 0, y: 26 });
          gsap.set(shell, { autoAlpha: 0, y: 34 });
          gsap.set(nodes, { autoAlpha: 0, y: 26 });
          gsap.set(connectors, { scaleY: 0, transformOrigin: 'top center' });

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
            nodes,
            {
              autoAlpha: 1,
              y: 0,
              duration: 0.5,
              ease: 'power2.out',
              stagger: 0.08,
            },
            '-=0.5'
          );

          timeline.to(
            connectors,
            {
              scaleY: 1,
              duration: 0.42,
              ease: 'power2.out',
              stagger: 0.08,
            },
            '-=0.42'
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
      const currentNode = nodeRefs.current.get(activeStepId);
      const previousNode =
        previousActiveStepIdRef.current && previousActiveStepIdRef.current !== activeStepId
          ? nodeRefs.current.get(previousActiveStepIdRef.current)
          : null;
      const detail = detailRef.current;

      if (!currentNode || !detail || reduceMotionRef.current) {
        previousActiveStepIdRef.current = activeStepId;
        return undefined;
      }

      const detailParts = detail.querySelectorAll(
        '.system-map-detail-topline, .system-map-detail h3, .system-map-detail-copy, .system-map-detail-block'
      );

      if (previousNode) {
        gsap.fromTo(
          previousNode,
          { scale: 1 },
          {
            scale: 0.985,
            duration: 0.16,
            ease: 'power2.out',
            yoyo: true,
            repeat: 1,
            clearProps: 'scale',
          }
        );
      }

      const timeline = gsap.timeline();

      timeline.fromTo(
        currentNode,
        { scale: 0.985, y: 4 },
        {
          scale: 1,
          y: 0,
          duration: 0.34,
          ease: 'power2.out',
          clearProps: 'transform',
        }
      );

      timeline.fromTo(
        detail,
        { boxShadow: '0 18px 54px rgba(0, 0, 0, 0.3)' },
        {
          boxShadow: '0 30px 90px rgba(0, 0, 0, 0.44)',
          duration: 0.34,
          ease: 'power2.out',
        },
        0
      );

      timeline.fromTo(
        detailParts,
        { autoAlpha: 0, y: 12 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.32,
          ease: 'power2.out',
          stagger: 0.04,
          clearProps: 'opacity,visibility,transform',
        },
        0.04
      );

      previousActiveStepIdRef.current = activeStepId;

      return () => {
        timeline.kill();
      };
    },
    { scope: sectionRef, dependencies: [activeStepId] }
  );

  return (
    <section ref={sectionRef} className="system-map-section" aria-labelledby="system-map-title">
      <div className="system-map-header">
        <span className="system-map-label">System map</span>
        <h2 id="system-map-title">From saved posts to a system you can query, connect, and reuse.</h2>
        <p>Follow the chain. Hover or click any stage to see what changes at that point.</p>
      </div>

      <div className="system-map-shell">
        <ol className="system-map-canvas" aria-label="IScraper system flow">
          {SYSTEM_STEPS.map((step, index) => {
            const Icon = step.icon;
            const isActive = step.id === activeStepId;

            return (
              <li className="system-map-flow-item" key={step.id}>
                <button
                  type="button"
                  className={`system-map-node cursor-target${isActive ? ' is-active' : ''}`}
                  ref={(node) => {
                    if (node) {
                      nodeRefs.current.set(step.id, node);
                    } else {
                      nodeRefs.current.delete(step.id);
                    }
                  }}
                  onClick={() => setActiveStepId(step.id)}
                  onMouseEnter={() => setActiveStepId(step.id)}
                  onFocus={() => setActiveStepId(step.id)}
                  aria-pressed={isActive}
                >
                  <span className="system-map-node-index">{step.label}</span>
                  <span className="system-map-node-icon">
                    <Icon size={18} />
                  </span>
                  <span className="system-map-node-copy">
                    <span className="system-map-node-eyebrow">{step.eyebrow}</span>
                    <strong>{step.title}</strong>
                    <span>{step.summary}</span>
                  </span>
                </button>
                {index < SYSTEM_STEPS.length - 1 ? (
                  <div className="system-map-connector" aria-hidden="true">
                    <span />
                    <ArrowRight size={14} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>

        <article ref={detailRef} className="system-map-detail" aria-labelledby="system-map-detail-title">
          <div className="system-map-detail-topline">
            <span>{activeStep.eyebrow}</span>
            <BrainCircuit size={16} />
          </div>
          <h3 id="system-map-detail-title">{activeStep.title}</h3>
          <p className="system-map-detail-copy">{activeStep.detail}</p>

          <div className="system-map-detail-block">
            <span className="system-map-detail-label">Outputs at this stage</span>
            <div className="system-map-output-list">
              {detailOutputs.map((output) => (
                <span key={output} className="system-map-output-pill">
                  {output}
                </span>
              ))}
            </div>
          </div>

          <div className="system-map-detail-block system-map-detail-block-final">
            <span className="system-map-detail-label">End state</span>
            <p>
              Saved posts stop behaving like bookmarks and start behaving like usable knowledge inside your real
              workflow.
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}

export default SystemMapSection;
