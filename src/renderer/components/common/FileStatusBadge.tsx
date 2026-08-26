import { CircleMinus, CirclePlus } from "lucide-react";

export function FileStatusBadge(props: { status: string }) {
  const cls = "ml-1 inline-block size-3 align-[-0.15em]";
  switch (props.status) {
    case "A":
    case "?":
      return <CirclePlus className={`${cls} text-success`} />;
    case "D":
      return <CircleMinus className={`${cls} text-danger`} />;
    default:
      return null;
  }
}
