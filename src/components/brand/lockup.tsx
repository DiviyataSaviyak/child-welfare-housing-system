/** The programme's mark: a house with a sprout inside, on a gold base, in the logo's own colours. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 88" className={className} aria-hidden="true" focusable="false">
      <path
        d="M7 43 L48 7 L89 43"
        fill="none"
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-mark-house"
      />
      <rect x="16" y="42" width="9.5" height="28" rx="4.75" className="fill-mark-house" />
      <rect x="70.5" y="42" width="9.5" height="28" rx="4.75" className="fill-mark-house" />
      <path d="M48 46 L48 71" strokeWidth="4.75" strokeLinecap="round" className="stroke-mark-stem" />
      <path d="M48.5 53 C50 41 55 33 65 30 C65.5 42 59 51 48.5 53 Z" className="fill-mark-leaf" />
      <path d="M47.5 59 C44 50 39.5 44 31.5 41.5 C31 51 37 57.5 47.5 59 Z" className="fill-mark-stem" />
      <rect x="9" y="76" width="78" height="9" rx="4.5" className="fill-gold" />
    </svg>
  );
}
