import React from 'react';
import { MahjongTileData } from '../../types/mahjong';
import { MahjongTile } from './MahjongTile';
import {
  ArrowUpCircle,
  X,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Sparkles,
  Zap,
} from 'lucide-react';

interface DiscardConfirmModalProps {
  tile: MahjongTileData;
  isMyTurn: boolean;
  countdown?: number | null;
  onConfirm?: (tile: MahjongTileData) => void;
  onConfirmDiscard?: (tile: MahjongTileData) => void;
  onCancel: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onMoveStart?: () => void;
  onMoveEnd?: () => void;
}

export const DiscardConfirmModal: React.FC<DiscardConfirmModalProps> = ({
  tile,
  isMyTurn,
  countdown,
  onConfirm,
  onConfirmDiscard,
  onCancel,
  onMoveLeft,
  onMoveRight,
  onMoveStart,
  onMoveEnd,
}) => {
  const handleConfirm = () => {
    if (typeof onConfirmDiscard === 'function') {
      try {
        onConfirmDiscard(tile);
      } catch (err) {
        console.error('Error in onConfirmDiscard:', err);
      }
    } else if (typeof onConfirm === 'function') {
      try {
        onConfirm(tile);
      } catch (err) {
        console.error('Error in onConfirm:', err);
      }
    }
  };
  const elementColors: Record<string, { bg: string; text: string; border: string; glow: string }> = {
    wood: { bg: 'bg-emerald-950/90', text: 'text-emerald-300', border: 'border-emerald-500/50', glow: 'shadow-emerald-500/30' },
    fire: { bg: 'bg-red-950/90', text: 'text-red-300', border: 'border-red-500/50', glow: 'shadow-red-500/30' },
    earth: { bg: 'bg-amber-950/90', text: 'text-amber-300', border: 'border-amber-500/50', glow: 'shadow-amber-500/30' },
    metal: { bg: 'bg-slate-900/90', text: 'text-yellow-200', border: 'border-yellow-400/50', glow: 'shadow-yellow-400/30' },
    water: { bg: 'bg-cyan-950/90', text: 'text-cyan-300', border: 'border-cyan-500/50', glow: 'shadow-cyan-500/30' },
  };

  const elemStyle = elementColors[tile.element] || {
    bg: 'bg-purple-950/90',
    text: 'text-purple-300',
    border: 'border-purple-500/50',
    glow: 'shadow-purple-500/30',
  };

  return (
    <div className="w-full max-w-lg mx-auto mb-2 animate-in slide-in-from-bottom-3 duration-200 z-30 select-none">
      <div className={`relative p-2.5 sm:p-3 rounded-2xl bg-[#120B22]/95 backdrop-blur-xl border-2 border-amber-400 shadow-[0_8px_32px_rgba(0,0,0,0.8),0_0_20px_rgba(251,191,36,0.35)] flex flex-col gap-2`}>
        
        {/* Top: Tile Info & Quick Cancel */}
        <div className="flex items-center justify-between gap-2">
          
          {/* Left: Tile Preview & Element Details */}
          <div className="flex items-center gap-2.5">
            <div className="relative transform hover:scale-105 transition-transform">
              <MahjongTile tile={tile} size="md" isHighlighted />
            </div>

            <div className="flex flex-col">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-black text-amber-300">
                  【{tile.name}】
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold border ${elemStyle.border} ${elemStyle.text} bg-black/40`}>
                  {tile.elementName}行
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-mono bg-purple-950/80 text-purple-300 border border-purple-600/40">
                  {tile.category === 'tiangan' ? '天干' : tile.category === 'dizhi' ? '地支' : '五行元牌'}
                </span>
              </div>
              <span className="text-[10px] text-slate-300 mt-0.5">
                {isMyTurn
                  ? '已选定此牌，点击右侧按钮立即打出'
                  : '已预选，轮到你出牌时将立即打出'}
              </span>
            </div>
          </div>

          {/* Right: Close / Deselect Button */}
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white transition-colors"
            title="取消选定"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Bottom Action Strip: Immediate Discard CTA + Hand Position Adjusters */}
        <div className="flex items-center justify-between gap-1.5 pt-1.5 border-t border-purple-500/20 flex-wrap">
          
          {/* Left: Hand Reordering Position Controls */}
          {(onMoveLeft || onMoveRight) && (
            <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-xl border border-white/5">
              {onMoveStart && (
                <button
                  type="button"
                  onClick={onMoveStart}
                  className="px-1.5 py-1 rounded-lg hover:bg-purple-900/60 text-slate-300 hover:text-white text-[10px] flex items-center gap-0.5"
                  title="移至最左侧"
                >
                  <ChevronsLeft className="w-3 h-3" />
                  <span className="hidden xs:inline">置首</span>
                </button>
              )}

              {onMoveLeft && (
                <button
                  type="button"
                  onClick={onMoveLeft}
                  className="px-2 py-1 rounded-lg hover:bg-purple-900/60 text-slate-300 hover:text-white text-[10px] font-bold flex items-center gap-0.5"
                  title="向左移一位"
                >
                  <ChevronLeft className="w-3 h-3" />
                  <span>左移</span>
                </button>
              )}

              {onMoveRight && (
                <button
                  type="button"
                  onClick={onMoveRight}
                  className="px-2 py-1 rounded-lg hover:bg-purple-900/60 text-slate-300 hover:text-white text-[10px] font-bold flex items-center gap-0.5"
                  title="向右移一位"
                >
                  <span>右移</span>
                  <ChevronRight className="w-3 h-3" />
                </button>
              )}

              {onMoveEnd && (
                <button
                  type="button"
                  onClick={onMoveEnd}
                  className="px-1.5 py-1 rounded-lg hover:bg-purple-900/60 text-slate-300 hover:text-white text-[10px] flex items-center gap-0.5"
                  title="移至最右侧"
                >
                  <span className="hidden xs:inline">置尾</span>
                  <ChevronsRight className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* Right: Big Immediate Discard Button (⚡ 立即打出) */}
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 min-w-[130px] sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-400 hover:from-amber-500 hover:to-yellow-500 text-slate-950 font-black text-xs sm:text-sm shadow-lg shadow-amber-500/40 border border-amber-300 transform active:scale-95 transition-all"
          >
            <Zap className="w-4 h-4 fill-slate-950 animate-bounce" />
            <span>立即打出【{tile.name}】</span>
            {countdown !== undefined && countdown !== null && (
              <span className="text-[10px] font-mono bg-slate-950/20 px-1 py-0.2 rounded ml-0.5">
                {countdown}s
              </span>
            )}
          </button>

        </div>

      </div>
    </div>
  );
};
