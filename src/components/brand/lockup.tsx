/**
 * The programme's official logo, its artwork only: every place that shows it writes the name
 * beside it, and the logo's own lettering would be too small to read at these sizes.
 */
export function Mark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/diviyata-saviyak-mark.webp" alt="" width={360} height={306} className={className} />
  );
}
