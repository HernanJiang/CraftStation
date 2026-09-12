import type { AccountBinding, ProjectLocation } from "@/shared/contracts";
import type { CraftPlan } from "@/shared/crafting";
import { CraftingError } from "@/shared/crafting/errors";
import type { AccountStore } from "@/supervisor/runtime/accountStore";
import type { OpenCodeNativeTransportOptions } from "./transport";

export interface OpenCodeRuntimeBindingRequest {
  readonly projectLocation: ProjectLocation;
  readonly plan: CraftPlan;
  readonly accountBinding?: AccountBinding | undefined;
  readonly profileRef?: string | undefined;
}

export interface OpenCodeThirdPartyRuntimePreparer {
  (accountId: string, modelId: string): { env: Record<string, string> };
}

export interface ResolvedOpenCodeRuntimeBinding {
  /** Private, opaque pool partition. Never expose this value to renderer/UI. */
  readonly isolationKey: string;
  readonly transportOptions: Omit<
    OpenCodeNativeTransportOptions,
    "projectLocation" | "onDiagnostic"
  >;
}

export interface OpenCodeRuntimeBindingResolver {
  resolve(request: OpenCodeRuntimeBindingRequest): Promise<ResolvedOpenCodeRuntimeBinding>;
}

function locationKey(location: ProjectLocation): string {
  return location.kind === "wsl" ? `wsl:${location.distro}` : location.kind;
}

/**
 * Production resolver backed by AccountStore's supervisor-only projection.
 * It never interprets an opaque ref as a credential and never returns secrets
 * outside the transport closure.
 */
export class AccountStoreOpenCodeRuntimeBindingResolver implements OpenCodeRuntimeBindingResolver {
  constructor(
    private readonly accountStore: AccountStore,
    private readonly prepareThirdPartyRuntime?: OpenCodeThirdPartyRuntimePreparer,
  ) {}

  async resolve(request: OpenCodeRuntimeBindingRequest): Promise<ResolvedOpenCodeRuntimeBinding> {
    const providerID = request.plan.runtimeBinding.providerID ?? request.plan.runtimeBinding.vendor;
    const account = request.accountBinding;
    const authRef = request.plan.runtimeBinding.authRef;
    const profileRef = request.profileRef ?? request.plan.runtimeBinding.profileRef;

    if (!account) {
      if (authRef || profileRef) {
        throw CraftingError.runtimeUnavailable(
          "opencode",
          "OpenCode auth/profile references have no supervisor-resolved account binding.",
          "Select a managed provider account whose credentials are projected into the Supervisor.",
        );
      }
      return {
        isolationKey: `${locationKey(request.projectLocation)}:anonymous`,
        transportOptions: {},
      };
    }

    if (
      account.provider !== providerID &&
      account.provider !== "opencode" &&
      account.provider !== "openai-compatible"
    ) {
      throw CraftingError.incompatibleCombination(
        `OpenCode account provider '${account.provider}' cannot execute route '${providerID}'.`,
      );
    }
    const serverEnvironment =
      account.provider === "openai-compatible"
        ? (this.prepareThirdPartyRuntime?.(account.accountId, request.plan.runtimeBinding.modelId)
            ?.env ?? {})
        : this.accountStore.readCredentialEnvironment(account.accountId);
    const runtime = this.accountStore.prepareOpenCodeRuntimeRoot(account.accountId);
    if (
      account.provider !== "openai-compatible" &&
      Object.keys(serverEnvironment).length === 0 &&
      !runtime.authConfigured
    ) {
      throw CraftingError.runtimeUnavailable(
        "opencode",
        "The selected OpenCode account has no projected provider environment or auth store.",
        "Project the provider's official environment variables or OpenCode auth store into the managed account scope.",
      );
    }
    return {
      isolationKey: [
        locationKey(request.projectLocation),
        account.credentialScopeRef,
        authRef ?? "no-auth-ref",
        profileRef ?? "no-profile-ref",
      ].join(":"),
      transportOptions: {
        serverEnvironment,
        serverRuntimeRoot: runtime.runtimeRoot,
      },
    };
  }
}
