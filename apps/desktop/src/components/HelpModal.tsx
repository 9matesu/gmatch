"use client";

import { useEffect, useState } from 'react'
import {
  HelpCircle,
  X,
  UploadCloud,
  Globe,
  Shield,
  Keyboard,
  Swords,
  MousePointerClick,
  Rss,
  MessageSquare,
  MonitorPlay,
  ShieldAlert,
  Coins,
} from 'lucide-react'
import { HELP_TOPICS } from '../help/helpContent'
import feedImg from '../assets/screenshots/feed.png'
import cardsImg from '../assets/screenshots/cards.png'
import idleImg from '../assets/screenshots/idle-grid.png'
import gamesImg from '../assets/screenshots/games-hub.png'
import watchImg from '../assets/screenshots/watch.png'
import serversImg from '../assets/screenshots/servers.png'

interface TabDef {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  group: 'start' | 'features' | 'system'
}

const TOPIC_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  duels: Swords,
  idle: MousePointerClick,
  feed: Rss,
  chat: MessageSquare,
  watch: MonitorPlay,
  domination: ShieldAlert,
  economy: Coins,
}

const TOPIC_IMAGES: Record<string, { src: string; caption: string }> = {
  'getting-started': { src: feedImg, caption: 'Decentralized social feed and media mesh' },
  duels: { src: cardsImg, caption: '5-round card duel arena with deck builder' },
  idle: { src: idleImg, caption: 'Companion clicker with tag market and keepsakes' },
  feed: { src: feedImg, caption: 'Post stream with peer-to-peer torrent seeding' },
  watch: { src: watchImg, caption: 'Synchronized watch party room and media theater' },
  economy: { src: gamesImg, caption: 'Games hub, marketplace, and league ladder' },
  network: { src: serversImg, caption: 'Node browser and server discovery directory' },
}

const TABS: TabDef[] = [
  { id: 'getting-started', label: 'Getting Started', icon: HelpCircle, group: 'start' },
  ...HELP_TOPICS.map((t) => ({
    id: t.id,
    label: t.tabLabel,
    icon: TOPIC_ICONS[t.id] ?? HelpCircle,
    group: 'features' as const,
  })),
  { id: 'sending', label: 'Sending', icon: UploadCloud, group: 'system' },
  { id: 'network', label: 'Network', icon: Globe, group: 'system' },
  { id: 'privacy', label: 'Privacy', icon: Shield, group: 'system' },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard, group: 'start' },
]

type TabId = (typeof TABS)[number]['id']

const TOPIC_BY_ID = new Map(HELP_TOPICS.map((t) => [t.id, t]))

