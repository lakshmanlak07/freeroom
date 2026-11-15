/** F4: notifications (10s polling), toasts for new ones, bell dropdown, class-conflict rebook (BR-9). */
import * as Popover from '@radix-ui/react-popover';
import type { AlternativeRoom, Notification } from '@freeroom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, BookOpen, CheckCheck, Users } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { EmptyState, Skeleton } from '@/components/EmptyState';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { addDays, campusDay, fmtDay, fmtRange, fmtTime } from '@/lib/time';
import { cn } from '@/lib/utils';

export function useNotifications() {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['notifications'],
    queryFn: api.notifications,
    refetchInterval: 10_000,
  });
}

function useMarkRead() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids: string[] } | { all: true }) => api.markRead(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

/** Toast each notification that appears after the first load. */
function useNewNotificationToasts(list: Notification[] | undefined) {
  const toast = useToast();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!list) return;
    if (!seen.current) {
      seen.current = new Set(list.map((n) => n.id));
      return;
    }
    for (const n of list) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      if (!n.read)
        toast({
          tone: n.type.includes('conflict') || n.type.includes('released') ? 'error' : 'info',
          title: n.title,
          body: n.body,
        });
    }
  }, [list, toast]);
}

export const rebookHref = (a: AlternativeRoom) =>
  `/rooms/${encodeURIComponent(a.roomId)}?date=${campusDay(new Date(a.start))}&start=${encodeURIComponent(a.start)}&end=${encodeURIComponent(a.end)}`;

function NotificationCard({ n, compact }: { n: Notification; compact?: boolean }) {
  const markRead = useMarkRead();
  const conflict = n.type === 'reservation.class_conflict';
  return (
    <li
      className={cn(
        'rounded-2xl border bg-white p-4',
        n.read ? 'border-line' : 'border-l-4 border-gold shadow-card',
        conflict && !compact && 'border-amber',
      )}
    >
      <div className="flex items-start gap-3">
        {conflict && <BookOpen className="mt-0.5 size-5 shrink-0 text-plum" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {!n.read && <span className="sr-only">Unread: </span>}
            {n.title}
          </p>
          <p className="text-sm text-muted">{n.body}</p>
          <p className="mt-1 text-xs text-muted tabular">{fmtTime(n.createdAt)}</p>
        </div>
        {!n.read && !compact && (
          <Button size="sm" variant="ghost" onClick={() => markRead.mutate({ ids: [n.id] })}>
            Mark read
          </Button>
        )}
      </div>
      {conflict && !compact && !!n.alternatives?.length && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-3" aria-label="Alternative rooms">
          {n.alternatives.map((a) => (
            <li key={a.roomId} className="rounded-xl bg-cream p-3">
              <p className="font-semibold">{a.name}</p>
              <p className="text-xs text-muted">{a.buildingName}</p>
              <p className="mt-1 flex items-center gap-1 text-xs text-muted tabular">
                <Users className="size-3.5" aria-hidden /> {a.capacity} · {fmtRange(a.start, a.end)}
              </p>
              <Link
                to={rebookHref(a)}
                className="mt-2 inline-block rounded-lg bg-brown px-3 py-1.5 text-xs font-semibold text-white hover:bg-brown-700"
              >
                Rebook here
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function NotificationsPage() {
  const q = useNotifications();
  const markRead = useMarkRead();
  const list = q.data?.notifications ?? [];
  const today = campusDay(new Date());
  const groups = new Map<string, Notification[]>();
  for (const n of list) {
    const d = campusDay(new Date(n.createdAt));
    groups.set(d, [...(groups.get(d) ?? []), n]);
  }
  const label = (d: string) =>
    d === today ? 'Today' : d === addDays(today, -1) ? 'Yesterday' : fmtDay(d);
  return (
    <div>
      <section className="bg-brand-gradient px-4 pt-8 pb-14 text-white md:px-8">
        <h1 className="text-3xl font-bold">Notifications</h1>
        <p className="text-white/90">Requests, approvals, releases and class conflicts — live.</p>
      </section>
      <div className="space-y-6 px-4 py-6 md:px-8">
        {list.some((n) => !n.read) && (
          <Button variant="outline" size="sm" onClick={() => markRead.mutate({ all: true })}>
            <CheckCheck className="size-4" aria-hidden /> Mark all read
          </Button>
        )}
        {q.isLoading ? (
          <Skeleton className="h-40" />
        ) : !list.length ? (
          <EmptyState
            icon={BellOff}
            title="You’re all caught up"
            body="We’ll let you know when someone requests your room or a class takes it."
          />
        ) : (
          [...groups].map(([day, items]) => (
            <section key={day} aria-labelledby={`d-${day}`}>
              <h2 id={`d-${day}`} className="mb-2 text-sm font-semibold text-muted">
                {label(day)}
              </h2>
              <ul className="space-y-3">
                {items.map((n) => (
                  <NotificationCard key={n.id} n={n} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/** Top-bar bell: unread badge, latest 5, and toasts for new arrivals. */
export function NotificationBell() {
  const q = useNotifications();
  const list = q.data?.notifications ?? [];
  useNewNotificationToasts(q.data?.notifications);
  const unread = list.filter((n) => !n.read).length;
  return (
    <Popover.Root>
      <Popover.Trigger
        className="relative grid size-11 shrink-0 place-items-center rounded-xl hover:bg-cream md:size-10"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
      >
        <Bell className="size-5" aria-hidden />
        {!!unread && (
          <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-gold px-1 text-[10px] font-bold text-espresso">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-96 max-w-[calc(100vw-1rem)] rounded-2xl border border-line bg-cream p-3 shadow-card"
        >
          <ul className="max-h-96 space-y-2 overflow-y-auto">
            {list.slice(0, 5).map((n) => (
              <NotificationCard key={n.id} n={n} compact />
            ))}
            {!list.length && (
              <li className="p-4 text-center text-sm text-muted">No notifications yet.</li>
            )}
          </ul>
          <Popover.Close asChild>
            <Link
              to="/notifications"
              className="mt-2 block rounded-xl py-2 text-center text-sm font-semibold text-brown hover:bg-white"
            >
              View all
            </Link>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
