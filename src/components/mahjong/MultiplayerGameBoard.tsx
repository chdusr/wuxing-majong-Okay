import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  MahjongTileData,
  Meld,
  HuResult,
  AvailableClaim,
} from '../../types/mahjong';
import {
  MultiplayerGameState,
  OnlinePlayer,
  ChatMessage,
} from '../../types/multiplayer';
import {
  socketService,
  getLocalUserProfile,
} from '../../services/socketService';
import {
  sortHand,
  checkHu,
  getTingTiles,
  findEatOptions,
  findPungOptions,
  findKongOptions,
  checkThreeTilesKan,
  HuAuditReport,
} from '../../utils/mahjongRules';
import {
  autoGroupHand,
  getSmartOrganizedHand,
  sortByClashPairs,
} from '../../utils/handOrganizer';
import {
  playTileClickSound,
  playTileDiscardSound,
  playClaimSound,
  triggerHaptic,
} from '../../utils/soundEffects';
import { MahjongTile } from './MahjongTile';
import { ClaimDialog } from './ClaimDialog';
import { HuCelebrationModal } from './HuCelebrationModal';
import { DrawSettlementModal } from './DrawSettlementModal';
import { HandOrganizerModal } from './HandOrganizerModal';
import { HuAuditModal } from './HuAuditModal';
import { RulebookView } from './RulebookView';
import { HandBuilder } from './HandBuilder';
import {
  Volume2,
  VolumeX,
  Sparkles,
  Zap,
  ArrowRight,
  Layers,
  ShieldAlert,
  Send,
  Radio,
  Clock,
  LogOut,
  RefreshCw,
  Crown,
  Bot,
  MessageCircle,
  HelpCircle,
  ShieldCheck,
  LayoutGrid,
  Rows,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  BookOpen,
  X,
  Swords,
  Activity,
} from 'lucide-react';

interface MultiplayerGameBoardProps {
  gameState: MultiplayerGameState;
  chatMessages: ChatMessage[];
  onLeaveRoom: () => void;
  onOpenRules: () => void;
}

const SEAT_NAMES = ['东风 (庄)', '南风', '西风', '北风'];
const QUICK_SHOUTS = [
  '⚡ 冲战碰！五行生克！',
  '🔥 碰！天干五合！',
  '🪵 吃！地支六合！',
  '🀄 听牌了，各位道友小心！',
  '🏆 准备胡大牌！',
  '💨 妙啊，这局难分难解！',
];

