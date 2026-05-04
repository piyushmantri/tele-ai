import { useEffect, useRef } from "react";
import type { WsEvent } from "@tele/shared";

type Handler = (e: WsEvent) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private retry = 0;
  private timer: number | null = null;

  start() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      this.retry = 0;
    };
    ws.onmessage = (m) => {
      try {
        const e = JSON.parse(m.data) as WsEvent;
        this.handlers.forEach((h) => h(e));
      } catch {}
    };
    ws.onclose = () => {
      this.ws = null;
      this.retry += 1;
      const delay = Math.min(1000 * 2 ** this.retry, 30_000);
      this.timer = window.setTimeout(() => this.start(), delay);
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {}
    };
    this.ws = ws;
  }

  stop() {
    if (this.timer != null) clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
  }

  subscribe(h: Handler): () => void {
    this.handlers.add(h);
    this.start();
    return () => {
      this.handlers.delete(h);
    };
  }
}

export const wsClient = new WsClient();

export function useWsEvent<T extends WsEvent["type"]>(
  type: T,
  handler: (event: Extract<WsEvent, { type: T }>) => void,
) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    return wsClient.subscribe((e) => {
      if (e.type === type) ref.current(e as Extract<WsEvent, { type: T }>);
    });
  }, [type]);
}
