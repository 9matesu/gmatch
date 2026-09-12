"use client";

import { ChatCircleText } from "@phosphor-icons/react";
import { playPress } from "../../utils/sounds";

export interface SocialPanelProps {
  onClose: () => void;
  chatUnread?: number;
  dm: React.ReactNode;
}

/** Chat shell: title bar + close. Notifications left this panel — they open
 *  from the sidebar bell as their own modal (App.tsx notifOpen). */
export function SocialPanel({ onClose, chatUnread = 0, dm }: SocialPanelProps) {
  return (
    <div className="glass-card w-full h-full min-h-0 flex flex-col overflow-hidden rounded-xl">
      <div className="flex items-center justify-between border-b border-border-glass shrink-0 bg-glass-w5 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-retro-fg">
          <ChatCircleText className="w-3.5 h-3.5" />
          Messages
          {chatUnread > 0 && (
            <span className="px-1 py-0.5 rounded-full text-[10px] font-bold leading-none bg-retro-accent text-black tabular-nums">
              {chatUnread}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => {
            playPress(700);
            onClose();
          }}
          className="p-1.5 rounded-md text-lg leading-none text-retro-muted hover:text-retro-fg hover:bg-glass-w8 cursor-pointer"
          aria-label="Close panel"
          title="Close"
        >
          ⌄
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">{dm}</div>
    </div>
  );
}
