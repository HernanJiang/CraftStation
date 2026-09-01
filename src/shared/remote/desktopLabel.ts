/** "CraftStation on host" → "host"; the brand prefix is noise inside the app.
 *  Legacy "CraftStation on …" labels (paired pre-rebrand) are stripped too. */
export function desktopTitle(label: string): string {
  const stripped = label.replace(/^(?:CraftStation|CraftStation)\s+on\s+/i, "");
  return stripped || label;
}
