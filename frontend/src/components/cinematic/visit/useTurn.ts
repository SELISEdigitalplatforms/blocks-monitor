/** One turn of the conversation: the guide's lines (said once per turn, in order, typed then streamed) and what the
 *  composer offers for the answer. The composer's callbacks always reach the component's latest render, so an answer
 *  is handled with the records as they are now. */
import { useEffect, useRef } from "react";
import { useChat, type ComposerSpec, type Who } from "./chat";

export function useTurn(who: Who, key: string | null, lines: readonly string[], composer: ComposerSpec | null): void {
  useEffect(() => {
    if (!key) return;
    const chat = useChat.getState();
    // the last answer's acknowledgement first
    const ack = chat.takeAck();
    if (ack) void chat.say(ack.who, ack.text);
    lines.forEach((line, i) => void chat.say(who, line, { key: `${key}:${i}` }));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const latest = useRef(composer);
  latest.current = composer;
  const shape = composer
    ? JSON.stringify({ ...composer, onSend: Boolean(composer.onSend), onReply: Boolean(composer.onReply), onFiles: Boolean(composer.onFiles) })
    : "";
  useEffect(() => {
    const c = latest.current;
    useChat.getState().setComposer(c ? {
      ...c,
      onSend: c.onSend ? (text) => latest.current?.onSend?.(text) : undefined,
      onReply: c.onReply ? (id, typed) => latest.current?.onReply?.(id, typed) : undefined,
      onFiles: c.onFiles ? (files) => latest.current?.onFiles?.(files) : undefined,
    } : null);
  }, [shape]);
  // a turn that ends takes its answers with it (the next one sets its own)
  useEffect(() => () => useChat.getState().setComposer(null), []);
}

/** While the guide works on something of their own that the records show running, the typing indicator says what. */
export function useWorking(who: Who, label: string | null): void {
  useEffect(() => {
    useChat.getState().setWorking(label ? { who, label } : null);
  }, [who, label]);
  useEffect(() => () => useChat.getState().setWorking(null), []);
}
