"use client";

import {  AdminFilterBar, AdminEmptyState, AdminLoadingState, Badge, StatusBadge } from "../../../components/admin/primitives";
import { adminApi } from "../../../utils/adminApi";
import { useState, useCallback, useEffect } from "react";
import {  History, Layers,  Play,       ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "../../../lib/utils";
import { AdminMediaThumbnail } from "../AdminMediaThumbnail";
import type { AdminMatch, AdminArchivedMatch, AdminTierMatch, AdminRoom, AdminBabecockRound, TableParams } from "../../../utils/adminTypes";
import type { OrbitIdentity } from "@orbit/crypto";

interface GamesTabProps {
  identity: OrbitIdentity | null;
  pinVerified: boolean;
  onZoom: (url: string, isVideo: boolean, title: string, subtitle: string) => void;
  onAction: (action: string, ...args: unknown[]) => void;
}

const subTabs = [
  { id: "live", label: "Live Matches", icon: Play },
  { id: "archive", label: "Match Archive", icon: History },
  { id: "tiers", label: "Tier Matches", icon: Layers },
  { id: "rooms", label: "Rooms & Babecock", icon: Layers },
] as const;

type SubTab = typeof subTabs[number]["id"];

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function GamesTab({ identity, pinVerified, onZoom, onAction }: GamesTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("live");
  const [matches, setMatches] = useState<AdminMatch[]>([]);
  const [archivedMatches, setArchivedMatches] = useState<AdminArchivedMatch[]>([]);
  const [archiveTotal, setArchiveTotal] = useState(0);
  const [specialMatches, setSpecialMatches] = useState<AdminTierMatch[]>([]);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [babecockRounds, setBabecockRounds] = useState<AdminBabecockRound[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [archiveParams, setArchiveParams] = useState<TableParams>({ page: 1, pageSize: 30 });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  const fetchData = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const [matchesRes, specialRes, roomsRes, babecockRes] = await Promise.all([
        adminApi.matches(identity),
        adminApi.specialMatches(identity),
        adminApi.rooms(identity),
        adminApi.babecock(identity),
      ]);
      setMatches(asArray(matchesRes));
      setSpecialMatches(asArray(specialRes));
      setRooms(asArray(roomsRes));
      setBabecockRounds(asArray(babecockRes));
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified]);

  const fetchArchive = useCallback(async () => {
    if (!identity || !pinVerified) return;
    try {
      const response = await adminApi.matchArchive(identity, archiveParams);
      const rows = asArray(response.data);
      setArchivedMatches(rows);
      setArchiveTotal(response.total || rows.length);
    } catch {
    }
  }, [identity, pinVerified, archiveParams]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    if (activeSubTab === "archive") fetchArchive();
  }, [activeSubTab, fetchArchive]);

  const renderMatchCard = (match: AdminMatch) => {
    const isExpanded = expandedId === match.id;
    const objectProtectedA = match.card_a ? true : false;
    const objectProtectedB = match.card_b ? true : false;

    return (
      <div key={match.id} className="border-b border-border-subtle last:border-0 hover:bg-glass-w5 transition-colors">
        <div className="p-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => toggleExpand(match.id)}
            className="text-retro-muted hover:text-retro-fg transition-transform shrink-0"
            title={isExpanded ? "Collapse" : "Expand match"}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4 text-cyan-300" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <div className="flex items-center gap-2 shrink-0">
            <AdminMediaThumbnail
              objectId={objectProtectedA ? (match.card_a ?? null) : null}
              directUrl={match.card_a_url}
              identity={identity}
              title={match.user_a_name || match.user_a.slice(0, 8)}
              subtitle="Player A Card"
              fallbackLabel="A"
              className="w-10 h-10"
              onZoom={onZoom}
            />
            <AdminMediaThumbnail
              objectId={objectProtectedB ? (match.card_b ?? null) : null}
              directUrl={match.card_b_url}
              identity={identity}
              title={match.user_b_name || match.user_b.slice(0, 8)}
              subtitle="Player B Card"
              fallbackLabel="B"
              className="w-10 h-10"
              onZoom={onZoom}
            />
          </div>
          <div className="min-w-0 flex-1 cursor-pointer" onClick={() => toggleExpand(match.id)}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-retro-fg truncate">{match.user_a_name || match.user_a.slice(0, 8)} vs {match.user_b_name || match.user_b.slice(0, 8)}</span>
              <StatusBadge status={match.status} />
              <StatusBadge status={match.phase} mapping={{ lobby: "pending", playing: "active", ended: "completed" }} />
            </div>
            <p className="text-[10px] text-retro-muted mt-0.5">
              Score: {match.score_a} - {match.score_b} · Round {match.round_seq}/{match.max_rounds}
              {match.phase_deadline && ` · Deadline: ${new Date(match.phase_deadline).toLocaleTimeString()}`}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {match.status === "playing" && (
              <button
                type="button"
                onClick={() => onAction("forceEnd", match.id)}
                className="px-2 py-1 text-[10px] rounded border border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
              >
                Force End
              </button>
            )}
            {match.status === "lobby" && (
              <button
                type="button"
                onClick={() => onAction("cancel", match.id)}
                className="px-2 py-1 text-[10px] rounded border border-red-500/30 text-red-300 hover:bg-red-500/10"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={() => onAction("override", match.id)}
              className="px-2 py-1 text-[10px] rounded border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10"
            >
              Override
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="px-4 pb-4 pt-1 bg-surface-elevated/40 border-t border-border-subtle/50 space-y-3 animate-orbit-fade-in">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-surface-canvas/60 p-3 rounded-lg border border-border-glass space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-cyan-300 uppercase">Player A: {match.user_a_name || match.user_a.slice(0, 8)}</span>
                  <span className="text-xs font-mono font-bold text-retro-fg">Score: {match.score_a || 0}</span>
                </div>
                <div className="flex items-start gap-3">
                  <AdminMediaThumbnail
                    objectId={objectProtectedA ? (match.card_a ?? null) : null}
                    directUrl={match.card_a_url}
                    identity={identity}
                    title={`Player A: ${match.user_a_name || match.user_a}`}
                    subtitle="Card A"
                    fallbackLabel="Card A"
                    className="w-32 h-32 rounded-lg cursor-zoom-in"
                    onZoom={onZoom}
                  />
                  <div className="text-[10px] space-y-1 font-mono text-retro-muted min-w-0 flex-1">
                    <p className="break-all"><strong className="text-retro-fg">User ID:</strong> {match.user_a}</p>
                    <p className="break-all"><strong className="text-retro-fg">Card ID:</strong> {match.card_a || "None"}</p>
                  </div>
                </div>
              </div>

              <div className="bg-surface-canvas/60 p-3 rounded-lg border border-border-glass space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-purple-300 uppercase">Player B: {match.user_b_name || match.user_b.slice(0, 8)}</span>
                  <span className="text-xs font-mono font-bold text-retro-fg">Score: {match.score_b || 0}</span>
                </div>
                <div className="flex items-start gap-3">
                  <AdminMediaThumbnail
                    objectId={objectProtectedB ? (match.card_b ?? null) : null}
                    directUrl={match.card_b_url}
                    identity={identity}
                    title={`Player B: ${match.user_b_name || match.user_b}`}
                    subtitle="Card B"
                    fallbackLabel="Card B"
                    className="w-32 h-32 rounded-lg cursor-zoom-in"
                    onZoom={onZoom}
                  />
                  <div className="text-[10px] space-y-1 font-mono text-retro-muted min-w-0 flex-1">
                    <p className="break-all"><strong className="text-retro-fg">User ID:</strong> {match.user_b}</p>
                    <p className="break-all"><strong className="text-retro-fg">Card ID:</strong> {match.card_b || "None"}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border-glass text-xs">
              <span className="text-[10px] text-retro-muted font-mono">Match ID: {match.id} · Created: {new Date(match.created_at).toLocaleString()}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onAction("override", match.id, "winner_a")}
                  className="px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 font-bold text-xs"
                >
                  Win Player A
                </button>
                <button
                  type="button"
                  onClick={() => onAction("override", match.id, "winner_b")}
                  className="px-2.5 py-1 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 font-bold text-xs"
                >
                  Win Player B
                </button>
                <button
                  type="button"
                  onClick={() => onAction("override", match.id, "draw")}
                  className="px-2.5 py-1 rounded bg-surface-interactive text-retro-fg border border-border-glass hover:bg-glass-w10 font-bold text-xs"
                >
                  Draw
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderArchiveRow = (match: AdminArchivedMatch) => {
    const isExpanded = expandedId === match.id;

    return (
      <div key={match.id} className="border-b border-border-subtle last:border-0 hover:bg-glass-w5 transition-colors">
        <div className="p-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => toggleExpand(match.id)}
            className="text-retro-muted hover:text-retro-fg transition-transform shrink-0"
            title={isExpanded ? "Collapse" : "Expand archived match"}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4 text-cyan-300" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <div className="min-w-0 flex-1 cursor-pointer" onClick={() => toggleExpand(match.id)}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-retro-fg truncate">{match.user_a_name || match.user_a.slice(0, 8)} vs {match.user_b_name || match.user_b.slice(0, 8)}</span>
              <StatusBadge status={match.result} mapping={{ winner_a: "success", winner_b: "success", draw: "info", forfeit_a: "warning", forfeit_b: "warning", no_match: "neutral", admin_cancelled: "danger" }} />
            </div>
            <p className="text-[10px] text-retro-muted mt-0.5">
              Score: {match.score_a} - {match.score_b} · Matched: {match.matched} · Perfect: {match.perfect} · {new Date(match.ended_at).toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            onClick={() => toggleExpand(match.id)}
            className="px-2 py-1 text-[10px] rounded border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10"
          >
            {isExpanded ? "Hide Details" : "View Details"}
          </button>
        </div>

        {isExpanded && (
          <div className="px-4 pb-4 pt-1 bg-surface-elevated/40 border-t border-border-subtle/50 space-y-3 animate-orbit-fade-in">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-surface-canvas/60 p-2.5 rounded-lg border border-border-glass">
              <div>
                <span className="text-retro-muted block text-[10px]">Match ID</span>
                <span className="font-mono text-retro-fg break-all text-[10px]">{match.id}</span>
              </div>
              <div>
                <span className="text-retro-muted block text-[10px]">Result</span>
                <span className="font-bold text-retro-fg capitalize">{match.result.replace(/_/g, " ")}</span>
              </div>
              <div>
                <span className="text-retro-muted block text-[10px]">Score</span>
                <span className="font-mono text-retro-fg">{match.score_a} - {match.score_b}</span>
              </div>
              <div>
                <span className="text-retro-muted block text-[10px]">Ended At</span>
                <span className="font-mono text-retro-fg">{new Date(match.ended_at).toLocaleString()}</span>
              </div>
            </div>

            {match.rounds_history && match.rounds_history.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-retro-muted uppercase tracking-wider block">Rounds History ({match.rounds_history.length})</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {match.rounds_history.map(r => (
                    <div key={r.round} className="p-2 bg-surface-canvas/80 border border-border-glass rounded-md flex items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <AdminMediaThumbnail
                          objectId={r.card_a}
                          directUrl={r.card_a_url}
                          identity={identity}
                          title={`Round ${r.round} Card A`}
                          subtitle={match.user_a_name || "A"}
                          fallbackLabel="A"
                          className="w-12 h-12"
                          onZoom={onZoom}
                        />
                        <AdminMediaThumbnail
                          objectId={r.card_b}
                          directUrl={r.card_b_url}
                          identity={identity}
                          title={`Round ${r.round} Card B`}
                          subtitle={match.user_b_name || "B"}
                          fallbackLabel="B"
                          className="w-12 h-12"
                          onZoom={onZoom}
                        />
                      </div>
                      <div className="min-w-0 flex-1 text-[10px]">
                        <p className="font-bold text-retro-fg">Round {r.round}</p>
                        <p className="text-retro-muted">{r.decision_a || "—"} vs {r.decision_b || "—"}</p>
                        <p className={cn("font-semibold", r.matched ? "text-emerald-400" : "text-retro-muted")}>{r.matched ? "Matched ♥" : "No Match"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderTierMatch = (match: AdminTierMatch) => {
    const isExpanded = expandedId === match.id;

    return (
      <div key={match.id} className="border-b border-border-subtle last:border-0 hover:bg-glass-w5 transition-colors">
        <div className="p-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => toggleExpand(match.id)}
            className="text-retro-muted hover:text-retro-fg transition-transform shrink-0"
            title={isExpanded ? "Collapse" : "Expand tier match"}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4 text-cyan-300" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="primary" size="sm">Tier {match.tier}</Badge>
            <StatusBadge status={match.status} />
          </div>
          <div className="min-w-0 flex-1 cursor-pointer" onClick={() => toggleExpand(match.id)}>
            <p className="text-xs font-semibold text-retro-fg truncate">{match.user_a_name || match.user_a.slice(0, 8)} vs {match.user_b_name || match.user_b.slice(0, 8)}</p>
            <p className="text-[10px] text-retro-muted">Last: {match.last_result || "—"} · {new Date(match.updated_at).toLocaleString()}</p>
          </div>
          <button
            type="button"
            onClick={() => onAction("endTier", match.id)}
            className="px-2 py-1 text-[10px] rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 shrink-0"
          >
            End Match
          </button>
        </div>

        {isExpanded && (
          <div className="px-4 pb-4 pt-1 bg-surface-elevated/40 border-t border-border-subtle/50 flex flex-col sm:flex-row gap-4 items-center animate-orbit-fade-in">
            <div className="flex items-center gap-3">
              <AdminMediaThumbnail
                objectId={match.card_a || match.last_card_a}
                directUrl={match.card_a_url || match.last_card_a_url}
                identity={identity}
                title={`Player A: ${match.user_a_name || match.user_a}`}
                subtitle="Tier Match Card"
                fallbackLabel="A"
                className="w-28 h-28 rounded-lg cursor-zoom-in"
                onZoom={onZoom}
              />
              <AdminMediaThumbnail
                objectId={match.card_b || match.last_card_b}
                directUrl={match.card_b_url || match.last_card_b_url}
                identity={identity}
                title={`Player B: ${match.user_b_name || match.user_b}`}
                subtitle="Tier Match Card"
                fallbackLabel="B"
                className="w-28 h-28 rounded-lg cursor-zoom-in"
                onZoom={onZoom}
              />
            </div>
            <div className="flex-1 min-w-0 space-y-1 text-xs">
              <p className="text-retro-muted font-mono text-[10px]">Tier Match ID: {match.id}</p>
              <p className="text-retro-fg"><strong className="text-cyan-300">Player A:</strong> {match.user_a} ({match.decision_a || "No decision"})</p>
              <p className="text-retro-fg"><strong className="text-purple-300">Player B:</strong> {match.user_b} ({match.decision_b || "No decision"})</p>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderRoom = (room: AdminRoom) => (
    <div key={room.id} className="border-b border-border-subtle last:border-0 p-3 hover:bg-glass-w5 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-retro-fg truncate">{room.name}</p>
          <p className="text-[10px] text-retro-muted">{room.owner_name || "Unknown"} · {room.player_count}/{room.capacity} · {room.phase}</p>
        </div>
        <button
          type="button"
          disabled={room.status === "ended"}
          onClick={() => onAction("closeRoom", room.id)}
          className="px-2 py-1 text-[10px] rounded border border-red-500/30 text-red-300 disabled:opacity-30"
        >
          {room.status === "ended" ? "Closed" : "Close"}
        </button>
      </div>
    </div>
  );

  const renderBabecock = (round: AdminBabecockRound) => (
    <div key={round.id} className="border-b border-border-subtle last:border-0 p-3 hover:bg-glass-w5 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-retro-fg truncate">{round.id.slice(0, 14)}</p>
          <p className="text-[10px] text-retro-muted">Host {round.host_name || "Unknown"} · {round.entry_count} entries · grid {round.grid_size}</p>
        </div>
        <button
          type="button"
          disabled={round.status !== "open"}
          onClick={() => onAction("closeBabecock", round.id)}
          className="px-2 py-1 text-[10px] rounded border border-red-500/30 text-red-300 disabled:opacity-30"
        >
          {round.status === "open" ? "Close" : "Closed"}
        </button>
      </div>
    </div>
  );

  if (isLoading && matches.length === 0) {
    return <AdminLoadingState rows={5} columns={4} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-retro-fg">Games Operations</h1>
          <p className="text-xs text-retro-muted mt-1">Live matches, queue, rooms, and tournament operations</p>
        </div>
        <button
          type="button"
          onClick={() => onAction("forceMatchup")}
          className="px-3 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-xl text-xs font-bold transition-all"
        >
          Force Matchup All
        </button>
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

      {activeSubTab === "live" && (
        <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
          <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider">Active 1v1 Duels ({matches.length})</h2>
            {isLoading && <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />}
          </div>
          {matches.length === 0 ? (
            <AdminEmptyState title="No active matches" description="Matches will appear here when players are dueling" illustration="folder" />
          ) : (
            <div className="divide-y divide-border-subtle">
              {matches.map(renderMatchCard)}
            </div>
          )}
        </div>
      )}

      {activeSubTab === "archive" && (
        <div className="space-y-4">
          <AdminFilterBar
            filters={archiveParams.filters || {}}
            onFiltersChange={filters => setArchiveParams(p => ({ ...p, filters, page: 1 }))}
            configs={[
              { key: "q", label: "Search", type: "text", placeholder: "Player name, ID..." },
              { key: "result", label: "Result", type: "select", options: [
                { value: "", label: "All" },
                { value: "winner_a", label: "Player A Won" },
                { value: "winner_b", label: "Player B Won" },
                { value: "draw", label: "Draw" },
                { value: "forfeit_a", label: "Player A Forfeit" },
                { value: "forfeit_b", label: "Player B Forfeit" },
                { value: "no_match", label: "No Match" },
              ]},
              { key: "matched", label: "Matched", type: "select", options: [
                { value: "", label: "All" },
                { value: "1", label: "Matched" },
                { value: "0", label: "Unmatched" },
              ]},
            ]}
            searchValue=""
            onSearchChange={() => {}}
            showSearch={false}
          />
          <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
            <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider">Match Archive ({archiveTotal})</h2>
            </div>
            {archivedMatches.length === 0 ? (
              <AdminEmptyState title="No archived matches" description="Completed matches will appear here" illustration="folder" />
            ) : (
              <div className="divide-y divide-border-subtle">
                {archivedMatches.map(renderArchiveRow)}
              </div>
            )}
          </div>
        </div>
      )}

      {activeSubTab === "tiers" && (
        <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
          <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider">Tier Matches ({specialMatches.length})</h2>
          </div>
          {specialMatches.length === 0 ? (
            <AdminEmptyState title="No tier matches" description="Tier ladder matches will appear here" illustration="folder" />
          ) : (
            <div className="divide-y divide-border-subtle">
              {specialMatches.map(renderTierMatch)}
            </div>
          )}
        </div>
      )}

      {activeSubTab === "rooms" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
            <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider">Tournament Rooms ({rooms.length})</h2>
            </div>
            {rooms.length === 0 ? (
              <AdminEmptyState title="No tournament rooms" description="Rooms will appear here when created" illustration="folder" />
            ) : (
              <div className="divide-y divide-border-subtle">
                {rooms.map(renderRoom)}
              </div>
            )}
          </div>
          <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
            <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider">Babecock Rounds ({babecockRounds.length})</h2>
            </div>
            {babecockRounds.length === 0 ? (
              <AdminEmptyState title="No Babecock rounds" description="Babecock rounds will appear here when active" illustration="folder" />
            ) : (
              <div className="divide-y divide-border-subtle">
                {babecockRounds.map(renderBabecock)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
