/**
 * Presentational switch used inside menu rows. The host row owns interaction
 * (menu item press / `aria-pressed`), so the visual is aria-hidden and never
 * binds its own handler. In `readOnly` mode the track is muted so it does not
 * read as an interactive control.
 */
export function MenuSwitch(props: { checked: boolean; readOnly?: boolean }) {
  const { checked, readOnly = false } = props;
  return (
    <span
      aria-hidden
      className={`relative ms-auto h-4 w-7 shrink-0 rounded-full ${
        readOnly ? "" : "transition-colors"
      } ${
        checked
          ? readOnly
            ? "bg-success/45"
            : "bg-success"
          : readOnly
            ? "bg-surface-tertiary/70"
            : "bg-surface-tertiary"
      }`}
    >
      <span
        className={`absolute top-0.5 size-3 rounded-full bg-white ${
          readOnly ? "opacity-90" : "transition-transform"
        } ${checked ? "translate-x-3.5" : "translate-x-0.5"}`}
      />
    </span>
  );
}
