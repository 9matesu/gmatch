
import { useIdentity } from "./hooks/useIdentity";
import { getSecureItem, setSecureItem } from './utils/secure-storage'
import { useSettings } from "./hooks/useSettings";
import { useIdle } from "./hooks/useIdle";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { getApiBaseUrl, orbitFetch, invalidateCache } from "./utils/api";
import { countChatUnread } from "./utils/chatUnread";
import { OrbitPeer, pollOffers } from "./utils/webrtc";
import { saveObject, getAllObjects, deleteObject } from "./utils/storage";
import type { SendPanelHandle } from "./components/SendPanel";
import { PageSkeleton } from "./components/Skeleton";
import { useToast } from "./components/Toast";
import { useConfirm } from "./components/ConfirmDialog";
import { usePlaytime, useCoffeeGate } from "./hooks/usePlaytime";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { SettingsOpenTarget } from './components/settings/GMatchSettingsModal';
import { userFacingError } from './utils/userError';
import { ImageViewer } from "./components/ImageViewer";
import { PasskeyManager } from "./components/PasskeyManager";
import { IdleOverlay } from "./components/IdleOverlay";
import { useP2P } from "./hooks/useP2P";
import { useLegacyBackfill } from "./hooks/useLegacyBackfill";
import type { ChatMessage } from "./hooks/useP2P";
import { useGame } from "./hooks/useGame";
import { enqueueableItems, isP2pLocal, shouldEnqueue } from "./utils/game";
import { mergeMyCards, filterToActiveDeck, galleryItemVisible, type CanonicalCard } from "./utils/cardCollection";
import { buildMirrorRow } from "./utils/galleryMirror";
import { collectConfigBundle, applyConfigBundle, applyStashFromBundle, parseConfigBundle, configDownloadFilename, bundleToString } from "./utils/configBackup";
import { runMigrations } from "./utils/migration";
import { useGame as useIdleGame } from "./game/store";
import { mapLimit } from "./services/booru";
import { vaultPin, vaultHttpUrl } from "./services/vault";
import { devFetchable } from "./services/imageCache";
import { hashForView, resolveInitialView, viewFromHash } from "./utils/routing";
import { DOM_ACTION_CONSENT } from "./utils/dominationMesh";
import { playChime, playPress, playMsgReceive } from "./utils/sounds";
import { useLobby } from "./hooks/useLobby";
import { UserProfileModal } from "./components/UserProfileModal";
import { SendCardModal } from "./components/cards/SendCardModal";
import { MIN_GAME_CARDS, generateFallbackName, type User, type OrbitObject } from "@orbit/shared";
import { applyCanonicalCard } from "./game/galleryMapping";
import { areItemsStructurallyEqual, areUsersStructurallyEqual, areAnnouncementsStructurallyEqual } from "./utils/compare";
import { OnboardingFlow } from "./firstRun/OnboardingFlow";
import { isOnboardingComplete, readOnboardingState } from "./firstRun/onboardingState";
import { TourDock } from "./components/tour/TourDock";
import { TourDeck } from "./components/tour/TourDeck";
import { DEFAULT_FEED_SORT, isFeedSort, type FeedSort } from "./components/feed/feedSort";
import { TOUR_STEPS } from "./firstRun/tourState";
import { useTourGuide } from "./components/tour/useTourGuide";
import { GMatchFeed, type FeedPost } from "./components/feed/GMatchFeed";
import { GMatchDMs } from "./components/chat/GMatchDMs";
import type { GroupMember } from "./components/chat/GroupMembersPopover";
import { AttachmentUploadModal } from "./components/AttachmentUploadModal";
import { ProfileView } from "./components/views/ProfileView";
import { DmMinimizedView } from "./components/views/MessagesView";
import { MessagesRail } from "./components/chat/MessagesRail";
import { WatchPartyView } from "./components/watchparty/WatchPartyView";
import { setWatchDisplayName, useWatchParty, restoreRememberedParties } from "./hooks/watchPartyStore";
import { GameView } from "./components/views/GameView";
import { AgeGateModal } from "./components/auth/AgeGateModal";
import { LegalCenter, isLegalAccepted } from "./components/LegalCenter";
import { legalDocFromHash, isLegalDocId, type LegalDocId } from "./utils/legal-route";
import { saveUserProfile, deriveProfileTags } from "./utils/profile";
import { GamesView } from "./components/views/GamesView";
import { getStoredActiveDeckId, type Deck } from "./components/games/DeckBuilder";
import { type MainViewType, type ActiveHackSession } from "./components/home/CommandIsland";
import { CommandIsland } from "./components/home/CommandIsland";
import { ThemeDrawer } from "./components/theme/ThemeDrawer";
import { NativeHeaderBar } from "./components/home/NativeHeaderBar";
import { RoomsPreview, buildPreviewRows } from "./components/chat/RoomsPreview";
import { ServersView } from "./components/servers/ServersView";
import { PCDominationView } from "./components/views/PCDominationView";
import { DominationEffects } from "./components/domination/DominationEffects";
import type { ActiveHackDebuff } from "@orbit/shared";
import { ChevronDown, ChevronRight, X, Bell } from "lucide-react";
import { ChatCircleText } from "@phosphor-icons/react";
import { WallpaperBackground } from "./components/WallpaperBackground";
import { ContextOverlay, ReportModal, type ContextMenuState } from "./components/ContextOverlay";
import { isMediaVideo, resolveMediaUrl } from "./utils/media";
import { prefetchObject, isRequestableObjectId } from "./hooks/useObjectImage";
import { GlobalModals } from "./components/GlobalModals";
import { ChangelogModal, CURRENT_CHANGELOG_VERSION } from "./components/ChangelogModal";
import { GalleryTabView } from "./components/views/GalleryTabView";
import { CreateCardModal } from "./components/CreateCardModal";
import { CardDetailView } from "./components/CardDetailView";
import GridWorkspace from "./components/grid/GridWorkspace";
import AdminApp from "./admin/AdminApp";
import { StoreView } from "./components/views/StoreView";
import { NotificationsPanel } from "./components/NotificationsPanel";
import { logger } from './utils/logger';
import { useNotifications } from './hooks/useNotifications';
import { isKnownSiteCourier, cachedMailMode, detectMailMode } from "./utils/mail-mode";
import { useCourierDms } from './hooks/useCourierDms';
import { useServerHeartbeat } from './hooks/useServerHeartbeat';
import { usePresencePoll } from './hooks/usePresencePoll';
import { usePendingJoinVerify } from './hooks/usePendingJoinVerify';
import { usePendingServerHost } from './hooks/usePendingServerHost';
import { OfflineWarningBanner } from "./components/OfflineWarningBanner";
import { dataUrlToBlob, localObjectBlobUrl } from "./utils/mediaData";
import { mediaUrlToCachedFile } from "./utils/cacheMedia";
import { fresherPresence } from './utils/presence';
import { resolveDisplayName, toNameRoster } from './utils/displayName';
import { nameRoster as nameRosterFromDirectory, nameFor, rememberName, rememberNames } from './game/nameDirectory';
import { UNKNOWN_NAME } from './utils/displayName';

const MAX_GALLERY_ITEMS_IN_MEMORY = 80;
// Story tray warm-up: how many leading stories to prefetch, and how many of
// those signed fetches may be in flight at once. Kept small on purpose — the
// tray is browsed by tapping the first ring, not by scrolling 200 items.
const STORY_PREFETCH_COUNT = 8;
const STORY_PREFETCH_CONCURRENCY = 3;
const MAX_PROFILE_PICS_IN_MEMORY = 120;

const isDesktopViewport = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(min-width: 768px)').matches

const desktopChatOnLoad = () => false;

