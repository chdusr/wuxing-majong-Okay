import React, { useState } from 'react';
import { MahjongTileData, ElementType } from '../../types/mahjong';
import { MahjongTile } from './MahjongTile';
import { ELEMENT_COLORS } from '../../utils/mahjongRules';
import {
  Compass,
  Layers,
  Sparkles,
  LayoutGrid,
  Filter,
  CheckCircle2,
  X,
  ArrowUpCircle,
  Eye,
  Crown,
  Clock,
  Flame,
  Shield,
  Zap,
} from 'lucide-react';

export interface DiscardArenaPlayerInfo {
  name: string;
  avatar: string;
  seatName: string; // '东风', '南风', '西风', '北风'
  isDealer?: boolean;
  discards: MahjongTileData[];
  isCurrentTurn?: boolean;
}

export interface DiscardArenaProps {
  // Players ordered as [Self (South), Right (East/West), Opposite (North), Left (West/East)]
  players: DiscardArenaPlayerInfo[];
  currentTurnIndex: number; // Index into players array
  lastDiscard?: {
    playerIndex: number;
    tile: MahjongTileData;
  } | null;
  diceValues?: [number, number];
  selectedTileForDiscard?: MahjongTileData | null;
  isMyTurn?: boolean;
  onConfirmDiscard?: (tile: MahjongTileData) => void;
  onCancelSelect?: () => void;
  countdown?: number;
  className?: string;
}

export type DiscardViewMode = 'integrated' | 'four_rivers' | 'five_elements' | 'bagua_matrix';

const ELEMENT_LABELS: Array<{ key: ElementType | 'all'; label: string; icon: string; bg: string; text: string }> = [
  { key: 'all', label: '全部', icon: '☯️', bg: 'bg-purple-900/60 border-purple-500/40', text: 'text-purple-200' },
  { key: 'wood', label: '木', icon: '🌿', bg: 'bg-emerald-950/70 border-emerald-500/40', text: 'text-emerald-300' },
  { key: 'fire', label: '火', icon: '🔥', bg: 'bg-rose-950/70 border-rose-500/40', text: 'text-rose-300' },
  { key: 'earth', label: '土', icon: '⛰️', bg: 'bg-amber-950/70 border-amber-600/40', text: 'text-amber-300' },
  { key: 'metal', label: '金', icon: '🪙', bg: 'bg-orange-950/70 border-orange-400/40', text: 'text-orange-300' },
  { key: 'water', label: '水', icon: '💧', bg: 'bg-sky-950/70 border-sky-500/40', text: 'text-sky-300' },
];

// Bagua Directional mapping for Stem-Branches
const BAGUA_SLOTS = [
  { dir: '北 (坎)', bagua: '☵ 坎水', element: 'water', branch: '子·亥', label: '正北', pIdx: 2 },
  { dir: '东北 (艮)', bagua: '☶ 艮土', element: 'earth', branch: '丑·寅', label: '东北', pIdx: 2 },
  { dir: '东 (震)', bagua: '☳ 震木', element: 'wood', branch: '卯·辰', label: '正东', pIdx: 1 },
  { dir: '东南 (巽)', bagua: '☴ 巽木', element: 'wood', branch: '巳', label: '东南', pIdx: 1 },
  { dir: '南 (离)', bagua: '☲ 离火', element: 'fire', branch: '午·未', label: '正南', pIdx: 0 },
  { dir: '西南 (坤)', bagua: '☷ 坤土', element: 'earth', branch: '申', label: '西南', pIdx: 0 },
  { dir: '西 (兑)', bagua: '☱ 兑金', element: 'metal', branch: '酉·戌', label: '正西', pIdx: 3 },
  { dir: '西北 (乾)', bagua: '☰ 乾金', element: 'metal', branch: '亥', label: '西北', pIdx: 3 },
];

