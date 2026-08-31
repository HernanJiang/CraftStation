import { create } from "zustand";
import type { TokenUsageResponse } from "@/shared/contracts";

interface TokenUsageStore {
  response: TokenUsageResponse | null;
  loading: boolean;
  error: string | null;
  setLoading: (loading: boolean) => void;
  setResponse: (response: TokenUsageResponse) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useTokenUsageStore = create<TokenUsageStore>()((set) => ({
  response: null,
  loading: false,
  error: null,
  setLoading: (loading) => set({ loading, ...(loading ? { error: null } : {}) }),
  setResponse: (response) => set({ response, loading: false, error: null }),
  setError: (error) => set({ loading: false, error }),
  reset: () => set({ response: null, loading: false, error: null }),
}));
