/**
 * Real-Time Voice Chat Service for Online Multiplayer Mahjong
 * Provides microphone input, VAD (Voice Activity Detection),
 * Push-To-Talk, audio streaming over Socket.IO, volume metering,
 * and high-performance, low-latency audio playback with WeChat & Mobile WebKit optimizations.
 */

import { socketService } from './socketService';

export interface VoiceMember {
  userId: string;
  name: string;
  avatar?: string;
  isSpeaking: boolean;
  isMuted: boolean;
  volume: number; // 0.0 to 1.0 (local playback volume)
  lastHeardTime?: number;
}

export interface VoiceState {
  isInVoice: boolean;
  isConnecting: boolean;
  isMicMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
  voiceMode: 'vad' | 'ptt'; // vad: 自由开麦, ptt: 按键说话
  pttActive: boolean;
  inputLevel: number; // 0 - 100
  vadThreshold: number; // 5 - 50
  isEchoTesting: boolean; // 麦克风自检试音回环
  voiceMembers: VoiceMember[];
  error: string | null;
  supported: boolean;
  isListenOnly?: boolean; // 收听模式
}

type VoiceStateListener = (state: VoiceState) => void;

interface PeerPlaybackChannel {
  gainNode: GainNode;
  nextPlayTime: number;
}

class VoiceService {
  private currentRoomId: string | null = null;
  private currentUserId: string | null = null;
  private currentUserName: string = '';
  private currentUserAvatar: string = '';

  private mediaStream: MediaStream | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private echoGainNode: GainNode | null = null;
  private masterGainNode: GainNode | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;

  // PCM capture buffer
  private pcmChunkBuffer: number[] = [];
  private readonly TARGET_SAMPLE_RATE = 16000;
  private readonly CHUNK_SAMPLE_COUNT = 3200; // ~200ms per packet at 16kHz

  private state: VoiceState = {
    isInVoice: false,
    isConnecting: false,
    isMicMuted: false,
    isDeafened: false,
    isSpeaking: false,
    voiceMode: 'vad',
    pttActive: false,
    inputLevel: 0,
    vadThreshold: 15,
    isEchoTesting: false,
    voiceMembers: [],
    error: null,
    supported: typeof window !== 'undefined',
    isListenOnly: false,
  };

