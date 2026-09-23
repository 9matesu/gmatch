// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PromptDialog } from './PromptDialog';

describe('PromptDialog', () => {
  it('submits the typed value on Enter and closes', async () => {
    const onResolve = vi.fn();
    render(
      <PromptDialog
        title="Server password"
        description="Friend World is password-protected."
        onSubmit={(v) => onResolve(v)}
        onCancel={() => onResolve(null)}
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Server password' }), 'sekrit');
    await userEvent.keyboard('{Enter}');
    expect(onResolve).toHaveBeenCalledWith('sekrit');
  });
  it('resolves null on cancel', async () => {
    const onResolve = vi.fn();
    render(<PromptDialog title="Node code" onSubmit={(v) => onResolve(v)} onCancel={() => onResolve(null)} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onResolve).toHaveBeenCalledWith(null);
  });
  it('does NOT cancel on backdrop click (typed input is preserved)', async () => {
    const onResolve = vi.fn();
    const { container } = render(
      <PromptDialog title="Node code" onSubmit={(v) => onResolve(v)} onCancel={() => onResolve(null)} />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Node code' }), 'sekrit');
    await userEvent.click(container.firstChild as HTMLElement);
    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Node code' })).toHaveValue('sekrit');
  });
});
