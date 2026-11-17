import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  RefreshCw,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useCall } from '../contexts/CallContext';
import { useAuth } from '../contexts/AuthContext';
import { formatDurationMMSS } from '../utils/chatHelpers';
import { Avatar } from './Avatar';

interface CallOverlayProps {
  onOpenChat?: (chatId: string) => void;
}

function useAudioLevel(stream: MediaStream | null, enabled: boolean): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!stream || !enabled || stream.getAudioTracks().length === 0) {
      setLevel(0);
      return;
    }

    let rafId = 0;
    let ctx: AudioContext | null = null;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          sum += data[i];
        }
        const avg = sum / Math.max(1, data.length);
        setLevel(Math.min(1, avg / 75));
        rafId = window.requestAnimationFrame(tick);
      };
      rafId = window.requestAnimationFrame(tick);
    } catch {
      setLevel(0);
    }

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      if (ctx) {
        void ctx.close().catch(() => {});
      }
    };
  }, [stream, enabled]);

  return level;
}

export function CallOverlay({ onOpenChat }: CallOverlayProps) {
  const { publicProfile } = useAuth();
  const {
    activeCall,
    incomingCall,
    localStream,
    remoteStream,
    isMicMuted,
    isCameraOff,
    isSpeakerMuted,
    audioOutputs,
    selectedAudioOutputId,
    callError,
    callDurationSec,
    connectionState,
    acceptIncomingCall,
    declineIncomingCall,
    endActiveCall,
    toggleMic,
    toggleCamera,
    toggleSpeakerMute,
    selectAudioOutput,
    switchCamera,
    clearCallError,
  } = useCall();

  const [isMinimized, setIsMinimized] = useState(false);
  const [showDeviceMenu, setShowDeviceMenu] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const remoteVoiceLevel = useAudioLevel(
    remoteStream,
    Boolean(activeCall && activeCall.status === 'answered' && !isSpeakerMuted)
  );
  const localVoiceLevel = useAudioLevel(localStream, Boolean(activeCall && !isMicMuted));

  useEffect(() => {
    if (!activeCall) {
      setIsMinimized(false);
      setShowDeviceMenu(false);
    }
  }, [activeCall]);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, activeCall, isMinimized]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
    const audioEl = remoteAudioRef.current;
    if (audioEl) {
      audioEl.srcObject = remoteStream;
      audioEl.muted = isSpeakerMuted;
      if (remoteStream && remoteStream.getAudioTracks().length > 0) {
        void audioEl.play().catch(() => {});
      }
      const sinkEl = audioEl as HTMLAudioElement & {
        setSinkId?: (id: string) => Promise<void>;
      };
      if (sinkEl.setSinkId && selectedAudioOutputId) {
        void sinkEl.setSinkId(selectedAudioOutputId).catch(() => {});
      }
    }
  }, [remoteStream, activeCall, isSpeakerMuted, selectedAudioOutputId]);

  if (!incomingCall && !activeCall && !callError) {
    return null;
  }

  // Permission / Device Error Toast Banner
  if (!incomingCall && !activeCall && callError) {
    return (
      <div className="fixed bottom-5 right-5 z-50 max-w-sm bg-[#111B21] text-white border border-[#2A3942] rounded-2xl p-4 shadow-xl flex items-start gap-3">
        <div className="flex-1 text-xs leading-relaxed">{callError}</div>
        <button
          type="button"
          onClick={clearCallError}
          aria-label="Dismiss call error"
          className="text-[#8696A0] hover:text-white cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // Incoming Call Modal
  if (incomingCall && !activeCall) {
    const isVideo = incomingCall.callType === 'video';
    return (
      <div
        className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label={`Incoming ${isVideo ? 'video' : 'voice'} call`}
      >
        <div className="w-full max-w-sm bg-[#111B21] border border-[#222E35] rounded-3xl p-7 text-center text-white shadow-2xl">
          <div className="flex justify-center mb-4">
            <Avatar src={incomingCall.callerPhoto} name={incomingCall.callerName} size="xl" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">{incomingCall.callerName}</h2>
          <p className="text-sm text-[#8696A0] mt-1 mb-7">
            Incoming {isVideo ? 'video' : 'voice'} call via VerdeChat
          </p>

          <div className="flex items-center justify-center gap-6">
            <button
              type="button"
              onClick={declineIncomingCall}
              className="flex flex-col items-center gap-2 cursor-pointer group"
            >
              <span className="w-14 h-14 rounded-full bg-red-600 group-hover:bg-red-500 flex items-center justify-center transition-colors">
                <PhoneOff className="w-6 h-6 text-white" />
              </span>
              <span className="text-xs text-[#8696A0]">Decline</span>
            </button>

            {isVideo && (
              <button
                type="button"
                onClick={() => acceptIncomingCall(true)}
                className="flex flex-col items-center gap-2 cursor-pointer group"
              >
                <span className="w-14 h-14 rounded-full bg-[#2A3942] group-hover:bg-[#374854] flex items-center justify-center transition-colors">
                  <Phone className="w-6 h-6 text-white" />
                </span>
                <span className="text-xs text-[#8696A0]">Voice only</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => acceptIncomingCall(false)}
              className="flex flex-col items-center gap-2 cursor-pointer group"
            >
              <span className="w-14 h-14 rounded-full bg-[#00A884] group-hover:bg-[#00C098] flex items-center justify-center transition-colors">
                {isVideo ? <Video className="w-6 h-6 text-white" /> : <Phone className="w-6 h-6 text-white" />}
              </span>
              <span className="text-xs text-[#E9EDEF]">Accept</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!activeCall) return null;

  const isCaller = activeCall.callerId === publicProfile?.uid;
  const peerName = isCaller ? activeCall.calleeName : activeCall.callerName;
  const peerPhoto = isCaller ? activeCall.calleePhoto : activeCall.callerPhoto;
  const isVideoCall = activeCall.callType === 'video';
  const hasRemoteVideo = Boolean(remoteStream && remoteStream.getVideoTracks().length > 0);
  const hasLocalVideo = Boolean(localStream && localStream.getVideoTracks().length > 0 && !isCameraOff);

  const statusText =
    activeCall.status === 'ringing'
      ? isCaller
        ? 'Ringing...'
        : 'Incoming...'
      : connectionState === 'connecting' || connectionState === 'new'
      ? 'Connecting audio...'
      : connectionState === 'disconnected'
      ? 'Reconnecting...'
      : formatDurationMMSS(callDurationSec);

  const handleOpenChatAndMinimize = () => {
    setIsMinimized(true);
    if (onOpenChat && activeCall.chatId) {
      onOpenChat(activeCall.chatId);
    }
  };

  return (
    <>
      {/* Always-mounted remote audio element so audio continues uninterrupted when minimized */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {isMinimized ? (
        <div
          role="region"
          aria-label="Active call bar"
          className="fixed top-3 right-3 left-3 sm:left-auto sm:w-96 z-50 bg-[#111B21] text-white border border-[#2A3942] rounded-2xl px-3.5 py-2.5 shadow-2xl flex items-center justify-between gap-3"
        >
          <button
            type="button"
            onClick={() => setIsMinimized(false)}
            className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
          >
            <Avatar src={peerPhoto} name={peerName} size="sm" />
            <div className="min-w-0">
              <div className="text-xs font-semibold truncate">{peerName}</div>
              <div className="text-[11px] font-mono tabular-nums text-[#00A884]">
                {isVideoCall ? 'Video' : 'Voice'} · {statusText}
              </div>
            </div>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={toggleMic}
              aria-label={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
              className={`min-w-[38px] min-h-[38px] rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                isMicMuted ? 'bg-white text-[#111B21]' : 'bg-[#202C33] hover:bg-[#2A3942] text-white'
              }`}
            >
              {isMicMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => setIsMinimized(false)}
              aria-label="Expand call view"
              title="Expand call"
              className="min-w-[38px] min-h-[38px] rounded-full bg-[#202C33] hover:bg-[#2A3942] text-white flex items-center justify-center cursor-pointer"
            >
              <Maximize2 className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={endActiveCall}
              aria-label="End call"
              title="End call"
              className="min-w-[38px] min-h-[38px] rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center cursor-pointer"
            >
              <PhoneOff className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="fixed inset-0 z-50 bg-[#0B141A] text-white flex flex-col">
          {/* Top Info Bar */}
          <div className="relative z-20 flex items-center justify-between px-4 sm:px-6 py-4 bg-gradient-to-b from-black/60 to-transparent">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setIsMinimized(true)}
                aria-label="Minimize call"
                title="Minimize call"
                className="min-w-[40px] min-h-[40px] rounded-full bg-[#202C33]/80 hover:bg-[#2A3942] flex items-center justify-center text-white cursor-pointer shrink-0"
              >
                <ChevronDown className="w-5 h-5" />
              </button>
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-tight truncate">{peerName}</h2>
                <p className="text-xs font-mono tabular-nums text-[#A7B6C0]">
                  {isVideoCall ? 'Video call' : 'Voice call'} · {statusText}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {callError && (
                <div className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-200 text-xs flex items-center gap-2">
                  <span>{callError}</span>
                  <button type="button" onClick={clearCallError} aria-label="Dismiss warning">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {onOpenChat && activeCall.chatId && (
                <button
                  type="button"
                  onClick={handleOpenChatAndMinimize}
                  aria-label="Open chat while on call"
                  title="Message while on call"
                  className="min-w-[40px] min-h-[40px] px-3 rounded-full bg-[#202C33]/80 hover:bg-[#2A3942] flex items-center gap-1.5 text-xs font-medium text-white cursor-pointer"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span className="hidden sm:inline">Chat</span>
                </button>
              )}
            </div>
          </div>

          {/* Main Media Viewport */}
          <div className="relative flex-1 flex items-center justify-center overflow-hidden">
            {isVideoCall && hasRemoteVideo ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-5 px-6 text-center">
                {/* Real-time Audio-Reactive Voice Ring */}
                <div className="relative flex items-center justify-center">
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full bg-[#00A884]/25 transition-transform duration-75"
                    style={{
                      transform: `scale(${1 + remoteVoiceLevel * 0.45})`,
                      opacity: activeCall.status === 'answered' ? 0.35 + remoteVoiceLevel * 0.65 : 0.15,
                    }}
                  />
                  <div className="relative">
                    <Avatar src={peerPhoto} name={peerName} size="xl" />
                  </div>
                </div>

                <div>
                  <h3 className="text-2xl font-bold tracking-tight">{peerName}</h3>
                  <p className="text-sm font-mono tabular-nums text-[#8696A0] mt-1">{statusText}</p>
                </div>

                {/* Real-time Mic / Audio Indicator */}
                <div className="flex items-center gap-4 text-xs text-[#A7B6C0]">
                  <span className="inline-flex items-center gap-2">
                    {isMicMuted ? (
                      <>
                        <MicOff className="w-3.5 h-3.5 text-red-400" />
                        <span>Microphone muted</span>
                      </>
                    ) : (
                      <>
                        <Mic className="w-3.5 h-3.5 text-[#00A884]" />
                        <span className="inline-flex items-end gap-0.5 h-3" aria-hidden="true">
                          {[0.25, 0.55, 0.85, 0.45].map((mult, idx) => (
                            <span
                              key={idx}
                              className="w-1 rounded-full bg-[#00A884] transition-all duration-75"
                              style={{
                                height: `${Math.max(25, Math.min(100, Math.round(localVoiceLevel * mult * 140)))}%`,
                              }}
                            />
                          ))}
                        </span>
                        <span>Mic live</span>
                      </>
                    )}
                  </span>
                </div>
              </div>
            )}

            {/* Picture-in-Picture Local Camera */}
            {isVideoCall && hasLocalVideo && (
              <div className="absolute bottom-5 right-5 w-28 h-40 sm:w-36 sm:h-48 rounded-2xl overflow-hidden border border-white/20 bg-[#111B21] shadow-lg">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover scale-x-[-1]"
                />
              </div>
            )}
          </div>

          {/* Optional Speaker Output Selector Popover */}
          {showDeviceMenu && audioOutputs.length > 0 && (
            <div className="relative z-30 flex justify-center px-4 pb-2">
              <div className="w-full max-w-xs bg-[#202C33] border border-[#2A3942] rounded-2xl p-2 shadow-xl space-y-1">
                <div className="px-3 py-1 text-[11px] font-semibold text-[#8696A0]">
                  Audio Output
                </div>
                {audioOutputs.map((dev) => (
                  <button
                    key={dev.deviceId}
                    type="button"
                    onClick={() => {
                      selectAudioOutput(dev.deviceId);
                      setShowDeviceMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs truncate cursor-pointer ${
                      selectedAudioOutputId === dev.deviceId
                        ? 'bg-[#00A884]/20 text-[#00A884] font-semibold'
                        : 'text-[#E9EDEF] hover:bg-white/5'
                    }`}
                  >
                    {dev.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Bottom Controls */}
          <div className="relative z-20 px-6 py-6 bg-[#111B21]/90 border-t border-[#222E35] flex items-center justify-center gap-4 sm:gap-6">
            <div className="relative flex items-center">
              <button
                type="button"
                onClick={() => {
                  if (audioOutputs.length > 1) {
                    setShowDeviceMenu((v) => !v);
                  } else {
                    toggleSpeakerMute();
                  }
                }}
                aria-label={isSpeakerMuted ? 'Unmute speaker' : 'Speaker audio'}
                title={audioOutputs.length > 1 ? 'Switch speaker output' : isSpeakerMuted ? 'Unmute speaker' : 'Mute speaker'}
                className={`min-w-[52px] min-h-[52px] rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                  isSpeakerMuted
                    ? 'bg-white text-[#111B21]'
                    : 'bg-[#202C33] hover:bg-[#2A3942] text-white'
                }`}
              >
                {isSpeakerMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
            </div>

            <button
              type="button"
              onClick={toggleMic}
              aria-label={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
              title={isMicMuted ? 'Unmute mic' : 'Mute mic'}
              className={`min-w-[52px] min-h-[52px] rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                isMicMuted ? 'bg-white text-[#111B21]' : 'bg-[#202C33] hover:bg-[#2A3942] text-white'
              }`}
            >
              {isMicMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            {isVideoCall && (
              <>
                <button
                  type="button"
                  onClick={toggleCamera}
                  aria-label={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
                  className={`min-w-[52px] min-h-[52px] rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                    isCameraOff ? 'bg-white text-[#111B21]' : 'bg-[#202C33] hover:bg-[#2A3942] text-white'
                  }`}
                >
                  {isCameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                </button>

                <button
                  type="button"
                  onClick={switchCamera}
                  aria-label="Switch camera"
                  className="min-w-[52px] min-h-[52px] rounded-full bg-[#202C33] hover:bg-[#2A3942] text-white flex items-center justify-center transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-5 h-5" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={endActiveCall}
              aria-label="End call"
              title="End call"
              className="min-w-[60px] min-h-[52px] px-6 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <PhoneOff className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
