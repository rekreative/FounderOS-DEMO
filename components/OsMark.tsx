/** REKREOS rocket mark, adapted from the approved brand artwork. */
export function OsMark({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} role="img" aria-label="REKREOS OS">
      <defs>
        <linearGradient id="rekreos-mark-gradient" x1="50" y1="2" x2="50" y2="98" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ec008c" />
          <stop offset="1" stopColor="#ff7a45" />
        </linearGradient>
      </defs>
      <path fill="url(#rekreos-mark-gradient)" d="M50 2 73 25v30l6 6v12L60 54V29L50 19 40 29v25L21 73V61l6-6V25L50 2Z" />
      <path fill="url(#rekreos-mark-gradient)" d="m50 58 14 14c-8 0-12 8-14 26-2-18-6-26-14-26l14-14Z" />
    </svg>
  );
}
