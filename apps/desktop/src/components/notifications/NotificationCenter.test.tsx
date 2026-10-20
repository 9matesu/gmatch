// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastProvider } from '../Toast';
import { NotificationCenter } from './NotificationCenter';
import type { AppNotification } from '../../utils/notifications';

/**
 * The header centre is now the ONE notification surface. These tests pin the
 * three things that regressed in the old design: a single entry point, a badge
 * that matches the list, and courier rows (DMs/rooms) living in the same list.
 */

function localDm(): AppNotification {
  return {
    key: 'dm:peer1',
    id: 'dm:peer1',
    source: 'local',
    type: 'dm',
    title: 'Kenny sent you 2 messages',
    body: 'hello there',
    createdAt: new Date().toISOString(),
    read: false,
    count: 2,
    target: { conversationId: 'peer1', userId: 'peer1' },
    marks: [],
  };
}

function renderCenter(overrides: Partial<React.ComponentProps<typeof NotificationCenter>> = {}) {
  const props = {
    onMarkAllRead: vi.fn(),
    onMarkRead: vi.fn(),
    onOpenTarget: vi.fn(),
    onOpenLocalTarget: vi.fn(),
    onMarkLocalRead: vi.fn(),
    ...overrides,
  };
  render(
    <ToastProvider>
      <NotificationCenter {...props} />
    </ToastProvider>,
  );
  return props;
}

describe('NotificationCenter (header)', () => {
  it('carries the E2E hook and no second bell attribute elsewhere', () => {
    renderCenter();
    expect(document.querySelectorAll('[data-notifications-toggle="true"]')).toHaveLength(1);
  });

  it('shows the unread badge and the newest unread title in the collapsed line', () => {
    renderCenter({ unreadCount: 3, latestTitle: 'Bob liked your post' });
    expect(screen.getByText('Bob liked your post')).toBeInTheDocument();
    expect(screen.getByLabelText(/3 unread/)).toBeInTheDocument();
  });

  it('expands into the persistent inbox with the mark-all-read affordance', () => {
    const props = renderCenter({
      notifications: [{ id: 'n1', type: 'like', title: 'Bob liked your post', body: null, data: '{"post_id":"p1"}', read: false, created_at: new Date().toISOString() }],
      unreadCount: 1,
    });
    fireEvent.click(screen.getByLabelText(/Notifications/));
    expect(screen.getByText('Mark all read')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Mark all read'));
    expect(props.onMarkAllRead).toHaveBeenCalled();
  });

  it('renders courier rows in the same list and opens them through the local handler', () => {
    const props = renderCenter({ localItems: [localDm()], unreadCount: 1 });
    fireEvent.click(screen.getByLabelText(/Notifications/));
    expect(screen.getByText('Kenny sent you 2 messages')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Kenny sent you 2 messages'));
    expect(props.onMarkLocalRead).toHaveBeenCalledWith(['dm:peer1']);
    expect(props.onOpenLocalTarget).toHaveBeenCalledWith(expect.objectContaining({ key: 'dm:peer1' }));
  });

  it('says so honestly when there is nothing at all', () => {
    renderCenter();
    fireEvent.click(screen.getByLabelText(/Notifications/));
    expect(screen.getByText('No notifications')).toBeInTheDocument();
  });
});
