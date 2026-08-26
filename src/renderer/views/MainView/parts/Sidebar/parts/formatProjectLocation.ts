import type { Project } from "@/shared/contracts";

export function formatProjectLocation(project: Project): string {
  if (project.location.kind === "wsl") {
    return `${project.location.distro}:${project.location.linuxPath}`;
  }
  return project.location.path;
}
