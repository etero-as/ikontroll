import type { AnnotationShape } from '@/types/course';

interface Props {
  src: string;
  alt: string;
  annotations?: AnnotationShape[];
  className?: string;
}

function arrowheadPoints(
  x1: number, y1: number, x2: number, y2: number, headLen: number,
): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const p1x = x2 - headLen * Math.cos(angle - Math.PI / 6);
  const p1y = y2 - headLen * Math.sin(angle - Math.PI / 6);
  const p2x = x2 - headLen * Math.cos(angle + Math.PI / 6);
  const p2y = y2 - headLen * Math.sin(angle + Math.PI / 6);
  return `${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}`;
}

/**
 * Displays an image with optional non-destructive annotation overlay.
 */
export default function AnnotatedImage({ src, alt, annotations, className }: Props) {
  const hasAnnotations = annotations && annotations.length > 0;

  return (
    <div
      className={`relative overflow-hidden ${className ?? ''}`}
      role="img"
      aria-label={alt}
    >
      {/* Background: the image */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${JSON.stringify(src)})`,
          backgroundSize: '100% 100%',
          backgroundPosition: '0% 0%',
          backgroundRepeat: 'no-repeat',
        }}
      />

      {/* SVG annotation overlay */}
      {hasAnnotations && (
        <svg
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          xmlns="http://www.w3.org/2000/svg"
        >
          {annotations.map((shape) => {
            const lw = shape.strokeWidth;
            if (shape.type === 'arrow') {
              const headLen = Math.max(lw * 3.5, 0.015);
              return (
                <g key={shape.id}>
                  <path
                    d={`M${shape.x1},${shape.y1} L${shape.x2},${shape.y2}`}
                    stroke={shape.color}
                    strokeWidth={lw}
                    strokeLinecap="round"
                    fill="none"
                  />
                  <polygon
                    points={arrowheadPoints(shape.x1, shape.y1, shape.x2, shape.y2, headLen)}
                    fill={shape.color}
                  />
                </g>
              );
            }
            if (shape.type === 'circle') {
              const radius = Math.sqrt((shape.x2 - shape.x1) ** 2 + (shape.y2 - shape.y1) ** 2);
              return (
                <circle
                  key={shape.id}
                  cx={shape.x1}
                  cy={shape.y1}
                  r={radius}
                  stroke={shape.color}
                  strokeWidth={lw}
                  fill={shape.fill || 'none'}
                />
              );
            }
            if (shape.type === 'freehand' && shape.path) {
              return (
                <path
                  key={shape.id}
                  d={shape.path}
                  stroke={shape.color}
                  strokeWidth={lw}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            }
            if (shape.type === 'text') {
              const fontSize = shape.fontSize ?? 0.03;
              return (
                <text
                  key={shape.id}
                  x={shape.x1}
                  y={shape.y1}
                  fill={shape.fill || shape.color}
                  fontSize={fontSize}
                  fontFamily="Inter, sans-serif"
                  dominantBaseline="hanging"
                >
                  {shape.text || ''}
                </text>
              );
            }
            return (
              <rect
                key={shape.id}
                x={Math.min(shape.x1, shape.x2)}
                y={Math.min(shape.y1, shape.y2)}
                width={Math.abs(shape.x2 - shape.x1)}
                height={Math.abs(shape.y2 - shape.y1)}
                stroke={shape.color}
                strokeWidth={lw}
                fill={shape.fill || 'none'}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}
