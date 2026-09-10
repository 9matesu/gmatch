"use client";

import { MessageSquare, Bell, Minimize2 } from "lucide-react";
import { playPress } from "../../utils/sounds";

export type SocialPanelTab = 'chat' | 'notifications';

export interface SocialPanelProps {
  tab: SocialPanelTab;
  onTabChange: (tab: SocialPanelTab) => void;
  onClose: () => void;
  chatUnread?: number;
  notificationUnread?: number;
  dm: React.ReactNode;
  notifications: React.ReactNode;
}

export function SocialPanel({
  tab,
  onTabChange,
  onClose,
  chatUnread = 0,
  notificationUnread = 0,
  dm,
  notifications,
}: SocialPanelProps) {
  const selectTab = (next: SocialPanelTab) => {
    playPress(700);
    onTabChange(next);
  };

  return (
    <div className="glass-card w-full h-full min-h-0 flex flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center border-b border-white/10 shrink-0 bg-glass-w5">
        <div className="flex flex-1 min-w-0">
          <button
            type="button"
            onClick={() => selectTab('chat')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium cursor-pointer relative ${
              tab === 'chat' ? 'text-retro-fg bg-glass-w10 border-b border-white/40' : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w5'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Messages
            {chatUnread > 0 && (
              <span className="px-1 py-0.5 rounded-full text-[9px] font-bold leading-none bg-retro-accent text-black tabular-nums">
                {chatUnread}
              </span>
            )}
            {tab === 'chat' && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-retro-accent" />
            )}
          </button>
          <button
            type="button"
            onClick={() => selectTab('notifications')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium cursor-pointer relative ${
              tab === 'notifications' ? 'text-retro-fg bg-glass-w10 border-b border-white/40' : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w5'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            Notifications
            {notificationUnread > 0 && (
              <span className="px-1 py-0.5 rounded-full text-[9px] font-bold leading-none bg-retro-accent text-black tabular-nums">
                {notificationUnread}
              </span>
            )}
            {tab === 'notifications' && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-retro-accent" />
            )}
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            playPress(700);
            onClose();
          }}
          className="glass-action mr-2 p-1.5 rounded-lg text-retro-muted hover:text-retro-fg cursor-pointer"
          aria-label="Close panel"
          title="Close"
        >
          <Minimize2 className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'chat' ? dm : notifications}
      </div>
    </div>
  );
}