export const MultiplayerGameBoard: React.FC<MultiplayerGameBoardProps> = ({
  gameState,
  chatMessages,
  onLeaveRoom,
  onOpenRules,
}) => {
  const myProfile = getLocalUserProfile();
  const myPlayer = gameState.players.find(p => p?.userId === myProfile.userId);
  const mySeatIndex = myPlayer ? myPlayer.seatIndex : 0;
  const isMyTurn = gameState.currentTurn === mySeatIndex;

  // Local hand management for sorting & grouping
  const [localHand, setLocalHand] = useState<MahjongTileData[]>([]);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [isGroupedView, setIsGroupedView] = useState<boolean>(false);
  const [draggedTileIndex, setDraggedTileIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Modals state
  const [isOrganizerOpen, setIsOrganizerOpen] = useState<boolean>(false);
  const [isHuAuditOpen, setIsHuAuditOpen] = useState<boolean>(false);
  const [isRulesModalOpen, setIsRulesModalOpen] = useState<boolean>(false);
  const [isHandBuilderModalOpen, setIsHandBuilderModalOpen] = useState<boolean>(false);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [isLogsOpen, setIsLogsOpen] = useState<boolean>(false);
  const [chatInput, setChatInput] = useState<string>('');

  // Game activity live log
  const [gameLogs, setGameLogs] = useState<string[]>([
    `对局进行中 · 房间 #${gameState.roomId} (${gameState.roomName})`,
  ]);

  // Turn Countdown Remaining seconds
  const [countdown, setCountdown] = useState<number>(0);
  const [hasSubmittedClaim, setHasSubmittedClaim] = useState<boolean>(false);

  // Network Multi-Carrier Latency & Transport Status
  const [networkPing, setNetworkPing] = useState<number>(() => socketService.getLatency() || 28);
  const [networkTransport, setNetworkTransport] = useState<string>('websocket');

  useEffect(() => {
    const unsub = socketService.onPingUpdate((ping, transport) => {
      setNetworkPing(ping);
      setNetworkTransport(transport);
    });
    return unsub;
  }, []);

  // Add game log entry
  const addLog = (msg: string) => {
    setGameLogs(prev => [msg, ...prev.slice(0, 15)]);
  };

  // Track discards in logs
  const prevDiscardRef = useRef<string | null>(null);
  useEffect(() => {
    if (gameState.lastDiscard && gameState.lastDiscard.tile) {
      const discardKey = `${gameState.lastDiscard.playerIndex}_${gameState.lastDiscard.tile.id}`;
      if (prevDiscardRef.current !== discardKey) {
        prevDiscardRef.current = discardKey;
        const pName = gameState.players[gameState.lastDiscard.playerIndex]?.name || `玩家${gameState.lastDiscard.playerIndex + 1}`;
        addLog(`【${pName}】打出了【${gameState.lastDiscard.tile.name}】(${gameState.lastDiscard.tile.element})`);
      }
    }
  }, [gameState.lastDiscard, gameState.players]);

  // Reset claim submission state when discard changes
  useEffect(() => {
    setHasSubmittedClaim(false);
  }, [gameState.lastDiscard?.tile?.id, gameState.lastDiscard?.playerIndex]);

  // Sync hand with server updates while strictly preserving custom/smart-organized order
  useEffect(() => {
    if (!myPlayer?.hand) return;

    setLocalHand(prev => {
      const serverHand = myPlayer.hand!;
      if (serverHand.length === 0) return [];
      if (prev.length === 0) return serverHand;

      // Build map of server tiles with availability count
      const serverCounts = new Map<string, number>();
      const serverTileMap = new Map<string, MahjongTileData>();
      serverHand.forEach(t => {
        serverTileMap.set(t.id, t);
        serverCounts.set(t.id, (serverCounts.get(t.id) || 0) + 1);
      });

      // Also support fallback matching by tile name
      const serverNameCounts = new Map<string, MahjongTileData[]>();
      serverHand.forEach(t => {
        const list = serverNameCounts.get(t.name) || [];
        list.push(t);
        serverNameCounts.set(t.name, list);
      });

      // Preserve all tiles in prev that still exist on server
      const preserved: MahjongTileData[] = [];
      const usedIds = new Set<string>();

      for (const t of prev) {
        if (serverTileMap.has(t.id) && !usedIds.has(t.id)) {
          preserved.push(serverTileMap.get(t.id)!);
          usedIds.add(t.id);
        } else if (!usedIds.has(t.id)) {
          // Check if same tile name exists on server with unused ID
          const sameNameTiles = serverNameCounts.get(t.name);
          if (sameNameTiles && sameNameTiles.length > 0) {
            const match = sameNameTiles.find(st => !usedIds.has(st.id));
            if (match) {
              preserved.push(match);
              usedIds.add(match.id);
            }
          }
        }
      }

      // Collect any newly drawn or remaining tiles from server
      const newTiles = serverHand.filter(t => !usedIds.has(t.id));
      const combined = [...preserved, ...newTiles];

      // If length perfectly matches server hand, return organized combination
      if (combined.length === serverHand.length) {
        return combined;
      }

      // Safe fallback if count mismatch
      return serverHand;
    });
  }, [myPlayer?.hand]);

  // Turn Countdown Timer effect
  useEffect(() => {
    if (!gameState.turnDeadline) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((gameState.turnDeadline! - Date.now()) / 1000));
      setCountdown(remaining);
    }, 200);
    return () => clearInterval(interval);
  }, [gameState.turnDeadline]);

  // Relative seated players (0: Self, 1: Right, 2: Up/Opposite, 3: Left)
  const relativePlayers = useMemo(() => {
    return [
      { relativePos: 'self', seatIdx: mySeatIndex, player: gameState.players[mySeatIndex] },
      { relativePos: 'right', seatIdx: (mySeatIndex + 1) % 4, player: gameState.players[(mySeatIndex + 1) % 4] },
      { relativePos: 'opposite', seatIdx: (mySeatIndex + 2) % 4, player: gameState.players[(mySeatIndex + 2) % 4] },
      { relativePos: 'left', seatIdx: (mySeatIndex + 3) % 4, player: gameState.players[(mySeatIndex + 3) % 4] },
    ];
  }, [gameState.players, mySeatIndex]);

  // Check if I can claim the last discarded card
  const myPendingClaims = useMemo(() => {
    if (!gameState.lastDiscard || isMyTurn || !myPlayer || localHand.length === 0) {
      return null;
    }
    if (gameState.claimWindowDeadline && gameState.claimWindowDeadline < Date.now()) {
      return null;
    }
    const discardedTile = gameState.lastDiscard.tile;
    const discarderSeatIdx = gameState.lastDiscard.playerIndex;
    const isShangjia = (discarderSeatIdx + 1) % 4 === mySeatIndex;

    const claims: AvailableClaim[] = [];

    // 1. Hu
    const testHand = [...localHand, discardedTile];
    const huCheck = checkHu(testHand, myPlayer.melds, false, false);
    if (huCheck.isHu) {
      claims.push({
        type: 'hu',
        label: `捉炮胡牌 (${huCheck.fans}番 ${huCheck.explanation})`,
        tiles: [discardedTile],
        targetTile: discardedTile,
        priority: 100,
      });
    }

    // 2. Clash Pung & Normal Pung
    const { normalPung, clashPung } = findPungOptions(localHand, discardedTile);
    if (clashPung) {
      claims.push({
        type: 'clash_pung',
        label: `冲战碰 (${clashPung[0].name}${clashPung[1].name} 冲 ${discardedTile.name})`,
        tiles: clashPung,
        targetTile: discardedTile,
        priority: 80,
      });
    }
    if (normalPung) {
      claims.push({
        type: 'pung',
        label: `碰牌 (${normalPung[0].name}${normalPung[1].name}${discardedTile.name})`,
        tiles: normalPung,
        targetTile: discardedTile,
        priority: 50,
      });
    }

    // 3. Kong
    const kongOptions = findKongOptions(localHand, discardedTile);
    if (kongOptions.length > 0) {
      claims.push({
        type: 'kong',
        label: `大明杠 (${discardedTile.name}*4)`,
        tiles: kongOptions[0],
        targetTile: discardedTile,
        priority: 60,
      });
    }

    // 4. Eat (only if from Shangjia)
    if (isShangjia) {
      const eatOptions = findEatOptions(localHand, discardedTile);
      eatOptions.forEach(opt => {
        claims.push({
          type: 'eat',
          label: `吃牌 · ${opt.kan.typeLabel} (${opt.kan.name})`,
          tiles: opt.tiles,
          targetTile: discardedTile,
          priority: 20,
        });
      });
    }

    if (claims.length === 0) return null;
    return {
      targetTile: discardedTile,
      sourceIndex: discarderSeatIdx,
      claims,
    };
  }, [gameState.lastDiscard, isMyTurn, myPlayer, localHand, mySeatIndex]);

  // Check if Self-Draw Hu is available on my turn
  const canSelfDrawHu = useMemo(() => {
    if (!isMyTurn || !myPlayer || localHand.length === 0) return false;
    const res = checkHu(localHand, myPlayer.melds, false, false);
    return res.isHu;
  }, [isMyTurn, myPlayer, localHand]);

  // Ting (Ready to Hu) tiles hints with calculated fan details
  const tingList = useMemo(() => {
    if (!myPlayer || localHand.length === 0) return [];
    // 13 tiles, 10 tiles, 7 tiles, 4 tiles (i.e. length % 3 === 1) is ready-to-draw/listen state
    // Or 14 tiles (length % 3 === 2) on your turn
    return getTingTiles(localHand, myPlayer.melds);
  }, [myPlayer?.melds, localHand]);

  // Group human hand by true slots (Kans, Pair, Partial, Singles) when grouped view is enabled
  const handGroups = useMemo(() => {
    if (!isGroupedView || localHand.length === 0) {
      return [{ label: '', tiles: localHand, startIndex: 0 }];
    }
    const meldsCount = myPlayer?.melds?.length || 0;
    const grouped = autoGroupHand(localHand, meldsCount);
    const groups: Array<{ label: string; tiles: MahjongTileData[]; startIndex: number }> = [];
    let currentIdx = 0;

    // Add active Kan slots
    grouped.slots.forEach(slot => {
      if (slot.tiles.length > 0) {
        let label = slot.name;
        if (slot.type === 'kan') {
          const names = slot.tiles.map(t => t.name);
          const kanCheck = slot.tiles.length === 3 ? checkThreeTilesKan(names) : null;
          if (kanCheck?.isValid) {
            label = `${kanCheck.typeLabel}`;
          } else if (slot.tiles.length === 2) {
            label = `${slot.name} (待成)`;
          }
        }
        groups.push({
          label,
          tiles: slot.tiles,
          startIndex: currentIdx,
        });
        currentIdx += slot.tiles.length;
      }
    });

    // Add unassigned tiles
    if (grouped.unassigned.length > 0) {
      groups.push({
        label: '散牌',
        tiles: grouped.unassigned,
        startIndex: currentIdx,
      });
    }

    return groups.length > 0 ? groups : [{ label: '', tiles: localHand, startIndex: 0 }];
  }, [localHand, myPlayer?.melds?.length, isGroupedView]);

  // Handle tile discard
  const handleTileClick = (tile: MahjongTileData) => {
    if (!isMyTurn) {
      // Allow selection and reordering even when not your turn
      if (selectedTileId === tile.id) {
        setSelectedTileId(null);
      } else {
        if (soundEnabled) playTileClickSound();
        setSelectedTileId(tile.id);
      }
      return;
    }

    if (selectedTileId === tile.id) {
      // Second tap directly discards
      executeDiscard(tile.id);
    } else {
      if (soundEnabled) playTileClickSound();
      setSelectedTileId(tile.id);
    }
  };

  const executeDiscard = (tileId: string) => {
    if (!isMyTurn) return;
    if (soundEnabled) playTileDiscardSound();
    triggerHaptic('medium');

    // Optimistic discard: immediately remove tile from local hand for zero-delay instant feedback
    setLocalHand(prev => prev.filter(t => t.id !== tileId));
    setSelectedTileId(null);

    // Dual-channel dispatch (Socket + HTTP fallback)
    socketService.discard(gameState.roomId, tileId);
  };

  const handleDiscardSelected = () => {
    if (!isMyTurn || !selectedTileId) return;
    executeDiscard(selectedTileId);
  };

  // Hand Reordering Handlers (Move Left, Right, Start, End)
  const handleMoveTileLeft = (tileId: string) => {
    const idx = localHand.findIndex(t => t.id === tileId);
    if (idx > 0) {
      if (soundEnabled) playTileClickSound();
      triggerHaptic('light');
      const newHand = [...localHand];
      const [moved] = newHand.splice(idx, 1);
      newHand.splice(idx - 1, 0, moved);
      setLocalHand(newHand);
    }
  };

  const handleMoveTileRight = (tileId: string) => {
    const idx = localHand.findIndex(t => t.id === tileId);
    if (idx !== -1 && idx < localHand.length - 1) {
      if (soundEnabled) playTileClickSound();
      triggerHaptic('light');
      const newHand = [...localHand];
      const [moved] = newHand.splice(idx, 1);
      newHand.splice(idx + 1, 0, moved);
      setLocalHand(newHand);
    }
  };

  const handleMoveTileStart = (tileId: string) => {
    const idx = localHand.findIndex(t => t.id === tileId);
    if (idx > 0) {
      if (soundEnabled) playTileClickSound();
      triggerHaptic('medium');
      const newHand = [...localHand];
      const [moved] = newHand.splice(idx, 1);
      newHand.unshift(moved);
      setLocalHand(newHand);
    }
  };

  const handleMoveTileEnd = (tileId: string) => {
    const idx = localHand.findIndex(t => t.id === tileId);
    if (idx !== -1 && idx < localHand.length - 1) {
      if (soundEnabled) playTileClickSound();
      triggerHaptic('medium');
      const newHand = [...localHand];
      const [moved] = newHand.splice(idx, 1);
      newHand.push(moved);
      setLocalHand(newHand);
    }
  };

  const handleDropTile = (targetIndex: number) => {
    if (draggedTileIndex === null || draggedTileIndex === targetIndex) {
      setDraggedTileIndex(null);
      setDragOverIndex(null);
      return;
    }
    if (soundEnabled) playTileClickSound();
    triggerHaptic('light');
    const newHand = [...localHand];
    const [moved] = newHand.splice(draggedTileIndex, 1);
    newHand.splice(targetIndex, 0, moved);
    setLocalHand(newHand);
    setDraggedTileIndex(null);
    setDragOverIndex(null);
    addLog(`手牌位置微调完成`);
  };

  // Sorting & Organization Handlers
  const handleAutoOrganizeHand = () => {
    if (soundEnabled) playTileClickSound();
    triggerHaptic('medium');
    const meldsCount = myPlayer?.melds?.length || 0;
    const flattened = getSmartOrganizedHand(localHand, meldsCount);
    setLocalHand(flattened);
    addLog('已自动智能理牌 (成砍/对子优先，散牌归后)');
  };

  const handleSortHandByElement = () => {
    if (soundEnabled) playTileClickSound();
    triggerHaptic('light');
    setLocalHand(sortHand([...localHand]));
    addLog('已按五行干支序排列手牌');
  };

  const handleSortHandByClash = () => {
    if (soundEnabled) playTileClickSound();
    triggerHaptic('light');
    setLocalHand(sortByClashPairs([...localHand]));
    addLog('已按冲战克制序排列手牌');
  };

  // Claim actions
  const handleExecuteClaim = (claim: AvailableClaim) => {
    setHasSubmittedClaim(true);
    if (soundEnabled && claim.type !== 'pass') {
      playClaimSound(claim.type as 'eat' | 'pung' | 'clash_pung' | 'kong' | 'hu');
    }
    triggerHaptic('heavy');
    socketService.submitClaim(gameState.roomId, claim);
  };

  const handlePassClaim = () => {
    setHasSubmittedClaim(true);
    socketService.submitClaim(gameState.roomId, null);
  };

  const handleSelfDrawHuClick = () => {
    socketService.selfDrawHu(gameState.roomId, res => {
      if (!res.success) alert(res.error || '胡牌验证未通过');
    });
  };

  // Confirm Hu passed from Audit Console
  const handleConfirmHuFromAudit = (
    report: HuAuditReport,
    isSelfDrawAudit: boolean,
    discardTile?: MahjongTileData
  ) => {
    setIsHuAuditOpen(false);
    if (isSelfDrawAudit) {
      handleSelfDrawHuClick();
    } else if (discardTile) {
      const huClaim = myPendingClaims?.claims.find(c => c.type === 'hu');
      if (huClaim) {
        handleExecuteClaim(huClaim);
      } else {
        handleExecuteClaim({
          type: 'hu',
          label: `捉炮胡牌 (${report.fans}番 ${report.explanation})`,
          tiles: [discardTile],
          targetTile: discardTile,
          priority: 100,
        });
      }
    }
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    socketService.sendChat(gameState.roomId, chatInput.trim(), 'text');
    setChatInput('');
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-2 sm:px-4 py-1.5 space-y-2.5 animate-in fade-in select-none">
      
      {/* Table Top Status Bar & Quick Tools */}
      <div className="bg-[#180E29]/95 border border-purple-500/30 rounded-2xl p-2.5 sm:p-3 shadow-xl flex items-center justify-between gap-3 text-xs">
        
        {/* Left Room Info */}
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono font-black">
            #{gameState.roomId}
          </span>
          <span className="font-bold text-slate-200 truncate max-w-[100px] sm:max-w-[180px]">
            {gameState.roomName}
          </span>
          <span className="hidden sm:inline-flex items-center gap-1 text-emerald-400 font-bold text-[11px]">
            <Radio className="w-3 h-3 animate-pulse" /> 实时对决
          </span>
        </div>

        {/* Center Wall Remaining, Dice & Ticker */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-black/50 border border-purple-500/20 text-slate-300 font-mono">
            <span className="text-[10px] text-slate-400">牌墙余</span>
            <b className="text-amber-400 text-sm font-black">{gameState.wallRemaining}</b>
            <span className="text-[10px] text-slate-400">张</span>
          </div>

          {gameState.diceRoll && (
            <div className="hidden md:flex items-center gap-1 text-[11px] text-purple-300 bg-purple-950/70 px-2 py-1 rounded-lg border border-purple-500/30">
              <span>🎲 骰点: {gameState.diceRoll[0]}+{gameState.diceRoll[1]}</span>
            </div>
          )}

          {/* Quick Logs Drawer Trigger */}
          <button
            type="button"
            onClick={() => setIsLogsOpen(!isLogsOpen)}
            className={`hidden lg:flex items-center gap-1 px-2.5 py-1 rounded-xl border text-[11px] font-bold transition-all ${
              isLogsOpen
                ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                : 'bg-black/40 border-purple-500/20 text-slate-400 hover:text-white'
            }`}
            title="实时战报动态"
          >
            <Activity className="w-3.5 h-3.5" />
            <span className="truncate max-w-[140px]">{gameLogs[0] || '战况记录'}</span>
          </button>
        </div>

        {/* Right Tools Suite */}
        <div className="flex items-center gap-1.5">

          {/* Real-time Multi-Carrier Ping Badge */}
          <div
            className={`hidden sm:flex items-center gap-1 px-2 py-1 rounded-xl border text-[11px] font-mono font-bold transition-all ${
              networkPing < 70
                ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                : networkPing < 150
                ? 'bg-amber-950/60 border-amber-500/40 text-amber-300'
                : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
            }`}
            title={`当前网络延迟: ${networkPing}ms | 协议: ${networkTransport} | 支持电信/联通/移动/BGP三网融合与出牌双通道抗丢包`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${
              networkPing < 70 ? 'bg-emerald-400 animate-pulse' : networkPing < 150 ? 'bg-amber-400' : 'bg-rose-400'
            }`} />
            <span>{networkPing}ms</span>
            <span className="text-[10px] text-slate-400 font-sans hidden md:inline">三网加速</span>
          </div>
          
          {/* Quick Rules Modal Trigger */}
          <button
            type="button"
            onClick={() => setIsRulesModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-purple-950/80 hover:bg-purple-900 border border-purple-500/40 text-purple-200 text-xs font-bold transition-colors"
            title="查看五行干支生克规则图谱"
          >
            <BookOpen className="w-3.5 h-3.5 text-purple-400" />
            <span className="hidden sm:inline">规则图谱</span>
          </button>

          {/* Quick Hand Builder Tool Trigger */}
          <button
            type="button"
            onClick={() => setIsHandBuilderModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#221538] hover:bg-[#2F1D4F] border border-amber-500/30 text-amber-300 text-xs font-bold transition-colors"
            title="打开手牌验算器，推演胡牌与番数"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">排盘验算</span>
          </button>

          {/* Sound Toggle */}
          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            title="音效开关"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-amber-400" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Live Chat Drawer */}
          <button
            type="button"
            onClick={() => setIsChatOpen(!isChatOpen)}
            className="p-1.5 rounded-xl bg-purple-900/60 hover:bg-purple-800 text-purple-300 hover:text-white transition-colors relative"
            title="桌台发语"
          >
            <MessageCircle className="w-4 h-4" />
            {chatMessages.length > 0 && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>

          {/* Leave Room Button */}
          <button
            type="button"
            onClick={onLeaveRoom}
            className="px-2.5 py-1 rounded-xl bg-red-950/50 hover:bg-red-950 border border-red-500/30 text-red-300 text-[11px] font-bold transition-colors flex items-center gap-1"
            title="离开当前对战桌台"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">离桌</span>
          </button>
        </div>
      </div>

      {/* Floating Collapsible Live Logs Bar */}
      {isLogsOpen && (
        <div className="bg-[#140B22]/95 border border-purple-500/30 rounded-2xl p-2.5 shadow-xl animate-in fade-in space-y-1">
          <div className="flex items-center justify-between text-[11px] text-amber-300 font-bold border-b border-white/5 pb-1">
            <span className="flex items-center gap-1">
              <Activity className="w-3 h-3 text-amber-400" />
              <span>本局战况记录 (最近行动)</span>
            </span>
            <button
              type="button"
              onClick={() => setIsLogsOpen(false)}
              className="text-slate-400 hover:text-white"
            >
              ✕
            </button>
          </div>
          <div className="max-h-24 overflow-y-auto space-y-0.5 text-xs text-slate-300 font-mono">
            {gameLogs.map((log, lIdx) => (
              <div key={lIdx} className="flex items-center gap-1.5 py-0.5 border-b border-white/5 last:border-0">
                <span className="text-purple-400 text-[10px]">#{lIdx + 1}</span>
                <span>{log}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4-Way Mahjong Table Canvas */}
      <div className="relative bg-gradient-to-b from-[#110A1F] via-[#1B112E] to-[#120B20] border-2 border-purple-500/30 rounded-3xl p-3 sm:p-5 shadow-2xl min-h-[530px] flex flex-col justify-between overflow-hidden">
        
        {/* Table Felt Subtle Glow Center */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(147,51,234,0.14)_0%,transparent_70%)] pointer-events-none" />

        {/* TOP: Opposite Player (北风/对家) */}
        {(() => {
          const { player, seatIdx } = relativePlayers[2];
          const isTurn = gameState.currentTurn === seatIdx;
          const isDealer = gameState.dealerIndex === seatIdx;

          return (
            <div className="flex flex-col items-center z-10">
              <div className={`flex items-center gap-2 px-3 py-1 rounded-2xl border transition-all ${
                isTurn
                  ? 'bg-amber-400/20 border-amber-400 shadow-md shadow-amber-400/20 animate-pulse'
                  : 'bg-black/40 border-purple-500/20'
              }`}>
                <span className="text-xl">{player?.avatar || '👤'}</span>
                <span className="font-bold text-xs text-slate-200 truncate max-w-[100px]">
                  {player?.name || '对家'}
                </span>
                {isDealer && <Crown className="w-3.5 h-3.5 text-amber-400" title="庄家" />}
                <span className="text-[10px] text-amber-300 font-mono">{SEAT_NAMES[seatIdx]}</span>
                <span className="text-[10px] text-slate-400">({player?.handCount ?? 13}张)</span>
              </div>

              {/* Opponent Melds */}
              <div className="flex flex-wrap gap-1 mt-1 justify-center max-w-md">
                {player?.melds.map((meld, mIdx) => (
                  <div key={mIdx} className="flex gap-0.5 bg-black/40 p-0.5 rounded-lg border border-purple-500/20 scale-90">
                    <span className="text-[9px] text-amber-300 self-center px-0.5 font-bold">{meld.typeLabel}</span>
                    {meld.tiles.map((t, tIdx) => (
                      <MahjongTile key={tIdx} tile={t} size="sm" />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* MIDDLE SECTION: Left Player (上家) | Table Center (Discards & Turn Dial) | Right Player (下家) */}
        <div className="grid grid-cols-12 items-center gap-2 my-2 z-10">
          
          {/* Left Player (上家) */}
          <div className="col-span-3 flex flex-col items-start space-y-1">
            {(() => {
              const { player, seatIdx } = relativePlayers[3];
              const isTurn = gameState.currentTurn === seatIdx;
              const isDealer = gameState.dealerIndex === seatIdx;

              return (
                <div className={`p-2 rounded-2xl border transition-all w-full max-w-[130px] ${
                  isTurn
                    ? 'bg-amber-400/20 border-amber-400 shadow-md animate-pulse'
                    : 'bg-black/40 border-purple-500/20'
                }`}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg">{player?.avatar || '👤'}</span>
                    <span className="font-bold text-xs text-slate-200 truncate">{player?.name || '上家'}</span>
                    {isDealer && <Crown className="w-3 h-3 text-amber-400" title="庄家" />}
                  </div>
                  <div className="text-[10px] text-amber-300 mt-0.5">{SEAT_NAMES[seatIdx]}</div>
                  <div className="text-[10px] text-slate-400">{player?.handCount ?? 13}张手牌</div>
                  {player?.melds && player.melds.length > 0 && (
                    <div className="mt-1 text-[9px] text-purple-300">
                      已亮{player.melds.length}砍
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Table Center: Shared Pool Discards & Active Turn Dial */}
          <div className="col-span-6 flex flex-col items-center justify-center p-2 bg-[#120822]/85 border border-purple-500/30 rounded-3xl min-h-[190px] relative shadow-inner">
            
            {/* Center Directional Compass Dial */}
            <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-lg bg-black/50 border border-purple-500/30 text-[10px]">
              <span className="text-amber-300 font-bold">{SEAT_NAMES[gameState.currentTurn]}</span>
              <span className="text-slate-400">出牌中</span>
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            </div>

            {/* Countdown Badge */}
            {countdown > 0 && (
              <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-950/80 border border-amber-500/40 text-amber-300 font-mono text-[11px] font-bold">
                <Clock className="w-3 h-3" />
                <span>{countdown}s</span>
              </div>
            )}

            {/* Last Discarded Tile Highlight */}
            {gameState.lastDiscard ? (
              <div className="flex flex-col items-center animate-in zoom-in-90 duration-200 my-auto">
                <span className="text-[11px] text-amber-300 font-bold mb-1 flex items-center gap-1">
                  <span>【{gameState.players[gameState.lastDiscard.playerIndex]?.name}】打出：</span>
                </span>
                <div className="ring-4 ring-amber-400/70 rounded-xl shadow-xl transform scale-110">
                  <MahjongTile tile={gameState.lastDiscard.tile} size="md" />
                </div>
              </div>
            ) : (
              <div className="my-auto text-center space-y-1">
                <div className="text-2xl">☯️</div>
                <div className="text-xs font-bold text-purple-300">五行生克 轮转不息</div>
                <div className="text-[10px] text-slate-500">等待当前道友行牌...</div>
              </div>
            )}

            {/* Global Discards Pool (全台弃牌池) */}
            <div className="w-full flex flex-wrap gap-1 justify-center max-h-24 overflow-y-auto mt-2 pt-1 border-t border-white/5">
              {gameState.players.flatMap(p => p?.discards || []).slice(-14).map((t, idx, arr) => (
                <div key={idx} className={`scale-75 origin-center ${idx === arr.length - 1 ? 'opacity-100 ring-1 ring-amber-400' : 'opacity-85'}`}>
                  <MahjongTile tile={t} size="sm" />
                </div>
              ))}
            </div>

          </div>

          {/* Right Player (下家) */}
          <div className="col-span-3 flex flex-col items-end space-y-1">
            {(() => {
              const { player, seatIdx } = relativePlayers[1];
              const isTurn = gameState.currentTurn === seatIdx;
              const isDealer = gameState.dealerIndex === seatIdx;

              return (
                <div className={`p-2 rounded-2xl border transition-all w-full max-w-[130px] ${
                  isTurn
                    ? 'bg-amber-400/20 border-amber-400 shadow-md animate-pulse'
                    : 'bg-black/40 border-purple-500/20'
                }`}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg">{player?.avatar || '👤'}</span>
                    <span className="font-bold text-xs text-slate-200 truncate">{player?.name || '下家'}</span>
                    {isDealer && <Crown className="w-3 h-3 text-amber-400" title="庄家" />}
                  </div>
                  <div className="text-[10px] text-amber-300 mt-0.5">{SEAT_NAMES[seatIdx]}</div>
                  <div className="text-[10px] text-slate-400">{player?.handCount ?? 13}张手牌</div>
                  {player?.melds && player.melds.length > 0 && (
                    <div className="mt-1 text-[9px] text-purple-300">
                      已亮{player.melds.length}砍
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

        </div>

        {/* BOTTOM: Self (我方手牌、亮出的砍、移动控制栏、理牌与胡牌审核工具栏) */}
        <div className="flex flex-col items-center space-y-2 z-10 pt-2 border-t border-purple-500/20">
          
          {/* Action Prompt Banner & Self-Draw Hu CTA */}
          <div className="flex items-center justify-between w-full max-w-4xl px-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2.5 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5 ${
                isMyTurn
                  ? 'bg-amber-500 text-amber-950 font-black animate-pulse shadow-md'
                  : 'bg-black/40 border border-purple-500/30 text-slate-400'
              }`}>
                {isMyTurn ? '👉 轮到你出牌 (双击打出)' : `等待 ${SEAT_NAMES[gameState.currentTurn]} 出牌...`}
              </span>

              {/* Ting tiles hint badge with Fan indicators */}
              {tingList.length > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-purple-900/90 via-indigo-900/90 to-purple-900/90 border border-amber-400/50 shadow-md animate-pulse">
                  <Eye className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs text-amber-300 font-bold">听牌中！胡：</span>
                  <div className="flex items-center gap-1">
                    {tingList.map((t, idx) => (
                      <span key={idx} className="text-xs bg-amber-400 text-slate-950 px-1.5 py-0.2 rounded font-black font-serif">
                        {t.tileName} ({t.fans}番)
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Self Draw Hu Trigger */}
            <div className="flex items-center gap-2">
              {canSelfDrawHu && (
                <button
                  type="button"
                  onClick={handleSelfDrawHuClick}
                  className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-red-600 via-rose-500 to-amber-500 text-white font-black text-xs shadow-lg shadow-rose-500/40 animate-bounce flex items-center gap-1"
                >
                  <Crown className="w-4 h-4 fill-current" />
                  <span>自摸胡牌！</span>
                </button>
              )}
            </div>
          </div>

          {/* Selected Tile Floating Action HUD (Move Left, Right, Start, End, Discard) */}
          {selectedTileId && (
            <div className="flex items-center gap-1.5 bg-[#1B132B]/95 backdrop-blur-xl px-3 py-1.5 rounded-2xl border border-amber-400/60 shadow-2xl animate-in zoom-in-95 duration-150 z-20">
              <span className="text-[11px] text-amber-300 font-bold mr-1">
                选定【{localHand.find(t => t.id === selectedTileId)?.name}】：
              </span>

              {/* Move to start */}
              <button
                type="button"
                onClick={() => handleMoveTileStart(selectedTileId)}
                title="移至手牌最左侧"
                className="p-1 rounded-lg bg-purple-950/80 hover:bg-purple-800 text-purple-200 text-xs border border-purple-700/50 flex items-center gap-0.5"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
                <span className="text-[10px] hidden sm:inline">置首</span>
              </button>

              {/* Move Left */}
              <button
                type="button"
                onClick={() => handleMoveTileLeft(selectedTileId)}
                title="向左移一位"
                className="px-2 py-1 rounded-lg bg-purple-900/80 hover:bg-purple-700 text-purple-100 text-xs font-bold border border-purple-600/50 flex items-center gap-0.5"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span className="text-[10px]">左移</span>
              </button>

              {/* Move Right */}
              <button
                type="button"
                onClick={() => handleMoveTileRight(selectedTileId)}
                title="向右移一位"
                className="px-2 py-1 rounded-lg bg-purple-900/80 hover:bg-purple-700 text-purple-100 text-xs font-bold border border-purple-600/50 flex items-center gap-0.5"
              >
                <span className="text-[10px]">右移</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>

              {/* Move to end */}
              <button
                type="button"
                onClick={() => handleMoveTileEnd(selectedTileId)}
                title="移至手牌最右侧"
                className="p-1 rounded-lg bg-purple-950/80 hover:bg-purple-800 text-purple-200 text-xs border border-purple-700/50 flex items-center gap-0.5"
              >
                <span className="text-[10px] hidden sm:inline">置尾</span>
                <ChevronsRight className="w-3.5 h-3.5" />
              </button>

              {/* Discard if my turn */}
              {isMyTurn && (
                <button
                  type="button"
                  onClick={handleDiscardSelected}
                  className="px-3 py-1 rounded-lg bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-600 hover:to-yellow-500 text-amber-950 text-[11px] font-black shadow-md flex items-center gap-1 ml-1 animate-bounce"
                >
                  <span>🀄 出牌</span>
                </button>
              )}

              {/* Cancel selection */}
              <button
                type="button"
                onClick={() => setSelectedTileId(null)}
                className="p-1 text-slate-400 hover:text-white ml-1"
                title="取消选中"
              >
                ✕
              </button>
            </div>
          )}

          {/* Standing Hand Tiles (Grouped View or Continuous View) + Declared Melds */}
          <div className="flex flex-wrap items-end justify-center gap-2 sm:gap-4 max-w-full pb-1 px-1">
            
            {/* Hand Tiles */}
            <div className="flex items-end justify-center gap-1 sm:gap-1.5 overflow-x-auto max-w-full py-1">
              {handGroups.map((group, gIdx) => (
                <div
                  key={gIdx}
                  className={`flex items-end gap-1 sm:gap-1.5 ${
                    isGroupedView
                      ? 'p-1.5 rounded-2xl bg-black/40 border border-purple-500/30 relative'
                      : ''
                  }`}
                >
                  {/* Group label for grouped view */}
                  {isGroupedView && group.label && (
                    <span className="absolute -top-3 left-2 px-1.5 py-0.2 rounded-md bg-purple-950/90 text-[9px] text-amber-300 font-bold border border-purple-600/40">
                      {group.label}
                    </span>
                  )}

                  {group.tiles.map((tile, tIdx) => {
                    const globalIdx = group.startIndex + tIdx;
                    const isLastDrawn = tile.id === myPlayer?.lastDrawnTile?.id;
                    const isSelected = selectedTileId === tile.id;
                    const isDragging = draggedTileIndex === globalIdx;
                    const isDragTarget = dragOverIndex === globalIdx && draggedTileIndex !== globalIdx;

                    return (
                      <div
                        key={tile.id || globalIdx}
                        draggable
                        onDragStart={() => setDraggedTileIndex(globalIdx)}
                        onDragOver={e => {
                          e.preventDefault();
                          if (dragOverIndex !== globalIdx) {
                            setDragOverIndex(globalIdx);
                          }
                        }}
                        onDragLeave={() => {
                          if (dragOverIndex === globalIdx) {
                            setDragOverIndex(null);
                          }
                        }}
                        onDragEnd={() => {
                          setDraggedTileIndex(null);
                          setDragOverIndex(null);
                        }}
                        onDrop={e => {
                          e.preventDefault();
                          handleDropTile(globalIdx);
                        }}
                        className={`relative group cursor-grab active:cursor-grabbing transition-all duration-150 ${
                          isDragging ? 'opacity-40 scale-95' : 'opacity-100'
                        } ${
                          isDragTarget
                            ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-[#120824] rounded-xl -translate-y-1'
                            : ''
                        }`}
                      >
                        <MahjongTile
                          tile={tile}
                          size="md"
                          isSelected={isSelected}
                          isLastDrawn={isLastDrawn}
                          onClick={() => handleTileClick(tile)}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Declared Melds (副露：碰/吃/冲战碰/杠) */}
            {myPlayer?.melds && myPlayer.melds.length > 0 && (
              <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-black/60 border border-amber-500/40 shadow-inner">
                <div className="flex flex-col items-center justify-center px-1">
                  <span className="text-[10px] text-amber-300 font-bold">已亮</span>
                  <span className="text-[9px] text-purple-300">砍牌</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {myPlayer.melds.map((m, mi) => (
                    <div key={mi} className="flex items-center gap-0.5 bg-[#22153B] p-1 rounded-xl border border-purple-500/50 shadow-md">
                      <span className="text-[9px] text-amber-300 font-bold -rotate-90 mr-0.5 whitespace-nowrap">
                        {m.typeLabel}
                      </span>
                      {m.tiles.map((t, ti) => (
                        <MahjongTile key={ti} tile={t} size="xs" />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* Full Hand Organization & Hu Audit Action Toolbar */}
          <div className="flex flex-wrap items-center justify-center gap-1.5 mt-1 pt-1.5 border-t border-purple-500/20 w-full max-w-2xl px-2">
            
            {/* Hu Declaration & Audit Studio Button */}
            <button
              type="button"
              onClick={() => setIsHuAuditOpen(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-amber-950 text-xs font-black shadow-lg shadow-amber-500/30 border border-amber-300 transition-transform active:scale-95 animate-pulse"
              title="申报胡牌：系统智能诊断审核或排盘自证"
            >
              <ShieldCheck className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>申报胡牌审核</span>
            </button>

            {/* Open Hand Organizer Modal */}
            <button
              type="button"
              onClick={() => setIsOrganizerOpen(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-xs font-black shadow-md border border-purple-400/40 transition-transform active:scale-95"
              title="进入理牌工作台，规划4砍+1将"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>调整手牌组合</span>
            </button>

            {/* Smart Auto Organize */}
            <button
              type="button"
              onClick={handleAutoOrganizeHand}
              title="智能排盘：优化4砍+1将结构"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#282038] hover:bg-[#342A4A] text-amber-300 text-xs font-semibold border border-amber-500/30 transition-colors"
            >
              <Sparkles className="w-3 h-3" />
              <span>智能理牌</span>
            </button>

            {/* Toggle Grouped vs Continuous view */}
            <button
              type="button"
              onClick={() => {
                setIsGroupedView(!isGroupedView);
                if (soundEnabled) playTileClickSound();
                triggerHaptic('light');
              }}
              title={isGroupedView ? '切换为连续排列' : '切换为分组合并展示 (3-3-3-3-2)'}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                isGroupedView
                  ? 'bg-amber-950/80 border-amber-500/60 text-amber-300'
                  : 'bg-[#282038] hover:bg-[#342A4A] border-purple-500/30 text-purple-300'
              }`}
            >
              {isGroupedView ? <LayoutGrid className="w-3 h-3" /> : <Rows className="w-3 h-3" />}
              <span>{isGroupedView ? '分组展示' : '连续展示'}</span>
            </button>

            {/* Sort by Element */}
            <button
              type="button"
              onClick={handleSortHandByElement}
              title="按五行与天干地支顺序排序"
              className="px-2.5 py-1.5 rounded-xl bg-[#282038] hover:bg-[#342A4A] text-slate-300 hover:text-white text-xs font-medium border border-slate-700 transition-colors"
            >
              五行序
            </button>

            {/* Sort by Clash */}
            <button
              type="button"
              onClick={handleSortHandByClash}
              title="按冲战与对冲组合排序"
              className="px-2.5 py-1.5 rounded-xl bg-[#282038] hover:bg-[#342A4A] text-rose-300 hover:text-rose-200 text-xs font-medium border border-rose-500/30 transition-colors flex items-center gap-0.5"
            >
              <Swords className="w-3 h-3" />
              <span>相克序</span>
            </button>

          </div>

        </div>

      </div>

      {/* Floating Chat / Quick Shouts Drawer */}
      {isChatOpen && (
        <div className="bg-[#1C1230] border border-purple-500/30 rounded-3xl p-3.5 shadow-2xl space-y-3 animate-in fade-in">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <h4 className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
              <MessageCircle className="w-4 h-4 text-amber-400" />
              <span>道友实时对话</span>
            </h4>
            <button type="button" onClick={() => setIsChatOpen(false)} className="text-slate-400 hover:text-white text-xs">✕</button>
          </div>

          {/* Quick Shouts */}
          <div className="flex flex-wrap gap-1">
            {QUICK_SHOUTS.map((shout, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => socketService.sendChat(gameState.roomId, shout, 'shout')}
                className="px-2 py-0.5 rounded-lg bg-purple-950 hover:bg-purple-900 border border-purple-500/30 text-[11px] text-purple-200 transition-colors"
              >
                {shout}
              </button>
            ))}
          </div>

          {/* Chat Feed */}
          <div className="h-28 overflow-y-auto space-y-1 p-2 bg-black/40 rounded-xl border border-white/5 text-xs">
            {chatMessages.map(msg => (
              <div key={msg.id} className="text-slate-200">
                <span className="text-amber-400 font-bold">{msg.avatar} {msg.senderName}:</span>{' '}
                <span>{msg.text}</span>
              </div>
            ))}
          </div>

          {/* Chat input form */}
          <form onSubmit={handleSendChat} className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="发语交流..."
              maxLength={40}
              className="flex-1 px-3 py-1.5 rounded-xl bg-black/50 border border-purple-500/30 text-white text-xs focus:outline-none focus:border-amber-400"
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold"
            >
              发送
            </button>
          </form>
        </div>
      )}

      {/* Claim Dialog (Eat, Pung, Clash Pung, Kong, Hu, Pass) */}
      {myPendingClaims && !hasSubmittedClaim && (
        <ClaimDialog
          claimData={myPendingClaims}
          onClaim={handleExecuteClaim}
          onPass={handlePassClaim}
        />
      )}

      {/* Hand Organizer Modal */}
      {isOrganizerOpen && (
        <HandOrganizerModal
          hand={localHand}
          melds={myPlayer?.melds || []}
          onClose={() => setIsOrganizerOpen(false)}
          onApplyNewHand={newHand => {
            setLocalHand(newHand);
            setIsOrganizerOpen(false);
            addLog('已应用自定义手牌排布');
          }}
        />
      )}

      {/* Hu Audit & Verification Studio Modal */}
      <HuAuditModal
        isOpen={isHuAuditOpen}
        onClose={() => setIsHuAuditOpen(false)}
        hand={localHand}
        melds={myPlayer?.melds || []}
        claimDiscardTile={myPendingClaims?.targetTile}
        claimDiscarderIndex={myPendingClaims?.sourceIndex}
        onConfirmHu={handleConfirmHuFromAudit}
      />

      {/* In-Game Embedded Quick Rulebook Modal */}
      {isRulesModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-in fade-in">
          <div className="bg-[#120A1F] border border-purple-500/40 rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-3.5 border-b border-purple-500/30 bg-[#1A0E2E]">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-black text-amber-300">五行麻将 · 规则与生克图谱速查</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsRulesModalOpen(false)}
                className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 sm:p-4">
              <RulebookView />
            </div>
          </div>
        </div>
      )}

      {/* In-Game Embedded Quick Hand Builder Modal */}
      {isHandBuilderModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-in fade-in">
          <div className="bg-[#120A1F] border border-purple-500/40 rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-3.5 border-b border-purple-500/30 bg-[#1A0E2E]">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-black text-amber-300">手牌排盘与番数验算器</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsHandBuilderModalOpen(false)}
                className="p-1 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 sm:p-4">
              <HandBuilder />
            </div>
          </div>
        </div>
      )}

      {/* Round End / Victory Hu Settlement Modal */}
      {gameState.status === 'round_end' && gameState.winnerData && (
        <HuCelebrationModal
          isOpen={true}
          winner={{
            id: `p_${gameState.winnerData.winnerIndex}`,
            name: gameState.winnerData.winnerName,
            avatar: gameState.players[gameState.winnerData.winnerIndex]?.avatar || '🏆',
            isHuman: gameState.winnerData.winnerIndex === mySeatIndex,
            position: 'self',
            hand: gameState.winnerData.winningTiles,
            melds: gameState.players[gameState.winnerData.winnerIndex]?.melds || [],
            discards: [],
            isDealer: gameState.winnerData.winnerIndex === gameState.dealerIndex,
            score: gameState.players[gameState.winnerData.winnerIndex]?.score || 1000,
          }}
          loser={
            gameState.winnerData.discarderIndex !== undefined
              ? {
                  id: `p_${gameState.winnerData.discarderIndex}`,
                  name: gameState.players[gameState.winnerData.discarderIndex]?.name || '放铳者',
                  avatar: gameState.players[gameState.winnerData.discarderIndex]?.avatar || '👤',
                  isHuman: gameState.winnerData.discarderIndex === mySeatIndex,
                  position: 'right',
                  hand: [],
                  melds: [],
                  discards: [],
                  isDealer: false,
                  score: gameState.players[gameState.winnerData.discarderIndex]?.score || 1000,
                }
              : undefined
          }
          isSelfDraw={gameState.winnerData.isSelfDraw}
          huResult={gameState.winnerData.huResult}
          allTiles={gameState.winnerData.winningTiles}
          onRestartGame={() => {
            socketService.restartGame(gameState.roomId);
          }}
          onNextRound={() => {
            if (myPlayer?.isHost) {
              socketService.nextRound(gameState.roomId);
            } else {
              socketService.nextRound(gameState.roomId);
            }
          }}
        />
      )}

      {/* Round End / Draw Huang Zhuang Settlement Modal */}
      {gameState.status === 'round_end' && !gameState.winnerData && (
        <DrawSettlementModal
          isOpen={true}
          players={gameState.players}
          dealerIndex={gameState.dealerIndex}
          onRestartGame={() => {
            socketService.restartGame(gameState.roomId);
          }}
          onNextRound={() => {
            socketService.nextRound(gameState.roomId);
          }}
        />
      )}

    </div>
  );
};

