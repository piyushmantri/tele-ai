type Level = "debug" | "info" | "warn" | "error";

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
    if (process.env.LOG_LEVEL === "debug") console.log(fmt("debug", msg, extra));
  },
  info(msg: string, extra?: Record<string, unknown>) {
    console.log(fmt("info", msg, extra));
  },
  warn(msg: string, extra?: Record<string, unknown>) {
    console.warn(fmt("warn", msg, extra));
  },
  error(msg: string, extra?: Record<string, unknown>) {
    console.error(fmt("error", msg, extra));
  },
};
