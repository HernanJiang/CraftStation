import type { NativeHarnessDiagnostic } from "@/shared/crafting";
import {
  OpenCodeNativeTransport,
  type OpenCodeNativeConnection,
  type OpenCodeNativeTransportOptions,
} from "./transport";

interface PoolEntry {
  readonly transport: OpenCodeNativeTransport;
  readonly connection: Promise<OpenCodeNativeConnection>;
  readonly diagnosticListeners: Set<(diagnostic: NativeHarnessDiagnostic) => void>;
  leases: number;
  dead: boolean;
}

export interface OpenCodeNativeServerLease {
  readonly correlationId: string;
  connect(): Promise<OpenCodeNativeConnection>;
}

export interface OpenCodeNativeServerPoolOptions {
  readonly transportFactory?:
    | ((options: OpenCodeNativeTransportOptions) => OpenCodeNativeTransport)
    | undefined;
}

/** Supervisor-owned process pool partitioned by resolved credential scope. */
export class OpenCodeNativeServerPool {
  private readonly entries = new Map<string, PoolEntry>();

  constructor(private readonly options: OpenCodeNativeServerPoolOptions = {}) {}

  acquire(input: {
    readonly isolationKey: string;
    readonly transportOptions: OpenCodeNativeTransportOptions;
    readonly onDiagnostic?: ((diagnostic: NativeHarnessDiagnostic) => void) | undefined;
  }): OpenCodeNativeServerLease {
    let entry = this.entries.get(input.isolationKey);
    if (!entry || entry.dead) {
      const diagnosticListeners = new Set<(diagnostic: NativeHarnessDiagnostic) => void>(
        input.onDiagnostic ? [input.onDiagnostic] : [],
      );
      const transport = (
        this.options.transportFactory ?? ((options) => new OpenCodeNativeTransport(options))
      )({
        ...input.transportOptions,
        onDiagnostic: (diagnostic) => {
          for (const listener of diagnosticListeners) listener(diagnostic);
        },
      });
      const created: PoolEntry = {
        transport,
        connection: transport.connect(),
        diagnosticListeners,
        leases: 0,
        dead: false,
      };
      entry = created;
      this.entries.set(input.isolationKey, created);
      void created.connection.then(
        (connection) => {
          connection.child?.once("exit", () => {
            created.dead = true;
            if (this.entries.get(input.isolationKey) === created) {
              this.entries.delete(input.isolationKey);
            }
          });
        },
        () => {
          created.dead = true;
          if (this.entries.get(input.isolationKey) === created) {
            this.entries.delete(input.isolationKey);
          }
        },
      );
    }

    const leasedEntry = entry;
    leasedEntry.leases += 1;
    if (input.onDiagnostic) leasedEntry.diagnosticListeners.add(input.onDiagnostic);
    let released = false;
    return {
      correlationId: leasedEntry.transport.correlationId,
      connect: async () => {
        const connection = await leasedEntry.connection;
        return {
          ...connection,
          dispose: async () => {
            if (released) return;
            released = true;
            if (input.onDiagnostic) leasedEntry.diagnosticListeners.delete(input.onDiagnostic);
            leasedEntry.leases = Math.max(0, leasedEntry.leases - 1);
          },
        };
      },
    };
  }

  entryCountForTests(): number {
    return this.entries.size;
  }

  async dispose(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.allSettled(entries.map((entry) => entry.transport.dispose()));
  }
}
