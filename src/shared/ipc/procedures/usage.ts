import { z } from "zod";
import {
  providerUsagePayloadSchema,
  usageApiKeyPayloadSchema,
  usageLoginConfirmationPayloadSchema,
  usageLoginPayloadSchema,
  usageLoginStatePayloadSchema,
  accountAddPayloadSchema,
  accountEnabledPayloadSchema,
  accountRenamePayloadSchema,
  accountIdPayloadSchema,
  accountPoolConfigPayloadSchema,
  accountProviderPayloadSchema,
  accountReorderPayloadSchema,
  accountResolutionRequestSchema,
  tokenUsagePayloadSchema,
  codexProfileCreatePayloadSchema,
  codexProfileImportPayloadSchema,
  codexProfileLoginPayloadSchema,
  grokProfileLoginCreatePayloadSchema,
  grokProfileLoginPayloadSchema,
  grokProfileCompletePayloadSchema,
  grokProfileCancelPayloadSchema,
  grokProfilePollPayloadSchema,
  type AccountAddPayload,
  type AccountEnabledPayload,
  type AccountIdPayload,
  type AccountPoolConfigPayload,
  type AccountProviderPayload,
  type AccountRenamePayload,
  type AccountReorderPayload,
  type ProviderPoolConfig,
  type AccountResolution,
  type AccountResolutionRequest,
  type AccountView,
  type ProviderUsagePayload,
  type ProviderUsageResponse,
  type UsageApiKeyPayload,
  type UsageLoginConfirmationPayload,
  type UsageLoginPayload,
  type UsageLoginResult,
  type UsageLoginStatePayload,
  type UsageLoginStateResponse,
  type UsageLogoutResult,
  type TokenUsageCapabilities,
  type TokenUsagePayload,
  type TokenUsageResponse,
  type CodexProfileCreatePayload,
  type CodexProfileImportPayload,
  type CodexProfileLoginPayload,
  type CodexProfileLoginResult,
  type GrokProfileLoginCreatePayload,
  type GrokProfileLoginCreateResult,
  type GrokProfileLoginPayload,
  type GrokProfileLoginResult,
  type GrokProfileCompletePayload,
  type GrokProfileCancelPayload,
  type GrokProfilePollPayload,
  type GrokProfilePollResult,
} from "../../contracts";
import { definePayloadProcedure } from "../core";

