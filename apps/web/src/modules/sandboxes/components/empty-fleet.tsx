export function EmptyFleet() {
  return (
    <div className="rise flex flex-col items-center gap-4 rounded-xl border border-dashed border-border/80 bg-card/30 px-6 py-16 text-center">
      <div
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-xl border bg-muted/50 text-muted-foreground"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden fill="none">
          <rect
            x="3.5"
            y="4.5"
            width="17"
            height="6"
            rx="2"
            stroke="currentColor"
            className="text-muted-foreground"
            strokeWidth="1.4"
          />
          <rect
            x="3.5"
            y="13.5"
            width="17"
            height="6"
            rx="2"
            stroke="currentColor"
            className="text-primary"
            strokeWidth="1.4"
          />
          <circle cx="7" cy="7.5" r="0.9" fill="currentColor" className="text-muted-foreground" />
          <circle cx="7" cy="16.5" r="0.9" fill="currentColor" className="text-primary" />
        </svg>
      </div>
      <div>
        <p className="text-base font-medium text-foreground">No machines yet</p>
        <p className="mx-auto mt-1 max-w-sm text-base leading-relaxed text-muted-foreground">
          Use <span className="text-foreground">Create Sandbox</span> to boot one.
        </p>
      </div>
    </div>
  );
}
