import type { ReactNode } from "react";
import {
  Braces,
  Bug,
  Cog,
  Database,
  FileCode,
  FileText,
  Gauge,
  Globe,
  Hammer,
  type LucideIcon,
  Package,
  Play,
  Rocket,
  Server,
  Terminal,
  TestTubeDiagonal,
  Upload,
  Wrench,
  Zap,
} from "lucide-react";

export const ACTION_ICONS: { name: string; Icon: LucideIcon }[] = [
  { name: "play", Icon: Play },
  { name: "terminal", Icon: Terminal },
  { name: "rocket", Icon: Rocket },
  { name: "hammer", Icon: Hammer },
  { name: "wrench", Icon: Wrench },
  { name: "cog", Icon: Cog },
  { name: "zap", Icon: Zap },
  { name: "bug", Icon: Bug },
  { name: "test-tube", Icon: TestTubeDiagonal },
  { name: "gauge", Icon: Gauge },
  { name: "package", Icon: Package },
  { name: "upload", Icon: Upload },
  { name: "server", Icon: Server },
  { name: "database", Icon: Database },
  { name: "globe", Icon: Globe },
  { name: "file-code", Icon: FileCode },
  { name: "file-text", Icon: FileText },
  { name: "braces", Icon: Braces },
];

export function resolveActionIcon(iconName?: string): ReactNode {
  const entry = ACTION_ICONS.find((i) => i.name === iconName) ?? ACTION_ICONS[0]!;
  return <entry.Icon className="size-4" />;
}
