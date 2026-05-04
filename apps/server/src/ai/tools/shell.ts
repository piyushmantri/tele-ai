import { spawn } from "node:child_process";
import type { ToolDef } from "./index.js";
import { getSettings } from "../../db/repos/settings.js";

const MAX_OUTPUT = 8 * 1024;

function truncate(s: string): string {
  if (s.length <= MAX_OUTPUT) return s;
  return s.slice(0, MAX_OUTPUT) + `\n... [truncated ${s.length - MAX_OUTPUT} bytes]`;
}

export const runShell: ToolDef = {
  declaration: {
    name: "run_shell",
    description:
      "Run a shell command on the user's machine via zsh. Subject to allow/deny lists. Use sparingly and for diagnostic-style commands.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute." },
        cwd: { type: "string", description: "Optional working directory." },
        timeout_ms: {
          type: "number",
          description: "Optional timeout in ms (default 15000, max 60000).",
        },
      },
      required: ["command"],
    },
  },
  handler: async (args) => {
    const command = String((args as { command?: unknown }).command ?? "").trim();
    const cwd = (args as { cwd?: string }).cwd;
    const timeoutMs = Math.min(
      Math.max(Number((args as { timeout_ms?: number }).timeout_ms) || 15_000, 1_000),
      60_000,
    );
    if (!command) return { ok: false, error: "command required" };

    const settings = await getSettings();
    const firstToken = command.split(/\s+/)[0] ?? "";
    const denyHit = settings.shell_deny.find((d) => command.includes(d));
    if (denyHit) return { ok: false, error: `command contains denied token: ${denyHit}` };
    if (settings.shell_allow.length > 0 && !settings.shell_allow.includes(firstToken)) {
      return { ok: false, error: `command "${firstToken}" not in allow list` };
    }

    return await new Promise((resolve) => {
      const child = spawn("zsh", ["-c", command], {
        cwd: cwd || undefined,
        timeout: timeoutMs,
        env: process.env,
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (b) => (stdout += b.toString("utf8")));
      child.stderr?.on("data", (b) => (stderr += b.toString("utf8")));
      child.on("close", (code, signal) => {
        resolve({
          ok: code === 0,
          exit_code: code,
          signal,
          stdout: truncate(stdout),
          stderr: truncate(stderr),
        });
      });
      child.on("error", (err) => {
        resolve({ ok: false, error: err.message });
      });
    });
  },
};
