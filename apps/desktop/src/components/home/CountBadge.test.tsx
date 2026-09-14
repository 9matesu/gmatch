// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CountBadge } from './CountBadge';

describe('CountBadge', () => {
  it('renders nothing at zero or below', () => {
    const { container, rerender } = render(<CountBadge count={0} />);
    expect(container.firstChild).toBeNull();
    rerender(<CountBadge count={-3} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the exact count as a circle', () => {
    render(<CountBadge count={7} />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('7');
    expect(badge.getAttribute('class')).toContain('rounded-full');
  });

  it('caps large numbers at 99+', () => {
    render(<CountBadge count={150} />);
    expect(screen.getByRole('status')).toHaveTextContent('99+');
  });

  it('respects a custom max and label', () => {
    render(<CountBadge count={12} max={9} label="12 players online" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('9+');
    expect(badge).toHaveAttribute('aria-label', '12 players online');
  });
});
