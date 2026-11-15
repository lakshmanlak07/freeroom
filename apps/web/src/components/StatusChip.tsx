import type { RoomStatus } from '@freeroom/shared';
import { BookOpen, Lock, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { freeUntilLabel } from '@/lib/time';

/** BR-2 / a11y: every status is color + icon + text. */
export function StatusChip({
  status,
  freeUntil,
  className,
}: {
  status: RoomStatus;
  freeUntil?: string | null;
  className?: string;
}) {
  const base =
    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular whitespace-nowrap';
  switch (status) {
    case 'FREE':
      return (
        <span className={cn(base, 'bg-free-50 text-free-ink', className)}>
          <span className="size-2 rounded-full bg-free" aria-hidden />
          {freeUntilLabel(freeUntil ?? null)}
        </span>
      );
    case 'CLASS_IN_PROGRESS':
      return (
        <span className={cn(base, 'bg-plum-50 text-plum', className)}>
          <BookOpen className="size-3.5" aria-hidden />
          Class in progress
        </span>
      );
    case 'RESERVED_CLAIMABLE':
      return (
        <span className={cn(base, 'border border-slate bg-surface text-slate', className)}>
          <UserRound className="size-3.5" aria-hidden />
          Reserved · Claimable
        </span>
      );
    case 'RESERVED':
      return (
        <span className={cn(base, 'bg-slate-50 text-slate', className)}>
          <Lock className="size-3.5" aria-hidden />
          Reserved
        </span>
      );
  }
}
