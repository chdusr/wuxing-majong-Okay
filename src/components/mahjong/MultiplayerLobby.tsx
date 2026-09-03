import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  Zap,
  Lock,
  Globe,
  RefreshCw,
  Edit3,
  Play,
  ArrowRight,
  Shield,
  Sparkles,
  Bot,
  UserCheck,
  Radio,
  Gamepad2,
  LogIn,
  Server,
  Wifi,
  WifiOff,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ExternalLink,
  Copy,
  Check,
  Network,
} from 'lucide-react';
import { RoomListItem, RoomSettings } from '../../types/multiplayer';
import {
  socketService,
  getLocalUserProfile,
  saveLocalUserProfile,
  UserProfile,
  getServerUrl,
  getEffectiveApiUrl,
  testServerHealth,
  parseServerAddress,
  buildServerAddress,
  normalizeServerAddress,
  DEFAULT_CLOUD_RELAY_URL,
  resetToDefaultRelay,
  resetServerUrl,
  CarrierSpeedTestResult,
} from '../../services/socketService';

interface MultiplayerLobbyProps {
  onJoinRoom: (roomId: string, state?: any) => void;
  onBackToSinglePlayer: () => void;
}

const AVATAR_OPTIONS = [
  '🐉', '🦅', '🐅', '🐢', '🦄', '☯️', '🎋', '⚡', '🔥', '🌊',
  '🏔️', '🌪️', '🪙', '🪵', '👑', '🀄', '🥷', '🧙‍♂️', '🧘', '🪭'
];