export const usageProcedures = {
  startUsageLogin: definePayloadProcedure<UsageLoginPayload, UsageLoginResult, "main-local">(
    "startUsageLogin",
    "main-local",
    usageLoginPayloadSchema,
  ),
  cancelUsageLogin: definePayloadProcedure<UsageLoginPayload, void, "main-local">(
    "cancelUsageLogin",
    "main-local",
    usageLoginPayloadSchema,
  ),
  clearUsageLogin: definePayloadProcedure<UsageLoginPayload, UsageLogoutResult, "main-local">(
    "clearUsageLogin",
    "main-local",
    usageLoginPayloadSchema,
  ),
  submitUsageApiKey: definePayloadProcedure<UsageApiKeyPayload, UsageLoginResult, "main-local">(
    "submitUsageApiKey",
    "main-local",
    usageApiKeyPayloadSchema,
  ),
  resolveUsageLoginConfirmation: definePayloadProcedure<
    UsageLoginConfirmationPayload,
    void,
    "main-local"
  >("resolveUsageLoginConfirmation", "main-local", usageLoginConfirmationPayloadSchema),
  getUsageLoginState: definePayloadProcedure<
    UsageLoginStatePayload,
    UsageLoginStateResponse,
    "main-local"
  >("getUsageLoginState", "main-local", usageLoginStatePayloadSchema),
  getProviderUsage: definePayloadProcedure<
    ProviderUsagePayload,
    ProviderUsageResponse,
    "supervisor"
  >("getProviderUsage", "supervisor", providerUsagePayloadSchema),
  refreshProviderUsage: definePayloadProcedure<
    ProviderUsagePayload,
    ProviderUsageResponse,
    "supervisor"
  >("refreshProviderUsage", "supervisor", providerUsagePayloadSchema),
  listAccounts: definePayloadProcedure<AccountProviderPayload, AccountView[], "supervisor">(
    "listAccounts",
    "supervisor",
    accountProviderPayloadSchema,
  ),
  addAccount: definePayloadProcedure<AccountAddPayload, AccountView, "supervisor">(
    "addAccount",
    "supervisor",
    accountAddPayloadSchema,
  ),
  removeAccount: definePayloadProcedure<AccountIdPayload, void, "supervisor">(
    "removeAccount",
    "supervisor",
    accountIdPayloadSchema,
  ),
  selectAccount: definePayloadProcedure<AccountIdPayload, AccountView, "supervisor">(
    "selectAccount",
    "supervisor",
    accountIdPayloadSchema,
  ),
  setAccountEnabled: definePayloadProcedure<AccountEnabledPayload, AccountView, "supervisor">(
    "setAccountEnabled",
    "supervisor",
    accountEnabledPayloadSchema,
  ),
  renameAccount: definePayloadProcedure<AccountRenamePayload, AccountView, "supervisor">(
    "renameAccount",
    "supervisor",
    accountRenamePayloadSchema,
  ),
  reorderAccounts: definePayloadProcedure<AccountReorderPayload, AccountView[], "supervisor">(
    "reorderAccounts",
    "supervisor",
    accountReorderPayloadSchema,
  ),
  setAccountPoolScheduling: definePayloadProcedure<
    AccountPoolConfigPayload,
    ProviderPoolConfig,
    "supervisor"
  >("setAccountPoolScheduling", "supervisor", accountPoolConfigPayloadSchema),
  getAccountPoolScheduling: definePayloadProcedure<
    AccountProviderPayload,
    ProviderPoolConfig,
    "supervisor"
  >("getAccountPoolScheduling", "supervisor", accountProviderPayloadSchema),
  resolveAccount: definePayloadProcedure<AccountResolutionRequest, AccountResolution, "supervisor">(
    "resolveAccount",
    "supervisor",
    accountResolutionRequestSchema,
  ),
  getTokenUsageCapabilities: definePayloadProcedure<
    Record<string, never>,
    TokenUsageCapabilities,
    "supervisor"
  >("getTokenUsageCapabilities", "supervisor", z.object({})),
  getTokenUsage: definePayloadProcedure<TokenUsagePayload, TokenUsageResponse, "supervisor">(
    "getTokenUsage",
    "supervisor",
    tokenUsagePayloadSchema,
  ),
  refreshTokenUsage: definePayloadProcedure<TokenUsagePayload, TokenUsageResponse, "supervisor">(
    "refreshTokenUsage",
    "supervisor",
    tokenUsagePayloadSchema,
  ),
  createCodexProfile: definePayloadProcedure<CodexProfileCreatePayload, AccountView, "supervisor">(
    "createCodexProfile",
    "supervisor",
    codexProfileCreatePayloadSchema,
  ),
  importCodexProfile: definePayloadProcedure<CodexProfileImportPayload, AccountView, "supervisor">(
    "importCodexProfile",
    "supervisor",
    codexProfileImportPayloadSchema,
  ),
  startCodexProfileLogin: definePayloadProcedure<
    CodexProfileLoginPayload,
    CodexProfileLoginResult,
    "supervisor"
  >("startCodexProfileLogin", "supervisor", codexProfileLoginPayloadSchema),
  createGrokProfileLogin: definePayloadProcedure<
    GrokProfileLoginCreatePayload,
    GrokProfileLoginCreateResult,
    "supervisor"
  >("createGrokProfileLogin", "supervisor", grokProfileLoginCreatePayloadSchema),
  startGrokProfileLogin: definePayloadProcedure<
    GrokProfileLoginPayload,
    GrokProfileLoginResult,
    "supervisor"
  >("startGrokProfileLogin", "supervisor", grokProfileLoginPayloadSchema),
  completeGrokProfileLogin: definePayloadProcedure<
    GrokProfileCompletePayload,
    AccountView,
    "supervisor"
  >("completeGrokProfileLogin", "supervisor", grokProfileCompletePayloadSchema),
  cancelGrokProfileLogin: definePayloadProcedure<GrokProfileCancelPayload, void, "supervisor">(
    "cancelGrokProfileLogin",
    "supervisor",
    grokProfileCancelPayloadSchema,
  ),
  pollGrokProfileLogin: definePayloadProcedure<
    GrokProfilePollPayload,
    GrokProfilePollResult,
    "supervisor"
  >("pollGrokProfileLogin", "supervisor", grokProfilePollPayloadSchema),
  refreshAccountQuota: definePayloadProcedure<AccountIdPayload, AccountView, "supervisor">(
    "refreshAccountQuota",
    "supervisor",
    accountIdPayloadSchema,
  ),
} as const;
