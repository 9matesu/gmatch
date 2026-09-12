// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from './ErrorBoundary';

const Boom = () => {
  throw new Error('kaboom');
};

afterEach(() => vi.unstubAllGlobals());

describe('ErrorBoundary', () => {
  it('renders fallback and reloads instead of re-rendering the crashed tree', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('This screen hit an error.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(reload).toHaveBeenCalled();
    spy.mockRestore();
  });
});
