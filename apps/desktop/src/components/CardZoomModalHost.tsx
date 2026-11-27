"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { CardZoomModal } from "./CardZoomModal";

/**
 * One zoom-lightbox state, shared by every surface that opens a card/image
 * preview (admin app, match round, spectate, your match).
 *
 * These four sites each carried their own `zoomModal` state and their own
 * `<CardZoomModal isOpen=... onClose=... imageUrl=... />` wiring — the same
 * nine lines, already drifted (one dropped `isVideo`, one added `caption`).
 * The state and the modal now live together: call `show(...)` to open, and
 * drop `<ZoomModal />` once in the JSX.
 */
export interface ZoomModalState {
  isOpen: boolean;
  imageUrl: string | null;
  isVideo?: boolean;
  title?: string;
  subtitle?: string;
  caption?: string;
}

export interface ZoomModalController {
  zoomModal: ZoomModalState;
  setZoomModal: Dispatch<SetStateAction<ZoomModalState>>;
  /** Open the preview on a URL (with optional video/title/subtitle/caption). */
  showZoom: (url: string, opts?: Omit<ZoomModalState, "isOpen" | "imageUrl">) => void;
  /** Close the preview. */
  hideZoom: () => void;
}

const CLOSED: ZoomModalState = { isOpen: false, imageUrl: null };

export function useZoomModal(): ZoomModalController {
  const [zoomModal, setZoomModal] = useState<ZoomModalState>(CLOSED);

  return {
    zoomModal,
    setZoomModal,
    showZoom: (url, opts) =>
      setZoomModal({ isOpen: true, imageUrl: url, ...opts }),
    hideZoom: () => setZoomModal(CLOSED),
  };
}

interface ZoomModalProps {
  zoom: ZoomModalController;
  /** Identity forwarded to the modal so "open original" can fetch locally held bytes. */
  identity?: Parameters<typeof CardZoomModal>[0]["identity"];
}

/**
 * The shared lightbox. Render once per surface, driven by `useZoomModal()`.
 * The `imageUrl` guard stays here so a closed-but-stale state never mounts the
 * heavy modal.
 */
export function ZoomModal({ zoom, identity }: ZoomModalProps) {
  const { zoomModal } = zoom;
  if (!zoomModal.isOpen || !zoomModal.imageUrl) return null;
  return (
    <CardZoomModal
      isOpen={zoomModal.isOpen}
      onClose={zoom.hideZoom}
      imageUrl={zoomModal.imageUrl}
      isVideo={zoomModal.isVideo}
      title={zoomModal.title}
      subtitle={zoomModal.subtitle}
      caption={zoomModal.caption}
      identity={identity}
    />
  );
}