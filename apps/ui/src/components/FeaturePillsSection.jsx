import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lottie from 'lottie-react';
import * as Popover from '@radix-ui/react-popover';
import { ArrowUpRight, BrainCircuit, DatabaseZap, FileSearch, Network, Sparkles } from 'lucide-react';
import featurePulseLottie from './featurePulseLottie';

gsap.registerPlugin(useGSAP, ScrollTrigger);

const FEATURES = [
  {
    title: 'Analyze saved posts',
    detail: 'Turn raw Instagram exports into structured entries with captions, media context, and AI-ready metadata.',
    side: 'left',
    icon: FileSearch,
    accent: 'Inspect exports',
  },
  {
    title: 'Make your posts queryable',
    detail: 'Search your saved collection by topic, creator, caption, or what the video is actually about.',
    side: 'right',
    icon: DatabaseZap,
    accent: 'Search semantically',
  },
  {
    title: 'Export to Obsidian',
    detail: 'Push cleaned notes into your vault so saved posts become usable knowledge instead of buried bookmarks.',
    side: 'left',
    icon: BrainCircuit,
    accent: 'Knowledge ready',
  },
  {
    title: 'Export to Graphify',
    detail: 'Send your saved content into graph-based workflows so ideas, creators, and topics connect naturally.',
    side: 'right',
    icon: Network,
    accent: 'Connect everything',
  },
  {
    title: 'Integrate your posts with AI',
    detail: 'Use models to tag, summarize, cluster, and enrich your saved posts into something you can actually work with.',
    side: 'left',
    icon: Sparkles,
    accent: 'AI enrichment',
  },
];

function FeaturePill({ feature, index, reducedMotion = false }) {
  const Icon = feature.icon;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`feature-pill feature-pill-${feature.side} cursor-target`}
          data-side={feature.side}
          aria-label={`${feature.title}. Click for more info.`}
          onMouseMove={feature.onMouseMove}
          onMouseLeave={feature.onMouseLeave}
        >
          <span className="feature-pill-kicker">{feature.accent}</span>
          <span className="feature-pill-main">
            <span className="feature-pill-icon">
              <Icon size={22} />
            </span>
            <span className="feature-pill-title">{feature.title}</span>
          </span>
          <span className="feature-pill-index">0{index + 1}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="feature-popover" sideOffset={18} collisionPadding={20}>
          <div className="feature-popover-media" aria-hidden="true">
            {reducedMotion ? null : <Lottie animationData={featurePulseLottie} loop />}
          </div>
          <div className="feature-popover-copy">
            <span className="feature-popover-tag">{feature.accent}</span>
            <strong>{feature.title}</strong>
            <p>{feature.detail}</p>
          </div>
          <div className="feature-popover-footer">
            <span>Click outside to close</span>
            <ArrowUpRight size={16} />
          </div>
          <Popover.Arrow className="feature-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function FeaturePillsSection({ reducedMotion = false }) {
  const sectionRef = useRef(null);
  const reduceMotionRef = useRef(false);
  const magneticHoverEnabledRef = useRef(false);
  const handleMouseMoveRef = useRef(() => {});
  const handleMouseLeaveRef = useRef(() => {});
  const quickSettersRef = useRef(new WeakMap());

  useGSAP(
    (_, contextSafe) => {
      const mm = gsap.matchMedia();

      const getQuickSetters = (pill) => {
        let quickSetters = quickSettersRef.current.get(pill);

        if (!quickSetters) {
          quickSetters = {
            x: gsap.quickTo(pill, 'x', { duration: 0.22, ease: 'power2.out' }),
            y: gsap.quickTo(pill, 'y', { duration: 0.22, ease: 'power2.out' }),
          };
          quickSettersRef.current.set(pill, quickSetters);
        }

        return quickSetters;
      };

      handleMouseMoveRef.current = contextSafe((event) => {
        if (reduceMotionRef.current || !magneticHoverEnabledRef.current) {
          return;
        }

        const pill = event.currentTarget;
        const bounds = pill.getBoundingClientRect();
        const offsetX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 22;
        const offsetY = ((event.clientY - bounds.top) / bounds.height - 0.5) * 18;
        const quickSetters = getQuickSetters(pill);

        quickSetters.x(offsetX);
        quickSetters.y(offsetY);
      });

      handleMouseLeaveRef.current = contextSafe((event) => {
        const pill = event.currentTarget;

        if (reduceMotionRef.current || !magneticHoverEnabledRef.current) {
          gsap.set(pill, { x: 0, y: 0 });
          return;
        }

        const quickSetters = getQuickSetters(pill);
        quickSetters.x(0);
        quickSetters.y(0);
      });

      mm.add(
        {
          desktopLayout: '(min-width: 761px)',
          hoverPointer: '(hover: hover) and (pointer: fine)',
          reduceMotion: '(prefers-reduced-motion: reduce)',
        },
        (context) => {
          const { desktopLayout, hoverPointer, reduceMotion } = context.conditions;
          reduceMotionRef.current = reduceMotion;
          magneticHoverEnabledRef.current = !reduceMotion && hoverPointer;
          const pills = gsap.utils.toArray('.feature-pill');

          pills.forEach((pill) => {
            const side = pill.dataset.side === 'right' ? 1 : -1;
            gsap.set(pill, {
              x: reduceMotion ? 0 : desktopLayout ? side * 120 : 0,
              y: reduceMotion ? 0 : desktopLayout ? 0 : 36,
              autoAlpha: reduceMotion ? 1 : 0,
              scale: reduceMotion ? 1 : 0.96,
            });

            gsap.to(pill, {
              x: 0,
              y: 0,
              autoAlpha: 1,
              scale: 1,
              duration: reduceMotion ? 0.01 : 1,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: pill,
                start: 'top 84%',
                once: true,
              },
            });
          });
        }
      );

      ScrollTrigger.refresh();

      return () => {
        reduceMotionRef.current = false;
        magneticHoverEnabledRef.current = false;
        quickSettersRef.current = new WeakMap();
        mm.revert();
      };
    },
    { scope: sectionRef }
  );

  return (
    <section ref={sectionRef} className="feature-section" id="feature-section" aria-labelledby="feature-section-title">
      <div className="feature-section-header">
        <span className="feature-section-label">What it does</span>
        <h2 id="feature-section-title">Your saved posts become a working system, not a dead list.</h2>
        <p>Scroll through the core capabilities. Click any pill to see what that feature actually unlocks.</p>
      </div>
      <div className="feature-pill-list">
        {FEATURES.map((feature, index) => (
          <FeaturePill
            key={feature.title}
            reducedMotion={reducedMotion}
            feature={{
              ...feature,
              onMouseMove: (event) => handleMouseMoveRef.current(event),
              onMouseLeave: (event) => handleMouseLeaveRef.current(event),
            }}
            index={index}
          />
        ))}
      </div>
    </section>
  );
}

export default FeaturePillsSection;
