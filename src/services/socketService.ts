import { io, Socket } from 'socket.io-client';
import { AvailableClaim } from '../types/mahjong';
import {
  MultiplayerGameState,
  ChatMessage,
  RoomListItem,
  RoomSettings,
} from '../types/multiplayer';

export interface UserProfile {
  userId: string;
  name: string;
  avatar: string;
}

const STORAGE_KEY_USER = 'wuxing_mahjong_user_profile';

export function getLocalUserProfile(): UserProfile {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_USER);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    // ignore
  }

  const randomAvatars = ['🐉', '🦅', '🐅', '🐢', '🦄', '☯️', '🎋', '⚡', '🔥', '🌊'];
  const randomNames = ['五行侠客', '天干道人', '地支仙尊', '太极宗师', '冲战先锋', '八卦掌门', '阴阳圣手'];
  const newProfile: UserProfile = {
    userId: 'user_' + Math.random().toString(36).substring(2, 10),
    name: randomNames[Math.floor(Math.random() * randomNames.length)] + '_' + Math.floor(Math.random() * 900 + 100),
    avatar: randomAvatars[Math.floor(Math.random() * randomAvatars.length)],
  };
  saveLocalUserProfile(newProfile);
  return newProfile;
}

export function saveLocalUserProfile(profile: UserProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(profile));
  } catch (e) {
    // ignore
  }
}

export const STORAGE_KEY_SERVER_URL = 'wuxing_mahjong_server_url';
export const DEFAULT_CLOUD_RELAY_URL = 'https://ais-dev-njguhqpd5y2a7es34qgqzk-689354523715.us-east1.run.app';

export interface ServerAddressConfig {
  protocol: 'http' | 'https';
  host: string;
  port: string;
}

/**
 * Parses any raw server string (e.g. "124.222.12.34:3000", "http://192.168.1.1:8080", "https://api.domain.com")
 * into structured components: protocol, host (IP/domain), and port.
 */
export function parseServerAddress(raw: string): ServerAddressConfig {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { protocol: 'http', host: '', port: '3000' };
  }

  let protocol: 'http' | 'https' = 'http';
  let rest = trimmed;

  if (/^https:\/\//i.test(trimmed)) {
    protocol = 'https';
    rest = trimmed.replace(/^https:\/\//i, '');
  } else if (/^http:\/\//i.test(trimmed)) {
    protocol = 'http';
    rest = trimmed.replace(/^http:\/\//i, '');
  } else if (/^\/\//.test(trimmed)) {
    rest = trimmed.replace(/^\/\//, '');
  }

  // Remove any trailing path/query/hash
  const hostAndPort = rest.split('/')[0].split('?')[0].split('#')[0];

  // If hostAndPort contains a colon for port (e.g. 192.168.1.1:3000)
  if (hostAndPort.includes(':')) {
    const colonIdx = hostAndPort.lastIndexOf(':');
    const host = hostAndPort.substring(0, colonIdx);
    const port = hostAndPort.substring(colonIdx + 1);
    return { protocol, host, port };
  }

  return { protocol, host: hostAndPort, port: '' };
}

/**
 * Builds a standardized URL from protocol, host (IP or domain), and port.
 */
export function buildServerAddress(protocol: 'http' | 'https', host: string, port: string): string {
  const cleanHost = host.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!cleanHost) return '';
  const cleanPort = port.trim();
  if (cleanPort) {
    return `${protocol}://${cleanHost}:${cleanPort}`;
  }
  return `${protocol}://${cleanHost}`;
}

/**
 * Normalizes any server address input into a standard valid URL.
 * Automatically adds protocol (defaulting to http:// for direct IPs, or current window protocol for paths)
 * and strips redundant slashes.
 */
export function normalizeServerAddress(raw: string, defaultProtocol?: 'http' | 'https'): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // If already starts with http:// or https://
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }

  // If protocol-relative //
  if (trimmed.startsWith('//')) {
    const proto = defaultProtocol || (typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https' : 'http');
    return `${proto}:${trimmed}`.replace(/\/+$/, '');
  }

  // Pure IP, IP:port, or domain:port
  const proto = defaultProtocol || 'http';
  return `${proto}://${trimmed}`.replace(/\/+$/, '');
}

export function isEdgeOneOrExternalStaticHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.run.app')) {
    return false;
  }
  return true;
}

export function getServerUrl(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_SERVER_URL);
    if (saved !== null) {
      const trimmed = saved.trim();
      return trimmed ? normalizeServerAddress(trimmed) : '';
    }
  } catch (e) {
    // ignore
  }
  // Check build-time env
  try {
    const metaEnv = (import.meta as any)?.env;
    if (metaEnv?.VITE_BACKEND_URL) {
      const envUrl = metaEnv.VITE_BACKEND_URL.trim();
      return envUrl ? normalizeServerAddress(envUrl) : '';
    }
  } catch (e) {
    // ignore
  }
  // If deployed on EdgeOne Makers (formerly Pages), or external static CDN, auto-default to Cloud Relay
  if (isEdgeOneOrExternalStaticHost()) {
    return DEFAULT_CLOUD_RELAY_URL;
  }
  return '';
}

export function saveServerUrl(url: string): void {
  try {
    const trimmed = url.trim();
    const normalized = trimmed ? normalizeServerAddress(trimmed) : '';
    localStorage.setItem(STORAGE_KEY_SERVER_URL, normalized);
  } catch (e) {
    // ignore
  }
}

export function resetToDefaultRelay(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_SERVER_URL);
  } catch (e) {}
  socketService.reconnectWithServerUrl(DEFAULT_CLOUD_RELAY_URL);
}

export function resetServerUrl(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_SERVER_URL);
  } catch (e) {}
  socketService.reconnectWithServerUrl('');
}

export function getEffectiveApiUrl(path: string): string {
  const base = getServerUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (!base) return cleanPath;
  const normalizedBase = normalizeServerAddress(base);
  return `${normalizedBase.replace(/\/+$/, '')}${cleanPath}`;
}

