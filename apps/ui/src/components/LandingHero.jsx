import { Suspense, lazy, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import GradualBlur from './GradualBlur';

const Antigravity = lazy(() => import('./Antigravity'));

gsap.registerPlugin(useGSAP);

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

function LandingHero({ opening = false, reducedMotion = false, onEnterApp, onExploreFeatures }) {
  const containerRef = useRef(null);
  const logoRef = useRef(null);
  const actionsRef = useRef(null);

  useGSAP(
    () => {
      if (opening || reducedMotion) return;

      const tl = gsap.timeline({ defaults: { ease: 'power4.out', duration: 1.2 } });

      tl.fromTo(logoRef.current, { y: 40, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, delay: 0.2 });
      tl.fromTo(actionsRef.current.children, { y: 20, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.1 }, '-=0.8');
    },
    { scope: containerRef, dependencies: [opening], revertOnUpdate: true }
  );

  return (
    <section ref={containerRef} className="landing-hero" aria-labelledby="landing-title">
      <div className="landing-background" aria-hidden="true">
        {!reducedMotion ? (
          <Suspense fallback={null}>
            <Antigravity
              count={300}
              magnetRadius={6}
              ringRadius={7}
              waveSpeed={0.4}
              waveAmplitude={1}
              particleSize={1.5}
              lerpSpeed={0.05}
              color="#ff6a00"
              autoAnimate
              particleVariance={1}
            />
          </Suspense>
        ) : null}
      </div>
      <h1 id="landing-title" className="sr-only">
        IScraper
      </h1>
      <img
        ref={logoRef}
        className="landing-logo"
        src="/logo.png"
        alt="IScraper logo"
        width="220"
        height="110"
        onError={(event) => {
          event.currentTarget.hidden = true;
        }}
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
