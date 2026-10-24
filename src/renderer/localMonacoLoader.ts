import type { Monaco } from "@monaco-editor/react";

type CancelablePromise<T> = Promise<T> & { cancel: () => void };

let configuredMonaco: Monaco | null = null;

function asCancelable<T>(promise: Promise<T>): CancelablePromise<T> {
  return Object.assign(promise, { cancel: () => undefined });
}

const localMonacoLoader = {
  config(config: { monaco?: Monaco }): void {
    if (!config.monaco) {
      throw new Error("CraftStation requires a bundled Monaco ESM instance.");
    }
    configuredMonaco = config.monaco;
  },

  init(): CancelablePromise<Monaco> {
    return asCancelable(
      configuredMonaco
        ? Promise.resolve(configuredMonaco)
        : Promise.reject(new Error("Bundled Monaco was not configured before initialization.")),
    );
  },

  __getMonacoInstance(): Monaco | null {
    return configuredMonaco;
  },
};

export default localMonacoLoader;
