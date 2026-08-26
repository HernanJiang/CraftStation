import { getFileIconUrl } from "@/renderer/components/common/fileIcons";

export function FileIcon(props: { path: string }) {
  const name = props.path.split(/[\\/]/).pop() ?? props.path;
  return <img src={getFileIconUrl(name)} alt="" className="size-4 shrink-0" />;
}
