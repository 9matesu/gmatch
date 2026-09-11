"use client";

// Extracted verbatim from App.tsx `mainView === 'messages'` branches:
// the full DM panel (SocialPanel + GMatchDMs + NotificationsPanel) and the
// minimized placeholder. `handleSetMainView`/setters threaded as props.
import type { OrbitIdentity } from '@orbit/crypto';
import type { User } from '@orbit/shared';
import type { ChatMessage } from '../../hooks/useP2P';
import type { useLobby } from '../../hooks/useLobby';
import { SocialPanel, type SocialPanelTab } from '../chat/SocialPanel';
import { GMatchDMs, type ThreadItem, type GroupInfo } from '../chat/GMatchDMs';
import type { GroupMember } from '../chat/GroupMembersPopover';
import { NotificationsPanel } from '../NotificationsPanel';
import type { MainViewType } from '../home/HomeFooter';
type GamesSubTab = 'duel' | 'cards' | 'babecock' | 'ranks' | 'store';

export function MessagesView({
  panelTab,
  setPanelTab,
  identity,
  chatMessages,
  pmPeer,
  pmMessagesByPeer,
  users,
  pmThreads,
  profilePics,
  myProfile,
  chatGroups,
  groupMessagesByGroup,
  activeGroupId,
  setActiveGroupId,
  sendChatMessage,
  sendPm,
  sendGroupMessage,
  openAttachmentModal,
  loadPmMessages,
  loadPmThreads,
  loadPmHistory,
  reportPmMessage,
  reportPmUser,
  deletePmMessage,
  deleteThread,
  createGroup,
  leaveGroup,
  loadGroupMessages,
  loadGroupMembers,
  addGroupMembers,
  setPmPeer,
  setSelectedProfileUser,
  setViewerMessage,
  setDmMinimized,
  pmUnreadCount,
  lobby,
  handleRespondBabecock,
  setGamesSubTab,
  setMainView,
}: {
  panelTab: SocialPanelTab;
  setPanelTab: (tab: SocialPanelTab) => void;
  identity: OrbitIdentity | null;
  chatMessages: ChatMessage[];
  pmPeer: User | null;
  pmMessagesByPeer: Record<string, ChatMessage[]>;
  users: User[];
  pmThreads: ThreadItem[];
  profilePics: Record<string, string>;
  myProfile: { displayName: string };
  chatGroups: GroupInfo[];
  groupMessagesByGroup: Record<string, ChatMessage[]>;
  activeGroupId: string | null;
  setActiveGroupId: (id: string | null) => void;
  sendChatMessage: (text: string, channel?: string) => void;
  sendPm: (peerId: string, text: string, replyToId?: string, attachment?: { id: string; url: string; isVideo?: boolean }) => Promise<void>;
  sendGroupMessage: (groupId: string, text: string, replyToId?: string, attachment?: { id: string; url: string; isVideo?: boolean }) => Promise<void>;
  openAttachmentModal: (target: 'pm' | 'group', peerId?: string, groupId?: string, replyToId?: string) => void;
  loadPmMessages: (peerId: string) => Promise<void> | void;
  loadPmThreads: () => void;
  loadPmHistory: (peerId: string, beforeTimestamp: string) => Promise<boolean>;
  reportPmMessage: (messageId: string) => Promise<void> | void;
  reportPmUser: (userId: string) => Promise<void> | void;
  deletePmMessage: (messageId: string, peerId: string) => Promise<void> | void;
  deleteThread: (peerId: string) => Promise<void>;
  createGroup: (name: string, memberIds: string[]) => Promise<string | null>;
  leaveGroup: (groupId: string) => Promise<void> | void;
  loadGroupMessages: (groupId: string) => void;
  loadGroupMembers?: (groupId: string) => Promise<GroupMember[]>;
  addGroupMembers?: (groupId: string, ids: string[]) => Promise<boolean> | void;
  setPmPeer: React.Dispatch<React.SetStateAction<User | null>>;
  setSelectedProfileUser: (user: User) => void;
  setViewerMessage: (msg: ChatMessage | null) => void;
  setDmMinimized: (v: boolean) => void;
  pmUnreadCount: number;
  lobby: ReturnType<typeof useLobby>;
  handleRespondBabecock: (id: string, accept: boolean) => Promise<void> | void;
  setGamesSubTab: (tab: GamesSubTab) => void;
  setMainView: React.Dispatch<React.SetStateAction<MainViewType>>;
}) {
  return (
    <div className="p-2 sm:p-4 h-full flex-1 flex flex-col min-h-0">
      <SocialPanel
        tab={panelTab}
        onTabChange={setPanelTab}
        onClose={() => setDmMinimized(true)}
        chatUnread={pmUnreadCount}
        notificationUnread={lobby.unreadCount}
        dm={
          <GMatchDMs
            identity={identity}
            chatMessages={chatMessages}
            pmMessages={pmPeer ? pmMessagesByPeer[pmPeer.id || (pmPeer as any).orbitId || ''] || [] : []}
            activePmPeer={pmPeer ? { orbitId: pmPeer.id || (pmPeer as any).orbitId, name: pmPeer.display_name || (pmPeer as any).name || 'User' } : null}
            peers={users.map((u) => ({ orbitId: u.id || (u as any).orbitId, name: u.display_name || (u as any).name || 'User' }))}
            threads={pmThreads}
            profilePics={profilePics}
            myDisplayName={myProfile.displayName || 'You'}
            groups={chatGroups}
            groupMessages={groupMessagesByGroup}
            activeGroupId={activeGroupId}
            onSelectGroup={setActiveGroupId}
            onSendMessage={sendChatMessage}
            onSendPm={(peerId, text, replyToId, attachment) => {
              if (attachment) {
                void sendPm(peerId, text, replyToId, attachment);
              } else {
                openAttachmentModal('pm', peerId, undefined, replyToId);
              }
            }}
            onSelectPeer={(p) => {
              if (p) {
                const found = users.find((u) => u.id === p.orbitId || (u as any).orbitId === p.orbitId);
                setPmPeer(found || ({ id: p.orbitId, display_name: p.name } as any));
                // Always refetch on open so cached conversations are
                // brought up to date with any messages that arrived
                // while the thread was closed.
                if (p.orbitId !== 'global_lobby' && p.orbitId !== 'card_queue') {
                  loadPmMessages(p.orbitId);
                }
              } else {
                setPmPeer(null);
              }
            }}
            onReportMessage={reportPmMessage}
            onReportUser={reportPmUser}
            onDeleteMessage={(messageId, peerId) => {
              if (peerId) void deletePmMessage(messageId, peerId);
            }}
            onCreateGroup={createGroup}
            onOpenAttachment={openAttachmentModal}
            onSendGroupMessage={(groupId, text, replyToId, attachment) => {
              if (attachment) {
                void sendGroupMessage(groupId, text, replyToId, attachment);
              } else {
                openAttachmentModal('group', undefined, groupId, replyToId);
              }
            }}
            onLeaveGroup={leaveGroup}
            onLoadGroupMessages={loadGroupMessages}
            onLoadGroupMembers={loadGroupMembers}
            onAddGroupMembers={addGroupMembers}
            onOpenProfile={(userId) => {
              const t = users.find((u) => u.id === userId || (u as any).orbitId === userId);
              if (t) setSelectedProfileUser(t);
            }}
            onOpenImage={(msg) => setViewerMessage(msg)}
            onDeleteThread={deleteThread}
            onBackToThreads={() => { setPmPeer(null); loadPmThreads(); }}
            onLoadHistory={loadPmHistory}
          />
        }
        notifications={
          <NotificationsPanel
            notifications={lobby.notifications}
            unreadCount={lobby.unreadCount}
            invites={lobby.invites}
            onMarkAllRead={() => lobby.markNotificationsRead()}
            onRespondInvite={(id, accept) => lobby.respondToInvite(id, accept)}
            onRespondBabecock={handleRespondBabecock}
            onOpenBabecock={() => { setGamesSubTab('babecock'); setMainView('games'); }}
          />
        }
      />
    </div>
  );
}

export function DmMinimizedView({
  pmPeer,
  profilePics,
}: {
  pmPeer: User | null;
  profilePics: Record<string, string>;
}) {
  return (
    <div className="w-full flex items-center justify-center py-10">
      <div className="text-center space-y-3">
        <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-tr from-cyan-500 via-teal-500 to-amber-500 p-[3px]">
          <div className="w-full h-full rounded-full bg-[#09090b] overflow-hidden flex items-center justify-center text-sm font-bold text-retro-muted">
            {pmPeer ? (
              profilePics[pmPeer.id || (pmPeer as any).orbitId || ''] ? (
                <img src={profilePics[pmPeer.id || (pmPeer as any).orbitId || '']} alt="" className="w-full h-full object-cover" />
              ) : (
                (pmPeer.display_name || 'P').charAt(0).toUpperCase()
              )
            ) : (
              'D'
            )}
          </div>
        </div>
        <p className="text-xs font-bold text-retro-body">Direct Messages minimized</p>
        <p className="text-[11px] text-retro-muted">Open the chat bubble at the bottom to keep talking.</p>
      </div>
    </div>
  );
}
