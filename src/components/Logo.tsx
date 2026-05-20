import type { CSSProperties } from 'react';

/**
 * Skillo brand mark.
 *
 * Variants:
 *   - "symbol"     → just the squircle smile (use for favicons, avatars, decorative)
 *   - "horizontal" → symbol + "Skillo" wordmark beside it (default header lockup)
 *   - "stacked"    → symbol above the "Skillo" wordmark (auth screens, splashes)
 *
 * Tones:
 *   - "brand" (default) — teal squircle, white face. Use on light surfaces.
 *   - "white"           — white squircle with knock-through face. Use on the brand colour or photography.
 *   - "black"           — slate squircle with white face. Single-ink contexts.
 *
 * `size` is always the height of the SYMBOL in px. Lockup widths scale from that.
 *
 * The wordmark uses the Geist font via the `--font-geist-sans` CSS variable
 * declared in `app/layout.tsx`. If the variable is missing it falls back to
 * Inter + system-ui so the component never breaks.
 */

export type LogoVariant = 'symbol' | 'horizontal' | 'stacked';
export type LogoTone = 'brand' | 'white' | 'black';

interface LogoProps {
  variant?: LogoVariant;
  size?: number;
  tone?: LogoTone;
  className?: string;
  /** Override the accessible label (defaults to "Skillo") */
  ariaLabel?: string;
  style?: CSSProperties;
}

const PALETTE: Record<LogoTone, { container: string; face: string; ink: string }> = {
  brand: { container: '#0D9488', face: '#FFFFFF', ink: '#0F172A' },
  white: { container: '#FFFFFF', face: 'transparent', ink: '#FFFFFF' },
  black: { container: '#0F172A', face: '#FFFFFF', ink: '#0F172A' },
};

const WORDMARK_FONT =
  'var(--font-geist-sans), "Geist", var(--font-inter-sans), "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

function Symbol({ tone, size, label }: { tone: LogoTone; size: number; label: string }) {
  const c = PALETTE[tone];

  // The white tone needs a mask so the eyes/smile cut through to the
  // background rather than being painted white-on-white.
  if (tone === 'white') {
    const maskId = `skillo-mask-${size}`;
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        role="img"
        aria-label={label}
        focusable="false"
      >
        <defs>
          <mask id={maskId}>
            <rect width="100" height="100" rx="24" fill="white" />
            <circle cx="40" cy="42" r="6" fill="black" />
            <circle cx="60" cy="42" r="6" fill="black" />
            <path
              d="M34 60 Q50 76 66 60"
              stroke="black"
              strokeWidth="7"
              strokeLinecap="round"
              fill="none"
            />
          </mask>
        </defs>
        <rect width="100" height="100" rx="24" fill={c.container} mask={`url(#${maskId})`} />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={label}
      focusable="false"
    >
      <rect width="100" height="100" rx="24" fill={c.container} />
      <circle cx="40" cy="42" r="6" fill={c.face} />
      <circle cx="60" cy="42" r="6" fill={c.face} />
      <path
        d="M34 60 Q50 76 66 60"
        stroke={c.face}
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function Logo({
  variant = 'horizontal',
  size = 32,
  tone = 'brand',
  className,
  ariaLabel = 'Skillo',
  style,
}: LogoProps) {
  const inkColor = PALETTE[tone].ink;

  if (variant === 'symbol') {
    return (
      <span className={className} style={style}>
        <Symbol tone={tone} size={size} label={ariaLabel} />
      </span>
    );
  }

  if (variant === 'stacked') {
    const wordmarkSize = Math.round(size * 0.58);
    return (
      <span
        className={className}
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: size * 0.18,
          ...style,
        }}
        aria-label={ariaLabel}
        role="img"
      >
        <Symbol tone={tone} size={size} label={ariaLabel} />
        <span
          aria-hidden="true"
          style={{
            fontFamily: WORDMARK_FONT,
            fontWeight: 700,
            fontSize: wordmarkSize,
            letterSpacing: '-0.045em',
            color: inkColor,
            lineHeight: 1,
          }}
        >
          Skillo
        </span>
      </span>
    );
  }

  // horizontal (default)
  const wordmarkSize = Math.round(size * 0.85);
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size * 0.32,
        ...style,
      }}
      aria-label={ariaLabel}
      role="img"
    >
      <Symbol tone={tone} size={size} label={ariaLabel} />
      <span
        aria-hidden="true"
        style={{
          fontFamily: WORDMARK_FONT,
          fontWeight: 700,
          fontSize: wordmarkSize,
          letterSpacing: '-0.045em',
          color: inkColor,
          lineHeight: 1,
        }}
      >
        Skillo
      </span>
    </span>
  );
}

export default Logo;
