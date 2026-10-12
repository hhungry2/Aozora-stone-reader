import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Anchor, Book } from "../types";
import {
  createSpeechSource,
  nextSpeechChunk,
  type SpeechChunk,
  type SpeechRange,
} from "./speech";

type SpeechStatus = "idle" | "speaking" | "paused" | "finished" | "error";
interface SpeechState {
  status: SpeechStatus;
  excerpt: string;
  error: string | null;
  range: SpeechRange | null;
}
interface SpeechSession {
  cursor: Anchor;
  chunk: SpeechChunk | null;
  utterance: SpeechSynthesisUtterance | null;
  paused: boolean;
}
const idle: SpeechState = {
  status: "idle",
  excerpt: "",
  error: null,
  range: null,
};

export function useReadAloud({
  book,
  rate,
  voiceURI,
  onPosition,
}: {
  book: Book;
  rate: number;
  voiceURI: string;
  onPosition: (anchor: Anchor, position: number) => void;
}) {
  const supported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function";
  const source = useMemo(() => createSpeechSource(book), [book]);
  const [state, setState] = useState<SpeechState>(idle);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicesRequested, setVoicesRequested] = useState(false);
  const session = useRef<SpeechSession | null>(null);
  const preferences = useRef({ rate, voiceURI, onPosition });
  preferences.current = { rate, voiceURI, onPosition };

  const cancelSession = useCallback(() => {
    const current = session.current;
    session.current = null;
    if (current) {
      current.utterance = null;
      window.speechSynthesis.cancel();
    }
  }, []);
  const stop = useCallback(() => {
    cancelSession();
    setState(idle);
  }, [cancelSession]);

  useEffect(() => {
    if (!supported || !voicesRequested) return;
    const synth = window.speechSynthesis;
    const updateVoices = () => setVoices(synth.getVoices());
    updateVoices();
    synth.addEventListener("voiceschanged", updateVoices);
    return () => synth.removeEventListener("voiceschanged", updateVoices);
  }, [supported, voicesRequested]);

  useEffect(() => {
    if (!supported) return;
    // pagehide also covers documents kept alive in the browser's back/forward cache.
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      cancelSession();
    };
  }, [supported, source, stop, cancelSession]);

  const speakNext = useCallback(
    function speakNext(current: SpeechSession) {
      if (session.current !== current || current.paused) return;
      const chunk = nextSpeechChunk(source, current.cursor);
      if (!chunk) {
        session.current = null;
        setState({ status: "finished", excerpt: "", error: null, range: null });
        return;
      }
      const synth = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(chunk.text);
      const available = synth.getVoices();
      const voice =
        available.find(
          (voice) => voice.voiceURI === preferences.current.voiceURI,
        ) ??
        available.find(
          (voice) => /^ja(?:[-_]|$)/iu.test(voice.lang) && voice.default,
        ) ??
        available.find((voice) => /^ja(?:[-_]|$)/iu.test(voice.lang));
      utterance.lang = voice?.lang ?? "ja-JP";
      utterance.voice = voice ?? null;
      utterance.rate = preferences.current.rate;
      current.chunk = chunk;
      current.utterance = utterance; // Retain the utterance until end/error/cancel.
      const isCurrent = () =>
        session.current === current && current.utterance === utterance;
      utterance.onstart = () => {
        if (!isCurrent()) return;
        setState({
          status: "speaking",
          excerpt: chunk.excerpt,
          error: null,
          range: chunk.range,
        });
        preferences.current.onPosition(chunk.start, chunk.position);
      };
      utterance.onend = () => {
        if (!isCurrent()) return;
        current.utterance = null;
        current.cursor = chunk.next;
        speakNext(current);
      };
      const fail = (message: string) => {
        if (!isCurrent()) return;
        cancelSession();
        setState({
          status: "error",
          excerpt: chunk.excerpt,
          error: message,
          range: null,
        });
      };
      utterance.onerror = (event) =>
        fail(
          event.error === "not-allowed"
            ? "読み上げを開始できませんでした。再生ボタンを押して再試行してください。"
            : event.error === "voice-unavailable" ||
                event.error === "language-unavailable"
              ? "選択した音声を利用できません。音声を変更して再試行してください。"
              : "読み上げに失敗しました。端末の音声設定を確認して再試行してください。",
        );
      setState({
        status: "speaking",
        excerpt: chunk.excerpt,
        error: null,
        range: null,
      });
      try {
        synth.speak(utterance);
      } catch {
        fail("読み上げを開始できませんでした。もう一度お試しください。");
      }
    },
    [source, cancelSession],
  );

  const start = useCallback(
    (anchor: Anchor) => {
      if (!supported) return;
      setVoicesRequested(true);
      cancelSession();
      // cancel() does not reset the global paused flag.
      window.speechSynthesis.resume();
      const current: SpeechSession = {
        cursor: anchor,
        chunk: null,
        utterance: null,
        paused: false,
      };
      session.current = current;
      speakNext(current);
    },
    [supported, cancelSession, speakNext],
  );

  const pause = useCallback(() => {
    const current = session.current;
    if (!current || current.paused) return;
    current.paused = true;
    current.cursor = current.chunk?.start ?? current.cursor;
    current.utterance = null;
    // Native pause/resume is inconsistent on mobile. Restart the short sentence on resume.
    window.speechSynthesis.cancel();
    setState((value) => ({ ...value, status: "paused" }));
  }, []);
  const resume = useCallback(() => {
    const current = session.current;
    if (!current?.paused) return;
    current.paused = false;
    window.speechSynthesis.resume();
    speakNext(current);
  }, [speakNext]);

  const loadVoices = useCallback(() => setVoicesRequested(true), []);
  return {
    ...state,
    supported,
    voices,
    loadVoices,
    start,
    stop,
    pause,
    resume,
  };
}

export type ReadAloud = ReturnType<typeof useReadAloud>;
