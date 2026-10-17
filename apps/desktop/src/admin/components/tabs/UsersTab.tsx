"use client";

import { AdminTable, AdminFilterBar, AdminEmptyState, Badge, StatusBadge, ConfirmDialog, DetailModal } from "../../../components/admin/primitives";
import { adminApi } from "../../../utils/adminApi";
import { useState, useCallback, useEffect } from "react";
import {
  Users,
  CreditCard,
  Wallet,
  Ban,
  Tag,
  Trash2,
  DollarSign,
  Eye,
  ChevronDown,
  ChevronUp,
  FlaskConical,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import { AdminMediaThumbnail } from "../AdminMediaThumbnail";
import { resolveMediaUrl } from "../../../utils/media";
import { formatAbsoluteTime } from "../../../utils/timeAgo";
import type { AdminUser, AdminCard, TableParams, OrbitIdentity } from "../../../utils/adminTypes";

interface UsersTabProps {
  identity: OrbitIdentity | null;
  pinVerified: boolean;
  onZoom: (url: string, isVideo: boolean, title: string, subtitle: string) => void;
  onAction: (action: string, ...args: unknown[]) => void;
}

const subTabs = [
  { id: "users", label: "User Directory", icon: Users },
  { id: "cards_market", label: "Cards & Marketplace", icon: CreditCard },
  { id: "wallets_ledger", label: "Wallets & Ledger", icon: Wallet },
  { id: "test_cleanup", label: "Test Cleanup", icon: FlaskConical },
] as const;

type SubTab = typeof subTabs[number]["id"];

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function UsersTab({ identity, pinVerified, onZoom, onAction }: UsersTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("users");

  // Users Directory State
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersParams, setUsersParams] = useState<TableParams>({
    page: 1,
    pageSize: 50,
    sort: { column: "last_seen", direction: "desc" },
    filters: {},
  });
  const [showBanModal, setShowBanModal] = useState<{ user: AdminUser } | null>(null);
  const [banReason, setBanReason] = useState("");
  const [banWipe, setBanWipe] = useState(true);
  const [showTagsModal, setShowTagsModal] = useState<{ user: AdminUser } | null>(null);
  const [tagsInput, setTagsInput] = useState("");
  const [showBalanceModal, setShowBalanceModal] = useState<{ user: AdminUser } | null>(null);
  const [balanceData, setBalanceData] = useState({ score: 0, likes: 0, followers: 0, gcoins: 0 });
  const [detailUser, setDetailUser] = useState<AdminUser | null>(null);

  // Cards & Marketplace State
  const [cardSection, setCardSection] = useState<"cards" | "market" | "decks">("cards");
  const [cards, setCards] = useState<AdminCard[]>([]);
  const [cardsTotal, setCardsTotal] = useState(0);
  const [cardsParams, setCardsParams] = useState<TableParams>({ page: 1, pageSize: 50, filters: {} });
  const [marketplace, setMarketplace] = useState<Array<{ id: string; card_id: string; seller_name?: string | null; price: number; status: string; name?: string | null }>>([]);
  const [decks, setDecks] = useState<Array<{ id: string; owner_name?: string | null; name: string; game_id: string; card_count: number }>>([]);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  // Wallets & Ledger State
  const [walletSection, setWalletSection] = useState<"wallets" | "ledger">("wallets");
  const [wallets, setWallets] = useState<Array<{ user_id: string; display_name?: string | null; balance: number; transaction_count: number }>>([]);
  const [ledger, setLedger] = useState<Array<{ id: string; user_id: string; display_name?: string | null; kind: string; delta: number; balance_after: number; created_at: string }>>([]);

  const [isLoading, setIsLoading] = useState(false);

  // E2E purge state lives here; the callbacks are below fetchUsers, which the
  // delete path re-runs to refresh the directory.
  const [purgePreview, setPurgePreview] = useState<{
    matched: number
    wouldDelete: number
    tag: string
    sample: Array<{ id: string; display_name: string | null; last_seen: string | null }>
  } | null>(null);
  const [purgeLimit, setPurgeLimit] = useState("");
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const response = await adminApi.users(identity, usersParams);
      const rows = Array.isArray(response.data) ? response.data : [];
      setUsers(rows);
      setUsersTotal(response.total || rows.length);
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified, usersParams]);

  const runPurgePreview = useCallback(async () => {
    if (!identity || !pinVerified || purgeBusy) return;
    setPurgeBusy(true);
    setPurgeResult(null);
    try {
      const limit = Number(purgeLimit);
      const res = await adminApi.purgeE2e(identity, {
        dryRun: true,
        ...(Number.isFinite(limit) && limit > 0 ? { limit: Math.floor(limit) } : {}),
      });
      setPurgePreview({
        matched: res.matched ?? 0,
        wouldDelete: res.wouldDelete ?? 0,
        tag: res.tag ?? "e2e",
        sample: res.sample ?? [],
      });
    } catch {
      setPurgePreview(null);
      setPurgeResult("Could not reach the server.");
    } finally {
      setPurgeBusy(false);
    }
  }, [identity, pinVerified, purgeLimit, purgeBusy]);

  const runPurge = useCallback(async () => {
    if (!identity || !pinVerified || !purgePreview || purgeBusy) return;
    setPurgeBusy(true);
    setPurgeResult(null);
    try {
      // Re-send the same batch size the preview covered, so the count the
      // operator confirmed is the count that gets deleted.
      const res = await adminApi.purgeE2e(identity, {
        dryRun: false,
        ...(purgePreview.wouldDelete !== purgePreview.matched ? { limit: purgePreview.wouldDelete } : {}),
      });
      const failed = res.errors?.length ?? 0;
      setPurgeResult(
        `Deleted ${res.deleted ?? 0} of ${purgePreview.wouldDelete} account(s)` + (failed ? `, ${failed} failed` : "") + ".",
      );
      // Drop the preview so the delete button cannot be pressed twice against
      // stale numbers, and refresh the directory.
      setPurgePreview(null);
      await fetchUsers();
    } catch {
      setPurgeResult("Purge failed.");
    } finally {
      setPurgeBusy(false);
    }
  }, [identity, pinVerified, purgePreview, purgeBusy, fetchUsers]);

  const fetchCards = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const response = await adminApi.cards(identity, cardsParams);
      const rows = asArray(response.data);
      setCards(rows);
      setCardsTotal(response.total || rows.length);
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified, cardsParams]);

  const fetchMarket = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const response = await adminApi.marketplace(identity, { page: 1, pageSize: 50, filters: { status: "open" } });
      setMarketplace(asArray(response.data));
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified]);

  const fetchDecks = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const response = await adminApi.decks(identity, { page: 1, pageSize: 50 });
      setDecks(asArray(response.data));
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified]);

  const fetchWallets = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const response = await adminApi.wallets(identity, { page: 1, pageSize: 50 });
      setWallets(asArray(response.data));
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified]);

  const fetchLedger = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const response = await adminApi.ledger(identity, { page: 1, pageSize: 100 });
      setLedger(asArray(response.data));
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified]);

  useEffect(() => {
    if (activeSubTab === "users") fetchUsers();
  }, [activeSubTab, fetchUsers]);

  useEffect(() => {
    if (activeSubTab === "cards_market") {
      if (cardSection === "cards") fetchCards();
      else if (cardSection === "market") fetchMarket();
      else fetchDecks();
    }
  }, [activeSubTab, cardSection, fetchCards, fetchMarket, fetchDecks]);

  useEffect(() => {
    if (activeSubTab === "wallets_ledger") {
      if (walletSection === "wallets") fetchWallets();
      else fetchLedger();
    }
  }, [activeSubTab, walletSection, fetchWallets, fetchLedger]);

  const handleRowAction = (action: string, user: AdminUser) => {
    switch (action) {
      case "ban":
        setShowBanModal({ user });
        setBanReason("");
        setBanWipe(true);
        break;
      case "unban":
        onAction("unban", user.id);
        setTimeout(fetchUsers, 300);
        break;
      case "moderator":
        onAction("moderator", user.id, !user.is_moderator);
        setTimeout(fetchUsers, 300);
        break;
      case "admin":
        onAction("admin", user.id, !user.is_admin);
        setTimeout(fetchUsers, 300);
        break;
      case "balance":
        setShowBalanceModal({ user });
        setBalanceData({ score: user.score || 0, likes: user.likes_received || 0, followers: user.followers_count || 0, gcoins: user.balance || 0 });
        break;
      case "tags":
        setShowTagsModal({ user });
        setTagsInput(user.tags?.join(", ") || "");
        break;
      case "inspect":
        setDetailUser(user);
        break;
      case "delete":
        onAction("deleteUser", user.id, user.display_name || user.id);
        setTimeout(fetchUsers, 300);
        break;
    }
  };

  const handleConfirmBan = async () => {
    if (!showBanModal || !identity) return;
    try {
      await adminApi.banUser(identity, showBanModal.user.id, banReason, banWipe);
      setShowBanModal(null);
      fetchUsers();
    } catch {
    }
  };

  const handleSaveTags = async () => {
    if (!showTagsModal || !identity) return;
    const tagList = tagsInput.split(",").map(t => t.trim().replace(/^#/, "")).filter(Boolean);
    try {
      await adminApi.editUserTags(identity, showTagsModal.user.id, tagList);
      setShowTagsModal(null);
      fetchUsers();
    } catch {
    }
  };

  const handleSaveBalance = async () => {
    if (!showBalanceModal || !identity) return;
    try {
      await adminApi.adjustUser(identity, showBalanceModal.user.id, {
        score: balanceData.score,
        likes_received: balanceData.likes,
        followers_count: balanceData.followers,
        balance: balanceData.gcoins,
      });
      setShowBalanceModal(null);
      fetchUsers();
    } catch {
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-black text-retro-fg uppercase tracking-wider">Users & Economy</h1>
          <p className="text-xs text-retro-muted mt-0.5">Manage player identities, minted cards catalog, marketplace, and currency ledger</p>
        </div>
      </div>

      {/* Subtab Navigation */}
      <div className="flex flex-wrap gap-1 bg-surface-raised border border-border-glass rounded-xl p-1">
        {subTabs.map(tab => {
          const Icon = tab.icon;
          const active = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id)}
              className={cn(
                "px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer",
                active
                  ? "bg-retro-accent text-retro-accent-text shadow-sm"
                  : "text-retro-muted hover:text-retro-fg"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.id === "users" && usersTotal > 0 && (
                <span className="ml-1 px-1.5 py-0.2 bg-glass-w10 text-retro-muted rounded-full text-[10px]">
                  {usersTotal}
                </span>
              )}
              {tab.id === "cards_market" && cardsTotal > 0 && (
                <span className="ml-1 px-1.5 py-0.2 bg-glass-w10 text-retro-muted rounded-full text-[10px]">
                  {cardsTotal}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Subtab 1: User Directory */}
      {activeSubTab === "users" && (
        <div className="space-y-4">
          <AdminFilterBar
            searchPlaceholder="Search users by name or ID..."
            searchValue={String(usersParams.filters?.q || "")}
            onSearchChange={(q) => setUsersParams(p => ({ ...p, page: 1, filters: { ...p.filters, q } }))}
            filters={usersParams.filters || {}}
            onFiltersChange={(filters) => setUsersParams(p => ({ ...p, page: 1, filters }))}
            configs={[
              {
                key: "role",
                label: "Role",
                type: "select",
                options: [
                  { label: "All Roles", value: "all" },
                  { label: "Admins", value: "admin" },
                  { label: "Moderators", value: "moderator" },
                  { label: "Standard Users", value: "user" },
                ],
              },
              {
                key: "status",
                label: "Status",
                type: "select",
                options: [
                  { label: "All Statuses", value: "all" },
                  { label: "Active", value: "active" },
                  { label: "Banned", value: "banned" },
                ],
              },
            ]}
          />

          <AdminTable<AdminUser>
            config={{
              columns: [
                {
                  accessorKey: "display_name",
                  header: "User",
                  cell: (_, row) => (
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-surface-canvas border border-border-glass flex items-center justify-center text-xs font-bold text-retro-fg uppercase overflow-hidden shrink-0">
                        {row.pfp_url ? <img src={resolveMediaUrl(row.pfp_url)} alt="" className="w-full h-full object-cover" /> : (row.display_name?.[0] || "?")}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-retro-fg truncate">{row.display_name || "Anonymous"}</div>
                        <div className="text-[10px] text-retro-muted font-mono truncate">{row.id}</div>
                      </div>
                    </div>
                  ),
                },
                {
                  accessorKey: "role",
                  header: "Role",
                  cell: (_, row) => (
                    <div className="flex items-center gap-1">
                      {row.is_admin ? <Badge variant="danger" size="sm">Admin</Badge> : null}
                      {row.is_moderator ? <Badge variant="warning" size="sm">Mod</Badge> : null}
                      {!row.is_admin && !row.is_moderator ? <Badge variant="neutral" size="sm">User</Badge> : null}
                    </div>
                  ),
                },
                {
                  accessorKey: "balance",
                  header: "G$",
                  cell: (_, row) => <span className="font-mono text-xs text-amber-400">{(row.balance || 0).toLocaleString()}</span>,
                },
                {
                  accessorKey: "score",
                  header: "Score",
                  cell: (_, row) => <span className="font-mono text-xs text-retro-fg">{(row.score || 0).toLocaleString()}</span>,
                },
                {
                  accessorKey: "status",
                  header: "Status",
                  cell: (_, row) => (
                    <StatusBadge
                      status={row.is_banned ? "banned" : row.online ? "active" : "offline"}
                      mapping={{ active: "active", offline: "neutral", banned: "banned" }}
                      size="sm"
                    />
                  ),
                },
                {
                  accessorKey: "last_seen",
                  header: "Last Seen",
                  cell: (_, row) => (
                    <span className="text-[10px] text-retro-muted font-mono">
                      {row.last_seen ? formatAbsoluteTime(row.last_seen, { dateStyle: "short" }) : "Never"}
                    </span>
                  ),
                },
              ],
              rowActions: [
                { label: "Inspect", icon: Eye, onClick: (row) => handleRowAction("inspect", row) },
                { label: "Edit Balances", icon: DollarSign, onClick: (row) => handleRowAction("balance", row) },
                { label: "Edit Tags", icon: Tag, onClick: (row) => handleRowAction("tags", row) },
                {
                  label: "Ban User",
                  icon: Ban,
                  variant: "danger",
                  onClick: (row) => handleRowAction(row.is_banned ? "unban" : "ban", row),
                },
                {
                  label: "Delete",
                  icon: Trash2,
                  variant: "danger",
                  onClick: (row) => handleRowAction("delete", row),
                },
              ],
            }}
            data={users}
            total={usersTotal}
            isLoading={isLoading}
            onParamsChange={(p) => setUsersParams(prev => ({ ...prev, ...p }))}
            getRowId={(row) => row.id}
          />
        </div>
      )}

      {/* Subtab 2: Cards & Marketplace */}
      {activeSubTab === "cards_market" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border-glass pb-3">
            <button
              type="button"
              onClick={() => setCardSection("cards")}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer",
                cardSection === "cards" ? "bg-glass-w10 text-retro-fg" : "text-retro-muted hover:text-retro-body"
              )}
            >
              Minted Cards ({cardsTotal})
            </button>
            <button
              type="button"
              onClick={() => setCardSection("market")}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer",
                cardSection === "market" ? "bg-glass-w10 text-retro-fg" : "text-retro-muted hover:text-retro-body"
              )}
            >
              Marketplace Listings ({marketplace.length})
            </button>
            <button
              type="button"
              onClick={() => setCardSection("decks")}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer",
                cardSection === "decks" ? "bg-glass-w10 text-retro-fg" : "text-retro-muted hover:text-retro-body"
              )}
            >
              Player Decks ({decks.length})
            </button>
          </div>

          {cardSection === "cards" && (
            <div className="space-y-4">
              <AdminFilterBar
                searchPlaceholder="Search cards by name or owner..."
                searchValue={String(cardsParams.filters?.q || "")}
                onSearchChange={(q) => setCardsParams(p => ({ ...p, page: 1, filters: { ...p.filters, q } }))}
                filters={cardsParams.filters || {}}
                onFiltersChange={(filters) => setCardsParams(p => ({ ...p, page: 1, filters }))}
                configs={[
                  {
                    key: "moderation_state",
                    label: "State",
                    type: "select",
                    options: [
                      { label: "All States", value: "all" },
                      { label: "Active", value: "active" },
                      { label: "Hidden", value: "hidden" },
                      { label: "Banned", value: "banned" },
                    ],
                  },
                ]}
              />

              <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
                {cards.length === 0 ? (
                  <AdminEmptyState title="No cards found" description="No cards match criteria" illustration="folder" />
                ) : (
                  <div className="divide-y divide-border-subtle">
                    {cards.map(card => {
                      const isExpanded = expandedCardId === card.id;
                      const directUrl = card.content_url && !card.content_url.startsWith("/api/objects/") ? card.content_url : null;

                      return (
                        <div key={card.id} className="border-b border-border-subtle last:border-0 hover:bg-glass-w5 transition-colors">
                          <div className="p-3 flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => setExpandedCardId(isExpanded ? null : card.id)}
                              className="text-retro-muted hover:text-retro-fg transition-transform shrink-0 cursor-pointer"
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4 text-cyan-300" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                            <AdminMediaThumbnail
                              objectId={card.media_object_id}
                              directUrl={directUrl}
                              identity={identity}
                              mimeType={card.mime_type}
                              title={card.name || card.id.slice(0, 8)}
                              subtitle={card.mime_type || "Media"}
                              className="w-10 h-10 shrink-0"
                              onZoom={onZoom}
                            />
                            <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setExpandedCardId(isExpanded ? null : card.id)}>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-retro-fg truncate">{card.name || card.id.slice(0, 12)}</span>
                                <Badge variant="neutral" size="sm">{card.rarity}</Badge>
                                <StatusBadge status={card.moderation_state} mapping={{ active: "active", hidden: "hidden", banned: "banned" }} size="sm" />
                              </div>
                              <p className="text-[10px] text-retro-muted truncate">
                                Value: {card.value} g$ · Likes: {card.like_count} · Creator: {card.creator_id.slice(0, 8)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <select
                                value={card.moderation_state}
                                onChange={e => { onAction("moderateCard", card.id, e.target.value); setTimeout(fetchCards, 300); }}
                                className="bg-surface-canvas border border-border-glass rounded px-2 py-1 text-[10px] outline-none focus:border-retro-accent cursor-pointer"
                              >
                                <option value="active">Active</option>
                                <option value="hidden">Hidden</option>
                                <option value="banned">Banned</option>
                              </select>
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="px-4 pb-4 pt-1 bg-surface-elevated/40 border-t border-border-subtle/50 flex flex-col md:flex-row gap-4 items-start animate-orbit-fade-in">
                              <div className="relative group shrink-0">
                                <AdminMediaThumbnail
                                  objectId={card.media_object_id}
                                  directUrl={directUrl}
                                  identity={identity}
                                  mimeType={card.mime_type}
                                  title={card.name || card.id}
                                  subtitle={card.mime_type}
                                  className="w-44 h-44 rounded-lg cursor-zoom-in"
                                  onZoom={onZoom}
                                />
                              </div>
                              <div className="flex-1 min-w-0 space-y-2 text-xs">
                                <div className="grid grid-cols-2 gap-2 bg-surface-canvas/60 p-2.5 rounded-lg border border-border-glass">
                                  <div>
                                    <span className="text-retro-muted block text-[10px]">Card ID</span>
                                    <span className="font-mono text-retro-fg text-[10px] break-all">{card.id}</span>
                                  </div>
                                  <div>
                                    <span className="text-retro-muted block text-[10px]">Creator ID</span>
                                    <span className="font-mono text-cyan-300 text-[10px] break-all">{card.creator_id}</span>
                                  </div>
                                  <div>
                                    <span className="text-retro-muted block text-[10px]">Rarity / Value</span>
                                    <span className="text-retro-fg font-bold uppercase">{card.rarity} · {card.value} g$</span>
                                  </div>
                                  <div>
                                    <span className="text-retro-muted block text-[10px]">Created At</span>
                                    <span className="text-retro-fg font-mono text-[10px]">{formatAbsoluteTime(card.created_at)}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {cardSection === "market" && (
            <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
              {marketplace.length === 0 ? (
                <AdminEmptyState title="No active listings" description="Marketplace is currently clear" illustration="folder" />
              ) : (
                <div className="divide-y divide-border-subtle">
                  {marketplace.map(m => (
                    <div key={m.id} className="p-3 flex items-center justify-between gap-3 hover:bg-glass-w5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-retro-fg">{m.name || m.card_id.slice(0, 10)}</span>
                          <Badge variant="info" size="sm">{m.status}</Badge>
                        </div>
                        <p className="text-[10px] text-retro-muted mt-0.5">
                          Seller: {m.seller_name || "Unknown"} · Price: <strong className="text-amber-400 font-mono">{m.price} g$</strong>
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {cardSection === "decks" && (
            <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
              {decks.length === 0 ? (
                <AdminEmptyState title="No decks found" description="No user decks constructed" illustration="folder" />
              ) : (
                <div className="divide-y divide-border-subtle">
                  {decks.map(d => (
                    <div key={d.id} className="p-3 flex items-center justify-between gap-3 hover:bg-glass-w5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-retro-fg">{d.name}</span>
                          <Badge variant="neutral" size="sm">{d.card_count} cards</Badge>
                        </div>
                        <p className="text-[10px] text-retro-muted mt-0.5">
                          Owner: {d.owner_name || "Player"} · Mode: {d.game_id}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Subtab 3: Wallets & Ledger */}
      {activeSubTab === "wallets_ledger" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border-glass pb-3">
            <button
              type="button"
              onClick={() => setWalletSection("wallets")}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer",
                walletSection === "wallets" ? "bg-glass-w10 text-retro-fg" : "text-retro-muted hover:text-retro-body"
              )}
            >
              Top Wallet Balances ({wallets.length})
            </button>
            <button
              type="button"
              onClick={() => setWalletSection("ledger")}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer",
                walletSection === "ledger" ? "bg-glass-w10 text-retro-fg" : "text-retro-muted hover:text-retro-body"
              )}
            >
              Transaction Ledger ({ledger.length})
            </button>
          </div>

          {walletSection === "wallets" ? (
            <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
              {wallets.length === 0 ? (
                <AdminEmptyState title="No wallets found" description="No wallet data available" illustration="folder" />
              ) : (
                <div className="divide-y divide-border-subtle">
                  {wallets.map(w => (
                    <div key={w.user_id} className="p-3 flex items-center justify-between gap-3 hover:bg-glass-w5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-retro-fg">{w.display_name || w.user_id.slice(0, 10)}</span>
                          <span className="text-[10px] text-retro-muted font-mono">{w.user_id}</span>
                        </div>
                        <p className="text-[10px] text-retro-muted mt-0.5">
                          {w.transaction_count} transaction{w.transaction_count === 1 ? '' : 's'} recorded
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="font-mono text-sm font-bold text-amber-400">{w.balance.toLocaleString()} g$</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
              {ledger.length === 0 ? (
                <AdminEmptyState title="No transactions" description="Ledger is currently empty" illustration="folder" />
              ) : (
                <div className="divide-y divide-border-subtle">
                  {ledger.map(l => (
                    <div key={l.id} className="p-3 flex items-center justify-between gap-3 hover:bg-glass-w5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="neutral" size="sm">{l.kind}</Badge>
                          <span className="text-xs font-bold text-retro-fg">{l.display_name || l.user_id.slice(0, 8)}</span>
                          <span className="text-[10px] text-retro-muted">{formatAbsoluteTime(l.created_at)}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={cn("font-mono text-xs font-bold", l.delta >= 0 ? "text-emerald-400" : "text-rose-400")}>
                          {l.delta >= 0 ? `+${l.delta}` : l.delta} g$
                        </span>
                        <div className="text-[10px] text-retro-muted font-mono">Bal: {l.balance_after} g$</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* User Modals */}
      {showBanModal && (
        <ConfirmDialog
          isOpen={true}
          onClose={() => setShowBanModal(null)}
          onConfirm={handleConfirmBan}
          title={`Ban ${showBanModal.user.display_name || showBanModal.user.id}?`}
          description="Banning this user restricts access and moderates their active content."
          confirmLabel="Enforce Ban"
          variant="danger"
        >
          <div className="mt-3 space-y-2 text-left">
            <label className="text-[10px] font-bold text-retro-muted uppercase block">Reason</label>
            <input
              type="text"
              value={banReason}
              onChange={e => setBanReason(e.target.value)}
              placeholder="e.g. Terms violation, inappropriate content..."
              className="w-full bg-surface-canvas border border-border-glass rounded px-3 py-1.5 text-xs text-retro-fg outline-none focus:border-red-500"
            />
            <label className="flex items-center gap-2 text-xs text-retro-muted cursor-pointer mt-2">
              <input
                type="checkbox"
                checked={banWipe}
                onChange={e => setBanWipe(e.target.checked)}
                className="rounded border-border-glass"
              />
              <span>Purge active public posts and lobby images</span>
            </label>
          </div>
        </ConfirmDialog>
      )}

      {showBalanceModal && (
        <ConfirmDialog
          isOpen={true}
          onClose={() => setShowBalanceModal(null)}
          onConfirm={handleSaveBalance}
          title={`Adjust Balances: ${showBalanceModal.user.display_name || showBalanceModal.user.id}`}
          description="Manually override user gameplay score, likes, followers, and currency."
          confirmLabel="Save Balances"
          variant="primary"
        >
          <div className="mt-3 grid grid-cols-2 gap-3 text-left">
            <div>
              <label className="text-[10px] font-bold text-retro-muted uppercase block">GCoins (g$)</label>
              <input
                type="number"
                value={balanceData.gcoins}
                onChange={e => setBalanceData(p => ({ ...p, gcoins: Number(e.target.value) || 0 }))}
                className="w-full bg-surface-canvas border border-border-glass rounded px-3 py-1.5 text-xs text-retro-fg font-mono outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-retro-muted uppercase block">Score (Points)</label>
              <input
                type="number"
                value={balanceData.score}
                onChange={e => setBalanceData(p => ({ ...p, score: Number(e.target.value) || 0 }))}
                className="w-full bg-surface-canvas border border-border-glass rounded px-3 py-1.5 text-xs text-retro-fg font-mono outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-retro-muted uppercase block">Likes Received</label>
              <input
                type="number"
                value={balanceData.likes}
                onChange={e => setBalanceData(p => ({ ...p, likes: Number(e.target.value) || 0 }))}
                className="w-full bg-surface-canvas border border-border-glass rounded px-3 py-1.5 text-xs text-retro-fg font-mono outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-retro-muted uppercase block">Followers</label>
              <input
                type="number"
                value={balanceData.followers}
                onChange={e => setBalanceData(p => ({ ...p, followers: Number(e.target.value) || 0 }))}
                className="w-full bg-surface-canvas border border-border-glass rounded px-3 py-1.5 text-xs text-retro-fg font-mono outline-none"
              />
            </div>
          </div>
        </ConfirmDialog>
      )}

      {showTagsModal && (
        <ConfirmDialog
          isOpen={true}
          onClose={() => setShowTagsModal(null)}
          onConfirm={handleSaveTags}
          title={`Edit Tags: ${showTagsModal.user.display_name || showTagsModal.user.id}`}
          description="Comma-separated interest tags for matchmaking and feed curation."
          confirmLabel="Save Tags"
          variant="primary"
        >
          <div className="mt-3 text-left">
            <input
              type="text"
              value={tagsInput}
              onChange={e => setTagsInput(e.target.value)}
              placeholder="e.g. anime, gaming, art..."
              className="w-full bg-surface-canvas border border-border-glass rounded px-3 py-1.5 text-xs text-retro-fg outline-none"
            />
          </div>
        </ConfirmDialog>
      )}

      {activeSubTab === "test_cleanup" && (
        <div className="space-y-4">
          <div className="bg-surface-canvas border border-border-glass rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-medium text-retro-fg">Purge E2E test accounts</h3>
            </div>
            <p className="text-xs text-retro-muted leading-relaxed">
              The test suite is meant to be hermetic, but earlier runs against a shared node left hundreds of
              spec accounts in the directory and in chat history. They are identifiable only by the
              <code className="font-mono bg-black/30 px-1 py-0.5 rounded mx-1">e2e</code>
              profile tag, since the suite mints anonymous keypairs. This removes every matching account and
              everything it created (objects, messages, cards, groups).
            </p>
            <p className="text-xs text-amber-300/80 leading-relaxed">
              Always preview first. The server refuses to delete anything unless deletion is explicitly
              requested, and refuses outright if an admin account matches.
            </p>

            <div className="flex items-end gap-2 flex-wrap">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-retro-muted">Batch size (optional)</span>
                <input
                  type="number"
                  min={1}
                  value={purgeLimit}
                  onChange={e => setPurgeLimit(e.target.value)}
                  placeholder="all"
                  className="w-32 bg-surface-raised border border-border-glass rounded px-2.5 py-1.5 text-xs text-retro-fg outline-none"
                />
              </label>
              <button
                type="button"
                onClick={() => void runPurgePreview()}
                disabled={purgeBusy}
                className="px-3 py-1.5 rounded-md text-xs font-bold bg-surface-raised border border-border-glass text-retro-fg hover:border-retro-accent/60 disabled:opacity-40 cursor-pointer"
              >
                {purgeBusy ? "Working…" : "Preview"}
              </button>
            </div>

            {purgePreview && (
              <div className="rounded-md border border-border-glass bg-surface-raised/50 p-3 space-y-2">
                <div className="text-xs text-retro-fg font-mono">
                  {purgePreview.matched} account(s) tagged “{purgePreview.tag}”
                  {purgePreview.wouldDelete !== purgePreview.matched && (
                    <> — this batch would remove {purgePreview.wouldDelete}</>
                  )}
                </div>
                {purgePreview.sample.length > 0 && (
                  <ul className="text-[10px] font-mono text-retro-muted space-y-0.5">
                    {purgePreview.sample.map(s => (
                      <li key={s.id} className="truncate">
                        {s.display_name || "User_…"} · {s.id.slice(0, 16)}
                      </li>
                    ))}
                    {purgePreview.matched > purgePreview.sample.length && (
                      <li>…and {purgePreview.matched - purgePreview.sample.length} more</li>
                    )}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm(`Permanently delete ${purgePreview.wouldDelete} E2E account(s) and all their content? This cannot be undone.`)) return;
                    void runPurge();
                  }}
                  disabled={purgeBusy || purgePreview.wouldDelete === 0}
                  className="px-3 py-1.5 rounded-md text-xs font-bold bg-red-600/80 hover:bg-red-600 text-white disabled:opacity-40 cursor-pointer"
                >
                  {purgeBusy ? "Deleting…" : `Delete ${purgePreview.wouldDelete} account(s)`}
                </button>
              </div>
            )}

            {purgeResult && <div className="text-xs text-retro-fg">{purgeResult}</div>}
          </div>
        </div>
      )}

      {detailUser && (
        <DetailModal
          isOpen={true}
          onClose={() => setDetailUser(null)}
          title={`User: ${detailUser.display_name || detailUser.id}`}
          data={detailUser as Record<string, unknown>}
        />
      )}
    </div>
  );
}