export default function Home() {
  useEffect(() => {
    runMigrations();
  }, []);

  // Stale-API fix (all surfaces): drop a loopback API override pointing at a
  // DEAD sidecar — a stale `gmatch.api.url` would otherwise hammer dead
  // 127.0.0.1:8790 forever in the browser tab and Electron alike (the anon
  // tab, with no persisted key, was the only surface that still worked).
  // API_BASE is computed at import time, so clear + reload once when stale.
  // A healthy opt-in local sidecar (GMATCH_LOCAL_API=1) keeps its override.
  useEffect(() => {
    let dead = false;
    void (async () => {
      try {
        const { clearDeadLoopbackApiBase, getApiBaseUrl, purgeCourierApiState } = await import('./utils/api');
        if (dead) return;
        // Older builds auto-joined the central courier, which is a directory
        // node: it cannot serve lobby/feed/users at all. Purge that state and
        // reload once so API_BASE (computed at import) picks up the real node.
        if (purgeCourierApiState()) {
          if (!dead) window.location.reload();
          return;
        }
        if (await clearDeadLoopbackApiBase()) {
          if (!dead && /127\.0\.0\.1|localhost/.test(getApiBaseUrl())) window.location.reload();
        }
      } catch { /* browser dev: no bridge */ }
    })();
    return () => { dead = true; };
  }, []);

  const { identity, isLoaded, createIdentity, exportIdentity, loginWithExportedId, clearIdentity } = useIdentity();
  const [myProfile, setMyProfile] = useState(() => {
    if (typeof window === 'undefined') return { displayName: '', tags: [] as string[], isAdmin: false, pfpUrl: '' }
    try {
      const localName = localStorage.getItem('orbit_display_name') || ''
      const localTags = JSON.parse(localStorage.getItem('orbit_tags') || '[]')
      // Read through the secure mirror first (DPAPI mode), falling back to
      // plaintext localStorage for pre-migration installs / browser dev.
      const localPfp = getSecureItem('orbit_pfp_url') || localStorage.getItem('orbit_pfp_url') || ''
      return { displayName: localName, tags: Array.isArray(localTags) ? localTags : [], isAdmin: false, pfpUrl: localPfp }
    } catch {
      return { displayName: '', tags: [] as string[], isAdmin: false, pfpUrl: '' }
    }
  });
  // Idle game loop (merged from gmatch App): load save, tick economy, autosave.
  // Wall-clock dt so a throttled/hidden window accrues honestly in one catch-up
  // tick instead of silently losing seconds to Chromium timer clamping.
  useEffect(() => {
    useIdleGame.getState().load();
    let lastBeat = Date.now()
    const beat = () => {
      const now = Date.now()
      const dt = now - lastBeat
      lastBeat = now
      if (document.hidden && dt < 60_000) return
      useIdleGame.getState().tick(Math.min(dt, 8 * 3600_000))
    }
    const t = setInterval(beat, 1000);
    const onVis = () => {
      if (!document.hidden) {
        beat()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    const save = () => useIdleGame.getState().save();
    const ts = setInterval(save, 10_000);
    window.addEventListener('beforeunload', save);
    return () => {
      clearInterval(t);
      clearInterval(ts);
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('beforeunload', save);
    };
  }, []);
  const { peers, p2pItems, sendP2PItem, sendChatMessage, chatMessages, isWsConnected } = useP2P(identity);
  const { settings, update: updateSettings } = useSettings();
  useEffect(() => { setWatchDisplayName(myProfile.displayName || '') }, [myProfile.displayName]);
  // Watch-party rooms persist server-side (an emptied room is never deleted),
  // but the client's room list is a module singleton: without this a reload or
  // an app restart forgot every room, and a PRIVATE room you had left was
  // unreachable because the public listing omits private rooms. Re-join what
  // this device remembers, once per identity.
  useEffect(() => {
    if (!identity) return;
    void restoreRememberedParties(identity);
  }, [identity]);
  // Watch tab: only a live ROOM gets the fullscreen treatment (see theater).
  const watchRoomOpen = useWatchParty().parties.length > 0;
  const [users, setUsers] = useState<User[]>([]);

  // Name roster shared by every chat surface. /api/users is a CAPPED page, so
  // anyone outside it has no entry — which is exactly why each lane used to
  // render "Unknown User". Sealed DMs and rooms now carry the name in the
  // message, and this is the fallback for the lanes that do not (server PM,
  // groups, lobby) plus for threads written before the change.
  // The durable name directory, overlaid with the fresh /api/users page.
  // The page is authoritative but capped (100 rows, 24h-stale-filtered), so
  // anyone outside it used to have NO name and the UI invented one. Names we
  // have learned elsewhere — a sealed DM, a group roster, an earlier session —
  // fill those gaps instead, which is what makes a name "permanent".
  const nameRoster = useMemo(() => {
    const merged = nameRosterFromDirectory()
    for (const u of users) {
      if (u.id) merged.set(u.id, u)
    }
    return merged
  }, [users]);

  // Persist whatever the directory tells us, so a name learned once survives a
  // restart and a later query that does not happen to return that row.
  useEffect(() => {
    if (users.length > 0) rememberNames(users as never);
  }, [users]);

  // Panel opacity preference drives the glass chrome through a CSS variable.
  useEffect(() => {
    const alpha = Math.min(1, Math.max(0.35, settings.panelOpacity ?? 0.75));
    document.documentElement.style.setProperty('--panel-alpha', String(alpha));
  }, [settings.panelOpacity]);

  // Glass blur preference (Settings → Glass blur): 0 disables backdrop blur.
  useEffect(() => {
    const b = Math.min(1, Math.max(0, settings.glassBlur ?? 0.7));
    document.documentElement.style.setProperty('--glass-blur', String(b));
  }, [settings.glassBlur]);

  // Animated chrome toggle (paused by default — see globals.css perf gate).
  useEffect(() => {
    if (settings.animatedChrome) document.documentElement.setAttribute('data-motion', 'on');
    else document.documentElement.removeAttribute('data-motion');
  }, [settings.animatedChrome]);

  const game = useGame({ users, identity });
  const {
    relationships,
    spinTarget,
    decisionMap,
    enqueueDecision,
  } = game;

  const lobby = useLobby({ identity, settings });
  const notifications = useNotifications(lobby.state);

  // Wrapped lobby functions that request notification permission on user gesture
  const toggleAutoQueue = useCallback(async (enabled: boolean) => {
    if (enabled) {
      await notifications.requestNotificationPermission();
    }
    return lobby.toggleAutoQueue(enabled);
  }, [lobby, notifications]);

  const sendInvite = useCallback(async (userId: string) => {
    await notifications.requestNotificationPermission();
    return lobby.sendInvite(userId);
  }, [lobby, notifications]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<OrbitObject[]>([]);
  const [canonicalCards, setCanonicalCards] = useState<CanonicalCard[]>([]);
  const [sendCardTarget, setSendCardTarget] = useState<{ id: string; name: string } | null>(null);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [mainView, setMainView] = useState<MainViewType>(() => {
    if (typeof window === 'undefined') return 'servers'
    // Direct URL > last-visited persisted view > feed (see routing).
    return resolveInitialView(
      window.location.hash,
      localStorage.getItem('orbit_main_view'),
    )
  });
   const [showCreatePostModal, setShowCreatePostModal] = useState(false);
   const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [createPostInitialData, setCreatePostInitialData] = useState<{
    mediaList?: Array<{ id: string; previewUrl: string; isExternalUrl?: boolean; file?: File; kind?: 'video' | 'image'; mimeType?: string }>;
    tags?: string;
    caption?: string;
  } | null>(null);

  const openCreatePostWithMedia = useCallback((media: { url: string; tags?: string[]; name?: string; kind?: 'video' | 'image'; mimeType?: string }) => {
    setCreatePostInitialData({
      mediaList: [{
        id: 'repost_' + Math.random().toString(36).substring(2, 9),
        previewUrl: media.url,
        isExternalUrl: /^https?:\/\//i.test(media.url),
        kind: media.kind,
        mimeType: media.mimeType,
      }],
      tags: Array.isArray(media.tags) ? media.tags.slice(0, 5).join(' ') : '',
      caption: media.name ? `Repost: ${media.name}` : '',
    });
    setShowCreatePostModal(true);
  }, []);

  useEffect(() => {
    if (mainView === 'create') {
      setShowCreatePostModal(true);
      setMainView('feed');
    }
  }, [mainView]);
  const [dmMinimized, setDmMinimized] = useState(false);
  const [chatOpen, setChatOpen] = useState(() => desktopChatOnLoad());
  // Unified rooms chat: the active sealed room (dock preview + full page both
  // drive this), plus a per-room last-opened stamp for the unread cue.
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [roomSeen, setRoomSeen] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('gmatch_room_seen_v1') || '{}') } catch { return {} }
  })
  // Courier DM threads: per-peer last-opened stamp for the unread cue.
  // (Server /api/pm unread endpoints are dead by directive — sealed local
  // DMs can only be counted client-side, same as rooms above.)
  const [dmSeen, setDmSeen] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('gmatch_dm_seen_v1') || '{}') } catch { return {} }
  })
  const stampDmSeen = useCallback((peerId: string) => {
    setDmSeen((prev) => {
      const next = { ...prev, [peerId]: Date.now() };
      try { localStorage.setItem('gmatch_dm_seen_v1', JSON.stringify(next)) } catch { }
      return next;
    });
  }, [])
  // UI-3: resizable messages sidebar (width persisted; smooth only when not dragging)
  const [notifOpen, setNotifOpen] = useState(false);
  const [gamesSubTab, setGamesSubTab] = useState<'duel' | 'babecock' | 'ranks' | 'idle'>(() => {
    if (typeof window !== 'undefined' && viewFromHash(window.location.hash) === 'games') return 'duel'
    return 'idle'
  });
  const [collapsedModules, setCollapsedModules] = useState<Record<string, boolean>>({});
  const toggleModule = (key: string) => setCollapsedModules((prev) => ({ ...prev, [key]: !prev[key] }));
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [galleryFilter, setGalleryFilter] = useState<'all' | 'received' | 'sent' | 'starred'>(() => {
    if (typeof window === 'undefined') return 'all'
    const saved = localStorage.getItem('orbit_gallery_filter') as string | null
    const allowed: string[] = ['all', 'received', 'sent', 'starred']
    return saved && allowed.includes(saved) ? (saved as 'all' | 'received' | 'sent' | 'starred') : 'all'
  });

  const [activeHack, setActiveHack] = useState<ActiveHackSession | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem('orbit_active_hack');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.expiresAt > Date.now()) return parsed;
      return null;
    } catch {
      return null;
    }
  });

  const [cardSearch, setCardSearch] = useState('');
  const [cardTypeFilter, setCardTypeFilter] = useState<'all' | 'image' | 'video'>('all');

  useEffect(() => {
    if (!identity) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasSavedKey = localStorage.getItem('orbit_key_saved') === 'true';
      if (!hasSavedKey) {
        e.preventDefault();
        e.returnValue = 'Please remember to save or download your secret key before quitting so you do not lose account access!';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [identity]);

  useEffect(() => {
    try { localStorage.setItem('orbit_main_view', mainView) } catch { }
  }, [mainView]);

  useEffect(() => {
    try { localStorage.setItem('orbit_gallery_filter', galleryFilter) } catch { }
  }, [galleryFilter]);
  const [forwardedStashFile, setForwardedStashFile] = useState<File | null>(null)
  const [selectedGalleryIds, setSelectedGalleryIds] = useState<Set<string>>(new Set());
  const [attachmentModal, setAttachmentModal] = useState<{
    isOpen: boolean
    target: 'pm' | 'group'
    peerId?: string
    groupId?: string
    replyToId?: string
    /** Pre-seeded from a chat paste: a copied image, or a pasted image link. */
    initialFiles?: File[]
    initialUrl?: string
  } | null>(null)
  const [groupPickerOpen, setGroupPickerOpen] = useState(false)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [storyViewerUserId, setStoryViewerUserId] = useState<string | null>(null);
  const [spectateViewerItems, setSpectateViewerItems] = useState<OrbitObject[] | null>(null);
  const [viewerMessage, setViewerMessage] = useState<ChatMessage | null>(null);
  const [friendsIds, setFriendsIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = localStorage.getItem('goonmatch-friends')
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  })
  const [showMaxGoonerModal, setShowMaxGoonerModal] = useState(false)
  const [showTosModal, setShowTosModal] = useState(false)
  const [legalDoc, setLegalDoc] = useState<LegalDocId>(() => {
    const fromHash = legalDocFromHash(typeof window !== 'undefined' ? window.location.hash : '')
    return isLegalDocId(fromHash) ? fromHash : 'terms'
  })
  // Acceptance gate (legal plan C.2): logged-in + loaded + never accepted the
  // CURRENT version map => the LegalCenter is the only visible surface.
  const [legalAccepted, setLegalAccepted] = useState(() => isLegalAccepted())
  const syncedTagsRef = useRef<string[] | null>(null)
  const previousCountRef = useRef<number>(0)
  const mainScrollRef = useRef<HTMLDivElement>(null)
  const usersRef = useRef(users)
  const notifiedIdsRef = useRef(new Set<string>())
  const decisionMapRef = useRef(decisionMap)
  const usersRequestRef = useRef(0)
  /** loadUsers is declared ~1100 lines below the first caller (toggleFollowUser),
   *  so early callers reach it through this ref instead of re-creating the
   *  callback with loadUsers in its dependency list. */
  const loadUsersRef = useRef<(() => void) | null>(null)

  useEffect(() => { usersRef.current = users }, [users])
  useEffect(() => { decisionMapRef.current = decisionMap }, [decisionMap])

  const handleSetMainView = useCallback((view: MainViewType) => {
    const targetView = view === 'messages' ? 'rooms' : view;
    if (targetView === 'rooms') {
      setDmMinimized(false);
      setChatOpen(false);
    }
    if (targetView === 'feed' && mainView === 'feed') {
      mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (targetView === 'games') setGamesSubTab('duel');
    setMainView(targetView);
    // Keep the URL in sync (pushState so back/forward navigate views).
    const want = hashForView(targetView);
    if (window.location.hash !== want) window.history.pushState(null, '', want);
  }, [mainView]);

  // Guided tour: resumable per identity, skippable, teleports only on user click.
  // Deck + dock share this hook so cards jump to their section in sync.
  const tourIdentityId = identity?.orbitId ?? null;
  const {
    tourState,
    advance: advanceTour,
    goToStepId: goToTourStep,
    skip: skipTour,
  } = useTourGuide({
    identityId: tourIdentityId,
    navigateToView: handleSetMainView,
    // 'cards' is a stale GamesNavTab value no step uses; the real subtabs
    // are duel|babecock|ranks|idle.
    setGamesTab: (tab) => { if (tab !== 'cards') setGamesSubTab(tab); },
  });

  // Browser back/forward -> view. pushState entries surface via popstate;
  // manual hash edits via hashchange. Listen to both.
  useEffect(() => {
    const onNav = () => {
      let v = viewFromHash(window.location.hash);
      if (v === 'messages') v = 'rooms';
      if (v === 'rooms') {
        setChatOpen(false);
        setDmMinimized(false);
      }
      if (v && v !== mainView) {
        setMainView(v);
        if (v === 'games') setGamesSubTab('duel');
      }
    };
    window.addEventListener('hashchange', onNav);
    window.addEventListener('popstate', onNav);
    return () => {
      window.removeEventListener('hashchange', onNav);
      window.removeEventListener('popstate', onNav);
    };
  }, [mainView]);

  const handleRespondBabecock = useCallback(async (id: string, accept: boolean) => {
    if (!identity) return;
    if (!accept) {
      await orbitFetch(`/api/babecock/invites/${id}/decline`, { method: 'POST' }, identity);
      await lobby.refreshNotifications();
    }
  }, [identity, lobby]);

  // Notifications are their own modal, opened from any bell (sidebar/feed
  // header) — no longer a tab inside the messages dock.
  const openNotifications = useCallback(() => {
    setNotifOpen(true);
    lobby.markNotificationsRead();
  }, [lobby]);

  const [userDecks, setUserDecks] = useState<Deck[]>([]);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(() => getStoredActiveDeckId());
  const [gallerySubTab, setGallerySubTab] = useState<'cards' | 'deck'>('cards');

  // Listen to active deck changes across components
  useEffect(() => {
    const handleDeckChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setActiveDeckId(detail?.deckId ?? getStoredActiveDeckId());
    };
    window.addEventListener('orbit-active-deck-changed', handleDeckChange);
    return () => window.removeEventListener('orbit-active-deck-changed', handleDeckChange);
  }, []);

  // Fetch decks on identity load, deck change, or any deck mutation.
  const loadUserDecks = useCallback(async () => {
    if (!identity) return;
    try {
      const r = await orbitFetch('/api/decks', {}, identity);
      if (!r.ok) return;
      const data = await r.json();
      const list: Deck[] = data.decks || [];
      setUserDecks((prev) =>
        prev.length === list.length &&
        prev.every((d, i) => d.id === list[i].id && d.cards.length === list[i].cards.length && d.updatedAt === list[i].updatedAt)
          ? prev
          : list);
    } catch { /* offline */ }
  }, [identity]);

  useEffect(() => { void loadUserDecks(); }, [identity, activeDeckId, loadUserDecks]);

  // DeckBuilder mutations land in its own state; without this the queue gate
  // (`hasActiveDeck`) keeps reading a stale `userDecks` forever.
  useEffect(() => {
    const handler = () => { invalidateCache('/api/decks'); void loadUserDecks(); };
    window.addEventListener('orbit-decks-changed', handler);
    return () => window.removeEventListener('orbit-decks-changed', handler);
  }, [loadUserDecks]);

  const allOwnedCards = useMemo(
    () => (identity ? mergeMyCards(items, canonicalCards, identity.orbitId, myProfile?.pfpUrl) : []),
    [items, canonicalCards, identity, myProfile?.pfpUrl],
  )
  // Duel pick-grid scope: active deck members only (see filterToActiveDeck).
  // DeckBuilder gets `allOwnedCards` directly — it must see cards NOT in the deck.
  const myCards = useMemo(() => {
    if (!identity) return []
    return filterToActiveDeck(allOwnedCards, userDecks.find((d) => d.id === activeDeckId) ?? null)
  }, [allOwnedCards, identity, activeDeckId, userDecks])

  // Queue gate: the server requires a registered deck of exactly
  // MIN_GAME_CARDS eligible cards (DeckService.getQueueEligibleDeck).
  const hasActiveDeck = useMemo(
    () => userDecks.some(d => d.id === activeDeckId && d.cards.length === MIN_GAME_CARDS),
    [userDecks, activeDeckId],
  )

  const navigateToDeckBuilder = useCallback(() => {
    setGallerySubTab('deck');
    handleSetMainView('gallery');
    // mount-once handler: handleSetMainView identity is stable enough here
  }, [handleSetMainView]);

  const openCreateCardModal = () => {
    setCreateCardNeeded(Math.max(0, MIN_GAME_CARDS - myCards.length))
    setCardPrefill(null)
    setShowCreateCardModal(true)
  }

  const openCreateCardWithMedia = (media: { url: string; tags: string[]; name: string }) => {
    setCreateCardNeeded(0)
    setCardPrefill(media)
    setShowCreateCardModal(true)
  }

  // Resolve a gallery object to its canonical card id so card detail (and
  // cashout) opens for the user's own cards.
  const cardByMedia = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of canonicalCards) map.set(c.mediaObjectId, c.id)
    return map
  }, [canonicalCards])

  const [wallpaperBg, setWallpaperBg] = useState('')
  const [hideUiForWallpaper, setHideUiForWallpaper] = useState(false)
  const [spaceUiDimmed, setSpaceUiDimmed] = useState(false)
  const wallpaperBgRef = useRef('')
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsOpenTarget>('preferences')

  const handleSetWallpaper = (url: string, mime?: string) => {
    if (!url) return;
    setWallpaperBg(url);
    updateSettings('wallpaperUrl', url);
    updateSettings('wallpaperPreset', 'custom');
    const isVideo = mime?.startsWith('video/') || /\.(mp4|webm|ogv|mov)(\?|$)/i.test(url.split('?')[0]) || url.includes('/rg-media');
    updateSettings('wallpaperMime', isVideo ? 'video/mp4' : 'image/jpeg');
    toast('Desktop wallpaper background updated', 'success');
  }

  // OS-level wallpaper (Windows desktop, not just in-app). Resolves the URL
  // to bytes through the same ladder as the in-app background, then hands
  // them to the Electron wallpaper bridge. Images only; no-op in browser.
  const handleSetOsWallpaper = async (url: string) => {
    if (!url) return;
    // Check the bridge BEFORE resolving the image. Fetching first meant a
    // signed object spent up to the full media timeout on the proxy before
    // discovering there was nothing to hand the bytes to — so on a slow or
    // unreachable media host the user waited ~15s and then got a confusing
    // "needs an image file" instead of the real reason.
    const bridge = window.gmatch?.wallpaperSetData;
    if (!bridge) {
      // Distinguish "no desktop bridge" (browser build) from "no OS support".
      // A macOS/Linux desktop user used to be told this was only available in
      // the desktop app while sitting in the desktop app.
      toast('OS wallpaper needs the gMatch desktop app', 'warning');
      return;
    }
    try {
      let blob: Blob | null = null;
      if (/^https?:/i.test(url) || url.startsWith('gmcache://')) {
        blob = await mediaUrlToCachedFile(url).catch(() => null);
      } else {
        const r = url.startsWith('data:') || url.startsWith('blob:')
          ? await fetch(url)
          : await orbitFetch(url, {}, identity);
        if (r.ok) blob = await r.blob();
      }
      if (!blob || !blob.type.startsWith('image/')) {
        toast('OS wallpaper needs an image file', 'warning');
        return;
      }
      const out = await bridge(await blob.arrayBuffer(), blob.type);
      if (out?.ok) toast('OS wallpaper updated', 'success');
      else if (out?.reason === 'unsupported-platform') toast('OS wallpaper is Windows-only. Try "Set as app background" instead.', 'warning');
      else toast('Could not set OS wallpaper', 'error');
    } catch {
      toast('Could not set OS wallpaper', 'error');
    }
  }

  // Resolve a wallpaper source (remote API object / remote URL / blob / data)
  // into a renderable blob URL. `data:` URLs render directly.
  const resolveWallpaperUrl = useCallback((url: string): Promise<string> => {
    if (!url) return Promise.resolve('')
    if (url.startsWith('data:') || url.startsWith('blob:')) return Promise.resolve(url)
    const isVideo = /\.(mp4|webm|ogv|mov)(\?|$)/i.test(url.split('?')[0]) || url.includes('/rg-media')
    if (isVideo) {
      if (url.startsWith('vault://')) {
        return vaultHttpUrl(url).then(http => http || url)
      }
      const proxied = devFetchable(url)
      if (proxied) return Promise.resolve(proxied)
      return Promise.resolve(url)
    }
    if (/^https?:/i.test(url) || url.startsWith('gmcache://') || url.startsWith('vault://')) {
      // Remote booru bytes: no ACAO there, so orbitFetch's signed headers
      // would preflight-block it. cacheMedia's ladder (gmcache bridge →
      // dev proxy → direct fetch) is the byte path for exactly this.
      return mediaUrlToCachedFile(url)
        .then(f => URL.createObjectURL(f))
        .catch(() => url)
    }
    if (!identity) return Promise.resolve(url)
    return orbitFetch(url, {}, identity)
      .then(r => r.ok ? r.blob() : null)
      .then(b => {
        if (!b) return url
        return URL.createObjectURL(b)
      })
      .catch(() => url)
  }, [identity])

  useEffect(() => {
    if (!settings.wallpaperUrl) {
      if (wallpaperBgRef.current) { URL.revokeObjectURL(wallpaperBgRef.current); wallpaperBgRef.current = '' }
      setWallpaperBg('')
      return
    }
    const url = settings.wallpaperUrl
    let cancelled = false
    resolveWallpaperUrl(url).then(resolved => {
      if (cancelled) { if (resolved.startsWith('blob:')) URL.revokeObjectURL(resolved); return }
      if (wallpaperBgRef.current) URL.revokeObjectURL(wallpaperBgRef.current)
      wallpaperBgRef.current = resolved.startsWith('blob:') ? resolved : ''
      if (settings.wallpaperUrl === url) setWallpaperBg(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [settings.wallpaperUrl, identity, resolveWallpaperUrl])

  // Slideshow: cycle through the user's own gallery cards (images only) as the
  // desktop background when enabled. Falls back to a single wallpaperUrl when
  // there are no renderable cards.
  useEffect(() => {
    if (!settings.wallpaperSlideshow) return
    const sources = myCards
      .filter((c) => c.content_url && !(c.mime_type || '').startsWith('video/'))
      .map((c) => c.content_url as string)
    if (sources.length === 0) return

    let index = 0
    let cancelled = false
    const applySlide = (i: number) => {
      const url = sources[i % sources.length]
      resolveWallpaperUrl(url).then(resolved => {
        if (cancelled) { if (resolved.startsWith('blob:')) URL.revokeObjectURL(resolved); return }
        if (wallpaperBgRef.current) URL.revokeObjectURL(wallpaperBgRef.current)
        wallpaperBgRef.current = resolved.startsWith('blob:') ? resolved : ''
        if (!cancelled) {
          setWallpaperBg(resolved)
          updateSettings('wallpaperMime', 'image/jpeg')
        }
      })
    }
    applySlide(0)
    const timer = setInterval(() => {
      index += 1
      applySlide(index)
    }, Math.max(3000, settings.wallpaperSlideshowInterval))
    return () => {
      cancelled = true
      clearInterval(timer)
      if (wallpaperBgRef.current) { URL.revokeObjectURL(wallpaperBgRef.current); wallpaperBgRef.current = '' }
    }
  }, [settings.wallpaperSlideshow, settings.wallpaperSlideshowInterval, myCards, resolveWallpaperUrl, updateSettings])

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Opens the shared right-click menu (see ContextOverlay below).
  const openContextMenu = useCallback((type: 'user' | 'item', data: any) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, type, data });
  }, []);

  // Global custom right-click context menu (media, input, selection, link, general)
  useEffect(() => {
    const handleGlobalContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;

      e.preventDefault();
      const target = e.target as HTMLElement | null;
      const x = e.clientX;
      const y = e.clientY;

      // 1. Input / textarea / editable
      const inputEl = target?.closest('input, textarea, [contenteditable="true"]') as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;
      if (inputEl && (inputEl.tagName === 'INPUT' || inputEl.tagName === 'TEXTAREA' || (inputEl as HTMLElement).isContentEditable)) {
        const inp = inputEl as HTMLInputElement | HTMLTextAreaElement;
        const start = inp.selectionStart ?? 0;
        const end = inp.selectionEnd ?? 0;
        const hasSelection = end > start;
        setContextMenu({
          x,
          y,
          type: 'input',
          data: {
            element: inp,
            hasSelection,
            value: inp.value,
          },
        });
        return;
      }

      // 2. Highlighted text
      const selection = window.getSelection()?.toString()?.trim();
      if (selection && selection.length > 0) {
        setContextMenu({
          x,
          y,
          type: 'selection',
          data: { text: selection },
        });
        return;
      }

      // 3. Image or video element (content only — avatars/icons opt out
      // via data-no-wallpaper and never offer background actions)
      const mediaEl = target?.closest('img, video, [data-media-url], [data-media-src]') as HTMLElement | null;
      if (mediaEl) {
        const videoEl = mediaEl.tagName === 'VIDEO' ? (mediaEl as HTMLVideoElement) : mediaEl.querySelector('video');
        const imgEl = mediaEl.tagName === 'IMG' ? (mediaEl as HTMLImageElement) : mediaEl.querySelector('img');
        const isVideo = Boolean(videoEl) || (mediaEl.tagName === 'VIDEO') || isMediaVideo((mediaEl as any).src || (mediaEl as any).currentSrc || mediaEl.getAttribute('data-media-url'));
        const src = (videoEl as any)?.currentSrc || (videoEl as any)?.src || (imgEl as any)?.currentSrc || (imgEl as any)?.src || (mediaEl as any).currentSrc || (mediaEl as any).src || mediaEl.getAttribute('data-media-url') || mediaEl.getAttribute('data-media-src');
        // Prefer the original content URL (data-media-url) over the rendered
        // src: signed objects render as transient blob: URLs that die on
        // reload, so persisting them would store a dead wallpaper.
        const originalUrl = mediaEl.getAttribute('data-media-url') || mediaEl.getAttribute('data-media-src') || src;
        if (src) {
          setContextMenu({
            x,
            y,
            type: 'media',
            data: {
              src,
              originalUrl,
              isVideo,
              noWallpaper: mediaEl.closest('[data-no-wallpaper]') ? true : undefined,
              videoEl: videoEl || undefined,
            },
          });
          return;
        }
      }

      // 4. Link element
      const linkEl = target?.closest('a') as HTMLAnchorElement | null;
      if (linkEl && linkEl.href) {
        setContextMenu({
          x,
          y,
          type: 'link',
          data: {
            href: linkEl.href,
            text: linkEl.innerText || linkEl.title || linkEl.href,
          },
        });
        return;
      }

      // 5. Default / general
      setContextMenu({
        x,
        y,
        type: 'general',
        data: {},
      });
    };

    window.addEventListener('contextmenu', handleGlobalContextMenu);
    return () => {
      window.removeEventListener('contextmenu', handleGlobalContextMenu);
    };
  }, []);

  const [blockedIds, setBlockedIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = localStorage.getItem('goonmatch-blocked')
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  })

  const { toast } = useToast();
  const confirm = useConfirm();

  const toggleFriend = (id: string) => {
    setFriendsIds(prev => {
      const isAdded = !prev.includes(id)
      const next = isAdded ? [...prev, id] : prev.filter(f => f !== id)
      try { localStorage.setItem('goonmatch-friends', JSON.stringify(next)) } catch { }
      toast(isAdded ? 'Added to Contacts' : 'Removed from Contacts', 'info')
      return next
    })
  }

  const blockUser = (id: string) => {
    setBlockedIds(prev => {
      const next = prev.includes(id) ? prev : [...prev, id]
      try { localStorage.setItem('goonmatch-blocked', JSON.stringify(next)) } catch { }
      return next
    })
    toast('User blocked', 'info')
    if (identity) {
      orbitFetch(`/api/users/${id}/block`, { method: 'POST' }, identity).catch(() => { })
    }
  }

  const reportUser = (id: string, opts?: { reason?: string; category?: string; objectId?: string }) => {
    blockUser(id)
    toast('User reported and blocked', 'info')
    if (identity) {
      orbitFetch(`/api/users/${id}/report`, {
        method: 'POST',
        body: JSON.stringify({
          reason: opts?.reason || 'User reported via context menu',
          category: opts?.category,
          object_id: opts?.objectId,
        }),
      }, identity).catch(() => { })
    }
  }

  const openReportModal = (id: string, name: string, objectId?: string) => {
    setReportReason('')
    setReportCategory('inappropriate')
    setReportModal({ id, name, objectId })
  }

  const [reportModal, setReportModal] = useState<{ id: string; name: string; objectId?: string } | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportCategory, setReportCategory] = useState<'spam' | 'harassment' | 'inappropriate' | 'abuse'>('inappropriate');

  const submitReport = (id: string, opts?: { objectId?: string }) => {
    reportUser(id, {
      reason: reportReason.trim() || 'User reported',
      category: reportCategory,
      objectId: opts?.objectId,
    })
    setReportModal(null)
  }

  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showPointsHelpModal, setShowPointsHelpModal] = useState(false);
  const [showFlashModal, setShowFlashModal] = useState(false);
  const [showChangelogModal, setShowChangelogModal] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('gmatch_last_seen_changelog') !== CURRENT_CHANGELOG_VERSION;
    } catch {
      return false;
    }
  });

  const handleCloseChangelog = useCallback(() => {
    setShowChangelogModal(false);
    try {
      localStorage.setItem('gmatch_last_seen_changelog', CURRENT_CHANGELOG_VERSION);
    } catch {}
  }, []);

  useEffect(() => {
    const onOpen = () => setShowChangelogModal(true);
    window.addEventListener('gmatch-open-changelog', onOpen);
    return () => window.removeEventListener('gmatch-open-changelog', onOpen);
  }, []);
  const [,setAnnouncements] = useState<{ id: string; message: string; created_at: string; created_by_name: string | null }[]>([])
  const [showPasskeys,] = useState(false);
  const [identityModalMode, setIdentityModalMode] = useState<'export' | 'login' | 'logout' | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showThemeDrawer, setShowThemeDrawer] = useState(false);
  const [followersModalState, setFollowersModalState] = useState<{
    isOpen: boolean;
    initialTab: 'followers' | 'following';
    targetUserId?: string | null;
    targetName?: string | null;
  }>({ isOpen: false, initialTab: 'followers', targetUserId: null, targetName: null });

  // Active Server Hacking Debuffs
  const [activeHacks, setActiveHacks] = useState<ActiveHackDebuff[]>([]);

  // Poll Active Hack Debuffs every 8s
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;

    const pollHacks = async () => {
      try {
        const res = await orbitFetch('/api/users/hacks/active', {}, identity);
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (Array.isArray(data?.active_hacks)) {
            setActiveHacks(data.active_hacks);
          }
        }
      } catch { }
    };

    pollHacks();
    // DB read; the browser throttles hidden tabs, but be explicit (same law
    // as the App heartbeat/sync pollers): skip while nobody is looking.
    const interval = setInterval(() => { if (!document.hidden) pollHacks(); }, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [identity]);

  // Perf: nowTick only feeds the hack-expiry memos below; ticking the whole
  // 4k-line App every 5s while no hack exists is pure waste. Gate it.
  useEffect(() => {
    if (!activeHacks.length) return;
    const id = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(id);
  }, [activeHacks.length]);

  // Check if current player is vision jammed (Deny hack)
  const isVisionJammed = useMemo(() => {
    if (!identity) return false;
    return activeHacks.some(
      (h) => h.type === 'deny' && h.target_id === identity.orbitId && h.expires_at > nowTick
    );
  }, [activeHacks, identity, nowTick]);

  // Check if current player is targeted by Mobile Virus takeover
  const activeVirusHack = useMemo(() => {
    if (!identity) return null;
    return activeHacks.find(
      (h) => h.type === 'mobile_virus' && h.target_id === identity.orbitId && h.expires_at > nowTick
    ) || null;
  }, [activeHacks, identity, nowTick]);

  const handleFullConfigDownload = async (): Promise<boolean> => {
    const payload = exportIdentity();
    if (!payload) {
      toast("No identity loaded to back up", "error");
      return false;
    }
    try {
      const bundle = await collectConfigBundle(payload);
      const blob = new Blob([bundleToString(bundle)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = configDownloadFilename(bundle);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch (err) {
      logger.error("Failed to build config backup:", err);
      toast("Failed to build config backup", "error");
      return false;
    }
  };

  const handleFullConfigRestore = async (file: File): Promise<{ success: boolean; message: string }> => {
    try {
      const text = await file.text();
      const bundle = parseConfigBundle(text);
      if (!bundle) {
        return { success: false, message: "Not a valid .goon-config.json backup file" };
      }
      // Restore identity (keys + display name + tags).
      const idResult = loginWithExportedId(bundle.identity);
      if (!idResult.success) {
        return { success: false, message: idResult.error || "Failed to restore identity from backup" };
      }
      // Restore settings, cards/unlocks, friends.
      const { restored } = applyConfigBundle(bundle);
      // Restore stash into IndexedDB.
      const stashCount = await applyStashFromBundle(bundle.stash || []);
      return {
        success: true,
        message: `Config restored: ${restored.join(", ")}${stashCount > 0 ? ` + ${stashCount} stash item${stashCount === 1 ? "" : "s"}` : ""}`,
      };
    } catch (err) {
      logger.error("Failed to restore config backup:", err);
      return { success: false, message: "Failed to parse or restore config backup" };
    }
  };

  const [showRecommendations, setShowRecommendations] = useState(false);
  const lastSavedProfileRef = useRef<{ displayName: string; tags: string[] } | null>(null)
  const [lobbyLightboxUrl, setLobbyLightboxUrl] = useState<string | null>(null)
  const [selectedProfileUser, setSelectedProfileUser] = useState<User | null>(null)
  const [selectedProfilePosts, setSelectedProfilePosts] = useState<FeedPost[]>([])
  const [pmPeer, setPmPeer] = useState<User | null>(null)
  // Open the Instagram-style profile popup for a user id (resolved from the
  // online roster when possible, otherwise a minimal fallback object).
  const openProfileById = useCallback((id: string) => {
    const target = users.find((u) => u.id === id || (u as any).orbitId === id)
    if (target) setSelectedProfileUser(target)
  }, [users])

  // Notification deep link: prefer the post a group folds around, via the
  // feed's existing `#/feed?post=<id>` permalink (GMatchFeed opens the
  // lightbox from it), else the actor's profile. Rows were inert before, so a
  // "liked your post" bell gave you nowhere to go.
  const handleOpenNotificationTarget = useCallback((target: { postId?: string; userId?: string }) => {
    if (target.postId) {
      setNotifOpen(false);
      setMainView('feed');
      const want = `#/feed?post=${encodeURIComponent(target.postId)}`;
      if (window.location.hash === want) {
        // Same hash: force the lightbox to re-open.
        window.dispatchEvent(new CustomEvent('gmatch-open-post', { detail: { postId: target.postId } }));
      } else {
        window.history.pushState(null, '', want);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
      return;
    }
    if (target.userId) {
      openProfileById(target.userId);
      setNotifOpen(false);
    }
  }, [openProfileById])

  const [galleryPage, setGalleryPage] = useState(0);
  const [gallerySort, setGallerySort] = useState<'newest' | 'oldest' | 'likes' | 'score'>('newest');
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [transferProgress, setTransferProgress] = useState<string | null>(null);
  const [stories, setStories] = useState<OrbitObject[]>(() => {
    try {
      const saved = localStorage.getItem('orbit_cached_stories');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  })
  // Stale-first: the boot mirror above is real data, so a revalidating fetch
  // must NOT blank the tray. Loading starts true only when we have nothing to
  // show, which is what makes the tray pop in empty on every cold start.
  const [storiesLoading, setStoriesLoading] = useState(() => {
    try {
      return !localStorage.getItem('orbit_cached_stories')
    } catch {
      return true
    }
  })
  const storiesRequestRef = useRef(0)
  const [showStoryModal, setShowStoryModal] = useState(false)
  const [showCreateCardModal, setShowCreateCardModal] = useState(false)
  const [createCardNeeded, setCreateCardNeeded] = useState(0)
  const [cardPrefill, setCardPrefill] = useState<{ url: string; tags: string[]; name: string } | null>(null)
  const [forgeFile, setForgeFile] = useState<File | null>(null)
  const [dragAnchorId, setDragAnchorId] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  // Root card-detail host (plan §12): any view dispatches 'gmatch:open-card'
  // with a canonical card id and this single modal opens.
  const [globalCardId, setGlobalCardId] = useState<string | null>(null)
  useEffect(() => {
    const onOpenCard = (e: Event) => {
      const id = (e as CustomEvent<{ cardId?: string }>).detail?.cardId
      if (typeof id === 'string' && id) setGlobalCardId(id)
    }
    window.addEventListener('gmatch:open-card', onOpenCard)
    return () => window.removeEventListener('gmatch:open-card', onOpenCard)
  }, [])
  // Drag an image/video anywhere onto the app -> open the Card Forge with it.
  // Drops that already landed on a DropZone are defaultPrevented there; skip
  // those so the two handlers never both eat one drop.
  useEffect(() => {
    const allow = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      if (e.defaultPrevented) return
      const f = e.dataTransfer?.files?.[0]
      if (!f || !(/^image\//.test(f.type) || /^video\//.test(f.type))) return
      e.preventDefault()
      setForgeFile(f)
      setCardPrefill(null)
      setShowCreateCardModal(true)
      playPress(820)
    }
    window.addEventListener('dragover', allow)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', allow)
      window.removeEventListener('drop', onDrop)
    }
  }, [])
  const [profilePics, setProfilePics] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {}
    try { return JSON.parse(getSecureItem('goonmatch_pfps') || '{}') } catch { return {} }
  })
  const pfpInputRef = useRef<HTMLInputElement>(null)

  const [repostedPosts, setRepostedPosts] = useState<FeedPost[]>([])
  const [archivedPostIds, setArchivedPostIds] = useState<Set<string>>(() => new Set())
  const [deletedPostIds, setDeletedPostIds] = useState<Set<string>>(() => new Set())
  const [serverPosts, setServerPosts] = useState<FeedPost[]>([])
  const [hasMoreFeed, setHasMoreFeed] = useState(true)
  const [followingIds, setFollowingIds] = useState<string[]>([])
  const [pmMessagesByPeer, setPmMessagesByPeer] = useState<Record<string, ChatMessage[]>>({})

  // Server posts now carry `media: {id,url,mime_type}[]` for multi-image posts.
  // Map that into `mediaUrls` so the existing feed/lightbox carousel works.
  const normalizeFeedPost = useCallback((p: FeedPost): FeedPost => {
    const media = (p as any).media
    if (Array.isArray(media) && media.length > 1) {
      return { ...p, mediaUrls: media.map((m: any) => m.url).filter(Boolean) }
    }
    return p
  }, [])

  const feedPosts: FeedPost[] = useMemo(() => {
    // Real public posts from the server feed
    const serverVisible = serverPosts
      .filter(
        (p) => !deletedPostIds.has(p.id)
      )
      .map(normalizeFeedPost);

    // Public posts: both own uploaded public posts and peer public posts received via P2P
    const seenServerIds = new Set(serverVisible.map((p) => p.id));
    const localPublicPosts: FeedPost[] = items
      .filter((obj) => ((obj as any).is_public === 1 || (obj as any).is_public === true) && !deletedPostIds.has(obj.id) && !seenServerIds.has(obj.id))
      .map((obj) => {
        const isSelf = obj.owner_id === identity?.orbitId;
        const authorUser = !isSelf && obj.owner_id ? users.find((u) => u.id === obj.owner_id || (u as any).orbitId === obj.owner_id) : null;
        const authorName = isSelf
          ? (myProfile.displayName || 'You')
          : (authorUser?.display_name || (obj as any).author_name || (obj as any).sender_name || 'Player');
        const authorAvatar = isSelf
          ? (profilePics[identity?.orbitId || ''] || null)
          : (authorUser?.pfp_url || (obj.owner_id ? profilePics[obj.owner_id] : null) || null);
        const localUrl = obj.content_url || (obj as any).data || (obj as any).url || `/api/objects/${obj.id}`;
        return ({
          id: obj.id,
          author_id: obj.owner_id || identity?.orbitId || 'peer',
          author_name: authorName,
          author_avatar: authorAvatar,
          url: localUrl,
          mime_type: obj.mime_type || (isMediaVideo(localUrl) ? 'video/mp4' : 'image/jpeg'),
          caption: obj.caption || (obj as any).post_caption || '',
          location: (obj as any).location || '',
          tags: Array.isArray((obj as any).tags) ? (obj as any).tags : [],
          created_at: obj.created_at || new Date().toISOString(),
          like_count: (obj as any).likes_count || (obj as any).like_count || 0,
          comment_count: (obj as any).comment_count || 0,
          is_liked: false,
          is_saved: false,
          is_archived: archivedPostIds.has(obj.id),
        });
      });

    return [...serverVisible, ...repostedPosts, ...localPublicPosts];
  }, [items, profilePics, identity, myProfile, repostedPosts, archivedPostIds, deletedPostIds, serverPosts, normalizeFeedPost, users]);

  // ─── Public posts feed (server) ───
  const [isLoadingMoreFeed, setIsLoadingMoreFeed] = useState(false)
  const [feedSort, setFeedSort] = useState<FeedSort>(() => {
    try { const s = localStorage.getItem('orbit_feed_sort'); return isFeedSort(s) ? s : DEFAULT_FEED_SORT } catch { return DEFAULT_FEED_SORT }
  })
  useEffect(() => {
    try { localStorage.setItem('orbit_feed_sort', feedSort) } catch { }
  }, [feedSort])

  useEffect(() => {
    if (!selectedProfileUser) {
      setSelectedProfilePosts([])
      return
    }

    let cancelled = false
    const fallbackPosts = feedPosts.filter((post) => post.author_id === selectedProfileUser.id)
    setSelectedProfilePosts(fallbackPosts)

    if (!identity) return () => { cancelled = true }

    orbitFetch(`/api/posts?author_id=${encodeURIComponent(selectedProfileUser.id)}&limit=200&sort=latest`, {}, identity)
      .then(async (res) => {
        if (!res.ok || cancelled) return
        const data = await res.json().catch(() => null)
        if (!cancelled && Array.isArray(data?.posts)) {
          setSelectedProfilePosts(data.posts as FeedPost[])
        }
      })
      .catch(() => { })

    return () => { cancelled = true }
  }, [selectedProfileUser, identity, feedPosts])

  const loadServerFeed = useCallback(() => {
    if (!identity) return Promise.resolve()
    setHasMoreFeed(true)
    return orbitFetch(`/api/posts?limit=50&sort=${feedSort}`, {}, identity)
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        if (Array.isArray(data?.posts)) {
          setServerPosts(data.posts as FeedPost[])
          setHasMoreFeed(data.posts.length >= 50)
          setProfilePics((prev) => {
            let changed = false
            const next = { ...prev }
            for (const p of data.posts as FeedPost[]) {
              if (p.author_id && p.author_avatar && next[p.author_id] !== p.author_avatar) {
                next[p.author_id] = p.author_avatar
                changed = true
              }
            }
            return changed ? next : prev
          })
        }
      })
      .catch(() => { })
  }, [identity, feedSort])

  // Retrieve-by-force: drop cached/inflight feed responses, then reload. A
  // plain reload inside the 3s GET cache (or a stuck inflight request) would
  // otherwise keep serving the stale snapshot that hides fresh posts.
  const forceRefreshFeed = useCallback(() => {
    invalidateCache('/api/posts')
    return loadServerFeed()
  }, [loadServerFeed])

  // Which node this feed reads — surfaced in the empty state so a pin to the
  // wrong (e.g. fresh/empty local) node is visible instead of mysterious.
  const apiNodeLabel = useMemo(() => {
    try {
      const base = getApiBaseUrl()
      if (!base) return 'central relay'
      return new URL(base, 'http://localhost').hostname || base
    } catch {
      return 'this node'
    }
  }, [])

  const loadMoreFeedPosts = useCallback(async () => {
    if (isLoadingMoreFeed) return
    setIsLoadingMoreFeed(true)
    try {
      // 1. Fetch next batch from server posts endpoint
      const nextOffset = serverPosts.length
      if (identity) {
        const res = await orbitFetch(`/api/posts?offset=${nextOffset}&limit=20&sort=${feedSort}`, {}, identity).catch(() => null)
        if (res && res.ok) {
          const data = await res.json().catch(() => null)
          if (Array.isArray(data?.posts) && data.posts.length > 0) {
            setServerPosts((prev) => {
              const seen = new Set(prev.map((p) => p.id))
              const added = (data.posts as FeedPost[]).filter((p) => !seen.has(p.id))
              return [...prev, ...added]
            })
            setIsLoadingMoreFeed(false)
            if (data.posts.length < 20) setHasMoreFeed(false)
            return
          }
          setHasMoreFeed(false)
        }
      }

    } catch {
      // silently ignore
    } finally {
      setIsLoadingMoreFeed(false)
    }
  }, [identity, serverPosts.length, isLoadingMoreFeed, feedSort])

  // ─── Instagram-style follows ───
  const loadFollowing = useCallback(() => {
    if (!identity) return Promise.resolve()
    return orbitFetch(`/api/users/${identity.orbitId}/following`, {}, identity)
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        if (Array.isArray(data)) setFollowingIds(data.map((u: any) => u.id).filter(Boolean))
      })
      .catch(() => { })
  }, [identity])

  const toggleFollowUser = useCallback(async (userId: string) => {
    if (!identity || userId === identity.orbitId) return
    const wasFollowing = followingIds.includes(userId)
    setFollowingIds(prev => wasFollowing ? prev.filter(id => id !== userId) : [...prev, userId])
    try {
      const res = await orbitFetch(`/api/users/${userId}/follow`, { method: wasFollowing ? 'DELETE' : 'POST' }, identity)
      if (!res.ok) {
        setFollowingIds(prev => wasFollowing ? [...prev, userId] : prev.filter(id => id !== userId))
      } else {
        // Invalidate BEFORE refetching. A bare loadUsers() (what this used to
        // dispatch) was served by orbitFetch's 3s response cache, so the
        // roster came back with the PRE-follow counts and the profile tab
        // number never moved.
        invalidateCache('/api/users')
        invalidateCache(`/api/users/${userId}/followers`)
        invalidateCache(`/api/users/${userId}/following`)
        invalidateCache(`/api/users/${identity.orbitId}/following`)
        void loadUsersRef.current?.()
        window.dispatchEvent(new CustomEvent('orbit-profilesync'))
      }
    } catch {
      setFollowingIds(prev => wasFollowing ? [...prev, userId] : prev.filter(id => id !== userId))
    }
  }, [identity, followingIds])

  const openUserNetwork = useCallback((userId: string, tab: 'followers' | 'following' = 'followers') => {
    // No `(u as any).orbitId` check here: OrbitId is a string alias and nothing
    // ever sets a separate `.orbitId` property, so it could only ever match the
    // wrong row.
    const target = users.find((u) => u.id === userId)
    setFollowersModalState({
      isOpen: true,
      initialTab: tab,
      targetUserId: userId,
      targetName: target?.display_name || null,
    })
  }, [users])

  // ─── Post engagement persistence (like/save/comment/report/delete) ───
  // Throws on transport failure or non-OK status so callers can roll back
  // optimistic state; returns undefined only when there is no identity or the
  // response carries no count (keep the optimistic value, don't roll back).
  const persistLike = useCallback(async (postId: string, liked: boolean): Promise<number | undefined> => {
    if (!identity) return undefined
    const res = await orbitFetch(`/api/posts/${postId}/like`, { method: liked ? 'POST' : 'DELETE' }, identity)
    if (!res.ok) throw new Error(`like failed: ${res.status}`)
    const data = await res.json()
    return typeof data?.like_count === 'number' ? data.like_count : undefined
  }, [identity])

  const persistSave = useCallback((postId: string, saved: boolean) => {
    if (!identity) return
    orbitFetch(`/api/posts/${postId}/save`, { method: saved ? 'POST' : 'DELETE' }, identity).catch(() => { })
  }, [identity])

  const persistComment = useCallback(async (postId: string, text: string) => {
    if (!identity) return null
    try {
      const res = await orbitFetch(`/api/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      }, identity)
      // Returns null on failure, which the caller surfaces as "not saved" and
      // rolls its optimistic row back — previously the row survived forever.
      if (!res.ok) return null
      const data = await res.json()
      // The feed's comment_count is stale the moment a comment lands, and the
      // 3s response cache would serve the pre-comment list to any refetch.
      invalidateCache(`/api/posts/${postId}/comments`)
      invalidateCache('/api/posts')
      return {
        id: data?.id || `c_${Date.now()}`,
        author_id: identity.orbitId,
        author_name: myProfile.displayName || 'You',
        author_avatar: profilePics[identity.orbitId] || null,
        text,
        // The server's own timestamp, not the literal "Just now" that used to sit
        // next to rows formatted as "2026-09-28 12:34:56".
        created_at: typeof data?.created_at === 'string' ? data.created_at : new Date().toISOString(),
        like_count: 0,
        is_liked: false,
      }
    } catch {
      return null
    }
  }, [identity, myProfile.displayName, profilePics])

  const persistReport = useCallback((postId: string, reason: string) => {
    if (!identity) return
    orbitFetch(`/api/posts/${postId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'inappropriate', reason }),
    }, identity).catch(() => { })
  }, [identity])

  // Unified report for any content type. Reporting hides the item instantly.
  const reportTarget = useCallback((targetType: string, targetId: string, reason?: string) => {
    if (!identity) return
    toast('Reported. Content hidden until an admin reviews it.', 'info')
    orbitFetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_type: targetType, target_id: targetId, category: 'inappropriate', reason: reason || '' }),
    }, identity).catch(() => { })
  }, [identity, toast])

  const deletePostOnServer = useCallback(async (postId: string) => {
    if (!identity) return
    try {
      await orbitFetch(`/api/posts/${postId}`, { method: 'DELETE' }, identity)
      setServerPosts(prev => prev.filter(p => p.id !== postId))
    } catch { }
  }, [identity])

  // ─── Publish media (camera snapshots / in-feed creator) as a public post ───
  const publishPost = useCallback(async (mediaDataUrls: string[], caption: string, tags: string[]): Promise<boolean> => {
    if (!identity || mediaDataUrls.length === 0) return false
    try {
      let uploadedAny = false
      // One shared group key turns every uploaded image into a single
      // multi-image post (the server groups them in the feed).
      const postGroup = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `pg_${Date.now()}_${Math.random().toString(36).slice(2)}`
      const mediaUrls: string[] = []
      const mediaMimes: string[] = []
      let localPreviewUrl: string | null = null
      for (const dataUrl of mediaDataUrls) {
        const blob = dataUrlToBlob(dataUrl)
        const mime = blob.type || 'image/jpeg'
        const ext = (() => {
          if (mime.includes('video/mp4')) return 'mp4'
          if (mime.includes('video/webm')) return 'webm'
          if (mime.includes('video/ogg')) return 'ogv'
          if (mime.includes('video/quicktime')) return 'mov'
          if (mime.includes('image/png')) return 'png'
          if (mime.includes('image/gif')) return 'gif'
          if (mime.includes('image/webp')) return 'webp'
          return 'jpg'
        })()
        const file = new File([blob], `post_${Date.now()}.${ext}`, { type: mime })
        const { forgeMediaLocally } = await import('./services/mediaForge')
        const forged = await forgeMediaLocally(file, identity, {
          caption: caption.trim() || undefined,
          postCaption: caption.trim() || undefined,
          tags: tags.join(','),
          isPublic: true,
          postGroup,
          authorName: myProfile.displayName || undefined,
        })
        if (forged?.id) {
          uploadedAny = true
          mediaUrls.push(`/api/objects/${forged.id}`)
          mediaMimes.push(mime)
          // Instant tile: the blob URL renders with zero fetch while the
          // server row + swarm catch up. Session-local only.
          if (!localPreviewUrl && forged.localUrl) localPreviewUrl = forged.localUrl
        }
      }
      if (uploadedAny) {
        const primaryUrl = mediaUrls[0]
        const newPost: FeedPost = {
          id: `group_${postGroup}`,
          author_id: identity.orbitId,
          author_name: myProfile.displayName || 'You',
          author_avatar: profilePics[identity.orbitId] || null,
          url: primaryUrl,
          mime_type: mediaMimes[0] || 'image/jpeg',
          mediaUrls: mediaUrls.length > 1 ? mediaUrls : undefined,
          localPreviewUrl,
          caption: caption.trim() || undefined,
          tags: tags.map((t) => t.replace(/^#/, '').toLowerCase()).filter(Boolean),
          created_at: new Date().toISOString(),
          like_count: 0,
          comment_count: 0,
        }
        // Prepend immediately so the new post appears on Latest with its
        // entrance animation, then reconcile with the authoritative feed.
        setServerPosts((prev) => {
          const seen = new Set(prev.map((p) => p.id))
          const fresh = newPost.id && !seen.has(newPost.id) ? [newPost] : []
          return [...fresh, ...prev]
        })
        // Bust the feed cache so reconciliation fetches the committed row
        // instead of re-serving the pre-publish snapshot over our prepend.
        invalidateCache('/api/posts')
        loadServerFeed()
        window.dispatchEvent(new CustomEvent('orbit-score-refresh'))
      }
      return uploadedAny
    } catch {
      return false
    }
  }, [identity, loadServerFeed, myProfile.displayName, profilePics])

  // ─── Server-side private messages (1:1 DMs) ───
  const [pmThreads, setPmThreads] = useState<{
    peer_id: string;
    peer_name?: string | null;
    last_id?: string;
    last_body?: string;
    last_sender_id?: string;
    last_created_at?: string;
  }[]>([])
  const [pmUnreadCount, setPmUnreadCount] = useState(0)

  // Arena badge: live players in queue + in match (presence — tracks live,
  // never "clears"). Rides the existing lobby poll, no new fetching.
  const gamesOnlineCount = useMemo(() => {
    const waiting = lobby.state?.waiting_count ?? 0;
    const inMatch = (lobby.liveMatches?.length ?? 0) * 2;
    return waiting + inMatch;
  }, [lobby.state?.waiting_count, lobby.liveMatches]);

  // Watch badge: people watching in public rooms (same list the room browser
  // polls; 60s is plenty for a "N watching" pill count).
  const [watchWatchingCount, setWatchWatchingCount] = useState(0);
  useEffect(() => {
    if (!identity || !settings.watchPartyEnabled) { setWatchWatchingCount(0); return }
    let dead = false
    const load = () => orbitFetch('/api/watchparty', {}, identity)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: any) => {
        if (!dead && Array.isArray(b?.parties))
          setWatchWatchingCount(b.parties.reduce((s: number, p: any) => s + (Number(p.members) || 0), 0))
      })
      .catch(() => {})
    load()
    const t = setInterval(load, 60_000)
    return () => { dead = true; clearInterval(t) }
  }, [identity, settings.watchPartyEnabled])

  // Feed badge: posts created after the last feed visit (sync poll already
  // refreshes serverPosts off-tab). Baseline starts at the newest post of
  // this session's first visit — a reload must not flag the whole backlog.
  const [feedBaseline, setFeedBaseline] = useState<number | null>(null)
  useEffect(() => {
    if (mainView !== 'feed' && feedBaseline !== null) return
    const newest = serverPosts.reduce((m, p) => {
      const t = Date.parse(String((p as any).created_at || ''))
      return Number.isFinite(t) && t > m ? t : m
    }, feedBaseline ?? 0)
    if (newest !== (feedBaseline ?? 0)) setFeedBaseline(newest)
  }, [mainView, serverPosts, feedBaseline])
  const feedNewPostsCount = useMemo(() => {
    if (mainView === 'feed' || feedBaseline === null) return 0
    return serverPosts.filter((p) => {
      const t = Date.parse(String((p as any).created_at || ''))
      return Number.isFinite(t) && t > feedBaseline
    }).length
  }, [mainView, serverPosts, feedBaseline])

  // Blind-courier DM path (plan P3.3): inert on full nodes (legacy inbox),
  // active only when the API 404s /api/pm (official SITE).
  useServerHeartbeat(identity ?? null);
  // Presence, fed once here for the whole app. Mounted at the root rather than
  // inside a surface so the feed exists even when no list is on screen — a
  // profile opened from the arena used to have nothing to read and silently
  // fell back to whatever record the opener had. The hook is reference
  // counted, so a surface may also mount it without adding a second poll.
  usePresencePoll(identity ?? null);
  usePendingJoinVerify(identity, toast);
  usePendingServerHost(identity ?? null, toast);
  // Global update toasts: the portable self-update runs whether or not the
  // Settings modal is open — nudge the user toward Install & Restart.
  useEffect(() => {
    const off = window.gmatch?.onUpdateStatus?.((s) => {
      if (s.phase === 'available' && s.version) toast(`gMatch ${s.version} is downloading. Finish it in Settings → Updates.`, 'info');
      else if (s.phase === 'ready' && s.version) toast(`gMatch ${s.version} is ready. Install & Restart in Settings → Updates.`, 'success');
    });
    return () => { off?.() };
  }, [toast]);

  const courier = useCourierDms(identity, {
    dominationConsent: (action: string) => {
      // Receiver-side consent authority for mesh domination (Fase 5/6):
      // the local settings map decides, never the server.
      const key = DOM_ACTION_CONSENT[action];
      return key ? (settings as unknown as Record<string, unknown>)[key] === true : false;
    },
    onNotify: (msg) => {
      if (settings.chatNotificationSfx) playMsgReceive()
      const name = usersRef.current.find((u) => u.id === msg.peerId)?.display_name || 'Someone'
      toast(`${name} sent you a message`, 'info')
    },
    onRoomMessage: (msg, room) => {
      setRoomTick((t) => t + 1)
      if (msg.senderOrbitId === identity?.orbitId) return
      if (settings.chatNotificationSfx) playMsgReceive()
      const name = usersRef.current.find((u) => u.id === msg.senderOrbitId)?.display_name || 'Someone'
      toast(`${name} → ${room.name}`, 'info')
    },
  })
  // Keep the courier's TOFU key registry stocked from the user directory.
  // Destructured stable members: the hook returns a fresh object each render,
  // so never put `courier` itself in a dependency array.
  const courierActive = courier.courierActive
  const registerCourierKeys = courier.registerPeerKeys
  const courierPull = courier.pull
  const courierThreadFor = courier.threadFor
  const courierSend = courier.send
  const meshSend = courier.meshSend
  const meshPeerKnown = courier.meshPeerKnown
  useEffect(() => {
    if (!courierActive) return
    for (const u of users) {
      if (u.publicKey && u.encryptionPubKey) {
        registerCourierKeys(u.id, u.publicKey, u.encryptionPubKey)
      }
    }
  }, [users, courierActive, registerCourierKeys])

  // Courier mode owns the thread list locally (sealed E2EE store; the server
  // is blind by design, /api/pm/threads is dead). Legacy nodes keep the fetch.
  useEffect(() => {
    if (!courierActive || !identity) return
    const rows = Object.values(courier.threads)
      .filter((th) => th.length)
      .map((th) => {
        const last = th[th.length - 1]
        return {
          peer_id: last.peerId,
          peer_name: null, // GMatchDMs.displayNameFor resolves it from the users prop
          last_id: last.id,
          last_body: last.text,
          last_sender_id: last.own ? identity.orbitId : last.peerId,
          last_created_at: new Date(last.ts).toISOString(),
        }
      })
      .sort((a, b) => (b.last_created_at || '').localeCompare(a.last_created_at || ''))
    setPmThreads(rows)
  }, [courierActive, courier.threads, identity])

  const loadPmThreads = useCallback(() => {
    if (!identity) return Promise.resolve()
    const base = getApiBaseUrl()
    // Await the mode probe before deciding: firing the legacy fetch while
    // the cache is still empty 404-spams the console on courier-only nodes.
    return detectMailMode(base).then((mode) => {
      if (courierActive || mode === 'courier') return
      return orbitFetch(`/api/pm/threads?_t=${Date.now()}`, {}, identity)
        .then(async (res) => {
          if (!res.ok) return
          const data = await res.json()
          if (Array.isArray(data)) {
            setPmThreads(data)
          }
        })
        .catch(() => { })
    })
  }, [identity, courierActive])

  // ─── Unified rooms chat (rooms ARE the chat system; dock shows a preview) ───
  const chatRooms = useMemo(
    () => courier.rooms.map((r) => ({ id: r.id, name: r.name, ownerId: r.ownerId, members: r.members, epoch: r.epoch, seenAt: roomSeen[r.id] })),
    [courier.rooms, roomSeen]
  )
  // RoomMessage -> ChatMessage adapter so the existing thread renderer/blocks
  // work untouched for sealed rooms.
  //
  // The name comes from the message itself (sealed into the room payload by
  // RoomManager.say). This used to hardcode `senderName: ''`, which combined
  // with the renderer's roster fallback is why EVERY room sender showed up as
  // "User" — a room member is often absent from the capped /api/users page, and
  // the room's own roster only carries orbit ids, never names.
  const chatRoomMessages = useCallback((roomId: string): ChatMessage[] =>
    courier.roomMessages(roomId).map((m) => ({
      id: m.id,
      senderId: m.senderOrbitId,
      senderName: m.displayName ?? '',
      text: m.text,
      timestamp: m.ts,
    })), [courier.roomMessages])
  const openRoomChat = useCallback((roomId: string | null) => {
    setActiveRoomId(roomId)
    if (roomId) {
      setRoomSeen((prev) => {
        const next = { ...prev, [roomId]: Date.now() }
        try { localStorage.setItem('gmatch_room_seen_v1', JSON.stringify(next)) } catch { }
        return next
      })
    }
  }, [])
  // courier.roomMessages reads a mutable local store; bump this on every
  // incoming room message so the preview/unread memos recompute.
  const [roomTick, setRoomTick] = useState(0)
  const roomUnread = useCallback((roomId: string): boolean => {
    const last = courier.roomMessages(roomId).slice(-1)[0]
    return !!last && last.ts > (roomSeen[roomId] || 0) && last.senderOrbitId !== identity?.orbitId
  }, [courier.roomMessages, roomSeen, identity?.orbitId, roomTick])

  // Chat badge: total NEW inbound messages across courier DM threads and
  // sealed rooms (both local-only lanes) plus the legacy server lane.
  // Recomputes live as threads/rooms arrive via the existing courier state.
  const chatUnreadCount = useMemo(() => countChatUnread({
    threads: courier.threads,
    dmSeen,
    roomIds: courier.rooms.map((r) => r.id),
    roomMessages: (id) => courier.roomMessages(id),
    roomSeen,
    selfId: identity?.orbitId,
    serverUnread: pmUnreadCount,
  }), [courier.threads, courier.rooms, courier.roomMessages, roomTick, dmSeen, roomSeen, pmUnreadCount, identity?.orbitId])



  const loadPmUnreadCount = useCallback(() => {
    if (!identity) return Promise.resolve()
    // Same courier gate as loadPmThreads: the legacy route is 404 on official
    // nodes; probing it every poll is the console-spam report.
    return detectMailMode(getApiBaseUrl()).then((mode) => {
      if (mode === 'courier') { setPmUnreadCount(0); return }
      return orbitFetch(`/api/pm/unread-count?_t=${Date.now()}`, {}, identity)
        .then(async (res) => {
          if (!res.ok) return
          const data = await res.json()
          setPmUnreadCount(Math.max(0, Number(data?.count || 0)))
        })
    }).catch(() => { })
  }, [identity])

  // Opening chat clears its badge: stamp all sealed rooms + all courier DM
  // threads seen, plus best-effort per-thread legacy read, then reconcile
  // the server count. Optimistically zero first so the badge clears
  // instantly even if a call fails.
  const markAllChatRead = useCallback(() => {
    const now = Date.now();
    setRoomSeen((prev) => {
      const next = { ...prev };
      for (const r of courier.rooms) next[r.id] = now;
      try { localStorage.setItem('gmatch_room_seen_v1', JSON.stringify(next)); } catch { }
      return next;
    });
    setDmSeen((prev) => {
      const next = { ...prev };
      for (const peerId of Object.keys(courier.threads)) next[peerId] = now;
      try { localStorage.setItem('gmatch_dm_seen_v1', JSON.stringify(next)); } catch { }
      return next;
    });
    setPmUnreadCount(0);
  }, [courier])

  const loadPmMessages = useCallback((peerId: string) => {
    if (!identity) return Promise.resolve()
    // Courier mode: the thread lives in our local store; a "load" is a pull.
    if (courier.courierActive) {
      return (async () => {
        await courier.pull()
        stampDmSeen(peerId)
        const msgs = (courier.threadFor(peerId) || []).map((m) => ({
          id: m.id,
          senderId: m.own ? identity.orbitId : peerId,
          // `m.senderName` is the name sealed into the DM body, so a peer who
          // is not in the capped /api/users page still renders by name.
          senderName: resolveDisplayName({
            selfId: identity.orbitId,
            senderId: m.own ? identity.orbitId : peerId,
            payloadName: m.own ? undefined : m.senderName,
            roster: nameRoster,
          }),
          text: m.text,
          timestamp: m.ts,
          readByRecipient: m.status === 'delivered',
          courierStatus: m.status,
          attachmentId: m.attachmentId,
          attachmentUrl: m.attachmentId ? `/api/objects/${m.attachmentId}` : undefined,
        }))
        setPmMessagesByPeer((prev) => ({ ...prev, [peerId]: msgs }))
      })()
    }
    if (peerId !== 'global_lobby' && peerId !== 'card_queue') {
      // Server /api/pm/read is retired; unread state tracked locally
      loadPmUnreadCount();
    }
    return orbitFetch(`/api/pm?peer=${encodeURIComponent(peerId)}&_t=${Date.now()}`, {}, identity)
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        if (Array.isArray(data)) {
          const msgs: ChatMessage[] = data.map((m: any) => ({
            id: m.id,
            senderId: m.sender_id,
            senderName: resolveDisplayName({
              selfId: identity.orbitId,
              senderId: m.sender_id,
              payloadName: m.sender_name,
              roster: nameRoster,
            }),
            text: m.body,
            timestamp: new Date(m.created_at).getTime() || Date.now(),
            replyToId: m.reply_to || undefined,
            attachmentId: m.attachment_id || undefined,
            attachmentUrl: m.attachment_id ? `/api/objects/${m.attachment_id}` : undefined,
            attachmentMime: m.attachment_mime || undefined,
            editedAt: m.edited_at || undefined,
            readByRecipient: Boolean(m.read_by_recipient),
          })).sort((a: ChatMessage, b: ChatMessage) => a.timestamp - b.timestamp)
          setPmMessagesByPeer(prev => {
            const existing = prev[peerId] || []
            const serverIds = new Set(msgs.map(m => m.id))
            // Preserve unconfirmed local (optimistic) messages that the server
            // hasn't returned yet so sends never visibly vanish mid-refetch.
            const pendingLocal = existing.filter(m => m.id.startsWith('local_') && !serverIds.has(m.id))
            return { ...prev, [peerId]: [...msgs, ...pendingLocal].sort((a, b) => a.timestamp - b.timestamp) }
          })
        }
      })
      .catch(() => { })
  }, [identity, users, myProfile.displayName, loadPmUnreadCount, courierActive, courierPull, courierThreadFor, stampDmSeen])

  const sendPm = useCallback(async (peerId: string, text: string, replyToId?: string, attachment?: { id: string; url: string }): Promise<boolean> => {
    if (!identity) return false
    if (!text.trim() && !attachment) return false
    // Blind-courier mode (official SITE): sealed envelope to the peer's box,
    // never a server inbox. Attachments ride the sealed body as object refs.
    if (courier.courierActive) {
      if (replyToId) {
        toast('Replies need a direct connection. Send text for now.', 'warning')
      }
      // Attachments ride the sealed body as a private object id (the upload
      // already added the peer to Recipients, so they can fetch the bytes).
      let msg = await courier.send(peerId, text.trim(), attachment?.id)
      if (msg && msg.status === 'failed') {
        // Roster is capped — the peer's keys may simply never have been
        // cached. Resolve them from the public profile and retry once.
        try {
          const pres = await orbitFetch(`/api/users/${encodeURIComponent(peerId)}`, {}, identity)
          if (pres.ok) {
            const pu = ((await pres.json()) as { user?: { public_key?: string; encryption_pub_key?: string } }).user
            if (pu?.public_key) {
              registerCourierKeys(peerId, pu.public_key, pu.encryption_pub_key || '')
              msg = await courier.send(peerId, text.trim(), attachment?.id)
            }
          }
        } catch { /* offline: keep the failed state below */ }
      }
      const ok = !!msg && msg.status !== 'failed'
      if (!ok) {
        toast('Peer key unknown. The message stays local and won\'t deliver until you have their key.', 'error')
      }
      void loadPmMessages(peerId)
      loadPmThreads()
      return ok
    }
    const optimisticId = `local_${Date.now()}`
    const optimistic: ChatMessage = {
      id: optimisticId,
      senderId: identity.orbitId,
      senderName: resolveDisplayName({ selfId: identity.orbitId, senderId: identity.orbitId, roster: nameRoster }),
      text: text.trim(),
      timestamp: Date.now(),
      replyToId,
      attachmentId: attachment?.id,
      attachmentUrl: attachment?.url,
    }
    setPmMessagesByPeer(prev => ({ ...prev, [peerId]: [...(prev[peerId] || []), optimistic] }))
    try {
      const res = await orbitFetch('/api/pm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_id: peerId,
          body: text.trim(),
          reply_to: replyToId || null,
          attachment_id: attachment?.id || null,
        }),
      }, identity)
      if (!res.ok) {
        // No silent failure: a dead bundled server or a 4xx must be visible,
        // and the optimistic bubble rolled back (1.0.1 bug: DMs appeared to
        // vanish with no feedback).
        setPmMessagesByPeer(prev => ({ ...prev, [peerId]: (prev[peerId] || []).filter(m => m.id !== optimisticId) }))
        const detail = await res.json().catch(() => ({}) as { error?: string })
        toast(detail.error || `Could not send message (HTTP ${res.status})`, 'error')
        return false
      }
      // Drop the optimistic copy now the server has confirmed it — the fresh
      // (cache-busted) refetch carries the authoritative row under its real id.
      setPmMessagesByPeer(prev => ({ ...prev, [peerId]: (prev[peerId] || []).filter(m => m.id !== optimisticId) }))
      loadPmMessages(peerId)
      loadPmThreads()
      return true
    } catch {
      setPmMessagesByPeer(prev => ({ ...prev, [peerId]: (prev[peerId] || []).filter(m => m.id !== optimisticId) }))
      toast('Couldn\'t send the message. The server is unreachable.', 'error')
      return false
    }
  }, [identity, myProfile.displayName, loadPmMessages, loadPmThreads, toast, courierActive, courierSend, registerCourierKeys])

  useEffect(() => {
    if (!identity) return
    loadPmThreads()
    const handlePmNew = (e: Event) => {
      if (settings.chatNotificationSfx) playMsgReceive()
      // The WS push carries the full PM row — append it immediately to the
      // right conversation so the message appears before the refetch lands.
      const detail = (e as CustomEvent<unknown>).detail as Record<string, unknown> | null
      if (detail && typeof detail.id === 'string' && identity) {
        const incoming = typeof detail.sender_id === 'string' ? detail.sender_id : ''
        const peerId = incoming && incoming !== identity.orbitId
          ? incoming
          : (typeof detail.recipient_id === 'string' ? detail.recipient_id : '')
        if (peerId && peerId !== 'global_lobby' && peerId !== 'card_queue') {
          const attachmentId = typeof detail.attachment_id === 'string' ? detail.attachment_id : undefined
          const msg: ChatMessage = {
            id: String(detail.id),
            senderId: incoming || identity.orbitId,
            senderName: resolveDisplayName({
              selfId: identity.orbitId,
              senderId: incoming || identity.orbitId,
              payloadName: typeof detail.sender_name === 'string' ? detail.sender_name : null,
              roster: nameRoster,
            }),
            text: typeof detail.body === 'string' ? detail.body : '',
            timestamp: new Date(String(detail.created_at || Date.now())).getTime() || Date.now(),
            replyToId: typeof detail.reply_to === 'string' ? detail.reply_to : undefined,
            attachmentId,
            attachmentUrl: attachmentId ? `/api/objects/${attachmentId}` : undefined,
            attachmentMime: typeof detail.attachment_mime === 'string' ? detail.attachment_mime : undefined,
            editedAt: typeof detail.edited_at === 'string' ? detail.edited_at : undefined,
            readByRecipient: Boolean(detail.read_by_recipient),
          }
          setPmMessagesByPeer(prev => {
            const list = prev[peerId] || []
            if (list.some((m) => m.id === msg.id)) return prev
            return { ...prev, [peerId]: [...list, msg].sort((a, b) => a.timestamp - b.timestamp) }
          })
        }
      }
      loadPmThreads()
      loadPmUnreadCount()
      if (pmPeer?.id) loadPmMessages(pmPeer.id)
    }

    const handlePmEdited = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail as Record<string, unknown> | null
      if (!detail || !identity) return
      const msgId = typeof detail.id === 'string' ? detail.id : ''
      const newText = typeof detail.body === 'string' ? detail.body : ''
      const editedAt = typeof detail.edited_at === 'string' ? detail.edited_at : undefined
      const incoming = typeof detail.sender_id === 'string' ? detail.sender_id : ''
      const peerId = incoming && incoming !== identity.orbitId
        ? incoming
        : (typeof detail.recipient_id === 'string' ? detail.recipient_id : '')
      if (!msgId || !peerId || peerId === 'global_lobby' || peerId === 'card_queue') return
      setPmMessagesByPeer(prev => {
        const list = prev[peerId] || []
        const idx = list.findIndex(m => m.id === msgId)
        if (idx === -1) return prev
        const updated = [...list]
        updated[idx] = { ...updated[idx], text: newText, editedAt }
        return { ...prev, [peerId]: updated }
      })
    }

    const handlePmDeletedEveryone = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail as Record<string, unknown> | null
      if (!detail || !identity) return
      const msgId = typeof detail.messageId === 'string' ? detail.messageId : ''
      const incoming = typeof detail.sender_id === 'string' ? detail.sender_id : ''
      const peerId = incoming && incoming !== identity.orbitId
        ? incoming
        : (typeof detail.recipient_id === 'string' ? detail.recipient_id : '')
      if (!msgId || !peerId || peerId === 'global_lobby' || peerId === 'card_queue') return
      setPmMessagesByPeer(prev => {
        const list = prev[peerId] || []
        return { ...prev, [peerId]: list.filter(m => m.id !== msgId) }
      })
    }

    window.addEventListener('orbit-pm-new', handlePmNew)
    window.addEventListener('orbit-pm-edited', handlePmEdited)
    window.addEventListener('orbit-pm-deleted-everyone', handlePmDeletedEveryone)
    return () => {
      window.removeEventListener('orbit-pm-new', handlePmNew)
      window.removeEventListener('orbit-pm-edited', handlePmEdited)
      window.removeEventListener('orbit-pm-deleted-everyone', handlePmDeletedEveryone)
    }
  }, [identity, users, myProfile.displayName, pmPeer, loadPmThreads, loadPmMessages, loadPmUnreadCount, settings.chatNotificationSfx])

  const [groupMessagesByGroup, setGroupMessagesByGroup] = useState<Record<string, ChatMessage[]>>({})

  // Real-time group-chat push: append the incoming message to the group's
  // cached thread (creating the entry if it hasn't been opened yet).
  useEffect(() => {
    const handleGroupNew = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail as Record<string, unknown> | null
      if (!detail || typeof detail.id !== 'string' || typeof detail.group_id !== 'string' || !identity) return
      const senderId = typeof detail.sender_id === 'string' ? detail.sender_id : ''
      const attachmentId = typeof detail.attachment_id === 'string' ? detail.attachment_id : undefined
      const groupId = detail.group_id as string
      const msg: ChatMessage = {
        id: String(detail.id),
        senderId: senderId || identity.orbitId,
        senderName: resolveDisplayName({
          selfId: identity.orbitId,
          senderId: senderId || identity.orbitId,
          payloadName: typeof detail.sender_name === 'string' ? detail.sender_name : null,
          roster: nameRoster,
        }),
        text: typeof detail.body === 'string' ? detail.body : '',
        timestamp: new Date(String(detail.created_at || Date.now())).getTime() || Date.now(),
        replyToId: typeof detail.reply_to === 'string' ? detail.reply_to : undefined,
        attachmentId,
        attachmentUrl: attachmentId ? `/api/objects/${attachmentId}` : undefined,
        attachmentMime: typeof detail.attachment_mime === 'string' ? detail.attachment_mime : undefined,
      }
      setGroupMessagesByGroup(prev => {
        const list = prev[groupId] || []
        if (list.some((m) => m.id === msg.id)) return prev
        return { ...prev, [groupId]: [...list, msg].sort((a, b) => a.timestamp - b.timestamp) }
      })
    }
    window.addEventListener('orbit-group-new', handleGroupNew)
    return () => window.removeEventListener('orbit-group-new', handleGroupNew)
  }, [identity, myProfile.displayName])

  // Real-time notifications push: SFX & tab title flash (notifications stay inside the notifications tab)
  useEffect(() => {
    const handleIncomingNotif = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail as Record<string, unknown> | null
      if (!detail) return
      // PMs arrive on their own socket channel too (message + sound there);
      // the server's 'pm' notification row exists for the panel/reload, so
      // re-announcing it here is the duplicate the user reported.
      if (detail.type === 'pm') return
      playChime()

      if (typeof document !== 'undefined' && document.hidden) {
        const oldTitle = document.title
        document.title = '(1) New interaction · gMatch'
        const restore = () => {
          document.title = oldTitle
          window.removeEventListener('focus', restore)
        }
        window.addEventListener('focus', restore, { once: true })
      }
    }
    window.addEventListener('orbit-incoming-notification', handleIncomingNotif)
    return () => window.removeEventListener('orbit-incoming-notification', handleIncomingNotif)
  }, [])

  const reportPmMessage = useCallback(async (messageId: string) => {
    if (!identity) return
    try {
      await orbitFetch(`/api/pm/${messageId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Reported from DM' }),
      }, identity)
      toast('Message reported', 'info')
    } catch { }
  }, [identity, toast])

  const reportPmUser = useCallback(async (userId: string) => {
    if (!identity) return
    try {
      await orbitFetch('/api/pm/report-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, reason: 'Reported from DM' }),
      }, identity)
      toast('User reported', 'info')
    } catch { }
  }, [identity, toast])

  const deletePmMessage = useCallback(async (messageId: string, peerId: string) => {
    if (!identity) return
    try {
      await orbitFetch(`/api/pm/${messageId}`, { method: 'DELETE' }, identity)
      loadPmMessages(peerId)
      loadPmThreads()
      loadPmUnreadCount()
    } catch { }
  }, [identity, loadPmMessages, loadPmThreads, loadPmUnreadCount])

  const deleteThread = useCallback(async (peerId: string) => {
    if (!identity) return
    const base = getApiBaseUrl()
    const isCourier = courierActive || isKnownSiteCourier(base) || cachedMailMode(base) === 'courier'
    try {
      if (!isCourier) {
        await orbitFetch(`/api/pm/threads/${peerId}`, { method: 'DELETE' }, identity)
      }
      setPmPeer(null)
      setPmMessagesByPeer(prev => {
        const next = { ...prev }
        delete next[peerId]
        return next
      })
      loadPmThreads()
      loadPmUnreadCount()
    } catch { }
  }, [identity, loadPmThreads, loadPmUnreadCount, courierActive])

  const loadPmHistory = useCallback(async (peerId: string, beforeTimestamp: string): Promise<boolean> => {
    if (!identity) return false
    try {
      const res = await orbitFetch(`/api/pm/history/${encodeURIComponent(peerId)}?before=${encodeURIComponent(beforeTimestamp)}&limit=50`, {}, identity)
      if (!res.ok) return false
      const data = await res.json()
      if (!data || !Array.isArray(data.messages)) return false
      const older: ChatMessage[] = data.messages.map((m: any) => ({
        id: m.id,
        senderId: m.sender_id,
        senderName: resolveDisplayName({
          selfId: identity.orbitId,
          senderId: m.sender_id,
          payloadName: m.sender_name,
          roster: nameRoster,
        }),
        text: m.body,
        timestamp: new Date(m.created_at).getTime() || Date.now(),
        replyToId: m.reply_to || undefined,
        attachmentId: m.attachment_id || undefined,
        attachmentUrl: m.attachment_id ? `/api/objects/${m.attachment_id}` : undefined,
        attachmentMime: m.attachment_mime || undefined,
        editedAt: m.edited_at || undefined,
        readByRecipient: Boolean(m.read_by_recipient),
      })).sort((a: ChatMessage, b: ChatMessage) => a.timestamp - b.timestamp)
      if (older.length === 0) return false
      setPmMessagesByPeer(prev => {
        const existing = prev[peerId] || []
        const existingIds = new Set(existing.map(m => m.id))
        const newMsgs = older.filter(m => !existingIds.has(m.id))
        return { ...prev, [peerId]: [...newMsgs, ...existing].sort((a, b) => a.timestamp - b.timestamp) }
      })
      return Boolean(data.hasMore)
    } catch {
      return false
    }
  }, [identity, users, myProfile.displayName])

  // ─── Group chats ───
  const [chatGroups, setChatGroups] = useState<Array<{ id: string; name: string; owner_id: string; member_count: number; is_member: number }>>([])

  // Dock preview rows: one line per chat surface (lobby, queue, rooms, groups,
  // DM threads) — clicking a row opens the unified Rooms chat on it.
  const previewRows = useMemo(() => {
    const lobby = chatMessages.filter((m) => !m.channel || m.channel === 'global_lobby')
    const queue = chatMessages.filter((m) => m.channel === 'card_queue')
    let readIds = new Set<string>()
    try { readIds = new Set(JSON.parse(localStorage.getItem('orbit_read_dms') || '[]')) } catch { /* fresh */ }
    return buildPreviewRows({
      rooms: chatRooms,
      roomLast: (id) => chatRoomMessages(id).slice(-1)[0]?.text,
      roomUnread,
      groups: chatGroups,
      groupLast: (id) => (groupMessagesByGroup[id] || []).slice(-1)[0]?.text,
      threads: pmThreads,
      myOrbitId: identity?.orbitId,
      readIds,
      lobbyLast: lobby.slice(-1)[0]?.text,
      queueLast: queue.slice(-1)[0]?.text,
    })
  }, [chatMessages, chatRooms, chatRoomMessages, roomUnread, chatGroups, groupMessagesByGroup, pmThreads, identity?.orbitId, roomTick])

  const loadChatGroups = useCallback(() => {
    if (!identity) return Promise.resolve()
    return orbitFetch('/api/groups', {}, identity)
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        setChatGroups(Array.isArray(data?.groups) ? data.groups : [])
      })
      .catch(() => { })
  }, [identity])

  const loadGroupMessages = useCallback((groupId: string) => {
    if (!identity) return Promise.resolve()
    return orbitFetch(`/api/groups/${groupId}/messages`, {}, identity)
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        if (Array.isArray(data)) {
          const msgs: ChatMessage[] = data.map((m: any) => ({
            id: m.id,
            senderId: m.sender_id,
            senderName: resolveDisplayName({
              selfId: identity.orbitId,
              senderId: m.sender_id,
              payloadName: m.sender_name,
              roster: nameRoster,
            }),
            text: m.body,
            timestamp: new Date(m.created_at).getTime() || Date.now(),
            replyToId: m.reply_to || undefined,
            attachmentId: m.attachment_id || undefined,
            attachmentUrl: m.attachment_id ? `/api/objects/${m.attachment_id}` : undefined,
            attachmentMime: m.attachment_mime || undefined,
          })).sort((a: ChatMessage, b: ChatMessage) => a.timestamp - b.timestamp)
          setGroupMessagesByGroup(prev => ({ ...prev, [groupId]: msgs }))
        }
      })
      .catch(() => { })
  }, [identity, nameRoster])

  useEffect(() => {
    const refreshChat = () => {
      if (document.visibilityState !== 'visible') return
      if (pmPeer?.id && pmPeer.id !== 'global_lobby' && pmPeer.id !== 'card_queue') void loadPmMessages(pmPeer.id)
      if (activeGroupId) void loadGroupMessages(activeGroupId)
      void loadChatGroups()
    }
    window.addEventListener('focus', refreshChat)
    document.addEventListener('visibilitychange', refreshChat)
    return () => {
      window.removeEventListener('focus', refreshChat)
      document.removeEventListener('visibilitychange', refreshChat)
    }
  }, [activeGroupId, loadChatGroups, loadGroupMessages, loadPmMessages, pmPeer?.id])

  const loadGroupMembers = useCallback(async (groupId: string): Promise<GroupMember[]> => {
    if (!identity) return []
    const res = await orbitFetch(`/api/groups/${groupId}/members`, {}, identity)
    if (!res.ok) throw new Error(`Could not load members (${res.status})`)
    const data = await res.json()
    return Array.isArray(data?.members) ? data.members : []
  }, [identity])

  const addGroupMembers = useCallback(async (groupId: string, ids: string[]) => {
    if (!identity || ids.length === 0) return false
    try {
      const res = await orbitFetch(`/api/groups/${groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_ids: ids }),
      }, identity)
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast(data?.error || `Could not add members (${res.status})`, 'error')
        return false
      }
      loadChatGroups()
      return true
    } catch (err) {
      toast(userFacingError(err, { fallback: 'Could not add members.' }), 'error')
      return false
    }
  }, [identity, loadChatGroups, toast])

  const createGroup = useCallback(async (name: string, memberIds: string[]) => {
    if (!identity || !name.trim()) return null
    try {
      const res = await orbitFetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), member_ids: memberIds }),
      }, identity)
      if (res.ok) {
        const data = await res.json()
        loadChatGroups()
        if (data.group?.id) {
          setActiveGroupId(data.group.id)
        }
        return data.group?.id || null
      }
      return null
    } catch { return null }
  }, [identity, loadChatGroups])

  const sendGroupMessage = useCallback(async (groupId: string, text: string, replyToId?: string, attachment?: { id: string; url: string; isVideo?: boolean }) => {
    if (!identity || (!text.trim() && !attachment)) return
    try {
      const res = await orbitFetch(`/api/groups/${groupId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text.trim(), reply_to: replyToId || null, attachment_id: attachment?.id || null }),
      }, identity)
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast(data?.error || `Could not send group message (${res.status})`, 'error')
        return
      }
      loadGroupMessages(groupId)
    } catch (err) {
      toast(userFacingError(err, { fallback: 'Could not send group message. The server is unreachable.' }), 'error')
    }
  }, [identity, loadGroupMessages, toast])

  const openAttachmentModal = useCallback((
    target: 'pm' | 'group',
    peerId?: string,
    groupId?: string,
    replyToId?: string,
    files?: File[],
    url?: string,
  ) => {
    if (target === 'group' && !groupId) {
      // No specific group selected - open group picker first
      setGroupPickerOpen(true)
        // Store the replyToId for later
      ; (window as any).__pendingGroupReplyToId = replyToId
        // A paste into the group-less state still has to survive the picker,
        // or choosing a group would silently discard the image.
      ; (window as any).__pendingAttachmentFiles = files
      ; (window as any).__pendingAttachmentUrl = url
    } else {
      setAttachmentModal({ isOpen: true, target, peerId, groupId, replyToId, initialFiles: files, initialUrl: url })
    }
  }, [])

  

  const closeAttachmentModal = useCallback(() => {
    setAttachmentModal(null)
    setGroupPickerOpen(false)
  }, [])

  const handleAttachmentSuccess = useCallback((attachment: { id: string; url: string; isVideo?: boolean }) => {
    if (!attachmentModal || !identity) return
    // Check for pending babecock attachment (shared from gallery)
    const pendingAttachment = (window as any).__pendingBabecockAttachment
    const finalAttachment = pendingAttachment || attachment
    if (pendingAttachment) {
      ; (window as any).__pendingBabecockAttachment = null
    }
    if (attachmentModal.target === 'pm' && attachmentModal.peerId) {
      void sendPm(attachmentModal.peerId, '', attachmentModal.replyToId, finalAttachment)
    } else if (attachmentModal.target === 'group' && attachmentModal.groupId) {
      void sendGroupMessage(attachmentModal.groupId, '', attachmentModal.replyToId, finalAttachment)
    }
    closeAttachmentModal()
  }, [attachmentModal, identity, sendPm, sendGroupMessage, closeAttachmentModal])

  const handleGroupPickerSelect = useCallback((groupId: string) => {
    const pendingAttachment = (window as any).__pendingBabecockAttachment
    const replyToId = (window as any).__pendingGroupReplyToId
    const pastedFiles = (window as any).__pendingAttachmentFiles as File[] | undefined
    const pastedUrl = (window as any).__pendingAttachmentUrl as string | undefined
      ; (window as any).__pendingBabecockAttachment = null
      ; (window as any).__pendingGroupReplyToId = null
      ; (window as any).__pendingAttachmentFiles = undefined
      ; (window as any).__pendingAttachmentUrl = undefined
    setGroupPickerOpen(false)
    if (pendingAttachment) {
      // Send directly without opening attachment modal
      void sendGroupMessage(groupId, '', replyToId, pendingAttachment)
    } else {
      // Open attachment modal for this group, carrying the pasted image (if
      // any) through the picker rather than dropping it on the floor.
      setAttachmentModal({ isOpen: true, target: 'group', groupId, replyToId, initialFiles: pastedFiles, initialUrl: pastedUrl })
    }
  }, [sendGroupMessage])

  // Listen for babecock share-to-group event
  useEffect(() => {
    const handler = (e: CustomEvent<{ attachment: { id: string; url: string; isVideo?: boolean } }>) => {
      // Open group picker for group chat selection
      setGroupPickerOpen(true)
        // Store the attachment and replyToId for when group is selected
        ; (window as any).__pendingBabecockAttachment = e.detail.attachment
        ; (window as any).__pendingGroupReplyToId = undefined
    }
    window.addEventListener('babecock-share-to-group', handler as EventListener)
    return () => window.removeEventListener('babecock-share-to-group', handler as EventListener)
  }, [])

  const leaveGroup = useCallback(async (groupId: string) => {
    if (!identity) return
    try {
      await orbitFetch(`/api/groups/${groupId}/leave`, { method: 'POST' }, identity)
      loadChatGroups()
    } catch { }
  }, [identity, loadChatGroups])

  useEffect(() => {
    if (identity) loadChatGroups()
  }, [identity, loadChatGroups])

  const handleSetProfilePic = async (file: File) => {
    if (!identity) return
    toast('Updating profile picture…', 'info')

    try {
      // 1. Generate a lightweight 256x256 thumbnail data URL via canvas
      const thumbDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const img = new Image()
          img.onload = () => {
            const canvas = document.createElement('canvas')
            const size = Math.min(img.width, img.height)
            const sx = (img.width - size) / 2
            const sy = (img.height - size) / 2
            canvas.width = Math.min(256, size)
            canvas.height = Math.min(256, size)
            const ctx = canvas.getContext('2d')
            if (!ctx) {
              resolve(reader.result as string)
              return
            }
            ctx.drawImage(img, sx, sy, size, size, 0, 0, canvas.width, canvas.height)
            resolve(canvas.toDataURL('image/jpeg', 0.85))
          }
          img.onerror = () => resolve(reader.result as string)
          img.src = reader.result as string
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      // 2. Optimistically apply locally right away
      setProfilePics(prev => {
        const next = { ...prev, [identity.orbitId]: thumbDataUrl }
        try { setSecureItem('goonmatch_pfps', JSON.stringify(next)) } catch { }
        return next
      })

      // 3. Persist via the shared profile path: data URL persists directly.
      const res = await saveUserProfile(identity, {
        display_name: myProfile?.displayName || identity.orbitId.slice(0, 8),
        pfp_url: thumbDataUrl,
      })

      if (!res.ok) {
        toast(res.error || 'Failed to save profile picture to server', 'error')
        return
      }

      // Reflect the server-side ref locally so peers see the same URL.
      // This is the value that must stick: update BOTH caches (profilePics
      // + myProfile/orbit_pfp_url) with the server ref, never the local
      // data: thumbnail (which 404s for peers and bloats the secure store).
      setProfilePics((prev) => {
        if (typeof res.pfpUrl !== 'string') return prev
        const next = { ...prev, [identity.orbitId]: res.pfpUrl as string }
        try { setSecureItem('goonmatch_pfps', JSON.stringify(next)) } catch { }
        return next
      })
      if (typeof res.pfpUrl === 'string' && res.pfpUrl) {
        const serverPfp = res.pfpUrl as string
        setMyProfile((prev) => (prev.pfpUrl === serverPfp ? prev : { ...prev, pfpUrl: serverPfp }))
        try { setSecureItem('orbit_pfp_url', serverPfp) } catch { }
        try { localStorage.setItem('orbit_pfp_url', serverPfp) } catch { }
      }

      toast('Profile picture updated.', 'success')
      loadUsers()
      void lobby.refresh()
    } catch {
      toast('Failed to update profile picture', 'error')
    }
  }

  const { isIdle } = useIdle(settings.idleTimeout, settings.idleEnabled);

  const sendPanelRef = useRef<SendPanelHandle>(null)
  const storyFileInputRef = useRef<HTMLInputElement>(null)

  

  

  const p2pItemsRef = useRef(p2pItems);
  const settingsRef = useRef(settings);
  const peersRef = useRef(peers);

  // Keep "latest value" refs in sync after commit (read only in async
  // handlers/effects, never during render).
  useEffect(() => {
    p2pItemsRef.current = p2pItems;
    settingsRef.current = settings;
    peersRef.current = peers;
  }, [p2pItems, settings, peers]);

  const loadUsers = useCallback(() => {
    if (!identity) return Promise.resolve();
    const currentPeers = peersRef.current;
    const seq = ++usersRequestRef.current;
    return orbitFetch('/api/users', {}, identity)
      .then(r => r.ok ? r.json() : [])
      .then((serverUsers: User[]) => {
        // Drop stale responses: a newer loadUsers() may have been issued while
        // this fetch was in flight — only the newest result may land.
        if (seq !== usersRequestRef.current) return;
        if (!Array.isArray(serverUsers)) serverUsers = [];
        const mergedMap = new Map<string, User>();
        for (const u of serverUsers) {
          mergedMap.set(u.id, u);
        }
        if (currentPeers && currentPeers.length > 0) {
          // Presence authority is the server: P2P sightings must never revive
          // or freeze a peer's online flag (stale swarm entries used to pin
          // leavers online forever). Swarm-only peers (heartbeat not yet
          // processed server-side) are admitted only while their sighting is
          // fresh, so they decay instead of lingering as ghosts.
          const now = Date.now();
          for (const p of currentPeers) {
            if (mergedMap.has(p.id)) continue;
            const seen = p.last_seen ? new Date(p.last_seen).getTime() : 0;
            if (seen > 0 && now - seen < 90_000) {
              mergedMap.set(p.id, { ...p, online: true });
            }
          }
        }
        if (identity) {
          let localName = ''
          try { localName = localStorage.getItem('orbit_display_name') || '' } catch { }
          const selfEntry = mergedMap.get(identity.orbitId);
          if (selfEntry) {
            selfEntry.online = true;
          } else {
            // Synthetic self-entry (the server's 100-row directory can omit
            // you). It is built from scratch every poll, so anything not seeded
            // here reads as NaN/0 in the top bar and the Store — and, worse,
            // "now created" is itself an unstable field. Carry the last known
            // balance/score forward instead of inventing them.
            const prior = users.find((u) => u.id === identity.orbitId);
            mergedMap.set(identity.orbitId, {
              id: identity.orbitId,
              publicKey: identity.publicKeyHex,
              encryptionPubKey: identity.encryptionPubHex,
              createdAt: prior?.createdAt || new Date().toISOString(),
              display_name: localName || prior?.display_name,
              online: true,
              last_seen: new Date().toISOString(),
              pfp_url: prior?.pfp_url,
              balance: prior?.balance ?? 0,
              score: prior?.score ?? 0,
              reputation: prior?.reputation ?? 0,
              // Follow counts too: without them the profile tab falls through
              // to a hardcoded 0 (or, worse, to likes_received) and never moves
              // for anyone outside the server's capped directory.
              followers_count: prior?.followers_count ?? 0,
              following_count: prior?.following_count ?? 0,
              posts_count: prior?.posts_count ?? 0,
              likes_received: prior?.likes_received ?? 0,
            } as User);
          }
        }
        const userList = Array.from(mergedMap.values());
        setUsers(prev => areUsersStructurallyEqual(prev, userList) ? prev : userList);

        setProfilePics(prev => {
          let updated = false
          const next = { ...prev }
          for (const u of userList) {
            if (u.pfp_url && next[u.id] !== u.pfp_url) {
              next[u.id] = u.pfp_url
              updated = true
            }
          }
          if (updated) {
            const capped = Object.fromEntries(Object.entries(next).slice(-MAX_PROFILE_PICS_IN_MEMORY))
            try { setSecureItem('goonmatch_pfps', JSON.stringify(capped)) } catch { }
            return capped
          }
          return prev
        })

        if (identity) {
          const selfUser = userList.find(u => u.id === identity.orbitId);
          let localName = '';
          try { localName = localStorage.getItem('orbit_display_name') || ''; } catch { }
          let localTags: string[] = [];
          try { localTags = JSON.parse(localStorage.getItem('orbit_tags') || '[]'); } catch { }
          if (!Array.isArray(localTags)) localTags = [];
          const serverName = selfUser?.display_name || '';
          const serverTags = selfUser?.tags || [];
          const lastSaved = lastSavedProfileRef.current;
          const localIsFresh = lastSaved !== null
            && lastSaved.displayName === localName;
          const serverDiffers = serverName !== localName || JSON.stringify(serverTags) !== JSON.stringify(localTags);

          let displayName: string;
          let tags: string[];
          let adoptedServer = false;
          if (!serverDiffers) {
            displayName = localName || serverName;
            tags = localTags.length > 0 ? localTags : serverTags;
          } else if (localIsFresh) {
            displayName = localName;
            tags = localTags;
          } else if (serverName) {
            displayName = serverName;
            tags = serverTags.length > 0 ? serverTags : localTags;
            adoptedServer = true;
          } else {
            displayName = localName || serverName;
            tags = localTags.length > 0 ? localTags : serverTags;
            if (localName) {
              saveUserProfile(identity, { display_name: localName, tags: localTags }).catch(() => { });
            }
          }

          if (adoptedServer && displayName && (displayName !== localName || JSON.stringify(tags) !== JSON.stringify(localTags))) {
            try {
              localStorage.setItem('orbit_display_name', displayName);
              localStorage.setItem('orbit_tags', JSON.stringify(tags));
            } catch { }
            try {
              window.dispatchEvent(new CustomEvent('orbit_profile_updated', { detail: { displayName, tags, source: 'sync' } }));
            } catch { }
          }
          const isAdmin = Boolean((selfUser as { is_admin?: boolean } | null)?.is_admin);
          // Server is truth for the avatar: adopt selfUser.pfp_url into
          // myProfile (previously prev.pfpUrl was kept forever, so a pfp
          // set on another device — or repaired server-side — never showed,
          // and a locally-cached data: URL survived after the server moved on).
          const serverPfp = typeof selfUser?.pfp_url === 'string' ? selfUser.pfp_url : '';
          if (serverPfp) {
            try {
              const cached = getSecureItem('orbit_pfp_url') || (() => { try { return localStorage.getItem('orbit_pfp_url') || '' } catch { return '' } })();
              if (cached !== serverPfp) {
                try { setSecureItem('orbit_pfp_url', serverPfp) } catch { }
                try { localStorage.setItem('orbit_pfp_url', serverPfp) } catch { }
              }
            } catch { /* best effort */ }
          }
          setMyProfile(prev => {
            const nextPfp = serverPfp || prev.pfpUrl;
            if (prev.displayName === displayName && JSON.stringify(prev.tags) === JSON.stringify(tags) && prev.isAdmin === isAdmin && prev.pfpUrl === nextPfp) return prev;
            return { displayName, tags, isAdmin, pfpUrl: nextPfp };
          });
        }
      })
      .catch(() => {
        const currentPeers = peersRef.current;
        if (currentPeers && currentPeers.length > 0) {
          setUsers(prev => areUsersStructurallyEqual(prev, currentPeers) ? prev : currentPeers);
        }
      });
  }, [identity]);

  // Publish loadUsers for the callbacks declared above it (toggleFollowUser).
  useEffect(() => { loadUsersRef.current = loadUsers; }, [loadUsers]);

  // A follow event just landed (live WS broadcast from users.ts). My follower
  // count is a roster field, so refresh it instead of waiting for the 60-120s
  // poll. Also notifies UserProfileModal, which re-reads its own counts.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ follower_id?: string; followee_id?: string }>).detail;
      if (detail?.followee_id !== identity?.orbitId) return;
      invalidateCache('/api/users')
      loadUsers()
      window.dispatchEvent(new CustomEvent('orbit-profilesync'))
    }
    window.addEventListener('orbit-follow-event', handler)
    return () => window.removeEventListener('orbit-follow-event', handler)
  }, [loadUsers, identity?.orbitId])

  // Opening the profile tab must not show a count that is up to 120s stale.
  useEffect(() => {
    if (mainView !== 'profile' || !identity) return
    invalidateCache('/api/users')
    loadUsers()
  }, [mainView, identity?.orbitId])

  // New admin grant -> refresh /api/users so myProfile.isAdmin (Admin button) updates now.
  useEffect(() => {
    const handler = () => { invalidateCache('/api/users'); loadUsers(); };
    window.addEventListener('gmatch-admin-granted', handler);
    return () => window.removeEventListener('gmatch-admin-granted', handler);
  }, [loadUsers]);

  useEffect(() => {
    const onProfileUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.source === 'sync') return;
      const displayName = typeof detail?.displayName === 'string' ? detail.displayName : null;
      const tags = Array.isArray(detail?.tags) ? detail.tags : null;
      if (displayName === null || tags === null) return;
      lastSavedProfileRef.current = { displayName, tags };
    };
    const onProfileSync = () => { loadUsers(); };
    window.addEventListener('orbit_profile_updated', onProfileUpdated);
    window.addEventListener('orbit-profilesync', onProfileSync);
    return () => {
      window.removeEventListener('orbit_profile_updated', onProfileUpdated);
      window.removeEventListener('orbit-profilesync', onProfileSync);
    };
  }, [loadUsers]);

  // Profile tags auto-sync: the tags the user creates on their own posts
  // (in-game) are the live source of truth. Whenever they drift from the
  // stored profile tags, push the derived union back to the server so the
  // profile always reflects what the player actually uses in-game.
  useEffect(() => {
    if (!identity) return;
    const ownPosts = serverPosts.filter(p => p.author_id === identity.orbitId);
    const derived = deriveProfileTags(ownPosts, myProfile.tags);
    if (JSON.stringify(derived) === JSON.stringify(syncedTagsRef.current)) return;
    syncedTagsRef.current = derived;
    if (JSON.stringify(derived) === JSON.stringify(myProfile.tags)) return;
    setMyProfile(prev => (JSON.stringify(prev.tags) === JSON.stringify(derived) ? prev : { ...prev, tags: derived }));
    saveUserProfile(identity, {
      display_name: myProfile?.displayName || identity.orbitId.slice(0, 8),
      tags: derived,
    }).catch(() => { });
  }, [serverPosts, identity, myProfile.tags]);

  useEffect(() => {
    const onFeedNew = (e: Event) => {
      const post = (e as CustomEvent).detail as FeedPost;
      if (!post || !post.id) return;
      setServerPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        if (seen.has(post.id)) return prev;
        return [post, ...prev];
      });
    };
    window.addEventListener('orbit-feed-new', onFeedNew);
    return () => window.removeEventListener('orbit-feed-new', onFeedNew);
  }, []);

  useEffect(() => {
    const onScoreRefresh = () => { loadUsers(); };
    window.addEventListener('orbit-score-refresh', onScoreRefresh);
    return () => window.removeEventListener('orbit-score-refresh', onScoreRefresh);
  }, [loadUsers]);

  useEffect(() => {
    if (p2pItems && p2pItems.length > 0) {
      setItems((prev) => {
        const prevIds = new Set(prev.map(i => i.id))
        const itemMap = new Map<string, OrbitObject>();
        for (const item of prev) itemMap.set(item.id, item);
        for (const item of p2pItems) {
          const existing = itemMap.get(item.id);
          if (existing && !item.content_url && existing.content_url) {
            itemMap.set(item.id, { ...item, content_url: existing.content_url });
          } else {
            itemMap.set(item.id, item);
          }
          if (!prevIds.has(item.id) && item.owner_id !== identity?.orbitId) {
            notifiedIdsRef.current.add(item.id)
            if (shouldEnqueue(item, decisionMap, identity?.orbitId || '')) {
              enqueueDecision(item)
            }
          }
        }
        const merged = Array.from(itemMap.values()).sort((a, b) => {
          const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
          return bTime - aTime;
        }).slice(0, MAX_GALLERY_ITEMS_IN_MEMORY);
        return areItemsStructurallyEqual(prev, merged) ? prev : merged;
      });
      setItemsLoading(false);
    }
  }, [p2pItems]);

  const loadGallery = useCallback(() => {
    if (!identity) return Promise.resolve();
    const currentP2pItems = p2pItemsRef.current || [];
    const currentSettings = settingsRef.current;

    return Promise.all([
      orbitFetch('/api/inbox', {}, identity).then(r => r.ok ? r.json() : []).catch(() => []),
      getAllObjects().catch(() => []),
    ]).then(([inboxItems, dbObjects]) => {
      if (!Array.isArray(inboxItems)) inboxItems = [];
      const itemMap = new Map<string, OrbitObject>();

      // 1. Add server inbox items
      for (const item of inboxItems) {
        itemMap.set(item.id, item);
      }

      // 2. Add IndexedDB objects (blob URLs recovered from the raw bytes).
      // Flag discipline: mirror rows may predate flag storage, so rebuild via
      // buildMirrorRow — server (inbox) flags win, explicit mirror flags apply,
      // and unknown rows stay flag-less so card surfaces exclude them instead
      // of phantom-minting uploads into cards.
      for (const dbObj of dbObjects) {
        if (dbObj.id.startsWith('p2p-obj-') && !canonicalCards.some(c => c.mediaObjectId === dbObj.id)) {
          void deleteObject(dbObj.id);
          continue;
        }
        const contentUrl = localObjectBlobUrl(dbObj.id, dbObj.data, dbObj.mime_type)
        const prev = itemMap.get(dbObj.id)
        itemMap.set(dbObj.id, buildMirrorRow(dbObj, prev, contentUrl,
          dbObj.owner_id === identity.orbitId
            ? (myProfile.displayName || 'You')
            : (prev?.display_name || usersRef.current.find((u) => u.id === dbObj.owner_id)?.display_name?.trim() || generateFallbackName(dbObj.owner_id))))
      }

      // 3. Add p2pItems from memory safely
      if (currentP2pItems.length > 0) {
        for (const item of currentP2pItems) {
          const existing = itemMap.get(item.id);
          if (!existing) {
            itemMap.set(item.id, item);
          } else if (item.content_url && !existing.content_url) {
            itemMap.set(item.id, { ...existing, content_url: item.content_url });
          }
        }
      }

      const payloadList = Array.from(itemMap.values()).sort((a, b) => {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bTime - aTime;
      });

      // Server-inbox items join the decision game the same way p2p items do (F-U7)
      const toEnqueue = enqueueableItems(payloadList, decisionMapRef.current, identity.orbitId, notifiedIdsRef.current);
      for (const item of toEnqueue) {
        notifiedIdsRef.current.add(item.id);
        enqueueDecision(item);
      }

      setItems(prev => areItemsStructurallyEqual(prev, payloadList) ? prev : payloadList);
      setItemsLoading(false);

      if (previousCountRef.current > 0 && payloadList.length > previousCountRef.current) {
        const newest = payloadList[0];
        if (newest && newest.owner_id !== identity.orbitId) {
          const alreadyNotified = notifiedIdsRef.current.has(newest.id)
          if (!alreadyNotified) {
            if (currentSettings.soundEffects) {
              try { playChime(); } catch { }
            }
            if (currentSettings.autoOpenImages && typeof document !== 'undefined' && document.hidden) {
              // Only auto-open when the user is away at arrival so it never
              // hijacks active navigation; the toast still fires either way.
              setExpandedItemId(newest.id);
            }
            const currentUsers = usersRef.current;
            const sender = currentUsers.find(u => u.id === newest.owner_id);
            const senderName = sender?.display_name?.trim() || 'Unknown User';
            toast(`${senderName} sent you an image`, 'info');
          }
        }
      }
      previousCountRef.current = payloadList.length;

      // Check for remote wallpaper updates if enabled in settings
      if (currentSettings.allowRemoteWallpaper && payloadList.length > 0) {
        const wallpaperItem = payloadList.find(i => i.owner_id !== identity?.orbitId && (i.mime_type === 'image/wallpaper' || (i as { is_wallpaper?: boolean }).is_wallpaper));
        if (wallpaperItem) {
          const itemUrl = wallpaperItem.content_url || `/api/objects/${wallpaperItem.id}`;
          if (itemUrl !== currentSettings.wallpaperUrl) {
            updateSettings('wallpaperUrl', itemUrl);
            updateSettings('wallpaperPreset', 'remote');
            updateSettings('wallpaperSlideshow', false);
            updateSettings('wallpaperMime', wallpaperItem.mime_type === 'image/wallpaper' ? 'image/jpeg' : (wallpaperItem.mime_type || 'image/jpeg'));
          }
        }
      }
    })
      .catch((err) => {
        logger.warn('Error 477a', err);
        const payloadList = p2pItemsRef.current || [];
        setItems(prev => areItemsStructurallyEqual(prev, payloadList) ? prev : payloadList);
        setItemsLoading(false);
      });
  }, [identity, updateSettings, toast, enqueueDecision, myProfile.displayName]);

  const legacyBackfill = useLegacyBackfill(identity, toast, loadGallery);

  const loadStories = useCallback(() => {
    if (!identity) return Promise.resolve()
    const requestId = ++storiesRequestRef.current
    const requestIdentity = identity.orbitId
    setStoriesLoading(true)
    return orbitFetch('/api/objects/stories', {}, identity)
      .then(async res => {
        if (!res.ok) throw new Error(await res.text())
        return res.json()
      })
      .then((data: OrbitObject[]) => {
        if (requestId !== storiesRequestRef.current || requestIdentity !== identity.orbitId) return
         const list = Array.isArray(data) ? data : []
         setStories(list)
        try {
          // Cap matches the server's own 200-row ceiling (routes/objects.ts),
          // so a warm boot can render the whole tray while we revalidate.
          localStorage.setItem('orbit_cached_stories', JSON.stringify(list.slice(0, 200)))
        } catch {}
      })
      .catch(err => {
        logger.error(err)
      })
      .finally(() => setStoriesLoading(false))
  }, [identity, users])

  const loadCards = useCallback(() => {
    if (!identity) return Promise.resolve()
    return orbitFetch('/api/cards', {}, identity)
      .then(async res => {
        if (!res.ok) throw new Error(await res.text())
        return res.json()
      })
      .then((data: { cards?: CanonicalCard[] }) => {
        const list = Array.isArray(data?.cards) ? data.cards : []
        setCanonicalCards(prev => (prev.length === list.length && prev.every((c, i) => c.id === list[i].id && c.updatedAt === list[i].updatedAt) ? prev : list))
      })
      .catch((err) => {
        logger.warn('Error 478a', err)
      })
  }, [identity])

  useEffect(() => {
    const onCardsRefresh = () => {
      loadCards();
      loadGallery();
    };
    window.addEventListener('orbit-cards-refresh', onCardsRefresh);
    return () => window.removeEventListener('orbit-cards-refresh', onCardsRefresh);
  }, [loadCards, loadGallery]);

  // Local vault backfill (opt-in): pin gallery keeps + card media to disk in
  // the background whenever the vault is on. Session-idempotent — only new
  // URLs hit the network; lookups never write.
  const idleGallery = useIdleGame((s) => s.gallery);
  // Clicker layout pill lives on the bar (was a toolbar row in GoonPanel).
  const idleViewMode = useIdleGame((s) => s.viewMode);
  const setIdleViewMode = useIdleGame((s) => s.setViewMode);
  useEffect(() => {
    if (!settings.localVault) return;
    const urls = new Set<string>();
    // Prioritize newest keepsakes first so recently collected images pin immediately
    for (let i = idleGallery.length - 1; i >= 0; i--) {
      const g = idleGallery[i];
      if (g.url) urls.add(g.url);
    }
    for (const c of myCards) if (c.content_url) urls.add(c.content_url);
    // Feed media too: the backfill used to cover only gallery keeps + cards,
    // so feed posts (and their videos) were never pinned and stayed missing
    // from the vault. vaultPin is session-idempotent, so re-running on feed
    // updates costs nothing.
    // Resolve FIRST: feed media arrives as a relative /api/objects/<id>
    // (and lobby endpoints), so the old /^https?:/ test silently dropped
    // every server-hosted post — images and videos never reached the vault.
    // resolveMediaUrl turns those into absolute URLs; public objects
    // (is_public=1) are readable anonymously, which is what the vault
    // fetcher does. Direct http(s) URLs pass through unchanged.
    for (const p of feedPosts) {
      const u = resolveMediaUrl(p.url);
      if (/^https?:/i.test(u)) urls.add(u);
      for (const m of p.media || []) {
        const mu = resolveMediaUrl(m.url);
        if (/^https?:/i.test(mu)) urls.add(mu);
      }
    }
    // Stories & profile avatars too: ensure offline access
    for (const s of stories) {
      if (s.content_url) {
        const su = resolveMediaUrl(s.content_url);
        if (/^https?:/i.test(su)) urls.add(su);
      }
      if (s.pfp_url) {
        const pu = resolveMediaUrl(s.pfp_url);
        if (/^https?:/i.test(pu)) urls.add(pu);
      }
    }
    for (const u of users) {
      if (u.pfp_url) {
        const pu = resolveMediaUrl(u.pfp_url);
        if (/^https?:/i.test(pu)) urls.add(pu);
      }
    }
    if (urls.size === 0) return;
    void mapLimit([...urls], 3, (u) => vaultPin(u).then(() => undefined));
  }, [settings.localVault, idleGallery, myCards, feedPosts, stories, users]);

  // Story preload: warm the media for the stories the user is about to tap.
  // Opening the tray used to start a cold signed fetch + decrypt per story, so
  // the first tap always paid the full latency (and a 6s unavailability
  // watchdog could outlast a 5s story). prefetchObject runs the exact same
  // resolution + LRU path as a real mount and dedupes against it, so a
  // prefetched story costs nothing extra when it renders.
  useEffect(() => {
    if (!identity || stories.length === 0) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    // Only the head of the tray: these are the ones a tap can reach instantly.
    //
    // The key is subtle, because a story's media can live in three places:
    //  1. /api/objects/<id>  -> prefetch that (normalizeCardId maps it onto the
    //     same cache key the viewer uses, so the prefetch dedupes for real).
    //  2. a magnet:/urn: descriptor (zero-media P2P) or nothing at all -> the
    //     bytes are fetched BY s.id. Never by content_url: a magnet in a path
    //     is truncated at its `?`, so the node was asked for the id "magnet:",
    //     404'd, and the story died.
    //  3. an external http(s)/data: URL -> the viewer loads it directly and
    //     there is nothing to warm. Prefetching s.id here 404s on an object
    //     that never existed, and the 404 handler prunes the story row.
    const warm = stories
      .slice(0, STORY_PREFETCH_COUNT)
      .map((s) => {
        const url = s.content_url || '';
        if (/^(https?:|data:|blob:)/i.test(url)) return null;
        if (url.startsWith('/api/objects/')) return url;
        return s.id;
      })
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (warm.length === 0) return;
    // mapLimit paces the signed fetches so a 200-row tray cannot stampede the
    // node (nor blow the RAM tripwires in perf.spec.ts).
    void mapLimit(warm, STORY_PREFETCH_CONCURRENCY, async (target) => {
      prefetchObject(target, identity)
      // Yield so the concurrency cap is real work, not just N queued calls.
      await new Promise((r) => setTimeout(r, 0))
    });
  }, [identity, stories]);


  // Prune dead 404 content when notified
  useEffect(() => {
    const handle404 = (e: Event) => {
      const customEvent = e as CustomEvent<{ cardId?: string }>
      const id = customEvent.detail?.cardId
      if (!id) return
      // Only a real id can name a row we own. A descriptor (magnet/urn/URL)
      // compares unequal to every story/item id anyway, but it would still
      // fire a delete against a key that never existed.
      if (!isRequestableObjectId(id)) return
      setItems(prev => prev.filter(item => item.id !== id))
      setStories(prev => prev.filter(story => story.id !== id))
      deleteObject(id).catch(() => { })
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('orbit-object-404', handle404)
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('orbit-object-404', handle404)
      }
    }
  }, [])

  // Stories self-purge: prune expired stories from state so they vanish from the
  // UI even before the next server refetch (8h TTL).
  useEffect(() => {
    if (stories.length === 0) return
    const id = setInterval(() => {
      setStories(prev => {
        const pruned = prev.filter(s => {
          if (!s.expires_at) return true
          const exp = new Date(s.expires_at).getTime()
          return Number.isFinite(exp) && exp > Date.now()
        })
        return pruned.length === prev.length ? prev : pruned
      })
    }, 30000)
    return () => clearInterval(id)
  }, [stories.length])

  const handleAddStory = async (file: File) => {
    try {
      const { forgeMediaLocally } = await import('./services/mediaForge')
      const forged = await forgeMediaLocally(file, identity!, {
        isPublic: false,
        isStory: true,
      })
      if (!forged?.id) {
        toast('Story upload failed. Try again.', 'error')
        return
      }
      loadStories()
      setShowStoryModal(false)
      loadUsers()
      loadGallery()
    } catch (err) {
      logger.error(err)
      toast('Story upload failed. Try again.', 'error')
    }
  }

  // Share media (either from an API object or direct URL) to story or feed.
  const shareMediaAs = useCallback(async (media: { url: string; tags?: string[]; name?: string }, mode: 'story' | 'repost') => {
    if (!identity) return
    if (mode === 'repost') {
      openCreatePostWithMedia(media)
      return
    }
    try {
      let blob: Blob
      if (media.url.startsWith('data:')) {
        blob = dataUrlToBlob(media.url)
      } else {
        const res = media.url.startsWith('/api/')
          ? await orbitFetch(media.url, {}, identity)
          : await fetch(media.url)
        if (!res.ok) {
          toast('Could not load the image', 'error')
          return
        }
        blob = await res.blob()
      }
      const mime = blob.type || 'image/jpeg'
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : mime.includes('mp4') ? 'mp4' : 'jpg'
      await handleAddStory(new File([blob], `story_${Date.now()}.${ext}`, { type: mime }))
      toast('Added to your story', 'success')
    } catch {
      toast('Story upload failed', 'error')
    }
  }, [identity, toast, handleAddStory, openCreatePostWithMedia])

  // Gallery quick actions from the context menu: pull the object's bytes
  // once, then reuse the existing story/post upload paths.
  const shareObjectAs = useCallback((item: { id: string }, mode: 'story' | 'repost') => {
    if (mode === 'repost') {
      openCreatePostWithMedia({ url: `/api/objects/${item.id}`, tags: (item as any).tags })
      return
    }
    return shareMediaAs({ url: `/api/objects/${item.id}`, tags: (item as any).tags }, mode)
  }, [shareMediaAs, openCreatePostWithMedia])

  const fetchAnnouncements = useCallback(() => {
    if (!identity) return Promise.resolve()
    return orbitFetch('/api/announcements', {}, identity)
      .then(r => r.ok ? r.json() : [])
      .then((data: { id: string; message: string; created_at: string; created_by_name: string | null }[]) => {
        const list = Array.isArray(data) ? data : []
        setAnnouncements(prev => areAnnouncementsStructurallyEqual(prev, list) ? prev : list)
      })
      .catch(() => { })
  }, [identity])

  // Initial mount effect - show skeletons only once
  useEffect(() => {
    if (!identity) return
    let cancelled = false
    setItemsLoading(true)
      ; (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (cancelled) return
          try {
            await Promise.all([
              loadUsers().catch(() => { }),
              loadGallery().catch(() => { }),
              loadCards().catch(() => { }),
              loadStories().catch(() => { }),
              fetchAnnouncements().catch(() => { }),
              loadServerFeed().catch(() => { }),
              loadFollowing().catch(() => { }),
            ])
            return
          } catch {
            if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
          }
        }
      })()
    return () => { cancelled = true }
  }, [identity, loadUsers, loadGallery, loadCards, loadStories, fetchAnnouncements]);

  // Open shared-image links (`/?view=<id>`) in the lightbox once items load
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const viewId = params.get('view')
    if (!viewId) return
    let tries = 0
    const t = setInterval(() => {
      tries++
      if (items.some(i => i.id === viewId)) {
        clearInterval(t)
        setExpandedItemId(viewId)
      } else if (tries > 30) {
        clearInterval(t)
      }
    }, 300)
    return () => clearInterval(t)
  }, [items])

  // Event-driven & background sync effect
  useEffect(() => {
    if (!identity) return
    orbitFetch('/api/users/heartbeat', { method: 'POST' }, identity).catch(() => { })

    if (isWsConnected) {
      logger.log('[ORBIT Sync] WebSocket connected. Running silent background sync...')
      loadUsers()
      loadGallery()
      loadStories()
      fetchAnnouncements()
      loadServerFeed()
      loadFollowing()
    }

    const checkWebRTCOffers = async () => {
      try {
        const offers = await pollOffers(identity)
        // Only process the first 3 offers at a time to avoid RTCPeerConnection exhaustion
        const limited = offers.slice(0, 3)
        for (const offer of limited) {
          logger.log('[ORBIT WebRTC] Found pending WebRTC offer signal from:', offer.sender_id, 'Offer ID:', offer.id)
          const peer = new OrbitPeer()
          // Watchdog: close if no progress for 5 minutes
          let watchdog: ReturnType<typeof setTimeout> | null = setTimeout(() => {
            logger.warn('[ORBIT WebRTC] Transfer watchdog expired, closing peer', offer.id)
            peer.close()
          }, 300_000)
          const resetWatchdog = () => {
            if (watchdog) clearTimeout(watchdog)
            watchdog = setTimeout(() => {
              logger.warn('[ORBIT WebRTC] Transfer watchdog expired, closing peer', offer.id)
              peer.close()
            }, 300_000)
          }
          peer.onProgress = (received, total) => {
            resetWatchdog()
            const pct = total > 0 ? Math.round((received / total) * 100) : 0
            setTransferProgress(`Receiving via P2P: ${pct}%`)
          }
          peer.onComplete = async (blob, meta) => {
            if (watchdog) clearTimeout(watchdog)
            setTransferProgress(null)
            logger.log('[ORBIT WebRTC] WebRTC file transfer complete:', meta.name, 'Size:', meta.size_bytes)
            const buffer = await blob.arrayBuffer()
            const reader = new FileReader()
            reader.readAsDataURL(blob)
            reader.onloadend = () => {
              const dataUrl = reader.result as string
              const newItem: OrbitObject = {
                id: `p2p-wrtc-${Date.now()}`,
                owner_id: offer.sender_id,
                size_bytes: meta.size_bytes,
                mime_type: meta.mime_type || 'image/jpeg',
                created_at: new Date().toISOString(),
                content_url: dataUrl,
                display_name: usersRef.current.find((u) => u.id === offer.sender_id)?.display_name?.trim() || generateFallbackName(offer.sender_id),
                sender_pubkey: meta.sender_pubkey,
                sender_enc_pubkey: meta.sender_enc_pubkey,
              }
              saveObject({
                id: newItem.id,
                name: meta.name,
                mime_type: meta.mime_type,
                size_bytes: meta.size_bytes,
                owner_id: offer.sender_id,
                sender_pubkey: meta.sender_pubkey,
                sender_enc_pubkey: meta.sender_enc_pubkey,
                created_at: newItem.created_at,
                data: buffer,
                is_public: 0,
                is_story: 0,
                is_chat: 0,
              }).catch(() => {
                toast('Failed to save to local storage', 'error')
              })

              setItems(prev => [newItem, ...prev])
              try { playChime() } catch { }
              const currentUsers = usersRef.current;
              const wrtcSender = currentUsers.find(u => u.id === offer.sender_id);
              const wrtcName = wrtcSender?.display_name?.trim() || 'Unknown User';
              toast(`${wrtcName} sent you an image (P2P)`, 'info')
              peer.close()
            }
          }
          peer.onError = (err) => {
            if (watchdog) clearTimeout(watchdog)
            logger.warn('[ORBIT WebRTC] Peer error, closing:', err)
            peer.close()
          }
          try {
            await peer.acceptOffer(offer.id, identity)
          } catch (err) {
            if (watchdog) clearTimeout(watchdog)
            logger.warn('[ORBIT WebRTC] Failed to accept offer:', err)
            peer.close()
          }
        }
      } catch { }
    }

    const syncIntervalMs = isWsConnected ? 120_000 : 60_000
    const heartbeatIntervalMs = isWsConnected ? 30_000 : 10_000
    // Skip DB-heavy pollers while the tab is hidden; timers are also throttled
    // by the browser, so this removes the remaining background read load.
    const pageHidden = () => document.visibilityState === 'hidden'

    const heartbeatInt = setInterval(() => {
      if (pageHidden()) return
      orbitFetch('/api/users/heartbeat', { method: 'POST' }, identity).catch(() => { })
    }, heartbeatIntervalMs)

    const syncInt = setInterval(() => {
      if (pageHidden()) return
      loadUsers()
      loadGallery()
      loadStories()
      fetchAnnouncements()
      loadServerFeed()
      loadFollowing()
    }, syncIntervalMs)

    const offersInt = setInterval(() => {
      if (pageHidden()) return
      checkWebRTCOffers()
    }, isWsConnected ? 60_000 : 15_000)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Foreground burst: the heartbeat interval skips while hidden, so
        // announce immediately instead of sitting ghost-offline. loadUsers
        // follows to pick up who left/joined while away.
        orbitFetch('/api/users/heartbeat', { method: 'POST' }, identity).catch(() => { })
        loadUsers()
        loadGallery()
        loadStories()
        fetchAnnouncements()
        loadServerFeed()
        loadFollowing()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(heartbeatInt)
      clearInterval(syncInt)
      clearInterval(offersInt)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [identity, isWsConnected, loadUsers, loadGallery, loadStories, fetchAnnouncements, loadServerFeed, loadFollowing, toast])

  const visibleUsers = useMemo(() => {
    return users.filter(u => !blockedIds.includes(u.id))
  }, [users, blockedIds])

  // Single source of truth for the player count shown in the Header, the
  // Players Sidebar badge, and the floating right-edge trigger. Strict
  // `u.online` only — the API sets this to true when last_seen is within
  // 60s (apps/api/src/routes/users.ts:120). Drop the prior 15-min fallback
  // so the count never lists stale/idle users as "online".
  

  // Current node name for the Servers sidebar group. The API always answers
  // /api/servers/dashboard from whichever node this client is attached to.
  const [,setServerName] = useState('gmatch')
  useEffect(() => {
    if (!identity) return
    let alive = true
    orbitFetch('/api/servers/dashboard', { method: 'GET' }, identity)
      .then(async (res) => (res.ok ? res.json() : null))
      .then((d: any) => {
        if (alive && typeof d?.name === 'string' && d.name.trim()) setServerName(d.name.trim())
      })
      .catch(() => {})
    return () => { alive = false }
  }, [identity])

  // Hold Space to fade the interface while keeping the wallpaper visible.
  // Editable controls keep their native spacebar behavior.
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      return target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || target.isContentEditable
    }

    const clearDimmedState = () => setSpaceUiDimmed(false)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || isEditableTarget(event.target)) return
      event.preventDefault()
      setSpaceUiDimmed(true)
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') clearDimmedState()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', clearDimmedState)
    document.addEventListener('visibilitychange', clearDimmedState)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', clearDimmedState)
      document.removeEventListener('visibilitychange', clearDimmedState)
    }
  }, [])

  const selectRandomUser = useCallback(() => {
    const candidates = visibleUsers.filter(u => !blockedIds.includes(u.id))
    if (candidates.length === 0) return
    const pick = candidates[Math.floor(Math.random() * candidates.length)]
    setSelectedIds(new Set([pick.id]))
    toast(`Selected ${pick.display_name?.trim() || 'Unknown User'}`, 'info')
  }, [visibleUsers, blockedIds])

  useKeyboardShortcuts({
    '?': () => setShowHelpModal(prev => !prev),
    'g': () => {
      const el = document.getElementById('gallery-section') || document.getElementById('workspace-gallery')
      el?.scrollIntoView({ behavior: 'smooth' })
    },
    'u': () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('orbit-focus-user-search'))
      }
    },
    'r': () => { setItemsLoading(true); loadGallery(); toast('Refreshed gallery', 'info') },
    'n': selectRandomUser,
    'Ctrl+R': () => { setItemsLoading(true); loadGallery(); toast('Refreshed gallery', 'info') },
    'Ctrl+H': () => setShowHelpModal(prev => !prev),
    'Ctrl+Shift+C': () => {
      if (identity) {
        navigator.clipboard.writeText(identity.orbitId)
        toast('GMatch ID copied to clipboard', 'info')
      }
    },
  });

  const ITEMS_PER_PAGE = 18

  const filteredItems = useMemo(() => {
    // Canonical membership once (Phase 1): the cards grid renders MINTED
    // media only — unminted rows never reach the collection count or tiles.
    const canonicalMediaIds = new Set(canonicalCards.map((c) => c.mediaObjectId))
    const rawList = items.filter(item => galleryItemVisible(item, {
      canonicalMediaIds,
      blockedIds,
      galleryFilter,
      identityOrbitId: identity?.orbitId,
    }))

    const q = cardSearch.trim().toLowerCase()
    const typeFiltered = rawList.filter((item) => {
      if (cardTypeFilter === 'image') return !(item.mime_type || '').startsWith('video/')
      if (cardTypeFilter === 'video') return (item.mime_type || '').startsWith('video/')
      return true
    })
    const searchFiltered = q
      ? typeFiltered.filter((item) => {
        const caption = ((item as any).caption || '').toLowerCase()
        const name = ((item as any).name || '').toLowerCase()
        const id = (item.id || '').toLowerCase()
        return caption.includes(q) || name.includes(q) || id.includes(q)
      })
      : typeFiltered

    const seen = new Set<string>()
    const deduped = searchFiltered.filter(item => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })

    const canonicalMap = new Map<string, CanonicalCard>()
    for (const c of canonicalCards) {
      canonicalMap.set(c.mediaObjectId, c)
    }

    const mapped = deduped.map((item: any) => applyCanonicalCard(item, canonicalMap.get(item.id)))

    return mapped.sort((a: any, b: any) => {
      if (gallerySort === 'oldest') {
        return (new Date(a.created_at || 0).getTime()) - (new Date(b.created_at || 0).getTime())
      }
      if (gallerySort === 'likes') {
        return (Number(b.likes_count || 0)) - (Number(a.likes_count || 0))
      }
      if (gallerySort === 'score') {
        const v = (x: any) => Math.max(0, x.value ?? x.score ?? x.gacha_downloads_count ?? 0)
        return v(b) - v(a)
      }
      return (new Date(b.created_at || 0).getTime()) - (new Date(a.created_at || 0).getTime())
    })
  }, [items, canonicalCards, galleryFilter, gallerySort, cardSearch, cardTypeFilter, identity?.orbitId, blockedIds])

  const allViewerItems = useMemo(() => {
    const map = new Map<string, OrbitObject>()
    for (const item of items) {
      if (item?.id) map.set(item.id, item)
    }
    for (const story of stories) {
      if (story?.id) map.set(story.id, story)
    }
    for (const img of lobby.images) {
      if (!img?.id || !img.content_url) continue
      map.set(img.id, {
        id: img.id,
        owner_id: img.owner_id,
        size_bytes: 0,
        mime_type: img.mime_type || 'image/jpeg',
        created_at: img.created_at,
        caption: img.caption,
        content_url: img.content_url,
        display_name: img.owner_id === identity?.orbitId
          ? (myProfile.displayName || 'You')
          : (users.find((u) => u.id === img.owner_id)?.display_name?.trim() || 'Unknown User'),
        expires_at: img.expires_at,
      } as OrbitObject)
    }
    return Array.from(map.values())
  }, [items, stories, lobby.images, users, identity?.orbitId, myProfile.displayName])

  const myUser = useMemo(() => {
    return users.find(u => u.id === identity?.orbitId)
  }, [users, identity?.orbitId])

  // Buy-me-a-coffee gate: accumulate in-match playtime locally + read the
  // server matchesTotal. Trigger when playtime ≥ 60min OR matches ≥ 12, with
  // a 30-day quiet period after "Maybe later" and a permanent suppression
  // after "Never ask again". The popup is fflushed to a single dismiss per
  // session via the gate's sessionRef so a moving target doesn't re-pop it.
  const inMatch = Boolean(lobby.state?.match)
  const matchesTotal = myUser?.matches_total ?? 0
  const { playtimeMs } = usePlaytime({ inMatch, matchesTotal, identityId: identity?.orbitId ?? null })
  const { showCoffee, triggerReason, dismiss: dismissCoffee } = useCoffeeGate(playtimeMs, matchesTotal)
  const [manualCoffeeOpen, setManualCoffeeOpen] = useState(false)

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE))
  const paginatedItems = useMemo(() => {
    return filteredItems.slice(galleryPage * ITEMS_PER_PAGE, (galleryPage + 1) * ITEMS_PER_PAGE)
  }, [filteredItems, galleryPage])

  useEffect(() => {
    setGalleryPage(0)
  }, [galleryFilter])

  

  

  

  const handleBatchDownload = async () => {
    if (selectedGalleryIds.size === 0) return
    const targets = items.filter(i => selectedGalleryIds.has(i.id))
    toast(`Downloading ${targets.length} items…`, 'info')
    for (const item of targets) {
      try {
        const res = await orbitFetch(`/api/objects/${item.id}`, {}, identity!)
        if (res.ok) {
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${item.id.substring(0, 8)}.jpg`
          a.click()
          URL.revokeObjectURL(url)
        }
      } catch { }
    }
  }

  const handleDownloadAll = async () => {
    if (filteredItems.length === 0 || !identity) return
    setBatchDownloading(true)
    toast(`Starting download of ${filteredItems.length} cards…`, 'info')
    let count = 0
    for (const item of filteredItems) {
      try {
        const res = await orbitFetch(`/api/objects/${item.id}`, {}, identity)
        if (res.ok) {
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `card_${item.id.substring(0, 8)}.jpg`
          a.click()
          URL.revokeObjectURL(url)
          count++
        }
      } catch { }
    }
    setBatchDownloading(false)
    toast(`Downloaded ${count} cards.`, 'success')
  }

  const toggleFavorite = useCallback(async (item: OrbitObject) => {
    if (!identity) return false
    const res = await orbitFetch(`/api/inbox/${item.id}/favorite`, { method: 'POST' }, identity)
    if (!res.ok) return false
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_favorited: i.is_favorited === 1 ? 0 : 1 } : i))
    return true
  }, [identity])

  

  const handleBatchDelete = async () => {
    if (selectedGalleryIds.size === 0) return
    const targets = items.filter(i => selectedGalleryIds.has(i.id))
    if (targets.length === 0) return
    const owned = targets.filter(i => i.owner_id === identity?.orbitId)
    const received = targets.filter(i => i.owner_id !== identity?.orbitId)
    let msg = ''
    if (owned.length > 0 && received.length > 0) msg = `Delete ${owned.length} owned permanently and remove ${received.length} received from inbox?`
    else if (owned.length > 0) msg = `Delete ${owned.length} owned items permanently?`
    else msg = `Remove ${received.length} received items from your inbox?`
    if (!await confirm({
      title: "Confirm bulk delete",
      description: msg,
      confirmLabel: "Delete",
      tone: "danger",
    })) return
    let count = 0
    for (const item of owned) {
      try { await orbitFetch(`/api/objects/${item.id}`, { method: 'DELETE' }, identity!); count++ } catch { }
    }
    for (const item of received) {
      try { await orbitFetch(`/api/inbox/${item.id}/remove`, { method: 'POST' }, identity!); count++ } catch { }
    }
    setSelectedGalleryIds(new Set())
    toast(`Removed ${count} item(s)`, 'success')
    loadGallery()
  }

  

  const handleDelete = useCallback(async (item: OrbitObject) => {
    if (!await confirm({
      title: "Delete this payload permanently?",
      description: "The blob and any recipient entries will be removed. This cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    })) return
    if (!identity) return
    try {
      await deleteObject(item.id).catch(() => {});
      await orbitFetch(`/api/objects/${item.id}`, { method: 'DELETE' }, identity).catch(() => null);
      setItems(prev => prev.filter(i => i.id !== item.id))
      toast('Card deleted', 'success')
      loadGallery()
    } catch (err) {
      logger.error('Delete failed', err)
      toast('Failed to delete card', 'error')
    }
  }, [identity, toast, loadGallery])

  if (!isLoaded) return <PageSkeleton />;

  const myPostTags = identity ? deriveProfileTags(serverPosts.filter(p => p.author_id === identity.orbitId), []) : []

  return (
    <main id="main-content" className="h-[100dvh] max-h-[100dvh] min-h-0 w-full flex flex-col items-center justify-start relative overflow-hidden" style={{ background: 'var(--color-retro-bg)' }}>
      <WallpaperBackground
        wallpaperBg={wallpaperBg}
        wallpaperFit={settings.wallpaperFit}
        wallpaperMime={settings.wallpaperMime}
        hideUiForWallpaper={hideUiForWallpaper}
        onRestore={() => setHideUiForWallpaper(false)}
      />

      <OfflineWarningBanner identity={identity} />

      {identity && tourState.status === 'active' && tourState.index > 0 && isOnboardingComplete(readOnboardingState(identity.orbitId)) && (
        <TourDock
          steps={TOUR_STEPS}
          state={tourState}
          onNext={() => advanceTour(1)}
          onBack={() => advanceTour(-1)}
          onSkip={skipTour}
        />
      )}

      <div className={hideUiForWallpaper ? "opacity-0 pointer-events-none transition-opacity duration-150 w-full h-full min-h-0 flex flex-col items-center" : spaceUiDimmed ? "opacity-[0.15] pointer-events-none transition-opacity duration-150 w-full h-full min-h-0 flex flex-col items-center" : "transition-opacity duration-150 w-full h-full min-h-0 flex flex-col items-center"}>
        {!identity ? (
          <ErrorBoundary>
            <OnboardingFlow
              identity={null}
              initialProfile={myProfile}
              ensureIdentity={() => createIdentity()}
              onOpenTos={() => { setLegalDoc('terms'); setShowTosModal(true) }}
              tagSuggestions={myPostTags}
              toast={toast}
              onLogin={async (name, tags, customKey, pfpUrl) => {
                if (!customKey) throw new Error('Missing secret key');
                const res = loginWithExportedId(customKey);
                if (!res.success) throw new Error(res.error || 'Invalid secret key');
                if (typeof window !== 'undefined') {
                  const storedDisplayName = localStorage.getItem('orbit_display_name');
                  const effectiveName = (name && name.trim()) ? name.trim() : (storedDisplayName || '');
                  if (effectiveName) localStorage.setItem('orbit_display_name', effectiveName);
                  if (tags) localStorage.setItem('orbit_tags', JSON.stringify(tags.split(',').map(t => t.trim()).filter(Boolean)));
                  if (pfpUrl && res.identity?.orbitId) {
                    const targetId = res.identity.orbitId;
                    setProfilePics((prev) => {
                      const next = { ...prev, [targetId]: pfpUrl };
                      try { setSecureItem('goonmatch_pfps', JSON.stringify(next)) } catch { }
                      return next;
                    });
                    try { setSecureItem('orbit_pfp_url', pfpUrl) } catch { }
                    try { localStorage.setItem('orbit_pfp_url', pfpUrl); } catch { }
                    // Also sync to server
                    await saveUserProfile(res.identity, { pfp_url: pfpUrl }).catch(() => { });
                  }
                  setMyProfile({ displayName: effectiveName, tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [], isAdmin: false, pfpUrl: pfpUrl || '' });
                }
                toast('Logged in.', 'success');
                loadUsers();
                loadGallery();
              }}
              onCreateAccount={async (name, tags, pfpUrl) => {
                const newId = await createIdentity();
                if (typeof window !== 'undefined') {
                  localStorage.setItem('orbit_display_name', name);
                  if (tags) localStorage.setItem('orbit_tags', JSON.stringify(tags.split(',').map(t => t.trim()).filter(Boolean)));
                  if (pfpUrl && newId?.orbitId) {
                    const targetId = newId.orbitId;
                    setProfilePics((prev) => {
                      const next = { ...prev, [targetId]: pfpUrl };
                      try { setSecureItem('goonmatch_pfps', JSON.stringify(next)) } catch { }
                      return next;
                    });
                    try { setSecureItem('orbit_pfp_url', pfpUrl) } catch { }
                    try { localStorage.setItem('orbit_pfp_url', pfpUrl); } catch { }
                  }
                  setMyProfile({ displayName: name, tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [], isAdmin: false, pfpUrl: pfpUrl || '' });
                }
                if (newId) {
                  await saveUserProfile(
                    newId,
                    {
                      display_name: name,
                      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
                      bio: '',
                      pfp_url: pfpUrl || undefined,
                    },
                  );
                }
                toast('You are in.', 'success');
                loadUsers();
                loadGallery();
              }}
              onProfileUpdated={(profile) => {
                setMyProfile((prev) => ({ ...prev, displayName: profile.displayName, tags: profile.tags, pfpUrl: profile.pfpUrl || prev.pfpUrl }));
              }}
              onComplete={() => {
                toast('Account ready.', 'success');
              }}
            />
          </ErrorBoundary>
        ) : (
          <ErrorBoundary>
            <div className="app-glass relative z-10 w-full h-full min-h-0 bg-transparent text-retro-fg shadow-2xl flex flex-col overflow-hidden">
              <NativeHeaderBar />
              <div className="flex-1 min-w-0 min-h-0 flex flex-row overflow-hidden relative">

                {/* Notifications dock: LEFT side panel sibling (mirrors chat) */}
                <MessagesRail open={notifOpen} side="left" widthClass="w-[min(420px,32vw)]">
                  <div className="solid-panel w-full h-full min-h-0 flex flex-col overflow-hidden rounded-xl">
                    <NotificationsPanel
                      embedded
                      notifications={lobby.notifications}
                      unreadCount={lobby.unreadCount}
                      unreadByType={lobby.unreadByType}
                      invites={lobby.invites}
                      onMarkAllRead={() => lobby.markNotificationsRead()}
                      onMarkRead={(ids) => { void lobby.markNotificationsRead(ids); }}
                      onOpenTarget={handleOpenNotificationTarget}
                      onRespondInvite={(id, accept) => lobby.respondToInvite(id, accept)}
                      onRespondBabecock={handleRespondBabecock}
                      onOpenBabecock={() => { setNotifOpen(false); setGamesSubTab('babecock'); setMainView('games'); }}
                      onClose={() => setNotifOpen(false)}
                    />
                  </div>
                  </MessagesRail>

                  <div ref={mainScrollRef} className="mobile-app-scroll flex-1 min-w-0 min-h-0 w-full flex flex-col relative z-10 overflow-y-auto styled-scrollbar pb-24">
                    <h1 className="sr-only">{`gMatch - ${typeof mainView === 'string' ? mainView.charAt(0).toUpperCase() + mainView.slice(1) : 'Home'}`}</h1>

                  {/* Modals & Config */}
                  {isIdle && settings.idleEnabled && (
                    <IdleOverlay items={items} identity={identity} onExit={() => { }} />
                  )}

                  {mainView !== 'game' && showPasskeys && (
                    <div className="max-w-md">
                      <PasskeyManager identity={identity} />
                    </div>
                  )}

                  {mainView !== 'game' && transferProgress && (
                    <div className="bg-retro-panel border border-retro-warning p-3 text-center text-xs text-retro-warning flex items-center justify-center gap-2">
                      <span className="w-2 h-2 bg-retro-warning flex-shrink-0" />
                      {transferProgress}
                    </div>
                  )}

                  {legacyBackfill.isSyncing && (
                    <div className="mx-auto my-2 max-w-lg px-4 py-2 rounded-full bg-surface-canvas/90 backdrop-blur-md border border-cyan-500/40 text-cyan-200 text-xs flex items-center justify-between gap-3 shadow-lg z-30">
                      <div className="flex items-center gap-2 truncate">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse flex-shrink-0" />
                        <span className="font-mono text-[11px] truncate">
                          {legacyBackfill.progress.message || 'Backfilling legacy posts from gmatch.fly.dev...'}
                        </span>
                      </div>
                      {legacyBackfill.progress.total > 0 && (
                        <span className="text-[10px] text-cyan-300 font-mono whitespace-nowrap bg-cyan-950/60 px-2 py-0.5 rounded-full border border-cyan-500/30">
                          {legacyBackfill.progress.current}/{legacyBackfill.progress.total}
                        </span>
                      )}
                    </div>
                  )}

                  {/* gMatch Main Feed View */}
                  {mainView === 'feed' && identity && tourState.status === 'active' && tourState.index === 0 && isOnboardingComplete(readOnboardingState(identity.orbitId)) && (
                    <TourDeck
                      steps={TOUR_STEPS}
                      onOpen={(step) => goToTourStep(step.id)}
                      onDismiss={skipTour}
                    />
                  )}
                  {mainView === 'feed' && (
                    <div className={isVisionJammed ? "relative" : ""}>
                      {isVisionJammed && (
                        <div className="mb-3 p-3 bg-red-950/90 border border-red-500/50 rounded-xl text-center text-xs font-bold text-red-200 uppercase tracking-wider flex items-center justify-center gap-2">
                          <span>Your images are blurred &mdash; someone paid for a vision jam. It expires shortly.</span>
                        </div>
                      )}
                      <div className={isVisionJammed ? "blur-md select-none pointer-events-none transition-all duration-300" : ""}>
                        <div className="w-full max-w-5xl mx-auto px-3 sm:px-4 pt-3 sm:pt-4 flex flex-col gap-4 pb-24 lg:pb-16">
                          {/* ── Feed ── */}
                          <section className="module module-primary module-glass overflow-visible order-1">
                            {collapsedModules.feed && (
                              <div className="module-header flex items-center justify-between sticky top-0 z-20">
                                <span className="module-title">Timeline</span>
                                <button
                                  type="button"
                                  onClick={() => toggleModule('feed')}
                                  aria-label="Expand Timeline"
                                  className="p-1.5 rounded-lg text-retro-muted hover:text-retro-fg hover:bg-surface-interactive transition-colors cursor-pointer"
                                >
                                  <ChevronRight className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                            {!collapsedModules.feed && (
                              <GMatchFeed
                                identity={identity}
                                posts={feedPosts}
                                stories={stories}
                                storiesLoading={storiesLoading}
                                followingIds={followingIds}
                                profilePics={profilePics}
                                onSendDm={sendPm}
                                onAddStory={() => setShowStoryModal(true)}
                                onOpenStory={(userId) => {
                                  setExpandedItemId(null);
                                  setMainView('feed');
                                  setStoryViewerUserId(userId);
                                }}
                                activeStoryUserId={storyViewerUserId}
                                onActiveStoryClose={() => setStoryViewerUserId(null)}
                                onOpenPostCreator={() => setShowCreatePostModal(true)}
                                shareGroups={chatGroups.map((g) => ({ id: g.id, name: g.name, member_count: g.member_count }))}
                                onFollowSuggestion={(id) => { void toggleFollowUser(id); }}
                                myProfileTags={myProfile.tags}
                                onSelectUser={(uId) => {
                                  const target = users.find((u) => u.id === uId);
                                  if (target) {
                                    setSelectedProfileUser(target);
                                    return;
                                  }
                                  // Same silent no-op GamesView had: the roster
                                  // is capped (100 rows server-side) and a fresh
                                  // peer may not be in it yet, so clicking a post
                                  // author's avatar did NOTHING. Fetch the row.
                                  if (!identity) return;
                                  void orbitFetch(`/api/users/${encodeURIComponent(uId)}`, {}, identity)
                                    .then((res) => (res.ok ? res.json() : null))
                                    .then((data) => {
                                      if (data?.user?.id) setSelectedProfileUser(data.user as User);
                                    })
                                    .catch(() => { });
                                }}
                                users={users}
                                onStartPm={(user) => {
                                  const target = users.find((u) => u.id === user.id || (u as any).orbitId === user.id);
                                  setPmPeer(target || ({ id: user.id, display_name: user.display_name } as User));
                                  handleSetMainView('messages');
                                }}
                                onOpenGameAd={(mode) => {
                                  if (mode === 'coffee') {
                                    setManualCoffeeOpen(true);
                                  } else if (mode === 'store') {
                                    handleSetMainView('store');
                                  } else if (mode !== 'discord') {
                                    setGamesSubTab(mode);
                                    setMainView('games');
                                  }
                                }}
                                onPersistLike={persistLike}
                                onPersistSave={persistSave}
                                onPersistComment={persistComment}
                                onPersistReport={persistReport}
                                onReportComment={(commentId) => reportTarget('post_comment', commentId)}
                                onPublishPost={publishPost}
                                onForceRefresh={forceRefreshFeed}
                                apiNodeLabel={apiNodeLabel}
                                onDeletePostApi={deletePostOnServer}
                                unreadCount={lobby.unreadCount}
                                onRefreshNotifications={() => lobby.refreshNotifications()}
                                onOpenNotifications={openNotifications}
                                onOpenNetwork={(userId) => openUserNetwork(userId)}
                                onUserContext={(e, userId, displayName) => {
                                  const u = users.find((x) => x.id === userId)
                                  openContextMenu('user', u || { id: userId, display_name: displayName })(e)
                                }}
                                onArchivePost={async (id) => {
                                  if (!identity) return
                                  try {
                                    const res = await orbitFetch(`/api/objects/${id}/archive`, { method: 'POST' }, identity)
                                    if (!res.ok) throw new Error(String(res.status))
                                    const { is_archived } = await res.json()
                                    setArchivedPostIds((prev) => {
                                      const next = new Set(prev)
                                      if (is_archived) next.add(id); else next.delete(id)
                                      return next
                                    })
                                    toast(is_archived ? 'Post archived' : 'Post unarchived', 'info')
                                  } catch {
                                    toast('Archive failed. Try again.', 'error')
                                  }
                                }}
                                onDeletePost={(id) => {
                                  setDeletedPostIds((prev) => new Set(prev).add(id));
                                  deletePostOnServer(id);
                                  toast('Post deleted', 'success');
                                }}
                                onRepostPost={(post) => {
                                  setRepostedPosts((prev) => [
                                    {
                                      ...post,
                                      id: `repost_${post.id}_${Date.now()}`,
                                      is_reposted: true,
                                      reposted_by: myProfile.displayName || 'You',
                                    },
                                    ...prev,
                                  ]);
                                }}
                                onLoadMore={loadMoreFeedPosts}
                                isLoadingMore={isLoadingMoreFeed}
                                hasMore={hasMoreFeed}
                                feedSort={feedSort}
                                onFeedSortChange={(mode) => {
                                  setFeedSort(mode);
                                  loadServerFeed();
                                }}
                                feedCols={settings.feedCols}
                                onFeedColsChange={(cols) => updateSettings('feedCols', cols)}
                                toast={toast}
                              />
                            )}
                          </section>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* gMatch Direct Messages View: the desktop inline page is
                      the unified rooms chat (block above); the minimized
                      bubble remains for the mobile drawer path. */}
                  {mainView === 'messages' && !chatOpen && dmMinimized && (
                    <DmMinimizedView pmPeer={pmPeer} profilePics={profilePics} />
                  )}

                  {/* gMatch Profile View */}
                  {mainView === 'profile' && (
                    <ProfileView
                      identity={identity}
                      myUser={myUser}
                      profilePics={profilePics}
                      feedPosts={feedPosts}
                      myCards={myCards}
                      repostedPosts={repostedPosts}
                      followingIds={followingIds}
                      myProfile={myProfile}
                      toast={toast}
                      setShowSettingsModal={setShowSettingsModal}
                      setFollowersModalState={setFollowersModalState}
                      setExpandedItemId={setExpandedItemId}
                      setMyProfile={setMyProfile}
                      setProfilePics={setProfilePics}
                      loadUsers={loadUsers}
                      setArchivedPostIds={setArchivedPostIds}
                      setDeletedPostIds={setDeletedPostIds}
                      deletePostOnServer={deletePostOnServer}
                      users={users}
                      onSendDm={sendPm}
                      onPersistLike={persistLike}
                      onPersistSave={persistSave}
                      onPersistComment={persistComment}
                      onSelectUser={(uId) => {
                        const target = users.find((u) => u.id === uId || (u as any).orbitId === uId);
                        if (target) setSelectedProfileUser(target);
                      }}
                      onOpenNetwork={(userId) => openUserNetwork(userId)}
                      shareGroups={chatGroups.map((g) => ({ id: g.id, name: g.name, member_count: g.member_count }))}
                    />
                  )}

                  {/* gMatch Games & Arcade Hub */}
                  {mainView === 'games' && (
                    <GamesView
                      gamesSubTab={gamesSubTab}
                      setGamesSubTab={setGamesSubTab}
                      identity={identity}
                      myCards={myCards}
                      hasActiveDeck={hasActiveDeck}
                      users={visibleUsers}
                      profilePics={profilePics}
                      lobby={lobby}
                      toggleAutoQueue={toggleAutoQueue}
                      sendInvite={sendInvite}
                      soundEnabled={settings.soundEffects}
                      toast={toast}
                      setSelectedProfileUser={setSelectedProfileUser}
                      setLobbyLightboxUrl={setLobbyLightboxUrl}
                      setExpandedItemId={setExpandedItemId}
                      setPmPeer={setPmPeer}
                      setDmMinimized={setDmMinimized}
                      setMainView={setMainView}
                      setSpectateViewerItems={setSpectateViewerItems}
                      openCreateCardModal={openCreateCardModal}
                      navigateToDeckBuilder={navigateToDeckBuilder}
                      handleSetMainView={handleSetMainView}
                      onRepostImage={openCreatePostWithMedia}
                      onAddToStory={(m) => void shareMediaAs(m, 'story')}
                      onCreateCard={openCreateCardWithMedia}
                      onSetWallpaper={handleSetWallpaper}
                    />
                  )}

                  {mainView === 'servers' && (
                    <div className="flex-1 min-h-0 w-full overflow-hidden">
                      {identity ? (
                        <ServersView
                          identity={identity as never}
                          toast={toast}
                          onSelectUser={(u) => {
                            const full = users.find((existing) => existing.id === u.id || (existing as any).orbitId === u.id)
                            setSelectedProfileUser(full || u)
                          }}
                          profilePics={profilePics}
                        />
                      ) : (
                        <div className="p-6 text-xs text-retro-muted">Sign in to browse servers.</div>
                      )}
                    </div>
                  )}

                  {/* Unified Rooms chat: sealed E2EE rooms + server groups +
                      lobby/queue/DMs in ONE surface (courier rooms only show
                      when courier mode is active). */}
                  {(mainView === 'rooms' || (mainView === 'messages' && !chatOpen && !dmMinimized)) && (
                    <div className="p-2 sm:p-4 h-full flex-1 flex flex-col min-h-0 overflow-hidden">
                      <div className="solid-panel flex-1 min-h-0 h-full w-full overflow-hidden flex flex-col rounded-xl shadow-2xl">
                        <GMatchDMs
                          identity={identity}
                          chatMessages={chatMessages}
                          pmMessages={pmPeer ? pmMessagesByPeer[pmPeer.id || (pmPeer as { orbitId?: string }).orbitId || ''] || [] : []}
                          activePmPeer={pmPeer ? { orbitId: pmPeer.id || (pmPeer as { orbitId?: string }).orbitId || '', name: pmPeer.display_name || 'User' } : null}
                          // No `|| 'User'` fallback: a placeholder name is not a
                          // name, and resolveDisplayName treats it as such and
                          // falls through to the real sources.
                          peers={users.map((u) => ({ orbitId: u.id || (u as { orbitId?: string }).orbitId || '', name: u.display_name }))}
                          users={users}
                          threads={pmThreads}
                          profilePics={profilePics}
                          myDisplayName={myProfile.displayName || 'You'}
                          groups={chatGroups}
                          groupMessages={groupMessagesByGroup}
                          activeGroupId={activeGroupId}
                          rooms={chatRooms}
                          activeRoomId={activeRoomId}
                          onSelectRoom={openRoomChat}
                          onCreateRoom={(name) => {
                            const r = courier.createRoom(name)
                            return r ? { id: r.id, name: r.name, ownerId: r.ownerId, members: r.members, epoch: r.epoch } : null
                          }}
                          onInviteRoom={courier.inviteToRoom}
                          onSayRoom={(roomId, text) => { void courier.sayInRoom(roomId, text) }}
                          onLeaveRoom={(roomId) => { courier.leaveRoom(roomId); if (activeRoomId === roomId) openRoomChat(null) }}
                          getRoomMessages={chatRoomMessages}
                          onSendMessage={sendChatMessage}
                          onSendPm={(peerId, text, replyToId, attachment) => { void sendPm(peerId, text, replyToId, attachment) }}
                          onSelectPeer={(p) => {
                            if (p) {
                              const found = users.find((u) => u.id === p.orbitId || (u as { orbitId?: string }).orbitId === p.orbitId)
                              setPmPeer((found || { id: p.orbitId, display_name: p.name }) as never)
                              if (p.orbitId !== 'global_lobby' && p.orbitId !== 'card_queue') loadPmMessages(p.orbitId)
                            } else {
                              setPmPeer(null)
                            }
                          }}
                          onReportMessage={reportPmMessage}
                          onReportUser={reportPmUser}
                          onDeleteMessage={(messageId, peerId) => { if (peerId) void deletePmMessage(messageId, peerId) }}
                          onCreateGroup={createGroup}
                          onOpenAttachment={openAttachmentModal}
                          onSendGroupMessage={(groupId, text, replyToId, attachment) => { void sendGroupMessage(groupId, text, replyToId, attachment) }}
                          onLeaveGroup={leaveGroup}
                          onLoadGroupMessages={loadGroupMessages}
                          onLoadGroupMembers={loadGroupMembers}
                          onAddGroupMembers={addGroupMembers}
                          onSelectGroup={setActiveGroupId}
                          onOpenProfile={(userId, userObj) => {
                            const t = users.find((u) => u.id === userId || (u as { orbitId?: string }).orbitId === userId)
                            // Prefer the FRESHER sighting. The chat hub builds
                            // userObj from a 30s dashboard poll, while the roster
                            // entry's last_seen only moves when the roster poll
                            // commits — taking `t` unconditionally threw that
                            // fresher data away and produced the "online in the
                            // list, offline in the profile" split.
                            setSelectedProfileUser(fresherPresence(userObj, t) || ({ id: userId, display_name: 'User' } as User))
                          }}
                          onOpenImage={(msg) => setViewerMessage(msg)}
                          onUserContext={(e, peerId, name) => {
                            const u = users.find((x) => x.id === peerId || (x as { orbitId?: string }).orbitId === peerId)
                            openContextMenu('user', u || { id: peerId, display_name: name })(e)
                          }}
                          onDeleteThread={deleteThread}
                          onBackToThreads={() => { setPmPeer(null); loadPmThreads() }}
                          onLoadHistory={loadPmHistory}
                        />
                      </div>
                    </div>
                  )}
                  {/* Babecock · Idle — gMatch workspace (plan D2/D5) */}
                  {mainView === 'grid' && (
                    <div className="flex-1 min-h-0 w-full">
                      <GridWorkspace
                        onRepostImage={openCreatePostWithMedia}
                        onAddToStory={(m) => void shareMediaAs(m, 'story')}
                        onCreateCard={openCreateCardWithMedia}
                        onSetWallpaper={handleSetWallpaper}
                      />
                    </div>
                  )}



                  {/* Fullscreen Store (mirrors the game store as an independent view) */}
                  {mainView === 'store' && (
                    <StoreView
                      myUser={myUser}
                      identity={identity}
                      users={users}
                      profilePics={profilePics}
                      toast={toast}
                      onSetMainView={handleSetMainView}
                      onOpenFlash={() => setShowFlashModal(true)}
                      onSelectUser={openProfileById}
                      setActiveHack={setActiveHack}
                    />
                  )}

                  {/* Leaderboard & Babecock moved into Games Hub subtabs (removed as standalone views) */}

                  {/* Gallery Full-Width Grid View */}
                  {mainView === 'gallery' && (
                    <GalleryTabView
                      filteredItems={filteredItems}
                      itemsLoading={itemsLoading}
                      galleryFilter={galleryFilter}
                      setGalleryFilter={setGalleryFilter}
                      gallerySort={gallerySort}
                      setGallerySort={setGallerySort}
                      cardSearch={cardSearch}
                      setCardSearch={setCardSearch}
                      cardTypeFilter={cardTypeFilter}
                      setCardTypeFilter={setCardTypeFilter}
                      galleryPage={galleryPage}
                      setGalleryPage={setGalleryPage}
                      selectedGalleryIds={selectedGalleryIds}
                      setSelectedGalleryIds={setSelectedGalleryIds}
                      totalPages={totalPages}
                      paginatedItems={paginatedItems}
                      batchDownloading={batchDownloading}
                      handleDownloadAll={handleDownloadAll}
                      handleBatchDownload={handleBatchDownload}
                      handleBatchDelete={handleBatchDelete}
                      dragActive={dragActive}
                      setDragActive={setDragActive}
                      dragAnchorId={dragAnchorId}
                      setDragAnchorId={setDragAnchorId}
                      onOpenCreateCard={() => setShowCreateCardModal(true)}
                      onCreateCardFromMedia={openCreateCardWithMedia}
                      onItemContextMenu={(e, item) => openContextMenu('item', item)(e)}
                      onSetWallpaper={handleSetWallpaper}
                      users={users}
                      identity={identity!}
                      setExpandedItemId={setExpandedItemId}
                      posts={feedPosts}
                      toast={toast}
                      cardByMedia={cardByMedia}
                      onOpenOwnerProfile={openProfileById}
                      allOwnedCards={allOwnedCards as any}
                      subTab={gallerySubTab}
                      setSubTab={setGallerySubTab}
                      onEnterArena={() => { setGamesSubTab('duel'); setMainView('games'); }}
                      onRepostGalleryImage={(media) => openCreatePostWithMedia(media)}
                      onAddGalleryImageToStory={(media) => void shareMediaAs(media, 'story')}
                    />
                  )}

                  {/* Watch theater mounts as an app-shell overlay (below). */}

                  {/* Game View (Matchmaking Lobby) */}
                  {mainView === 'game' && (
                    <GameView
                      lobby={lobby}
                      toggleAutoQueue={toggleAutoQueue}
                      sendInvite={sendInvite}
                      identity={identity}
                      myCards={myCards}
                      hasActiveDeck={hasActiveDeck}
                      soundEnabled={settings.soundEffects}
                      users={users}
                      profilePics={profilePics}
                      spinTarget={spinTarget}
                      selectedIds={selectedIds}
                      setSelectedIds={setSelectedIds}
                      sendPanelRef={sendPanelRef}
                      forwardedStashFile={forwardedStashFile}
                      setForwardedStashFile={setForwardedStashFile}
                      setTransferProgress={setTransferProgress}
                      toast={toast}
                      loadGallery={loadGallery}
                      loadUsers={loadUsers}
                      sendP2PItem={sendP2PItem}
                      setLobbyLightboxUrl={setLobbyLightboxUrl}
                      setExpandedItemId={setExpandedItemId}
                      setSelectedProfileUser={setSelectedProfileUser}
                      setSpectateViewerItems={setSpectateViewerItems}
                      openCreateCardModal={openCreateCardModal}
                      navigateToDeckBuilder={navigateToDeckBuilder}
                    />
                  )}

                  {/* PC Domination Control Panel (fused cyber hacks live here) */}
                  {mainView === 'pc_domination' && (
                    <PCDominationView
                      identity={identity}
                      users={users}
                      profilePics={profilePics}
                      points={myUser?.balance ?? 0}
                      toast={toast}
                      activeHack={activeHack}
                      setActiveHack={setActiveHack}
                      onOpenFlash={() => setShowFlashModal(true)}
                      mesh={{ peerKnown: meshPeerKnown, send: meshSend }}
                    />
                  )}

                  {/* Stories & Store live inside the feed tray and Games Hub — removed as standalone views */}

                  {/* Decision Overlay deactivated — matching cards are shown directly inside the match tab */}
                </div>

                {/* Watch Party lives on the Watch tab only (one entry point;
                    the feed dock/edge tabs duplicated it). */}

                {/* Desktop messages dock: right side panel sibling */}
                <MessagesRail open={chatOpen}>
                  <RoomsPreview
                    rows={previewRows}
                    onOpenRow={(row) => {
                      const open = () => {
                        setChatOpen(false)
                        setDmMinimized(false)
                        setMainView('rooms')
                        const want = hashForView('rooms')
                        if (window.location.hash !== want) window.history.pushState(null, '', want)
                      }
                      if (row.kind === 'room') {
                        setActiveGroupId(null); setPmPeer(null); openRoomChat(row.id); open(); return
                      }
                      if (row.kind === 'group') {
                        openRoomChat(null); setActiveGroupId(row.id); setPmPeer(null); void loadGroupMessages(row.id); open(); return
                      }
                      openRoomChat(null)
                      setActiveGroupId(null)
                      if (row.kind === 'lobby' || row.kind === 'queue') {
                        setPmPeer(row.kind === 'lobby'
                          ? ({ id: 'global_lobby', display_name: 'Lobby Lounge (Everyone)' } as never)
                          : ({ id: 'card_queue', display_name: 'Card Game Queue' } as never))
                      } else {
                        const found = users.find((u) => u.id === row.id || (u as { orbitId?: string }).orbitId === row.id)
                        setPmPeer((found || { id: row.id, display_name: row.name }) as never)
                        loadPmMessages(row.id)
                      }
                      open()
                    }}
                    onOpenAll={() => {
                      setChatOpen(false)
                      setDmMinimized(false)
                      setMainView('rooms')
                      const want = hashForView('rooms')
                      if (window.location.hash !== want) window.history.pushState(null, '', want)
                    }}
                  />
                </MessagesRail>

                {/* Root-Level Lightbox & Profile Overlays */}
                {expandedItemId && (
                  <ImageViewer
                    itemId={expandedItemId}
                    items={spectateViewerItems ?? allViewerItems}
                    identity={identity}
                    onClose={() => { setExpandedItemId(null); setSpectateViewerItems(null) }}
                    onNavigate={(id) => setExpandedItemId(id)}
                    onDelete={handleDelete}
                    onSetWallpaper={handleSetWallpaper}
                    onToggleFavorite={toggleFavorite}
                  />
                )}

                {/* Chat attachment viewer (PM + group) */}
                {viewerMessage && identity && (
                  <ImageViewer
                    itemId={viewerMessage.attachmentId || viewerMessage.id}
                    items={[
                      {
                        id: viewerMessage.attachmentId || viewerMessage.id,
                        owner_id: viewerMessage.senderId,
                        size_bytes: 0,
                        mime_type: viewerMessage.attachmentMime || 'image/jpeg',
                        created_at: new Date(viewerMessage.timestamp).toISOString(),
                        content_url: viewerMessage.attachmentUrl || '',
                        display_name: viewerMessage.senderName,
                      } as OrbitObject,
                    ]}
                    identity={identity}
                    onClose={() => setViewerMessage(null)}
                    onNavigate={() => { }}
                    onSetWallpaper={handleSetWallpaper}
                  />
                )}

                {/* Lobby Image Fallback Lightbox */}
                {lobbyLightboxUrl && !expandedItemId && (
                  <div
                    className="fixed inset-0 z-[var(--z-system)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer animate-orbit-fade-in"
                    onClick={() => setLobbyLightboxUrl(null)}
                  >
                    <div className="relative max-w-4xl max-h-[90vh] flex items-center justify-center" onClick={e => e.stopPropagation()}>
                      { }
                      <img
                        src={lobbyLightboxUrl}
                        alt="Lobby image"
                        className="max-w-full max-h-[85vh] object-contain rounded-lg border-2 border-border-glass shadow-2xl"
                      />
                      <button
                        type="button"
                        onClick={() => setLobbyLightboxUrl(null)}
                        className="absolute top-2 right-2 bg-retro-panel border border-border-glass text-retro-muted hover:text-retro-fg p-1.5 transition-colors cursor-pointer"
                        aria-label="Close image"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                      </button>
                    </div>
                  </div>
                )}

                {/* Notifications modal (sidebar/header bell) */}
                {notifOpen && !isDesktopViewport() && (
                  <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4" role="dialog" aria-label="Notifications">
                    <div className="absolute inset-0 bg-black/70" onClick={() => setNotifOpen(false)} />
                    <div className="relative w-full max-w-md h-[70vh] solid-panel rounded-xl overflow-hidden flex flex-col">
                      <NotificationsPanel
                        embedded
                        notifications={lobby.notifications}
                        unreadCount={lobby.unreadCount}
                        unreadByType={lobby.unreadByType}
                        invites={lobby.invites}
                        onMarkAllRead={() => lobby.markNotificationsRead()}
                        onMarkRead={(ids) => { void lobby.markNotificationsRead(ids); }}
                        onOpenTarget={handleOpenNotificationTarget}
                        onRespondInvite={(id, accept) => lobby.respondToInvite(id, accept)}
                        onRespondBabecock={handleRespondBabecock}
                        onOpenBabecock={() => { setNotifOpen(false); setGamesSubTab('babecock'); setMainView('games'); }}
                        onClose={() => setNotifOpen(false)}
                      />
                    </div>
                  </div>
                )}

                {/* Root-Level User Profile Modal */}
                {selectedProfileUser && (
                  <UserProfileModal
                    user={selectedProfileUser}
                    profilePic={profilePics[selectedProfileUser.id] || selectedProfileUser.pfp_url}
                    isContact={friendsIds.includes(selectedProfileUser.id)}
                    stories={stories}
                    cards={items}
                    posts={selectedProfilePosts}
                    identity={identity}
                    onClose={() => setSelectedProfileUser(null)}
                    onOpenStories={(userId) => {
                      setSelectedProfileUser(null);
                      setExpandedItemId(null);
                      setMainView('feed');
                      setStoryViewerUserId(userId);
                    }}
                    onSendCard={selectedProfileUser.id === identity?.orbitId ? undefined : (userId) => {
                      const target = selectedProfileUser;
                      setSendCardTarget({ id: userId, name: target?.display_name || nameFor(userId) || UNKNOWN_NAME });
                    }}
                    onStartPm={selectedProfileUser.id === identity?.orbitId ? undefined : (u) => {
                      const targetUser = users.find((usr) => usr.id === u.id) || ({ id: u.id, display_name: u.display_name } as User);
                      setPmPeer(targetUser);
                      handleSetMainView('messages');
                    }}
                    onInviteToGame={selectedProfileUser.id === identity?.orbitId ? undefined : (userId) => {
                      void (async () => {
                        const result = await sendInvite(userId);
                        if (result.ok) {
                          toast('Game invitation sent', 'success');
                          setSelectedProfileUser(null);
                        } else {
                          toast(result.error || 'Could not send game invitation', 'error');
                        }
                      })();
                    }}
                    isFollowing={followingIds.includes(selectedProfileUser.id)}
                    onToggleFollow={selectedProfileUser.id === identity?.orbitId ? undefined : toggleFollowUser}
                    onBlockUser={selectedProfileUser.id === identity?.orbitId ? undefined : blockUser}
                    onReportUser={selectedProfileUser.id === identity?.orbitId ? undefined : (id, name) => openReportModal(id, name)}
                    onOpenFollowers={(tab) => setFollowersModalState({ isOpen: true, initialTab: tab, targetUserId: selectedProfileUser.id, targetName: selectedProfileUser.display_name || null })}
                    onCopyId={(id) => {
                      navigator.clipboard.writeText(id)
                      toast('Copied Orbit ID', 'info')
                    }}
                    followingIds={followingIds}
                    users={users}
                    shareGroups={chatGroups.map((g) => ({ id: g.id, name: g.name, member_count: g.member_count }))}
                    onSendDm={sendPm}
                    onPersistLike={persistLike}
                    onPersistSave={persistSave}
                    onPersistComment={persistComment}
                    toast={toast}
                  />
                )}

                {/* Gift / Send Card Modal */}
                {sendCardTarget && (
                  <SendCardModal
                    isOpen={true}
                    onClose={() => setSendCardTarget(null)}
                    recipientId={sendCardTarget.id}
                    recipientName={sendCardTarget.name}
                    identity={identity}
                    cards={canonicalCards}
                    toast={toast}
                  />
                )}
              </div>

              <ReportModal
                reportModal={reportModal}
                onClose={() => setReportModal(null)}
                onSubmit={submitReport}
                reportReason={reportReason}
                setReportReason={setReportReason}
                reportCategory={reportCategory}
                setReportCategory={setReportCategory}
              />

              {/* Floating Minimized DM Dock Bubble */}
              {dmMinimized && (
                <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-40 flex justify-center px-3 pb-2 pointer-events-none">
                  <button
                    type="button"
                    onClick={() => { playPress(900); setDmMinimized(false); }}
                    title="Expand Direct Messages"
                    aria-label="Expand Direct Messages"
                    className="pointer-events-auto flex items-center gap-2.5 bg-black text-white pl-2 pr-4 py-2 rounded-full shadow-2xl border border-border-strong hover:bg-surface-canvas transition-colors cursor-pointer active:scale-95"
                  >
                    <span className="w-8 h-8 rounded-full bg-glass-w20 p-[2px] shrink-0">
                      <span className="w-full h-full rounded-full bg-black overflow-hidden flex items-center justify-center text-xs font-bold text-white">
                        {pmPeer ? (
                          profilePics[pmPeer.id || (pmPeer as any).orbitId || ''] ? (
                            <img src={resolveMediaUrl(profilePics[pmPeer.id || (pmPeer as any).orbitId || ''])} alt="" className="w-full h-full object-cover" />
                          ) : (
                            (pmPeer.display_name || 'P').charAt(0).toUpperCase()
                          )
                        ) : (
                          'D'
                        )}
                      </span>
                    </span>
                    <span className="flex flex-col items-start leading-tight">
                      <span className="text-xs font-bold">
                        {pmPeer ? pmPeer.display_name || 'Direct Message' : 'Direct Messages'}
                      </span>
                      <span className="text-[10px] text-retro-muted">Tap to reopen</span>
                    </span>
                    {chatMessages.length > 0 && (
                      <span className="w-2 h-2 rounded-full bg-retro-accent ring-2 ring-retro-fg shrink-0" />
                    )}
                  </button>
                </div>
              )}

              <GlobalModals
                identity={identity}
                users={users}
                profilePics={profilePics}
                settings={settings}
                updateSettings={updateSettings}
                myProfile={myProfile}
                setMyProfile={setMyProfile}
                stories={stories}
                activeVirusHack={activeVirusHack}
                setActiveHacks={setActiveHacks}
                relationships={relationships}
                followingIds={followingIds}
                items={items}
                identityModalMode={identityModalMode}
                setIdentityModalMode={setIdentityModalMode}
                exportIdentity={exportIdentity}
                loginWithExportedId={loginWithExportedId}
                clearIdentity={clearIdentity}
                handleFullConfigDownload={handleFullConfigDownload}
                handleFullConfigRestore={handleFullConfigRestore}
                showHelpModal={showHelpModal}
                setShowHelpModal={setShowHelpModal}
                showPointsHelpModal={showPointsHelpModal}
                setShowPointsHelpModal={setShowPointsHelpModal}
                showFlashModal={showFlashModal}
                setShowFlashModal={setShowFlashModal}
                showSettingsModal={showSettingsModal}
                setShowSettingsModal={setShowSettingsModal}
                settingsInitialTab={settingsInitialTab}
                showCreatePostModal={showCreatePostModal}
                setShowCreatePostModal={setShowCreatePostModal}
                createPostInitialData={createPostInitialData}
                setCreatePostInitialData={setCreatePostInitialData}
                showStoryModal={showStoryModal}
                setShowStoryModal={setShowStoryModal}
                showMaxGoonerModal={showMaxGoonerModal}
                setShowMaxGoonerModal={setShowMaxGoonerModal}
                showRecommendations={showRecommendations}
                setShowRecommendations={setShowRecommendations}
                followersModalState={followersModalState}
                setFollowersModalState={setFollowersModalState}
                showCoffee={showCoffee}
                manualCoffeeOpen={manualCoffeeOpen}
                triggerReason={triggerReason}
                dismissCoffee={dismissCoffee}
                setManualCoffeeOpen={setManualCoffeeOpen}
                handleSetMainView={handleSetMainView}
                setMainView={setMainView}
                setDmMinimized={setDmMinimized}
                setPmPeer={setPmPeer}
                setSelectedProfileUser={setSelectedProfileUser}
                setSelectedIds={setSelectedIds}
                setExpandedItemId={setExpandedItemId}
                setStoryViewerUserId={setStoryViewerUserId}
                loadUsers={loadUsers}
                loadGallery={loadGallery}
                loadStories={loadStories}
                loadServerFeed={loadServerFeed}
                handleAddStory={handleAddStory}
                toggleFollowUser={toggleFollowUser}
                toast={toast}
                storyFileInputRef={storyFileInputRef}
                pfpInputRef={pfpInputRef}
                handleSetProfilePic={handleSetProfilePic}
                lobby={lobby}
              />
              <OnboardingFlow
                identity={identity}
                initialProfile={{ displayName: myProfile.displayName, tags: myProfile.tags, pfpUrl: myProfile.pfpUrl }}
                ensureIdentity={() => createIdentity()}
                tagSuggestions={myPostTags}
                toast={toast}
                onLogin={async (name, tags, customKey, pfpUrl) => {
                  if (!customKey) throw new Error('Missing secret key');
                  const result = loginWithExportedId(customKey);
                  if (!result.success) throw new Error(result.error || 'Invalid secret key');
                  if (pfpUrl && result.identity?.orbitId) {
                    const targetId = result.identity.orbitId;
                    setProfilePics((prev) => {
                      const next = { ...prev, [targetId]: pfpUrl };
                      try { setSecureItem('goonmatch_pfps', JSON.stringify(next)) } catch { }
                      return next;
                    });
                    try { setSecureItem('orbit_pfp_url', pfpUrl) } catch { }
                    try { localStorage.setItem('orbit_pfp_url', pfpUrl) } catch { }
                    await saveUserProfile(result.identity, { pfp_url: pfpUrl }).catch(() => { });
                  }
                }}
                onCreateAccount={async () => { throw new Error('This account is already authenticated'); }}
                onProfileUpdated={(profile) => {
                  setMyProfile((prev) => ({ ...prev, displayName: profile.displayName, tags: profile.tags, pfpUrl: profile.pfpUrl || prev.pfpUrl }));
                }}
                onComplete={() => {
                  toast('Account ready.', 'success');
                }}
                onOpenTos={() => { setLegalDoc('terms'); setShowTosModal(true) }}
              />
              <AttachmentUploadModal
                isOpen={attachmentModal?.isOpen ?? false}
                onClose={closeAttachmentModal}
                onSuccess={handleAttachmentSuccess}
                identity={identity}
                title={attachmentModal?.target === 'pm' ? 'Attach to Message' : 'Attach to Group Chat'}
                recipientId={attachmentModal?.peerId}
                initialFiles={attachmentModal?.initialFiles}
                initialUrl={attachmentModal?.initialUrl}
              />
              <ChangelogModal
                isOpen={showChangelogModal}
                onClose={handleCloseChangelog}
              />
              {groupPickerOpen && chatGroups.length > 0 && (
                <div className="fixed inset-0 z-[var(--z-lightbox)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="bg-surface-raised border border-border-glass rounded-xl max-w-md w-full shadow-2xl overflow-hidden">
                    <div className="p-4 border-b border-border-glass flex items-center justify-between">
                      <h3 className="text-sm font-bold text-retro-fg">Select group chat</h3>
                      <button onClick={() => setGroupPickerOpen(false)} className="text-retro-muted hover:text-retro-body p-1">
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {chatGroups.map((group) => (
                        <button
                          key={group.id}
                          type="button"
                          onClick={() => handleGroupPickerSelect(group.id)}
                          className="w-full p-3 hover:bg-glass-w5 transition-colors text-left border-b border-border-glass last:border-0 flex items-center gap-3"
                        >
                          <div className="w-10 h-10 rounded-full bg-glass-w20 flex items-center justify-center text-retro-fg font-bold text-sm">
                            {group.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-retro-fg truncate">{group.name}</p>
                            <p className="text-xs text-retro-muted">{group.member_count} members</p>
                          </div>
                          <ChatCircleText className="w-5 h-5 text-retro-muted" />
                        </button>
                      ))}
                    </div>
                    {chatGroups.length === 0 && (
                      <div className="p-6 text-center text-retro-muted">
                        <ChatCircleText className="w-10 h-10 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No group chats available</p>
                        <p className="text-xs mt-1">Create a group chat first to share images</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Watch theater: ALWAYS mounted (hidden off-tab) so an opened
                room keeps playing in the background. In a ROOM it is the
                whole shell (video bleeds behind the transparent header, the
                island recedes to a hover sliver). BROWSING (no room open)
                it stays a normal tab: content constrained between the
                header and the pill bar, island fully visible. */}
            {settings.watchPartyEnabled && identity && (
              <div className={mainView === 'watch'
                ? (watchRoomOpen
                    ? `absolute inset-0 ${notifOpen ? 'md:left-[min(420px,32vw)]' : 'left-0'} ${chatOpen ? 'md:right-[min(720px,40vw)]' : 'right-0'} z-20 flex flex-col min-h-0 overflow-hidden`
                    : `absolute top-9 bottom-[var(--island-clearance)] ${notifOpen ? 'md:left-[min(420px,32vw)]' : 'left-0'} ${chatOpen ? 'md:right-[min(720px,40vw)]' : 'right-0'} z-20 flex flex-col min-h-0 overflow-hidden`)
                : 'hidden'}>
                <WatchPartyView identity={identity} profilePics={profilePics} />
              </div>
            )}

            {/* Centered Floating Dynamic Island Navigation HUD */}
            <CommandIsland
              mainView={mainView}
              setMainView={handleSetMainView}
              balance={myUser?.balance ?? 0}
              wsConnected={isWsConnected}
              unreadMessagesCount={chatUnreadCount}
              unreadNotificationsCount={lobby.unreadCount}
              gamesOnlineCount={gamesOnlineCount}
              watchWatchingCount={watchWatchingCount}
              feedNewPostsCount={feedNewPostsCount}
              recessed={mainView === 'watch' && watchRoomOpen}
              displayName={myProfile.displayName || myUser?.display_name || 'You'}
              profilePic={profilePics[identity?.orbitId || ''] || myProfile.pfpUrl}
              onOpenCreatePost={() => { setChatOpen(false); setShowCreatePostModal(true); }}
              onOpenSettings={() => { setChatOpen(false); setShowSettingsModal((v) => !v); }}
              onOpenHelp={() => { setChatOpen(false); setShowHelpModal(true); }}
              settingsOpen={showSettingsModal}
              onOpenStore={() => handleSetMainView('store')}
              onOpenNotifications={() => {
                setNotifOpen((v) => {
                  const next = !v;
                  if (next) lobby.markNotificationsRead();
                  return next;
                });
              }}
              notificationsOpen={notifOpen}
              onToggleMessages={() => {
                playPress(860);
                setChatOpen(false);
                setDmMinimized(false);
                if (mainView !== 'rooms') markAllChatRead();
                handleSetMainView(mainView === 'rooms' ? 'feed' : 'rooms');
              }}
              messagesOpen={mainView === 'rooms' || mainView === 'messages'}
              onOpenWallpaper={() => {
                playPress(760);
                setShowThemeDrawer((v) => !v);
              }}
              themeOpen={showThemeDrawer}
              onLogout={() => { setChatOpen(false); setIdentityModalMode('logout'); }}
               onOpenProfile={() => handleSetMainView('profile')}
               onOpenAdmin={() => setAdminModalOpen(true)}
               onOpenCreateCard={() => { setChatOpen(false); setShowCreateCardModal(true); }}
              gridSize={idleViewMode}
              onGridSizeChange={(m) => setIdleViewMode(m)}
            />
          </ErrorBoundary>
        )}
      </div>

       {adminModalOpen && (
         <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-6" role="dialog" aria-modal="true" aria-label="Admin control panel" onMouseDown={(e) => { if (e.target === e.currentTarget) setAdminModalOpen(false) }}>
           <div className="relative flex h-[92vh] w-full max-w-[1500px] min-h-0 flex-col overflow-hidden rounded-xl border border-border-glass bg-retro-bg shadow-2xl">
             <button type="button" aria-label="Close admin control panel" onClick={() => setAdminModalOpen(false)} className="absolute right-3 top-3 z-20 rounded-md border border-border-glass bg-surface-raised px-2 py-1 text-xs text-retro-muted hover:text-retro-fg cursor-pointer">Close</button>
             <div className="min-h-0 flex-1 overflow-y-auto"><AdminApp identity={identity} /></div>
           </div>
         </div>
       )}

       <ThemeDrawer

        isOpen={showThemeDrawer}
        onClose={() => setShowThemeDrawer(false)}
        settings={settings}
        updateSettings={updateSettings}
        toast={toast}
      />

      {showCreateCardModal && identity && (
        <CreateCardModal
          identity={identity}
          cardsNeeded={createCardNeeded}
          initialMedia={cardPrefill}
          initialFile={forgeFile}
          onClose={() => { setShowCreateCardModal(false); setCardPrefill(null); setForgeFile(null); }}
          onCreated={() => {
            setCreateCardNeeded(Math.max(0, MIN_GAME_CARDS - (myCards.length + 1)))
            setForgeFile(null)
            toast('Card created.', 'success')
          }}
        />
      )}

      {/* Global card-info modal (opened via 'gmatch:open-card' from Play/Deck/Lobby). */}
      {globalCardId && identity && (
        <CardDetailView
          cardId={globalCardId}
          identity={identity}
          onClose={() => setGlobalCardId(null)}
          toast={toast}
        />
      )}

      {/* First-class legal gates: render above the onboarding overlay so the
          18+ check happens before login and ToS/Privacy stay reachable. */}
      <DominationEffects identity={identity} />
      <AgeGateModal onOpenTos={() => { setLegalDoc('terms'); setShowTosModal(true) }} />
      <LegalCenter
        isOpen={showTosModal}
        initialDoc={legalDoc}
        onClose={() => setShowTosModal(false)}
        onAccept={() => { setLegalAccepted(true); setShowTosModal(false) }}
      />
      {/* Versioned acceptance (C.2): once logged in, the CURRENT legal suite
          must be read + accepted before the app reveals itself. Re-triggers
          on every version bump (key = full doc@version map). */}
      {isLoaded && identity && !legalAccepted && isOnboardingComplete(readOnboardingState(identity.orbitId)) && (
        <LegalCenter
          isOpen
          requireAccept
          initialDoc="terms"
          onClose={() => { /* acceptance is the only exit */ }}
          onAccept={() => setLegalAccepted(true)}
        />
      )}

      <ContextOverlay
        contextMenu={contextMenu}
        onDismiss={() => setContextMenu(null)}
        identity={identity}
        friendsIds={friendsIds}
        toast={toast}
        onViewProfile={(user) => setSelectedProfileUser(user)}
        onToggleContact={toggleFriend}
        onSendCard={(userId) => setSelectedIds(new Set([userId]))}
        onCopyId={(id) => {
          navigator.clipboard.writeText(id)
          toast('GMatch ID copied', 'info')
        }}
        onSendPm={(user) => setPmPeer(user)}
        onBlockUser={blockUser}
        onOpenLightbox={(id) => setExpandedItemId(id)}
        onDownloadItem={async (item) => {
          try {
            const res = await orbitFetch(`/api/objects/${item.id}`, {}, identity)
            if (!res.ok) return
            const blob = await res.blob()
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `${item.id.substring(0, 8)}.jpg`
            a.click()
            URL.revokeObjectURL(a.href)
          } catch { }
        }}
        onCopyImageLink={(id) => {
          // Public share page for this object — openable anywhere.
          navigator.clipboard.writeText(`${getApiBaseUrl()}/p/${encodeURIComponent(id)}`)
          toast('Image link copied', 'info')
        }}
        onToggleFavorite={toggleFavorite}
        onDeleteItem={handleDelete}
        onRemoveFromInbox={async (item) => {
          try {
            await orbitFetch(`/api/inbox/${item.id}/remove`, { method: 'POST' }, identity!)
            toast('Removed from inbox', 'success')
            loadGallery()
          } catch { }
        }}
        onReportUser={(id, name) => openReportModal(id, name)}
        onReportItem={(ownerId, ownerName, objectId) => openReportModal(ownerId, ownerName, objectId)}
        onRepostItem={(item) => void shareObjectAs(item, 'repost')}
        onAddToStory={(item) => void shareObjectAs(item, 'story')}
        onRepostImage={(url) => openCreatePostWithMedia({ url })}
        onSetWallpaper={(url, target, mime) => {
          if (target === 'os') void handleSetOsWallpaper(url);
          else handleSetWallpaper(url, mime);
        }}
      />
    </main>
  );
}
