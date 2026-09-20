"use client";

interface WallpaperBackgroundProps {
  wallpaperBg: string;
  wallpaperFit?: 'cover' | 'contain' | 'repeat';
  wallpaperMime?: string;
  hideUiForWallpaper: boolean;
  onRestore: () => void;
}

export function WallpaperBackground({ wallpaperBg, wallpaperFit = 'cover', wallpaperMime = '', hideUiForWallpaper, onRestore }: WallpaperBackgroundProps) {
  if (!wallpaperBg) return null;

  const isVideo = wallpaperMime.startsWith('video/') || /\.(mp4|webm|ogv|mov)(\?|$)/i.test(wallpaperBg.split('?')[0]) || wallpaperBg.includes('/rg-media');

  const imgStyle = {
    backgroundImage: `url(${wallpaperBg})`,
    backgroundSize: wallpaperFit === 'contain' ? 'contain' : wallpaperFit === 'repeat' ? 'auto' : 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: wallpaperFit === 'repeat' ? 'repeat' : 'no-repeat',
  } as const;

  const videoStyle = {
    objectFit: wallpaperFit === 'contain' ? 'contain' : wallpaperFit === 'repeat' ? 'cover' : 'cover',
  } as const;

  return (
    <>
      <div
        className={`fixed inset-0 z-0 overflow-hidden transition-opacity duration-300 ${hideUiForWallpaper ? 'opacity-100 cursor-pointer' : 'opacity-100 pointer-events-none'
          }`}
        onClick={() => { if (hideUiForWallpaper) onRestore() }}
      >
        {wallpaperFit !== 'repeat' && !isVideo && (
          <div
            className="absolute -inset-10 bg-cover bg-center filter blur-3xl opacity-40 scale-110 transform-gpu"
            style={{ backgroundImage: `url(${wallpaperBg})` }}
          />
        )}
        {isVideo ? (
          <video
            className={`absolute inset-0 w-full h-full ${videoStyle.objectFit}`}
            src={wallpaperBg}
            autoPlay
            muted
            loop
            playsInline
          />
        ) : (
          <div className={`absolute inset-0 ${wallpaperFit === 'repeat' ? '' : 'bg-center'}`} style={imgStyle} />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/60" />
      </div>

      {hideUiForWallpaper && (
        <div
          onClick={onRestore}
          className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[var(--z-modal)] glass-toolbar text-retro-fg rounded-full shadow-2xl px-5 py-2.5 text-xs font-bold hover:bg-glass-w12 cursor-pointer transition-colors"
        >
          Background View Mode Active (Click to restore UI)
        </div>
      )}
    </>
  );
}
