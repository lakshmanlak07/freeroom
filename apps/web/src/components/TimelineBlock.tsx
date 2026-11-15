import * as Popover from '@radix-ui/react-popover';
import { cutoffAt, isClaimable } from '@freeroom/domain';
import type { ClassItem, ReservationItem } from '@freeroom/shared';
import { BookOpen, Star, UserRound } from 'lucide-react';
import { forwardRef, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { fmtDuration, fmtRange } from '@/lib/time';
import { Button } from './ui/button';

export type ScheduleItem = ClassItem | ReservationItem;

const STATUS_LABEL: Record<string, string> = {
  PENDING_CONFIRMATION: 'Pending confirmation',
  CONFIRMED: 'Confirmed',
};

/** Accessible name carries every field, so screen readers get the full tooltip (BR-3). */
export function describe(item: ScheduleItem) {
  const time = fmtRange(item.start, item.end);
  if (item.kind === 'class') {
    return [
      `Class: ${item.name}`,
      item.courseCode && `${item.courseCode}${item.section ? ` section ${item.section}` : ''}`,
      item.eventType,
      time,
      item.organization,
      `${item.roomName}, ${item.buildingName}`,
    ]
      .filter(Boolean)
      .join('. ');
  }
  return `${item.isMine ? 'Your reservation' : `Reservation held by ${item.ownerAlias}`}. ${time}. ${
    STATUS_LABEL[item.status] ?? item.status
  }${item.claimable ? '. Claimable — press Enter to request this room' : ''}`;
}

interface Props {
  item: ScheduleItem;
  left: number;
  width: number;
  now: Date;
  tabIndex: number;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onFocusBlock: () => void;
  onRequest: (item: ReservationItem) => void;
}

export const TimelineBlock = forwardRef<HTMLButtonElement, Props>(function TimelineBlock(
  { item, left, width, now, tabIndex, onKeyDown, onFocusBlock, onRequest },
  ref,
) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  const isClass = item.kind === 'class';
  const mine = item.kind === 'reservation' && item.isMine;
  const tiny = width < 2.2; // < ~20 min: icon only
  const narrow = width < 6.5; // < ~1h: stacked short label, no time (full details in the popover)
  const shortLabel = isClass ? (item.courseCode ?? item.name) : mine ? 'You' : item.ownerAlias; // "You" is inside the accessible name (axe label-content-name-mismatch)
  const Icon = isClass ? BookOpen : mine ? Star : UserRound;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <button
          ref={ref}
          type="button"
          tabIndex={tabIndex}
          aria-label={describe(item)}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={() => {
            onFocusBlock();
            show();
          }}
          onBlur={hide}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Enter' && item.kind === 'reservation' && item.claimable) onRequest(item);
            onKeyDown(e);
          }}
          // Tap (no hover on phones) opens the details; claimable blocks go straight to the request.
          onClick={() =>
            item.kind === 'reservation' && item.claimable ? onRequest(item) : setOpen(true)
          }
          style={{ left: `${left}%`, width: `${width}%` }}
          className={cn(
            'absolute top-3 bottom-3 flex items-center gap-1.5 overflow-hidden rounded-lg text-left text-xs font-semibold text-on-accent shadow-sm',
            narrow ? 'flex-col justify-center gap-0.5 px-1' : 'px-2',
            isClass ? 'bg-plum stripes-class' : 'bg-slate',
            mine && 'outline-2 outline-offset-1 outline-gold',
            !isClass && item.claimable && 'cursor-pointer',
            isClass && 'cursor-default',
          )}
        >
          <Icon className={cn('size-3.5 shrink-0', mine && 'fill-gold text-gold')} aria-hidden />
          {!tiny &&
            (narrow ? (
              <span className="min-w-0 text-[11px] leading-tight break-words">
                {shortLabel.split(' ').map((w, k) => (
                  <span key={k} className="block truncate">
                    {/* trailing space: text reads "Night Owl", not "NightOwl" (matches the label) */}
                    {w}{' '}
                  </span>
                ))}
              </span>
            ) : (
              <span className="min-w-0 truncate">
                {shortLabel}
                <span className="block truncate font-normal opacity-90 tabular">
                  {fmtRange(item.start, item.end)}
                </span>
              </span>
            ))}
        </button>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onMouseEnter={show}
          onMouseLeave={hide}
          className="z-50 w-72 rounded-2xl border border-line bg-surface p-4 text-sm shadow-card"
        >
          {isClass ? (
            <ClassDetails item={item} />
          ) : (
            <ReservationDetails item={item} now={now} onRequest={onRequest} />
          )}
          <Popover.Arrow className="fill-white" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
});

function Row({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 font-medium">{v}</dd>
    </div>
  );
}

/** BR-3: everything 25Live gives us. */
function ClassDetails({ item }: { item: ClassItem }) {
  return (
    <div>
      <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-plum-50 px-2 py-0.5 text-xs font-semibold text-plum">
        <BookOpen className="size-3.5" aria-hidden /> Class · from 25Live
      </p>
      <p className="text-base font-semibold">{item.name}</p>
      <dl className="mt-2 space-y-1">
        <Row
          k="Course"
          v={item.courseCode && `${item.courseCode}${item.section ? ` · Sec ${item.section}` : ''}`}
        />
        <Row k="Type" v={item.eventType} />
        <Row k="Time" v={fmtRange(item.start, item.end)} />
        <Row k="Department" v={item.organization} />
        <Row k="Room" v={`${item.roomName} · ${item.buildingName}`} />
      </dl>
    </div>
  );
}

function ReservationDetails({
  item,
  now,
  onRequest,
}: {
  item: ReservationItem;
  now: Date;
  onRequest: (item: ReservationItem) => void;
}) {
  const start = new Date(item.start);
  const cutoff = cutoffAt(start);
  const open = isClaimable({ status: item.status, start }, now);
  return (
    <div>
      <p
        className={cn(
          'mb-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold',
          item.isMine ? 'bg-gold/15 text-amber-ink' : 'bg-slate-50 text-slate',
        )}
      >
        {item.isMine ? (
          <Star className="size-3.5 fill-gold text-gold" aria-hidden />
        ) : (
          <UserRound className="size-3.5" aria-hidden />
        )}
        {item.isMine ? 'Your reservation' : 'Reservation · FreeRoom'}
      </p>
      <dl className="space-y-1">
        <Row k="Held by" v={item.isMine ? 'You' : item.ownerAlias} />
        <Row k="Time" v={fmtRange(item.start, item.end)} />
        <Row k="Status" v={STATUS_LABEL[item.status] ?? item.status} />
      </dl>
      <p className="mt-3 rounded-xl bg-cream px-3 py-2 text-xs text-muted tabular">
        {open
          ? `Claims close in ${fmtDuration(cutoff.getTime() - now.getTime())} — 4h before start`
          : 'Claims are closed (less than 4h before start)'}
      </p>
      {item.claimable && !item.isMine && (
        <Button className="mt-3 w-full" onClick={() => onRequest(item)}>
          Request this room
        </Button>
      )}
    </div>
  );
}
