import React from 'react';
import { MicOff, Volume2 } from 'lucide-react';

interface PlayerAvatarProps {
  avatar?: string | null;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  isSpeaking?: boolean;
  isMuted?: boolean;
  isInVoice?: boolean;
  className?: string;
  showVoiceBadge?: boolean;
  onClick?: () => void;
}

const SIZE_MAP = {
  xs: {
    box: 'w-5 h-5 text-xs',
    img: 'w-5 h-5',
    iconSize: 'w-2 h-2',
    badge: 'w-2 h-2 -bottom-0.5 -right-0.5',
  },
  sm: {
    box: 'w-7 h-7 text-sm',
    img: 'w-7 h-7',
    iconSize: 'w-2.5 h-2.5',
    badge: 'w-2.5 h-2.5 -bottom-0.5 -right-0.5',
  },
  md: {
    box: 'w-9 h-9 text-base',
    img: 'w-9 h-9',
    iconSize: 'w-3 h-3',
    badge: 'w-3 h-3 -bottom-0.5 -right-0.5',
  },
  lg: {
    box: 'w-12 h-12 text-2xl',
    img: 'w-12 h-12',
    iconSize: 'w-3.5 h-3.5',
    badge: 'w-3.5 h-3.5 -bottom-1 -right-1',
  },
  xl: {
    box: 'w-16 h-16 text-3xl',
    img: 'w-16 h-16',
    iconSize: 'w-4 h-4',
    badge: 'w-4 h-4 -bottom-1 -right-1',
  },
};

export const PlayerAvatar: React.FC<PlayerAvatarProps> = ({
  avatar,
  name,
  size = 'md',
  isSpeaking = false,
  isMuted = false,
  isInVoice = false,
  className = '',
  showVoiceBadge = true,
  onClick,
}) => {
  const currentSize = SIZE_MAP[size] || SIZE_MAP.md;
  const isCustomImage =
    typeof avatar === 'string' &&
    (avatar.startsWith('data:image') ||
      avatar.startsWith('http://') ||
      avatar.startsWith('https://') ||
      avatar.startsWith('/'));

  const displayFallback = avatar || '👤';

  return (
    <div
      onClick={onClick}
      className={`relative inline-flex items-center justify-center shrink-0 select-none ${
        onClick ? 'cursor-pointer hover:opacity-90' : ''
      } ${className}`}
    >
      {/* Speaking Ripple Pulse Animation */}
      {isSpeaking && (
        <>
          <span className="absolute inset-0 rounded-full bg-emerald-500/40 animate-ping pointer-events-none" />
          <span className="absolute -inset-1 rounded-full border border-emerald-400/80 animate-pulse pointer-events-none shadow-[0_0_12px_rgba(52,211,153,0.7)]" />
        </>
      )}

      {/* Main Avatar Container */}
      <div
        className={`rounded-full overflow-hidden flex items-center justify-center transition-all bg-[#1E1235] border ${
          isSpeaking
            ? 'border-emerald-400 ring-2 ring-emerald-400/60 shadow-lg shadow-emerald-950/50'
            : isInVoice
            ? 'border-purple-400/60 shadow-md'
            : 'border-white/15'
        } ${currentSize.box}`}
      >
        {isCustomImage ? (
          <img
            src={avatar!}
            alt={name || '玩家头像'}
            className={`${currentSize.img} object-cover rounded-full`}
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={(e) => {
              // Fallback to emoji if image fails to load
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <span className="leading-none flex items-center justify-center drop-shadow-sm">
            {displayFallback}
          </span>
        )}
      </div>

      {/* Speaking Equalizer Badge */}
      {showVoiceBadge && isSpeaking && (
        <span
          className={`absolute ${currentSize.badge} rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center shadow-md ring-1 ring-white/40`}
          title="正在讲话"
        >
          <Volume2 className={currentSize.iconSize} />
        </span>
      )}

      {/* Muted Badge */}
      {showVoiceBadge && !isSpeaking && isMuted && (
        <span
          className={`absolute ${currentSize.badge} rounded-full bg-rose-500 text-white flex items-center justify-center shadow-md ring-1 ring-white/40`}
          title="麦克风已静音"
        >
          <MicOff className={currentSize.iconSize} />
        </span>
      )}
    </div>
  );
};
