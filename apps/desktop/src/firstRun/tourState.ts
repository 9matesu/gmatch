import type { MainViewType } from '../components/home/HomeFooter';
import type { GamesNavTab } from '../components/home/SidebarNav';

export const TOUR_KEY_PREFIX = 'orbit_tour_v1:';

export type TourStep = {
  id: string;
  title: string;
  text: string;
  /** View to teleport to when the user clicks "Show me". null = pointer step, no teleport. */
  view: MainViewType | null;
  gamesTab?: GamesNavTab;
};

export type TourState = {
  version: 1;
  index: number;
  status: 'active' | 'done' | 'skipped';
};

// Copy is final (plain English, humanized). Do not "improve" it.
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'feed', title: 'The feed', view: 'feed',
    text: 'Images come from the tags you set. Skip one you don\'t like and it never comes back.',
  },
  {
    id: 'grid', title: 'Grid', view: 'grid',
    text: 'Four feeds at once, each with its own tag. Handy when you follow a lot of things.',
  },
  {
    id: 'create', title: 'Posting', view: 'create',
    text: 'Drag an image onto the card, pick tags, publish. What you post can become a card too.',
  },
  {
    id: 'idle', title: 'Idle', view: 'games', gamesTab: 'idle',
    text: 'Click the picture, earn g$. It runs with the window minimized, just slower there.',
  },
  {
    id: 'duel', title: 'Card duels', view: 'games', gamesTab: 'duel',
    text: 'Cards are worth more or less by rarity. Winning pays, and the payout shows on the end screen.',
  },
  {
    id: 'store', title: 'Store', view: 'store',
    text: 'Your idle earnings buy cards here. Rare costs a lot, always.',
  },
  {
    id: 'messages', title: 'Messages', view: 'messages',
    text: 'Server chat and direct messages. Notifications sit in the tab next to it, grouped.',
  },
  {
    id: 'gallery', title: 'Gallery', view: 'gallery',
    text: 'What you saved lives here. It\'s cached, not a hot link, so it survives source changes.',
  },
  {
    id: 'servers', title: 'Servers', view: 'servers',
    text: 'You can join someone else\'s server without leaving the app. The switch relaunches the window.',
  },
  {
    id: 'settings', title: 'Settings and help', view: null,
    text: 'Blur, wallpaper, shortcuts. Press ? for the full help, and you can redo this tour from there.',
  },
];

export function tourStorageKey(identityId?: string | null) {
  return `${TOUR_KEY_PREFIX}${identityId || 'anonymous'}`;
}

export function initialTourState(): TourState {
  return { version: 1, index: 0, status: 'active' };
}

export function readTourState(identityId?: string | null): TourState {
  if (typeof window === 'undefined') return initialTourState();
  try {
    const raw = localStorage.getItem(tourStorageKey(identityId));
    if (!raw) return initialTourState();
    const parsed = JSON.parse(raw) as Partial<TourState>;
    if (parsed.version !== 1) return initialTourState();
    const status = parsed.status === 'done' || parsed.status === 'skipped' ? parsed.status : 'active';
    const index = Number.isInteger(parsed.index) && (parsed.index as number) >= 0
      ? Math.min(parsed.index as number, TOUR_STEPS.length - 1)
      : 0;
    return { version: 1, index, status };
  } catch {
    return initialTourState();
  }
}

export function writeTourState(identityId: string | null | undefined, state: TourState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(tourStorageKey(identityId), JSON.stringify(state));
  } catch {
    // In-memory state stays usable when storage is unavailable.
  }
}

export function nextTourStep(state: TourState): TourState {
  if (state.index >= TOUR_STEPS.length - 1) return { ...state, status: 'done' };
  return { ...state, index: state.index + 1 };
}

export function isTourOver(state: TourState): boolean {
  return state.status !== 'active';
}

export function wipeAllTourStates() {
  if (typeof window === 'undefined') return;
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(TOUR_KEY_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Nothing to do if storage is unreadable; state stays in memory.
  }
}
