import type { Equipment } from '@freeroom/shared';
import {
  Accessibility,
  Monitor,
  Plug,
  Presentation,
  Projector,
  type LucideIcon,
} from 'lucide-react';

export const EQUIPMENT: Record<Equipment, { label: string; Icon: LucideIcon }> = {
  projector: { label: 'Projector', Icon: Projector },
  whiteboard: { label: 'Whiteboard', Icon: Presentation },
  computers: { label: 'Computers', Icon: Monitor },
  outlets: { label: 'Outlets', Icon: Plug },
  accessible: { label: 'Accessible', Icon: Accessibility },
};

export function EquipmentList({ items, labels = false }: { items: Equipment[]; labels?: boolean }) {
  if (!items.length) return <span className="text-xs text-muted">No listed equipment</span>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Equipment">
      {items.map((e) => {
        const { Icon, label } = EQUIPMENT[e];
        return (
          <li
            key={e}
            className="inline-flex items-center gap-1 rounded-lg bg-cream px-2 py-1 text-xs text-muted"
            title={label}
          >
            <Icon className="size-3.5" aria-hidden />
            <span className={labels ? '' : 'sr-only'}>{label}</span>
          </li>
        );
      })}
    </ul>
  );
}
