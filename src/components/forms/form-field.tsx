import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A labelled text input in the prototype's size: 48 px tall, 17 px text (UI-4, UI-6).
 * `error` shows a message under the field (ERR-1); `invalid` + `errorId` point at a shared error box instead.
 * `trailing` is a small button shown inside the field's right edge, such as PasswordField's show/hide;
 * `leading` is an icon inside its left edge.
 */
export function FormField({
  id,
  label,
  help,
  error,
  invalid,
  errorId,
  trailing,
  leading,
  className,
  ...inputProps
}: {
  id: string;
  label: string;
  help?: string;
  error?: string;
  invalid?: boolean;
  errorId?: string;
  trailing?: React.ReactNode;
  leading?: React.ReactNode;
} & Omit<React.ComponentProps<"input">, "id">) {
  const helpId = help ? `${id}-help` : undefined;
  const ownErrorId = error ? `${id}-error` : undefined;
  const isInvalid = Boolean(error) || invalid;
  const describedBy = [helpId, ownErrorId, invalid ? errorId : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-base font-semibold">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          aria-invalid={isInvalid || undefined}
          aria-describedby={describedBy}
          className={cn(
            "peer h-12 rounded-lg px-3.5 text-[17px] md:text-[17px]",
            trailing && "pr-12",
            leading && "ps-11",
            className,
          )}
          {...inputProps}
        />
        {leading && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3.5 text-muted-foreground transition-colors peer-focus-visible:text-primary"
          >
            {leading}
          </div>
        )}
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {help && (
        <span id={helpId} className="text-sm text-muted-foreground">
          {help}
        </span>
      )}
      {error && (
        <p id={ownErrorId} className="text-[15px] font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** A labelled text area, styled like FormField, for longer text such as an address. */
export function FormTextArea({
  id,
  label,
  help,
  error,
  ...props
}: { id: string; label: string; help?: string; error?: string } & Omit<React.ComponentProps<"textarea">, "id">) {
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-base font-semibold">
        {label}
      </Label>
      <textarea
        id={id}
        rows={2}
        aria-invalid={error ? true : undefined}
        aria-describedby={[helpId, errorId].filter(Boolean).join(" ") || undefined}
        className="w-full resize-y rounded-lg border border-input bg-card px-3.5 py-2.5 text-[17px] leading-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
        {...props}
      />
      {help && (
        <span id={helpId} className="text-sm text-muted-foreground">
          {help}
        </span>
      )}
      {error && (
        <p id={errorId} className="text-[15px] font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The error box shown above a form's submit button (ERR-1). */
export function FormError({ id, message }: { id: string; message: string }) {
  return (
    <p
      id={id}
      role="alert"
      className="rounded-lg border-2 border-destructive bg-destructive/5 px-4 py-3 text-[15px] font-medium text-destructive"
    >
      {message}
    </p>
  );
}

/** A short confirmation shown after a change is saved. */
export function FormNotice({ message }: { message: string }) {
  return (
    <p role="status" className="rounded-lg bg-accent px-4 py-3 text-[15px] font-semibold text-accent-foreground">
      {message}
    </p>
  );
}
