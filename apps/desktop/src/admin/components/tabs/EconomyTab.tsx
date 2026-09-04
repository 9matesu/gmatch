"use client";

import {  AdminFilterBar, AdminEmptyState, AdminLoadingState, Badge, StatusBadge, DetailModal } from "../../../components/admin/primitives";
import { adminApi } from "../../../utils/adminApi";
import { useState, useCallback, useEffect } from "react";
import { CreditCard, Wallet, ListChecks, ShoppingBag, Layers, Trash2, Eye,  Ban, DollarSign, ArrowUp, ArrowDown,   ChevronDown, ChevronUp, Maximize2 } from "lucide-react";
import { cn } from "../../../lib/utils";
import { AdminMediaThumbnail } from "../AdminMediaThumbnail";
import type { AdminCard, TableParams } from "../../../utils/adminTypes";
import type { OrbitIdentity } from "@orbit/crypto";

interface EconomyTabProps {
  identity: OrbitIdentity | null;
  pinVerified: boolean;
  onZoom: (url: string, isVideo: boolean, title: string, subtitle: string) => void;
  onAction: (action: string, ...args: unknown[]) => void;
}

const subTabs = [
  { id: "cards", label: "Cards", icon: CreditCard },
  { id: "wallets", label: "Wallets", icon: Wallet },
  { id: "ledger", label: "Ledger", icon: ListChecks },
  { id: "marketplace", label: "Marketplace", icon: ShoppingBag },
  { id: "decks", label: "Decks", icon: Layers },
] as const;

