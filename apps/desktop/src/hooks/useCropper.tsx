import { useCallback, useRef, useState } from 'react';
import { CropModal, type CropAspect, type CropResult } from '../components/CropModal';

/**
 * Local cropper instance: `crop(source)` opens the crop dialog and
 * resolves with { dataUrl, file } — or null when the user cancels.
 * Render `cropper` inside the host component's JSX.
 */
export function useCropper() {
  const [pending, setPending] = useState<{ src: string; aspect: CropAspect; title: string } | null>(null);
  const resolver = useRef<((r: CropResult | null) => void) | null>(null);
  const revokeRef = useRef<string | null>(null);

  const settle = useCallback((result: CropResult | null) => {
    if (revokeRef.current) {
      try { URL.revokeObjectURL(revokeRef.current); } catch { /* best effort */ }
      revokeRef.current = null;
    }
    resolver.current?.(result);
    resolver.current = null;
    setPending(null);
  }, []);

  const crop = useCallback((source: File | Blob | string, opts?: { aspect?: CropAspect; title?: string }) => {
    return new Promise<CropResult | null>((resolve) => {
      let src: string;
      if (typeof source === 'string') {
        src = source;
      } else {
        src = URL.createObjectURL(source);
        revokeRef.current = src;
      }
      resolver.current = resolve;
      setPending({ src, aspect: opts?.aspect ?? 'free', title: opts?.title ?? 'Crop photo' });
    });
  }, []);

  const cropper = pending ? (
    <CropModal src={pending.src} defaultAspect={pending.aspect} title={pending.title} onCancel={() => settle(null)} onDone={(r) => settle(r)} />
  ) : null;

  return { crop, cropper };
}
