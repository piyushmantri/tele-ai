import type { Message } from "@tele/shared";

export default function MessageBubble({ message }: { message: Message }) {
  const isOut = message.direction === "out";
  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
      <div className={isOut ? "kode-bubble--out" : "kode-bubble--in"}>
        <div className="whitespace-pre-wrap break-words text-sm">{message.text}</div>
        <div className="mt-1 text-[10px] opacity-60">
          {new Date(message.created_at).toLocaleString()}
          {message.source !== "user" && ` · ${message.source}`}
        </div>
      </div>
    </div>
  );
}
