"use client";

import { MessageSquare, Bell } from "lucide-react";
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
    <div className="glass-card w-full h-full min-h-0 flex flex-col overflow-hidden rounded-xl">
      <div className="flex items-center border-b border-white/10 shrink-0 bg-glass-w5">
        <div className="flex flex-1 min-w-0">
          <button
            type="button"
            onClick={() => selectTab('chat')}
            className={`flex items-center gap-1.5 px-3 py-2 m-1 text-xs font-medium cursor-pointer rounded-md ${
              tab === 'chat' ? 'text-retro-fg bg-glass-w12' : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w5'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Messages
            {chatUnread > 0 && (
              <span className="px-1 py-0.5 rounded-full text-[10px] font-bold leading-none bg-retro-accent text-black tabular-nums">
                {chatUnread}
              </span>
            )}

          </button>
          <button
            type="button"
            onClick={() => selectTab('notifications')}
            className={`flex items-center gap-1.5 px-3 py-2 m-1 text-xs font-medium cursor-pointer rounded-md ${
              tab === 'notifications' ? 'text-retro-fg bg-glass-w12' : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w5'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            Notifications
            {notificationUnread > 0 && (
              <span className="px-1 py-0.5 rounded-full text-[10px] font-bold leading-none bg-retro-accent text-black tabular-nums">
                {notificationUnread}
              </span>
            )}

          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            playPress(700);
            onClose();
          }}
          className="mr-2 p-1.5 rounded-md text-lg leading-none text-retro-muted hover:text-retro-fg hover:bg-glass-w8 cursor-pointer"
          aria-label="Close panel"
          title="Close"
        >
          ⌄
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'chat' ? dm : notifications}
      </div>
    </div>
  );
}