  private listeners: Set<VoiceStateListener> = new Set();
  private peerAudioNodes: Map<string, PeerPlaybackChannel> = new Map();
  private speakingTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    this.initWeChatAndMobileAudioUnlock();
  }

  /**
   * Register global user gesture listeners for WeChat and Mobile WebKit
   * to unlock AudioContext and enable immediate sound playback.
   */
  private initWeChatAndMobileAudioUnlock() {
    if (typeof window === 'undefined') return;

    const unlock = () => {
      this.unlockAudio();
    };

    const events = ['touchstart', 'touchend', 'click', 'pointerdown', 'keydown'];
    events.forEach((evt) => {
      window.addEventListener(evt, unlock, { passive: true, capture: true });
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('WeixinJSBridgeReady', unlock, { once: true });
    }
  }

  /**
   * Unlock AudioContext explicitly on user gesture
   */
  public unlockAudio(): AudioContext | null {
    try {
      const ctx = this.getOrCreateAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      // Play a 1-sample silent burst to prime hardware output pipeline
      if (ctx.state === 'running' || ctx.state === 'suspended') {
        const silentBuf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = silentBuf;
        src.connect(ctx.destination);
        src.start(0);
      }
      return ctx;
    } catch (e) {
      return null;
    }
  }

  private getOrCreateAudioContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
    }
    if (!this.masterGainNode && this.audioContext) {
      this.masterGainNode = this.audioContext.createGain();
      // 1.5x amplification for mobile phone loudspeaker clarity in WeChat
      this.masterGainNode.gain.value = 1.5;
      this.masterGainNode.connect(this.audioContext.destination);
    }
    return this.audioContext;
  }

  public subscribe(listener: VoiceStateListener): () => void {
    this.listeners.add(listener);
    listener({ ...this.state });
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const copy = { ...this.state, voiceMembers: [...this.state.voiceMembers] };
    this.listeners.forEach((l) => l(copy));
  }

  public getState(): VoiceState {
    return { ...this.state, voiceMembers: [...this.state.voiceMembers] };
  }

  /**
   * Connect and join voice chat for a given room.
   * If microphone is denied or unavailable, falls back to Listen-Only mode smoothly.
   */
  public async joinVoice(
    roomId: string,
    userId: string,
    name: string,
    avatar: string = ''
  ): Promise<boolean> {
    this.unlockAudio();

    if (this.state.isInVoice && this.currentRoomId === roomId) {
      return true;
    }

    this.currentRoomId = roomId;
    this.currentUserId = userId;
    this.currentUserName = name;
    this.currentUserAvatar = avatar;

    this.state.isConnecting = true;
    this.state.error = null;
    this.notify();

    // Ensure AudioContext is ready for receiving peer audio
    const ctx = this.getOrCreateAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    let micGranted = false;

    try {
      // 1. Request microphone access
      if (navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          this.mediaStream = stream;
          micGranted = true;

          // 2. Setup Web Audio Analyser & PCM ScriptProcessor
          const source = ctx.createMediaStreamSource(stream);
          this.mediaStreamSource = source;

          this.analyser = ctx.createAnalyser();
          this.analyser.fftSize = 256;
          this.analyser.smoothingTimeConstant = 0.4;
          source.connect(this.analyser);
          this.startLevelMonitoring();

          this.setupPCMStreaming(source, ctx.sampleRate);
        } catch (micErr: any) {
          console.warn('[VoiceService] Microphone access not granted, switching to listen mode:', micErr);
          // Gracefully continue in Listen-Only mode so user can still hear others!
          this.state.isListenOnly = true;
        }
      } else {
        this.state.isListenOnly = true;
      }

      // 3. Setup socket listeners
      this.attachSocketListeners();

      // 4. Emit voice:join to server
      const socket = socketService.getSocket();
      if (socket) {
        socket.emit('voice:join', {
          roomId,
          userId,
          name,
          avatar,
        });
      }

      this.state.isInVoice = true;
      this.state.isConnecting = false;
      this.state.error = micGranted
        ? null
        : '已进入收听模式（麦克风未授权或受限，您可正常收听道友发言）';
      this.notify();
      return true;
    } catch (err: any) {
      console.warn('[VoiceService] Failed to join voice:', err);
      this.leaveVoice();
      this.state.error = err.message || '无法连接语音房间';
      this.state.isConnecting = false;
      this.notify();
      return false;
    }
  }

  /**
   * Setup PCM recording via ScriptProcessorNode for universal WeChat/iOS/Android compatibility.
   */
  private setupPCMStreaming(source: MediaStreamAudioSourceNode, sampleRate: number) {
    if (!this.audioContext) return;

    // Buffer size 2048 gives low-latency processing without stutter
    const processor = this.audioContext.createScriptProcessor(2048, 1, 1);
    this.scriptProcessor = processor;
    this.pcmChunkBuffer = [];

    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (this.state.isMicMuted || this.state.isListenOnly) {
        this.pcmChunkBuffer = [];
        return;
      }

      const shouldTransmit =
        this.state.voiceMode === 'ptt' ? this.state.pttActive : this.state.isSpeaking;

      if (!shouldTransmit) {
        this.pcmChunkBuffer = [];
        return;
      }

      const input = e.inputBuffer.getChannelData(0);
      const downsampled = this.downsampleTo16kHz(input, sampleRate);

      // Accumulate samples
      for (let i = 0; i < downsampled.length; i++) {
        this.pcmChunkBuffer.push(downsampled[i]);
      }

      // When chunk is full (~200ms of audio), send packet
      if (this.pcmChunkBuffer.length >= this.CHUNK_SAMPLE_COUNT) {
        const samplesToSend = this.pcmChunkBuffer.splice(0, this.CHUNK_SAMPLE_COUNT);
        const int16Array = new Int16Array(samplesToSend.length);
        for (let i = 0; i < samplesToSend.length; i++) {
          const s = Math.max(-1, Math.min(1, samplesToSend[i]));
          int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        const base64 = this.int16ToBase64(int16Array);
        const socket = socketService.getSocket();
        if (socket?.connected && this.currentRoomId && this.currentUserId) {
          socket.emit('voice:data', {
            roomId: this.currentRoomId,
            userId: this.currentUserId,
            audioData: base64,
            mimeType: 'pcm/16000',
            sentAt: Date.now(),
          });
        }
      }
    };

    source.connect(processor);
    // Connect to destination through a zero gain to keep script processor alive without local feedback
    const silentGain = this.audioContext.createGain();
    silentGain.gain.value = 0;
    processor.connect(silentGain);
    silentGain.connect(this.audioContext.destination);
  }

  private downsampleTo16kHz(input: Float32Array, inputSampleRate: number): Float32Array {
    if (inputSampleRate === this.TARGET_SAMPLE_RATE) {
      return input;
    }
    const ratio = inputSampleRate / this.TARGET_SAMPLE_RATE;
    const newLength = Math.round(input.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const srcIdx = Math.floor(i * ratio);
      result[i] = input[srcIdx] || 0;
    }
    return result;
  }

  private int16ToBase64(int16: Int16Array): string {
    const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Leave current voice chat and release resources
   */
  public leaveVoice() {
    if (this.currentRoomId && this.currentUserId) {
      const socket = socketService.getSocket();
      if (socket?.connected) {
        socket.emit('voice:leave', {
          roomId: this.currentRoomId,
          userId: this.currentUserId,
        });
      }
    }

    this.detachSocketListeners();

    // Disconnect ScriptProcessor
    if (this.scriptProcessor) {
      try {
        this.scriptProcessor.disconnect();
      } catch (e) {}
      this.scriptProcessor = null;
    }
    this.pcmChunkBuffer = [];

    // Stop all audio tracks
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }

    if (this.echoGainNode) {
      try {
        this.mediaStreamSource?.disconnect(this.echoGainNode);
        this.echoGainNode.disconnect();
      } catch (e) {}
      this.echoGainNode = null;
    }
    this.mediaStreamSource = null;
    this.state.isEchoTesting = false;

    // Stop monitoring
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    // Clear peer channels
    this.peerAudioNodes.forEach((node) => {
      try {
        node.gainNode.disconnect();
      } catch (e) {}
    });
    this.peerAudioNodes.clear();

    this.speakingTimers.forEach((t) => clearTimeout(t));
    this.speakingTimers.clear();

    this.currentRoomId = null;
    this.currentUserId = null;

    this.state.isInVoice = false;
    this.state.isConnecting = false;
    this.state.isSpeaking = false;
    this.state.pttActive = false;
    this.state.inputLevel = 0;
    this.state.voiceMembers = [];
    this.state.isListenOnly = false;
    this.notify();
  }

  /**
   * Toggle microphone echo test (本地试音回环监听)
   */
  public toggleEchoTest(): boolean {
    const next = !this.state.isEchoTesting;
    this.setEchoTesting(next);
    return next;
  }

  public setEchoTesting(testing: boolean) {
    this.state.isEchoTesting = testing;

    if (!this.audioContext || !this.mediaStreamSource) {
      this.notify();
      return;
    }

    if (testing) {
      try {
        if (!this.echoGainNode) {
          this.echoGainNode = this.audioContext.createGain();
          this.echoGainNode.gain.value = 0.9;
        }
        this.mediaStreamSource.connect(this.echoGainNode);
        this.echoGainNode.connect(this.audioContext.destination);
      } catch (e) {
        console.warn('[VoiceService] Echo test setup error:', e);
      }
    } else {
      if (this.echoGainNode) {
        try {
          this.mediaStreamSource.disconnect(this.echoGainNode);
          this.echoGainNode.disconnect();
        } catch (e) {}
        this.echoGainNode = null;
      }
    }
    this.notify();
  }

  /**
   * Simulated Peer Voice Test (模拟道友发言试音)
   */
  public simulatePeerVoice(peerName: string = '清虚道长', avatar: string = '🧙‍♂️') {
    const simulatedId = `sim_peer_${peerName}`;
    let member = this.state.voiceMembers.find((m) => m.userId === simulatedId);
    if (!member) {
      member = {
        userId: simulatedId,
        name: peerName,
        avatar: avatar,
        isSpeaking: true,
        isMuted: false,
        volume: 1.0,
      };
      this.state.voiceMembers.push(member);
    } else {
      member.isSpeaking = true;
    }
    this.notify();

    // Synthesize harmonic pentatonic tones (宫商角徵羽)
    if (!this.state.isDeafened) {
      try {
        const ctx = this.getOrCreateAudioContext();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});

        const freqs = [261.63, 329.63, 392.0, 523.25];
        freqs.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.2);

          const startTime = ctx.currentTime + idx * 0.2;
          const duration = 0.45;
          gain.gain.setValueAtTime(0, startTime);
          gain.gain.linearRampToValueAtTime((member?.volume ?? 1) * 0.3, startTime + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

          osc.connect(gain);
          gain.connect(this.masterGainNode || ctx.destination);

          osc.start(startTime);
          osc.stop(startTime + duration);
        });
      } catch (e) {}
    }

    setTimeout(() => {
      if (member) {
        member.isSpeaking = false;
        this.notify();
      }
    }, 1800);
  }

  /**
   * Simulate Local Mic Activity (模拟本地开麦波动)
   */
  public simulateLocalSpeech() {
    if (this.state.isMicMuted) return;
    this.state.inputLevel = 80;
    this.setSpeaking(true);
    this.notify();

    setTimeout(() => {
      this.state.inputLevel = 45;
      this.notify();
    }, 800);

    setTimeout(() => {
      this.state.inputLevel = 0;
      this.setSpeaking(false);
      this.notify();
    }, 1500);
  }

  /**
   * Toggle local microphone mute
   */
  public toggleMicMute(): boolean {
    const next = !this.state.isMicMuted;
    this.setMicMuted(next);
    return next;
  }

  public setMicMuted(muted: boolean) {
    this.state.isMicMuted = muted;
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }

    if (muted && this.state.isSpeaking) {
      this.setSpeaking(false);
    }

    if (this.currentRoomId && this.currentUserId) {
      const socket = socketService.getSocket();
      socket?.emit('voice:mute_status', {
        roomId: this.currentRoomId,
        userId: this.currentUserId,
        isMuted: muted,
      });
    }

    this.notify();
  }

  /**
   * Toggle deafen (mute all room audio)
   */
  public toggleDeafened(): boolean {
    this.state.isDeafened = !this.state.isDeafened;
    this.notify();
    return this.state.isDeafened;
  }

  public setVoiceMode(mode: 'vad' | 'ptt') {
    this.state.voiceMode = mode;
    if (mode === 'ptt' && !this.state.pttActive) {
      this.setSpeaking(false);
    }
    this.notify();
  }

  public setPttActive(active: boolean) {
    if (this.state.isMicMuted) return;
    this.state.pttActive = active;
    this.setSpeaking(active);
    this.notify();
  }

  public setVadThreshold(threshold: number) {
    this.state.vadThreshold = Math.max(5, Math.min(50, threshold));
    this.notify();
  }

  public setMemberVolume(userId: string, volume: number) {
    const member = this.state.voiceMembers.find((m) => m.userId === userId);
    if (member) {
      member.volume = Math.max(0, Math.min(1, volume));
      const peerNode = this.peerAudioNodes.get(userId);
      if (peerNode) {
        peerNode.gainNode.gain.value = member.volume;
      }
      this.notify();
    }
  }

  /**
   * Audio Level & Voice Activity Detection Loop
   */
  private startLevelMonitoring() {
    const dataArray = new Uint8Array(this.analyser?.frequencyBinCount || 128);

    const update = () => {
      if (!this.analyser || !this.state.isInVoice) return;

      this.analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      const currentLevel = Math.min(100, Math.round((avg / 255) * 150));
      this.state.inputLevel = currentLevel;

      if (this.state.voiceMode === 'vad' && !this.state.isMicMuted) {
        const speakingNow = currentLevel >= this.state.vadThreshold;
        if (speakingNow !== this.state.isSpeaking) {
          this.setSpeaking(speakingNow);
        }
      }

      this.notify();
      this.animFrameId = requestAnimationFrame(update);
    };

    this.animFrameId = requestAnimationFrame(update);
  }

  private setSpeaking(speaking: boolean) {
    if (this.state.isSpeaking === speaking) return;
    this.state.isSpeaking = speaking;

    if (this.currentRoomId && this.currentUserId) {
      const socket = socketService.getSocket();
      socket?.emit('voice:speaking', {
        roomId: this.currentRoomId,
        userId: this.currentUserId,
        isSpeaking: speaking,
      });
    }
    this.notify();
  }

  /**
   * Socket event handlers
   */
  private handleUserJoined = (data: { userId: string; name: string; avatar?: string }) => {
    if (data.userId === this.currentUserId) return;
    const exists = this.state.voiceMembers.find((m) => m.userId === data.userId);
    if (!exists) {
      this.state.voiceMembers.push({
        userId: data.userId,
        name: data.name,
        avatar: data.avatar,
        isSpeaking: false,
        isMuted: false,
        volume: 1.0,
      });
      this.notify();
    }
  };

  private handleUserLeft = (data: { userId: string }) => {
    this.state.voiceMembers = this.state.voiceMembers.filter((m) => m.userId !== data.userId);
    const peerNode = this.peerAudioNodes.get(data.userId);
    if (peerNode) {
      try {
        peerNode.gainNode.disconnect();
      } catch (e) {}
      this.peerAudioNodes.delete(data.userId);
    }
    this.notify();
  };

  private handleSpeaking = (data: { userId: string; isSpeaking: boolean }) => {
    const member = this.state.voiceMembers.find((m) => m.userId === data.userId);
    if (member) {
      member.isSpeaking = data.isSpeaking;
      this.notify();
    }
  };

  private handleMuteStatus = (data: { userId: string; isMuted: boolean }) => {
    const member = this.state.voiceMembers.find((m) => m.userId === data.userId);
    if (member) {
      member.isMuted = data.isMuted;
      this.notify();
    }
  };

  /**
   * Receive and playback incoming audio chunks with high fidelity PCM & WeChat compatibility
   */
  private handleVoiceData = async (data: {
    userId: string;
    audioData: string;
    mimeType: string;
    sentAt?: number;
  }) => {
    if (data.userId === this.currentUserId || this.state.isDeafened) return;

    // Track member speaking status
    let member = this.state.voiceMembers.find((m) => m.userId === data.userId);
    if (!member) {
      member = {
        userId: data.userId,
        name: '牌友',
        isSpeaking: true,
        isMuted: false,
        volume: 1.0,
      };
      this.state.voiceMembers.push(member);
    } else {
      member.isSpeaking = true;
    }

    // Reset speaking timer
    if (this.speakingTimers.has(data.userId)) {
      clearTimeout(this.speakingTimers.get(data.userId)!);
    }
    const timer = setTimeout(() => {
      if (member) {
        member.isSpeaking = false;
        this.notify();
      }
    }, 450);
    this.speakingTimers.set(data.userId, timer);
    this.notify();

    // Play incoming audio chunk
    try {
      const ctx = this.getOrCreateAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }

      if (data.mimeType && data.mimeType.startsWith('pcm')) {
        // High fidelity PCM streaming - zero codec dependencies, 100% works on iOS WeChat & Android
        const binary = atob(data.audioData);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
          float32[i] = int16[i] / 32768.0;
        }

        const audioBuffer = ctx.createBuffer(1, float32.length, this.TARGET_SAMPLE_RATE);
        audioBuffer.copyToChannel(float32, 0);

        let peerChannel = this.peerAudioNodes.get(data.userId);
        if (!peerChannel) {
          const gainNode = ctx.createGain();
          gainNode.connect(this.masterGainNode || ctx.destination);
          peerChannel = { gainNode, nextPlayTime: ctx.currentTime };
          this.peerAudioNodes.set(data.userId, peerChannel);
        }

        peerChannel.gainNode.gain.value = member ? member.volume : 1.0;

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(peerChannel.gainNode);

        const now = ctx.currentTime;
        const startTime = Math.max(now, Math.min(now + 0.3, peerChannel.nextPlayTime));
        source.start(startTime);
        peerChannel.nextPlayTime = startTime + audioBuffer.duration;
      } else {
        // Fallback for legacy WebM or MP4 chunks
        const binary = atob(data.audioData);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        ctx.decodeAudioData(
          bytes.buffer.slice(0),
          (decodedBuffer) => {
            const source = ctx.createBufferSource();
            source.buffer = decodedBuffer;
            source.connect(this.masterGainNode || ctx.destination);
            source.start();
          },
          () => {
            // If Web Audio decodeAudioData fails (e.g. WebM on iOS), try HTML5 Audio
            this.fallbackPlayBlob(data.audioData, data.mimeType, member?.volume ?? 1.0);
          }
        );
      }
    } catch (e) {
      console.warn('[VoiceService] Playback error:', e);
    }
  };

  private fallbackPlayBlob(audioData: string, mimeType: string, volume: number) {
    try {
      const blob = this.base64ToBlob(audioData, mimeType || 'audio/webm');
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audio.volume = volume;
      audio.onended = () => URL.revokeObjectURL(audioUrl);
      audio.play().catch(() => {});
    } catch (e) {}
  }

  private handleSyncMembers = (
    members: {
      userId: string;
      name: string;
      avatar?: string;
      isSpeaking: boolean;
      isMuted: boolean;
    }[]
  ) => {
    if (!Array.isArray(members)) return;
    members.forEach((m) => {
      if (m.userId === this.currentUserId) return;
      const existing = this.state.voiceMembers.find((v) => v.userId === m.userId);
      if (!existing) {
        this.state.voiceMembers.push({
          userId: m.userId,
          name: m.name,
          avatar: m.avatar,
          isSpeaking: m.isSpeaking || false,
          isMuted: m.isMuted || false,
          volume: 1.0,
        });
      } else {
        existing.isMuted = m.isMuted || false;
        existing.isSpeaking = m.isSpeaking || false;
        if (m.name) existing.name = m.name;
        if (m.avatar) existing.avatar = m.avatar;
      }
    });
    this.notify();
  };

  private attachSocketListeners() {
    const socket = socketService.getSocket();
    if (!socket) return;
    socket.on('voice:sync_members', this.handleSyncMembers);
    socket.on('voice:user_joined', this.handleUserJoined);
    socket.on('voice:user_left', this.handleUserLeft);
    socket.on('voice:speaking', this.handleSpeaking);
    socket.on('voice:mute_status', this.handleMuteStatus);
    socket.on('voice:data', this.handleVoiceData);
  }

  private detachSocketListeners() {
    const socket = socketService.getSocket();
    if (!socket) return;
    socket.off('voice:sync_members', this.handleSyncMembers);
    socket.off('voice:user_joined', this.handleUserJoined);
    socket.off('voice:user_left', this.handleUserLeft);
    socket.off('voice:speaking', this.handleSpeaking);
    socket.off('voice:mute_status', this.handleMuteStatus);
    socket.off('voice:data', this.handleVoiceData);
  }

  private base64ToBlob(base64: string, mimeType: string): Blob {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  }
}

export const voiceService = new VoiceService();
