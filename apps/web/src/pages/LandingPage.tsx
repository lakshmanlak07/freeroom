/** Logged-out landing: vertical gradient hero, pitch, sign in / try the demo, three feature cards. */
import { BookOpen, CalendarPlus, DoorOpen, Handshake, Search, UserRound } from 'lucide-react';
import { Link, Navigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { buttonVariants } from '@/components/ui/button';
import { useConfig } from '@/config';
import { cn } from '@/lib/utils';

const FEATURES = [
  {
    Icon: Search,
    title: 'Find',
    body: 'Every classroom on campus with live status — free now, free until 3:15, or class in progress.',
  },
  {
    Icon: CalendarPlus,
    title: 'Reserve',
    body: 'Drag on a room’s timeline. Classes always win, and nobody can double-book you.',
  },
  {
    Icon: Handshake,
    title: 'Claim',
    body: 'Need a held room? Ask politely. Contact is shared only if the holder agrees.',
  },
];

export function LandingPage() {
  const { status } = useAuth();
  const config = useConfig();
  if (status === 'ready') return <Navigate to="/" replace />;
  return (
    <div className="min-h-dvh bg-cream">
      <header className="bg-brand-gradient px-6 pt-6 pb-40 text-white md:px-12">
        <nav className="flex items-center justify-between" aria-label="Site">
          <span className="flex items-center gap-2 text-2xl font-bold">
            <DoorOpen className="size-8" aria-hidden /> FreeRoom
          </span>
          <Link to="/login" className={cn(buttonVariants({ variant: 'light' }))}>
            Sign in
          </Link>
        </nav>
        <div className="mx-auto mt-16 max-w-3xl text-center">
          <h1 className="text-5xl leading-tight font-bold md:text-6xl">
            Google Maps for empty classrooms.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-white/90">
            See every free room on campus right now, reserve it in two taps, and never get kicked
            out by a class you didn’t know about.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to="/login"
              className={cn(buttonVariants({ size: 'lg' }), 'bg-white text-brown hover:bg-cream')}
            >
              Sign in
            </Link>
            {config.demoMode && (
              <Link
                to="/login"
                state={{ demo: true }}
                className={cn(
                  buttonVariants({ size: 'lg', variant: 'light' }),
                  'ring-1 ring-white/60',
                )}
              >
                Try the demo
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto -mt-24 max-w-5xl px-6 pb-16">
        <div
          aria-hidden
          className="mx-auto mb-10 max-w-3xl rounded-2xl border border-line bg-white p-4 shadow-card"
        >
          <p className="mb-2 text-xs font-semibold text-muted">LGRT 0101 · today</p>
          <div className="relative h-14 rounded-xl bg-free-50">
            <div className="stripes-class absolute inset-y-2 left-[8%] flex w-[16%] items-center gap-1 rounded-lg bg-plum px-2 text-[11px] font-semibold text-white">
              <BookOpen className="size-3" /> CS 220
            </div>
            <div className="absolute inset-y-2 left-[30%] flex w-[14%] items-center gap-1 rounded-lg bg-slate px-2 text-[11px] font-semibold text-white">
              <UserRound className="size-3" /> Night Owl
            </div>
            <div className="stripes-class absolute inset-y-2 left-[56%] flex w-[16%] items-center gap-1 rounded-lg bg-plum px-2 text-[11px] font-semibold text-white">
              <BookOpen className="size-3" /> MATH 233
            </div>
            <div className="absolute inset-y-2 left-[76%] grid w-[18%] place-items-center rounded-lg border-2 border-dashed border-free text-[11px] font-semibold text-free-ink">
              + Reserve
            </div>
          </div>
        </div>
        <ul className="grid gap-4 md:grid-cols-3">
          {FEATURES.map(({ Icon, title, body }) => (
            <li key={title} className="rounded-2xl border border-line bg-white p-6 shadow-card">
              <span className="grid size-11 place-items-center rounded-xl bg-cream text-brown">
                <Icon className="size-6" aria-hidden />
              </span>
              <h2 className="mt-4 text-xl font-bold">{title}</h2>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-center text-xs text-muted">
          FreeRoom reservations are informal and student-run — not an official university booking.
          {config.demoMode && ' This deployment shows demo data.'}
        </p>
      </main>
    </div>
  );
}
