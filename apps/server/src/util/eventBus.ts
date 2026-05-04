import { EventEmitter } from "node:events";
import type { WsEvent } from "@tele/shared";

class TypedEventBus {
  private emitter = new EventEmitter();

  emit(event: WsEvent): void {
    this.emitter.emit("ws", event);
  }

  on(handler: (event: WsEvent) => void): () => void {
    this.emitter.on("ws", handler);
    return () => this.emitter.off("ws", handler);
  }
}

export const eventBus = new TypedEventBus();
