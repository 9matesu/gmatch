"use client";

import { useCallback, useEffect, useState } from 'react';
import {
  TOUR_STEPS,
  nextTourStep,
  readTourState,
  writeTourState,
  type TourState,
  type TourStep,
} from '../../firstRun/tourState';
import type { MainViewType, GamesNavTab } from '../home/CommandIsland';

interface TourGuideDeps {
  identityId: string | null;
  navigateToView: (view: MainViewType) => void;
  setGamesTab: (tab: GamesNavTab) => void;
}

/**
 * Shared tour logic for the onboarding deck (TourDeck) and the walkthrough
 * dock (TourDock): resumable per identity, skippable, teleports on user
 * click — forward, back, and direct card jumps all land on the step's
 * section. Pure navigation side effects flow through the injected setters
 * so this is unit-testable without App.
 */
export function useTourGuide({ identityId, navigateToView, setGamesTab }: TourGuideDeps) {
  const [tourState, setTourState] = useState<TourState>(() => readTourState(identityId));

  useEffect(() => {
    setTourState(readTourState(identityId));
  }, [identityId]);

  useEffect(() => {
    const onReset = () => setTourState(readTourState(identityId));
    window.addEventListener('orbit_tour_reset', onReset);
    return () => window.removeEventListener('orbit_tour_reset', onReset);
  }, [identityId]);

  /** Teleport to a step's section. Null-view steps (e.g. settings) stay put. */
  const jumpToStep = useCallback(
    (step: TourStep | undefined) => {
      if (!step?.view) return;
      navigateToView(step.view);
      if (step.gamesTab) setGamesTab(step.gamesTab);
    },
    [navigateToView, setGamesTab],
  );

  /** Deck-card jump: land on that step's section and open the dock there. */
  const goToStepId = useCallback(
    (id: string) => {
      const idx = TOUR_STEPS.findIndex((s) => s.id === id);
      if (idx < 0) return;
      jumpToStep(TOUR_STEPS[idx]);
      const next: TourState = { version: 1, index: idx, status: 'active' };
      writeTourState(identityId, next);
      setTourState(next);
    },
    [identityId, jumpToStep],
  );

  const advance = useCallback(
    (dir: 1 | -1) => {
      if (dir === 1) {
        const step = TOUR_STEPS[tourState.index];
        if (step?.view) jumpToStep(step);
        const next = nextTourStep(tourState);
        writeTourState(identityId, next);
        setTourState(next);
      } else {
        const prevIdx = Math.max(0, tourState.index - 1);
        if (prevIdx !== tourState.index) {
          jumpToStep(TOUR_STEPS[prevIdx]);
          const next: TourState = { ...tourState, index: prevIdx };
          writeTourState(identityId, next);
          setTourState(next);
        }
      }
    },
    [identityId, tourState, jumpToStep],
  );

  const skip = useCallback(() => {
    const next: TourState = { version: 1, index: tourState.index, status: 'skipped' };
    writeTourState(identityId, next);
    setTourState(next);
  }, [identityId, tourState.index]);

  return { tourState, steps: TOUR_STEPS, advance, goToStepId, jumpToStep, skip };
}
