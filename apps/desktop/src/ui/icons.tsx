import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

function Base({ size = 14, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconRefresh = (p: P) => (
  <Base {...p}>
    <path d="M20 12a8 8 0 1 1-2.3-5.6M20 3v4h-4" />
  </Base>
)

export const IconWallpaper = (p: P) => (
  <Base {...p}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M2 15l5-4 4 3 4-4 7 5" />
  </Base>
)

export const IconChevronL = (p: P) => (
  <Base {...p}>
    <path d="M14 5l-7 7 7 7" />
  </Base>
)

export const IconChevronR = (p: P) => (
  <Base {...p}>
    <path d="M10 5l7 7-7 7" />
  </Base>
)

export const IconX = (p: P) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Base>
)

export const IconTrash = (p: P) => (
  <Base {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    <path d="M10 11v6M14 11v6" />
  </Base>
)
