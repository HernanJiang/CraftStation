import type {
  CraftPlan,
  CraftSession,
  Entity,
  HarnessRuntimeAdapter,
  NativeHarnessDescriptor,
  NativeHarnessDiagnostic,
} from "@/shared/crafting";
import { CraftingError } from "@/shared/crafting/errors";

export class UnavailableNativeHarnessRuntimeAdapter implements HarnessRuntimeAdapter {
  readonly id: string;
  readonly harnessKind: string;
  readonly descriptor: NativeHarnessDescriptor;
  private readonly diagnosticRecord: NativeHarnessDiagnostic;

  constructor(descriptor: NativeHarnessDescriptor, reason: string) {
    this.id = descriptor.id;
    this.harnessKind = descriptor.harnessKind;
    this.descriptor = descriptor;
    this.diagnosticRecord = {
      code: "RUNTIME_UNAVAILABLE",
      harnessKind: descriptor.harnessKind,
      phase: "readiness",
      operation: "discover",
      message: reason,
      remediation: `Install and authenticate the official ${descriptor.label} runtime before retrying.`,
      occurredAt: new Date().toISOString(),
    };
  }

  supports(craftPlan: CraftPlan): boolean {
    return craftPlan.runtimeBinding.harnessKind === this.harnessKind;
  }

  getDiagnostics(): readonly NativeHarnessDiagnostic[] {
    return [this.diagnosticRecord];
  }

  async spawnEntity(_craftPlan: CraftPlan): Promise<Entity> {
    throw CraftingError.runtimeUnavailable(
      this.harnessKind,
      `${this.descriptor.label} is unavailable on this machine; no synthetic Entity was created.`,
      this.diagnosticRecord.remediation,
    );
  }

  async createSession(_entity: Entity): Promise<CraftSession> {
    throw CraftingError.runtimeUnavailable(this.harnessKind, this.diagnosticRecord.message);
  }

  async resumeSession(_entity: Entity, _sessionRef: string): Promise<CraftSession> {
    throw CraftingError.runtimeUnavailable(this.harnessKind, this.diagnosticRecord.message);
  }
}
