// Demo hook for the Uptime Monitor registry plugin.
// Replace with a real status fetcher (HTTP probe, Statuspage API, etc).
// The exported getContext(chatId) is called at responder time and its return
// value is injected into the AI's system instruction. See
// apps/server/src/ai/applications.ts -> loadCodeAppContext.
export async function getContext(_chatId: string): Promise<string> {
  const now = new Date().toISOString();
  return `Service status snapshot (${now}):\n- api: OK\n- worker: OK\n- db: OK`;
}
