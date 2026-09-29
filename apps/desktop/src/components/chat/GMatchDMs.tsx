"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { playPress } from '../../utils/sounds';
import { resolveMediaUrl } from '../../utils/media';
import { GroupMembersPopover, type GroupMember } from './GroupMembersPopover';
import {
  Send,
  Search,
  ChevronLeft,
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
  Lock,
  LogOut,
} from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { User } from '@orbit/shared';
import type { ChatMessage } from '../../hooks/useP2P';
import { orbitFetch } from '../../utils/api';
import { ObjectImage } from '../ObjectImage';
import { DropZone, readClipboard } from '../DropZone';
import { ChatPlayerList } from './ChatPlayerList';
import { Linkify } from '../Linkify';
import { chatDisplayName } from './chatDisplayName';
import { nameFor, nameRoster as nameRosterFromDirectory, rememberName } from '../../game/nameDirectory';
import { groupMessagesByDay } from '../../utils/chatDays';
import { UNKNOWN_NAME } from '../../utils/displayName';

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

// GROUP_WINDOW_MS now lives with the block grouping it belongs to, in
// utils/chatDays.ts, alongside the day separators computed in the same pass.

type OpenTarget = 'group' | 'lobby' | 'queue' | 'peer' | 'room' | null;

export interface RoomInfo {
  id: string;
  name: string;
  ownerId: string;
  members: string[];
  epoch: number;
  /** ms stamp of the last time the user opened this room (unread cue). */
  seenAt?: number;
}

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
  showRooms = false,
  rooms = [],
  activeRoomId = null,
  onSelectRoom,
  onCreateRoom,
  onInviteRoom,
  onSayRoom,
  onLeaveRoom,
  getRoomMessages,
  onSendMessage,
  onSendPm,
  onSelectPeer,
  onBackToThreads,
  onReportMessage,
  onReportUser,
  onDeleteMessage,
  onDeleteThread,
  onCreateGroup,
  onOpenAttachment,
  onSendGroupMessage,
  onLeaveGroup,
  onLoadGroupMessages,
  onLoadGroupMembers,
  onAddGroupMembers,
  onSelectGroup,
  onOpenProfile,
  onUserContext,
  activeGroupId,
  onOpenImage,
  onLoadHistory,
  users = [],
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
  showRooms?: boolean;
  rooms?: RoomInfo[];
  activeRoomId?: string | null;
  onSelectRoom?: (roomId: string | null) => void;
  onCreateRoom?: (name: string) => RoomInfo | null;
  onInviteRoom?: (roomId: string, peerId: string) => Promise<boolean>;
  onSayRoom?: (roomId: string, text: string) => void;
  onLeaveRoom?: (roomId: string) => void;
  getRoomMessages?: (roomId: string) => ChatMessage[];
  onSendMessage?: (text: string, channel?: string) => void;
  onSendPm?: (peerId: string, text: string, replyToId?: string, attachment?: { id: string; url: string; isVideo?: boolean }) => void;
  /**
   * Open the attachment modal, optionally pre-seeded from a paste: `files` for
   * a copied image, `url` for a pasted image link. Pre-seeding (rather than
   * uploading silently) keeps the crop step, preview and validation in one
   * place instead of duplicating them for pasted media.
   */
  onOpenAttachment?: (
    target: 'pm' | 'group',
    peerId?: string,
    groupId?: string,
    replyToId?: string,
    files?: File[],
    url?: string,
  ) => void;
  onSelectPeer: (peer: PeerInfo | null) => void;
  onBackToThreads?: () => void;
  onReportMessage?: (messageId: string) => void;
  onReportUser?: (userId: string) => void;
  onDeleteMessage?: (messageId: string, peerId: string) => void;
  onDeleteThread?: (peerId: string) => Promise<void>;
  onCreateGroup?: (name: string, memberIds: string[]) => Promise<string | null>;
  onSendGroupMessage?: (groupId: string, text: string, replyToId?: string, attachment?: { id: string; url: string; isVideo?: boolean }) => void;
  onLeaveGroup?: (groupId: string) => void;
  onLoadGroupMessages?: (groupId: string) => void;
  onLoadGroupMembers?: (groupId: string) => Promise<GroupMember[]>;
  onAddGroupMembers?: (groupId: string, ids: string[]) => Promise<boolean> | void;
  onSelectGroup?: (groupId: string | null) => void;
  onOpenProfile?: (userId: string, user?: User) => void;
  /** Wave 3: route the thread right-click to the shared user context menu. */
  onUserContext?: (e: React.MouseEvent, userId: string, displayName: string) => void;
  onOpenImage?: (message: ChatMessage) => void;
  onLoadHistory?: (peerId: string, beforeTimestamp: string) => Promise<boolean>;
  users?: User[];
}) {
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<{ id: string; url: string; isVideo: boolean } | null>(null);
  const messageStreamRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [inputText]);
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [actionFor, setActionFor] = useState<string | null>(null);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showNewRoom, setShowNewRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [roomInvitePeer, setRoomInvitePeer] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState<Set<string>>(new Set());
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);
  const [deleteThreadPeerId, setDeleteThreadPeerId] = useState<string | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // The chat main page defaults to the public lobby when nothing is selected.
  const openTarget: OpenTarget = listMode
    ? null
    : activeRoomId
    ? 'room'
    : activeGroupId
    ? 'group'
    : activePmPeer
    ? (activePmPeer.orbitId === 'global_lobby' ? 'lobby' : activePmPeer.orbitId === 'card_queue' ? 'queue' : 'peer')
    : 'lobby';

  const isLobbyGroup = openTarget === 'lobby';
  const isQueueGroup = openTarget === 'queue';
  const activeRoom = showRooms ? (rooms.find((r) => r.id === activeRoomId) || null) : null;
  const roomUnread = (r: RoomInfo): boolean => {
    const last = (getRoomMessages?.(r.id) || []).slice(-1)[0];
    return !!last && last.senderId !== identity?.orbitId && last.timestamp > (r.seenAt || 0);
  };
  const roomMessages = useMemo<ChatMessage[]>(
    () => (showRooms && activeRoomId && getRoomMessages ? getRoomMessages(activeRoomId) : []),
    // getRoomMessages reads local courier state; recompute when it changes.
    [showRooms, activeRoomId, getRoomMessages, rooms]
  );

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
    // Room messages ride the sealed group envelope: attachments/replies are a
    // server-inbox feature; plain text only (the send button says so).
    if (openTarget === 'room' && pendingAttachment) return;

    playPress(920);
    if (openTarget === 'room' && activeRoomId) {
      onSayRoom?.(activeRoomId, text);
    } else if (openTarget === 'group' && activeGroupId) {
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

  /** Where an attachment can be sent right now, or null if attachments are off. */
  const attachmentTarget = (): { target: 'pm' | 'group'; peerId?: string; groupId?: string } | null => {
    if (openTarget === 'group' && activeGroupId) return { target: 'group', groupId: activeGroupId };
    if (openTarget === 'peer' && activePmPeer) return { target: 'pm', peerId: activePmPeer.orbitId };
    return null;
  };

  /**
   * Inline notice for a rejected paste and for the copy-image result. The hub
   * has no toast surface of its own, and silently dropping a paste is exactly
   * the bug this replaces — the player needs to be told why nothing happened.
   */
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);
  const showPasteNotice = useCallback((msg: string) => {
    setPasteNotice(msg);
    window.setTimeout(() => setPasteNotice((cur) => (cur === msg ? null : cur)), 2600);
  }, []);

  /**
   * Paste into the composer.
   *
   * The composer's <form>/<textarea> sit OUTSIDE the DropZone, so paste events
   * here never reached its handler: pasting an image into a conversation did
   * nothing at all, and pasting a link was silently dropped because the chat
   * DropZone had no onPasteUrl. This handles it on the textarea itself, using
   * the shared readClipboard so both surfaces agree on what an image paste is.
   *
   * A pasted file is handed to the SAME attachment modal the paperclip opens
   * (pre-seeded), rather than uploaded behind the player's back — so the crop
   * step, the preview and the validation all still apply.
   */
  const handleComposerPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const payload = readClipboard(e);
    if (payload.kind === 'text') return; // plain text: let the textarea paste it

    e.preventDefault();

    const where = attachmentTarget();
    if (!where) {
      // Sealed rooms are text-only (handleSend blocks attachments there too),
      // and the lobby/queue are broadcast text channels. Say so rather than
      // accepting the paste and dropping it.
      showPasteNotice(
        openTarget === 'room'
          ? 'Sealed rooms are text only.'
          : 'Attachments need a direct message or a group.',
      );
      return;
    }

    if (payload.kind === 'files') {
      const image = payload.files.find((f) => f.type.startsWith('image/')) ?? payload.files[0];
      onOpenAttachment?.(where.target, where.peerId, where.groupId, replyingTo?.id, [image]);
      return;
    }

    if (payload.kind !== 'url') return; // 'empty' — nothing to attach

    // A pasted image URL goes through the same modal, which is the only place
    // that can resolve and validate a remote link.
    onOpenAttachment?.(where.target, where.peerId, where.groupId, replyingTo?.id, undefined, payload.url);
  };

  /**
   * Copy an attachment's IMAGE to the clipboard, so it can be pasted straight
   * into another conversation. The only other copy-image affordance in the app
   * is on the fullscreen context overlay, so re-sending a picture meant
   * saving it and uploading it again.
   */
  const [copyingImage, setCopyingImage] = useState<string | null>(null);
  const copyAttachmentImage = async (msg: ChatMessage) => {
    const url = msg.attachmentUrl;
    if (!url) return;
    setCopyingImage(msg.id);
    // Imported lazily: the clipboard bridge pulls in media resolution the chat
    // hub does not otherwise need.
    const { copyImageToClipboard } = await import('../../utils/media');
    const ok = await copyImageToClipboard(url).catch(() => false);
    setCopyingImage(null);
    setActionFor(null);
    showPasteNotice(ok ? 'Image copied to clipboard.' : 'Could not copy that image.');
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
        await res.json();
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

  // Peers the caller knows, overlaid with the durable name directory. The
  // `peers` prop is the capped /api/users page; the directory remembers every
  // name we have ever been told, so a DM or room partner who has fallen out of
  // that page keeps their name instead of falling back to "User".
  const peerMap = new Map<string, PeerInfo>();
  for (const [id, entry] of nameRosterFromDirectory()) {
    peerMap.set(id, { orbitId: id, name: entry.display_name || '' });
  }
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
      peer_name: activePmPeer.name || nameFor(activePmPeer.orbitId) || UNKNOWN_NAME,
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

  const displayNameFor = (id: string, fallback?: string | null) =>
    chatDisplayName({ id, payloadName: fallback, roster: peerMap, selfId: identity?.orbitId, selfName: myDisplayName });

  const rawDisplayedMessages: ChatMessage[] =
    openTarget === 'room'
      ? roomMessages
      : openTarget === 'group'
      ? (groupMessages[activeGroupId || ''] || [])
      : isLobbyGroup
      ? lobbyMessages
      : isQueueGroup
      ? queueMessages
      : pmMessages;
  const displayedMessages: ChatMessage[] = rawDisplayedMessages;

  // Learn names from the traffic. Every surface the hub renders funnels
  // through this one array, so a single effect here picks up a name from a
  // sealed DM, a room, a group, or the lobby and makes it durable. Doing it
  // per-call-site would be eight copies of the same three lines and four of
  // them would eventually be forgotten.
  //
  // An effect, not render-body work: remembering is a side effect, and running
  // it during render would fire on every paint.
  useEffect(() => {
    for (const msg of displayedMessages) {
      if (msg.senderId && msg.senderName) rememberName(msg.senderId, msg.senderName);
    }
  }, [displayedMessages]);

  // Day separators and author blocks in one pass. These used to be two
  // independent concerns computed separately, which meant the "start of a
  // conversation" the block grouping implied and the day a message fell on
  // could disagree.
  const messageRows = useMemo(() => groupMessagesByDay(displayedMessages), [displayedMessages]);


  const findMessage = (id?: string): ChatMessage | undefined =>
    id ? displayedMessages.find((m) => m.id === id) : undefined;

  const copyMessage = (text: string) => {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    setActionFor(null);
  };
  useEffect(() => {
    const stream = messageStreamRef.current;
    if (stream) stream.scrollTop = stream.scrollHeight;
  }, [activePmPeer?.orbitId, activeGroupId, activeRoomId, displayedMessages.length]);

  useEffect(() => {
    if (!activeGroupId || !onLoadGroupMessages) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') onLoadGroupMessages(activeGroupId);
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [activeGroupId, onLoadGroupMessages]);

  const lastLobbyMsg = lobbyMessages[lobbyMessages.length - 1]?.text || 'Active public discussion...';
  const lastQueueMsg = queueMessages[queueMessages.length - 1]?.text || 'Matchmaking chat & challenges';

  const openRoom = (roomId: string) => {
    playPress(800);
    setListMode(false);
    setSidebarOpen(false);
    setShowMembers(false);
    setReplyingTo(null);
    onSelectGroup?.(null);
    onSelectPeer(null);
    onSelectRoom?.(roomId);
  };

  const openGroup = (g: GroupInfo) => {
    playPress(800);
    setListMode(false);
    setSidebarOpen(false);
    setShowMembers(false);
    onSelectRoom?.(null);
    onSelectGroup?.(g.id);
    setReplyingTo(null);
    onLoadGroupMessages?.(g.id);
  };

  const submitNewRoom = () => {
    const name = newRoomName.trim();
    if (!name || !onCreateRoom) return;
    const room = onCreateRoom(name);
    if (room) {
      setShowNewRoom(false);
      setNewRoomName('');
      openRoom(room.id);
    }
  };

  const inviteRoomPeer = async () => {
    if (!activeRoom || !onInviteRoom) return;
    const q = roomInvitePeer.trim().toLowerCase();
    const target = peers.find((p) => p.orbitId === q || (p.name || '').toLowerCase() === q);
    if (!target) return;
    const ok = await onInviteRoom(activeRoom.id, target.orbitId);
    if (ok) setRoomInvitePeer('');
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
      setSidebarOpen(false);
      onLoadGroupMessages?.(id);
    }
  };

  const headerTitle =
    openTarget === 'room'
      ? (activeRoom?.name || 'Room')
      : openTarget === 'group'
      ? (groups.find((g) => g.id === activeGroupId)?.name || 'Group')
      : isLobbyGroup
      ? 'Lobby Lounge'
      : isQueueGroup
      ? 'Card Queue'
      : activePmPeer
      ? displayNameFor(activePmPeer.orbitId, activePmPeer.name)
      : 'User';
  const headerSubtitle =
    openTarget === 'room'
      ? `E2EE room · ${activeRoom?.members.length ?? 0} members · epoch ${activeRoom?.epoch ?? 1}`
      : openTarget === 'group'
      ? 'Group chat'
      : isLobbyGroup
      ? 'Public lobby'
      : isQueueGroup
      ? 'Queue chat'
      : 'Direct message';

  const activeGroup = openTarget === 'group' ? groups.find((g) => g.id === activeGroupId) : undefined;
  const canShowMembers = openTarget === 'group' && !!activeGroupId && !!onLoadGroupMembers;

  return (
    <div className="flex-1 min-h-0 h-full w-full overflow-hidden flex flex-row font-sans text-retro-fg animate-orbit-fade-in bg-transparent">
      {/* 1. Left Column: Channels, Rooms & DMs */}
      <div className="w-60 lg:w-64 border-r border-border-glass flex flex-col bg-glass-w5 shrink-0 min-h-0 select-none">
        <div className="p-3 sm:p-4 border-b border-border-glass flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="font-semibold text-sm text-retro-fg truncate">
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
          </div>
        </div>

        {showNewGroup && (
          <div className="p-3 border-b border-border-glass space-y-2 shrink-0">
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
              <button type="button" onClick={() => { setShowNewGroup(false); setNewGroupMembers(new Set()); }} className="px-3 py-1.5 bg-glass-w8 border border-border-glass rounded-md text-xs cursor-pointer hover:bg-glass-w12">Cancel</button>
            </div>
          </div>
        )}

        <div className="p-2.5 border-b border-border-glass shrink-0">
          <div className="flex items-center gap-2 bg-surface-raised border border-border-glass rounded-md px-3 py-1.5 text-xs text-retro-body">
            <Search className="w-3.5 h-3.5 text-retro-muted shrink-0" />
            <input
              type="text"
              aria-label="Search conversations"
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
            onClick={() => { playPress(800); setListMode(false); setSidebarOpen(false); onSelectGroup?.(null); onSelectRoom?.(null); onSelectPeer({ orbitId: 'global_lobby', name: 'Lobby Lounge (Everyone)' }); }}
            className={`w-full p-3 flex items-center gap-3 hover:bg-glass-w5 transition-colors border-b border-border-glass text-left cursor-pointer ${openTarget === 'lobby' ? 'bg-glass-w8 border-border-glass' : ''}`}
          >
            <div className="relative w-10 h-10 rounded-full bg-surface-raised border border-border-glass text-retro-muted shrink-0 overflow-hidden flex items-center justify-center">
              <Globe className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-medium text-retro-body truncate flex items-center gap-1"><Globe className="w-3 h-3 text-retro-muted" /> Lobby Lounge</span>
                <span className="text-[10px] text-retro-muted shrink-0 tabular-nums">{lobbyMessages.length}</span>
              </div>
              <p className="text-xs truncate mt-0.5 text-retro-muted">{lastLobbyMsg}</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => { playPress(800); setListMode(false); setSidebarOpen(false); onSelectGroup?.(null); onSelectRoom?.(null); onSelectPeer({ orbitId: 'card_queue', name: 'Card Game Queue' }); }}
            className={`w-full p-3 flex items-center gap-3 hover:bg-glass-w5 transition-colors border-b border-border-glass text-left cursor-pointer ${openTarget === 'queue' ? 'bg-glass-w8 border-border-glass' : ''}`}
          >
            <div className="relative w-10 h-10 rounded-full bg-surface-raised border border-border-glass text-retro-muted shrink-0 overflow-hidden flex items-center justify-center">
              <Gamepad2 className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-medium text-retro-body truncate flex items-center gap-1"><Gamepad2 className="w-3 h-3 text-retro-muted" /> Card Queue</span>
                <span className="text-[10px] text-retro-muted shrink-0 tabular-nums">{queueMessages.length}</span>
              </div>
              <p className="text-xs truncate mt-0.5 text-retro-muted">{lastQueueMsg}</p>
            </div>
          </button>

          {groups.length > 0 && (
            <>
              <div className="px-3 py-1.5 border-b border-border-glass text-xs text-retro-muted flex items-center gap-1.5"><Users className="w-3 h-3" /> Groups</div>
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => openGroup(g)}
                  className={`w-full p-3 flex items-center gap-3 hover:bg-glass-w5 transition-colors border-b border-border-glass text-left cursor-pointer ${activeGroupId === g.id && openTarget === 'group' ? 'bg-glass-w8 border-border-glass' : ''}`}
                >
                  <div className="w-10 h-10 rounded-full bg-surface-raised border border-border-glass text-retro-muted shrink-0 overflow-hidden flex items-center justify-center"><Users className="w-4 h-4" /></div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-retro-body truncate block">{g.name}</span>
                    <p className="text-xs truncate mt-0.5 text-retro-muted">{g.member_count} members</p>
                  </div>
                </button>
              ))}
            </>
          )}

          {showRooms && (
            <>
              <div className="px-3 py-1.5 border-b border-border-glass text-xs text-retro-muted flex items-center justify-between gap-1.5">
                <span className="flex items-center gap-1.5"><Lock className="w-3 h-3" /> Rooms</span>
                <button
                  type="button"
                  onClick={() => { playPress(780); setShowNewRoom((v) => !v); }}
                  title="New room"
                  aria-label="New room"
                  className="p-0.5 rounded text-retro-muted hover:text-retro-fg cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              {showNewRoom && (
                <div className="p-2.5 border-b border-border-glass flex gap-1.5 shrink-0">
                  <input
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitNewRoom(); }}
                    placeholder="room name"
                    aria-label="New room name"
                    className="flex-1 min-w-0 bg-surface-raised border border-border-glass rounded-md px-2 py-1.5 text-xs text-retro-fg placeholder:text-retro-muted outline-none focus:border-retro-accent/60"
                  />
                  <button type="button" onClick={submitNewRoom} className="px-2.5 py-1.5 bg-retro-accent text-black rounded-md text-xs font-bold cursor-pointer hover:bg-retro-accent-hover">Create</button>
                </div>
              )}
              {rooms.map((r) => {
                const last = (getRoomMessages?.(r.id) || []).slice(-1)[0];
                const isRoomSelected = openTarget === 'room' && activeRoomId === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => openRoom(r.id)}
                    className={`w-full p-3 flex items-center gap-3 hover:bg-glass-w5 transition-colors border-b border-border-glass text-left cursor-pointer ${isRoomSelected ? 'bg-glass-w8 border-border-glass' : ''}`}
                  >
                    <div className="w-10 h-10 rounded-full bg-surface-raised border border-border-glass text-retro-muted shrink-0 overflow-hidden flex items-center justify-center"><Lock className="w-4 h-4" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-medium text-retro-body truncate block">{r.name}</span>
                        <span className="text-[10px] text-retro-muted shrink-0 tabular-nums">{r.members.length}</span>
                      </div>
                      <p className="text-xs truncate mt-0.5 text-retro-muted">{last?.text || 'Sealed group chat'}</p>
                      {roomUnread(r) && <span className="w-1.5 h-1.5 rounded-full bg-retro-accent shrink-0" aria-label="Unread" />}
                    </div>
                  </button>
                );
              })}
            </>
          )}

          <div className="px-3 py-1.5 border-b border-border-glass text-xs text-retro-muted"><span>Direct Messages</span></div>

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
                      onClick={() => { playPress(800); setListMode(false); setSidebarOpen(false); onSelectGroup?.(null); onSelectRoom?.(null); onSelectPeer(p); setSearchQuery(''); }}
                      className="w-full p-2.5 rounded-md flex items-center gap-3 hover:bg-glass-w5 transition-colors text-left cursor-pointer"
                    >
                      <div className="w-9 h-9 rounded-full bg-surface-raised border border-border-glass text-retro-muted font-medium text-xs flex items-center justify-center overflow-hidden shrink-0">
                        {pfp ? <img src={resolveMediaUrl(pfp)} alt="" className="w-full h-full object-cover" /> : name.charAt(0).toUpperCase()}
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
                // Wave 3: same menu as right-clicking a name anywhere else
                // (DM / Follow / Block / profile) instead of the lone inline
                // "Delete Conversation" popover.
                if (onUserContext) {
                  onUserContext(e, peerId, name);
                  setDeleteThreadPeerId(null);
                  return;
                }
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
                    onClick={() => { playPress(800); setListMode(false); setSidebarOpen(false); onSelectGroup?.(null); onSelectRoom?.(null); onSelectPeer({ orbitId: peerId, name, pfp }); setDeleteThreadPeerId(null); }}
                    className={`w-full p-3 flex items-center gap-3 hover:bg-glass-w5 transition-colors border-b border-border-glass text-left cursor-pointer ${isSelected ? 'bg-glass-w8 border-border-glass' : ''}`}
                  >
                    <div className="relative w-10 h-10 rounded-full bg-surface-raised border border-border-glass text-retro-muted shrink-0 overflow-hidden flex items-center justify-center font-medium text-xs">
                      {pfp ? <img src={resolveMediaUrl(pfp)} alt="" className="w-full h-full object-cover" /> : name.charAt(0).toUpperCase()}
                      {isUnread && <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-retro-accent" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className={`text-xs truncate ${isUnread ? 'font-semibold text-retro-fg' : 'font-medium text-retro-body'}`}>{name}</span>
                        {isUnread ? (
                          <span className="w-2 h-2 rounded-full bg-retro-accent shrink-0" />
                        ) : (
                          <span className="text-[10px] text-retro-muted shrink-0 tabular-nums">
                            {thread.last_created_at ? new Date(thread.last_created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                          </span>
                        )}
                      </div>
                      <p className={`text-xs truncate mt-0.5 ${isUnread ? 'text-retro-body font-medium' : 'text-retro-muted'}`}>{thread.last_body || 'No messages yet'}</p>
                    </div>
                  </button>
                  {showThreadActions && (
                    <div className="absolute left-full top-0 ml-2 mt-1 z-10 bg-surface-raised border border-border-glass rounded-md shadow-lg py-1 min-w-[140px] animate-orbit-pop">
                      <button
                        type="button"
                        onClick={() => { handleDeleteThread(peerId); setDeleteThreadPeerId(null); }}
                        className="w-full px-3 py-2 text-left text-xs text-rose-400 hover:bg-glass-w5 cursor-pointer"
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

      {/* 2. Center Column: Active Conversation */}
      <div className="flex-1 min-h-0 flex flex-col bg-transparent min-w-0 overflow-hidden">
        {openTarget ? (
          <>
            <div className="p-3 sm:p-3.5 px-4 border-b border-border-glass bg-glass-w5 flex items-center justify-between shrink-0 select-none">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => { playPress(700); setListMode(true); onSelectGroup?.(null); onBackToThreads?.(); }}
                  className="md:hidden p-1 text-retro-muted hover:text-retro-fg cursor-pointer"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                <div className="w-8 h-8 rounded-full bg-surface-raised border border-border-glass shrink-0 overflow-hidden flex items-center justify-center text-xs font-medium text-retro-muted">
                  {openTarget === 'room' ? (
                    <Lock className="w-4 h-4" />
                  ) : openTarget === 'group' ? (
                    <Users className="w-4 h-4" />
                  ) : isLobbyGroup ? (
                    <Globe className="w-4 h-4" />
                  ) : isQueueGroup ? (
                    <Gamepad2 className="w-4 h-4" />
                  ) : activePmPeer && profilePics[activePmPeer.orbitId] ? (
                    <img src={resolveMediaUrl(profilePics[activePmPeer.orbitId])} alt="" className="w-full h-full object-cover" />
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
                {openTarget === 'room' && activeRoom && identity && activeRoom.ownerId !== identity.orbitId && onLeaveRoom && (
                  <button
                    type="button"
                    onClick={() => { playPress(520); onLeaveRoom(activeRoom.id); onSelectRoom?.(null); setListMode(true); }}
                    title="Leave room"
                    aria-label="Leave room"
                    className="p-1.5 rounded-md text-retro-muted hover:text-rose-400 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                )}
                {canShowMembers && (
                  <button
                    type="button"
                    onClick={() => { playPress(700); setShowMembers((v) => !v); }}
                    title="Group members"
                    aria-label="Group members"
                    aria-expanded={showMembers}
                    className={`p-1.5 rounded-md transition-colors cursor-pointer ${showMembers ? 'text-retro-accent bg-glass-w10' : 'text-retro-muted hover:text-retro-fg'}`}
                  >
                    <Users className="w-4 h-4" />
                  </button>
                )}
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
                <button
                  type="button"
                  onClick={() => {
                    playPress(700);
                    if (typeof window !== 'undefined' && window.innerWidth < 768) {
                      setListMode(true);
                      onSelectGroup?.(null);
                      onBackToThreads?.();
                    } else {
                      setSidebarOpen((v) => !v);
                    }
                  }}
                  title={sidebarOpen ? "Hide groups and players" : "Show groups and players"}
                  aria-label={sidebarOpen ? "Hide groups and players" : "Show groups and players"}
                  aria-expanded={sidebarOpen}
                  className={`p-1.5 rounded-md transition-colors cursor-pointer ${sidebarOpen ? 'text-retro-accent bg-glass-w10' : 'text-retro-muted hover:text-retro-fg'}`}
                >
                  <Users className="w-4 h-4" />
                </button>
              </div>
             </div>

             {canShowMembers && showMembers && (
               <div className="border-b border-border-glass max-h-72 overflow-y-auto styled-scrollbar bg-glass-w8 shrink-0">
                 <GroupMembersPopover
                   groupId={activeGroupId as string}
                   loadMembers={onLoadGroupMembers}
                   meId={identity?.orbitId}
                   isOwner={!!activeGroup && !!identity && activeGroup.owner_id === identity.orbitId}
                   peers={peers.filter((p) => p.orbitId !== 'global_lobby' && p.orbitId !== 'card_queue').map((p) => ({ orbitId: p.orbitId, name: p.name || nameFor(p.orbitId) || UNKNOWN_NAME }))}
                   onAddMembers={onAddGroupMembers}
                 />
               </div>
             )}

               <DropZone
                 onFiles={() => {
                   if (openTarget === 'group' && activeGroupId) onOpenAttachment?.('group', undefined, activeGroupId, replyingTo?.id);
                   else if (openTarget === 'peer' && activePmPeer) onOpenAttachment?.('pm', activePmPeer.orbitId, undefined, replyingTo?.id);
                 }}
                 disabled={openTarget === 'room' || (!activePmPeer && openTarget !== 'group')}
                 clickToBrowse={false}
                 bare
                 className="flex-1 min-h-0 flex flex-col"
               >
               <div ref={messageStreamRef} className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3 styled-scrollbar select-text bg-transparent">
                              {displayedMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2 text-retro-muted my-auto select-none">
                  <MessageSquare className="w-6 h-6" />
                  <p className="text-xs text-retro-body">{headerTitle}</p>
                  <p className="text-xs text-retro-muted">Send a message to start chatting</p>
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
                      className="px-3 py-1.5 rounded-md bg-glass-w8 border border-border-glass text-[10px] text-retro-muted hover:text-retro-fg hover:bg-glass-w12 transition-colors cursor-pointer disabled:opacity-40"
                    >
                      {loadingHistory ? 'Loading…' : 'Load earlier messages'}
                    </button>
                  </div>
                )}
                {messageRows.map((row, bi) => {
                  if (row.kind === 'day') {
                    return (
                      <div
                        key={row.key}
                        data-testid="chat-day-separator"
                        className="flex items-center gap-3 py-2 select-none"
                        role="separator"
                        aria-label={`Messages from ${row.label}`}
                      >
                        <span className="h-px flex-1 bg-border-glass" />
                        <span className="text-[10px] font-medium uppercase tracking-wider text-retro-muted">
                          {row.label}
                        </span>
                        <span className="h-px flex-1 bg-border-glass" />
                      </div>
                    );
                  }
                  const block = row.messages;
                  const first = block[0];
                  const isOwn = identity && first.senderId === identity.orbitId;
                  const senderName = isOwn ? (myDisplayName || 'You') : displayNameFor(first.senderId, first.senderName);
                  const pfp = profilePics[first.senderId];
                  return (
                    <div key={row.key} className={`flex items-end gap-2 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                      {!isOwn && (
                        <div
                          className="w-6 h-6 rounded-full bg-surface-raised border border-border-glass text-retro-muted overflow-hidden flex items-center justify-center text-[10px] font-medium shrink-0 mb-1 select-none cursor-pointer hover:ring-1 hover:ring-retro-accent/50 transition-shadow"
                          onClick={() => onOpenProfile?.(first.senderId)}
                          title={senderName}
                        >
                          {pfp ? <img src={resolveMediaUrl(pfp)} alt="" className="w-full h-full object-cover" /> : senderName.charAt(0).toUpperCase()}
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
                            <div key={msg.id} className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} max-w-full`}>
                              {replyTarget && (
                                <div className="text-[10px] text-retro-muted px-2.5 py-1 mb-0.5 bg-glass-w5 rounded-md border-l-2 border-retro-accent/50 truncate max-w-full w-fit">
                                  <CornerUpLeft className="w-3 h-3 inline mr-1" />
                                  {replyTarget.senderId === identity?.orbitId ? 'You' : displayNameFor(replyTarget.senderId)}: {replyTarget.text}
                                </div>
                              )}
                              <div
                                onClick={() => setActionFor(showActions ? null : msg.id)}
                                className={`w-fit max-w-full px-3 py-2 rounded-lg text-xs leading-relaxed select-text cursor-pointer break-words whitespace-pre-wrap ${block.length > 1 ? 'mt-0.5' : ''} ${
                                  isOwn ? 'bg-retro-accent/25 border border-retro-accent/30 text-retro-fg rounded-br-sm backdrop-blur-sm' : 'bg-glass-w10 border border-border-glass text-retro-body rounded-bl-sm backdrop-blur-sm'
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
                                      className="bg-glass-w10 border border-border-glass rounded px-2 py-1 text-xs text-retro-fg outline-none focus:border-retro-accent w-64"
                                      autoFocus
                                    />
                                    <button type="button" onClick={() => handleEditMessage(msg)} className="px-2 py-1 bg-retro-accent text-black text-[10px] rounded cursor-pointer">Save</button>
                                    <button type="button" onClick={() => setEditingMessage(null)} className="px-2 py-1 bg-glass-w8 border border-border-glass text-[10px] rounded cursor-pointer">Cancel</button>
                                  </div>
                                ) : (
                                  <Linkify text={msg.text} />
                                )}
                              </div>
                              {isLast && (
                                <div className={`mt-0.5 flex items-center gap-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                                  <time className="text-[10px] text-retro-muted select-none" dateTime={new Date(msg.timestamp).toISOString()}>
                                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </time>
                                  {isOwn && msg.readByRecipient && (
                                    <span title="Seen"><CheckCheck className="w-3 h-3 text-retro-accent" /></span>
                                  )}
                                  {msg.editedAt && (
                                    <span className="text-[10px] text-retro-muted">Edited</span>
                                  )}
                                </div>
                              )}
                              {showActions && (() => {
                                const ageMs = Date.now() - msg.timestamp;
                                // Room messages live in the sealed local store:
                                // edit/delete/report endpoints don't exist for
                                // them; only Copy applies.
                                if (openTarget === 'room') {
                                  return (
                                    <div className={`flex flex-wrap items-center gap-1 mt-1 ${isOwn ? 'justify-end' : ''}`}>
                                      <button type="button" onClick={() => copyMessage(msg.text)} className="px-2 py-1 rounded-md bg-glass-w8 border border-border-glass text-[10px] flex items-center gap-1 cursor-pointer hover:bg-glass-w12"><Copy className="w-3 h-3" /> Copy</button>
                                      {!msg.attachmentMime?.startsWith('video/') && msg.attachmentUrl && (
                                        <button type="button" onClick={() => void copyAttachmentImage(msg)} disabled={copyingImage === msg.id} className="px-2 py-1 rounded-md bg-glass-w8 border border-border-glass text-[10px] flex items-center gap-1 cursor-pointer hover:bg-glass-w12 disabled:opacity-50"><ImagePlus className="w-3 h-3" /> {copyingImage === msg.id ? 'Copying…' : 'Copy image'}</button>
                                      )}
                                    </div>
                                  );
                                }
                                const canEdit = isOwn && ageMs < 15 * 60 * 1000;
                                const canDeleteEveryone = isOwn && ageMs < 10 * 60 * 1000;
                                return (
                                <div className={`flex flex-wrap items-center gap-1 mt-1 ${isOwn ? 'justify-end' : ''}`}>
                                  <button type="button" onClick={() => { setReplyingTo(msg); setActionFor(null); }} className="px-2 py-1 rounded-md bg-glass-w8 border border-border-glass text-[10px] flex items-center gap-1 cursor-pointer hover:bg-glass-w12"><Reply className="w-3 h-3" /> Reply</button>
                                  <button type="button" onClick={() => copyMessage(msg.text)} className="px-2 py-1 rounded-md bg-glass-w8 border border-border-glass text-[10px] flex items-center gap-1 cursor-pointer hover:bg-glass-w12"><Copy className="w-3 h-3" /> Copy</button>
                                  {!msg.attachmentMime?.startsWith('video/') && msg.attachmentUrl && (
                                    <button type="button" onClick={() => void copyAttachmentImage(msg)} disabled={copyingImage === msg.id} className="px-2 py-1 rounded-md bg-glass-w8 border border-border-glass text-[10px] flex items-center gap-1 cursor-pointer hover:bg-glass-w12 disabled:opacity-50"><ImagePlus className="w-3 h-3" /> {copyingImage === msg.id ? 'Copying…' : 'Copy image'}</button>
                                  )}
                                  {canEdit && (
                                    <button
                                      type="button"
                                      onClick={() => { setEditingMessage({ id: msg.id, text: msg.text }); setActionFor(null); }}
                                      className="px-2 py-1 rounded-md bg-glass-w8 border border-border-glass text-[10px] flex items-center gap-1 cursor-pointer hover:bg-glass-w12"
                                    ><Edit2 className="w-3 h-3" /> Edit</button>
                                  )}
                                  {canDeleteEveryone && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteForEveryone(msg)}
                                      className="px-2 py-1 rounded-md bg-glass-w8 border border-border-glass text-[10px] flex items-center gap-1 cursor-pointer text-rose-400 hover:bg-glass-w12"
                                    ><Trash className="w-3 h-3" /> Delete for Everyone</button>
                                  )}
                                  {isOwn && (
                                    <button
                                      type="button"
                                      onClick={() => { onDeleteMessage?.(msg.id, activePmPeer?.orbitId || ''); setActionFor(null); }}
                                      className="px-2 py-1 rounded-md bg-glass-w8 border border-border-glass text-[10px] flex items-center gap-1 cursor-pointer text-rose-400 hover:bg-glass-w12"
                                    ><Trash2 className="w-3 h-3" /> Delete for Me</button>
                                  )}
                                  {!isOwn && onReportMessage && (
                                    <button type="button" onClick={() => { onReportMessage(msg.id); setActionFor(null); }} className="px-2 py-1 rounded-md bg-glass-w8 border border-border-glass text-[10px] flex items-center gap-1 cursor-pointer text-rose-400 hover:bg-glass-w12"><Flag className="w-3 h-3" /> Report</button>
                                  )}
                                  {!isOwn && onReportUser && (
                                    <button type="button" onClick={() => { onReportUser(msg.senderId); setActionFor(null); }} className="px-2 py-1 rounded-md bg-glass-w8 border border-border-glass text-[10px] cursor-pointer text-rose-400 hover:bg-glass-w12">Report user</button>
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
               </DropZone>

             {openTarget === 'room' && activeRoom && (
              <div className="px-3 pt-2 flex items-center gap-2 shrink-0 border-t border-border-glass">
                <input
                  value={roomInvitePeer}
                  onChange={(e) => setRoomInvitePeer(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void inviteRoomPeer(); } }}
                  placeholder="invite a contact by name…"
                  aria-label="Invite contact to room"
                  list="room-invite-peers"
                  className="flex-1 min-w-0 bg-glass-w10 border border-border-glass rounded-md px-3 py-1.5 text-xs text-retro-fg placeholder:text-retro-muted outline-none focus:border-retro-accent/50"
                />
                <datalist id="room-invite-peers">
                  {peers.filter((p) => !activeRoom.members.includes(p.orbitId)).map((p) => (
                    <option key={p.orbitId} value={p.name || p.orbitId} />
                  ))}
                </datalist>
                <button type="button" onClick={() => void inviteRoomPeer()} className="px-2.5 py-1.5 rounded-md glass-action text-xs font-medium cursor-pointer">Invite</button>
              </div>
            )}

            {replyingTo && (
              <div className="px-3 pt-2 flex items-center gap-2 text-xs text-retro-muted shrink-0 border-t border-border-glass">
                <CornerUpLeft className="w-3.5 h-3.5" />
                <span className="truncate">Replying to {replyingTo.senderId === identity?.orbitId ? 'you' : displayNameFor(replyingTo.senderId)}: {replyingTo.text}</span>
                <button type="button" onClick={() => setReplyingTo(null)} className="ml-auto text-retro-muted hover:text-retro-fg cursor-pointer"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}

            {pendingAttachment && (
              <div className="px-3 pt-2 flex items-center gap-2 text-xs text-retro-muted shrink-0 border-t border-border-glass">
                <ImagePlus className="w-3.5 h-3.5" />
                <span className="truncate">Attachment ready to send</span>
                <button type="button" onClick={() => setPendingAttachment(null)} className="ml-auto text-retro-muted hover:text-retro-fg cursor-pointer"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}

            {pasteNotice && (
              <div role="status" className="px-3 pt-2 text-xs text-retro-muted shrink-0 border-t border-border-glass">
                {pasteNotice}
              </div>
            )}

            <form onSubmit={handleSend} className="p-3 border-t border-border-glass bg-glass-w5 flex items-center gap-2 shrink-0">
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
                  title="Attach an image or video — or just paste one"
                  className="p-2 rounded-md bg-glass-w10 border border-border-glass text-retro-muted hover:text-retro-accent cursor-pointer transition-colors"
                >
                  <ImagePlus className="w-4 h-4" />
                </button>
              ) : null}
              <div className="flex-1 flex items-center gap-2 bg-glass-w10 border border-border-glass rounded-md px-3 py-2 text-xs focus-within:border-retro-accent/50 transition-colors">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onPaste={handleComposerPaste}
                  onKeyDown={(e) => {
                    // Enter sends explicitly — do not rely on implicit form
                    // submit: with focus left on the (type=button) attach
                    // control, Enter re-opened the image picker instead.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                    // Shift+Enter inserts a newline. The textarea is single-row
                    // by default, so without this there was no way to write a
                    // two-line message at all.
                    else if (e.key === 'Enter' && e.shiftKey) {
                      e.preventDefault()
                      const el = e.currentTarget
                      const start = el.selectionStart ?? inputText.length
                      const end = el.selectionEnd ?? inputText.length
                      setInputText(`${inputText.slice(0, start)}\n${inputText.slice(end)}`)
                      // Put the caret after the inserted newline, or the
                      // default would drop it back to the old offset.
                      requestAnimationFrame(() => {
                        el.selectionStart = el.selectionEnd = start + 1
                      })
                    }
                  }}
                  placeholder={openTarget === 'room' ? `Message ${activeRoom?.name || 'room'} (sealed)…` : openTarget === 'group' ? 'Message group...' : isLobbyGroup ? 'Message Lobby Lounge...' : isQueueGroup ? 'Message Card Queue...' : activePmPeer ? `Message ${displayNameFor(activePmPeer.orbitId, activePmPeer.name)}...` : 'Message...'}
                  aria-label="Write a message"
                  className="w-full bg-transparent focus:outline-none placeholder:text-retro-muted text-retro-fg border-none resize-none max-h-32 py-0.5 leading-normal text-xs styled-scrollbar"
                />
              </div>
              <button
                type="submit"
                aria-label="Send message"
                title="Send message"
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

      {/* 3. Right Column: Expanded Player List */}
      <div className="w-60 lg:w-64 border-l border-border-glass flex flex-col bg-glass-w5 shrink-0 min-h-0 select-none">
        <ChatPlayerList
          identity={identity}
          users={users}
          profilePics={profilePics}
          onOpenProfile={onOpenProfile}
        />
      </div>
    </div>
  );
}
