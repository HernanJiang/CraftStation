import { randomUUID } from "node:crypto";
import type { AccountBinding, ProjectLocation } from "@/shared/contracts";
import type {
  CraftPlan,
  CraftSession,
  Entity,
  HarnessRuntimeAdapter,
  NativeHarnessDescriptor,
  NativeHarnessDiagnostic,
} from "@/shared/crafting";
import { CraftingError } from "@/shared/crafting/errors";
import type {
  OpenCodeExecutableReadiness,
  OpenCodeExecutableReadinessProvider,
} from "@/shared/opencodeNative";
import {
  assertSupportedOpenCodePlanOptions,
  OpenCodeNativeSession,
  type OpenCodeNativeSessionOptions,
} from "./session";
import type { OpenCodeRuntimeBindingResolver } from "./runtimeBinding";
import type { OpenCodeNativeServerLease, OpenCodeNativeServerPool } from "./serverPool";

export interface OpenCodeNativeRuntimeAdapterOptions {
  readonly projectLocation: ProjectLocation;
  readonly descriptor: NativeHarnessDescriptor;
  readonly accountBinding?: AccountBinding;
  readonly profileRef?: string;
  readonly transportFactory?: OpenCodeNativeSessionOptions["transportFactory"];
  readonly readinessProvider?: OpenCodeExecutableReadinessProvider;
  readonly runtimeBindingResolver?: OpenCodeRuntimeBindingResolver;
  readonly serverPool?: OpenCodeNativeServerPool;
}

/** Runtime adapter for the official OpenCode server API, not its terminal UI. */
export class OpenCodeNativeRuntimeAdapter implements HarnessRuntimeAdapter {
  readonly id = "native-harness:opencode";
  readonly harnessKind = "opencode";
  readonly descriptor: NativeHarnessDescriptor;
  private readonly diagnostics: NativeHarnessDiagnostic[] = [];

  constructor(private readonly options: OpenCodeNativeRuntimeAdapterOptions) {
    this.descriptor = options.descriptor;
  }

  supports(plan: CraftPlan): boolean {
    return plan.runtimeBinding.harnessKind === "opencode";
  }

  getDiagnostics(): readonly NativeHarnessDiagnostic[] {
    return [...this.diagnostics];
  }

  private executableReadiness(plan: CraftPlan): OpenCodeExecutableReadiness {
    if (
      this.descriptor.transport === "unavailable" ||
      this.descriptor.capabilities.start === "unavailable" ||
      this.descriptor.capabilities.start === "implementation missing"
    ) {
      return {
        status:
          this.descriptor.capabilities.start === "implementation missing"
            ? "implementation-missing"
            : "unavailable",
        reason: `Harness transport=${this.descriptor.transport}, start=${this.descriptor.capabilities.start}.`,
      };
    }
    const providerID = plan.runtimeBinding.providerID ?? plan.runtimeBinding.vendor;
    return (
      this.options.readinessProvider?.({
        providerID,
        modelID: plan.runtimeBinding.modelId,
        ...(plan.runtimeBinding.authRef ? { authRef: plan.runtimeBinding.authRef } : {}),
        ...(plan.runtimeBinding.profileRef ? { profileRef: plan.runtimeBinding.profileRef } : {}),
      }) ?? {
        status: "unverified",
        reason: "No route-specific OpenCode executable readiness provider was configured.",
      }
    );
  }

  private assertExecutable(plan: CraftPlan, operation: string): void {
    const readiness = this.executableReadiness(plan);
    if (readiness.status === "ready") return;
    const providerID = plan.runtimeBinding.providerID ?? plan.runtimeBinding.vendor;
    throw CraftingError.runtimeUnavailable(
      "opencode",
      `Cannot ${operation}: OpenCode route '${providerID}:${plan.runtimeBinding.modelId}' is not executable (${readiness.status}): ${readiness.reason}`,
      "Configure a verified provider/model/auth binding before executing this route.",
    );
  }

