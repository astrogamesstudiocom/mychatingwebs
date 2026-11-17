import { useEffect, useRef, useState } from 'react';
import { Loader2, Send, Trash2 } from 'lucide-react';
import { formatDurationMMSS, pickSupportedAudioMimeType } from '../utils/chatHelpers';

interface VoiceRecorderBarProps {
  onSendVoice: (blob: Blob, durationSec: number, mimeType: string) => Promise<void>;
  onCancel: () => void;
}

export function VoiceRecorderBar({ onSendVoice, onCancel }: VoiceRecorderBarProps) {
  const [elapsedSec, setElapsedSec] = useState(0);
  const [levels, setLevels] = useState<number[]>(new Array(18).fill(18));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startMsRef = useRef<number>(Date.now());
  const mimeTypeRef = useRef<string>('audio/webm');
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let mounted = true;
    let timerId: number | null = null;

    async function initRecorder() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Microphone recording requires HTTPS in a modern browser.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const mime = pickSupportedAudioMimeType();
        mimeTypeRef.current = mime || 'audio/webm';
        const recorder = mime
          ? new MediaRecorder(stream, { mimeType: mime })
          : new MediaRecorder(stream);

        recorderRef.current = recorder;
        chunksRef.current = [];
        startMsRef.current = Date.now();

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };

        recorder.start(200);

        timerId = window.setInterval(() => {
          setElapsedSec(Math.floor((Date.now() - startMsRef.current) / 1000));
        }, 250);

        // Live audio level visualization
        try {
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new AudioCtx();
          audioCtxRef.current = ctx;
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 64;
          src.connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);

          const tick = () => {
            if (!mounted) return;
            analyser.getByteFrequencyData(data);
            const slice = Array.from({ length: 18 }, (_, i) => {
              const val = data[i % data.length] || 0;
              return Math.max(15, Math.min(100, Math.round((val / 255) * 100)));
            });
            setLevels(slice);
            rafRef.current = window.requestAnimationFrame(tick);
          };
          rafRef.current = window.requestAnimationFrame(tick);
        } catch {
          // Visualization optional
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Microphone permission denied. Allow microphone access to record voice notes.'
        );
      }
    }

    void initRecorder();

    return () => {
      mounted = false;
      if (timerId !== null) window.clearInterval(timerId);
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      if (audioCtxRef.current) void audioCtxRef.current.close().catch(() => {});
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          // Ignore
        }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const handleStopAndSend = async () => {
    const recorder = recorderRef.current;
    if (!recorder || sending) return;

    setSending(true);
    const duration = Math.max(1, Math.round((Date.now() - startMsRef.current) / 1000));

    await new Promise<void>((resolve) => {
      if (recorder.state === 'inactive') {
        resolve();
        return;
      }
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }

    const actualMime = recorder.mimeType || mimeTypeRef.current || 'audio/webm';
    const blob = new Blob(chunksRef.current, { type: actualMime });

    if (blob.size === 0) {
      setSending(false);
      onCancel();
      return;
    }

    try {
      await onSendVoice(blob, duration, actualMime);
    } finally {
      setSending(false);
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-2xl w-full">
        <span className="text-xs text-red-700 dark:text-red-300">{error}</span>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#202C33] text-xs font-medium text-[#111B21] dark:text-[#E9EDEF] shrink-0 cursor-pointer"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 w-full bg-[#F0F2F5] dark:bg-[#2A3942] rounded-2xl px-3 py-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={sending}
        aria-label="Discard voice recording"
        className="min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
      >
        <Trash2 className="w-5 h-5" />
      </button>

      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" aria-hidden="true" />
        <span className="text-sm font-mono tabular-nums font-semibold text-[#111B21] dark:text-[#E9EDEF] shrink-0">
          {formatDurationMMSS(elapsedSec)}
        </span>
        <div className="flex-1 h-7 flex items-center gap-1 overflow-hidden">
          {levels.map((lvl, idx) => (
            <span
              key={idx}
              style={{ height: `${lvl}%` }}
              className="flex-1 rounded-full bg-[#008069] dark:bg-[#00A884] transition-all duration-75"
            />
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={handleStopAndSend}
        disabled={sending}
        aria-label="Send voice message"
        className="min-w-[42px] min-h-[42px] rounded-full bg-[#00A884] hover:bg-[#008F70] text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer disabled:opacity-60"
      >
        {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-4 h-4" />}
      </button>
    </div>
  );
}
