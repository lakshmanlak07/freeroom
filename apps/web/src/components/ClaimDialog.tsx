import * as Dialog from '@radix-ui/react-dialog';
import { cutoffAt } from '@freeroom/domain';
import type { ReservationItem } from '@freeroom/shared';
import { useMutation } from '@tanstack/react-query';
import { TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { fmtDuration, fmtRange, fmtTime, useNow } from '@/lib/time';
import { PeopleInput } from './PeopleInput';
import { useToast } from './Toast';
import { Button, inputClass } from './ui/button';

const MESSAGES: Partial<Record<string, string>> = {
  CUTOFF_PASSED:
    'Claims close 4 hours before the start time, so this one can’t be requested anymore.',
  CLAIM_EXISTS: 'You already asked for this room — the owner will see your request.',
  QUOTA_EXCEEDED: 'You have 3 open requests already. Withdraw one first.',
  OWN_RESERVATION: 'This is your reservation.',
  NOT_CLAIMABLE: 'This reservation can’t be requested anymore.',
};

/** "Request this room": message ≤ 280 chars + party size (F5). */
export function ClaimDialog({
  reservation,
  roomName,
  onClose,
}: {
  reservation: ReservationItem | null;
  roomName: string;
  onClose: () => void;
}) {
  const { api } = useAuth();
  const toast = useToast();
  const [message, setMessage] = useState('');
  const [partySize, setPartySize] = useState(2);
  const [partyOk, setPartyOk] = useState(true);
  const now = useNow(15_000);
  const cutoff = reservation ? cutoffAt(new Date(reservation.start)) : null;
  const closed = !!cutoff && now >= cutoff; // BR-6: no claims at or after start − 4h
  const claim = useMutation({
    mutationFn: () =>
      api.createClaim(reservation!.id, {
        partySize,
        ...(message.trim() ? { message: message.trim() } : {}),
      }),
    onSuccess: () => {
      toast({
        tone: 'success',
        title: 'Request sent',
        body: `The owner can approve until ${fmtTime(cutoffAt(new Date(reservation!.start)))}. We’ll notify you either way.`,
      });
      setMessage('');
      onClose();
    },
  });
  const error = claim.error
    ? claim.error instanceof ApiError
      ? (MESSAGES[claim.error.code] ?? claim.error.message)
      : 'Something went wrong.'
    : null;

  return (
    <Dialog.Root open={!!reservation} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-espresso/30" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl">
          <div className="flex items-start justify-between">
            <Dialog.Title className="text-lg font-semibold">Request this room</Dialog.Title>
            <Dialog.Close className="rounded-lg p-1 text-muted hover:bg-cream" aria-label="Close">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          {reservation && (
            <Dialog.Description className="mt-1 text-sm text-muted">
              {roomName} · {fmtRange(reservation.start, reservation.end)} · held by{' '}
              {reservation.ownerAlias}. If they approve, you’ll see the contact they chose to share
              — or they may transfer the reservation to you.
            </Dialog.Description>
          )}
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              claim.mutate();
            }}
          >
            <label className="block text-sm font-medium">
              Message <span className="font-normal text-muted">(optional)</span>
              <textarea
                value={message}
                maxLength={280}
                rows={3}
                onChange={(e) => setMessage(e.target.value.replace(/[<>]/g, ''))}
                placeholder="We’re a group of 4 studying for the COMPSCI 220 midterm…"
                className={`${inputClass} mt-1 h-auto py-2`}
                aria-describedby="claim-count"
              />
              <span id="claim-count" className="block text-right text-xs text-muted tabular">
                {message.length}/280
              </span>
            </label>
            <PeopleInput
              id="claim-party"
              label="Party size"
              value={partySize}
              onChange={(n) => setPartySize(n ?? 1)}
              onValidChange={setPartyOk}
            />
            {cutoff && (
              <p
                className={
                  closed
                    ? 'rounded-xl bg-line px-3 py-2 text-sm text-muted'
                    : 'text-xs text-muted tabular'
                }
                role={closed ? 'status' : undefined}
              >
                {closed
                  ? 'Requests closed at ' +
                    fmtTime(cutoff) +
                    ' — 4 hours before the reservation starts — so this room can’t be requested anymore.'
                  : 'Requests close in ' +
                    fmtDuration(cutoff.getTime() - now.getTime()) +
                    ' (' +
                    fmtTime(cutoff) +
                    ', 4h before start).'}
              </p>
            )}
            {error && (
              <p
                role="alert"
                className="flex gap-2 rounded-xl bg-amber/10 px-3 py-2 text-sm text-amber-ink"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={claim.isPending || closed || !partyOk}
              >
                {claim.isPending ? 'Sending…' : 'Send request'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
