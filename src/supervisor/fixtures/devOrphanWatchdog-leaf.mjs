// Leaf process for the orphan-watchdog process-level test: installs the REAL
// production watchdog (default poll/confirmation/hard-exit timings) and idles.
// The only override is requestShutdown, swapped for a plain exit so the test
// observes death instead of a graceful-dispose side effect.
import { startDevOrphanWatchdog } from "../devOrphanWatchdog.ts";

startDevOrphanWatchdog({
  requestShutdown: () => process.exit(0),
});

process.send?.({ leafPid: process.pid });
setInterval(() => {}, 60_000);
