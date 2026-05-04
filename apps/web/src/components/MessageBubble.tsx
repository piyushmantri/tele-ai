import type { Message } from "@tele/shared";

export default function MessageBubble({ message }: { message: Message }) {
  const isOut = message.direction === "out";
  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
          isOut ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-100"
        }`}
      >
        <div className="whitespace-pre-wrap break-words">{message.text}</div>
        <div className="mt-1 text-[10px] opacity-60">
          {new Date(message.created_at).toLocaleString()}
          {message.source !== "user" && ` · ${message.source}`}
        </div>
      </div>
    </div>
  );
}
