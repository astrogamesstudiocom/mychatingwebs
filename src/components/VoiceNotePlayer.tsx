import React, { useEffect, useRef, useState } from 'react';
import { Mic, Pause, Play } from 'lucide-react';
import { formatDurationMMSS } from '../utils/chatHelpers';

interface VoiceNotePlayerProps {
  src: string;
  durationSec: number;
  isOwn: boolean;
}

const BARS = [38, 65, 52, 85, 44, 72, 92, 58, 40, 76, 88, 62, 48, 82, 54, 70, 90, 45, 68, 50, 75, 42];

export function VoiceNotePlayer({ src, durationSec, isOwn }: VoiceNotePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [totalSec, setTotalSec] = useState(durationSec || 0);
  const [rate, setRate] = useState<1 | 1.5 | 2>(1);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setCurrentSec(audio.currentTime || 0);
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setTotalSec(audio.duration);
      }
    };
    const onEnded = () => {
      setPlaying(false);
      setCurrentSec(0);
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnded);
    };
  }, [src]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      try {
        audio.playbackRate = rate;
        await audio.play();
        setPlaying(true);
      } catch (err) {
        console.warn('Audio playback error:', err);
      }
    }
  };

  const cycleRate = () => {
    const nextRate: 1 | 1.5 | 2 = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !totalSec) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * totalSec;
    setCurrentSec(audio.currentTime);
  };

  const progress = totalSec > 0 ? Math.min(1, currentSec / totalSec) : 0;

  return (
    <div className="flex items-center gap-2.5 min-w-[215px] sm:min-w-[245px] py-0.5">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
          isOwn
            ? 'bg-[#008069] text-white hover:bg-[#006B57]'
            : 'bg-[#00A884] text-white hover:bg-[#008F70]'
        }`}
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0">
        <div
          onClick={handleSeek}
          role="slider"
          aria-label="Voice note progress"
          aria-valuemin={0}
          aria-valuemax={Math.round(totalSec)}
          aria-valuenow={Math.round(currentSec)}
          tabIndex={0}
          className="h-7 flex items-center gap-[2.5px] cursor-pointer"
        >
          {BARS.map((heightPct, idx) => {
            const barRatio = idx / BARS.length;
            const active = barRatio <= progress;
            return (
              <span
                key={idx}
                style={{ height: `${Math.max(20, heightPct)}%` }}
                className={`flex-1 rounded-full transition-colors ${
                  active
                    ? 'bg-[#008069] dark:bg-[#00A884]'
                    : 'bg-[#8696A0]/45 dark:bg-[#8696A0]/40'
                }`}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-[#667781] dark:text-[#8696A0] mt-0.5">
          <span className="inline-flex items-center gap-1">
            <Mic className="w-3 h-3" />
            {playing || currentSec > 0
              ? formatDurationMMSS(currentSec)
              : formatDurationMMSS(totalSec)}
          </span>
          <button
            type="button"
            onClick={cycleRate}
            className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-[10px] font-semibold hover:bg-black/10 dark:hover:bg-white/15 cursor-pointer"
          >
            {rate}x
          </button>
        </div>
      </div>
    </div>
  );
}
