import { appendFileSync } from "node:fs";
import { markError } from "./metrics.js";

type Level = "debug" | "info" | "warn" | "error";

const LOG_FILE = process.env.LOG_FILE ?? null;

function writeFile(line: string): void {
  if (!LOG_FILE) return;
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    // ignore — logger must never throw
  }
}

function fmt(level: Level, msg: string, extra?: Record<string, unknown>): string {
  const base = {
    t: new Date().toISOString(),
    level,
    msg,
    ...(extra ?? {}),
  };
  return JSON.stringify(base);
}

export const logger = {
  debug(msg: string, extra?: Record<string, unknown>) {
    if (process.env.LOG_LEVEL === "debug") {
      const line = fmt("debug", msg, extra);
      console.log(line);
      writeFile(line);
    }
  },
  info(msg: string, extra?: Record<string, unknown>) {
    const line = fmt("info", msg, extra);
    console.log(line);
    writeFile(line);
  },
  warn(msg: string, extra?: Record<string, unknown>) {
    const line = fmt("warn", msg, extra);
    console.warn(line);
    writeFile(line);
    try {
      markError("warn", msg, extra);
    } catch {
      // metrics must never throw out of the logger
    }
  },
  error(msg: string, extra?: Record<string, unknown>) {
    const line = fmt("error", msg, extra);
    console.error(line);
    writeFile(line);
    try {
      markError("error", msg, extra);
    } catch {
      // metrics must never throw out of the logger
    }
  },
};
