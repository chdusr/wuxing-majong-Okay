import React, { useEffect, useMemo } from 'react';
import confetti from 'canvas-confetti';
import { HuResult, MahjongTileData, Player } from '../../types/mahjong';
import { MahjongTile } from './MahjongTile';
import { checkThreeTilesKan } from '../../utils/mahjongRules';
import { Trophy, Sparkles, RefreshCw, ChevronRight, Award, Flame } from 'lucide-react';

interface HuCelebrationModalProps {
  isOpen: boolean;
  winner: Player;
  loser?: Player; // if claimed discard
  isSelfDraw: boolean;
  huResult: HuResult;
  allTiles: MahjongTileData[];
  onNextRound: () => void;
  onRestartGame: () => void;
}

export const HuCelebrationModal: React.FC<HuCelebrationModalProps> = ({
  isOpen,
  winner,
  loser,
  isSelfDraw,
  huResult,
  allTiles,
  onNextRound,
  onRestartGame,
}) => {
  useEffect(() => {
    if (isOpen) {
      // Fire celebratory confetti
      try {
        confetti({
          particleCount: 90,
          spread: 80,
          origin: { y: 0.55 },
          colors: ['#F59E0B', '#10B981', '#EF4444', '#38BDF8', '#D97AFF', '#FBBF24'],
        });
      } catch {}
    }
  }, [isOpen]);

  // Group tiles into structured Kans + Pair for crystal clear visualization
  const groupedHand = useMemo(() => {
    if (huResult.isSevenPairs) {
      // 7 pairs breakdown
      const pairs: Array<{ label: string; tiles: MahjongTileData[] }> = [];
      const counts: Record<string, MahjongTileData[]> = {};
      allTiles.forEach(t => {
        counts[t.name] = counts[t.name] || [];
        counts[t.name].push(t);
      });
      let pIdx = 1;
      Object.values(counts).forEach(arr => {
        if (arr.length >= 2) {
          pairs.push({ label: `对子 ${pIdx++}`, tiles: arr.slice(0, 2) });
        }
        if (arr.length === 4) {
          pairs.push({ label: `对子 ${pIdx++}`, tiles: arr.slice(2, 4) });
        }
      });
      return pairs;
    }

    if (huResult.kans && huResult.kans.length > 0) {
      const groups: Array<{ label: string; tiles: MahjongTileData[] }> = [];
      huResult.kans.forEach((kTiles) => {
        const kanCheck = checkThreeTilesKan(kTiles.map(t => t.name));
        const label = kanCheck?.typeLabel || '有效砍牌';
        groups.push({ label, tiles: kTiles });
      });
      if (huResult.pair && huResult.pair.length > 0) {
        groups.push({ label: '雀头将牌', tiles: huResult.pair });
      }
      return groups;
    }

    return null;
  }, [huResult, allTiles]);

  if (!isOpen) return null;

  const pointsPerPlayer = huResult.fans * 100;
  const totalEarnedPoints = isSelfDraw ? pointsPerPlayer * 3 : pointsPerPlayer;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto bg-gradient-to-b from-[#241738] via-[#1A1228] to-[#120D1D] border-2 border-amber-500/50 rounded-3xl p-4 sm:p-5 text-white shadow-[0_0_50px_rgba(245,158,11,0.3)] flex flex-col items-center animate-in zoom-in-95 duration-200">
        
        {/* Trophy Header */}
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-tr from-amber-500 via-yellow-400 to-amber-200 p-0.5 shadow-lg shadow-amber-500/40 flex items-center justify-center -mt-8 sm:-mt-10 mb-2 border-2 border-white/50">
          <Trophy className="w-7 h-7 sm:w-8 sm:h-8 text-amber-950 stroke-[2.4]" />
        </div>

        {/* Winner Title & Win Method */}
        <div className="text-center mb-3">
          <div className="text-[11px] sm:text-xs text-amber-400 font-bold tracking-widest uppercase mb-0.5 flex items-center justify-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>五行麻将 · 胜利大捷</span>
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center justify-center gap-2">
            <span>{winner.name}</span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-yellow-400">
              胡牌大胜！
            </span>
          </h2>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/10 text-xs text-slate-300 mt-1 border border-white/10">
            <span>{isSelfDraw ? '🌸 妙手自摸' : `🎯 捉炮放铳（${loser ? loser.name : '对手'}出牌）`}</span>
          </div>
        </div>

        {/* Grouped / Flattened Hand Layout Display */}
        <div className="w-full bg-[#130E1F]/95 border border-purple-500/30 rounded-2xl p-3 mb-3.5">
          <div className="text-[11px] text-purple-300 font-bold mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Award className="w-3.5 h-3.5 text-amber-400" />
              <span>胡牌牌型与成砍排布 (共14张)：</span>
            </span>
            <span className="text-amber-400 font-mono font-black text-xs px-2 py-0.5 rounded-md bg-amber-950/80 border border-amber-500/40">
              {huResult.fans} 番
            </span>
          </div>

          {groupedHand ? (
            <div className="flex flex-wrap items-center justify-center gap-2 py-1">
              {groupedHand.map((group, gIdx) => (
                <div
                  key={gIdx}
                  className={`flex flex-col items-center p-1.5 rounded-xl border ${
                    group.label === '雀头将牌'
                      ? 'bg-amber-950/40 border-amber-500/50 shadow-sm'
                      : 'bg-[#22153B]/90 border-purple-500/40'
                  }`}
                >
                  <span className="text-[9px] font-bold text-amber-300 mb-1">
                    {group.label}
                  </span>
                  <div className="flex items-center gap-1">
                    {group.tiles.map((tile, tIdx) => (
                      <MahjongTile key={tile.id || tIdx} tile={tile} size="xs" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-1.5 py-1">
              {allTiles.map((tile, i) => (
                <MahjongTile key={tile.id || i} tile={tile} size="xs" />
              ))}
            </div>
          )}
        </div>

        {/* Fan Score & Pattern Details Card */}
        <div className="w-full bg-[#1C132B] border border-amber-500/30 rounded-2xl p-3 sm:p-3.5 mb-4 space-y-2.5">
          
          {/* Main Title & Points Earned */}
          <div className="flex items-center justify-between border-b border-purple-500/20 pb-2">
            <div>
              <div className="text-amber-300 font-black text-sm sm:text-base flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-amber-400" />
                <span>{huResult.explanation}</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {isSelfDraw
                  ? `自摸计分：各家付 ${pointsPerPlayer} 分`
                  : `放铳计分：${loser?.name || '放铳者'}单家付 ${pointsPerPlayer} 分`}
              </p>
            </div>
            <div className="text-xl sm:text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-yellow-400 font-mono">
              +{totalEarnedPoints} 分
            </div>
          </div>

          {/* Fan Breakdown Items */}
          <div className="space-y-1.5 pt-0.5">
            {huResult.fanDetails.map((detail, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between text-xs text-slate-200 bg-black/30 px-2.5 py-1 rounded-lg border border-white/5"
              >
                <span>{detail}</span>
                <span className="text-amber-400 font-bold">✓ 达标</span>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons: 重置新局 & 再来一局 */}
        <div className="w-full flex gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={onRestartGame}
            className="flex-1 py-3 px-2 rounded-2xl bg-[#2C213F] hover:bg-[#382B50] text-slate-200 text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 border border-slate-600 active:scale-95"
            title="返回房间准备台或重置本局"
          >
            <RefreshCw className="w-4 h-4 text-slate-400" />
            <span>重置新局</span>
          </button>

          <button
            type="button"
            onClick={onNextRound}
            className="flex-1 py-3 px-2 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-amber-950 text-xs sm:text-sm font-black transition-all shadow-lg shadow-amber-500/30 flex items-center justify-center gap-1.5 active:scale-95 transform hover:scale-102"
            title="立即开辟下一局对战"
          >
            <span>再来一局</span>
            <ChevronRight className="w-4 h-4 stroke-[3]" />
          </button>
        </div>

      </div>
    </div>
  );
};
