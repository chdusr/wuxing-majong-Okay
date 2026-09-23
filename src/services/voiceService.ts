/**
 * Real-Time Voice Chat Service for Online Multiplayer Mahjong
 * Provides microphone input, VAD (Voice Activity Detection),
 * Push-To-Talk, audio streaming over Socket.IO, volume metering,
 * and audio playback with per-player volume control.
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
}

type VoiceStateListener = (state: VoiceState) => void;

class VoiceService {
  private currentRoomId: string | null = null;
  private currentUserId: string | null = null;
  private currentUserName: string = '';
  private currentUserAvatar: string = '';

  private mediaStream: MediaStream | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private echoGainNode: GainNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;

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
    supported: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
  };

  private listeners: Set<VoiceStateListener> = new Set();
  private peerAudios: Map<string, { audio: HTMLAudioElement; lastChunkTime: number }> = new Map();
  private speakingTimers: Map<string, NodeJS.Timeout> = new Map();
  private bestMimeType: string = '';

  constructor() {
    this.detectBestMimeType();
  }

  private detectBestMimeType() {
    if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') return;
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) {
        this.bestMimeType = t;
        break;
      }
    }
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
   * Connect and join voice chat for a given room
   */
  public async joinVoice(roomId: string, userId: string, name: string, avatar: string = ''): Promise<boolean> {
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

    try {
      // 1. Request microphone access
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('当前浏览器不支持麦克风音频捕获，请使用现代浏览器');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.mediaStream = stream;

      // 2. Setup Web Audio Analyser for VAD & level metering
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx();
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
        }
        const source = this.audioContext.createMediaStreamSource(stream);
        this.mediaStreamSource = source;
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.4;
        source.connect(this.analyser);
        this.startLevelMonitoring();
      }

      // 3. Setup MediaRecorder for streaming audio chunks
      if (typeof MediaRecorder !== 'undefined') {
        const options: MediaRecorderOptions = {};
        if (this.bestMimeType) {
          options.mimeType = this.bestMimeType;
        }
        this.mediaRecorder = new MediaRecorder(stream, options);

        this.mediaRecorder.ondataavailable = async (event: BlobEvent) => {
          if (!event.data || event.data.size === 0) return;
          if (this.state.isMicMuted) return;

          // Check if we should transmit
          const shouldTransmit =
            this.state.voiceMode === 'ptt' ? this.state.pttActive : this.state.isSpeaking;

          if (!shouldTransmit) return;

          try {
            const base64 = await this.blobToBase64(event.data);
            const socket = socketService.getSocket();
            if (socket?.connected && this.currentRoomId && this.currentUserId) {
              socket.emit('voice:data', {
                roomId: this.currentRoomId,
                userId: this.currentUserId,
                audioData: base64,
                mimeType: this.mediaRecorder?.mimeType || 'audio/webm',
              });
            }
          } catch (e) {
            // ignore chunk encoding error
          }
        };

        // Slice every 280ms
        this.mediaRecorder.start(280);
      }

      // 4. Setup socket listeners
      this.attachSocketListeners();

      // 5. Emit voice:join to server
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
      this.notify();
      return true;
    } catch (err: any) {
      console.warn('[VoiceService] Failed to join voice:', err);
      let errMsg = '无法连接麦克风语音';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errMsg = '麦克风权限被拒绝，请在浏览器地址栏允许麦克风权限后重试';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errMsg = '未检测到可用麦克风设备，请检查音频输入硬件';
      } else if (err.message) {
        errMsg = err.message;
      }

      this.leaveVoice();
      this.state.error = errMsg;
      this.state.isConnecting = false;
      this.notify();
      return false;
    }
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

    // Stop MediaRecorder
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch (e) {
        // ignore
      }
    }
    this.mediaRecorder = null;

    // Stop all audio tracks
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }

    if (this.echoGainNode) {
      try {
        this.mediaStreamSource?.disconnect(this.echoGainNode);
        this.echoGainNode.disconnect();
      } catch (e) {
        // ignore
      }
      this.echoGainNode = null;
    }
    this.mediaStreamSource = null;
    this.state.isEchoTesting = false;

    // Stop monitoring
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    // Close AudioContext
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (e) {
        // ignore
      }
      this.audioContext = null;
    }

    this.peerAudios.clear();
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
          this.echoGainNode.gain.value = 0.85;
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
        } catch (e) {
          // ignore
        }
        this.echoGainNode = null;
      }
    }
    this.notify();
  }

  /**
   * Simulated Peer Voice Test (模拟道友发言试音)
   * Plays a graceful pentatonic chime sequence and triggers speaking halo
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
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = this.audioContext || new AudioCtx();
        if (ctx.state === 'suspended') ctx.resume();

        const freqs = [261.63, 329.63, 392.0, 523.25];
        freqs.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.2);

          const startTime = ctx.currentTime + idx * 0.2;
          const duration = 0.45;
          gain.gain.setValueAtTime(0, startTime);
          gain.gain.linearRampToValueAtTime((member?.volume ?? 1) * 0.22, startTime + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(startTime);
          osc.stop(startTime + duration);
        });
      } catch (e) {
        // Audio synthesis fallback
      }
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

    // Broadcast mute status
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

  /**
   * Switch mode between 'vad' (自由开麦) and 'ptt' (按住说话)
   */
  public setVoiceMode(mode: 'vad' | 'ptt') {
    this.state.voiceMode = mode;
    if (mode === 'ptt' && !this.state.pttActive) {
      this.setSpeaking(false);
    }
    this.notify();
  }

  /**
   * Push-to-talk keydown / keyup
   */
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

      // Calculate volume RMS
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      // Scale 0 - 100
      const currentLevel = Math.min(100, Math.round((avg / 255) * 150));
      this.state.inputLevel = currentLevel;

      // In VAD mode, check against threshold
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
    this.peerAudios.delete(data.userId);
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

  private handleVoiceData = async (data: {
    userId: string;
    audioData: string;
    mimeType: string;
  }) => {
    if (data.userId === this.currentUserId || this.state.isDeafened) return;

    // Track member speaking status
    let member = this.state.voiceMembers.find((m) => m.userId === data.userId);
    if (!member) {
      // Auto-register member if not listed yet
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
      const blob = this.base64ToBlob(data.audioData, data.mimeType || 'audio/webm');
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audio.volume = member ? member.volume : 1.0;
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
      };
      await audio.play();
    } catch (e) {
      // Autoplay or decode error - ignore gracefully
    }
  };

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

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result as string;
        const base64 = res.split(',')[1] || '';
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
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
