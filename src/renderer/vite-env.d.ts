/// <reference types="vite/client" />

import type { CraftStationBridge } from "@/shared/ipc";

declare global {
  interface Window {
    craftstation: CraftStationBridge;
  }
}
