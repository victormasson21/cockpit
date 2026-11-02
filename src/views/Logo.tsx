// Logo.tsx — the tree mark in its fixed brand colours; at 20px and below it draws the simplified mark.
const GREEN = "#5AC488";
const CORAL = "#D9836F";
const SMALL_MAX_PX = 20;

function Crown() {
  return (
    <>
      <circle cx="16" cy="10.6" r="5" fill={CORAL} />
      <circle cx="8" cy="10.6" r="5" fill={GREEN} />
      <circle cx="12" cy="6.4" r="5" fill={GREEN} />
    </>
  );
}

export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      {size <= SMALL_MAX_PX ? (
        <rect x="10.7" y="11" width="2.6" height="11.5" rx="1.3" fill={GREEN} />
      ) : (
        <>
          <path fill={GREEN} d="M11.6 19Q10.09 15.32 6.4 16.8Q7.91 20.48 11.6 19Z" />
          <path fill={GREEN} d="M12.4 17.2Q15.92 18.95 17.6 15.4Q14.08 13.65 12.4 17.2Z" />
          <path fill={GREEN} d="M10.7 11H13.3V19.6C13.3 21.2 14.2 22 15.6 22.5H8.4C9.8 22 10.7 21.2 10.7 19.6Z" />
        </>
      )}
      <Crown />
    </svg>
  );
}
