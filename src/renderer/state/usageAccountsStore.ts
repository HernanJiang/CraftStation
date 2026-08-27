import { create } from "zustand";
import type { AccountView } from "@/shared/contracts";

interface UsageAccountsStore {
  accounts: AccountView[];
  hydrated: boolean;
  setAccounts: (accounts: AccountView[]) => void;
  upsertAccount: (account: AccountView) => void;
  removeAccount: (accountId: string) => void;
  reset: () => void;
}

function sameAccount(left: AccountView, right: AccountView): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const useUsageAccountsStore = create<UsageAccountsStore>()((set) => ({
  accounts: [],
  hydrated: false,
  setAccounts: (accounts) =>
    set((state) => {
      if (
        state.accounts.length === accounts.length &&
        state.accounts.every((account, index) => sameAccount(account, accounts[index]!))
      ) {
        return state;
      }
      return { accounts: [...accounts], hydrated: true };
    }),
  upsertAccount: (account) =>
    set((state) => {
      const index = state.accounts.findIndex((item) => item.accountId === account.accountId);
      if (index < 0) return { accounts: [...state.accounts, account], hydrated: true };
      if (sameAccount(state.accounts[index]!, account)) return { hydrated: true };
      const accounts = [...state.accounts];
      accounts[index] = account;
      accounts.sort((left, right) => left.order - right.order);
      return { accounts, hydrated: true };
    }),
  removeAccount: (accountId) =>
    set((state) => ({
      accounts: state.accounts.filter((account) => account.accountId !== accountId),
    })),
  reset: () => set({ accounts: [], hydrated: false }),
}));