export const MultiplayerLobby: React.FC<MultiplayerLobbyProps> = ({
  onJoinRoom,
  onBackToSinglePlayer,
}) => {
  const [userProfile, setUserProfile] = useState<UserProfile>(getLocalUserProfile());
  const [isEditingProfile, setIsEditingProfile] = useState<boolean>(false);
  const [tempName, setTempName] = useState<string>(userProfile.name);
  const [tempAvatar, setTempAvatar] = useState<string>(userProfile.avatar);

  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(true);

  // Server Settings state
  const [isServerSettingsOpen, setIsServerSettingsOpen] = useState<boolean>(false);
  const [configTab, setConfigTab] = useState<'ipPort' | 'fullUrl'>('ipPort');
  const [ipProtocol, setIpProtocol] = useState<'http' | 'https'>('http');
  const [ipHost, setIpHost] = useState<string>('');
  const [ipPort, setIpPort] = useState<string>('3000');
  const [serverUrlInput, setServerUrlInput] = useState<string>(getServerUrl());
  const [testStatus, setTestStatus] = useState<{ testing: boolean; success?: boolean; latencyMs?: number; error?: string } | null>(null);
  const [copiedEffectiveUrl, setCopiedEffectiveUrl] = useState<boolean>(false);
  const [carrierResults, setCarrierResults] = useState<CarrierSpeedTestResult[] | null>(null);
  const [isTestingCarriers, setIsTestingCarriers] = useState<boolean>(false);

  const handleRunCarrierSpeedTest = async () => {
    setIsTestingCarriers(true);
    try {
      const results = await socketService.testCarrierSpeeds();
      setCarrierResults(results);
    } catch (e) {
      console.error('Carrier speed test error:', e);
    } finally {
      setIsTestingCarriers(false);
    }
  };

  // Open settings modal and parse current configuration
  const openServerSettings = () => {
    const current = getServerUrl();
    setServerUrlInput(current);
    const parsed = parseServerAddress(current);
    setIpProtocol(parsed.protocol);
    setIpHost(parsed.host);
    setIpPort(parsed.port || '3000');
    // If empty or custom domain / localhost, keep active
    if (current && !current.includes('.run.app') && !current.startsWith('http')) {
      setConfigTab('ipPort');
    } else {
      setConfigTab('fullUrl');
    }
    setTestStatus(null);
    setIsServerSettingsOpen(true);
  };

  // Get active target address from current tab
  const getTargetUrlToApply = (): string => {
    if (configTab === 'ipPort') {
      if (!ipHost.trim()) return '';
      return buildServerAddress(ipProtocol, ipHost.trim(), ipPort.trim());
    }
    return serverUrlInput.trim() ? normalizeServerAddress(serverUrlInput.trim()) : '';
  };

  // Create room modal state
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [customRoomName, setCustomRoomName] = useState<string>('');
  const [turnTimerSetting, setTurnTimerSetting] = useState<number>(20);
  const [autoFillBotsSetting, setAutoFillBotsSetting] = useState<boolean>(true);
  const [isPrivateSetting, setIsPrivateSetting] = useState<boolean>(false);
  const [passwordSetting, setPasswordSetting] = useState<string>('');

  // Join by code modal state
  const [isJoinByCodeOpen, setIsJoinByCodeOpen] = useState<boolean>(false);
  const [inputRoomCode, setInputRoomCode] = useState<string>('');
  const [inputPassword, setInputPassword] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [noticeBanner, setNoticeBanner] = useState<string>('');
  const [isQuickMatching, setIsQuickMatching] = useState<boolean>(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState<boolean>(false);
  const [isJoiningRoom, setIsJoiningRoom] = useState<boolean>(false);

  // Fetch rooms helper
  const fetchRooms = async (showLoading = false) => {
    if (showLoading) setIsLoadingRooms(true);
    try {
      const endpoint = getEffectiveApiUrl('/api/mahjong/rooms');
      let res: Response | null = null;
      try {
        res = await fetch(endpoint);
      } catch (networkErr) {
        // If configured remote endpoint fails (e.g. cross-origin/offline), fallback to relative local route
        if (endpoint !== '/api/mahjong/rooms') {
          try {
            res = await fetch('/api/mahjong/rooms');
          } catch {}
        }
      }
      if (res && res.ok) {
        const data = await res.json();
        if (data && data.rooms) {
          setRooms(data.rooms);
        }
        setIsConnected(true);
      } else {
        setIsConnected(false);
      }
    } catch (e: any) {
      setIsConnected(false);
    } finally {
      if (showLoading) setIsLoadingRooms(false);
    }
  };

  // Fetch initial rooms, listen to socket updates, and periodic sync
  useEffect(() => {
    socketService.connect();
    const socket = socketService.getSocket();

    fetchRooms(true);

    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => setIsConnected(false);
    const handleRoomsUpdate = (updatedRooms: RoomListItem[]) => {
      setRooms(updatedRooms);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('lobby:rooms_update', handleRoomsUpdate);

    // Periodic polling every 3.5 seconds
    const interval = setInterval(() => {
      fetchRooms(false);
    }, 3500);

    return () => {
      clearInterval(interval);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('lobby:rooms_update', handleRoomsUpdate);
    };
  }, []);

  const handleSaveProfile = () => {
    if (!tempName.trim()) return;
    const updated = {
      ...userProfile,
      name: tempName.trim(),
      avatar: tempAvatar,
    };
    setUserProfile(updated);
    saveLocalUserProfile(updated);
    setIsEditingProfile(false);
  };

  // Test server connectivity
  const handleTestServer = async (urlToTest: string) => {
    setTestStatus({ testing: true });
    const result = await testServerHealth(urlToTest);
    setTestStatus({
      testing: false,
      success: result.success,
      latencyMs: result.latencyMs,
      error: result.error,
    });
  };

  // Apply server URL and reconnect
  const handleApplyServerUrl = (urlToApply: string) => {
    socketService.reconnectWithServerUrl(urlToApply);
    setIsServerSettingsOpen(false);
    setTestStatus(null);
    setTimeout(() => {
      fetchRooms(true);
    }, 500);
  };

  // Restore same-origin default
  const handleResetToSameOrigin = () => {
    resetServerUrl();
    setServerUrlInput('');
    setIpHost('');
    setErrorMsg('');
    setNoticeBanner('已恢复为本站同域默认服务！正在重新同步房间列表...');
    setTimeout(() => {
      fetchRooms(true);
      setTimeout(() => setNoticeBanner(''), 4000);
    }, 400);
  };

  // Restore official cloud relay
  const handleResetToDefaultRelay = () => {
    resetToDefaultRelay();
    setServerUrlInput(DEFAULT_CLOUD_RELAY_URL);
    setErrorMsg('');
    setNoticeBanner('已切换为官方云端对战中继！正在重新同步房间列表...');
    setTimeout(() => {
      fetchRooms(true);
      setTimeout(() => setNoticeBanner(''), 4000);
    }, 400);
  };

  // Quick match
  const handleQuickMatch = () => {
    if (isQuickMatching) return;
    setErrorMsg('');
    setIsQuickMatching(true);
    socketService.quickMatch(res => {
      setIsQuickMatching(false);
      if (res.success && res.roomId) {
        onJoinRoom(res.roomId, res.state);
      } else {
        setErrorMsg(res.error || '匹配失败，请检查网络或点击【一键恢复官方云端中继】');
      }
    });
  };

  // Create room
  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingRoom) return;
    setIsCreatingRoom(true);
    setErrorMsg('');
    const roomTitle = customRoomName.trim() || `${userProfile.name}的五行修真台`;
    const settings: Partial<RoomSettings> = {
      turnTimeLimit: turnTimerSetting,
      autoFillBots: autoFillBotsSetting,
      isPrivate: isPrivateSetting,
      password: isPrivateSetting ? passwordSetting : '',
    };

    socketService.createRoom(roomTitle, settings, res => {
      setIsCreatingRoom(false);
      if (res.success && res.roomId) {
        setIsCreateOpen(false);
        onJoinRoom(res.roomId, res.state);
      } else {
        setErrorMsg(res.error || '创建房间失败，请检查对战服务连接或点击【一键恢复官方云端中继】');
      }
    });
  };

  // Join by room code
  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputRoomCode.trim() || isJoiningRoom) return;
    setIsJoiningRoom(true);
    setErrorMsg('');

    socketService.joinRoom(inputRoomCode.trim(), inputPassword, res => {
      setIsJoiningRoom(false);
      if (res.success && res.roomId) {
        setIsJoinByCodeOpen(false);
        onJoinRoom(res.roomId, res.state);
      } else {
        setErrorMsg(res.error || '加入房间失败，请确认房号是否存在');
      }
    });
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-3 sm:px-4 py-2 space-y-4 animate-in fade-in duration-300">
      
      {/* Top Banner / User Profile Card */}
      <div className="bg-gradient-to-r from-[#1E1238] via-[#2A1648] to-[#1E1238] border border-purple-500/30 rounded-3xl p-4 sm:p-5 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4">
        
        {/* User Info */}
        <div className="flex items-center gap-3.5 w-full sm:w-auto">
          <div className="relative">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-700 p-0.5 shadow-lg flex items-center justify-center text-3xl">
              <div className="w-full h-full bg-[#1A102E] rounded-2xl flex items-center justify-center">
                {userProfile.avatar}
              </div>
            </div>
            <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-[#1A102E] flex items-center justify-center">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
            </span>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-black text-amber-300 tracking-wide">
                {userProfile.name}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setTempName(userProfile.name);
                  setTempAvatar(userProfile.avatar);
                  setIsEditingProfile(true);
                }}
                className="p-1 rounded-lg bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white transition-colors"
                title="修改昵称与头像"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
              <span className="font-mono bg-purple-950/80 px-2 py-0.5 rounded-md border border-purple-500/30 text-purple-300">
                ID: {userProfile.userId.slice(-6)}
              </span>
              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                <Radio className="w-3 h-3 animate-pulse" /> 实时在线
              </span>
            </div>
          </div>
        </div>

        {/* Top Action Buttons */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
          <button
            type="button"
            onClick={openServerSettings}
            className="px-3 py-2 rounded-2xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition-all border border-white/10 flex items-center gap-1.5"
            title="配置对战服务器 IP/端口或云端中继"
          >
            <Server className="w-3.5 h-3.5 text-amber-400" />
            <span>服务器/IP:端口设置</span>
          </button>

          <button
            type="button"
            onClick={onBackToSinglePlayer}
            className="px-3.5 py-2 rounded-2xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition-all border border-white/10 flex items-center gap-1.5"
          >
            <Gamepad2 className="w-4 h-4 text-purple-400" />
            <span>单机练习</span>
          </button>

          <button
            type="button"
            onClick={handleQuickMatch}
            disabled={isQuickMatching}
            className="flex-1 sm:flex-initial px-5 py-2.5 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 disabled:opacity-60 text-amber-950 font-black text-xs sm:text-sm shadow-lg shadow-amber-500/30 transition-transform active:scale-95 flex items-center justify-center gap-2"
          >
            {isQuickMatching ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>正在极速匹配中...</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 fill-current" />
                <span>一键快速匹配</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Notice / Success alert banner */}
      {noticeBanner && (
        <div className="p-3.5 rounded-2xl bg-emerald-950/90 border border-emerald-500/50 text-emerald-200 text-xs font-bold flex items-center justify-between shadow-lg animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{noticeBanner}</span>
          </div>
          <button type="button" onClick={() => setNoticeBanner('')} className="text-emerald-400 hover:text-white px-2">✕</button>
        </div>
      )}

      {/* Connection Notice / EdgeOne helper banner */}
      {!isConnected && (
        <div className="p-3.5 rounded-2xl bg-amber-950/85 border border-amber-500/50 text-amber-200 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg animate-in fade-in">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>未连接到对战后端：</strong>当前地址无法连接。若自建服务器未启动或在静态环境部署，可一键切回官方云端中继立即联机。
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={handleResetToDefaultRelay}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-600 hover:to-yellow-500 text-amber-950 font-black text-xs transition-transform active:scale-95 shadow-md flex items-center gap-1.5"
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>⚡ 一键恢复官方云端中继</span>
            </button>
            <button
              type="button"
              onClick={openServerSettings}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 font-bold text-xs transition-colors"
            >
              设置服务器/IP端口
            </button>
          </div>
        </div>
      )}

      {/* Action Toolbar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="p-3.5 rounded-2xl bg-gradient-to-br from-[#2D1B4E] to-[#1E1136] border border-purple-500/40 hover:border-amber-400/60 transition-all flex items-center gap-3 group text-left shadow-md"
        >
          <div className="p-2.5 rounded-xl bg-purple-600/30 group-hover:bg-purple-600 text-purple-300 group-hover:text-white transition-colors">
            <Plus className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <div className="text-xs sm:text-sm font-bold text-white group-hover:text-amber-300 transition-colors">
              创建对战房间
            </div>
            <div className="text-[11px] text-slate-400">自定义倒计时与密码</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setIsJoinByCodeOpen(true)}
          className="p-3.5 rounded-2xl bg-gradient-to-br from-[#2D1B4E] to-[#1E1136] border border-purple-500/40 hover:border-amber-400/60 transition-all flex items-center gap-3 group text-left shadow-md"
        >
          <div className="p-2.5 rounded-xl bg-amber-600/30 group-hover:bg-amber-500 text-amber-300 group-hover:text-amber-950 transition-colors">
            <LogIn className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <div className="text-xs sm:text-sm font-bold text-white group-hover:text-amber-300 transition-colors">
              输入房号加入
            </div>
            <div className="text-[11px] text-slate-400">6位房间号极速入座</div>
          </div>
        </button>

        <div className="col-span-2 sm:col-span-1 p-3.5 rounded-2xl bg-gradient-to-br from-[#221538] to-[#180E29] border border-white/5 flex items-center justify-between text-xs">
          <div className="flex flex-col gap-0.5 text-slate-300">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
              <span className="text-[11px] text-slate-400">{isConnected ? '服务器在线' : '连接断开中...'}</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-300">
              <Users className="w-3.5 h-3.5 text-amber-400" />
              <span>活跃桌台：<b className="text-amber-300 font-mono">{rooms.length}</b> 局</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fetchRooms(true)}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
            title="刷新桌台列表"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingRooms ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error notification */}
      {errorMsg && (
        <div className="p-3 rounded-2xl bg-red-950/80 border border-red-500/50 text-red-300 text-xs font-bold flex items-center justify-between animate-in fade-in">
          <span>⚠️ {errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')} className="text-red-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Room List Container */}
      <div className="bg-[#140D22]/80 border border-purple-500/20 rounded-3xl p-4 sm:p-5 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-slate-200">全服公开对战大厅</h3>
          </div>
          <span className="text-[11px] text-slate-400">实时对局·满2人可开</span>
        </div>

        {rooms.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
            <div className="w-16 h-16 rounded-3xl bg-purple-950/60 border border-purple-500/30 flex items-center justify-center text-3xl">
              🀄
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-300">当前暂无等待中的公开房间</h4>
              <p className="text-xs text-slate-500 mt-1 max-w-xs">
                您可以点击上方“创建对战房间”或“一键快速匹配”开启首桌五行仙局！
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all shadow-md"
            >
              立即开房
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {rooms.map(room => (
              <div
                key={room.roomId}
                className="p-3.5 rounded-2xl bg-[#1D1330] border border-purple-500/30 hover:border-amber-400/50 transition-all flex flex-col justify-between gap-3 group shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black text-amber-300">{room.name}</span>
                      {room.isPrivate && (
                        <span className="px-1.5 py-0.5 rounded bg-red-950/80 text-red-300 border border-red-500/40 text-[9px] font-bold flex items-center gap-0.5">
                          <Lock className="w-2.5 h-2.5" /> 密码
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      房主：<span className="text-slate-300 font-medium">{room.hostName}</span>
                    </div>
                  </div>

                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-lg bg-black/40 border border-purple-500/30 text-purple-300">
                    #{room.roomId}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-white/5 text-xs">
                  <div className="flex items-center gap-2 text-slate-400">
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-amber-400" />
                      <b className="text-slate-200">{room.playerCount}/4 人</b>
                    </span>
                    <span className="text-[10px] text-slate-500">
                      ({room.settings.turnTimeLimit}s限时)
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (room.isPrivate) {
                        setInputRoomCode(room.roomId);
                        setIsJoinByCodeOpen(true);
                      } else {
                        socketService.joinRoom(room.roomId, undefined, res => {
                          if (res.success && res.roomId) onJoinRoom(res.roomId, res.state);
                          else setErrorMsg(res.error || '加入失败');
                        });
                      }
                    }}
                    className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-amber-950 font-black text-xs transition-transform active:scale-95 flex items-center gap-1 shadow-sm"
                  >
                    <span>{room.status === 'playing' ? '观战' : '入座'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Profile Edit Modal */}
      {isEditingProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-sm bg-[#1C1230] border border-purple-500/40 rounded-3xl p-5 shadow-2xl space-y-4">
            <h3 className="text-base font-black text-amber-300">个性名号与头像设置</h3>
            
            {/* Avatar Selector */}
            <div>
              <label className="text-xs text-slate-400 mb-2 block font-bold">选择五行道象头像：</label>
              <div className="grid grid-cols-5 gap-2 max-h-40 overflow-y-auto p-1 bg-black/30 rounded-2xl border border-white/5">
                {AVATAR_OPTIONS.map(av => (
                  <button
                    key={av}
                    type="button"
                    onClick={() => setTempAvatar(av)}
                    className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-all ${
                      tempAvatar === av
                        ? 'bg-amber-400 text-black scale-110 shadow-md ring-2 ring-amber-300'
                        : 'bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    {av}
                  </button>
                ))}
              </div>
            </div>

            {/* Name Input */}
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block font-bold">修道名号 (昵称)：</label>
              <input
                type="text"
                value={tempName}
                maxLength={10}
                onChange={e => setTempName(e.target.value)}
                placeholder="请输入你的昵称"
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-purple-500/30 text-white font-bold text-sm focus:outline-none focus:border-amber-400"
              />
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsEditingProfile(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 text-xs font-bold transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveProfile}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-600 hover:to-yellow-500 text-amber-950 text-xs font-black shadow-md transition-transform active:scale-95"
              >
                保存设置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Room Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <form onSubmit={handleCreateRoom} className="w-full max-w-md bg-[#1C1230] border border-purple-500/40 rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-black text-amber-300 flex items-center gap-2">
                <Plus className="w-5 h-5 text-amber-400" />
                <span>创建五行对战桌台</span>
              </h3>
              <button type="button" onClick={() => setIsCreateOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 mb-1.5 block font-bold">房间名称：</label>
                <input
                  type="text"
                  value={customRoomName}
                  onChange={e => setCustomRoomName(e.target.value)}
                  placeholder={`${userProfile.name}的五行修真台`}
                  maxLength={16}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-purple-500/30 text-white font-bold focus:outline-none focus:border-amber-400"
                />
              </div>

              {/* Turn Timer */}
              <div>
                <label className="text-slate-400 mb-1.5 block font-bold">出牌倒计时：</label>
                <div className="grid grid-cols-3 gap-2">
                  {[15, 20, 35].map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTurnTimerSetting(t)}
                      className={`py-2 rounded-xl font-bold border transition-all ${
                        turnTimerSetting === t
                          ? 'bg-amber-400 text-amber-950 border-amber-300 shadow-md'
                          : 'bg-black/30 text-slate-300 border-white/10 hover:bg-white/5'
                      }`}
                    >
                      {t} 秒 / 步
                    </button>
                  ))}
                </div>
              </div>

              {/* Auto Fill Bots Toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-black/30 border border-white/5">
                <div>
                  <div className="font-bold text-slate-200">开局自动补齐 AI 电脑人</div>
                  <div className="text-[10px] text-slate-400">若真实玩家不满4人，自动派驻五行道友陪练</div>
                </div>
                <input
                  type="checkbox"
                  checked={autoFillBotsSetting}
                  onChange={e => setAutoFillBotsSetting(e.target.checked)}
                  className="w-5 h-5 accent-amber-500 rounded cursor-pointer"
                />
              </div>

              {/* Private Room Toggle */}
              <div className="p-3 rounded-xl bg-black/30 border border-white/5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-slate-200">设为私密房间 (需密码入座)</div>
                  <input
                    type="checkbox"
                    checked={isPrivateSetting}
                    onChange={e => setIsPrivateSetting(e.target.checked)}
                    className="w-5 h-5 accent-amber-500 rounded cursor-pointer"
                  />
                </div>
                {isPrivateSetting && (
                  <input
                    type="password"
                    value={passwordSetting}
                    onChange={e => setPasswordSetting(e.target.value)}
                    placeholder="请输入4-6位入房密码"
                    maxLength={10}
                    className="w-full px-3 py-2 rounded-lg bg-black/50 border border-purple-500/30 text-white font-mono focus:outline-none focus:border-amber-400"
                  />
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 text-xs font-bold transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isCreatingRoom}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-600 hover:to-yellow-500 disabled:opacity-60 text-amber-950 text-xs font-black shadow-md transition-transform active:scale-95 flex items-center justify-center gap-1.5"
              >
                {isCreatingRoom && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{isCreatingRoom ? '正在创建...' : '立即创建'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Join By Code Modal */}
      {isJoinByCodeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <form onSubmit={handleJoinByCode} className="w-full max-w-sm bg-[#1C1230] border border-purple-500/40 rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-black text-amber-300 flex items-center gap-2">
                <LogIn className="w-5 h-5 text-amber-400" />
                <span>输入 6 位房间号</span>
              </h3>
              <button type="button" onClick={() => setIsJoinByCodeOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 mb-1.5 block font-bold">房间号 (6位数字)：</label>
                <input
                  type="text"
                  value={inputRoomCode}
                  onChange={e => setInputRoomCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="例如：682910"
                  maxLength={6}
                  className="w-full px-3.5 py-3 rounded-xl bg-black/40 border border-purple-500/30 text-center text-amber-300 font-mono text-xl tracking-widest font-black focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="text-slate-400 mb-1.5 block font-bold">房间密码 (若有)：</label>
                <input
                  type="password"
                  value={inputPassword}
                  onChange={e => setInputPassword(e.target.value)}
                  placeholder="无密码可留空"
                  className="w-full px-3 py-2.5 rounded-xl bg-black/40 border border-purple-500/30 text-white font-mono focus:outline-none focus:border-amber-400"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsJoinByCodeOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 text-xs font-bold transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isJoiningRoom}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-600 hover:to-yellow-500 disabled:opacity-60 text-amber-950 text-xs font-black shadow-md transition-transform active:scale-95 flex items-center justify-center gap-1.5"
              >
                {isJoiningRoom && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{isJoiningRoom ? '正在入座...' : '加入房间'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Server & IP:Port Settings Modal */}
      {isServerSettingsOpen && (() => {
        const isCurrentHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
        const activeTargetUrl = getTargetUrlToApply();
        const currentSavedUrl = getServerUrl();
        const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
        const effectiveAddressDisplay = currentSavedUrl || `同域默认 (${currentOrigin})`;
        const isIpMode = configTab === 'ipPort';

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="w-full max-w-lg bg-[#1C1230] border border-purple-500/40 rounded-3xl p-5 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 className="text-base font-black text-amber-300 flex items-center gap-2">
                  <Server className="w-5 h-5 text-amber-400" />
                  <span>联机服务器与 IP : 端口配置</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setIsServerSettingsOpen(false)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
                >
                  ✕
                </button>
              </div>

              {/* Current Status Box */}
              <div className="p-3.5 rounded-2xl bg-black/40 border border-white/10 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">当前连接状态：</span>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-bold text-xs ${
                      isConnected
                        ? 'bg-emerald-950 border border-emerald-500/50 text-emerald-300'
                        : 'bg-red-950 border border-red-500/50 text-red-300'
                    }`}
                  >
                    {isConnected ? (
                      <>
                        <Wifi className="w-3.5 h-3.5" /> 已连通服务
                      </>
                    ) : (
                      <>
                        <WifiOff className="w-3.5 h-3.5" /> 连接中断 / 未配置
                      </>
                    )}
                  </span>
                </div>

                <div className="text-xs text-slate-400 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 pt-1 border-t border-white/5">
                  <span className="shrink-0">当前生效后端地址：</span>
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    <span className="font-mono text-amber-300 text-[11px] px-2 py-0.5 rounded bg-black/60 border border-amber-500/20 truncate max-w-[230px]">
                      {effectiveAddressDisplay}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const textToCopy = currentSavedUrl || currentOrigin;
                        if (textToCopy) {
                          navigator.clipboard.writeText(textToCopy);
                          setCopiedEffectiveUrl(true);
                          setTimeout(() => setCopiedEffectiveUrl(false), 2000);
                        }
                      }}
                      className="p-1 rounded-md bg-white/10 hover:bg-white/20 text-slate-300 transition-colors shrink-0"
                      title="复制生效地址"
                    >
                      {copiedEffectiveUrl ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Mode Tabs */}
              <div className="flex items-center p-1 rounded-2xl bg-black/50 border border-purple-500/30 text-xs">
                <button
                  type="button"
                  onClick={() => setConfigTab('ipPort')}
                  className={`flex-1 py-2 rounded-xl font-bold transition-all flex items-center justify-center gap-1.5 ${
                    isIpMode
                      ? 'bg-gradient-to-r from-amber-500 to-yellow-400 text-amber-950 shadow-md'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Network className="w-3.5 h-3.5" />
                  <span>设置 IP 和端口 (推荐)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfigTab('fullUrl');
                    if (!serverUrlInput && ipHost.trim()) {
                      setServerUrlInput(buildServerAddress(ipProtocol, ipHost.trim(), ipPort.trim()));
                    }
                  }}
                  className={`flex-1 py-2 rounded-xl font-bold transition-all flex items-center justify-center gap-1.5 ${
                    !isIpMode
                      ? 'bg-gradient-to-r from-amber-500 to-yellow-400 text-amber-950 shadow-md'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>完整 URL / 快捷预设</span>
                </button>
              </div>

              {/* Tab 1: IP & Port Configuration */}
              {isIpMode ? (
                <div className="space-y-3.5 text-xs p-3.5 rounded-2xl bg-black/30 border border-white/5">
                  {/* Protocol & Port row */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {/* Protocol */}
                    <div className="space-y-1">
                      <label className="text-slate-300 font-bold block text-[11px]">
                        协议 (Protocol)：
                      </label>
                      <div className="flex rounded-xl bg-black/60 border border-purple-500/30 p-0.5">
                        <button
                          type="button"
                          onClick={() => setIpProtocol('http')}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                            ipProtocol === 'http'
                              ? 'bg-purple-700 text-white shadow-sm'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          http://
                        </button>
                        <button
                          type="button"
                          onClick={() => setIpProtocol('https')}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                            ipProtocol === 'https'
                              ? 'bg-purple-700 text-white shadow-sm'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          https://
                        </button>
                      </div>
                    </div>

                    {/* Port */}
                    <div className="sm:col-span-2 space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-slate-300 font-bold text-[11px]">
                          端口号 (Port)：
                        </label>
                        <span className="text-[10px] text-slate-400">默认 3000</span>
                      </div>
                      <input
                        type="text"
                        value={ipPort}
                        onChange={e => setIpPort(e.target.value.replace(/[^\d]/g, ''))}
                        placeholder="例如 3000"
                        className="w-full px-3 py-1.5 rounded-xl bg-black/60 border border-purple-500/30 text-white font-mono text-xs focus:outline-none focus:border-amber-400"
                      />
                    </div>
                  </div>

                  {/* Common port pills */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-slate-400">常用端口：</span>
                    {['3000', '8080', '80', '443'].map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setIpPort(p)}
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-mono border transition-all ${
                          ipPort === p
                            ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                            : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                        }`}
                      >
                        :{p}
                      </button>
                    ))}
                  </div>

                  {/* IP Address / Hostname */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-slate-300 font-bold text-[11px]">
                        服务器 IP 地址 / 域名 (Host / IP)：
                      </label>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setIpHost('127.0.0.1')}
                          className="text-[10px] text-amber-400/80 hover:text-amber-300 underline"
                        >
                          127.0.0.1
                        </button>
                        <span className="text-slate-600">|</span>
                        <button
                          type="button"
                          onClick={() => setIpHost('localhost')}
                          className="text-[10px] text-amber-400/80 hover:text-amber-300 underline"
                        >
                          localhost
                        </button>
                        <span className="text-slate-600">|</span>
                        <button
                          type="button"
                          onClick={() => setIpHost('')}
                          className="text-[10px] text-slate-400 hover:text-white underline"
                        >
                          清空
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={ipHost}
                      onChange={e => {
                        const raw = e.target.value.trim();
                        // Smart auto-parse if user pastes http://1.2.3.4:3000 or 1.2.3.4:3000
                        if (raw.includes('://') || (raw.includes(':') && !raw.startsWith('['))) {
                          const parsed = parseServerAddress(raw);
                          setIpProtocol(parsed.protocol);
                          setIpHost(parsed.host);
                          if (parsed.port) setIpPort(parsed.port);
                        } else {
                          setIpHost(raw);
                        }
                      }}
                      placeholder="例如 124.222.12.34 或 mahjong.example.com"
                      className="w-full px-3.5 py-2 rounded-xl bg-black/60 border border-purple-500/30 text-white font-mono text-xs focus:outline-none focus:border-amber-400"
                    />
                    <p className="text-[10px] text-slate-400">
                      支持直接填入公网 IP（如腾讯云/阿里云 ECS）、局域网 IP（如 192.168.x.x）或域名。
                    </p>
                  </div>

                  {/* Assembled URL Preview */}
                  <div className="p-2.5 rounded-xl bg-purple-950/30 border border-purple-500/20 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-400 shrink-0">拼装将生效地址：</span>
                    <span className="font-mono text-amber-300 text-xs font-bold truncate">
                      {activeTargetUrl || '留空 (将使用同域默认)'}
                    </span>
                  </div>
                </div>
              ) : (
                /* Tab 2: Full URL / Presets */
                <div className="space-y-3.5 text-xs p-3.5 rounded-2xl bg-black/30 border border-white/5">
                  <div className="space-y-1.5">
                    <label className="text-slate-300 block font-bold text-[11px]">
                      对战后端服务器完整 URL：
                    </label>
                    <input
                      type="text"
                      value={serverUrlInput}
                      onChange={e => {
                        const val = e.target.value;
                        setServerUrlInput(val);
                        if (val.trim()) {
                          const parsed = parseServerAddress(val);
                          setIpProtocol(parsed.protocol);
                          setIpHost(parsed.host);
                          if (parsed.port) setIpPort(parsed.port);
                        }
                      }}
                      placeholder="例如 http://124.222.12.34:3000 或 https://your-server.run.app"
                      className="w-full px-3.5 py-2 rounded-xl bg-black/60 border border-purple-500/30 text-white font-mono text-xs focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  {/* Presets */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] text-slate-400 font-bold">快捷预设切换：</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setServerUrlInput('');
                          setIpHost('');
                          handleTestServer('');
                        }}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          serverUrlInput === ''
                            ? 'bg-purple-900/60 border-amber-400/80 text-amber-300 ring-1 ring-amber-400/50'
                            : 'bg-black/40 border-white/10 text-slate-300 hover:bg-white/5'
                        }`}
                      >
                        <div className="font-bold text-xs flex items-center justify-between">
                          <span>🚀 本站同域 (标准部署)</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-normal border border-emerald-400/30">
                            默认推荐
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          直接连接当前站点后端服务（生产/容器环境）
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setServerUrlInput(DEFAULT_CLOUD_RELAY_URL);
                          const parsed = parseServerAddress(DEFAULT_CLOUD_RELAY_URL);
                          setIpProtocol(parsed.protocol);
                          setIpHost(parsed.host);
                          setIpPort(parsed.port || '443');
                          handleTestServer(DEFAULT_CLOUD_RELAY_URL);
                        }}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          serverUrlInput === DEFAULT_CLOUD_RELAY_URL
                            ? 'bg-purple-900/60 border-amber-400/80 text-amber-300 ring-1 ring-amber-400/50'
                            : 'bg-black/40 border-white/10 text-slate-300 hover:bg-white/5'
                        }`}
                      >
                        <div className="font-bold text-xs flex items-center gap-1.5 text-amber-400">
                          <span>🌐 官方云端对战中继</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          EdgeOne Makers 静态托管备用
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Mixed Content Security Warning */}
              {isCurrentHttps && activeTargetUrl.startsWith('http://') && (
                <div className="p-3.5 rounded-2xl bg-amber-950/70 border border-amber-500/40 text-amber-200 text-[11px] leading-relaxed space-y-1.5 animate-in fade-in">
                  <div className="font-bold flex items-center gap-1.5 text-amber-300">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>混合内容安全策略提示 (Mixed Content)</span>
                  </div>
                  <p>
                    当前前端页面运行于 <strong>HTTPS</strong> 加密环境。若后端使用未经 SSL 加密的 <strong>http://</strong>（如纯 IP:端口），现代浏览器通常会出于安全策略拦截跨协议连接。
                  </p>
                  <div className="text-amber-200/90 text-[10px] space-y-0.5 bg-black/30 p-2 rounded-xl border border-amber-500/20">
                    <div className="font-semibold text-amber-300">💡 推荐解决方案：</div>
                    <div>• <strong>生产联机</strong>：为您的服务器配置域名并在 Nginx 中开启 SSL 证书（HTTPS/WSS）；</div>
                    <div>• <strong>开发调试</strong>：在 Chrome 地址栏左侧【网站设置】中将【不安全内容】设为【允许】；</div>
                    <div>• <strong>免搭建对战</strong>：直接切换为【官方云端对战中继】免配证书！</div>
                  </div>
                </div>
              )}

              {/* Multi-Carrier Network Acceleration & Diagnostics */}
              <div className="p-3.5 rounded-2xl bg-[#1A102E] border border-purple-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                    <span>多运营商三网接入与智能加速 (电信 / 联通 / 移动 / BGP)</span>
                  </div>
                  <button
                    type="button"
                    disabled={isTestingCarriers}
                    onClick={handleRunCarrierSpeedTest}
                    className="px-2.5 py-1 rounded-lg bg-purple-600/50 hover:bg-purple-600 border border-purple-400/40 text-white text-[11px] font-bold transition-all flex items-center gap-1 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isTestingCarriers ? 'animate-spin' : ''}`} />
                    <span>{isTestingCarriers ? '测速中...' : '三网多线测速'}</span>
                  </button>
                </div>

                <div className="text-[11px] text-slate-300 leading-relaxed">
                  系统已集成<strong>双通道抗丢包引擎</strong>与<strong>多运营商智能路由</strong>，无论您使用电信宽带、联通光纤还是移动 5G，出牌与碰/杠均享极速零卡顿响应。
                </div>

                {/* Carrier Speed Results */}
                {carrierResults && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 animate-in fade-in">
                    {carrierResults.map(res => (
                      <div
                        key={res.carrier}
                        className="p-2.5 rounded-xl bg-black/50 border border-purple-500/20 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${
                            res.pingMs < 60 ? 'bg-emerald-400 animate-pulse' : res.pingMs < 120 ? 'bg-amber-400' : 'bg-rose-400'
                          }`} />
                          <span className="font-bold text-slate-200 text-[11px] truncate max-w-[150px]">
                            {res.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-amber-300 text-xs">
                            {res.pingMs}ms
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/30">
                            极速
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Ping Test Button & Result */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={testStatus?.testing}
                  onClick={() => handleTestServer(activeTargetUrl)}
                  className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${testStatus?.testing ? 'animate-spin' : ''}`} />
                  <span>{testStatus?.testing ? '测试中...' : '测试服务器连通性 (Ping)'}</span>
                </button>

                {testStatus && !testStatus.testing && (
                  <div
                    className={`text-xs font-bold flex items-center gap-1.5 ${
                      testStatus.success ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {testStatus.success ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>连通正常 (延迟: {testStatus.latencyMs}ms)</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-[11px] leading-tight">{testStatus.error}</span>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* EdgeOne Makers & Self-hosted Help Card */}
              <div className="p-3.5 rounded-2xl bg-gradient-to-br from-purple-950/40 to-black/40 border border-purple-500/20 text-slate-300 text-[11px] space-y-1.5 leading-relaxed">
                <div className="font-bold text-amber-300 flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
                  <span>自建 Linux / Docker 服务器对接说明</span>
                </div>
                <p>
                  1. <strong>端口放行</strong>：自建服务器运行后，请确保云服务商控制台（如腾讯云/阿里云安全组）已放行对应的端口（如 <code>{ipPort || '3000'}</code>）。
                </p>
                <p>
                  2. <strong>开箱即用</strong>：在 EdgeOne Makers 静态托管时，默认启用【官方云端对战中继】即可免去自建服务器流程，直接全网联机！
                </p>
              </div>

              {/* Modal Actions */}
              <div className="flex flex-col sm:flex-row items-center gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => {
                    handleResetToSameOrigin();
                    setIsServerSettingsOpen(false);
                  }}
                  className="w-full sm:w-auto px-3.5 py-2.5 rounded-xl bg-purple-900/70 hover:bg-purple-800 border border-purple-400/40 text-emerald-300 text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>恢复本站同域默认</span>
                </button>
                <div className="flex-1 w-full flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsServerSettingsOpen(false)}
                    className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 text-xs font-bold transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyServerUrl(activeTargetUrl)}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-600 hover:to-yellow-500 text-amber-950 text-xs font-black shadow-md transition-transform active:scale-95 flex items-center justify-center gap-1.5"
                  >
                    <Check className="w-4 h-4 stroke-[3]" />
                    <span>保存并立即生效</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
};
