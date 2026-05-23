const DIRECTIONS = {
  top: 'to bottom',
  right: 'to left',
  bottom: 'to top',
  left: 'to right',
};

function getProgress(index, count, curve, exponential) {
  const linear = count <= 1 ? 1 : index / (count - 1);
  const curved = curve === 'bezier' ? 3 * Math.pow(linear, 2) - 2 * Math.pow(linear, 3) : linear;
  return exponential ? Math.pow(curved, 2) : curved;
}

function getLayerStyle({ index, divCount, position, height, strength, curve, exponential, opacity }) {
  const progress = getProgress(index + 1, divCount, curve, exponential);
  const sliceStart = Math.max(0, (index / divCount) * 100 - 10);
  const sliceEnd = Math.min(100, ((index + 1.25) / divCount) * 100);
  const blur = Math.max(0.5, progress * strength * 8);
  const direction = DIRECTIONS[position] || DIRECTIONS.bottom;
  const isVertical = position === 'top' || position === 'bottom';

  return {
    position: 'absolute',
    pointerEvents: 'none',
    opacity,
    backdropFilter: `blur(${blur}px)`,
    WebkitBackdropFilter: `blur(${blur}px)`,
    maskImage: `linear-gradient(${direction}, transparent ${sliceStart}%, black ${sliceEnd}%)`,
    WebkitMaskImage: `linear-gradient(${direction}, transparent ${sliceStart}%, black ${sliceEnd}%)`,
    ...(isVertical
      ? {
          left: 0,
          right: 0,
          [position]: 0,
          height,
        }
      : {
          top: 0,
          bottom: 0,
          [position]: 0,
          width: height,
        }),
  };
}

function GradualBlur({
  target = 'parent',
  position = 'bottom',
  height = '7rem',
  strength = 3,
  divCount = 6,
  curve = 'bezier',
  exponential = false,
  opacity = 1,
}) {
  const layerCount = Math.max(1, Math.round(divCount));
  const isFixed = target === 'page' || target === 'viewport';

  return (
    <div
      aria-hidden="true"
      className="gradual-blur"
      style={{
        position: isFixed ? 'fixed' : 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {Array.from({ length: layerCount }, (_, index) => (
        <div
          key={index}
          style={getLayerStyle({
            index,
            divCount: layerCount,
            position,
            height,
            strength,
            curve,
            exponential,
            opacity,
          })}
        />
      ))}
    </div>
  );
}

export default GradualBlur;