export async function testServerHealth(targetUrl?: string): Promise<{ success: boolean; latencyMs?: number; error?: string; message?: string }> {
  const rawBase = targetUrl !== undefined ? targetUrl.trim() : getServerUrl();
  const base = rawBase ? normalizeServerAddress(rawBase) : '';
  const start = Date.now();

  // 1. Try server-side deep diagnostics proxy if target is a custom remote IP/domain
  // This bypasses browser Mixed Content (HTTPS -> HTTP) and CORS blocks, performing actual DNS & TCP checks!
  if (base) {
    try {
      const diagnoseController = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const diagnoseTimer = diagnoseController ? setTimeout(() => diagnoseController.abort(), 6500) : null;
      const diagRes = await fetch(`/api/mahjong/diagnose-server?target=${encodeURIComponent(base)}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: diagnoseController ? diagnoseController.signal : undefined,
      });
      if (diagnoseTimer) clearTimeout(diagnoseTimer);

      if (diagRes.ok) {
        const report = await diagRes.json();
        if (report.success) {
          return { success: true, latencyMs: report.latencyMs || (Date.now() - start), message: report.message };
        } else {
          return { success: false, error: report.error || '诊断未通过' };
        }
      }
    } catch (diagErr) {
      // Diagnostic proxy unavailable or running on static-only hosting, fallback to direct fetch
    }
  }

  // 2. Direct browser fetch fallback
  const testPath = base ? `${base.replace(/\/+$/, '')}/api/health` : '/api/health';
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 6500) : null;

  try {
    const res = await fetch(testPath, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller ? controller.signal : undefined,
    });
    if (timeoutId) clearTimeout(timeoutId);
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }
    const data = await res.json();
    const latencyMs = Date.now() - start;
    if (data.status === 'ok') {
      return { success: true, latencyMs };
    }
    return { success: false, error: '服务器已响应，但未返回预期的 ok 状态' };
  } catch (e: any) {
    if (timeoutId) clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      return { success: false, error: '连接超时（6.5秒未响应），请检查服务器IP是否正确、云控制台安全组是否放行端口、服务是否已启动' };
    }
    const isHttpsPage = typeof window !== 'undefined' && window.location.protocol === 'https:';
    if (isHttpsPage && base.startsWith('http://')) {
      return {
        success: false,
        error: '跨协议拦截 (Mixed Content)：当前页面为 HTTPS，浏览器安全限制阻断了向未加密 http:// 接口的直接请求。建议使用域名并配置 SSL 证书，或一键切回官方云端对战中继。',
      };
    }
    return { success: false, error: e.message || '网络无法连接到该地址' };
  }
}

class SocketService {
  private socket: Socket | null = null;
  private isConnecting: boolean = false;
  private consecutiveErrors: number = 0;

  getSocket(): Socket {
    if (!this.socket) {
      const serverUrl = getServerUrl();
      const opts = {
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 30,
        reconnectionDelay: 1000,
        transports: ['polling', 'websocket'] as ('polling' | 'websocket')[],
      };

      if (serverUrl) {
        this.socket = io(serverUrl, opts);
      } else {
        this.socket = io(opts);
      }
    }
    return this.socket;
  }

  // Safe emit with timeout so client buttons never hang indefinitely on disconnected / broken servers
  private emitWithTimeout<T>(
    event: string,
    payload: any,
    callback?: (res: T) => void,
    timeoutMs: number = 6000,
    timeoutErrorMessage = '服务器响应超时，请检查对战服务器地址或点击【一键恢复官方云端中继】'
  ): void {
    if (!callback) {
      this.getSocket().emit(event, payload);
      return;
    }

    const socket = this.getSocket();
    if (!socket.connected) {
      socket.connect();
    }

    let hasResponded = false;
    const timer = setTimeout(() => {
      if (!hasResponded) {
        hasResponded = true;
        callback({ success: false, error: timeoutErrorMessage } as unknown as T);
      }
    }, timeoutMs);

    socket.emit(event, payload, (res: T) => {
      if (!hasResponded) {
        hasResponded = true;
        clearTimeout(timer);
        callback(res);
      }
    });
  }

  reconnectWithServerUrl(newUrl?: string): void {
    if (newUrl !== undefined) {
      saveServerUrl(newUrl);
    }
    if (this.socket) {
      try {
        this.socket.disconnect();
      } catch (e) {}
      this.socket = null;
    }
    this.isConnecting = false;
    this.consecutiveErrors = 0;
    this.connect();
  }

  getServerUrl(): string {
    return getServerUrl();
  }

  getEffectiveApiUrl(path: string): string {
    return getEffectiveApiUrl(path);
  }

  connect(): void {
    const s = this.getSocket();
    if (!s.connected && !this.isConnecting) {
      this.isConnecting = true;
      s.connect();
      s.on('connect', () => {
        this.isConnecting = false;
        this.consecutiveErrors = 0;
      });
      s.on('connect_error', () => {
        this.isConnecting = false;
        this.consecutiveErrors++;
        // If connecting to empty origin failed on an external host, auto fallback to Cloud Relay
        const currentUrl = getServerUrl();
        if (!currentUrl && isEdgeOneOrExternalStaticHost()) {
          this.reconnectWithServerUrl(DEFAULT_CLOUD_RELAY_URL);
        }
      });
    }
  }

  createRoom(
    roomName: string,
    settings: Partial<RoomSettings>,
    callback: (res: { success: boolean; roomId?: string; state?: MultiplayerGameState; error?: string }) => void
  ): void {
    const profile = getLocalUserProfile();
    this.emitWithTimeout(
      'room:create',
      {
        userId: profile.userId,
        name: profile.name,
        avatar: profile.avatar,
        roomName,
        settings,
      },
      callback,
      6000
    );
  }

  joinRoom(
    roomId: string,
    password?: string,
    callback?: (res: { success: boolean; roomId?: string; state?: MultiplayerGameState; error?: string; message?: string }) => void
  ): void {
    const profile = getLocalUserProfile();
    this.emitWithTimeout(
      'room:join',
      {
        roomId,
        userId: profile.userId,
        name: profile.name,
        avatar: profile.avatar,
        password,
      },
      callback,
      6000
    );
  }

  quickMatch(callback: (res: { success: boolean; roomId?: string; state?: MultiplayerGameState; error?: string }) => void): void {
    const profile = getLocalUserProfile();
    this.emitWithTimeout(
      'room:quick_match',
      {
        userId: profile.userId,
        name: profile.name,
        avatar: profile.avatar,
      },
      callback,
      7000
    );
  }

  syncRoom(
    roomId: string,
    callback?: (res: { success: boolean; state?: MultiplayerGameState; error?: string }) => void
  ): void {
    const profile = getLocalUserProfile();
    this.emitWithTimeout('room:sync', { roomId, userId: profile.userId }, callback, 5000);
  }

  leaveRoom(roomId: string, callback?: (res: { success: boolean }) => void): void {
    const profile = getLocalUserProfile();
    this.emitWithTimeout('room:leave', { roomId, userId: profile.userId }, callback, 4000);
  }

  setReady(roomId: string, isReady: boolean): void {
    const profile = getLocalUserProfile();
    this.getSocket().emit('room:set_ready', { roomId, userId: profile.userId, isReady });
  }

  addBot(roomId: string, seatIndex?: number, callback?: (res: { success: boolean; error?: string }) => void): void {
    this.emitWithTimeout('room:add_bot', { roomId, seatIndex }, callback, 5000);
  }

  fillBots(roomId: string, callback?: (res: { success: boolean; count?: number; error?: string }) => void): void {
    this.emitWithTimeout('room:fill_bots', { roomId }, callback, 5000);
  }

  kickSeat(roomId: string, seatIndex: number, callback?: (res: { success: boolean; error?: string }) => void): void {
    this.emitWithTimeout('room:kick_seat', { roomId, seatIndex }, callback, 5000);
  }

  startGame(roomId: string, callback?: (res: { success: boolean; error?: string }) => void): void {
    const profile = getLocalUserProfile();
    this.emitWithTimeout('room:start_game', { roomId, userId: profile.userId }, callback, 5000);
  }

  discard(roomId: string, tileId: string): void {
    const profile = getLocalUserProfile();
    this.getSocket().emit('room:discard', { roomId, userId: profile.userId, tileId });
  }

  submitClaim(roomId: string, claim: AvailableClaim | null): void {
    const profile = getLocalUserProfile();
    this.getSocket().emit('room:claim_action', { roomId, userId: profile.userId, claim });
  }

  selfDrawHu(roomId: string, callback?: (res: { success: boolean; error?: string }) => void): void {
    const profile = getLocalUserProfile();
    this.emitWithTimeout('room:self_draw_hu', { roomId, userId: profile.userId }, callback, 5000);
  }

  sendChat(roomId: string, text: string, type: 'text' | 'emoji' | 'shout' = 'text'): void {
    const profile = getLocalUserProfile();
    this.getSocket().emit('room:send_chat', {
      roomId,
      userId: profile.userId,
      name: profile.name,
      avatar: profile.avatar,
      text,
      type,
    });
  }

  nextRound(roomId: string, callback?: (res: { success: boolean; error?: string }) => void): void {
    const profile = getLocalUserProfile();
    this.emitWithTimeout('room:next_round', { roomId, userId: profile.userId }, callback, 5000);
  }

  restartGame(roomId: string, callback?: (res: { success: boolean; error?: string }) => void): void {
    const profile = getLocalUserProfile();
    this.emitWithTimeout('room:restart_game', { roomId, userId: profile.userId }, callback, 5000);
  }
}

export const socketService = new SocketService();
