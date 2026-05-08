# Landing Interaction System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current landing page into a fully black, premium-but-experimental interactive experience with a refined feature pills section, a GSAP-driven system map section, and an expandable showcase/export section.

**Architecture:** Keep `App.jsx` as composition glue and push landing interactions into focused section components. Use `GSAP`, `ScrollTrigger`, and `@gsap/react` for all meaningful motion, with `Lottie` limited to small embedded accents and CSS reserved for minor hover/focus polish.

**Tech Stack:** React 19, Vite, GSAP, ScrollTrigger, @gsap/react, Lottie React, Radix Popover, vanilla CSS

---

## File Structure

**Create:**
- `apps/ui/src/components/LandingHero.jsx` - extracted hero section with logo, buttons, and hero entrance GSAP timeline
- `apps/ui/src/components/SystemMapSection.jsx` - interactive system map for saved-post flow
- `apps/ui/src/components/ShowcaseSection.jsx` - expandable showcase/export panels
- `apps/ui/src/components/showcasePulseLottie.js` - small embedded animation data for showcase detail states if needed

**Modify:**
- `apps/ui/src/App.jsx` - compose landing sections and keep the intro / app handoff simple
- `apps/ui/src/App.css` - convert landing surface to a stable black system and add styles for new sections
- `apps/ui/src/components/FeaturePillsSection.jsx` - refine pills with stronger motion and magnetic hover behavior
- `apps/ui/package.json` - already includes GSAP/Lottie/popover dependencies; verify no further library sprawl
- `D:\Graph\Codex Projects\Harness.md` - record the landing system additions after implementation

**Verification:**
- `apps/ui` build and lint via `npm run build` and `npm run lint`

---

### Task 1: Extract and Stabilize the Landing Shell

**Files:**
- Create: `apps/ui/src/components/LandingHero.jsx`
- Modify: `apps/ui/src/App.jsx`
- Modify: `apps/ui/src/App.css`
- Test: `apps/ui` via `npm run build`

- [ ] **Step 1: Write the failing structural expectation**

Expected landing composition after this task:

```jsx
<>
  <TargetCursor spinDuration={5} hideDefaultCursor parallaxOn hoverDuration={0.4} />
  {showLanding ? (
    <>
      <LandingHero opening={showIntro} onEnterApp={() => setShowLanding(false)} />
      <FeaturePillsSection />
      <SystemMapSection />
      <ShowcaseSection />
    </>
  ) : (
    <MainApp />
  )}
  {showIntro ? <LogoIntro /> : null}
</>
```

- [ ] **Step 2: Run build to confirm the current code does not match this structure**

Run: `npm run build`
Expected: PASS build, but landing still composed directly inside `App.jsx` rather than via the extracted `LandingHero` and added sections.

- [ ] **Step 3: Extract the hero into `LandingHero.jsx`**

Create:

