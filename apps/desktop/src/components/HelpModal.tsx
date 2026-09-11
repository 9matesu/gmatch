"use client";

import { useState } from 'react'
import { HelpCircle, X, UploadCloud, Globe, Shield, Keyboard } from 'lucide-react'

const TABS = [
  { id: 'getting-started', label: 'Getting Started', icon: HelpCircle },
  { id: 'sending', label: 'Sending', icon: UploadCloud },
  { id: 'network', label: 'Network', icon: Globe },
  { id: 'privacy', label: 'Privacy', icon: Shield },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
] as const

type TabId = typeof TABS[number]['id']

export function HelpModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<TabId>('getting-started')

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 select-none font-sans"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-border-glass rounded-lg max-w-xl w-full max-h-[85vh] flex flex-col shadow-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-glass">
          <h2 className="text-sm font-medium text-retro-fg">Help</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-retro-muted hover:text-retro-body p-1.5 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 p-1.5 border-b border-border-glass overflow-x-auto styled-scrollbar">
          {TABS.map(t => {
            const IconComp = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                  tab === t.id
                    ? 'bg-surface-interactive text-retro-fg'
                    : 'text-retro-muted hover:text-retro-fg'
                }`}
              >
                <IconComp className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 styled-scrollbar text-xs text-retro-body">
          {tab === 'getting-started' && (
            <div className="space-y-4">
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-retro-fg">What is GMatch?</h3>
                <p className="text-xs text-retro-muted leading-relaxed">
                  A decentralized P2P card matching and image sharing network. Your identity is a cryptographic keypair generated locally in your browser. Files travel directly between peers via WebRTC and encrypted blobs.
                </p>
              </section>
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-retro-fg">Your Identity</h3>
                <p className="text-xs text-retro-muted leading-relaxed">
                  When you launch GMatch, a signing keypair and an encryption keypair are created in your browser. Your GMatch ID is derived from your public key. Back up your export keys to restore your identity across devices.
                </p>
              </section>
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-retro-fg">Setting Up</h3>
                <ol className="text-xs text-retro-muted space-y-1.5 list-decimal list-inside leading-relaxed">
                  <li><span className="text-retro-body font-medium">Create your identity</span> — keys are generated in-browser, never uploaded unencrypted</li>
                  <li><span className="text-retro-body font-medium">Set a display name &amp; tags</span> — helps others find you</li>
                  <li><span className="text-retro-body font-medium">Browse the network</span> — online users appear at the top of the directory</li>
                  <li><span className="text-retro-body font-medium">Duel and rank cards</span> — gain score and unlock rarity tiers</li>
                </ol>
              </section>
            </div>
          )}

          {tab === 'sending' && (
            <div className="space-y-4">
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-retro-fg">How to Send</h3>
                <ol className="text-xs text-retro-muted space-y-1.5 list-decimal list-inside leading-relaxed">
                  <li><span className="text-retro-body font-medium">Select recipients</span> — check the box next to a user&apos;s name</li>
                  <li><span className="text-retro-body font-medium">Drop or click to browse</span> — media appear as preview thumbnails</li>
                  <li><span className="text-retro-body font-medium">Configure options</span> — toggle encryption, timebomb, or auto-forward</li>
                  <li><span className="text-retro-body font-medium">Send</span> — click the send button or drag a preview thumbnail onto a user card</li>
                </ol>
              </section>
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-retro-fg">Options Explained</h3>
                <div className="text-xs text-retro-muted space-y-2">
                  <div className="bg-surface-interactive p-3 border border-border-glass rounded-lg">
                    <span className="text-retro-body font-medium">Encrypt Image</span> — End-to-end encrypted with the recipient&apos;s encryption key.
                  </div>
                  <div className="bg-surface-interactive p-3 border border-border-glass rounded-lg">
                    <span className="text-retro-body font-medium">Send as Remote Wallpaper</span> — Sets the image as desktop wallpaper on the recipient&apos;s end.
                  </div>
                  <div className="bg-surface-interactive p-3 border border-border-glass rounded-lg">
                    <span className="text-retro-body font-medium">Timebomb</span> — Image auto-deletes after the set duration.
                  </div>
                </div>
              </section>
            </div>
          )}

          {tab === 'network' && (
            <div className="space-y-4">
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-retro-fg">Network Directory</h3>
                <p className="text-xs text-retro-muted leading-relaxed">
                  The directory shows all users connected to the relay. Users are sorted by online status first, then by activity.
                </p>
              </section>
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-retro-fg">P2P Transfers</h3>
                <p className="text-xs text-retro-muted leading-relaxed">
                  Files are sent via WebRTC directly between browsers whenever possible. If a direct connection cannot be established, the relay server facilitates the transfer securely.
                </p>
              </section>
            </div>
          )}

          {tab === 'privacy' && (
            <div className="space-y-4">
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-retro-fg">Pseudonymous by Design</h3>
                <p className="text-xs text-retro-muted leading-relaxed">
                  Identities are derived from keys held on your device — there is no email, phone number or password tied to your account. Your profile (name, tags, bio, avatar, public posts and activity counters) is what other players see.
                </p>
              </section>
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-retro-fg">Keys &amp; Data Stay Local</h3>
                <p className="text-xs text-retro-muted leading-relaxed">
                  Your private keys are generated in your browser and never uploaded. Private messages and protected content are encrypted end-to-end; the server cannot read them. Files are delivered via direct peer-to-peer connections wherever possible.
                </p>
              </section>
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-retro-fg">What We Store &amp; Never Share</h3>
                <p className="text-xs text-retro-muted leading-relaxed">
                  We store only the metadata needed to run the service and never sell your personal data. Moderation and admin actions are audited with actor, timestamp and reason; logs never contain private keys or plaintext protected content.
                </p>
              </section>
              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-retro-fg">18+ Content Policy</h3>
                <p className="text-xs text-retro-muted leading-relaxed">
                  This network is for adults 18+. Reported content is hidden instantly and reviewed with scoped evidence only. Strict zero tolerance for illegal content, non-consensual imagery, or harassment.
                </p>
              </section>
            </div>
          )}

          {tab === 'shortcuts' && (
            <div className="space-y-4">
              <section className="space-y-2">
                <h3 className="text-xs font-medium text-retro-fg">Keyboard Shortcuts</h3>
                <div className="text-xs space-y-1.5">
                  {[
                    ['?', 'Open help modal'],
                    ['g', 'Scroll to cards gallery'],
                    ['u', 'Focus user directory'],
                    ['r', 'Refresh card deck'],
                    ['n', 'Select random opponent'],
                    ['Esc', 'Close modals / clear selection'],
                    ['Ctrl+Shift+C', 'Copy your Orbit ID'],
                  ].map(([key, desc]) => (
                    <div key={key} className="flex items-center gap-3 py-1">
                      <kbd className="bg-surface-interactive border border-border-glass px-2 py-0.5 text-xs font-mono text-retro-body rounded min-w-[90px] text-center">{key}</kbd>
                      <span className="text-retro-muted">{desc}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
