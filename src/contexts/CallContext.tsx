import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from './AuthContext';
import type { CallSession, CallType, PublicProfile } from '../types';
import { generateId } from '../utils/chatHelpers';
import { showBrowserNotification } from '../services/messaging';
import { incrementSystemStat } from '../services/moderation';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
};

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
}

interface CallContextValue {
  activeCall: CallSession | null;
  incomingCall: CallSession | null;
  callHistory: CallSession[];
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMicMuted: boolean;
  isCameraOff: boolean;
  isSpeakerMuted: boolean;
  audioOutputs: AudioOutputDevice[];
  selectedAudioOutputId: string;
  callError: string | null;
  callDurationSec: number;
  connectionState: RTCPeerConnectionState | 'idle';
  startCall: (peer: PublicProfile, chatId: string, callType: CallType) => Promise<void>;
  acceptIncomingCall: (asAudioOnly?: boolean) => Promise<void>;
  declineIncomingCall: () => Promise<void>;
  endActiveCall: () => Promise<void>;
  toggleMic: () => void;
  toggleCamera: () => void;
  toggleSpeakerMute: () => void;
  selectAudioOutput: (deviceId: string) => void;
  switchCamera: () => Promise<void>;
  clearCallError: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

function playTonePulse(ctx: AudioContext, mode: 'incoming' | 'outgoing'): void {
  const now = ctx.currentTime;
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.type = 'sine';
  osc2.type = 'sine';

  if (mode === 'incoming') {
    osc1.frequency.setValueAtTime(440, now);
    osc2.frequency.setValueAtTime(480, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.85);
    osc2.stop(now + 0.85);
  } else {
    // Softer standard North American ringback tone (440Hz + 480Hz) for outgoing caller
    osc1.frequency.setValueAtTime(440, now);
    osc2.frequency.setValueAtTime(480, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.035, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 1.05);
    osc2.stop(now + 1.05);
  }
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { publicProfile, firebaseUser, websiteSettings } = useAuth();

  const [activeCall, setActiveCall] = useState<CallSession | null>(null);
  const [incomingCall, setIncomingCall] = useState<CallSession | null>(null);
  const [callHistory, setCallHistory] = useState<CallSession[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [audioOutputs, setAudioOutputs] = useState<AudioOutputDevice[]>([]);
  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState<string>('default');
  const [callError, setCallError] = useState<string | null>(null);
  const [callDurationSec, setCallDurationSec] = useState(0);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | 'idle'>('idle');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const activeCallRef = useRef<CallSession | null>(null);
  const unsubCallDocRef = useRef<(() => void) | null>(null);
  const unsubCandidatesRef = useRef<(() => void) | null>(null);
  const ringTimerRef = useRef<number | null>(null);
  const ringtoneIntervalRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const iceSeqRef = useRef(0);
  const processedIceIdsRef = useRef<Set<string>>(new Set());
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescSetRef = useRef(false);
  const loggedCallIdsRef = useRef<Set<string>>(new Set());
  const answeredAtRef = useRef<number | null>(null);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  const refreshAudioOutputs = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices
        .filter((d) => d.kind === 'audiooutput')
        .map((d, idx) => ({
          deviceId: d.deviceId || `output-${idx}`,
          label: d.label || (idx === 0 ? 'Default Speaker' : `Audio Output ${idx + 1}`),
        }));
      setAudioOutputs(outputs);
    } catch {
      // Ignore permission restrictions
    }
  }, []);

  const stopRingtone = useCallback(() => {
    if (ringtoneIntervalRef.current !== null) {
      window.clearInterval(ringtoneIntervalRef.current);
      ringtoneIntervalRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const startRingtone = useCallback(
    (mode: 'incoming' | 'outgoing') => {
      stopRingtone();
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        playTonePulse(ctx, mode);
        ringtoneIntervalRef.current = window.setInterval(
          () => {
            if (ctx.state === 'suspended') {
              void ctx.resume().catch(() => {});
            }
            playTonePulse(ctx, mode);
          },
          mode === 'incoming' ? 2200 : 3200
        );
      } catch {
        // Browser autoplay may block audio before interaction
      }
    },
    [stopRingtone]
  );

  const flushPendingIceCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !remoteDescSetRef.current) return;
    const queued = [...pendingIceCandidatesRef.current];
    pendingIceCandidatesRef.current = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('Queued ICE add error:', err);
      }
    }
  }, []);

  const cleanupPeerResources = useCallback(() => {
    stopRingtone();
    if (ringTimerRef.current !== null) {
      window.clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }
    if (unsubCallDocRef.current) {
      unsubCallDocRef.current();
      unsubCallDocRef.current = null;
    }
    if (unsubCandidatesRef.current) {
      unsubCandidatesRef.current();
      unsubCandidatesRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((track) => track.stop());
      remoteStreamRef.current = null;
    }
    processedIceIdsRef.current.clear();
    pendingIceCandidatesRef.current = [];
    remoteDescSetRef.current = false;
    answeredAtRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setActiveCall(null);
    setIncomingCall(null);
    setIsMicMuted(false);
    setIsCameraOff(false);
    setIsSpeakerMuted(false);
    setCallDurationSec(0);
    setConnectionState('idle');
  }, [stopRingtone]);

  const logCallSummaryMessage = useCallback(
    async (session: CallSession, outcome: 'ended' | 'declined' | 'missed', durationSec: number) => {
      if (!publicProfile || loggedCallIdsRef.current.has(session.id)) return;
      if (session.callerId !== publicProfile.uid) return;
      loggedCallIdsRef.current.add(session.id);

      const label = session.callType === 'video' ? 'Video call' : 'Voice call';
      let summaryText = `${label} · Missed`;
      if (outcome === 'declined') summaryText = `${label} · Declined`;
      if (outcome === 'ended') {
        const mins = Math.floor(durationSec / 60);
        const secs = durationSec % 60;
        const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        summaryText = durationSec > 0 ? `${label} · ${formatted}` : `${label} · Ended`;
      }

      const msgId = generateId('msg');
      const batch = writeBatch(db);
      batch.set(doc(db, 'chats', session.chatId, 'messages', msgId), {
        chatId: session.chatId,
        senderId: publicProfile.uid,
        senderName: publicProfile.displayName,
        participantIds: session.participantIds,
        type: 'call',
        text: summaryText,
        mediaUrl: '',
        mediaMimeType: session.callType,
        mediaName: outcome,
        mediaDurationSec: durationSec,
        readBy: [publicProfile.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, 'chats', session.chatId), {
        lastMessageText: summaryText,
        lastMessageType: 'call',
        lastMessageSenderId: publicProfile.uid,
        lastMessageAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      try {
        await batch.commit();
        void incrementSystemStat('totalMessages');
      } catch (err) {
        console.warn('Could not log call summary:', err);
      }
    },
    [publicProfile]
  );

  // Duration timer when call is answered
  useEffect(() => {
    if (activeCall?.status !== 'answered') return;
    if (!answeredAtRef.current) {
      answeredAtRef.current = Date.now();
    }
    const timer = window.setInterval(() => {
      if (answeredAtRef.current) {
        setCallDurationSec(Math.floor((Date.now() - answeredAtRef.current) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeCall?.status]);

  // Listen to user's call sessions (incoming ringing + call history)
  useEffect(() => {
    if (!firebaseUser || !publicProfile) {
      setCallHistory([]);
      return;
    }

    const q = query(
      collection(db, 'calls'),
      where('participantIds', 'array-contains', firebaseUser.uid)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const allCalls: CallSession[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<CallSession, 'id'>),
        }));

        allCalls.sort((a, b) => {
          const tA = a.createdAt?.toMillis?.() ?? 0;
          const tB = b.createdAt?.toMillis?.() ?? 0;
          return tB - tA;
        });

        setCallHistory(allCalls.slice(0, 50));

        const ringingForMe = allCalls.find(
          (c) => c.calleeId === firebaseUser.uid && c.status === 'ringing'
        );

        if (ringingForMe && activeCallRef.current?.id !== ringingForMe.id) {
          setIncomingCall(ringingForMe);
          startRingtone('incoming');
          if (document.hidden) {
            showBrowserNotification(
              `Incoming ${ringingForMe.callType === 'video' ? 'video' : 'voice'} call`,
              `${ringingForMe.callerName} is calling you on VerdeChat`,
              ringingForMe.id
            );
          }
        } else if (!ringingForMe) {
          setIncomingCall((prev) => {
            if (prev && !activeCallRef.current) stopRingtone();
            return null;
          });
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'calls');
      }
    );

    return () => {
      unsub();
      stopRingtone();
    };
  }, [firebaseUser, publicProfile, startRingtone, stopRingtone]);

  const acquireUserMedia = async (wantVideo: boolean): Promise<{ stream: MediaStream; videoGranted: boolean }> => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microphone and camera access requires HTTPS in a modern browser.');
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: wantVideo ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      });
      void refreshAudioOutputs();
      return { stream, videoGranted: wantVideo };
    } catch (err) {
      if (wantVideo) {
        // Fallback to audio-only if camera hardware missing or denied
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
          void refreshAudioOutputs();
          setCallError('Camera unavailable — continuing with voice call.');
          return { stream: audioOnly, videoGranted: false };
        } catch {
          throw err;
        }
      }
      throw err;
    }
  };

  const subscribeToCallLifecycle = useCallback(
    (callId: string, role: 'caller' | 'callee', participantIds: string[]) => {
      const callRef = doc(db, 'calls', callId);
      remoteDescSetRef.current = role === 'callee';

      unsubCallDocRef.current = onSnapshot(
        callRef,
        async (snap) => {
          if (!snap.exists()) return;
          const data = { id: snap.id, ...(snap.data() as Omit<CallSession, 'id'>) };
          setActiveCall(data);

          if (role === 'caller' && data.answerSdp && !remoteDescSetRef.current && pcRef.current) {
            stopRingtone();
            if (ringTimerRef.current !== null) {
              window.clearTimeout(ringTimerRef.current);
              ringTimerRef.current = null;
            }
            try {
              await pcRef.current.setRemoteDescription(
                new RTCSessionDescription({
                  type: (data.answerType || 'answer') as RTCSdpType,
                  sdp: data.answerSdp,
                })
              );
              remoteDescSetRef.current = true;
              await flushPendingIceCandidates();
            } catch (err) {
              console.error('Failed to set remote answer description:', err);
            }
          }

          if (data.status === 'ended' || data.status === 'declined' || data.status === 'missed') {
            const elapsed = answeredAtRef.current
              ? Math.floor((Date.now() - answeredAtRef.current) / 1000)
              : 0;
            if (role === 'caller') {
              void logCallSummaryMessage(data, data.status, elapsed);
            }
            cleanupPeerResources();
          }
        },
        (err) => {
          handleFirestoreError(err, OperationType.GET, `calls/${callId}`);
        }
      );

      const remoteCandidatesSub = role === 'caller' ? 'calleeCandidates' : 'callerCandidates';
      const selfUid = publicProfile?.uid || participantIds[0];
      const candQuery = query(
        collection(db, 'calls', callId, remoteCandidatesSub),
        where('participantIds', 'array-contains', selfUid)
      );

      unsubCandidatesRef.current = onSnapshot(
        candQuery,
        (snap) => {
          snap.docChanges().forEach((change) => {
            if (change.type === 'added' && pcRef.current) {
              const id = change.doc.id;
              if (processedIceIdsRef.current.has(id)) return;
              processedIceIdsRef.current.add(id);
              const d = change.doc.data();
              if (d.candidate) {
                const candidateInit: RTCIceCandidateInit = {
                  candidate: d.candidate,
                  sdpMid: d.sdpMid || null,
                  sdpMLineIndex: typeof d.sdpMLineIndex === 'number' ? d.sdpMLineIndex : 0,
                };
                if (!remoteDescSetRef.current) {
                  pendingIceCandidatesRef.current.push(candidateInit);
                } else {
                  void pcRef.current
                    .addIceCandidate(new RTCIceCandidate(candidateInit))
                    .catch((err) => console.warn('ICE add error:', err));
                }
              }
            }
          });
        },
        (err) => {
          handleFirestoreError(err, OperationType.LIST, `calls/${callId}/${remoteCandidatesSub}`);
        }
      );
    },
    [cleanupPeerResources, flushPendingIceCandidates, logCallSummaryMessage, publicProfile?.uid, stopRingtone]
  );

  const startCall = async (peer: PublicProfile, chatId: string, callType: CallType) => {
    if (!publicProfile || activeCallRef.current) return;
    if (!websiteSettings.allowVoiceVideoCalls) {
      setCallError('Voice and video calling is currently paused by website settings.');
      return;
    }
    setCallError(null);
    pendingIceCandidatesRef.current = [];
    remoteDescSetRef.current = false;

    try {
      const { stream, videoGranted } = await acquireUserMedia(callType === 'video');
      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsCameraOff(!videoGranted);

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      const remote = new MediaStream();
      remoteStreamRef.current = remote;
      setRemoteStream(remote);

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.ontrack = (event) => {
        const incomingTracks = event.streams[0]?.getTracks() || (event.track ? [event.track] : []);
        incomingTracks.forEach((track) => {
          if (!remote.getTracks().some((t) => t.id === track.id)) {
            remote.addTrack(track);
          }
        });
        setRemoteStream(new MediaStream(remote.getTracks()));
      };

      pc.onconnectionstatechange = () => {
        setConnectionState(pc.connectionState);
        if (pc.connectionState === 'connected') {
          stopRingtone();
        }
      };

      const callId = generateId('call');
      const participantIds = [publicProfile.uid, peer.uid];

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candId = `ice_${Date.now()}_${++iceSeqRef.current}`;
          void setDoc(doc(db, 'calls', callId, 'callerCandidates', candId), {
            callId,
            senderId: publicProfile.uid,
            participantIds,
            candidate: event.candidate.candidate.slice(0, 2000),
            sdpMid: (event.candidate.sdpMid || '').slice(0, 100),
            sdpMLineIndex: event.candidate.sdpMLineIndex ?? 0,
            createdAt: serverTimestamp(),
          }).catch(() => {});
        }
      };

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: callType === 'video',
      });
      await pc.setLocalDescription(offer);

      const callPayload = {
        callerId: publicProfile.uid,
        callerName: publicProfile.displayName,
        callerPhoto: publicProfile.photoURL,
        calleeId: peer.uid,
        calleeName: peer.displayName,
        calleePhoto: peer.photoURL,
        chatId,
        participantIds,
        callType,
        status: 'ringing' as const,
        offerSdp: (offer.sdp || '').slice(0, 50000),
        offerType: offer.type || 'offer',
        answerSdp: '',
        answerType: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      setActiveCall({
        id: callId,
        ...callPayload,
        createdAt: null as unknown as CallSession['createdAt'],
        updatedAt: null as unknown as CallSession['updatedAt'],
      });

      await setDoc(doc(db, 'calls', callId), callPayload);
      void incrementSystemStat('totalCalls');
      subscribeToCallLifecycle(callId, 'caller', participantIds);
      startRingtone('outgoing');

      // Auto-mark missed after 45s if unanswered
      ringTimerRef.current = window.setTimeout(async () => {
        const cur = activeCallRef.current;
        if (cur && cur.id === callId && cur.status === 'ringing') {
          try {
            await updateDoc(doc(db, 'calls', callId), {
              status: 'missed',
              updatedAt: serverTimestamp(),
            });
          } catch {
            cleanupPeerResources();
          }
        }
      }, 45000);
    } catch (err) {
      cleanupPeerResources();
      const msg =
        err instanceof Error
          ? err.message
          : 'Microphone or camera permission was denied. Please allow access in your browser.';
      setCallError(msg);
    }
  };

  const acceptIncomingCall = async (asAudioOnly = false) => {
    if (!publicProfile || !incomingCall) return;
    const targetCall = incomingCall;
    stopRingtone();
    setIncomingCall(null);
    setCallError(null);
    pendingIceCandidatesRef.current = [];
    remoteDescSetRef.current = false;

    try {
      const wantVideo = targetCall.callType === 'video' && !asAudioOnly;
      const { stream, videoGranted } = await acquireUserMedia(wantVideo);
      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsCameraOff(!videoGranted);

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      const remote = new MediaStream();
      remoteStreamRef.current = remote;
      setRemoteStream(remote);

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.ontrack = (event) => {
        const incomingTracks = event.streams[0]?.getTracks() || (event.track ? [event.track] : []);
        incomingTracks.forEach((track) => {
          if (!remote.getTracks().some((t) => t.id === track.id)) {
            remote.addTrack(track);
          }
        });
        setRemoteStream(new MediaStream(remote.getTracks()));
      };

      pc.onconnectionstatechange = () => {
        setConnectionState(pc.connectionState);
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candId = `ice_${Date.now()}_${++iceSeqRef.current}`;
          void setDoc(doc(db, 'calls', targetCall.id, 'calleeCandidates', candId), {
            callId: targetCall.id,
            senderId: publicProfile.uid,
            participantIds: targetCall.participantIds,
            candidate: event.candidate.candidate.slice(0, 2000),
            sdpMid: (event.candidate.sdpMid || '').slice(0, 100),
            sdpMLineIndex: event.candidate.sdpMLineIndex ?? 0,
            createdAt: serverTimestamp(),
          }).catch(() => {});
        }
      };

      await pc.setRemoteDescription(
        new RTCSessionDescription({
          type: (targetCall.offerType || 'offer') as RTCSdpType,
          sdp: targetCall.offerSdp,
        })
      );
      remoteDescSetRef.current = true;

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await updateDoc(doc(db, 'calls', targetCall.id), {
        answerSdp: (answer.sdp || '').slice(0, 50000),
        answerType: answer.type || 'answer',
        status: 'answered',
        updatedAt: serverTimestamp(),
      });

      setActiveCall({ ...targetCall, status: 'answered' });
      subscribeToCallLifecycle(targetCall.id, 'callee', targetCall.participantIds);
      await flushPendingIceCandidates();
    } catch (err) {
      cleanupPeerResources();
      const msg =
        err instanceof Error
          ? err.message
          : 'Could not access microphone/camera to answer the call.';
      setCallError(msg);
      try {
        await updateDoc(doc(db, 'calls', targetCall.id), {
          status: 'declined',
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Ignore
      }
    }
  };

  const declineIncomingCall = async () => {
    if (!incomingCall) return;
    const callId = incomingCall.id;
    stopRingtone();
    setIncomingCall(null);
    try {
      await updateDoc(doc(db, 'calls', callId), {
        status: 'declined',
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `calls/${callId}`);
    }
  };

  const endActiveCall = async () => {
    const current = activeCallRef.current;
    if (!current) {
      cleanupPeerResources();
      return;
    }
    const elapsed = answeredAtRef.current
      ? Math.floor((Date.now() - answeredAtRef.current) / 1000)
      : 0;
    const nextStatus =
      current.status === 'ringing' && current.callerId === publicProfile?.uid ? 'missed' : 'ended';
    try {
      await updateDoc(doc(db, 'calls', current.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      if (current.callerId === publicProfile?.uid) {
        await logCallSummaryMessage(current, nextStatus, elapsed);
      }
    } catch {
      // Best effort
    } finally {
      cleanupPeerResources();
    }
  };

  const toggleMic = () => {
    if (!localStreamRef.current) return;
    const nextMuted = !isMicMuted;
    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMicMuted(nextMuted);
  };

  const toggleCamera = () => {
    if (!localStreamRef.current) return;
    const videoTracks = localStreamRef.current.getVideoTracks();
    if (videoTracks.length === 0) return;
    const nextOff = !isCameraOff;
    videoTracks.forEach((track) => {
      track.enabled = !nextOff;
    });
    setIsCameraOff(nextOff);
  };

  const toggleSpeakerMute = () => {
    setIsSpeakerMuted((prev) => !prev);
  };

  const selectAudioOutput = (deviceId: string) => {
    setSelectedAudioOutputId(deviceId);
  };

  const switchCamera = async () => {
    if (!localStreamRef.current || !pcRef.current) return;
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextMode },
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack) return;

      const sender = pcRef.current.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newVideoTrack);
      }
      localStreamRef.current.getVideoTracks().forEach((t) => {
        t.stop();
        localStreamRef.current?.removeTrack(t);
      });
      localStreamRef.current.addTrack(newVideoTrack);
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      setFacingMode(nextMode);
    } catch {
      setCallError('Unable to switch camera on this device.');
    }
  };

  return (
    <CallContext.Provider
      value={{
        activeCall,
        incomingCall,
        callHistory,
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
        startCall,
        acceptIncomingCall,
        declineIncomingCall,
        endActiveCall,
        toggleMic,
        toggleCamera,
        toggleSpeakerMute,
        selectAudioOutput,
        switchCamera,
        clearCallError: () => setCallError(null),
      }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used inside CallProvider');
  return ctx;
}
