import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { resolve, relative, dirname, isAbsolute, join, normalize } from "node:path";
import { homedir } from "node:os";
import type { ToolDef } from "./index.js";
import { config } from "../../config.js";
import { getChatById } from "../../db/repos/chats.js";
import { sendFile } from "../../telegram/sender.js";

function expandPath(input: string): string {
  const expanded = input.startsWith("~/") || input === "~"
    ? join(homedir(), input.slice(1))
    : input;
  return isAbsolute(expanded) ? normalize(expanded) : resolve(config.WORKSPACE_ROOT, expanded);
}

export const readFileTool: ToolDef = {
  declaration: {
    name: "read_file",
    description: "Read a UTF-8 text file. Supports ~ for home directory and absolute paths anywhere on the filesystem.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path inside workspace." },
      },
      required: ["path"],
    },
  },
  handler: async (args) => {
    const p = String((args as { path?: unknown }).path ?? "");
    const abs = expandPath(p);
    try {
      const content = await readFile(abs, "utf8");
      return { ok: true, path: abs, content };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const writeFileTool: ToolDef = {
  declaration: {
    name: "write_file",
    description: "Write a UTF-8 text file inside the configured workspace root. Creates parent dirs.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  handler: async (args) => {
    const p = String((args as { path?: unknown }).path ?? "");
    const content = String((args as { content?: unknown }).content ?? "");
    const abs = expandPath(p);
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
      return { ok: true, path: abs, bytes: Buffer.byteLength(content) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const listDirTool: ToolDef = {
  declaration: {
    name: "list_dir",
    description: "List entries of a directory. Supports ~ for home directory and absolute paths anywhere on the filesystem.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
  },
  handler: async (args) => {
    const p = String((args as { path?: unknown }).path ?? "");
    const abs = expandPath(p);
    try {
      const entries = await readdir(abs);
      const detailed = await Promise.all(
        entries.map(async (name) => {
          const full = join(abs, name);
          try {
            const s = await stat(full);
            return { name, is_dir: s.isDirectory(), size: s.size };
          } catch {
            return { name, is_dir: false, size: 0 };
          }
        }),
      );
      return { ok: true, path: abs, entries: detailed };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export function makeSendFileTool(currentChatId: string, tgChatId: string): ToolDef {
  return {
    declaration: {
      name: "send_file",
      description:
        "Send a file from the filesystem as a Telegram attachment to the current chat. " +
        "Supports ~ for home directory and absolute paths anywhere on the filesystem. " +
        "Images (jpg, jpeg, png, gif, webp) and videos (mp4, mov, avi, mkv, webm, m4v) are sent inline; all other formats are sent as documents.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or relative path inside workspace." },
          caption: { type: "string", description: "Optional caption shown with the file." },
        },
        required: ["path"],
      },
    },
    handler: async (args) => {
      const p = String((args as { path?: unknown }).path ?? "");
      const caption = String((args as { caption?: unknown }).caption ?? "");
      const abs = expandPath(p);
      try {
        await stat(abs);
      } catch {
        return { ok: false, error: "file not found" };
      }
      const chat = await getChatById(currentChatId);
      if (!chat) return { ok: false, error: "current chat not found in db" };
      try {
        await sendFile(chat, abs, caption, "ai");
        return { ok: true, path: abs };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
