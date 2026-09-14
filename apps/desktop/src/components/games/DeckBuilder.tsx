"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Trash2, X, Check, AlertCircle, Search, Pencil, Swords, Star } from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { OrbitObject } from '@orbit/shared';
import { orbitFetch } from '../../utils/api';
import { logger } from '../../utils/logger';
import { CardTile } from '../home/CardTile';
import { DND_CARD } from '../DropZone';
import { openCardDetail } from '../../utils/openCard';

export const ACTIVE_DECK_STORAGE_KEY = 'orbit_active_deck_id';

export function getStoredActiveDeckId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(ACTIVE_DECK_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function setStoredActiveDeckId(deckId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const current = localStorage.getItem(ACTIVE_DECK_STORAGE_KEY) || null;
    if (current === deckId) return;
    if (deckId) {
      localStorage.setItem(ACTIVE_DECK_STORAGE_KEY, deckId);
    } else {
      localStorage.removeItem(ACTIVE_DECK_STORAGE_KEY);
    }
    window.dispatchEvent(new CustomEvent('orbit-active-deck-changed', { detail: { deckId } }));
  } catch {}
}

export interface Deck {
  id: string;
  ownerId: string;
  name: string;
  gameId: string;
  cards: string[];
  createdAt: string;
  updatedAt: string;
}

interface DeckValidation {
  valid: boolean;
  issues: string[];
}

interface DeckBuilderProps {
  identity: OrbitIdentity | null;
  cards: OrbitObject[];
  onEnterArena?: () => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

// Canonical card ids are what DeckCards.card_id stores; the merged card object
// carries `card_id` (canonical) separately from `id` (media object id).
function canonicalId(card: OrbitObject): string {
  return (card as any).card_id || card.id;
}

export function DeckBuilder({ identity, cards, onEnterArena, toast }: DeckBuilderProps) {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null);
  const [activeDeckId, setActiveDeckIdState] = useState<string | null>(() => getStoredActiveDeckId());
  const [loading, setLoading] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [validation, setValidation] = useState<DeckValidation | null>(null);
  const [addingCards, setAddingCards] = useState(false);
  const [deckDropOver, setDeckDropOver] = useState(false);
  const [search, setSearch] = useState('');
  const [editingName, setEditingName] = useState('');

  const setActiveDeck = (deckId: string) => {
    setActiveDeckIdState(deckId);
    setStoredActiveDeckId(deckId);
    toast?.('Deck active for duels.', 'success');
  };

  const loadDecks = useCallback(async () => {
    if (!identity) return;
    setLoading(true);
    try {
      const res = await orbitFetch('/api/decks', {}, identity);
      if (res.ok) {
        const data = await res.json();
        const deckList: Deck[] = data.decks || [];
        setDecks(deckList);

        // Auto-select first active deck if none chosen
        const currentActive = getStoredActiveDeckId();
        if (!currentActive && deckList.length > 0) {
          const first5CardDeck = deckList.find((d) => d.cards.length === 5) || deckList[0];
          setActiveDeckIdState(first5CardDeck.id);
          setStoredActiveDeckId(first5CardDeck.id);
        } else if (currentActive && !deckList.some((d) => d.id === currentActive) && deckList.length > 0) {
          setActiveDeckIdState(deckList[0].id);
          setStoredActiveDeckId(deckList[0].id);
        }

        // If exactly 1 deck exists and user has no selected deck, open it directly
        setSelectedDeck((prev) => {
          if (!prev && deckList.length === 1) return deckList[0];
          if (prev) {
            const updated = deckList.find((d) => d.id === prev.id);
            return updated || prev;
          }
          return prev;
        });
      }
    } catch (error) {
      logger.error('Failed to load decks:', error);
      toast?.('Failed to load decks', 'error');
    } finally {
      setLoading(false);
    }
  }, [identity, toast]);

  useEffect(() => {
    loadDecks();
  }, [identity, loadDecks]);

  const createDeck = async (overrideName?: string) => {
    const nameToUse = (overrideName || newDeckName).trim();
    if (!identity || !nameToUse) return;
    
    try {
      const res = await orbitFetch('/api/decks', {
        method: 'POST',
        body: JSON.stringify({ name: nameToUse, game_id: 'card-duel' }),
      }, identity);
      
      if (res.ok) {
        const data = await res.json();
        setDecks((current) => [...current, data.deck]);
        setSelectedDeck(data.deck);
        setAddingCards(true);
        if (!activeDeckId) {
          setActiveDeckIdState(data.deck.id);
          setStoredActiveDeckId(data.deck.id);
        }
        setNewDeckName('');
        toast?.('Deck created! Now add 5 cards to finish.', 'success');
      } else {
        const data = await res.json();
        toast?.(data.error || 'Failed to create deck', 'error');
      }
    } catch (error) {
      logger.error('Failed to create deck:', error);
      toast?.('Failed to create deck', 'error');
    }
  };