export const DiscardArena: React.FC<DiscardArenaProps> = ({
  players,
  currentTurnIndex,
  lastDiscard,
  diceValues = [3, 4],
  selectedTileForDiscard,
  isMyTurn = false,
  onConfirmDiscard,
  onCancelSelect,
  countdown,
  className = '',
}) => {
  const [activeElementFilter, setActiveElementFilter] = useState<ElementType | 'all'>('all');
  const [viewMode, setViewMode] = useState<DiscardViewMode>('integrated');
  const [showBaguaDetails, setShowBaguaDetails] = useState(false);

  // All discarded tiles combined
  const allDiscards = players.flatMap((p, pIdx) =>
    p.discards.map((tile, tIdx) => ({
      tile,
      playerIndex: pIdx,
      playerName: p.name,
      seatName: p.seatName,
      globalOrder: `${pIdx}-${tIdx}`,
    }))
  );

  // Element counters
  const elementCounts = {
    wood: allDiscards.filter(d => d.tile.element === 'wood').length,
    fire: allDiscards.filter(d => d.tile.element === 'fire').length,
    earth: allDiscards.filter(d => d.tile.element === 'earth').length,
    metal: allDiscards.filter(d => d.tile.element === 'metal').length,
    water: allDiscards.filter(d => d.tile.element === 'water').length,
  };

  const isTileMatchingFilter = (tile: MahjongTileData) => {
    if (activeElementFilter === 'all') return true;
    return tile.element === activeElementFilter;
  };

  const selfPlayer = players[0]; // Self (South)
  const rightPlayer = players[1]; // Right (East / Xiajia)
  const oppPlayer = players[2]; // Opposite (North / Duijia)
  const leftPlayer = players[3]; // Left (West / Shangjia)

  // Determine compass rotation angle based on who's turn it is
  // 0: South (0 deg), 1: Right (90 deg), 2: North (180 deg), 3: Left (270 deg)
  const compassAngles = [180, 90, 0, 270];
  const activeCompassAngle = compassAngles[currentTurnIndex] ?? 0;

  return (
    <div className={`w-full flex flex-col items-center select-none ${className}`}>
      
      {/* =========================================================================
          TOP COMPACT TOOLBAR: View Mode Tabs & Five-Element Quick Filters
          ========================================================================= */}
      <div className="w-full flex flex-wrap items-center justify-between gap-1.5 px-2 py-1 mb-1.5 bg-[#0D0818]/90 backdrop-blur-md rounded-2xl border border-purple-500/20 shadow-sm z-20">
        
        {/* Left: View Mode Switcher (整合 / 四方堂池 / 五行分类 / 八卦罗盘) */}
        <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-xl border border-white/5">
          <button
            type="button"
            onClick={() => setViewMode('integrated')}
            className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all ${
              viewMode === 'integrated'
                ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="方案整合：全景3D下沉 + 四方堂池 + 聚光灯 + 罗盘"
          >
            <Sparkles className="w-3 h-3" />
            <span>全景堂池</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('four_rivers')}
            className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all ${
              viewMode === 'four_rivers'
                ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="方案一：经典四方各自独立出牌河道"
          >
            <LayoutGrid className="w-3 h-3" />
            <span>四方河道</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('five_elements')}
            className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all ${
              viewMode === 'five_elements'
                ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="方案三：五行金木水火土归类看板"
          >
            <Layers className="w-3 h-3" />
            <span>五行看板</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('bagua_matrix')}
            className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all ${
              viewMode === 'bagua_matrix'
                ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="方案五：八卦九宫罗盘干支矩阵"
          >
            <Compass className="w-3 h-3" />
            <span>八卦罗盘</span>
          </button>
        </div>

        {/* Right: Five-Element Highlighter Tabs (方案三) */}
        <div className="flex items-center gap-1 overflow-x-auto py-0.5">
          <span className="text-[10px] text-slate-400 hidden sm:inline flex items-center gap-0.5 mr-0.5">
            <Filter className="w-2.5 h-2.5" />
            <span>五行过滤:</span>
          </span>
          {ELEMENT_LABELS.map(el => {
            const isSelected = activeElementFilter === el.key;
            const count = el.key === 'all' ? allDiscards.length : elementCounts[el.key];
            return (
              <button
                key={el.key}
                type="button"
                onClick={() => setActiveElementFilter(el.key)}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 border ${
                  isSelected
                    ? `${el.bg} ${el.text} ring-1 ring-amber-400/60 shadow-sm scale-105`
                    : 'bg-black/30 border-white/5 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>{el.icon}</span>
                <span>{el.label}</span>
                <span className="text-[9px] opacity-75 font-mono">({count})</span>
              </button>
            );
          })}
        </div>

      </div>

      {/* =========================================================================
          MAIN 3D RECESSED ARENA MAT (方案九：全景沉浸阶梯下沉式 3D 景深悬浮台)
          ========================================================================= */}
      <div className="relative w-full rounded-3xl bg-gradient-to-b from-[#09151D] via-[#0D1C1B] to-[#081216] border-2 border-emerald-500/25 p-2 sm:p-3.5 shadow-[inset_0_4px_25px_rgba(0,0,0,0.85),0_12px_36px_rgba(0,0,0,0.6)] overflow-hidden min-h-[220px] flex flex-col justify-between">
        
        {/* Subtle Tai-Chi / Bagua Background Watermark (方案五) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.06] overflow-hidden">
          <div className="w-96 h-96 rounded-full border-[12px] border-emerald-400 flex items-center justify-center animate-[spin_120s_linear_infinite]">
            <span className="text-9xl">☯️</span>
          </div>
        </div>

        {/* =========================================================================
            VIEW MODE 1 & 2: INTEGRATED / FOUR RIVERS (四方堂池 + 中央聚合焦点)
            ========================================================================= */}
        {(viewMode === 'integrated' || viewMode === 'four_rivers') && (
          <div className="relative w-full flex flex-col justify-between gap-1.5 z-10">
            
            {/* 1. North Player Discards (对家堂池) */}
            <div className="w-full flex flex-col items-center">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mb-0.5">
                <span className="text-xs">{oppPlayer?.avatar}</span>
                <span className="text-slate-300 font-semibold">{oppPlayer?.name}</span>
                <span className="text-amber-400/80 font-mono">【{oppPlayer?.seatName || '北'}】</span>
                <span className="text-[9px] text-slate-500">({oppPlayer?.discards.length ?? 0}张)</span>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-1 max-h-16 overflow-y-auto px-2 py-1 rounded-xl bg-black/30 border border-white/5 w-full max-w-lg min-h-[36px]">
                {oppPlayer?.discards.length === 0 ? (
                  <span className="text-[10px] text-slate-600">未出牌</span>
                ) : (
                  oppPlayer?.discards.map((tile, idx) => {
                    const isLast = lastDiscard?.playerIndex === 2 && idx === oppPlayer.discards.length - 1;
                    const matches = isTileMatchingFilter(tile);
                    return (
                      <div
                        key={idx}
                        className={`transition-all ${
                          matches ? 'opacity-100' : 'opacity-25 grayscale'
                        } ${isLast ? 'scale-105 z-10' : ''}`}
                      >
                        <MahjongTile
                          tile={tile}
                          size="xs"
                          isHighlighted={isLast}
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* 2. Middle Row: Left (上家), Center Spotlight & LuoPan Dial, Right (下家) */}
            <div className="w-full grid grid-cols-12 items-center gap-2 my-1">
              
              {/* Left Player Discards (上家堂池) */}
              <div className="col-span-3 flex flex-col items-center">
                <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-0.5">
                  <span className="text-xs">{leftPlayer?.avatar}</span>
                  <span className="text-slate-300 font-semibold truncate max-w-[50px]">{leftPlayer?.name}</span>
                  <span className="text-amber-400/80 font-mono text-[9px]">【{leftPlayer?.seatName || '西'}】</span>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1 max-h-24 overflow-y-auto p-1 rounded-xl bg-black/30 border border-white/5 w-full min-h-[50px]">
                  {leftPlayer?.discards.length === 0 ? (
                    <span className="text-[10px] text-slate-600">未出牌</span>
                  ) : (
                    leftPlayer?.discards.map((tile, idx) => {
                      const isLast = lastDiscard?.playerIndex === 3 && idx === leftPlayer.discards.length - 1;
                      const matches = isTileMatchingFilter(tile);
                      return (
                        <div
                          key={idx}
                          className={`transition-all ${
                            matches ? 'opacity-100' : 'opacity-25 grayscale'
                          } ${isLast ? 'scale-105 z-10' : ''}`}
                        >
                          <MahjongTile
                            tile={tile}
                            size="xs"
                            isHighlighted={isLast}
                          />
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Center Spotlight Hub (方案二焦点放大 + 方案五罗盘阵盘) */}
              <div className="col-span-6 flex flex-col items-center justify-center p-2 rounded-2xl bg-gradient-to-b from-[#140C26]/95 via-[#0F1B22]/95 to-[#09151A]/95 border border-amber-500/30 shadow-[0_4px_20px_rgba(0,0,0,0.7),inset_0_1px_1px_rgba(255,255,255,0.1)] relative min-h-[115px]">
                
                {/* Rotating LuoPan Compass Pointer & Direction Ring (方案五) */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20 overflow-hidden">
                  <div
                    className="w-28 h-28 rounded-full border-2 border-dashed border-amber-400/60 flex items-center justify-center transition-transform duration-700 ease-out"
                    style={{ transform: `rotate(${activeCompassAngle}deg)` }}
                  >
                    <div className="w-full flex justify-between px-1 text-[8px] text-amber-300 font-bold">
                      <span>西</span>
                      <span>东</span>
                    </div>
                  </div>
                </div>

                {/* Status HUD Header: Current Turn + Countdown */}
                <div className="w-full flex items-center justify-between px-1 mb-1 text-[10px]">
                  <div className="flex items-center gap-1 text-amber-300 font-semibold bg-black/40 px-2 py-0.5 rounded-lg border border-purple-500/20">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                    <span>{players[currentTurnIndex]?.name || '道友'} 行牌中</span>
                  </div>

                  {countdown !== undefined && countdown > 0 && (
                    <div className="flex items-center gap-1 text-amber-300 font-mono font-bold bg-amber-950/80 px-1.5 py-0.5 rounded-lg border border-amber-500/30">
                      <Clock className="w-3 h-3 text-amber-400" />
                      <span>{countdown}s</span>
                    </div>
                  )}
                </div>

                {/* Last Discard Spotlight Focus (方案二) */}
                {lastDiscard ? (
                  <div className="flex flex-col items-center animate-in zoom-in-95 duration-200">
                    <div className="flex items-center gap-1 text-[11px] text-amber-300 font-bold mb-1">
                      <span>【{players[lastDiscard.playerIndex]?.name}】打出：</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-200 border border-amber-400/30">
                        {lastDiscard.tile.elementName}行
                      </span>
                    </div>
                    {/* Glowing Spotlight Stage */}
                    <div className="relative p-1 rounded-2xl bg-gradient-to-b from-amber-400/30 to-purple-600/30 ring-2 ring-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.4)] transform hover:scale-105 transition-transform">
                      <MahjongTile tile={lastDiscard.tile} size="md" />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-2 text-center text-slate-500 space-y-0.5">
                    <div className="text-xl">☯️</div>
                    <div className="text-[11px] text-amber-300/80 font-serif font-bold">五行乾坤堂池</div>
                    <div className="text-[9px] text-slate-400">等待首张出牌...</div>
                  </div>
                )}

                {/* Dice Display */}
                {diceValues && (
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-amber-300/80 font-mono">
                    <span className="bg-black/50 px-1.5 py-0.2 rounded border border-white/10">
                      🎲 骰点 [{diceValues[0]}, {diceValues[1]}]
                    </span>
                  </div>
                )}

              </div>

              {/* Right Player Discards (下家堂池) */}
              <div className="col-span-3 flex flex-col items-center">
                <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-0.5">
                  <span className="text-xs">{rightPlayer?.avatar}</span>
                  <span className="text-slate-300 font-semibold truncate max-w-[50px]">{rightPlayer?.name}</span>
                  <span className="text-amber-400/80 font-mono text-[9px]">【{rightPlayer?.seatName || '东'}】</span>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1 max-h-24 overflow-y-auto p-1 rounded-xl bg-black/30 border border-white/5 w-full min-h-[50px]">
                  {rightPlayer?.discards.length === 0 ? (
                    <span className="text-[10px] text-slate-600">未出牌</span>
                  ) : (
                    rightPlayer?.discards.map((tile, idx) => {
                      const isLast = lastDiscard?.playerIndex === 1 && idx === rightPlayer.discards.length - 1;
                      const matches = isTileMatchingFilter(tile);
                      return (
                        <div
                          key={idx}
                          className={`transition-all ${
                            matches ? 'opacity-100' : 'opacity-25 grayscale'
                          } ${isLast ? 'scale-105 z-10' : ''}`}
                        >
                          <MahjongTile
                            tile={tile}
                            size="xs"
                            isHighlighted={isLast}
                          />
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>

            {/* 3. South Player Discards (本家堂池) */}
            <div className="w-full flex flex-col items-center">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mb-0.5">
                <span className="text-xs">{selfPlayer?.avatar}</span>
                <span className="text-emerald-300 font-bold">{selfPlayer?.name || '我方'} (本家)</span>
                <span className="text-amber-400/80 font-mono">【{selfPlayer?.seatName || '南'}】</span>
                <span className="text-[9px] text-slate-500">({selfPlayer?.discards.length ?? 0}张)</span>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-1 max-h-16 overflow-y-auto px-2 py-1 rounded-xl bg-black/30 border border-emerald-500/20 w-full max-w-lg min-h-[36px]">
                {selfPlayer?.discards.length === 0 ? (
                  <span className="text-[10px] text-slate-600">未出牌</span>
                ) : (
                  selfPlayer?.discards.map((tile, idx) => {
                    const isLast = lastDiscard?.playerIndex === 0 && idx === selfPlayer.discards.length - 1;
                    const matches = isTileMatchingFilter(tile);
                    return (
                      <div
                        key={idx}
                        className={`transition-all ${
                          matches ? 'opacity-100' : 'opacity-25 grayscale'
                        } ${isLast ? 'scale-105 z-10' : ''}`}
                      >
                        <MahjongTile
                          tile={tile}
                          size="xs"
                          isHighlighted={isLast}
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </div>

          </div>
        )}

        {/* =========================================================================
            VIEW MODE 3: FIVE ELEMENTS BOARD (方案三：五行金木水火土分类看板)
            ========================================================================= */}
        {viewMode === 'five_elements' && (
          <div className="w-full grid grid-cols-5 gap-1.5 z-10 py-1">
            {(['wood', 'fire', 'earth', 'metal', 'water'] as ElementType[]).map(elem => {
              const info = ELEMENT_LABELS.find(e => e.key === elem)!;
              const tilesInElem = allDiscards.filter(d => d.tile.element === elem);

              return (
                <div
                  key={elem}
                  className={`flex flex-col items-center rounded-2xl p-1.5 border transition-all ${
                    activeElementFilter === 'all' || activeElementFilter === elem
                      ? `${info.bg} ring-1 ring-white/10`
                      : 'bg-black/40 border-white/5 opacity-40'
                  }`}
                >
                  <div className="flex items-center gap-1 text-[11px] font-bold mb-1">
                    <span>{info.icon}</span>
                    <span className={info.text}>{info.label}行</span>
                    <span className="text-[10px] text-slate-400 font-mono">({tilesInElem.length})</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-1 max-h-36 overflow-y-auto w-full p-1 rounded-xl bg-black/30 min-h-[60px]">
                    {tilesInElem.length === 0 ? (
                      <span className="text-[9px] text-slate-600 my-auto">尚无弃牌</span>
                    ) : (
                      tilesInElem.map((item, idx) => (
                        <div
                          key={idx}
                          title={`${item.playerName} (${item.seatName}) 打出`}
                          className="relative group cursor-pointer"
                        >
                          <MahjongTile tile={item.tile} size="xs" />
                          <span className="absolute -bottom-1 -right-1 text-[8px] bg-black/80 text-amber-300 px-0.5 rounded font-mono scale-75 pointer-events-none">
                            {item.seatName.slice(0, 1)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* =========================================================================
            VIEW MODE 4: BAGUA COMPASS MATRIX (方案五：八卦九宫罗盘干支矩阵)
            ========================================================================= */}
        {viewMode === 'bagua_matrix' && (
          <div className="w-full grid grid-cols-4 sm:grid-cols-4 gap-1.5 z-10 py-1">
            {BAGUA_SLOTS.map((slot, idx) => {
              // Tiles matching this branch or element
              const matchingTiles = allDiscards.filter(d => {
                const branches = slot.branch.split('·');
                return (
                  branches.some(b => d.tile.name.includes(b)) ||
                  (d.tile.category === 'element' && d.tile.element === slot.element)
                );
              });

              return (
                <div
                  key={idx}
                  className="flex flex-col items-center rounded-2xl p-1.5 bg-black/40 border border-purple-500/20"
                >
                  <div className="flex items-center justify-between w-full px-1 text-[10px] font-bold text-amber-300 mb-0.5">
                    <span>{slot.bagua}</span>
                    <span className="text-[9px] text-slate-400">{slot.branch}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-0.5 max-h-20 overflow-y-auto w-full p-1 bg-black/30 rounded-xl min-h-[42px]">
                    {matchingTiles.length === 0 ? (
                      <span className="text-[9px] text-slate-600 my-auto">空</span>
                    ) : (
                      matchingTiles.map((m, mIdx) => (
                        <MahjongTile key={mIdx} tile={m.tile} size="xs" />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* =========================================================================
          PROXIMITY DROPZONE (方案六：双层分流式 - 近场即时出牌槽)
          ========================================================================= */}
      {selectedTileForDiscard && (
        <div className="w-full max-w-lg mt-2 p-2.5 rounded-2xl bg-gradient-to-r from-purple-950/95 via-indigo-950/95 to-purple-950/95 border-2 border-amber-400 shadow-[0_4px_25px_rgba(251,191,36,0.35)] backdrop-blur-xl flex items-center justify-between gap-3 animate-in slide-in-from-bottom-3 duration-200 z-30">
          
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <MahjongTile tile={selectedTileForDiscard} size="sm" isHighlighted />
            </div>
            <div className="flex flex-col">
              <div className="text-xs text-amber-300 font-bold flex items-center gap-1">
                <span>准备打出【{selectedTileForDiscard.name}】</span>
                <span className="text-[9px] px-1 rounded bg-amber-400/20 text-amber-200">
                  {selectedTileForDiscard.elementName}行
                </span>
              </div>
              <span className="text-[10px] text-slate-300">
                {isMyTurn ? '点击右侧确认键或双击手牌直接打出' : '已预选，轮到你时将直接打出'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {onConfirmDiscard && (
              <button
                type="button"
                onClick={() => onConfirmDiscard(selectedTileForDiscard)}
                className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-slate-950 text-xs font-black shadow-lg shadow-amber-500/30 flex items-center gap-1 transform hover:scale-105 active:scale-95 transition-all"
              >
                <ArrowUpCircle className="w-4 h-4 fill-current" />
                <span>立即打出</span>
              </button>
            )}

            {onCancelSelect && (
              <button
                type="button"
                onClick={onCancelSelect}
                className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 text-xs transition-colors"
                title="取消选定"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

        </div>
      )}

    </div>
  );
};
