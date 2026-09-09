"use client";

import { useState, useEffect, useRef, useMemo } from 'react';
import { playPress } from '../../utils/sounds';
import {
  Send,
  Search,
  ChevronLeft,
  Minimize2,
  MessageSquare,
  Users,
  Gamepad2,
  Globe,
  Plus,
  X,
  Copy,
  Reply,
  Trash2,
  Flag,
  CornerUpLeft,
  Clock3,
  ImagePlus,
  Edit2,
  CheckCheck,
  Trash,
} from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { ChatMessage } from '../../hooks/useP2P';
import { orbitFetch } from '../../utils/api';
import { ObjectImage } from '../ObjectImage';

export interface PeerInfo {
  orbitId: string;
  name?: string;
  pfp?: string;
  is_online?: boolean;
  last_seen?: string;
}

export interface ThreadItem {
  peer_id: string;
  peer_name?: string | null;
  last_id?: string;
  last_body?: string;
  last_sender_id?: string;
  last_created_at?: string;
}

export interface GroupInfo {
  id: string;
  name: string;
  owner_id: string;
  member_count: number;
  is_member: number;
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

type OpenTarget = 'group' | 'lobby' | 'queue' | 'peer' | null;

export function GMatchDMs({
  identity,
  chatMessages = [],
  pmMessages = [],
  activePmPeer,
  peers = [],
  threads = [],
  profilePics = {},
  myDisplayName = 'You',
  groups = [],
  groupMessages = {},
  onSendMessage,
  onSendPm,
  onSelectPeer,
  onBackToThreads,
  onMinimize,
  onReportMessage,
  onReportUser,
  onDeleteMessage,
  onDeleteThread,
  onCreateGroup,
  onOpenAttachment,
  onSendGroupMessage,
  onLeaveGroup,
  onLoadGroupMessages,
  onSelectGroup,
  onOpenProfile,
  activeGroupId,
  onOpenImage,
  onLoadHistory,
}: {
  identity: OrbitIdentity | null;
  chatMessages?: ChatMessage[];
  pmMessages?: ChatMessage[];
  activePmPeer: PeerInfo | null;
  peers: PeerInfo[];
  threads?: ThreadItem[];
  profilePics: Record<string, string>;
  myDisplayName?: string;
  groups?: GroupInfo[];
  groupMessages?: Record<string, ChatMessage[]>;
  activeGroupId?: string | null;
  onSendMessage?: (text: string, channel?: string) => void;
  onSendPm?: (peerId: string, text: string, replyToId?: string, attachment?: { id: string; url: string; isVideo?: boolean }) => void;
  onOpenAttachment?: (target: 'pm' | 'group', peerId?: string, groupId?: string, replyToId?: string) => void;
  onSelectPeer: (peer: PeerInfo | null) => void;
  onBackToThreads?: () => void;
  onMinimize?: () => void;
  onReportMessage?: (messageId: string) => void;
  onReportUser?: (userId: string) => void;
  onDeleteMessage?: (messageId: string, peerId: string) => void;
  onDeleteThread?: (peerId: string) => Promise<void>;
  onCreateGroup?: (name: string, memberIds: string[]) => Promise<string | null>;
  onSendGroupMessage?: (groupId: string, text: string, replyToId?: string, attachment?: { id: string; url: string; isVideo?: boolean }) => void;
  onLeaveGroup?: (groupId: string) => void;
  onLoadGroupMessages?: (groupId: string) => void;
  onSelectGroup?: (groupId: string | null) => void;
  onOpenProfile?: (userId: string) => void;
  onOpenImage?: (message: ChatMessage) => void;
  onLoadHistory?: (peerId: string, beforeTimestamp: string) => Promise<boolean>;
}) {
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<{ id: string; url: string; isVideo: boolean } | null>(null);
  const messageStreamRef = useRef<HTMLDivElement>(null);
  const [readPeerIds, setReadPeerIds] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('orbit_read_dms');
        if (stored) return new Set(JSON.parse(stored));
      } catch {}
    }
    return new Set<string>();
  });
  const [listMode, setListMode] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [actionFor, setActionFor] = useState<string | null>(null);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState<Set<string>>(new Set());
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);
  const [deleteThreadPeerId, setDeleteThreadPeerId] = useState<string | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // The chat main page defaults to the public lobby when nothing is selected.
  const openTarget: OpenTarget = listMode
    ? null
    : activeGroupId
    ? 'group'
    : activePmPeer
    ? (activePmPeer.orbitId === 'global_lobby' ? 'lobby' : activePmPeer.orbitId === 'card_queue' ? 'queue' : 'peer')
    : 'lobby';

  const isLobbyGroup = openTarget === 'lobby';
  const isQueueGroup = openTarget === 'queue';

  // Mark current peer as read when opened
  useEffect(() => {
    if (activePmPeer?.orbitId) {
      setReadPeerIds((prev) => {
        if (prev.has(activePmPeer.orbitId)) return prev;
        const next = new Set(prev);
        next.add(activePmPeer.orbitId);
        try {
          localStorage.setItem('orbit_read_dms', JSON.stringify(Array.from(next)));
        } catch {}
        return next;
      });
    }
  }, [activePmPeer]);

  const lobbyMessages = useMemo(
    () => chatMessages.filter((m) => !m.channel || m.channel === 'global_lobby'),
    [chatMessages]
  );
  const queueMessages = useMemo(
    () => chatMessages.filter((m) => m.channel === 'card_queue'),
    [chatMessages]
  );

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = inputText.trim();
    if (!text && !pendingAttachment) return;

    playPress(920);
    if (openTarget === 'group' && activeGroupId) {
      onSendGroupMessage?.(activeGroupId, text || ' ', replyingTo?.id, pendingAttachment ?? undefined);
    } else if (isLobbyGroup) {
      onSendMessage?.(text || ' ', 'global_lobby');
    } else if (isQueueGroup) {
      onSendMessage?.(text || ' ', 'card_queue');
    } else if (activePmPeer) {
      onSendPm?.(activePmPeer.orbitId, text, replyingTo?.id, pendingAttachment ?? undefined);
    }
    setInputText('');
    setReplyingTo(null);
    setPendingAttachment(null);
  };

  const handleEditMessage = async (msg: ChatMessage) => {
    if (!identity || !activePmPeer) return;
    const newText = editingMessage?.text?.trim();
    if (!newText) { setEditingMessage(null); return; }
    try {
      const res = await orbitFetch(`/api/pm/${msg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: newText }),
      }, identity);
      if (res.ok) {
        const data = await res.json();
        // Message updated via WS push
      }
    } catch {}
    setEditingMessage(null);
  };

  const handleDeleteForEveryone = async (msg: ChatMessage) => {
    if (!identity || !activePmPeer) return;
    try {
      const res = await orbitFetch(`/api/pm/${msg.id}/everyone`, {
        method: 'DELETE',
      }, identity);
      if (res.ok) {
        // Message deleted via WS push
      }
    } catch {}
    setActionFor(null);
  };

  const handleDeleteThread = async (peerId: string) => {
    if (!identity) return;
    try {
      if (onDeleteThread) {
        await onDeleteThread(peerId);
      } else {
        const res = await orbitFetch(`/api/pm/threads/${peerId}`, {
          method: 'DELETE',
        }, identity);
        if (res.ok) {
          onBackToThreads?.();
        }
      }
    } catch {}
    setDeleteThreadPeerId(null);
  };

  const handleLoadHistory = async () => {
    if (!activePmPeer || !onLoadHistory || loadingHistory || !hasMoreHistory) return;
    const oldest = displayedMessages[0];
    if (!oldest) return;
    const scrollEl = messageStreamRef.current;
    const prevHeight = scrollEl?.scrollHeight || 0;
    setLoadingHistory(true);
    try {
      const more = await onLoadHistory(activePmPeer.orbitId, new Date(oldest.timestamp).toISOString());
      setHasMoreHistory(more);
      // Preserve scroll position after prepending messages
      requestAnimationFrame(() => {
        if (scrollEl) {
          scrollEl.scrollTop = scrollEl.scrollHeight - prevHeight;
        }
      });
    } catch {}
    setLoadingHistory(false);
  };

  const peerMap = new Map<string, PeerInfo>();
  for (const p of peers) {
    peerMap.set(p.orbitId, p);
  }

  const threadMap = new Map<string, ThreadItem>();
  for (const t of threads) {
    if (t.peer_id && t.peer_id !== identity?.orbitId && t.peer_id !== 'global_lobby' && t.peer_id !== 'card_queue') {
      threadMap.set(t.peer_id, t);
    }
  }

  if (activePmPeer && activePmPeer.orbitId !== identity?.orbitId && activePmPeer.orbitId !== 'global_lobby' && activePmPeer.orbitId !== 'card_queue' && !threadMap.has(activePmPeer.orbitId)) {
    threadMap.set(activePmPeer.orbitId, {
      peer_id: activePmPeer.orbitId,
      peer_name: activePmPeer.name || 'User',
      last_body: 'New conversation',
      last_sender_id: identity?.orbitId,
      last_created_at: new Date().toISOString(),
    });
  }

  const activeThreads = Array.from(threadMap.values());

  const isSearching = searchQuery.trim().length > 0;
  const searchResults = isSearching
    ? peers.filter(
        (p) =>
          p.orbitId !== identity?.orbitId &&
          (p.name || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  const displayNameFor = (id: string, fallback?: string | null) => {
    if (identity && id === identity.orbitId) return myDisplayName || 'You';
    if (id === 'global_lobby') return 'Lobby Lounge (Everyone)';
    if (id === 'card_queue') return 'Card Game Queue';
    const peer = peerMap.get(id);
    if (peer?.name && !peer.name.startsWith('0x') && peer.name.length < 32) return peer.name;
    if (fallback && !fallback.startsWith('0x') && fallback.length < 32) return fallback;
    return 'User';
  };

  const displayedMessages: ChatMessage[] =
    openTarget === 'group'
      ? (groupMessages[activeGroupId || ''] || [])
      : isLobbyGroup
      ? lobbyMessages
      : isQueueGroup
      ? queueMessages
      : pmMessages;

  const messageBlocks = useMemo(() => {
    const blocks: ChatMessage[][] = [];
    for (const msg of displayedMessages) {
      const prev = blocks[blocks.length - 1];
      const prevMsg = prev ? prev[prev.length - 1] : null;
      if (prevMsg && prevMsg.senderId === msg.senderId && (msg.timestamp - prevMsg.timestamp) < GROUP_WINDOW_MS) {
        prev.push(msg);
      } else {
        blocks.push([msg]);
      }
    }
    return blocks;
  }, [displayedMessages]);

  const findMessage = (id?: string): ChatMessage | undefined =>
    id ? displayedMessages.find((m) => m.id === id) : undefined;

  const copyMessage = (text: string) => {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    setActionFor(null);
  };

  useEffect(() => {
    const stream = messageStreamRef.current;
    if (!stream) return;
    stream.scrollTop = stream.scrollHeight;
  }, [activePmPeer?.orbitId, activeGroupId, displayedMessages.length]);

  const lastLobbyMsg = lobbyMessages[lobbyMessages.length - 1]?.text || 'Active public discussion...';
  const lastQueueMsg = queueMessages[queueMessages.length - 1]?.text || 'Matchmaking chat & challenges';

  const openGroup = (g: GroupInfo) => {
    playPress(800);
    setListMode(false);
    onSelectGroup?.(g.id);
    setReplyingTo(null);
    onLoadGroupMessages?.(g.id);
  };

  const submitNewGroup = async () => {
    if (!newGroupName.trim()) return;
    const id = await onCreateGroup?.(newGroupName.trim(), Array.from(newGroupMembers));
    if (id) {
      setShowNewGroup(false);
      setNewGroupName('');
      setNewGroupMembers(new Set());
      onSelectGroup?.(id);
      setListMode(false);
      onLoadGroupMessages?.(id);
    }
  };

  const headerTitle =
    openTarget === 'group'
      ? (groups.find((g) => g.id === activeGroupId)?.name || 'Group')
      : isLobbyGroup
      ? 'Lobby Lounge'
      : isQueueGroup
      ? 'Card Queue'
      : activePmPeer
      ? displayNameFor(activePmPeer.orbitId, activePmPeer.name)
      : 'User';
  const headerSubtitle =
    openTarget === 'group'
      ? 'Group chat'
      : isLobbyGroup
      ? 'Public lobby · clears every 12 hours'
      : isQueueGroup
      ? 'Queue chat'
      : 'Direct message';

  return (
    <div className="flex-1 min-h-[480px] h-full w-full solid-panel overflow-hidden flex flex-col md:flex-row font-sans text-retro-fg animate-orbit-fade-in">
      {/* Left Column */}
      <div className={`w-full md:w-80 lg:w-88 border-r border-border-glass flex flex-col bg-surface-canvas/80 shrink-0 min-h-0 select-none ${openTarget ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-3 sm:p-4 metro-rule flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="font-semibold text-sm text-zinc-50 truncate">
              {myDisplayName || 'Messages'}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { playPress(800); setShowNewGroup((v) => !v); }}
              title="New group"
              aria-label="New group"
              className="p-1.5 rounded-md text-retro-muted hover:text-retro-fg transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
            </button>
            {onMinimize && (
              <button
                type="button"
                onClick={() => { playPress(800); onMinimize(); }}
                title="Minimize"
                aria-label="Minimize"
                className="p-1.5 rounded-md text-retro-muted hover:text-retro-fg transition-colors cursor-pointer"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {showNewGroup && (
          <div className="p-3 metro-rule space-y-2 shrink-0">
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Group name"
              className="w-full bg-surface-raised border border-border-glass rounded-md px-3 py-1.5 text-xs text-retro-fg placeholder:text-retro-muted outline-none focus:border-retro-accent/60"
            />
            <div className="max-h-32 overflow-y-auto styled-scrollbar space-y-1">
              {peers.filter((p) => p.orbitId !== identity?.orbitId).map((p) => (
                <label key={p.orbitId} className="flex items-center gap-2 text-xs text-retro-body cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newGroupMembers.has(p.orbitId)}
                    onChange={() => setNewGroupMembers((prev) => {
                      const next = new Set(prev);
                      if (next.has(p.orbitId)) next.delete(p.orbitId); else next.add(p.orbitId);
                      return next;
                    })}
                  />
                  {displayNameFor(p.orbitId, p.name)}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={submitNewGroup} className="px-3 py-1.5 bg-retro-accent text-black rounded-md text-xs font-bold cursor-pointer hover:bg-retro-accent-hover">Create</button>
              <button type="button" onClick={() => { setShowNewGroup(false); setNewGroupMembers(new Set()); }} className="px-3 py-1.5 bg-white/8 border border-border-glass rounded-md text-xs cursor-pointer hover:bg-white/12">Cancel</button>
            </div>
          </div>
        )}

        <div className="p-2.5 metro-rule shrink-0">
          <div className="flex items-center gap-2 bg-surface-raised border border-border-glass rounded-md px-3 py-1.5 text-xs text-retro-body">
            <Search className="w-3.5 h-3.5 text-retro-muted shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full bg-transparent focus:outline-none placeholder:text-retro-muted text-retro-fg border-none"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar">
          <button
            type="button"
            onClick={() => { playPress(800); setListMode(false); onSelectGroup?.(null); onSelectPeer({ orbitId: 'global_lobby', name: 'Lobby Lounge (Everyone)' }); }}
            className={`w-full p-3 flex items-center gap-3 hover:bg-white/5 transition-colors metro-rule text-left cursor-pointer ${openTarget === 'lobby' ? 'bg-white/8 border-border-glass' : ''}`}
          >
            <div className="relative w-10 h-10 rounded-full bg-surface-raised border border-border-glass text-retro-muted shrink-0 overflow-hidden flex items-center justify-center">
              <Globe className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-medium text-retro-body truncate flex items-center gap-1"><Globe className="w-3 h-3 text-retro-muted" /> Lobby Lounge</span>
                <span className="text-[10px] text-retro-muted shrink-0 tabular-nums">{lobbyMessages.length}</span>
              </div>
              <p className="text-[11px] truncate mt-0.5 text-retro-muted">{lastLobbyMsg}</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => { playPress(800); setListMode(false); onSelectGroup?.(null); onSelectPeer({ orbitId: 'card_queue', name: 'Card Game Queue' }); }}
            className={`w-full p-3 flex items-center gap-3 hover:bg-white/5 transition-colors metro-rule text-left cursor-pointer ${openTarget === 'queue' ? 'bg-white/8 border-border-glass' : ''}`}
          >
            <div className="relative w-10 h-10 rounded-full bg-surface-raised border border-border-glass text-retro-muted shrink-0 overflow-hidden flex items-center justify-center">
              <Gamepad2 className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-medium text-retro-body truncate flex items-center gap-1"><Gamepad2 className="w-3 h-3 text-retro-muted" /> Card Queue</span>
                <span className="text-[10px] text-retro-muted shrink-0 tabular-nums">{queueMessages.length}</span>
              </div>
              <p className="text-[11px] truncate mt-0.5 text-retro-muted">{lastQueueMsg}</p>
            </div>
          </button>

          {groups.length > 0 && (
            <>
              <div className="px-3 py-1.5 metro-rule text-xs text-retro-muted flex items-center gap-1.5"><Users className="w-3 h-3" /> Groups</div>
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => openGroup(g)}
                  className={`w-full p-3 flex items-center gap-3 hover:bg-white/5 transition-colors metro-rule text-left cursor-pointer ${activeGroupId === g.id && openTarget === 'group' ? 'bg-white/8 border-border-glass' : ''}`}
                >
                  <div className="w-10 h-10 rounded-full bg-surface-raised border border-border-glass text-retro-muted shrink-0 overflow-hidden flex items-center justify-center"><Users className="w-4 h-4" /></div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-retro-body truncate block">{g.name}</span>
                    <p className="text-[11px] truncate mt-0.5 text-retro-muted">{g.member_count} members</p>
                  </div>
                </button>
              ))}
            </>
          )}

          <div className="px-3 py-1.5 metro-rule text-xs text-retro-muted"><span>Direct Messages</span></div>

          {isSearching ? (
            <div className="p-2 space-y-1">
              {searchResults.length === 0 ? (
                <div className="text-center py-8 text-xs text-retro-muted">No results for &quot;{searchQuery}&quot;</div>
              ) : (
                searchResults.map((p) => {
                  const pfp = profilePics[p.orbitId];
                  const name = displayNameFor(p.orbitId, p.name);
                  return (
                    <button
                      key={p.orbitId}
                      type="button"
                      onClick={() => { playPress(800); setListMode(false); onSelectGroup?.(null); onSelectPeer(p); setSearchQuery(''); }}
                      className="w-full p-2.5 rounded-md flex items-center gap-3 hover:bg-white/5 transition-colors text-left cursor-pointer"
                    >
                      <div className="w-9 h-9 rounded-full bg-surface-raised border border-border-glass text-retro-muted font-medium text-xs flex items-center justify-center overflow-hidden shrink-0">
                        {pfp ? <img src={pfp} alt="" className="w-full h-full object-cover" /> : name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-retro-body truncate">{name}</div>
                        <div className="text-[10px] text-retro-muted">Send message</div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          ) : activeThreads.length === 0 ? (
            <div className="p-6 text-center"><p className="text-xs text-retro-muted">No conversations yet</p></div>
          ) : (
            <>
              {activeThreads.map((thread) => {
              const peerId = thread.peer_id;
              const isSelected = openTarget === 'peer' && activePmPeer?.orbitId === peerId;
              const pfp = profilePics[peerId];
              const name = displayNameFor(peerId, thread.peer_name);
              const isFromOther = thread.last_sender_id && thread.last_sender_id !== identity?.orbitId;
              const isUnread = isFromOther && !readPeerIds.has(peerId) && !isSelected;
              const showThreadActions = deleteThreadPeerId === peerId;

              const handleThreadContextMenu = (e: React.MouseEvent) => {
                e.preventDefault();
                if (deleteThreadPeerId === peerId) {
                  setDeleteThreadPeerId(null);
                } else {
                  setDeleteThreadPeerId(peerId);
                }
              };

              return (
                <div key={peerId} onContextMenu={handleThreadContextMenu}>
                  <button
                    type="button"
                    onClick={() => { playPress(800); setListMode(false); onSelectGroup?.(null); onSelectPeer({ orbitId: peerId, name, pfp }); setDeleteThreadPeerId(null); }}
                    className={`w-full p-3 flex items-center gap-3 hover:bg-white/5 transition-colors metro-rule text-left cursor-pointer ${isSelected ? 'bg-white/8 border-border-glass' : ''}`}
                  >
                    <div className="relative w-10 h-10 rounded-full bg-surface-raised border border-border-glass text-retro-muted shrink-0 overflow-hidden flex items-center justify-center font-medium text-xs">
                      {pfp ? <img src={pfp} alt="" className="w-full h-full object-cover" /> : name.charAt(0).toUpperCase()}
                      {isUnread && <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-retro-accent shadow-[0_0_8px_rgba(159,227,255,0.4)]" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className={`text-xs truncate ${isUnread ? 'font-semibold text-retro-fg' : 'font-medium text-retro-body'}`}>{name}</span>
                        {isUnread ? (
                          <span className="w-2 h-2 rounded-full bg-retro-accent shrink-0 shadow-[0_0_8px_rgba(159,227,255,0.4)]" />
                        ) : (
                          <span className="text-[10px] text-retro-muted shrink-0 tabular-nums">
                            {thread.last_created_at ? new Date(thread.last_created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                          </span>
                        )}
                      </div>
                      <p className={`text-[11px] truncate mt-0.5 ${isUnread ? 'text-retro-body font-medium' : 'text-retro-muted'}`}>{thread.last_body || 'No messages yet'}</p>
                    </div>
                  </button>
                  {showThreadActions && (
                    <div className="absolute left-full top-0 ml-2 mt-1 z-10 bg-surface-raised border border-border-glass rounded-md shadow-lg py-1 min-w-[140px] animate-orbit-pop">
                      <button
                        type="button"
                        onClick={() => { handleDeleteThread(peerId); setDeleteThreadPeerId(null); }}
                        className="w-full px-3 py-2 text-left text-xs text-rose-400 hover:bg-white/5 cursor-pointer"
                      >
                        Delete Conversation
                      </button>
                    </div>
                  )}
                </div>
              );
              })}
            </>
          )}
        </div>
      </div>

      {/* Right Column */}
      <div className={`flex-1 min-h-0 flex flex-col bg-surface-canvas/50 min-w-0 overflow-hidden ${openTarget ? 'flex' : 'hidden md:flex'}`}>
        {openTarget ? (
          <>
            <div className="p-3 sm:p-3.5 px-4 metro-rule flex items-center justify-between shrink-0 select-none">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => { playPress(700); setListMode(true); onSelectGroup?.(null); onBackToThreads?.(); }}
                  className="md:hidden p-1 text-retro-muted hover:text-retro-fg cursor-pointer"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                <div className="w-8 h-8 rounded-full bg-surface-raised border border-border-glass shrink-0 overflow-hidden flex items-center justify-center text-xs font-medium text-retro-muted">
                  {openTarget === 'group' ? (
                    <Users className="w-4 h-4" />
                  ) : isLobbyGroup ? (
                    <Globe className="w-4 h-4" />
                  ) : isQueueGroup ? (
                    <Gamepad2 className="w-4 h-4" />
                  ) : activePmPeer && profilePics[activePmPeer.orbitId] ? (
                    <img src={profilePics[activePmPeer.orbitId]} alt="" className="w-full h-full object-cover" />
                  ) : (
                    headerTitle.charAt(0).toUpperCase()
                  )}
                </div>

                <div className="min-w-0">
                  <h3 className="text-xs font-medium text-retro-fg truncate">{headerTitle}</h3>
                  <span className="text-[10px] text-retro-muted block">{headerSubtitle}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 text-retro-muted shrink-0">
                {openTarget === 'group' && activeGroupId && onLeaveGroup && (
                  <button
                    type="button"
                    onClick={() => { playPress(800); onLeaveGroup(activeGroupId); onSelectGroup?.(null); setListMode(true); }}
                    title="Leave group"
                    className="p-1.5 rounded-md text-retro-muted hover:text-rose-400 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
                {onMinimize && (
                  <button type="button" onClick={() => { playPress(800); onMinimize(); }} title="Minimize" className="p-1.5 rounded-md text-retro-muted hover:text-retro-fg transition-colors cursor-pointer">
                    <Minimize2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div ref={messageStreamRef} className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3 styled-scrollbar select-text">
              {displayedMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2 text-retro-muted my-auto select-none">
                  <MessageSquare className="w-6 h-6" />
                  <p className="text-xs text-retro-body">{headerTitle}</p>
                  <p className="text-[11px] text-retro-muted">Send a message to start chatting</p>
                  {isLobbyGroup && (
                    <p className="text-[10px] text-retro-muted flex items-center gap-1"><Clock3 className="w-3 h-3" /> Clears every 12 hours</p>
                  )}
                </div>
              ) : (
                <>
                {openTarget === 'peer' && onLoadHistory && hasMoreHistory && displayedMessages.length >= 20 && (
                  <div className="flex justify-center pb-2">
                    <button
                      type="button"
                      onClick={handleLoadHistory}
                      disabled={loadingHistory}
                      className="px-3 py-1.5 rounded-md bg-white/8 border border-border-glass text-[10px] text-retro-muted hover:text-retro-fg hover:bg-white/12 transition-colors cursor-pointer disabled:opacity-40"
                    >
                      {loadingHistory ? 'Loading...' : 'Load earlier messages'}
                    </button>
                  </div>
                )}
                {messageBlocks.map((block, bi) => {
                  const first = block[0];
                  const isOwn = identity && first.senderId === identity.orbitId;
                  const senderName = isOwn ? (myDisplayName || 'You') : displayNameFor(first.senderId, first.senderName);
                  const pfp = profilePics[first.senderId];
                  return (
                    <div key={block[0].id || bi} className={`flex items-end gap-2 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                      {!isOwn && (
                        <div
                          className="w-6 h-6 rounded-full bg-surface-raised border border-border-glass text-retro-muted overflow-hidden flex items-center justify-center text-[10px] font-medium shrink-0 mb-1 select-none cursor-pointer hover:ring-1 hover:ring-retro-accent/50 transition-shadow"
                          onClick={() => onOpenProfile?.(first.senderId)}
                          title={senderName}
                        >
                          {pfp ? <img src={pfp} alt="" className="w-full h-full object-cover" /> : senderName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className={`flex flex-col max-w-[78%] sm:max-w-[70%] ${isOwn ? 'items-end' : 'items-start'}`}>
                        {!isOwn && (
                          <button
                            type="button"
                            className="text-[10px] text-retro-muted ml-2 mb-0.5 select-text cursor-pointer hover:text-retro-accent transition-colors inline-flex items-center"
                            onClick={() => onOpenProfile?.(first.senderId)}
                          >
                            {senderName}
                          </button>
                        )}
                        {block.map((msg) => {
                          const replyTarget = findMessage(msg.replyToId);
                          const isLast = msg.id === block[block.length - 1].id;
                          const showActions = actionFor === msg.id;
                          return (
                            <div key={msg.id} className="w-full">
                              {replyTarget && (
                                <div className="text-[10px] text-retro-muted px-2.5 py-1 mb-0.5 bg-white/5 rounded-md border-l-2 border-retro-accent/50 truncate max-w-full">
                                  <CornerUpLeft className="w-3 h-3 inline mr-1" />
                                  {replyTarget.senderId === identity?.orbitId ? 'You' : displayNameFor(replyTarget.senderId)}: {replyTarget.text}
                                </div>
                              )}
                              <div
                                onClick={() => setActionFor(showActions ? null : msg.id)}
                                className={`px-3 py-2 rounded-lg text-xs leading-relaxed select-text cursor-pointer break-words whitespace-pre-wrap ${block.length > 1 ? 'mt-0.5' : ''} ${
                                  isOwn ? 'bg-retro-accent/15 text-retro-fg rounded-br-sm' : 'bg-surface-raised border border-border-glass text-retro-body rounded-bl-sm'
                                }`}
                              >
                                {msg.attachmentUrl && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onOpenImage?.(msg);
                                    }}
                                    title="Open image viewer"
                                    className={`-mx-1 -mt-1 mb-1.5 rounded-md overflow-hidden bg-black cursor-pointer block ${msg.text ? '' : 'mb-0'}`}
                                  >
                                    <ObjectImage
                                      contentUrl={msg.attachmentUrl}
                                      mimeType={msg.attachmentMime}
                                      identity={identity}
                                      alt="Attached image"
                                      className="max-w-56 sm:max-w-64 max-h-56 rounded-md object-contain hover:opacity-90 transition-opacity"
                                      videoClassName="max-w-56 sm:max-w-64 max-h-56 rounded-md object-contain hover:opacity-90 transition-opacity"
                                    />
                                  </button>
                                )}
                                {editingMessage?.id === msg.id ? (
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="text"
                                      value={editingMessage.text}
                                      onChange={(e) => setEditingMessage({ ...editingMessage!, text: e.target.value })}
                                      className="bg-white/10 border border-border-glass rounded px-2 py-1 text-xs text-retro-fg outline-none focus:border-retro-accent w-64"
                                      autoFocus
                                    />
                                    <button type="button" onClick={() => handleEditMessage(msg)} className="px-2 py-1 bg-retro-accent text-black text-[10px] rounded cursor-pointer">Save</button>
                                    <button type="button" onClick={() => setEditingMessage(null)} className="px-2 py-1 bg-white/8 border border-border-glass text-[10px] rounded cursor-pointer">Cancel</button>
                                  </div>
                                ) : (
                                  msg.text
                                )}
                              </div>
                              {isLast && (
                                <div className={`mt-0.5 flex items-center gap-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                                  <time className="text-[9px] text-retro-muted select-none" dateTime={new Date(msg.timestamp).toISOString()}>
                                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </time>
                                  {isOwn && msg.readByRecipient && (
                                    <span title="Seen"><CheckCheck className="w-3 h-3 text-retro-accent" /></span>
                                  )}
                                  {msg.editedAt && (
                                    <span className="text-[9px] text-retro-muted">Edited</span>
                                  )}
                                </div>
                              )}
                              {showActions && (() => {
                                const ageMs = Date.now() - msg.timestamp;
                                const canEdit = isOwn && ageMs < 15 * 60 * 1000;
                                const canDeleteEveryone = isOwn && ageMs < 10 * 60 * 1000;
                                return (
                                <div className={`flex flex-wrap items-center gap-1 mt-1 ${isOwn ? 'justify-end' : ''}`}>
                                  <button type="button" onClick={() => { setReplyingTo(msg); setActionFor(null); }} className="px-2 py-1 rounded-md bg-white/8 border border-border-glass text-[10px] flex items-center gap-1 cursor-pointer hover:bg-white/12"><Reply className="w-3 h-3" /> Reply</button>
                                  <button type="button" onClick={() => copyMessage(msg.text)} className="px-2 py-1 rounded-md bg-white/8 border border-border-glass text-[10px] flex items-center gap-1 cursor-pointer hover:bg-white/12"><Copy className="w-3 h-3" /> Copy</button>
                                  {canEdit && (
                                    <button
                                      type="button"
                                      onClick={() => { setEditingMessage({ id: msg.id, text: msg.text }); setActionFor(null); }}
                                      className="px-2 py-1 rounded-md bg-white/8 border border-border-glass text-[10px] flex items-center gap-1 cursor-pointer hover:bg-white/12"
                                    ><Edit2 className="w-3 h-3" /> Edit</button>
                                  )}
                                  {canDeleteEveryone && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteForEveryone(msg)}
                                      className="px-2 py-1 rounded-md bg-white/8 border border-border-glass text-[10px] flex items-center gap-1 cursor-pointer text-rose-400 hover:bg-white/12"
                                    ><Trash className="w-3 h-3" /> Delete for Everyone</button>
                                  )}
                                  {isOwn && (
                                    <button
                                      type="button"
                                      onClick={() => { onDeleteMessage?.(msg.id, activePmPeer?.orbitId || ''); setActionFor(null); }}
                                      className="px-2 py-1 rounded-md bg-white/8 border border-border-glass text-[10px] flex items-center gap-1 cursor-pointer text-rose-400 hover:bg-white/12"
                                    ><Trash2 className="w-3 h-3" /> Delete for Me</button>
                                  )}
                                  {!isOwn && onReportMessage && (
                                    <button type="button" onClick={() => { onReportMessage(msg.id); setActionFor(null); }} className="px-2 py-1 rounded-md bg-white/8 border border-border-glass text-[10px] flex items-center gap-1 cursor-pointer text-rose-400 hover:bg-white/12"><Flag className="w-3 h-3" /> Report</button>
                                  )}
                                  {!isOwn && onReportUser && (
                                    <button type="button" onClick={() => { onReportUser(msg.senderId); setActionFor(null); }} className="px-2 py-1 rounded-md bg-white/8 border border-border-glass text-[10px] cursor-pointer text-rose-400 hover:bg-white/12">Report user</button>
                                  )}
                                </div>
                                );
                              })()}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </>
              )}
            </div>

            {replyingTo && (
              <div className="px-3 pt-2 flex items-center gap-2 text-xs text-retro-muted shrink-0 metro-rule-top">
                <CornerUpLeft className="w-3.5 h-3.5" />
                <span className="truncate">Replying to {replyingTo.senderId === identity?.orbitId ? 'you' : displayNameFor(replyingTo.senderId)}: {replyingTo.text}</span>
                <button type="button" onClick={() => setReplyingTo(null)} className="ml-auto text-retro-muted hover:text-retro-fg cursor-pointer"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}

            {pendingAttachment && (
              <div className="px-3 pt-2 flex items-center gap-2 text-xs text-retro-muted shrink-0 metro-rule-top">
                <ImagePlus className="w-3.5 h-3.5" />
                <span className="truncate">Attachment ready to send</span>
                <button type="button" onClick={() => setPendingAttachment(null)} className="ml-auto text-retro-muted hover:text-retro-fg cursor-pointer"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}

            <form onSubmit={handleSend} className="p-3 metro-rule-top flex items-center gap-2 shrink-0">
              {(activePmPeer && openTarget === 'peer') || openTarget === 'group' ? (
                <button
                  type="button"
                  onClick={() => {
                    playPress(840);
                    if (openTarget === 'group' && activeGroupId) {
                      onOpenAttachment?.('group', undefined, activeGroupId, replyingTo?.id);
                    } else if (activePmPeer) {
                      onOpenAttachment?.('pm', activePmPeer.orbitId, undefined, replyingTo?.id);
                    }
                  }}
                  title="Attach an image or video"
                  className="p-2 rounded-md bg-surface-raised border border-border-glass text-retro-muted hover:text-retro-accent cursor-pointer transition-colors"
                >
                  <ImagePlus className="w-4 h-4" />
                </button>
              ) : null}
              <div className="flex-1 flex items-center gap-2 bg-surface-raised border border-border-glass rounded-md px-3 py-2 text-xs focus-within:border-retro-accent/50 transition-colors">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter sends explicitly — do not rely on implicit form
                    // submit: with focus left on the (type=button) attach
                    // control, Enter re-opened the image picker instead.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder={openTarget === 'group' ? 'Message group...' : isLobbyGroup ? 'Message Lobby Lounge...' : isQueueGroup ? 'Message Card Queue...' : activePmPeer ? `Message ${displayNameFor(activePmPeer.orbitId, activePmPeer.name)}...` : 'Message...'}
                  className="w-full bg-transparent focus:outline-none placeholder:text-retro-muted text-retro-fg border-none"
                />
              </div>
              <button
                type="submit"
                disabled={!inputText.trim() && !pendingAttachment}
                className="p-2 rounded-md bg-retro-accent hover:bg-retro-accent-hover text-black disabled:opacity-30 cursor-pointer transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-3">
            <MessageSquare className="w-6 h-6 text-retro-muted" />
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-retro-body">Messages</h3>
              <p className="text-xs text-retro-muted max-w-xs">Select a conversation to start chatting.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
