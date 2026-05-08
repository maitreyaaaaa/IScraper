# Design Spec: Landing Interaction System
**Date:** 2026-05-07
**Status:** Draft

## 1. Overview
This spec defines the next visual direction for the `Harness` landing experience.

The site should feel like a premium design portfolio with experimental lab energy. The goal is not to add motion everywhere. The goal is to make the site feel intentional, interactive, and visually alive while staying readable and usable.

The motion stack is:
- `GSAP` as the primary animation system
- `ScrollTrigger` for scroll-linked reveals and section choreography
- `@gsap/react` for React-safe setup and cleanup
- `Lottie` only for small embedded motion details
- native CSS transitions for tiny hover/focus polish

`Framer Motion` is explicitly out of scope for this landing system because it would overlap with GSAP and add unnecessary complexity.

## 2. Visual Direction
The entire landing surface should sit on a true black background.

The visual language should combine:
- premium editorial restraint
- experimental interaction
- large clean shapes
- bright accents used sparingly
- motion that reveals hierarchy instead of distracting from it

Required visual rules:
- full background stays black across hero and downstream sections
- no beige, off-black, or gray wash behind the main landing sections
- typography remains large and decisive
- components should feel like designed objects, not default app cards

## 3. Section Plan

### 3.1 Hero
Keep the existing logo-led hero, but preserve the black canvas and current entrance choreography.

Hero actions:
- `Upload Files`
- `Explore Features`

Hero should remain simple. No heavy extra UI should be added above the fold unless it supports the primary message.

### 3.2 Feature Pills
Keep the new alternating pill section as the first major interactive section below the hero.

Behavior:
- pills alternate left and right on desktop
- pills collapse to one centered stack on mobile
- pills enter on scroll using transform and opacity only
- each pill opens a richer click popover
- each popover may use a small Lottie accent

### 3.3 System Map
Add a new interactive section after the feature pills showing how saved content moves through the product.

Narrative:
`Saved posts -> Analysis -> Queryable knowledge -> Obsidian / Graphify / AI workflows`

Behavior:
- connected nodes or modules
- hover or click reveals state and explanation
- subtle GSAP motion on idle and interaction
- no fake 3D scene unless it improves clarity

### 3.4 Showcase / Export Section
Add a section that presents outcomes instead of raw features.

Showcase cards or panels:
- searchable saved post index
- export into Obsidian
- graph connection workflows
- AI enrichment output

Behavior:
- panels can expand, slide, or reveal deeper content
- animation should clarify which result the user is inspecting

## 4. Interaction Rules
Motion must follow these rules:

- animate only `x`, `y`, `scale`, `rotation`, and `opacity` unless there is a strong reason otherwise
- avoid layout-heavy animation such as width, height, top, or left where transforms can do the job
- use `useGSAP` or scoped GSAP cleanup in React
- each scroll animation should be tied to a specific section purpose
- no competing autoplay loops across multiple sections
- respect `prefers-reduced-motion`

Interactive behaviors that fit this direction:
- magnetic hover on premium buttons and pills
- popovers and expandable panels
- cursor-reactive micro motion
- section reveal timelines
- connected line or signal animations in the system map

Interactive behaviors that do not fit this direction:
- random floating decorative particles in every section
- excessive parallax
- constant background movement that reduces readability
- mixing multiple animation libraries on the same interface layer

## 5. Architecture
Landing interactions should be split into focused React components instead of growing `App.jsx`.

Expected component boundaries:
- `LandingHero`
- `FeaturePillsSection`
- `SystemMapSection`
- `ShowcaseSection`
- shared hooks or utilities for GSAP behavior if repetition appears

GSAP setup should be localized to each section component. ScrollTriggers must be cleaned up automatically through `@gsap/react` scoping.

## 6. Accessibility and Performance
- all meaningful interactive surfaces must remain keyboard reachable
- popovers and expanded details must remain readable on mobile
- reduced-motion users should still get the content without entrance theatrics
- expensive animations should be section-scoped, not global
- keep the black background stable so sections feel continuous

## 7. Testing
Implementation should be verified by:
- desktop visual check
- mobile visual check
- scroll behavior check
- popover interaction check
- reduced-motion sanity check
- `npm run build`
- `npm run lint`

## 8. Scope for Next Implementation Pass
The next implementation pass should do only this:
- make the full landing background consistently black
- refine the existing feature pills into the locked visual system
- add the interactive `System Map` section
- add the `Showcase / Export` section
- add restrained premium hover behaviors where they improve feel

Out of scope for the next pass:
- replacing GSAP with another motion framework
- introducing Framer Motion
- rebuilding the main authenticated app UI
- adding decorative animation with no product meaning