```jsx
import { Suspense, lazy, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import GradualBlur from './GradualBlur';

const Antigravity = lazy(() => import('./Antigravity'));

function PageBlur() {
  return (
    <GradualBlur
      target="parent"
      position="bottom"
      height="7rem"
      strength={3}
      divCount={6}
      curve="bezier"
      exponential={false}
      opacity={1}
    />
  );
}

function LandingHero({ opening = false, onEnterApp, onExploreFeatures }) {
  const containerRef = useRef(null);
  const logoRef = useRef(null);
  const actionsRef = useRef(null);

  useGSAP(
    () => {
      if (opening) return;
      const tl = gsap.timeline({ defaults: { ease: 'power4.out', duration: 1.2 } });
      tl.fromTo(logoRef.current, { y: 40, autoAlpha: 0, scale: 0.9 }, { y: 0, autoAlpha: 1, scale: 1, delay: 0.2 });
      tl.fromTo(actionsRef.current.children, { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, stagger: 0.1 }, '-=0.8');
    },
    { scope: containerRef, dependencies: [opening], revertOnUpdate: true }
  );

  return (
    <section ref={containerRef} className={opening ? 'landing-hero landing-hero-opening' : 'landing-hero'} aria-labelledby="landing-title">
      <div className="landing-background" aria-hidden="true">
        <Suspense fallback={null}>
          <Antigravity
            count={300}
            magnetRadius={6}
            ringRadius={7}
            waveSpeed={0.4}
            waveAmplitude={1}
            particleSize={1.5}
            lerpSpeed={0.05}
            color="#FF9FFC"
            autoAnimate
            particleVariance={1}
          />
        </Suspense>
      </div>
      <h1 id="landing-title" className="sr-only">Harness</h1>
      <img
        ref={logoRef}
        className="landing-logo"
        src="/logo.png"
        alt="Harness logo"
        width="220"
        height="110"
      />
      <div ref={actionsRef} className="landing-actions" aria-label="Landing actions">
        <button type="button" className="landing-button landing-button-primary cursor-target" onClick={onEnterApp}>
          Upload Files
        </button>
        <button type="button" className="landing-button landing-button-secondary cursor-target" onClick={onExploreFeatures}>
          Explore Features
        </button>
      </div>
      <PageBlur />
    </section>
  );
}

export default LandingHero;
```

- [ ] **Step 4: Recompose `App.jsx` around the extracted hero**

Modify `apps/ui/src/App.jsx` so the landing composition becomes:

```jsx
import LandingHero from './components/LandingHero';
import FeaturePillsSection from './components/FeaturePillsSection';
import SystemMapSection from './components/SystemMapSection';
import ShowcaseSection from './components/ShowcaseSection';

function App() {
  const [showIntro, setShowIntro] = useState(true);
  const [showLanding, setShowLanding] = useState(true);

  useEffect(() => {
    const introTimer = window.setTimeout(() => setShowIntro(false), 1900);
    return () => window.clearTimeout(introTimer);
  }, []);

  const handleScrollToFeatures = () => {
    document.getElementById('feature-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <TargetCursor spinDuration={5} hideDefaultCursor parallaxOn hoverDuration={0.4} />
      {showLanding ? (
        <>
          <LandingHero opening={showIntro} onEnterApp={() => setShowLanding(false)} onExploreFeatures={handleScrollToFeatures} />
          <FeaturePillsSection />
          <SystemMapSection />
          <ShowcaseSection />
        </>
      ) : (
        <MainApp />
      )}
      {showIntro ? <LogoIntro /> : null}
    </>
  );
}
```

- [ ] **Step 5: Normalize the landing shell CSS to a true black surface**

Modify the top landing rules in `apps/ui/src/App.css` to:

```css
.landing-page {
  background: #000;
  color: #fff;
  color-scheme: dark;
}

.landing-hero {
  position: relative;
  min-height: 100dvh;
  overflow: hidden;
  background: #000;
}

.feature-section,
.system-map-section,
.showcase-section {
  background: #000;
}
```

- [ ] **Step 6: Run build to verify the extracted shell works**

Run: `npm run build`
Expected: PASS with the landing split across `LandingHero`, `FeaturePillsSection`, `SystemMapSection`, and `ShowcaseSection`.

- [ ] **Step 7: Commit**

```bash
git add apps/ui/src/App.jsx apps/ui/src/App.css apps/ui/src/components/LandingHero.jsx
git commit -m "feat: extract landing hero and stabilize landing shell"
```

### Task 2: Refine Feature Pills Into the Locked Visual System

**Files:**
- Modify: `apps/ui/src/components/FeaturePillsSection.jsx`
- Modify: `apps/ui/src/App.css`
- Test: `apps/ui` via `npm run lint`

- [ ] **Step 1: Write the failing interaction expectation**

Expected behavior after this task:

```jsx
<button
  type="button"
  className={`feature-pill feature-pill-${feature.side} cursor-target`}
  data-side={feature.side}
  onMouseMove={handleMagneticMove}
  onMouseLeave={handleMagneticReset}
>
```