  const deleteDeck = async (deckId: string) => {
    if (!identity) return;
    
    try {
      const res = await orbitFetch(`/api/decks/${deckId}`, {
        method: 'DELETE',
      }, identity);
      
      if (res.ok) {
        setDecks((current) => current.filter(d => d.id !== deckId));
        if (selectedDeck?.id === deckId) {
          setSelectedDeck(null);
        }
        if (activeDeckId === deckId) {
          const remaining = decks.filter(d => d.id !== deckId);
          const nextActive = remaining[0]?.id || null;
          setActiveDeckIdState(nextActive);
          setStoredActiveDeckId(nextActive);
        }
        toast?.('Deck deleted', 'success');
      } else {
        const data = await res.json();
        toast?.(data.error || 'Failed to delete deck', 'error');
      }
    } catch (error) {
      logger.error('Failed to delete deck:', error);
      toast?.('Failed to delete deck', 'error');
    }
  };

  const renameDeck = async () => {
    if (!identity || !selectedDeck || !editingName.trim()) return
    try {
      const res = await orbitFetch(`/api/decks/${selectedDeck.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editingName.trim() }),
      }, identity)
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast?.(data?.error || 'Failed to rename deck', 'error')
        return
      }
      setSelectedDeck(data.deck)
      setDecks((current) => current.map((deck) => deck.id === data.deck.id ? data.deck : deck))
      setEditingName('')
      toast?.('Deck renamed', 'success')
    } catch {
      toast?.('Failed to rename deck', 'error')
    }
  }

  const addCardToDeck = async (cardId: string) => {
    if (!identity || !selectedDeck) return;
    
    try {
      const res = await orbitFetch(`/api/decks/${selectedDeck.id}/cards`, {
        method: 'POST',
        body: JSON.stringify({ card_id: cardId }),
      }, identity);
      
      if (res.ok) {
        const data = await res.json();
        setSelectedDeck(data.deck);
        setDecks((current) => current.map(d => d.id === data.deck.id ? data.deck : d));
        toast?.('Card added to deck', 'success');
      } else {
        const data = await res.json();
        toast?.(data.error || 'Failed to add card', 'error');
      }
    } catch (error) {
      logger.error('Failed to add card:', error);
      toast?.('Failed to add card', 'error');
    }
  };

  const removeCardFromDeck = async (cardId: string) => {
    if (!identity || !selectedDeck) return;
    
    try {
      const res = await orbitFetch(`/api/decks/${selectedDeck.id}/cards/${cardId}`, {
        method: 'DELETE',
      }, identity);
      
      if (res.ok) {
        const data = await res.json();
        setSelectedDeck(data.deck);
        setDecks((current) => current.map(d => d.id === data.deck.id ? data.deck : d));
        toast?.('Card removed from deck', 'success');
      } else {
        const data = await res.json();
        toast?.(data.error || 'Failed to remove card', 'error');
      }
    } catch (error) {
      logger.error('Failed to remove card:', error);
      toast?.('Failed to remove card', 'error');
    }
  };

  const validateDeck = async () => {
    if (!identity || !selectedDeck) return;
    
    try {
      const res = await orbitFetch(`/api/decks/${selectedDeck.id}/validate`, {
        method: 'POST',
      }, identity);
      
      if (res.ok) {
        const data = await res.json();
        setValidation(data);
      }
    } catch (error) {
      logger.error('Failed to validate deck:', error);
    }
  };

  const getCardsInDeck = () => {
    if (!selectedDeck) return [];
    return cards.filter(card => selectedDeck.cards.includes(canonicalId(card)));
  };

  const availableCards = useMemo(() => {
    const base = selectedDeck ? cards.filter(card => !selectedDeck.cards.includes(canonicalId(card))) : cards;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((card) => {
      const label = (card.caption || card.content_url || card.id).toLowerCase();
      const cid = canonicalId(card).toLowerCase();
      return label.includes(q) || cid.includes(q);
    });
  }, [cards, selectedDeck, search]);

  if (selectedDeck) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              setSelectedDeck(null);
              setValidation(null);
              setAddingCards(false);
            }}
            className="text-xs text-retro-muted hover:text-retro-body flex items-center gap-1"
          >
            <X className="w-3 h-3" />
            Back to Decks
          </button>
          <button
            onClick={validateDeck}
            className="text-xs bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 px-3 py-1.5 rounded-lg flex items-center gap-1.5"
          >
            <Check className="w-3 h-3" />
            Validate Deck
          </button>
        </div>

        <div className="bg-surface-raised border border-border-glass rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
               <div className="flex items-center gap-2">
                 <h2 className="text-lg font-bold text-retro-fg">{selectedDeck.name}</h2>
                 <button
                   type="button"
                   onClick={() => setEditingName(selectedDeck.name)}
                   className="text-retro-muted hover:text-retro-fg cursor-pointer"
                   title="Rename deck"
                 >
                   <Pencil className="w-3.5 h-3.5" />
                 </button>
                 {activeDeckId === selectedDeck.id ? (
                   <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] font-bold flex items-center gap-1">
                     <Star className="w-3 h-3 fill-emerald-400 text-emerald-400" /> Active Deck
                   </span>
                 ) : (
                   <button
                     type="button"
                     onClick={() => setActiveDeck(selectedDeck.id)}
                     className="px-2 py-0.5 rounded-full bg-surface-interactive border border-border-glass hover:border-emerald-500/40 text-retro-muted hover:text-emerald-300 text-[10px] font-bold cursor-pointer transition-colors"
                   >
                     Set as Active
                   </button>
                 )}
               </div>
              <p className="text-xs text-retro-muted mt-1">
                {selectedDeck.cards.length}/5 cards • {selectedDeck.cards.length === 5 ? 'Ready to Duel' : `Add ${5 - selectedDeck.cards.length} more card${5 - selectedDeck.cards.length === 1 ? '' : 's'}`}
              </p>
           </div>

             <div className="flex items-center gap-2">
              <button
                onClick={() => setAddingCards(!addingCards)}
                className="text-xs bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer font-semibold"
              >
                <Plus className="w-3 h-3" />
                {addingCards ? 'Done' : 'Add Cards'}
              </button>
              {selectedDeck.cards.length === 5 && onEnterArena && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveDeck(selectedDeck.id);
                    onEnterArena();
                  }}
                  className="text-xs bg-retro-accent text-black font-black px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 hover:bg-retro-accent-hover cursor-pointer shadow-md"
                >
                  <Swords className="w-3.5 h-3.5" />
                  Enter Arena
                </button>
              )}
           </div>

           </div>

           {editingName !== '' && (
             <div className="flex gap-2 mb-4">
               <input
                 autoFocus
                 value={editingName}
                 onChange={(e) => setEditingName(e.target.value)}
                 maxLength={60}
                 className="flex-1 bg-surface-interactive border border-border-glass rounded-lg px-3 py-1.5 text-xs text-retro-fg outline-none focus:border-retro-accent/50"
               />
               <button type="button" onClick={renameDeck} className="px-3 py-1.5 rounded-lg bg-cyan-500 text-white text-xs font-bold cursor-pointer">Save</button>
               <button type="button" onClick={() => setEditingName('')} className="px-3 py-1.5 rounded-lg border border-border-glass text-retro-muted text-xs cursor-pointer">Cancel</button>
             </div>
           )}

           {validation && (
            <div className={`mb-4 p-3 rounded-lg ${validation.valid ? 'bg-green-500/20 border border-green-500/30' : 'bg-red-500/20 border border-red-500/30'}`}>
              <div className="flex items-center gap-2 mb-2">
                {validation.valid ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-400" />
                )}
                <span className={`text-sm font-bold ${validation.valid ? 'text-green-300' : 'text-red-300'}`}>
                  {validation.valid ? 'Deck is valid' : 'Deck has issues'}
                </span>
              </div>
              {!validation.valid && validation.issues.length > 0 && (
                <ul className="list-disc list-inside space-y-1">
                  {validation.issues.map((issue, i) => (
                    <li key={i} className="text-xs text-red-200">{issue}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div
            onDragOver={(e) => {
              if (!Array.from(e.dataTransfer.types).includes(DND_CARD)) return;
              e.preventDefault();
              setDeckDropOver(true);
            }}
            onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setDeckDropOver(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setDeckDropOver(false);
              const raw = e.dataTransfer.getData(DND_CARD);
              if (!raw) return;
              try {
                const payload = JSON.parse(raw) as { cardId?: string };
                if (payload.cardId) void addCardToDeck(payload.cardId);
              } catch { /* malformed */ }
            }}
            className={`rounded-xl border-2 border-dashed transition-colors p-2 -m-2 ${deckDropOver ? 'border-cyan-400/70 bg-cyan-500/10' : 'border-transparent'}`}
          >
            <h3 className="text-sm font-bold text-retro-body mb-2">Cards in Deck{deckDropOver && <span className="ml-2 text-xs font-semibold text-cyan-300 animate-pulse">Drop to add</span>}</h3>
            {getCardsInDeck().length === 0 ? (
              <div className="text-center py-8 text-retro-muted text-xs">
                No cards in this deck yet. Click &quot;Add Cards&quot;. Or drag a card here.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {getCardsInDeck().map(card => (
                  <div key={card.id} className="relative group">
                    <CardTile item={card} identity={identity} onClick={() => openCardDetail(card)} />
                    <button
                      onClick={() => removeCardFromDeck(canonicalId(card))}
                      className="absolute top-2 right-2 bg-red-500/80 hover:bg-red-500 text-white p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove from deck"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {addingCards && (
            <div className="mt-6">
              <h3 className="text-sm font-bold text-retro-body mb-2">Available cards</h3>
              <div className="mb-3 flex items-center gap-2 bg-surface-canvas border border-border-glass rounded-lg px-3 py-2">
                <Search className="w-4 h-4 text-retro-muted shrink-0" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter cards…"
                  className="flex-1 bg-transparent text-sm text-retro-fg placeholder:text-retro-muted focus:outline-none"
                />
              </div>
              {availableCards.length === 0 ? (
                <div className="text-center py-8 text-retro-muted text-xs">
                  No available cards. All your cards are already in this deck.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {availableCards.map(card => (
                    <div
                      key={card.id}
                      className="relative group cursor-grab active:cursor-grabbing"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DND_CARD, JSON.stringify({ cardId: canonicalId(card) }));
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                    >
                      <CardTile item={card} identity={identity} onClick={() => openCardDetail(card)} />
                      <button
                        onClick={() => addCardToDeck(canonicalId(card))}
                        className="absolute top-2 right-2 bg-cyan-500/80 hover:bg-cyan-500 text-white p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Add to deck (or drag into the deck above)"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface-raised border border-border-glass rounded-xl p-4">
        <h2 className="text-lg font-bold text-retro-fg mb-4">Create new deck</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={newDeckName}
            onChange={(e) => setNewDeckName(e.target.value)}
            placeholder="Deck name..."
            className="flex-1 bg-surface-canvas border border-border-glass rounded-lg px-3 py-2 text-sm text-retro-fg placeholder:text-retro-muted focus:outline-none focus:border-retro-accent/50"
            maxLength={60}
          />
          <button
            onClick={() => void createDeck()}
            disabled={!newDeckName.trim()}
            className="bg-cyan-500 hover:bg-cyan-600 disabled:bg-surface-interactive disabled:text-retro-muted text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Create
          </button>
        </div>
      </div>

      <div className="bg-surface-raised border border-border-glass rounded-xl p-4">
        <h2 className="text-lg font-bold text-retro-fg mb-4">Your decks</h2>
        {loading ? (
          <div className="text-center py-8 text-retro-muted text-xs">Loading decks...</div>
        ) : decks.length === 0 ? (
          <div className="text-center py-8 text-retro-muted text-xs">
            No decks yet. Create your first deck above!
          </div>
        ) : (
          <div className="space-y-2">
            {decks.map(deck => (
              <div
                key={deck.id}
                className="bg-surface-canvas border border-border-glass rounded-xl p-3 flex items-center justify-between hover:border-border-strong transition-colors"
              >
                <button
                  onClick={() => setSelectedDeck(deck)}
                  className="flex-1 text-left"
                >
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-retro-fg">{deck.name}</h3>
                    <span className="text-xs text-retro-muted">
                      {deck.cards.length}/5 cards
                    </span>
                    {activeDeckId === deck.id && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] font-bold flex items-center gap-1">
                        <Star className="w-2.5 h-2.5 fill-emerald-400 text-emerald-400" /> Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-retro-muted mt-1">
                    {deck.cards.length === 5 ? '5/5 Cards Complete' : `${5 - deck.cards.length} cards needed`} • Updated {new Date(deck.updatedAt).toLocaleDateString()}
                  </p>
                </button>
                <button
                  onClick={() => deleteDeck(deck.id)}
                  className="text-red-400 hover:text-red-300 p-2 rounded-lg hover:bg-red-500/10 transition-colors"
                  title="Delete deck"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
