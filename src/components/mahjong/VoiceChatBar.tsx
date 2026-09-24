import React, { useState, useEffect, useRef } from 'react';
import { useVoiceChat } from '../../hooks/useVoiceChat';
import { PlayerAvatar } from './PlayerAvatar';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Radio,
  Sliders,
  Users,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  PhoneCall,
  PhoneOff,
  Headphones,
  Sparkles,
  Play,
  Activity,
} from 'lucide-react';

interface VoiceChatBarProps {
  roomId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  roomPlayers?: { userId: string; name: string; avatar?: string }[];
  className?: string;
  compact?: boolean;
}

export const VoiceChatBar: React.FC<VoiceChatBarProps> = ({
  roomId,
  userId,
  userName,
  userAvatar = '👤',
  roomPlayers = [],
  className = '',
  compact = false,
}) => {
  const {
    isInVoice,
    isConnecting,
    isMicMuted,
    isDeafened,
    isSpeaking,
    voiceMode,
    pttActive,
    inputLevel,
    vadThreshold,
    isEchoTesting,
    voiceMembers,
    error,
    supported,
    isListenOnly,
    joinVoice,
    leaveVoice,
    toggleMicMute,
    toggleDeafened,
    setVoiceMode,
    setPttActive,
    setVadThreshold,
    setMemberVolume,
    toggleEchoTest,
    simulatePeerVoice,
    simulateLocalSpeech,
  } = useVoiceChat();

  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const pttButtonRef = useRef<HTMLButtonElement | null>(null);

  // Keyboard shortcut: hold Space or key 'v' for Push-to-Talk when enabled
  useEffect(() => {
    if (!isInVoice || voiceMode !== 'ptt') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.code === 'KeyV' && !e.repeat) {
        e.preventDefault();
        setPttActive(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.code === 'KeyV') {
        e.preventDefault();
        setPttActive(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isInVoice, voiceMode, setPttActive]);

  if (!supported) {
    return null;
  }

  // Count total participants in room who might be in voice
  const activeVoiceCount = voiceMembers.length + (isInVoice ? 1 : 0);

  return (
    <div
      className={`relative z-40 transition-all text-xs select-none ${className}`}
    >
      {/* Main Pill Bar */}
      <div className="flex items-center gap-1.5 bg-[#170E2B]/90 backdrop-blur-md border border-purple-500/30 rounded-2xl p-1.5 shadow-xl">
        {/* Connect/Disconnect Voice Button */}
        {!isInVoice ? (
          <button
            type="button"
            onClick={() => joinVoice(roomId, userId, userName, userAvatar)}
            disabled={isConnecting}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-md transition active:scale-95 disabled:opacity-50"
            title="开启实时语音聊天"
          >
            <PhoneCall className="w-3.5 h-3.5 animate-pulse text-emerald-200" />
            <span>{isConnecting ? '连接中...' : '进入语音'}</span>
          </button>
        ) : (
          <>
            {/* Connected Badge / Expand Button */}
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl bg-purple-950/70 hover:bg-purple-900/80 border border-purple-500/40 text-purple-200 font-bold transition"
              title="查看语音成员与设置"
            >
              <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
              <span className="hidden sm:inline">{isListenOnly ? '收听中' : '语音中'}</span>
              <span className="bg-emerald-500/30 text-emerald-300 px-1.5 py-0.2 rounded-full font-mono text-[10px]">
                {activeVoiceCount}人
              </span>
              {isListenOnly && (
                <span className="hidden xs:inline-block px-1 py-0.5 rounded bg-blue-950/80 border border-blue-500/40 text-blue-300 text-[10px]">
                  收听
                </span>
              )}
              {isExpanded ? (
                <ChevronUp className="w-3 h-3 text-slate-400" />
              ) : (
                <ChevronDown className="w-3 h-3 text-slate-400" />
              )}
            </button>

            {/* Microphone Mute Toggle */}
            <button
              type="button"
              onClick={toggleMicMute}
              disabled={isListenOnly}
              className={`p-1.5 rounded-xl border transition-all flex items-center justify-center ${
                isListenOnly
                  ? 'bg-slate-800/40 border-slate-700/50 text-slate-500 cursor-not-allowed'
                  : isMicMuted
                  ? 'bg-rose-500/20 border-rose-500/60 text-rose-400 hover:bg-rose-500/30'
                  : isSpeaking
                  ? 'bg-emerald-500/30 border-emerald-400 text-emerald-300 ring-2 ring-emerald-400/40 animate-pulse'
                  : 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'
              }`}
              title={
                isListenOnly
                  ? '当前处于收听模式，麦克风未开启'
                  : isMicMuted
                  ? '点击取消静音'
                  : '点击静音麦克风'
              }
            >
              {isListenOnly ? (
                <Headphones className="w-3.5 h-3.5 text-blue-300" />
              ) : isMicMuted ? (
                <MicOff className="w-3.5 h-3.5" />
              ) : (
                <Mic className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Input Level Bar (When speaking or unmuted) */}
            {!isMicMuted && (
              <div
                className="w-10 h-2 bg-black/40 rounded-full overflow-hidden border border-white/10 hidden sm:flex items-center px-0.5"
                title={`麦克风音量: ${inputLevel}%`}
              >
                <div
                  className={`h-1 rounded-full transition-all duration-75 ${
                    isSpeaking ? 'bg-emerald-400' : 'bg-slate-500'
                  }`}
                  style={{ width: `${Math.min(100, inputLevel)}%` }}
                />
              </div>
            )}

            {/* Deafen (All Mute) Toggle */}
            <button
              type="button"
              onClick={toggleDeafened}
              className={`p-1.5 rounded-xl border transition-all flex items-center justify-center ${
                isDeafened
                  ? 'bg-amber-500/20 border-amber-500/60 text-amber-400 hover:bg-amber-500/30'
                  : 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'
              }`}
              title={isDeafened ? '点击开启全场声音' : '点击静音全场语音'}
            >
              {isDeafened ? (
                <VolumeX className="w-3.5 h-3.5" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Push-to-Talk Quick Button (If in PTT mode) */}
            {voiceMode === 'ptt' && !isMicMuted && (
              <button
                ref={pttButtonRef}
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  setPttActive(true);
                }}
                onPointerUp={(e) => {
                  e.preventDefault();
                  setPttActive(false);
                }}
                onPointerLeave={() => setPttActive(false)}
                className={`px-2 py-1 rounded-xl text-[10px] font-black border transition select-none ${
                  pttActive
                    ? 'bg-emerald-500 text-slate-950 border-emerald-300 ring-2 ring-emerald-300 scale-105'
                    : 'bg-purple-900/60 text-purple-200 border-purple-500/40 hover:bg-purple-800/60'
                }`}
                title="按住此按钮或按键盘V键发言"
              >
                {pttActive ? '正在说话...' : '按住说话(V)'}
              </button>
            )}

            {/* Settings Toggle */}
            <button
              type="button"
              onClick={() => setShowSettings(!showSettings)}
              className={`p-1.5 rounded-xl border transition ${
                showSettings
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
              }`}
              title="语音设置"
            >
              <Sliders className="w-3.5 h-3.5" />
            </button>

            {/* Leave Voice Button */}
            <button
              type="button"
              onClick={leaveVoice}
              className="p-1.5 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/30 text-rose-400 transition"
              title="退出语音通话"
            >
              <PhoneOff className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Error Message Toast */}
      {error && (
        <div className="absolute top-full left-0 mt-2 w-72 p-2.5 rounded-2xl bg-rose-950/95 border border-rose-500/50 text-rose-200 text-xs shadow-2xl flex items-start gap-2 z-50">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold">语音权限提示</p>
            <p className="text-[11px] text-rose-300 mt-0.5 leading-relaxed">{error}</p>
          </div>
        </div>
      )}

      {/* Expanded Voice Members List & Controls */}
      {isInVoice && isExpanded && (
        <div className="absolute top-full left-0 sm:right-0 sm:left-auto mt-2 w-80 max-w-[90vw] p-3 rounded-2xl bg-[#1A102E]/95 backdrop-blur-xl border border-purple-500/40 shadow-2xl space-y-3 z-50 animate-in fade-in zoom-in-95">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-1.5 font-bold text-amber-300 text-xs">
              <Users className="w-3.5 h-3.5" />
              <span>实时语音席位</span>
            </div>
            <span className="text-[10px] text-emerald-400 font-mono bg-emerald-950/50 px-2 py-0.5 rounded-full border border-emerald-500/30">
              低延迟实时中继
            </span>
          </div>

          {/* Members List */}
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {/* Self */}
            <div className="flex items-center justify-between p-1.5 rounded-xl bg-purple-950/50 border border-purple-500/20">
              <div className="flex items-center gap-2">
                <PlayerAvatar
                  avatar={userAvatar}
                  name={userName}
                  size="sm"
                  isSpeaking={isSpeaking}
                  isMuted={isMicMuted}
                  isInVoice={true}
                />
                <div className="truncate">
                  <span className="text-slate-200 font-bold block truncate max-w-[100px]">
                    {userName} (我)
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {isMicMuted ? '已静音' : isSpeaking ? '正在发言' : '就绪'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {isSpeaking && (
                  <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded font-mono text-[9px] border border-emerald-500/40 animate-pulse">
                    说话中
                  </span>
                )}
              </div>
            </div>

            {/* Other Room Players */}
            {voiceMembers.length === 0 ? (
              <div className="text-center py-3 text-slate-400 text-xs">
                暂无其他牌友开启语音，静候同修入席
              </div>
            ) : (
              voiceMembers.map((member) => (
                <div
                  key={member.userId}
                  className="flex items-center justify-between p-1.5 rounded-xl bg-black/40 border border-white/5"
                >
                  <div className="flex items-center gap-2">
                    <PlayerAvatar
                      avatar={member.avatar}
                      name={member.name}
                      size="sm"
                      isSpeaking={member.isSpeaking}
                      isMuted={member.isMuted}
                      isInVoice={true}
                    />
                    <div className="truncate">
                      <span className="text-slate-200 font-bold block truncate max-w-[100px]">
                        {member.name}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {member.isMuted ? '已静音' : member.isSpeaking ? '说话中' : '连线中'}
                      </span>
                    </div>
                  </div>

                  {/* Volume Slider */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setMemberVolume(member.userId, member.volume > 0 ? 0 : 1)}
                      className={`p-1 rounded-lg ${
                        member.volume === 0
                          ? 'text-rose-400 bg-rose-950/60'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title={member.volume === 0 ? '取消静音' : '单人静音'}
                    >
                      {member.volume === 0 ? (
                        <VolumeX className="w-3 h-3" />
                      ) : (
                        <Volume2 className="w-3 h-3" />
                      )}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={member.volume}
                      onChange={(e) =>
                        setMemberVolume(member.userId, parseFloat(e.target.value))
                      }
                      className="w-14 h-1 accent-amber-400 bg-slate-700 rounded cursor-pointer"
                      title={`音量: ${Math.round(member.volume * 100)}%`}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Settings Panel */}
      {isInVoice && showSettings && (
        <div className="absolute top-full left-0 sm:right-0 sm:left-auto mt-2 w-72 p-3.5 rounded-2xl bg-[#1A102E]/95 backdrop-blur-xl border border-amber-500/40 shadow-2xl space-y-3 z-50 animate-in fade-in zoom-in-95">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <span className="font-bold text-amber-300 text-xs flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5" /> 语音模式配置
            </span>
            <button
              type="button"
              onClick={() => setShowSettings(false)}
              className="text-slate-400 hover:text-white text-xs px-1"
            >
              ✕
            </button>
          </div>

          {/* Mode Switch: VAD vs PTT */}
          <div className="space-y-1.5">
            <label className="text-slate-400 text-[11px] block">发言触发模式：</label>
            <div className="grid grid-cols-2 gap-1.5 bg-black/40 p-1 rounded-xl border border-white/5">
              <button
                type="button"
                onClick={() => setVoiceMode('vad')}
                className={`py-1.5 rounded-lg text-xs font-bold transition ${
                  voiceMode === 'vad'
                    ? 'bg-amber-400 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                自由发言(VAD)
              </button>
              <button
                type="button"
                onClick={() => setVoiceMode('ptt')}
                className={`py-1.5 rounded-lg text-xs font-bold transition ${
                  voiceMode === 'ptt'
                    ? 'bg-amber-400 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                按住说话(PTT)
              </button>
            </div>
          </div>

          {/* Sensitivity Slider (When in VAD mode) */}
          {voiceMode === 'vad' && (
            <div className="space-y-1 bg-black/30 p-2 rounded-xl border border-white/5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">灵敏度阈值：</span>
                <span className="font-mono text-amber-300">{vadThreshold}</span>
              </div>
              <input
                type="range"
                min="5"
                max="40"
                value={vadThreshold}
                onChange={(e) => setVadThreshold(parseInt(e.target.value, 10))}
                className="w-full h-1 accent-amber-400 bg-slate-700 rounded cursor-pointer"
              />
              <div className="flex justify-between text-[9px] text-slate-500">
                <span>更易触发</span>
                <span>滤除杂音</span>
              </div>
            </div>
          )}

          {voiceMode === 'ptt' && (
            <div className="text-[11px] text-slate-400 bg-black/30 p-2 rounded-xl border border-white/5 leading-relaxed">
              💡 提示：按住界面上的【按住说话】按钮或键盘 <span className="font-mono font-bold text-amber-300">V 键</span> 即可发言，松开自动停止。
            </div>
          )}

          {/* Voice Function Diagnostic & Testing Suite */}
          <div className="border-t border-white/10 pt-2.5 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-bold text-amber-300">
              <span className="flex items-center gap-1">
                <Activity className="w-3 h-3 text-amber-400" />
                <span>语音联调自检测试</span>
              </span>
              <span className="text-[9px] text-slate-400">实时功能验证</span>
            </div>

            <div className="space-y-1.5">
              {/* 1. Local Echo Test */}
              <button
                type="button"
                onClick={toggleEchoTest}
                className={`w-full py-1.5 px-2 rounded-xl text-xs font-bold border transition flex items-center justify-between ${
                  isEchoTesting
                    ? 'bg-amber-500/20 border-amber-400 text-amber-300 animate-pulse'
                    : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <Headphones className="w-3.5 h-3.5" />
                  <span>耳机耳返试音 (监听自己)</span>
                </div>
                <span className="text-[10px] font-mono font-normal">
                  {isEchoTesting ? '监听中 (再次点击关闭)' : '开始试音'}
                </span>
              </button>

              {/* 2. Simulated Peer Speaking Test */}
              <button
                type="button"
                onClick={() => simulatePeerVoice('清虚道长', '🧙‍♂️')}
                className="w-full py-1.5 px-2 rounded-xl text-xs font-bold bg-purple-900/50 hover:bg-purple-800/60 border border-purple-500/30 text-purple-200 transition flex items-center justify-between"
                title="模拟其他道友在语音中发言，验证多端音频播放与牌桌说话光晕"
              >
                <div className="flex items-center gap-1.5">
                  <Play className="w-3.5 h-3.5 text-amber-400" />
                  <span>模拟仙友发言 (测试音频/光晕)</span>
                </div>
                <span className="text-[10px] text-amber-300 font-mono">五音道鸣</span>
              </button>

              {/* 3. Simulate Local Speaking Spike */}
              <button
                type="button"
                onClick={simulateLocalSpeech}
                className="w-full py-1.5 px-2 rounded-xl text-xs font-bold bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-500/30 text-emerald-300 transition flex items-center justify-between"
                title="测试本地麦克风电平波动与说话广播同步"
              >
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>模拟本地开麦 (测试状态广播)</span>
                </div>
                <span className="text-[10px] text-emerald-400 font-mono">发信测试</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
