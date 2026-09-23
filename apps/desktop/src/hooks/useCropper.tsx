import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CropModal, type CropAspect, type CropResult } from '../components/CropModal';

/**
 * Local cropper instance: `crop(source)` opens the crop dialog and
 * resolves with { dataUrl, file } — or null when the user cancels.
 * Render `cropper` inside the host component's JSX.
 *
 * The dialog is portaled to document.body so its backdrop events never
 * bubble through a host modal's React tree (a nested crop inside e.g.
 * CreateCardModal used to trigger the host's backdrop-dismiss and wipe
 * the whole form).
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
    typeof document !== 'undefined' ? (
      createPortal(
        <CropModal src={pending.src} defaultAspect={pending.aspect} title={pending.title} onCancel={() => settle(null)} onDone={(r) => settle(r)} />,
        document.body,
      )
    ) : null
  ) : null;

  return { crop, cropper };
}
