import type { RoomWithStatus } from '@freeroom/shared';
import { ChevronRight, Users } from 'lucide-react';
import { Link } from 'react-router';
import { EquipmentList } from './Equipment';
import { StatusChip } from './StatusChip';

export function RoomCard({ room }: { room: RoomWithStatus }) {
  return (
    <li>
      <Link
        to={`/rooms/${encodeURIComponent(room.roomId)}`}
        className="group flex h-full flex-col gap-3 rounded-2xl border border-line bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:border-tan"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold">{room.name}</h3>
            <p className="truncate text-sm text-muted">{room.buildingName}</p>
          </div>
          <ChevronRight
            className="mt-1 size-5 shrink-0 text-tan transition group-hover:translate-x-0.5"
            aria-hidden
          />
        </div>
        <StatusChip status={room.status} freeUntil={room.freeUntil} className="self-start" />
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span className="inline-flex items-center gap-1 text-sm text-muted tabular">
            <Users className="size-4" aria-hidden />
            {room.capacity}
            <span className="sr-only">seats</span>
          </span>
          <EquipmentList items={room.equipment} />
        </div>
      </Link>
    </li>
  );
}