type SubTab = typeof subTabs[number]["id"];

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function EconomyTab({ identity, pinVerified, onZoom, onAction }: EconomyTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("cards");
  const [cards, setCards] = useState<AdminCard[]>([]);
  const [cardsTotal, setCardsTotal] = useState(0);
  const [wallets, setWallets] = useState<Array<{ user_id: string; display_name?: string | null; balance: number; transaction_count: number }>>([]);
  const [ledger, setLedger] = useState<Array<{ id: string; user_id: string; display_name?: string | null; kind: string; delta: number; balance_after: number; created_at: string }>>([]);
  const [marketplace, setMarketplace] = useState<Array<{ id: string; card_id: string; seller_name?: string | null; price: number; status: string; name?: string | null }>>([]);
  const [decks, setDecks] = useState<Array<{ id: string; owner_name?: string | null; name: string; game_id: string; card_count: number }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [cardsParams, setCardsParams] = useState<TableParams>({ page: 1, pageSize: 50, filters: {} });
  const [walletsParams, setWalletsParams] = useState<TableParams>({ page: 1, pageSize: 50 });
  const [ledgerParams, setLedgerParams] = useState<TableParams>({ page: 1, pageSize: 100 });
  const [marketParams, setMarketParams] = useState<TableParams>({ page: 1, pageSize: 50, filters: { status: "open" } });
  const [decksParams, setDecksParams] = useState<TableParams>({ page: 1, pageSize: 100 });
  const [selectedCard, setSelectedCard] = useState<AdminCard | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  const fetchCards = useCallback(async () => {
    if (!identity || !pinVerified) return;
    try {
      const response = await adminApi.cards(identity, cardsParams);
      const rows = asArray(response.data);
      setCards(rows);
      setCardsTotal(response.total || rows.length);
    } catch {
    }
  }, [identity, pinVerified, cardsParams]);

  const fetchWallets = useCallback(async () => {
    if (!identity || !pinVerified) return;
    try {
      const response = await adminApi.wallets(identity, walletsParams);
      setWallets(asArray(response.data));
    } catch {
    }
  }, [identity, pinVerified, walletsParams]);

  const fetchLedger = useCallback(async () => {
    if (!identity || !pinVerified) return;
    try {
      const response = await adminApi.ledger(identity, ledgerParams);
      setLedger(asArray(response.data));
    } catch {
    }
  }, [identity, pinVerified, ledgerParams]);

  const fetchMarket = useCallback(async () => {
    if (!identity || !pinVerified) return;
    try {
      const response = await adminApi.marketplace(identity, marketParams);
      setMarketplace(asArray(response.data));
    } catch {
    }
  }, [identity, pinVerified, marketParams]);

  const fetchDecks = useCallback(async () => {
    if (!identity || !pinVerified) return;
    try {
      const response = await adminApi.decks(identity, decksParams);
      setDecks(asArray(response.data));
    } catch {
    }
  }, [identity, pinVerified, decksParams]);

  useEffect(() => {
    if (activeSubTab === "cards") fetchCards();
  }, [activeSubTab, fetchCards]);

  useEffect(() => {
    if (activeSubTab === "wallets") fetchWallets();
  }, [activeSubTab, fetchWallets]);

  useEffect(() => {
    if (activeSubTab === "ledger") fetchLedger();
  }, [activeSubTab, fetchLedger]);

  useEffect(() => {
    if (activeSubTab === "marketplace") fetchMarket();
  }, [activeSubTab, fetchMarket]);

  useEffect(() => {
    if (activeSubTab === "decks") fetchDecks();
  }, [activeSubTab, fetchDecks]);

  const renderCardRow = (card: AdminCard) => {
    const directUrl = card.content_url && !card.content_url.startsWith("/api/objects/") ? card.content_url : null;
    const isExpanded = expandedId === card.id;

    return (
      <div key={card.id} className="border-b border-border-subtle last:border-0 hover:bg-white/5 transition-colors">
        <div className="p-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => toggleExpand(card.id)}
            className="text-retro-muted hover:text-retro-fg transition-transform shrink-0"
            title={isExpanded ? "Collapse" : "Expand preview"}
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
            className="w-10 h-10"
            onZoom={onZoom}
          />
          <div className="min-w-0 flex-1 cursor-pointer" onClick={() => toggleExpand(card.id)}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-retro-fg truncate">{card.name || card.id.slice(0, 12)}</span>
              <Badge variant="neutral" size="sm">{card.rarity}</Badge>
              <StatusBadge status={card.moderation_state} mapping={{ active: "active", hidden: "hidden", banned: "banned" }} size="sm" />
            </div>
            <p className="text-[10px] text-retro-muted truncate">
              Value: {card.value} g$ · Likes: {card.like_count} · {card.market_status} · Creator: {card.creator_id.slice(0, 8)}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-retro-muted shrink-0">
            <button
              type="button"
              onClick={() => { setSelectedCard(card); }}
              className="p-1.5 rounded hover:bg-white/10 text-retro-muted hover:text-cyan-300"
              title="Inspect Details"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
            <select
              value={card.moderation_state}
              onChange={e => onAction("moderateCard", card.id, e.target.value)}
              className="bg-surface-canvas border border-border-glass rounded px-2 py-1 text-[10px] outline-none focus:border-retro-accent"
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
                className="w-48 h-48 md:w-56 md:h-56 rounded-lg cursor-zoom-in"
                onZoom={onZoom}
              />
              <button
                type="button"
                onClick={() => onZoom(directUrl || `/api/objects/${card.media_object_id}/content`, Boolean(card.mime_type?.startsWith("video/")), card.name || card.id, card.mime_type || "Media")}
                className="absolute bottom-2 right-2 px-2 py-1 bg-black/70 hover:bg-black text-white text-[10px] rounded flex items-center gap-1 border border-border-glass opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Maximize2 className="w-3 h-3" /> Full View
              </button>
            </div>
            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] bg-surface-canvas/60 p-2.5 rounded-lg border border-border-glass">
                <div>
                  <span className="text-retro-muted block text-[10px]">Card ID</span>
                  <span className="font-mono text-retro-fg break-all text-[10px]">{card.id}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Creator ID</span>
                  <span className="font-mono text-cyan-300 break-all text-[10px]">{card.creator_id}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Owner</span>
                  <span className="font-semibold text-retro-fg">{card.owner_name || card.owner_id?.slice(0, 10) || "None"}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Rarity / Value</span>
                  <span className="text-retro-fg font-bold uppercase tracking-wider">{card.rarity} · {card.value} g$</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Market Status</span>
                  <span className="text-retro-fg capitalize">{card.market_status}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Created At</span>
                  <span className="text-retro-fg font-mono">{new Date(card.created_at).toLocaleString()}</span>
                </div>
              </div>
              {card.caption && (
                <div className="text-xs bg-surface-canvas/40 p-2 rounded border border-border-glass">
                  <span className="text-retro-muted text-[10px] block mb-0.5">Caption:</span>
                  <p className="text-retro-fg font-sans">{card.caption}</p>
                </div>
              )}
              <div className="pt-2 flex flex-wrap gap-2 items-center">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-retro-muted">Moderation:</span>
                  <select
                    value={card.moderation_state}
                    onChange={e => onAction("moderateCard", card.id, e.target.value)}
                    className="bg-surface-canvas border border-border-glass rounded px-2.5 py-1 text-xs font-semibold outline-none focus:border-retro-accent"
                  >
                    <option value="active">Active (Visible)</option>
                    <option value="hidden">Hidden (Shadowbanned)</option>
                    <option value="banned">Banned (Blocked)</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => onAction("banUser", card.creator_id, "Inappropriate card content in " + card.id)}
                  className="px-2.5 py-1.5 rounded text-xs font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 flex items-center gap-1.5 transition-colors"
                >
                  <Ban className="w-3.5 h-3.5" />
                  Ban Creator
                </button>
                {card.media_object_id && (
                  <button
                    type="button"
                    onClick={() => onAction("deleteObject", card.media_object_id)}
                    className="px-2.5 py-1.5 rounded text-xs font-bold bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Backing Media
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderWalletRow = (wallet: { user_id: string; display_name?: string | null; balance: number; transaction_count: number }) => (
    <div key={wallet.user_id} className="border-b border-border-subtle last:border-0 p-3 hover:bg-white/5 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-surface-interactive border border-border-glass flex items-center justify-center">
            <DollarSign className="w-4 h-4 text-retro-muted" />
          </div>
          <div>
            <p className="text-xs font-semibold text-retro-fg truncate">{wallet.display_name || wallet.user_id.slice(0, 12)}</p>
            <p className="text-[10px] text-retro-muted font-mono">{wallet.user_id.slice(0, 12)}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <span className="font-mono text-retro-fg text-lg">${wallet.balance.toLocaleString()}</span>
          <Badge variant="neutral" size="sm">{wallet.transaction_count} txns</Badge>
        </div>
      </div>
    </div>
  );

  const renderLedgerRow = (entry: { id: string; user_id: string; display_name?: string | null; kind: string; delta: number; balance_after: number; created_at: string }) => (
    <div key={entry.id} className="border-b border-border-subtle last:border-0 p-3 hover:bg-white/5 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-surface-interactive border border-border-glass flex items-center justify-center">
            {entry.delta > 0 ? <ArrowUp className="w-4 h-4 text-emerald-400" /> : <ArrowDown className="w-4 h-4 text-red-400" />}
          </div>
          <div>
            <p className="text-xs font-semibold text-retro-fg truncate">{entry.display_name || entry.user_id.slice(0, 12)}</p>
            <p className="text-[10px] text-retro-muted font-mono">{entry.kind}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <span className={cn("font-mono", entry.delta > 0 ? "text-emerald-400" : "text-red-400")}>
            {entry.delta > 0 ? "+" : ""}${entry.delta.toLocaleString()}
          </span>
          <span className="font-mono text-retro-muted">Bal: ${entry.balance_after.toLocaleString()}</span>
          <span className="text-[10px] text-retro-muted">{new Date(entry.created_at).toLocaleString()}</span>
        </div>
      </div>
    </div>
  );

  const renderMarketRow = (listing: { id: string; card_id: string; seller_name?: string | null; price: number; status: string; name?: string | null }) => (
    <div key={listing.id} className="border-b border-border-subtle last:border-0 p-3 hover:bg-white/5 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-surface-interactive border border-border-glass flex items-center justify-center">
            <ShoppingBag className="w-4 h-4 text-retro-muted" />
          </div>
          <div>
            <p className="text-xs font-semibold text-retro-fg truncate">{listing.name || listing.card_id.slice(0, 12)}</p>
            <p className="text-[10px] text-retro-muted">Seller: {listing.seller_name || "Unknown"} · Card: {listing.card_id.slice(0, 8)}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <span className="font-mono text-retro-fg">${listing.price.toLocaleString()}</span>
          <StatusBadge status={listing.status} mapping={{ open: "active", sold: "success", cancelled: "danger", expired: "warning" }} size="sm" />
        </div>
      </div>
    </div>
  );

  const renderDeckRow = (deck: { id: string; owner_name?: string | null; name: string; game_id: string; card_count: number }) => (
    <div key={deck.id} className="border-b border-border-subtle last:border-0 p-3 hover:bg-white/5 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-surface-interactive border border-border-glass flex items-center justify-center">
            <Layers className="w-4 h-4 text-retro-muted" />
          </div>
          <div>
            <p className="text-xs font-semibold text-retro-fg truncate">{deck.name}</p>
            <p className="text-[10px] text-retro-muted">{deck.owner_name || "Unknown"} · {deck.card_count} cards · Game: {deck.game_id}</p>
          </div>
        </div>
        <div className="shrink-0">
          <Badge variant="neutral" size="sm">{deck.card_count} cards</Badge>
        </div>
      </div>
    </div>
  );

  if (isLoading && cards.length === 0 && wallets.length === 0 && ledger.length === 0 && marketplace.length === 0 && decks.length === 0) {
    return <AdminLoadingState rows={5} columns={4} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-retro-fg">Cards & Economy</h1>
          <p className="text-xs text-retro-muted mt-1">Inspect canonical ownership, valuation, listings, and in-loco card moderation</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 bg-surface-raised border border-border-glass rounded-xl p-1">
        {subTabs.map(tab => {
          const Icon = tab.icon;
          const active = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => { setActiveSubTab(tab.id); setExpandedId(null); }}
              className={cn(
                "px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5",
                active
                  ? "bg-retro-accent text-retro-accent-text"
                  : "text-retro-muted hover:text-retro-fg"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeSubTab === "cards" && (
        <div className="space-y-4">
          <AdminFilterBar
            filters={cardsParams.filters || {}}
            onFiltersChange={filters => setCardsParams(p => ({ ...p, filters, page: 1 }))}
            configs={[
              { key: "q", label: "Search", type: "text", placeholder: "Card name, ID, owner..." },
              { key: "owner", label: "Owner ID", type: "text", placeholder: "Filter by owner" },
              { key: "moderation_state", label: "Moderation", type: "select", options: [
                { value: "", label: "All" },
                { value: "active", label: "Active" },
                { value: "hidden", label: "Hidden" },
                { value: "banned", label: "Banned" },
              ]},
            ]}
            searchValue=""
            onSearchChange={() => {}}
            showSearch={false}
          />
          <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
            <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider">Cards ({cardsTotal})</h2>
            </div>
            {cards.length === 0 ? (
              <AdminEmptyState title="No cards" description="Cards will appear here" illustration="folder" />
            ) : (
              <div className="divide-y divide-border-subtle">
                {cards.map(renderCardRow)}
              </div>
            )}
          </div>
        </div>
      )}

      {activeSubTab === "wallets" && (
        <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
          <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider">User Wallets</h2>
          </div>
          {wallets.length === 0 ? (
            <AdminEmptyState title="No wallets" description="User wallets will appear here" illustration="folder" />
          ) : (
            <div className="divide-y divide-border-subtle">
              {wallets.map(renderWalletRow)}
            </div>
          )}
        </div>
      )}

      {activeSubTab === "ledger" && (
        <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
          <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider">Ledger Transactions</h2>
          </div>
          {ledger.length === 0 ? (
            <AdminEmptyState title="No transactions" description="Ledger entries will appear here" illustration="folder" />
          ) : (
            <div className="divide-y divide-border-subtle">
              {ledger.map(renderLedgerRow)}
            </div>
          )}
        </div>
      )}

      {activeSubTab === "marketplace" && (
        <div className="space-y-4">
          <AdminFilterBar
            filters={marketParams.filters || {}}
            onFiltersChange={filters => setMarketParams(p => ({ ...p, filters, page: 1 }))}
            configs={[
              { key: "status", label: "Status", type: "select", options: [
                { value: "open", label: "Open" },
                { value: "sold", label: "Sold" },
                { value: "cancelled", label: "Cancelled" },
                { value: "expired", label: "Expired" },
                { value: "", label: "All" },
              ]},
            ]}
            searchValue=""
            onSearchChange={() => {}}
            showSearch={false}
          />
          <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
            <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider">Marketplace Listings</h2>
            </div>
            {marketplace.length === 0 ? (
              <AdminEmptyState title="No listings" description="Marketplace listings will appear here" illustration="folder" />
            ) : (
              <div className="divide-y divide-border-subtle">
                {marketplace.map(renderMarketRow)}
              </div>
            )}
          </div>
        </div>
      )}

      {activeSubTab === "decks" && (
        <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
          <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider">User Decks</h2>
          </div>
          {decks.length === 0 ? (
            <AdminEmptyState title="No decks" description="User decks will appear here" illustration="folder" />
          ) : (
            <div className="divide-y divide-border-subtle">
              {decks.map(renderDeckRow)}
            </div>
          )}
        </div>
      )}

      {selectedCard && (
        <DetailModal
          isOpen={true}
          onClose={() => setSelectedCard(null)}
          title={selectedCard.name || selectedCard.id.slice(0, 12)}
          subtitle={`Rarity: ${selectedCard.rarity} · Value: ${selectedCard.value} g$ · ${selectedCard.moderation_state}`}
          size="lg"
        >
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <AdminMediaThumbnail
                objectId={selectedCard.media_object_id}
                directUrl={selectedCard.content_url && !selectedCard.content_url.startsWith("/api/objects/") ? selectedCard.content_url : null}
                identity={identity}
                mimeType={selectedCard.mime_type}
                title={selectedCard.name || selectedCard.id.slice(0, 12)}
                subtitle={selectedCard.mime_type || "Media"}
                className="w-32 h-32"
                fallbackLabel="N/A"
              />
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="neutral">{selectedCard.rarity}</Badge>
                  <StatusBadge status={selectedCard.moderation_state} mapping={{ active: "active", hidden: "hidden", banned: "banned" }} />
                  <Badge variant="neutral">{selectedCard.market_status}</Badge>
                </div>
                <p className="text-xs text-retro-muted font-mono">ID: {selectedCard.id}</p>
                <p className="text-xs text-retro-muted">Creator: {selectedCard.creator_id.slice(0, 12)}</p>
                <p className="text-xs text-retro-muted">Owner: {selectedCard.owner_name || selectedCard.owner_id?.slice(0, 12) || "None"}</p>
                <p className="text-xs text-retro-muted">Value: {selectedCard.value} g$ · Likes: {selectedCard.like_count}</p>
                <p className="text-xs text-retro-muted">Created: {new Date(selectedCard.created_at).toLocaleString()}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-border-glass">
              <select
                value={selectedCard.moderation_state}
                onChange={e => onAction("moderateCard", selectedCard.id, e.target.value)}
                className="bg-surface-canvas border border-border-glass rounded px-3 py-2 text-xs outline-none focus:border-retro-accent"
              >
                <option value="active">Active</option>
                <option value="hidden">Hidden</option>
                <option value="banned">Banned</option>
              </select>
            </div>
          </div>
        </DetailModal>
      )}
    </div>
  );
}
