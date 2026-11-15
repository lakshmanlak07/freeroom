/** "Add to calendar": Apple / any app (.ics), Google, Outlook — one small menu. */
import * as Popover from '@radix-ui/react-popover';
import { CalendarPlus, Download } from 'lucide-react';
import { googleCalendarUrl, outlookCalendarUrl, type CalEvent } from '@/lib/calendar';
import { cn } from '@/lib/utils';
import { buttonVariants } from '../ui/button';

export function CalendarMenu({
  event,
  icsHref,
  onIcs,
  className,
  size = 'default',
}: {
  event: CalEvent;
  /** Public .ics URL (invite page) … */
  icsHref?: string;
  /** … or a callback that downloads it with auth (owner/attendee). */
  onIcs?: () => void;
  className?: string;
  size?: 'default' | 'lg' | 'sm';
}) {
  const item =
    'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium hover:bg-cream';
  return (
    <Popover.Root>
      <Popover.Trigger className={cn(buttonVariants({ variant: 'outline', size }), className)}>
        <CalendarPlus className="size-4" aria-hidden /> Add to calendar
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          align="start"
          collisionPadding={12}
          className="z-50 w-64 rounded-2xl border border-line bg-surface p-2 shadow-card"
          aria-label="Add to calendar"
        >
          {icsHref ? (
            <a className={item} href={icsHref} download>
              <Download className="size-4" aria-hidden /> Apple Calendar / any app (.ics)
            </a>
          ) : (
            <button type="button" className={item} onClick={onIcs}>
              <Download className="size-4" aria-hidden /> Apple Calendar / any app (.ics)
            </button>
          )}
          <a className={item} href={googleCalendarUrl(event)} target="_blank" rel="noreferrer">
            <span aria-hidden className="grid size-4 place-items-center font-bold text-[#4285F4]">
              G
            </span>
            Google Calendar
          </a>
          <a className={item} href={outlookCalendarUrl(event)} target="_blank" rel="noreferrer">
            <span aria-hidden className="grid size-4 place-items-center font-bold text-[#0078D4]">
              O
            </span>
            Outlook
          </a>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
