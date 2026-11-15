/**
 * Draggable bottom sheet for phones (< lg); a plain static panel from lg up. Two snap points:
 * "peek" (the hero stays visible above the tab bar) and "full". The handle is a real button, so
 * keyboard and screen-reader users can expand/collapse it too. Spring-like snap via CSS.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const PEEK = 340; // px visible when collapsed: the hero (ETA, verdict, next step)

export function BottomSheet({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  // Phones open at "peek" so the map (and the route) stays visible; drag up for the details.
  const [expanded, setExpanded] = useState(false);
  const [drag, setDrag] = useState<number | null>(null); // live offset while dragging
  const start = useRef(0);
  const moved = useRef(false);
  // Track the sheet height (content loads after mount) so the peek offset stays right.
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const collapsedOffset = () => Math.max(0, height - PEEK);
  const base = expanded ? 0 : collapsedOffset();
  const offset = drag ?? base;

  return (
    <aside
      ref={ref}
      aria-label={label}
      className={cn(
        'fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 max-h-[78dvh] overflow-y-auto overscroll-contain rounded-t-3xl border-t border-line bg-cream px-4 pb-6 shadow-[0_-12px_32px_-12px_rgb(0_0_0/0.35)]',
        drag === null &&
          'transition-[translate] duration-300 ease-[cubic-bezier(0.2,0.9,0.3,1.15)] motion-reduce:transition-none',
        'translate-y-(--sheet-y) lg:static lg:z-auto lg:max-h-none lg:translate-y-0 lg:rounded-none lg:border-t-0 lg:border-l lg:p-4 lg:shadow-none',
        className,
      )}
      // Phones only: the offset feeds translate-y below lg; desktop stays a static side panel.
      style={{ ['--sheet-y' as string]: `${offset}px` }}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
        className="sticky top-0 z-10 -mx-4 mb-2 flex w-[calc(100%+2rem)] touch-none justify-center bg-cream pt-2 pb-3 lg:hidden"
        onClick={() => {
          if (!moved.current) setExpanded((e) => !e);
          moved.current = false;
        }}
        onPointerDown={(e) => {
          start.current = e.clientY - base;
          moved.current = false;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(base);
        }}
        onPointerMove={(e) => {
          if (drag === null) return;
          const next = Math.min(collapsedOffset(), Math.max(0, e.clientY - start.current));
          if (Math.abs(next - base) > 8) moved.current = true;
          setDrag(next);
        }}
        onPointerUp={() => {
          if (drag === null) return;
          if (moved.current) setExpanded(drag < collapsedOffset() / 2);
          setDrag(null);
        }}
      >
        <span aria-hidden className="h-1.5 w-12 rounded-full bg-line" />
      </button>
      {children}
    </aside>
  );
}