- [ ] **Step 2: Run lint to confirm the current pills do not have magnetic hover logic**

Run: `npm run lint`
Expected: PASS lint, but no magnetic hover or stronger GSAP interaction exists yet.

- [ ] **Step 3: Add scoped magnetic hover behavior to the pills**

Extend `FeaturePillsSection.jsx` with:

```jsx
const handleMagneticMove = (event) => {
  const element = event.currentTarget;
  const rect = element.getBoundingClientRect();
  const offsetX = ((event.clientX - rect.left) / rect.width - 0.5) * 18;
  const offsetY = ((event.clientY - rect.top) / rect.height - 0.5) * 14;
  gsap.to(element, {
    x: offsetX,
    y: offsetY,
    duration: 0.35,
    ease: 'power3.out',
    overwrite: 'auto',
  });
};

const handleMagneticReset = (event) => {
  gsap.to(event.currentTarget, {
    x: 0,
    y: 0,
    duration: 0.45,
    ease: 'power3.out',
    overwrite: 'auto',
  });
};
```

- [ ] **Step 4: Strengthen the popover and pills styling**

Add or tighten these CSS rules:

```css
.feature-pill {
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
  will-change: transform, opacity;
}

.feature-pill:hover {
  border-color: rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.11);
}

.feature-popover {
  background: rgba(10, 10, 12, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.14);
}
```

- [ ] **Step 5: Run lint to verify the refined pill section is clean**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/ui/src/components/FeaturePillsSection.jsx apps/ui/src/App.css
git commit -m "feat: refine feature pill interactions"
```

### Task 3: Build the Interactive System Map Section

**Files:**
- Create: `apps/ui/src/components/SystemMapSection.jsx`
- Modify: `apps/ui/src/App.css`
- Test: `apps/ui` via `npm run build`

- [ ] **Step 1: Write the failing section expectation**

Expected section structure:

```jsx
<section className="system-map-section" id="system-map-section" aria-labelledby="system-map-title">
  <div className="system-map-shell">
    <header className="system-map-header">...</header>
    <div className="system-map-canvas">
      {STEPS.map((step) => (
        <button key={step.id} className="system-node cursor-target">
          ...
        </button>
      ))}
    </div>
  </div>
</section>
```

- [ ] **Step 2: Run build to confirm the section does not exist yet**

Run: `npm run build`
Expected: PASS build, but no `SystemMapSection` component or render path exists yet.

- [ ] **Step 3: Create `SystemMapSection.jsx` with node data and active state**

Create:

```jsx
import { useState, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight, BrainCircuit, DatabaseZap, Network, NotebookPen, Sparkles } from 'lucide-react';

gsap.registerPlugin(useGSAP, ScrollTrigger);

const STEPS = [
  { id: 'saved', title: 'Saved posts', detail: 'Raw Instagram saves enter the system.', icon: NotebookPen },
  { id: 'analysis', title: 'Analysis', detail: 'Captions, media signals, and AI enrichment are extracted.', icon: Sparkles },
  { id: 'search', title: 'Queryable knowledge', detail: 'Posts become searchable by meaning, topic, and creator.', icon: DatabaseZap },
  { id: 'obsidian', title: 'Obsidian export', detail: 'Structured notes can flow into your vault.', icon: BrainCircuit },
  { id: 'graphify', title: 'Graphify workflows', detail: 'Relationships and themes can be mapped into a graph.', icon: Network },
];

