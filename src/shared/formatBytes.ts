/** Compact human-readable size (binary units). */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"] as const;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const n = bytes / k ** i;
  return `${i === 0 ? Math.round(n) : n.toFixed(1)} ${sizes[i]}`;
}
