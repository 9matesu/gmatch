// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgeGateModal } from './AgeGateModal';

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  } as Storage);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('AgeGateModal', () => {
  it('shows the gate when age is unverified even mid-onboarding', () => {
    localStorage.setItem(
      'orbit_onboarding_v2:anonymous',
      JSON.stringify({ version: 1, current: 'server', completed: [] }),
    );
    render(<AgeGateModal onOpenTos={vi.fn()} />);
    expect(screen.getByText(/Are you 18 or older/i)).toBeInTheDocument();
  });

  it('hidden once verified', () => {
    localStorage.setItem('goonMatch_age_verified', 'true');
    const { container } = render(<AgeGateModal onOpenTos={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
