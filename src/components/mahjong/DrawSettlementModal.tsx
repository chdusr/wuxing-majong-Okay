import React from 'react';
import { Player } from '../../types/mahjong';
import { OnlinePlayer } from '../../types/multiplayer';
import { RefreshCw, ChevronRight, Wind, Award, Users } from 'lucide-react';

interface DrawSettlementModalProps {
  isOpen: boolean;
  players: (Player | OnlinePlayer | null)[];
  dealerIndex: number;
  onNextRound: () => void;
  onRestartGame: () => void;
}

export const DrawSettlementModal: React.FC<DrawSettlementModalProps> = ({
  isOpen,
  players,
  dealerIndex,
  onNextRound,
  onRestartGame,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-gradient-to-b from-[#251D33] via-[#1A1426] to-[#120E1C] border-2 border-slate-600/60 rounded-3xl p-5 text-white shadow-[0_0_50px_rgba(100,116,139,0.3)] flex flex-col items-center animate-in zoom-in-95 duration-200">
        
        {/* Draw Icon */}
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-tr from-slate-600 to-slate-400 p-0.5 shadow-lg shadow-slate-600/30 flex items-center justify-center -mt-10 mb-2 border-2 border-white/40">
          <Wind className="w-7 h-7 sm:w-8 sm:h-8 text-slate-950 stroke-[2.4]" />
        </div>

        {/* Title */}
        <div className="text-center mb-4">
          <div className="text-xs text-slate-400 font-bold tracking-widest uppercase mb-0.5">
            五行牌局 · 荒庄流局
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-200">
            牌墙摸尽，平局收场
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            本局无玩家胡牌，积分保持不变，下局由下家轮庄
          </p>
        </div>

        {/* Score Overview */}
        <div className="w-full bg-[#130F1C] border border-white/10 rounded-2xl p-3.5 mb-5 space-y-2">
          <div className="text-xs text-slate-400 font-bold flex items-center gap-1.5 pb-1 border-b border-white/5">
            <Users className="w-3.5 h-3.5 text-slate-400" />
            <span>当前玩家积分榜：</span>
          </div>

          <div className="space-y-1.5 pt-1">
            {players.map((p, idx) => {
              if (!p) return null;
              const isDealer = idx === dealerIndex;
              return (
                <div
                  key={p.id || idx}
                  className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-white/5 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">{p.avatar || '👤'}</span>
                    <span className="font-bold text-slate-200">{p.name}</span>
                    {isDealer && (
                      <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px] border border-amber-500/40">
                        庄
                      </span>
                    )}
                  </div>
                  <span className="font-mono font-bold text-amber-300">{p.score} 分</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Buttons */}
        <div className="w-full flex gap-3">
          <button
            type="button"
            onClick={onRestartGame}
            className="flex-1 py-3 px-2 rounded-2xl bg-[#282136] hover:bg-[#342C45] text-slate-300 text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 border border-slate-700 active:scale-95"
          >
            <RefreshCw className="w-4 h-4 text-slate-400" />
            <span>重置新局</span>
          </button>

          <button
            type="button"
            onClick={onNextRound}
            className="flex-1 py-3 px-2 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs sm:text-sm font-bold transition-all shadow-lg shadow-purple-900/40 flex items-center justify-center gap-1.5 active:scale-95"
          >
            <span>再来一局</span>
            <ChevronRight className="w-4 h-4 stroke-[3]" />
          </button>
        </div>

      </div>
    </div>
  );
};
