import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  WebGLRenderer,
} from 'three';

import './PixelSnow.css';

function createFlakeTexture(variant) {
  const canvas = document.createElement('canvas');
  const size = 32;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, size, size);
  context.fillStyle = '#fff';
  context.strokeStyle = '#fff';
  context.lineWidth = 3;

  if (variant === 'round') {
    context.beginPath();
    context.arc(size / 2, size / 2, size * 0.34, 0, Math.PI * 2);
    context.fill();
  } else if (variant === 'snowflake') {
    context.translate(size / 2, size / 2);
    for (let i = 0; i < 6; i += 1) {
      context.rotate(Math.PI / 3);
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(0, -size * 0.36);
      context.moveTo(0, -size * 0.22);
      context.lineTo(size * 0.1, -size * 0.31);
      context.moveTo(0, -size * 0.22);
      context.lineTo(-size * 0.1, -size * 0.31);
      context.stroke();
    }
  } else {
    context.fillRect(size * 0.28, size * 0.28, size * 0.44, size * 0.44);
  }

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createSnowData(count, farPlane, direction) {
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const angle = (direction * Math.PI) / 180;

  for (let i = 0; i < count; i += 1) {
    const index = i * 3;
    positions[index] = (Math.random() - 0.5) * 42;
    positions[index + 1] = (Math.random() - 0.5) * 24;
    positions[index + 2] = -Math.random() * farPlane;

    const depthFactor = 0.45 + Math.random() * 0.9;
    velocities[index] = Math.cos(angle) * 0.16 * depthFactor;
    velocities[index + 1] = -(0.55 + Math.random() * 0.9) * depthFactor;
    velocities[index + 2] = 0;
  }

  return { positions, velocities };
}

export default function PixelSnow({
  color = '#ffffff',
  flakeSize = 0.01,
  minFlakeSize = 1.25,
  pixelResolution = 200,
  speed = 1.25,
  depthFade = 8,
  farPlane = 20,
  brightness = 1,
  density = 0.3,
  variant = 'square',
  direction = 125,
  className = '',
  style = {},
}) {
  const containerRef = useRef(null);
  const animationRef = useRef(0);
  const rendererRef = useRef(null);
  const materialRef = useRef(null);
  const geometryRef = useRef(null);
  const velocitiesRef = useRef(null);
  const resizeTimeoutRef = useRef(null);
  const isVisibleRef = useRef(true);

  const flakeCount = useMemo(() => {
    return Math.max(90, Math.round(pixelResolution * density * 2.8));
  }, [density, pixelResolution]);

  const handleResize = useCallback(() => {
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }
    resizeTimeoutRef.current = window.setTimeout(() => {
      const container = containerRef.current;
      const renderer = rendererRef.current;
      if (!container || !renderer) return;
      renderer.setSize(container.offsetWidth, container.offsetHeight);
    }, 100);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisibleRef.current = entry.isIntersecting;
      },
      { threshold: 0 }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const scene = new Scene();
    const camera = new PerspectiveCamera(55, container.offsetWidth / container.offsetHeight, 0.1, farPlane + 10);
    camera.position.z = 12;

    const renderer = new WebGLRenderer({
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(container.offsetWidth, container.offsetHeight);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const texture = createFlakeTexture(variant);
    const material = new PointsMaterial({
      color: new Color(color).multiplyScalar(brightness),
      map: texture,
      size: Math.max(minFlakeSize, flakeSize * 360),
      sizeAttenuation: true,
      transparent: true,
      opacity: Math.min(1, 0.45 + brightness * 0.35),
      depthWrite: false,
    });
    materialRef.current = material;

    const { positions, velocities } = createSnowData(flakeCount, farPlane, direction);
    velocitiesRef.current = velocities;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometryRef.current = geometry;

    const snow = new Points(geometry, material);
    scene.add(snow);

    window.addEventListener('resize', handleResize);

    let lastTime = performance.now();
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      if (!isVisibleRef.current) return;

      const now = performance.now();
      const delta = Math.min(0.05, (now - lastTime) / 1000) * speed;
      lastTime = now;

      const positionAttribute = geometry.getAttribute('position');
      const positionsArray = positionAttribute.array;
      const velocitiesArray = velocitiesRef.current;
      const boundsX = 22;
      const boundsY = Math.max(10, depthFade * 2.8);

      for (let i = 0; i < flakeCount; i += 1) {
        const index = i * 3;
        positionsArray[index] += velocitiesArray[index] * delta;
        positionsArray[index + 1] += velocitiesArray[index + 1] * delta;

        if (positionsArray[index + 1] < -boundsY) {
          positionsArray[index] = (Math.random() - 0.5) * boundsX * 2;
          positionsArray[index + 1] = boundsY;
          positionsArray[index + 2] = -Math.random() * farPlane;
        }

        if (positionsArray[index] < -boundsX) positionsArray[index] = boundsX;
        if (positionsArray[index] > boundsX) positionsArray[index] = -boundsX;
      }

      positionAttribute.needsUpdate = true;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', handleResize);
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      texture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      geometry.dispose();
      material.dispose();
      rendererRef.current = null;
      materialRef.current = null;
      geometryRef.current = null;
      velocitiesRef.current = null;
    };
  }, [
    brightness,
    color,
    density,
    depthFade,
    direction,
    farPlane,
    flakeCount,
    flakeSize,
    handleResize,
    minFlakeSize,
    pixelResolution,
    speed,
    variant,
  ]);

  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    material.color = new Color(color).multiplyScalar(brightness);
    material.size = Math.max(minFlakeSize, flakeSize * 360);
    material.opacity = Math.min(1, 0.45 + brightness * 0.35);
    material.needsUpdate = true;
  }, [brightness, color, flakeSize, minFlakeSize]);

  return <div ref={containerRef} className={`pixel-snow-container ${className}`} style={style} />;
}
