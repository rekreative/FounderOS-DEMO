export function PageHeader({
  eyebrow,
  title,
  caret = false,
  right,
  rightWide = false,
}: {
  eyebrow?: string;
  title: string;
  caret?: boolean;
  right?: React.ReactNode;
  /** Let the `right` widget stretch wide across the header whitespace as a
      short bar tucked top-right, instead of sitting compact against the edge. */
  rightWide?: boolean;
}) {
  // No descriptions under titles — Alex built it, he knows what it does.
  return (
    <header className={`mb-6 flex flex-col items-start gap-4 sm:flex-row sm:justify-between ${rightWide ? 'sm:items-start' : 'sm:items-end'}`}>
      <div className="min-w-0 max-w-full">
        {eyebrow && (
          <div className="page-eyebrow mb-2 flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.32em] text-os-dim">
            {eyebrow}
          </div>
        )}
        <h1 className={`break-words font-display text-[22px] font-bold uppercase leading-[1.1] tracking-[0.045em] sm:text-[25px]${caret ? ' caret-blink' : ''}`}>
          {title}
        </h1>
      </div>
      {right && (
        <div className={rightWide ? 'flex min-w-0 w-full items-start sm:flex-1' : 'flex max-w-full items-center gap-2 sm:shrink-0'}>
          {right}
        </div>
      )}
    </header>
  );
}
