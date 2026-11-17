import { Download, X } from 'lucide-react';

interface MediaLightboxProps {
  url: string;
  type: 'image' | 'video';
  name: string;
  onClose: () => void;
}

export function MediaLightbox({ url, type, name, onClose }: MediaLightboxProps) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={name || 'Media preview'}
    >
      <div className="flex items-center justify-between px-5 py-3.5 text-white border-b border-white/10">
        <span className="text-sm font-medium truncate max-w-xs sm:max-w-md">{name || 'Media'}</span>
        <div className="flex items-center gap-2">
          <a
            href={url}
            download={name || 'media'}
            target="_blank"
            rel="noreferrer"
            className="min-w-[40px] min-h-[40px] rounded-full hover:bg-white/10 flex items-center justify-center transition-colors"
            aria-label="Download media"
          >
            <Download className="w-5 h-5" />
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close media preview"
            className="min-w-[40px] min-h-[40px] rounded-full hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div
        className="flex-1 flex items-center justify-center p-4 overflow-hidden"
        onClick={onClose}
      >
        <div onClick={(e) => e.stopPropagation()} className="max-w-5xl max-h-full flex items-center justify-center">
          {type === 'image' ? (
            <img
              src={url}
              alt={name || 'Shared photo'}
              referrerPolicy="no-referrer"
              className="max-h-[85dvh] max-w-full rounded-lg object-contain"
            />
          ) : (
            <video
              src={url}
              controls
              autoPlay
              playsInline
              className="max-h-[85dvh] max-w-full rounded-lg"
            />
          )}
        </div>
      </div>
    </div>
  );
}
