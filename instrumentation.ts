export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const globalPilot = globalThis as typeof globalThis & {
    __controlPuntosPoller?: ReturnType<typeof setInterval>;
  };
  if (globalPilot.__controlPuntosPoller) return;

  const { syncDriveNow } = await import("./lib/server/sync-drive");
  const { driveRuntimeConfig } = await import("./lib/server/runtime-config");
  void syncDriveNow();
  const interval = setInterval(() => {
    void syncDriveNow();
  }, driveRuntimeConfig().intervalSeconds * 1000);
  interval.unref();
  globalPilot.__controlPuntosPoller = interval;
}
