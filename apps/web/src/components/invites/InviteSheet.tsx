/**
 * "Invite your group": makes (or replaces) the booking's one invite link and shows it as a ticket
 * with a QR. Share (native sheet on phones, copy fallback), Copy, Download PNG, Revoke.
 * Lazy-loaded (QR + canvas code stay out of the main bundle).
 */
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Copy, ImageDown, Link2Off, RefreshCw, Share2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Skeleton } from '@/components/EmptyState';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { Ticket, ticketPng } from './Ticket';

export interface InviteTarget {
  reservationId: string;
  roomId: string;
  start: string;
  end: string;
  hostAlias: string;
}

export default function InviteSheet({
  target,
  onClose,
}: {
  target: InviteTarget;
  onClose: () => void;
}) {
  const { api } = useAuth();
  const toast = useToast();
  const room = useQuery({
    queryKey: ['room', target.roomId],
    queryFn: () => api.room(target.roomId),
  });
  const [revoked, setRevoked] = useState(false);
  const create = useMutation({ mutationFn: () => api.createInvite(target.reservationId) });
  const revoke = useMutation({
    mutationFn: () => api.revokeInvite(target.reservationId),
    onSuccess: () => {
      setRevoked(true);
      toast({
        tone: 'success',
        title: 'Link revoked',
        body: 'The old link and QR no longer work.',
      });
    },
  });
  // Once per open (StrictMode runs effects twice in dev; a second create would race the first).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    create.mutate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const url = revoked ? undefined : create.data?.url;
  const ticket = {
    roomName: room.data?.name ?? target.roomId.replace('-', ' '),
    buildingName: room.data?.buildingName ?? '',
    start: target.start,
    end: target.end,
    hostAlias: target.hostAlias,
    url,
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast({ tone: 'success', title: 'Copied!', body: 'Paste it in your group chat.' });
    } catch {
      toast({ tone: 'error', title: 'Couldn’t copy', body: url });
    }
  };
  const share = async () => {
    if (!url) return;
    const data = { title: `Study session · ${ticket.roomName}`, text: 'Join me on FreeRoom', url };
    if (navigator.share && navigator.canShare?.(data)) {
      try {
        await navigator.share(data);
        return;
      } catch {
        /* dismissed: fall through to copy */
      }
    }
    await copy();
  };
  const download = async () => {
    if (!url) return;
    const blob = await ticketPng({ ...ticket, url });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `freeroom-${ticket.roomName.replace(/[^A-Za-z0-9]+/g, '-')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[94dvh] overflow-y-auto rounded-t-3xl bg-cream px-4 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:w-[440px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-3xl md:p-6">
          <div aria-hidden className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-line md:hidden" />
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-xl font-bold">Invite your group</Dialog.Title>
              <Dialog.Description className="text-sm text-muted">
                One link for everyone. They’ll see where and when, and can tap Join.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="grid size-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface md:size-9"
            >
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>

          {create.isPending ? (
            <Skeleton className="mx-auto h-[420px] max-w-sm rounded-3xl" />
          ) : create.isError ? (
            <div role="alert" className="rounded-2xl border border-line bg-surface p-4 text-sm">
              <p className="font-semibold">Couldn’t make a link right now.</p>
              <Button className="mt-3" size="sm" onClick={() => create.mutate()}>
                <RefreshCw className="size-4" aria-hidden /> Try again
              </Button>
            </div>
          ) : (
            <Ticket t={ticket} />
          )}

          {revoked ? (
            <div className="mt-5 rounded-2xl border border-line bg-surface p-4 text-center text-sm">
              <p className="font-semibold">That link is off.</p>
              <Button
                className="mt-3"
                onClick={() => {
                  setRevoked(false);
                  create.mutate();
                }}
              >
                Make a new link
              </Button>
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button size="lg" className="col-span-2" onClick={share} disabled={!url}>
                <Share2 className="size-4" aria-hidden /> Share invite
              </Button>
              <Button variant="outline" onClick={copy} disabled={!url}>
                <Copy className="size-4" aria-hidden /> Copy link
              </Button>
              <Button variant="outline" onClick={download} disabled={!url}>
                <ImageDown className="size-4" aria-hidden /> Save ticket
              </Button>
              <Button
                variant="ghost"
                className="col-span-2 text-muted"
                onClick={() => revoke.mutate()}
                disabled={!url || revoke.isPending}
              >
                <Link2Off className="size-4" aria-hidden /> Revoke link
              </Button>
            </div>
          )}
          {url && (
            <p className="mt-3 truncate text-center text-xs text-muted" data-testid="invite-url">
              {url}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
