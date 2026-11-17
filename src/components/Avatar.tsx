import { useState } from 'react';
import { Users } from 'lucide-react';
import { getAvatarColorClass, getInitials } from '../utils/chatHelpers';

interface AvatarProps {
  src?: string;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  isOnline?: boolean;
  isGroup?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'w-9 h-9 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-20 h-20 text-xl',
};

export function Avatar({ src, name, size = 'md', isOnline, isGroup }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = Boolean(src) && !imgFailed;

  return (
    <div className={`relative shrink-0 ${SIZE_CLASSES[size]}`}>
      {showImage ? (
        <img
          src={src}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-full h-full rounded-full object-cover bg-[#E9EDEF] dark:bg-[#202C33]"
        />
      ) : (
        <div
          className={`w-full h-full rounded-full flex items-center justify-center font-semibold select-none ${
            isGroup
              ? 'bg-[#008069] text-white'
              : getAvatarColorClass(name || 'user')
          }`}
        >
          {isGroup ? <Users className="w-1/2 h-1/2" /> : getInitials(name)}
        </div>
      )}
      {isOnline && (
        <span
          aria-label="Online"
          className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#00A884] ring-2 ring-white dark:ring-[#111B21]"
        />
      )}
    </div>
  );
}
