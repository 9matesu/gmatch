/// <reference types="vite/client" />
import '@phosphor-icons/react'

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '@phosphor-icons/react' {
  interface IconProps {
    className?: string
  }
}
