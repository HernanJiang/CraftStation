import { create } from "zustand";
import type { AccountView } from "@/shared/contracts";

interface UsageAccountsStore {
  accounts: AccountView[];
  hydrated: boolean;
  /** One-shot override for the next newly-created crafted Session. */
  nextSessionAccountId: string | null;
  setAccounts: (accounts: AccountView[]) => void;
  upsertAccount: (account: AccountView) => void;
  removeAccount: (accountId: string) => void;
  setNextSessionAccount: (accountId: string) => void;
  clearNextSessionAccount: () => void;
  reset: () => void;
}

/**
 * Replace the visible accounts unless the incoming list is empty while rows
 * are shown. Polls and supervisor events cannot distinguish "everything was
 * deleted" from transient failure (locked store, racing refresh, supervisor
 * mid-restart), and blanking good authorizations is the worse failure: disk
 * state is untouched, but the user perceives total auth loss and subsequent
 * quota passes run against nothing. Genuine deletions propagate through
 * explicit remove actions (which splice the store first) and non-empty
 * listings, so nothing legitimate gets stuck.
 */
export function setAccountsUnlessEmptyWipe(accounts: AccountView[]): void {
  const store = useUsageAccountsStore.getState();
  if (accounts.length === 0 && store.accounts.length > 0) return;
  store.setAccounts(accounts);
}

function sameAccount(left: AccountView, right: AccountView): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const useUsageAccountsStore = create<UsageAccountsStore>()((set) => ({
  accounts: [],
  hydrated: false,
  nextSessionAccountId: null,
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
      nextSessionAccountId:
        state.nextSessionAccountId === accountId ? null : state.nextSessionAccountId,
    })),
  setNextSessionAccount: (accountId) => set({ nextSessionAccountId: accountId }),
  clearNextSessionAccount: () => set({ nextSessionAccountId: null }),
  reset: () => set({ accounts: [], hydrated: false, nextSessionAccountId: null }),
}));
