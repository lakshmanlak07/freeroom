import type { RoomWithStatus } from '@freeroom/shared';
import { ChevronRight, Footprints, Users } from 'lucide-react';
import { Link } from 'react-router';
import { useFeature } from '@/config';
import { EquipmentList } from './Equipment';
import { StatusChip } from './StatusChip';

/**
 * The whole card opens the room (a stretched link from the title); with directions on, a separate
 * "Get me there" link sits above it (no interactive element nested inside another link).
 */
export function RoomCard({ room }: { room: RoomWithStatus }) {
  const directions = useFeature('directions');
  return (
    <li className="group relative flex h-full flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card transition hover:-translate-y-0.5 hover:border-tan motion-reduce:hover:translate-y-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">
            <Link
              to={`/rooms/${encodeURIComponent(room.roomId)}`}
              className="rounded-sm after:absolute after:inset-0 after:rounded-2xl after:content-['']"
            >
              {room.name}
            </Link>
          </h3>
          <p className="truncate text-sm text-muted">{room.buildingName}</p>
        </div>
        <ChevronRight
          className="mt-1 size-5 shrink-0 text-tan transition group-hover:translate-x-0.5"
          aria-hidden
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusChip status={room.status} freeUntil={room.freeUntil} />
        {directions && (
          <Link
            to={`/map?to=${encodeURIComponent(room.roomId)}`}
            aria-label={`Get me there: ${room.name}`}
            className="relative z-10 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-cream px-3 text-sm font-semibold text-brown-ink hover:border-brown md:min-h-8"
          >
            <Footprints className="size-4" aria-hidden /> Get me there
          </Link>
        )}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="inline-flex items-center gap-1 text-sm text-muted tabular">
          <Users className="size-4" aria-hidden />
          {room.capacity}
          <span className="sr-only">seats</span>
        </span>
        <EquipmentList items={room.equipment} />
      </div>
    </li>
  );
}
