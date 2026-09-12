import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface Props {
  onClose: () => void
  children: ReactNode
  label?: string
}

/**
 * Independent draggable image viewer: portaled to <body> (never clipped by a
 * tab panel's overflow) and movable by dragging the frame itself.
 */
export default function MediaViewerModal({ onClose, children, label }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button,video')) return
    const rect = e.currentTarget.getBoundingClientRect()
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    setPos({ x: rect.left, y: rect.top })
    const move = (ev: PointerEvent) =>
      setPos({ x: ev.clientX - dragRef.current!.dx, y: ev.clientY - dragRef.current!.dy })
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-modal)] bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
    >
      <div
        className="absolute flex max-h-[86vh] max-w-[92vw] cursor-grab flex-col items-center active:cursor-grabbing"
        style={pos ? { left: pos.x, top: pos.y } : { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={startDrag}
      >
        {children}
        <button
          type="button"
          aria-label="Close viewer"
          className="absolute right-1.5 top-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-0 bg-black/60 p-0 text-white/90 hover:bg-black/85"
          onClick={onClose}
        >
          <X />
        </button>
      </div>
    </div>,
    document.body,
  )
}
