import { create } from "zustand";
import type { TokenUsageResponse } from "@/shared/contracts";

interface TokenUsageStore {
  response: TokenUsageResponse | null;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  setResponse: (response: TokenUsageResponse) => void;
  reset: () => void;
}

export const useTokenUsageStore = create<TokenUsageStore>()((set) => ({
  response: null,
  loading: false,
  setLoading: (loading) => set({ loading }),
  setResponse: (response) => set({ response, loading: false }),
  reset: () => set({ response: null, loading: false }),
}));