function SystemMapSection() {
  const sectionRef = useRef(null);
  const [activeId, setActiveId] = useState('analysis');

  useGSAP(() => {
    const nodes = gsap.utils.toArray('.system-node');
    gsap.set(nodes, { autoAlpha: 0, y: 40, scale: 0.96 });
    gsap.to(nodes, {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      duration: 0.9,
      stagger: 0.1,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: sectionRef.current,
        start: 'top 72%',
        once: true,
      },
    });
  }, { scope: sectionRef });

  const activeStep = STEPS.find((step) => step.id === activeId) || STEPS[1];

  return (
    <section ref={sectionRef} className="system-map-section" id="system-map-section" aria-labelledby="system-map-title">
      <div className="system-map-shell">
        <header className="system-map-header">
          <span className="system-map-label">Flow</span>
          <h2 id="system-map-title">See how a saved post turns into something usable.</h2>
          <p>Move through the pipeline and inspect how the product converts a saved post into structured output.</p>
        </header>
        <div className="system-map-canvas">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <button
                key={step.id}
                type="button"
                className={step.id === activeId ? 'system-node system-node-active cursor-target' : 'system-node cursor-target'}
                onClick={() => setActiveId(step.id)}
              >
                <span className="system-node-icon"><Icon size={20} /></span>
                <span className="system-node-copy">
                  <strong>{step.title}</strong>
                  <span>{step.detail}</span>
                </span>
                {index < STEPS.length - 1 ? <ArrowRight size={18} className="system-node-arrow" /> : null}
              </button>
            );
          })}
        </div>
        <div className="system-map-detail">
          <strong>{activeStep.title}</strong>
          <p>{activeStep.detail}</p>
        </div>
      </div>
    </section>
  );
}

export default SystemMapSection;
```

- [ ] **Step 4: Add the matching black-system CSS**

Add:

```css
.system-map-section {
  position: relative;
  padding: 96px 24px 120px;
  background: #000;
}

.system-map-shell {
  width: min(1160px, 100%);
  margin: 0 auto;
}

.system-map-canvas {
  display: grid;
  gap: 18px;
  margin-top: 40px;
}

.system-node {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 18px;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 28px;
  padding: 22px 24px;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}

.system-node-active {
  border-color: rgba(255, 159, 252, 0.45);
  background: rgba(255, 159, 252, 0.09);
}
```

- [ ] **Step 5: Run build to verify the system map compiles**

Run: `npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/ui/src/components/SystemMapSection.jsx apps/ui/src/App.css apps/ui/src/App.jsx
git commit -m "feat: add interactive system map section"
```

### Task 4: Build the Showcase / Export Section

**Files:**
- Create: `apps/ui/src/components/ShowcaseSection.jsx`
- Modify: `apps/ui/src/App.css`
- Test: `apps/ui` via `npm run build`

- [ ] **Step 1: Write the failing section expectation**

Expected section structure:

```jsx
<section className="showcase-section" id="showcase-section" aria-labelledby="showcase-title">
  <div className="showcase-grid">
    {SHOWCASES.map((item) => (
      <article key={item.id} className={item.id === activeId ? 'showcase-card showcase-card-active' : 'showcase-card'}>
        ...
      </article>
    ))}
  </div>
</section>
```

- [ ] **Step 2: Run build to confirm the section does not exist yet**

Run: `npm run build`
Expected: PASS build, but no showcase/export section is present.

- [ ] **Step 3: Create `ShowcaseSection.jsx` with expandable panels**

Create:

```jsx
import { useState, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowUpRight, Brain, Database, Network, Sparkles } from 'lucide-react';

gsap.registerPlugin(useGSAP, ScrollTrigger);

const SHOWCASES = [
  { id: 'search', label: 'Search index', title: 'Search your saved posts like a knowledge base.', body: 'Move beyond folder memory. Query by topic, creator, and meaning.', icon: Database },
  { id: 'obsidian', label: 'Obsidian export', title: 'Push cleaned knowledge into your vault.', body: 'Turn saved posts into durable notes, not disposable bookmarks.', icon: Brain },
  { id: 'graphify', label: 'Graphify export', title: 'Map ideas, creators, and themes as connections.', body: 'Structure your saved content for graph-driven exploration and workflows.', icon: Network },
  { id: 'ai', label: 'AI enrichment', title: 'Use AI to cluster, summarize, and connect what matters.', body: 'Make the archive useful for recall, synthesis, and execution.', icon: Sparkles },
];

