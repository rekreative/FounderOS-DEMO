/**
 * Inline Vantage spark emblem. Keeping the vector in the component avoids an
 * external image request and lets every caller tint the same silhouette.
 */
export const EMBLEM_MINT = '#00ffab';

export function SparkIcon({
  size = 28,
  shade = 'var(--accent)',
  className = '',
}: {
  shade?: string;
  size?: number;
  className?: string;
}) {
  const classes = ['emblem', 'inline-block', 'shrink-0', className].filter(Boolean).join(' ');

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label="Vantage"
      focusable="false"
      className={classes}
      style={{ color: shade }}
    >
      <path
        fill={shade}
        d="M50 4 58 38 82 18 62 42 96 50 62 58 82 82 58 62 50 96 42 62 18 82 38 58 4 50 38 42 18 18 42 38Z"
      />
    </svg>
  );
}
