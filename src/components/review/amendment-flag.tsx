import { FilePen } from "lucide-react";

/**
 * AMD-3, REL-2, REL-6: a row of the Ministry's letter form or the District's release form whose case has an
 * amendment waiting for the Ministry, so whoever funds it knows. The case can still be ticked.
 */
export function AmendmentFlag({ text }: { text: string }) {
  return (
    <span
      data-testid="amendment-flag"
      className="mt-0.5 inline-flex items-center gap-1.5 self-start rounded-md border border-warning-border bg-warning px-2 py-0.5 text-sm font-semibold text-warning-foreground"
    >
      <FilePen aria-hidden="true" className="size-4 shrink-0" />
      {text}
    </span>
  );
}