  private async acquireTransport(plan: CraftPlan): Promise<OpenCodeNativeServerLease | undefined> {
    if (!this.options.runtimeBindingResolver || !this.options.serverPool) {
      if (
        this.options.accountBinding ||
        plan.runtimeBinding.authRef ||
        plan.runtimeBinding.profileRef ||
        this.options.profileRef
      ) {
        throw CraftingError.runtimeUnavailable(
          "opencode",
          "OpenCode auth/profile binding has no Supervisor-owned resolver and server pool.",
          "Configure the OpenCode runtime binding resolver before creating an executable Session.",
        );
      }
      return undefined;
    }
    const resolved = await this.options.runtimeBindingResolver.resolve({
      projectLocation: this.options.projectLocation,
      plan,
      ...(this.options.accountBinding ? { accountBinding: this.options.accountBinding } : {}),
      ...(this.options.profileRef ? { profileRef: this.options.profileRef } : {}),
    });
    return this.options.serverPool.acquire({
      isolationKey: resolved.isolationKey,
      transportOptions: {
        projectLocation: this.options.projectLocation,
        ...resolved.transportOptions,
      },
      onDiagnostic: (diagnostic) => this.diagnostics.push(diagnostic),
    });
  }

  async spawnEntity(plan: CraftPlan): Promise<Entity> {
    if (!this.supports(plan)) {
      throw CraftingError.runtimeUnavailable(
        "opencode",
        "The OpenCode adapter cannot execute this CraftPlan.",
      );
    }

    // F38: Readiness & availability gate. Unverified/unavailable runtimes cannot spawn executable entities.
    // If transport is unavailable or essential execution capabilities are not verified/ready ("implementation missing" / "unavailable"),
    // block spawning executable entity with a clear runtimeUnavailable error.
    this.assertExecutable(plan, "spawn executable Entity");

    return {
      id: `entity:opencode:${randomUUID()}`,
      resultItemId: plan.resultItemId,
      craftPlan: plan,
      status: "spawned",
      createdAt: new Date().toISOString(),
      nativeHarness: this.descriptor,
      metadata: {
        vendor: "opencode",
        official: true,
        machineFacingBoundary: this.descriptor.machineFacingBoundary,
        providerID: plan.runtimeBinding.providerID,
        modelID: plan.runtimeBinding.modelId,
      },
    };
  }

  async createSession(entity: Entity): Promise<CraftSession> {
    this.assertExecutable(entity.craftPlan, "create Session");
    assertSupportedOpenCodePlanOptions(entity.craftPlan);
    const transport = await this.acquireTransport(entity.craftPlan);

    return OpenCodeNativeSession.open({
      entityId: entity.id,
      threadId: entity.craftPlan.threadId ?? `thread:${randomUUID()}`,
      projectLocation: this.options.projectLocation,
      plan: entity.craftPlan,
      sessionRef: entity.craftPlan.sessionRef,
      ...(transport ? { transport } : {}),
      ...(this.options.transportFactory ? { transportFactory: this.options.transportFactory } : {}),
      onDiagnostic: (diagnostic) => {
        this.diagnostics.push(diagnostic);
      },
    });
  }

  async resumeSession(entity: Entity, sessionRef: string): Promise<CraftSession> {
    this.assertExecutable(entity.craftPlan, "resume Session");
    assertSupportedOpenCodePlanOptions(entity.craftPlan);
    const transport = await this.acquireTransport(entity.craftPlan);

    return OpenCodeNativeSession.open({
      entityId: entity.id,
      threadId: entity.craftPlan.threadId ?? `thread:${randomUUID()}`,
      projectLocation: this.options.projectLocation,
      plan: entity.craftPlan,
      sessionRef,
      ...(transport ? { transport } : {}),
      ...(this.options.transportFactory ? { transportFactory: this.options.transportFactory } : {}),
      onDiagnostic: (diagnostic) => {
        this.diagnostics.push(diagnostic);
      },
    });
  }
}
