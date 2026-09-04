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

export const IconCoin = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v8M9.5 10h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4" />
  </Base>
)

export const IconBolt = (p: P) => (
  <Base {...p}>
    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
  </Base>
)

export const IconCursor = (p: P) => (
  <Base {...p}>
    <path d="M5 3l14 7-6 2-2 6L5 3z" />
  </Base>
)

export const IconSkull = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="10" r="7" />
    <path d="M9 21v-3M15 21v-3M9.5 10.5h.01M14.5 10.5h.01M10 16.5h4" />
  </Base>
)

export const IconShard = (p: P) => (
  <Base {...p}>
    <path d="M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7z" />
  </Base>
)

export const IconTag = (p: P) => (
  <Base {...p}>
    <path d="M3 12V4h8l9 9-8 8-9-9z" />
    <circle cx="8" cy="9" r="1.4" />
  </Base>
)

export const IconImage = (p: P) => (
  <Base {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M4 18l5-5 3 3 3-3 5 5" />
  </Base>
)

export const IconFlask = (p: P) => (
  <Base {...p}>
    <path d="M9 3h6M10 3v6l-6 9a2 2 0 0 0 1.8 3h12.4A2 2 0 0 0 20 18l-6-9V3" />
    <path d="M7.5 15h9" />
  </Base>
)

export const IconTrophy = (p: P) => (
  <Base {...p}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
    <path d="M8 5H4a3 3 0 0 0 3 6M16 5h4a3 3 0 0 1-3 6M12 13v4M8 21h8M10 17h4" />
  </Base>
)

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

export const IconCheck = (p: P) => (
  <Base {...p}>
    <path d="M4 12.5l5 5L20 6.5" />
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
