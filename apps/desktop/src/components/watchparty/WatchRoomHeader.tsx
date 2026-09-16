'use client'

// Room section at the top of the watch rail: name (host-editable), watching
// count, host pill, invite, settings, leave. No bar on the video itself.

import { useState } from 'react'
import { Crown, Settings, Share, X } from 'lucide-react'
import { BTN, BTN_PRIMARY, MUTED } from '../../ui/styles'
import { Modal } from '../Modal'
import { Switch } from '../../ui/Switch'
import { kickParty, banParty, muteParty, transferParty, setPartySettings, leaveParty, disbandParty, type PartyRuntime } from '../../hooks/watchPartyStore'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

export function WatchRoomHeader({ party, identity, profilePics: _profilePics }: { party: PartyRuntime; identity: IdentityLike; profilePics: Record<string, string> }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState(party.name)
  const isHost = party.host === identity.orbitId

  const [copied, setCopied] = useState(false)
  const invite = () => {
    void navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}#/watch?room=${party.id}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <div className="px-3 py-2 border-b border-border-glass space-y-1.5">
        <div className="flex items-center gap-1.5">
          {editing && isHost ? (
            <input
              autoFocus
              aria-label="Room name"
              value={nameDraft}
              maxLength={40}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => { setEditing(false); if (nameDraft.trim() && nameDraft !== party.name) setPartySettings(party.id, { name: nameDraft }) }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className="glass-inset flex-1 min-w-0 px-2 py-1 text-xs"
            />
          ) : (
            <button
              type="button"
              onClick={() => { if (isHost) { setNameDraft(party.name); setEditing(true) } }}
              className={`min-w-0 flex-1 text-left text-xs font-bold uppercase tracking-wider text-retro-fg truncate ${isHost ? 'cursor-pointer hover:text-retro-muted' : 'cursor-default'}`}
              title={isHost ? 'Rename room' : undefined}
            >
              {party.name}
            </button>
          )}
          <button type="button" onClick={invite} aria-label="Copy invite link" title={copied ? 'Copied' : 'Invite'} className="relative p-1.5 rounded-md hover:bg-glass-w10 text-retro-muted hover:text-retro-fg cursor-pointer">
            <Share className="w-4 h-4" />
            {copied && <span className="absolute -top-6 left-1/2 -translate-x-1/2 rounded-md bg-glass-w12 px-1.5 py-0.5 text-[10px] text-retro-fg">Copied</span>}
          </button>
          {isHost && (
            <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Room settings" title="Room settings" className="p-1.5 rounded-md hover:bg-glass-w10 text-retro-muted hover:text-retro-fg cursor-pointer">
              <Settings className="w-4 h-4" />
            </button>
          )}
          <button type="button" onClick={() => leaveParty(party.id)} aria-label="Leave room" title="Leave room" className="p-1.5 rounded-md hover:bg-glass-w10 text-retro-muted hover:text-retro-fg cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className={`flex items-center gap-1 ${MUTED}`}>
          <Crown className="w-3 h-3" />
          {party.members.length}/8 watching
        </p>
        {party.mediaName && <p className={`truncate ${MUTED}`}>{party.mediaName}</p>}
      </div>

      {settingsOpen && (
        <Modal title="Room settings" onClose={() => setSettingsOpen(false)}>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-medium text-retro-fg">Private room</div>
                <div className="text-xs text-retro-muted">Hidden from the open rooms list. Invite link still works.</div>
              </div>
              <Switch checked={party.isPrivate} onChange={() => setPartySettings(party.id, { isPrivate: !party.isPrivate })} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-medium text-retro-fg">Lock video changes</div>
                <div className="text-xs text-retro-muted">Only the host can load or queue videos.</div>
              </div>
              <Switch checked={party.lockVideo} onChange={() => setPartySettings(party.id, { lockVideo: !party.lockVideo })} />
            </div>
            <ul className="border-t border-border-glass pt-2 space-y-1 max-h-52 overflow-y-auto styled-scrollbar">
              <li className="text-[10px] uppercase tracking-wider text-retro-muted">Members</li>
              {party.members.map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <span className="text-xs text-retro-fg truncate flex-1">{m.name || m.id.slice(0, 8)}</span>
                  {m.id === party.host ? (
                    <span className={MUTED}>host</span>
                  ) : m.id === identity.orbitId ? null : (
                    <div className="flex gap-1">
                      <button type="button" onClick={() => transferParty(party.id, m.id)} className={`${BTN} px-1.5 py-0.5 text-[10px]`}>Host</button>
                      <button type="button" onClick={() => muteParty(party.id, m.id, !m.muted)} className={`${BTN} px-1.5 py-0.5 text-[10px]`}>{m.muted ? 'Unmute' : 'Mute'}</button>
                      <button type="button" onClick={() => kickParty(party.id, m.id)} className={`${BTN} px-1.5 py-0.5 text-[10px]`}>Kick</button>
                      <button type="button" onClick={() => banParty(party.id, m.id)} className={`${BTN} px-1.5 py-0.5 text-[10px]`}>Ban</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => { disbandParty(party.id); setSettingsOpen(false) }} className={`${BTN} w-full py-2 text-xs text-retro-error hover:bg-retro-error/10`}>
              Delete room
            </button>
            <button type="button" onClick={() => setSettingsOpen(false)} className={`${BTN_PRIMARY} w-full py-2 text-xs flex items-center justify-center gap-2`}>
              <X className="w-3.5 h-3.5" />
              Done
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
