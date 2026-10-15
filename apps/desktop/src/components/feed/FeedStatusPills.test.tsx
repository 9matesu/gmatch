// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { FeedStatusPills } from './FeedStatusPills';

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

afterEach(() => {
  setOnline(true);
  vi.unstubAllGlobals();
});

describe('FeedStatusPills (selective: only empty/conflict states)', () => {
  it('renders nothing when online with posts', () => {
    setOnline(true);
    const { container } = render(<FeedStatusPills postCount={5} />);
    expect(container.firstElementChild).toBeNull();
  });

  it('offline with posts: offline pill, no empty pill', () => {
    setOnline(false);
    render(<FeedStatusPills postCount={5} />);
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    expect(screen.queryByText(/empty feed/i)).toBeNull();
  });

  it('online and empty: empty pill, no offline pill', () => {
    setOnline(true);
    render(<FeedStatusPills postCount={0} />);
    expect(screen.getByRole('status')).toHaveTextContent(/empty feed/i);
    expect(screen.queryByText(/offline/i)).toBeNull();
  });

  it('offline and empty: offline pill wins (the nudge card covers empty)', () => {
    setOnline(false);
    render(<FeedStatusPills postCount={0} />);
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    expect(screen.queryByText(/empty feed/i)).toBeNull();
  });

  it('reacts to connectivity flips without remount', () => {
    setOnline(true);
    render(<FeedStatusPills postCount={5} />);
    expect(document.body.querySelector('[role="status"]')).toBeNull();
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('status')).toHaveTextContent(/offline/i);
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(document.body.querySelector('[role="status"]')).toBeNull();
  });
});