function TopicBody({ topicId }: { topicId: string }) {
  const topic = TOPIC_BY_ID.get(topicId)
  if (!topic) return null
  const shot = TOPIC_IMAGES[topicId]

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-retro-fg">{topic.title}</h3>
        <p className="text-xs text-retro-muted mt-0.5">{topic.blurb}</p>
      </div>

      {shot && (
        <div className="border border-border-glass rounded-lg overflow-hidden bg-black/40">
          <img
            src={shot.src}
            alt={shot.caption}
            className="w-full max-h-56 object-cover object-top block"
            loading="lazy"
          />
          <div className="px-3 py-1 bg-surface-canvas/90 text-[10px] text-retro-muted font-mono border-t border-border-glass">
            {shot.caption}
          </div>
        </div>
      )}

      {topic.sections.map((s) => (
        <section key={s.heading} className="space-y-1.5">
          <h4 className="text-xs font-bold text-retro-fg uppercase tracking-wider">{s.heading}</h4>
          {s.body && <p className="text-xs text-retro-muted leading-relaxed">{s.body}</p>}
          {s.bullets && (
            <ul className="text-xs text-retro-muted leading-relaxed list-disc pl-4 space-y-1">
              {s.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {s.callout && (
            <p className="text-xs text-retro-fg leading-relaxed bg-surface-interactive border border-border-glass rounded-lg p-3">
              {s.callout}
            </p>
          )}
        </section>
      ))}
    </div>
  )
}

export function HelpModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<TabId>('getting-started')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const topic = TOPIC_BY_ID.get(tab)
  const currentTabDef = TABS.find((t) => t.id === tab)
  const quickstartShot = TOPIC_IMAGES['getting-started']
  const networkShot = TOPIC_IMAGES['network']

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 select-none font-sans"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Help"
        className="bg-surface-raised border border-border-glass rounded-xl max-w-4xl w-full h-[80vh] max-h-[620px] flex flex-col shadow-2xl overflow-hidden text-retro-fg my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-glass shrink-0 bg-surface-raised">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold tracking-wide text-retro-fg uppercase">Help &amp; Guide</h2>
            {currentTabDef && (
              <span className="text-[10px] text-retro-muted font-mono hidden sm:inline">
                / {currentTabDef.label}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help"
            className="text-retro-muted hover:text-retro-fg p-1.5 rounded-lg hover:bg-glass-w10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Two-Column Body */}
        <div className="flex-1 min-h-0 flex flex-col sm:flex-row overflow-hidden">
          {/* Left Navigation Sidebar */}
          <nav
            aria-label="Help topics"
            className="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r border-border-glass bg-surface-canvas/50 p-2 overflow-y-auto styled-scrollbar flex sm:flex-col gap-0.5"
          >
            {/* Start Group */}
            <div className="hidden sm:block px-2 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-retro-muted">
              Start
            </div>
            {TABS.filter((t) => t.group === 'start').map((t) => {
              const Icon = t.icon
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={active ? 'true' : undefined}
                  className={`w-full px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 cursor-pointer text-left whitespace-nowrap ${
                    active
                      ? 'bg-surface-interactive text-retro-fg font-bold border border-border-glass'
                      : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w5 border border-transparent'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{t.label}</span>
                </button>
              )
            })}

            {/* Features Group */}
            <div className="hidden sm:block px-2 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-retro-muted">
              Features
            </div>
            {TABS.filter((t) => t.group === 'features').map((t) => {
              const Icon = t.icon
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={active ? 'true' : undefined}
                  className={`w-full px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 cursor-pointer text-left whitespace-nowrap ${
                    active
                      ? 'bg-surface-interactive text-retro-fg font-bold border border-border-glass'
                      : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w5 border border-transparent'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{t.label}</span>
                </button>
              )
            })}

            {/* System Group */}
            <div className="hidden sm:block px-2 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-retro-muted">
              Network &amp; Security
            </div>
            {TABS.filter((t) => t.group === 'system').map((t) => {
              const Icon = t.icon
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={active ? 'true' : undefined}
                  className={`w-full px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 cursor-pointer text-left whitespace-nowrap ${
                    active
                      ? 'bg-surface-interactive text-retro-fg font-bold border border-border-glass'
                      : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w5 border border-transparent'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{t.label}</span>
                </button>
              )
            })}
          </nav>

          {/* Right Content Area */}
          <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 space-y-5 styled-scrollbar text-xs text-retro-body">
            {topic ? (
              <TopicBody topicId={topic.id} />
            ) : tab === 'getting-started' ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-bold text-retro-fg">Quickstart</h3>
                  <p className="text-xs text-retro-muted mt-0.5">
                    gMatch is a decentralized media and card gaming app running over a peer-to-peer WebTorrent mesh.
                  </p>
                </div>

                {quickstartShot && (
                  <div className="border border-border-glass rounded-lg overflow-hidden bg-black/40">
                    <img
                      src={quickstartShot.src}
                      alt={quickstartShot.caption}
                      className="w-full max-h-56 object-cover object-top block"
                      loading="lazy"
                    />
                    <div className="px-3 py-1 bg-surface-canvas/90 text-[10px] text-retro-muted font-mono border-t border-border-glass">
                      {quickstartShot.caption}
                    </div>
                  </div>
                )}

                <section className="space-y-2">
                  <h4 className="text-xs font-bold text-retro-fg uppercase tracking-wider">How it works</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="p-3 bg-surface-interactive/60 border border-border-glass rounded-lg space-y-1">
                      <span className="font-bold text-retro-fg">1. Keys stay on your device</span>
                      <p className="text-retro-muted leading-relaxed">
                        Your account is a cryptographic keypair generated locally. No email, phone number, or password is sent to any server.
                      </p>
                    </div>
                    <div className="p-3 bg-surface-interactive/60 border border-border-glass rounded-lg space-y-1">
                      <span className="font-bold text-retro-fg">2. Zero central storage</span>
                      <p className="text-retro-muted leading-relaxed">
                        Media is addressed by BitTorrent infohashes. Every post you view is retrieved from and seeded to other players over the mesh.
                      </p>
                    </div>
                    <div className="p-3 bg-surface-interactive/60 border border-border-glass rounded-lg space-y-1">
                      <span className="font-bold text-retro-fg">3. Build your 5-card deck</span>
                      <p className="text-retro-muted leading-relaxed">
                        You get 5 starter cards. Equip them in Deck Builder and press Set as Active to enter Quick Play duels.
                      </p>
                    </div>
                    <div className="p-3 bg-surface-interactive/60 border border-border-glass rounded-lg space-y-1">
                      <span className="font-bold text-retro-fg">4. Rooms and watch parties</span>
                      <p className="text-retro-muted leading-relaxed">
                        Stream videos in sync, chat with online players, and challenge peers directly in the Arena.
                      </p>
                    </div>
                  </div>
                </section>

                <section className="space-y-2 pt-2 border-t border-border-glass">
                  <h4 className="text-xs font-bold text-retro-fg uppercase tracking-wider">Troubleshooting &amp; Logs</h4>
                  <p className="text-retro-muted leading-relaxed">
                    If an action fails or a peer appears offline, diagnostic events are logged locally to help identify network and storage issues.
                  </p>
                  <div className="flex items-center gap-3 pt-1">
                    {window.gmatch?.openLogFolder && (
                      <button
                        type="button"
                        onClick={() => void window.gmatch?.openLogFolder?.()}
                        className="text-xs text-retro-muted hover:text-retro-fg underline underline-offset-2 cursor-pointer"
                      >
                        Open log folder
                      </button>
                    )}
                  </div>
                </section>
              </div>
            ) : tab === 'sending' ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-retro-fg">Sending Media</h3>
                  <p className="text-xs text-retro-muted mt-0.5">
                    Share images, videos, and cards with peers on the network.
                  </p>
                </div>
                <section className="space-y-2">
                  <h4 className="text-xs font-bold text-retro-fg uppercase tracking-wider">How to send</h4>
                  <ol className="text-xs text-retro-muted space-y-1.5 list-decimal list-inside leading-relaxed">
                    <li><span className="text-retro-fg font-medium">Select recipients</span>: choose a peer from the roster or active chat</li>
                    <li><span className="text-retro-fg font-medium">Drop or browse file</span>: preview images and videos before sending</li>
                    <li><span className="text-retro-fg font-medium">Configure options</span>: toggle encryption, timebomb expiration, or wallpaper sharing</li>
                    <li><span className="text-retro-fg font-medium">Send</span>: files stream end-to-end directly to the recipient</li>
                  </ol>
                </section>
                <section className="space-y-2">
                  <h4 className="text-xs font-bold text-retro-fg uppercase tracking-wider">Transmission Options</h4>
                  <div className="space-y-2">
                    <div className="bg-surface-interactive/60 p-3 border border-border-glass rounded-lg">
                      <span className="text-retro-fg font-medium">Encrypted Media</span>: Sealed directly to the recipient public encryption key.
                    </div>
                    <div className="bg-surface-interactive/60 p-3 border border-border-glass rounded-lg">
                      <span className="text-retro-fg font-medium">Remote Wallpaper</span>: Applies the media as background wallpaper for the recipient.
                    </div>
                    <div className="bg-surface-interactive/60 p-3 border border-border-glass rounded-lg">
                      <span className="text-retro-fg font-medium">Timebomb</span>: Automatically removes the payload after the configured duration expires.
                    </div>
                  </div>
                </section>
              </div>
            ) : tab === 'network' ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-retro-fg">Network &amp; Servers</h3>
                  <p className="text-xs text-retro-muted mt-0.5">
                    Connection topology, peer discovery, and hosting your own node.
                  </p>
                </div>

                {networkShot && (
                  <div className="border border-border-glass rounded-lg overflow-hidden bg-black/40">
                    <img
                      src={networkShot.src}
                      alt={networkShot.caption}
                      className="w-full max-h-56 object-cover object-top block"
                      loading="lazy"
                    />
                    <div className="px-3 py-1 bg-surface-canvas/90 text-[10px] text-retro-muted font-mono border-t border-border-glass">
                      {networkShot.caption}
                    </div>
                  </div>
                )}

                <section className="space-y-1.5">
                  <h4 className="text-xs font-bold text-retro-fg uppercase tracking-wider">Network Directory</h4>
                  <p className="text-xs text-retro-muted leading-relaxed">
                    The directory lists active nodes and online peers. Discovered peers are ranked by online presence and activity.
                  </p>
                </section>
                <section className="space-y-1.5">
                  <h4 className="text-xs font-bold text-retro-fg uppercase tracking-wider">Hosting a Node</h4>
                  <ul className="text-xs text-retro-muted space-y-1.5 list-disc list-inside leading-relaxed">
                    <li><span className="text-retro-fg font-medium">Host a world</span>: Open Settings &gt; Server and switch to Host mode. Your computer hosts a local sidecar.</li>
                    <li><span className="text-retro-fg font-medium">Share with friends</span>: In the Servers tab, copy your node code or LAN address to allow friends to connect.</li>
                    <li><span className="text-retro-fg font-medium">Join a friend</span>: Paste a node code in the Servers tab to switch to their world.</li>
                  </ul>
                </section>
              </div>
            ) : tab === 'privacy' ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-retro-fg">Privacy &amp; Security</h3>
                  <p className="text-xs text-retro-muted mt-0.5">
                    Cryptographic foundations, local-first data, and content safety.
                  </p>
                </div>
                <section className="space-y-1.5">
                  <h4 className="text-xs font-bold text-retro-fg uppercase tracking-wider">Pseudonymous by Design</h4>
                  <p className="text-xs text-retro-muted leading-relaxed">
                    Your account is derived entirely from cryptographic keys on this machine. There are no passwords, emails, or phone numbers tied to your presence.
                  </p>
                </section>
                <section className="space-y-1.5">
                  <h4 className="text-xs font-bold text-retro-fg uppercase tracking-wider">End-to-End Encryption</h4>
                  <p className="text-xs text-retro-muted leading-relaxed">
                    Direct messages and private transfers are encrypted using X25519 keys. The courier relay operates blindly and cannot read message bodies or user relationships.
                  </p>
                </section>
                <section className="space-y-1.5">
                  <h4 className="text-xs font-bold text-retro-fg uppercase tracking-wider">18+ Content Policy</h4>
                  <p className="text-xs text-retro-muted leading-relaxed">
                    This network is restricted to adults 18+. Client-side blocklists strictly prohibit illegal content, child exploitation, and non-consensual material.
                  </p>
                </section>
              </div>
            ) : tab === 'shortcuts' ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-retro-fg">Keyboard Shortcuts</h3>
                  <p className="text-xs text-retro-muted mt-0.5">
                    Quickly navigate and trigger actions without reaching for the mouse.
                  </p>
                </div>
                <section className="space-y-2">
                  <div className="divide-y divide-border-glass/40 text-xs">
                    {[
                      ['?', 'Open or close this help guide'],
                      ['Ctrl+H', 'Toggle help modal'],
                      ['g', 'Jump to card gallery'],
                      ['u', 'Focus peer directory'],
                      ['r', 'Refresh card deck'],
                      ['n', 'Select random opponent'],
                      ['Esc', 'Close open modals and popups'],
                      ['Ctrl+Shift+C', 'Copy your GMatch ID to clipboard'],
                    ].map(([key, desc]) => (
                      <div key={key} className="flex items-center justify-between py-2">
                        <span className="text-retro-muted">{desc}</span>
                        <kbd className="bg-surface-interactive border border-border-glass px-2 py-0.5 text-xs font-mono text-retro-fg rounded font-bold">
                          {key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  )
}

/** First-startup auto-show, exactly once per identity. Manual opens (?, Ctrl+H,menu) are unaffected: this only gates the automatic pop. */
const HELP_SEEN_KEY = 'gmatch_help_seen_v1'

export function hasSeenHelp(identityId?: string | null): boolean {
  try {
    if (typeof localStorage === 'undefined' || !identityId) return true
    return localStorage.getItem(`${HELP_SEEN_KEY}:${identityId}`) === '1'
  } catch {
    return true
  }
}

export function markHelpSeen(identityId?: string | null): void {
  try {
    if (typeof localStorage === 'undefined' || !identityId) return
    localStorage.setItem(`${HELP_SEEN_KEY}:${identityId}`, '1')
  } catch {
    /* private mode */
  }
}