function ShowcaseSection() {
  const sectionRef = useRef(null);
  const [activeId, setActiveId] = useState('search');

  useGSAP(() => {
    const cards = gsap.utils.toArray('.showcase-card');
    gsap.set(cards, { autoAlpha: 0, y: 36 });
    gsap.to(cards, {
      autoAlpha: 1,
      y: 0,
      duration: 0.85,
      stagger: 0.12,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: sectionRef.current,
        start: 'top 78%',
        once: true,
      },
    });
  }, { scope: sectionRef });

  return (
    <section ref={sectionRef} className="showcase-section" id="showcase-section" aria-labelledby="showcase-title">
      <div className="showcase-shell">
        <header className="showcase-header">
          <span className="showcase-label">Outputs</span>
          <h2 id="showcase-title">The end result should feel useful, not merely impressive.</h2>
        </header>
        <div className="showcase-grid">
          {SHOWCASES.map((item) => {
            const Icon = item.icon;
            const active = item.id === activeId;
            return (
              <article key={item.id} className={active ? 'showcase-card showcase-card-active' : 'showcase-card'}>
                <button type="button" className="showcase-card-trigger cursor-target" onClick={() => setActiveId(item.id)}>
                  <span className="showcase-card-label">{item.label}</span>
                  <span className="showcase-card-head">
                    <span className="showcase-card-icon"><Icon size={22} /></span>
                    <strong>{item.title}</strong>
                  </span>
                  <span className="showcase-card-arrow"><ArrowUpRight size={18} /></span>
                </button>
                {active ? <p className="showcase-card-body">{item.body}</p> : null}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default ShowcaseSection;
```

- [ ] **Step 4: Add showcase CSS**

Add:

```css
.showcase-section {
  padding: 96px 24px 140px;
  background: #000;
}

.showcase-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.showcase-card {
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 30px;
  padding: 24px;
  background: rgba(255, 255, 255, 0.04);
}

.showcase-card-active {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.22);
}

.showcase-card-trigger {
  width: 100%;
  background: transparent;
  border: 0;
  color: inherit;
  text-align: left;
}
```

- [ ] **Step 5: Run build to verify the showcase section compiles**

Run: `npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/ui/src/components/ShowcaseSection.jsx apps/ui/src/App.css apps/ui/src/App.jsx
git commit -m "feat: add showcase export section"
```

### Task 5: Final Black-Canvas Polish, Responsive Checks, and Docs

**Files:**
- Modify: `apps/ui/src/App.css`
- Modify: `D:\Graph\Codex Projects\Harness.md`
- Test: `apps/ui` via `npm run build`
- Test: `apps/ui` via `npm run lint`

- [ ] **Step 1: Tighten the final background and responsive rules**

Make sure these responsive guards exist:

```css
@media (max-width: 760px) {
  .system-node,
  .showcase-card {
    border-radius: 24px;
  }

  .showcase-grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .feature-pill,
  .system-node,
  .showcase-card {
    transition: none;
  }
}
```

- [ ] **Step 2: Update project memory**

Append to `D:\Graph\Codex Projects\Harness.md`:

```md
- Expanded the landing system on 2026-05-07 with a fully black visual shell, interactive system map section, and showcase/export section using GSAP-first motion.
```

- [ ] **Step 3: Run build for final verification**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Run lint for final verification**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 5: Manual verification checklist**

Check:

```text
1. Landing hero remains black with no gray or tinted section background.
2. Feature pills alternate correctly on desktop and stack cleanly on mobile.
3. Clicking a feature pill opens the popover and the Lottie accent still renders.
4. System map nodes reveal on scroll and active state changes on click.
5. Showcase cards expand cleanly and remain readable on mobile.
6. Upload Files still transitions from landing to MainApp.
```

- [ ] **Step 6: Commit**

```bash
git add apps/ui/src/App.css "D:\\Graph\\Codex Projects\\Harness.md"
git commit -m "chore: polish landing interaction system"
```
