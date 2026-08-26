// Inline draft row for creating a new file/directory. Restored from usage inference.
import { File, Folder } from "lucide-react";
import { InlineNameInput } from "./InlineNameInput";

export function InlineDraftRow(props: {
  depth: number;
  type: "file" | "directory";
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onCommit: (value: string) => void;
}) {
  const { depth, type, value, onChange, onCancel, onCommit } = props;
  const Icon = type === "directory" ? Folder : File;
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-0.5 text-sm"
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <Icon className="size-3.5 shrink-0 text-default-500" />
      <InlineNameInput value={value} onChange={onChange} onCancel={onCancel} onCommit={onCommit} />
    </div>
  );
}
