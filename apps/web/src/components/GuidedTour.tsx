/**
 * Demo-site guided tour: 4 steps (map → room timeline → reserve → My Reservations / claim), shown
 * once on first visit. Radix Dialog gives focus trap, Esc to close and screen-reader labelling;
 * each step navigates the page behind the card so the judge sees what it describes.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { CalendarPlus, Handshake, Map as MapIcon, Rows3, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';

const KEY = 'freeroom.tour.v1';
const seen = () => {
  try {
    return localStorage.getItem(KEY) === 'done';
  } catch {
    return false; // storage blocked: show it, it's dismissible
  }
};
const remember = () => {
  try {
    localStorage.setItem(KEY, 'done');
  } catch {
    // private mode / blocked storage: nothing to remember, the tour just reappears next visit
  }
};

const STEPS = [
  {
    Icon: MapIcon,
    title: 'Find a free room on the map',
    body: 'Every building is colored by how many rooms are free right now. Tap one to see its rooms and live status.',
    path: '/map',
  },
  {
    Icon: Rows3,
    title: 'Read a room’s timeline',
    body: 'Purple striped blocks with a book are classes from 25Live; blue blocks are reservations. Hover or focus a block for details.',
    path: '/rooms/LGRT-0101',
  },
  {
    Icon: CalendarPlus,
    title: 'Reserve in two taps',
    body: 'Click or drag on open space, then Reserve. Try booking over a class: the server blocks it. Classes always win.',
    path: '/rooms/LGRT-0101',
  },
  {
    Icon: Handshake,
    title: 'Claim a held room',
    body: 'On someone else’s blue block, choose “Request this room”. Owners approve under My Reservations, and only then is their contact shared.',
    path: '/me',
  },
];

export function GuidedTour() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (seen()) return;
    setOpen(true);
    navigate(STEPS[0]!.path);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- first visit only

  const close = () => {
    remember();
    setOpen(false);
  };
  const go = (n: number) => {
    setI(n);
    navigate(STEPS[n]!.path);
  };
  const step = STEPS[i]!;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed right-4 bottom-4 left-4 z-50 rounded-2xl border border-line bg-surface p-5 shadow-card sm:left-auto sm:w-[26rem]">
          <div className="flex items-start justify-between gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-cream text-brown-ink">
              <step.Icon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-muted">
                Guided tour · step {i + 1} of {STEPS.length}
              </p>
              <Dialog.Title className="text-lg font-bold">{step.title}</Dialog.Title>
            </div>
            <Dialog.Close
              className="rounded-lg p-1 text-muted hover:bg-cream"
              aria-label="Skip the tour"
            >
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-2 text-sm text-espresso">
            {step.body}
          </Dialog.Description>
          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="flex gap-1" aria-hidden>
              {STEPS.map((s, n) => (
                <span
                  key={s.title}
                  className={`size-2 rounded-full ${n === i ? 'bg-brown' : 'bg-line'}`}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {i > 0 && (
                <Button variant="ghost" size="sm" onClick={() => go(i - 1)}>
                  Back
                </Button>
              )}
              {i < STEPS.length - 1 ? (
                <Button size="sm" onClick={() => go(i + 1)} autoFocus>
                  Next
                </Button>
              ) : (
                <Button size="sm" onClick={close} autoFocus>
                  Done
                </Button>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
