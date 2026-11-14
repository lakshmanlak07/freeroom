import type { Role } from '@freeroom/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  CalendarCheck,
  DoorOpen,
  FlaskConical,
  LogOut,
  Map as MapIcon,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { useConfig } from '@/config';
import { cn } from '@/lib/utils';
import { ErrorBoundary } from './ErrorBoundary';

export const ROLE_LABEL: Record<Role, string> = {
  STUDENT: 'Student',
  FACULTY: 'Faculty/Staff',
  TUTOR: 'Tutor',
  ADMIN: 'Admin',
};

interface NavItem {
  to: string;
  label: string;
  Icon: LucideIcon;
  badge?: number;
}

function useNav(): NavItem[] {
  const { me, api } = useAuth();
  const unread =
    useQuery({
      queryKey: ['notifications'],
      queryFn: api.notifications,
      refetchInterval: 30_000,
    }).data?.notifications.filter((n) => !n.read).length ?? 0;
  return [
    { to: '/', label: 'Search', Icon: Search },
    { to: '/map', label: 'Map', Icon: MapIcon },
    { to: '/me/reservations', label: 'My Reservations', Icon: CalendarCheck },
    { to: '/notifications', label: 'Notifications', Icon: Bell, badge: unread },
    ...(me?.role === 'ADMIN' ? [{ to: '/demo', label: 'Demo', Icon: FlaskConical }] : []),
  ];
}

function Badge({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-gold px-1.5 text-[11px] font-bold text-espresso tabular">
      {n > 9 ? '9+' : n}
      <span className="sr-only"> unread</span>
    </span>
  );
}

export function AppShell() {
  const nav = useNav();
  const { me, signOut } = useAuth();
  const location = useLocation();
  useEffect(() => {
    // Move focus to content on navigation so keyboard/screen-reader users land in the page.
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [location.pathname]);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-xl bg-white px-4 py-2 font-semibold text-espresso shadow-card focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <aside className="bg-rail sticky top-0 hidden h-dvh flex-col p-4 text-white md:flex">
        <Link
          to="/"
          className="mb-6 flex items-center gap-2 rounded-xl px-2 py-2 text-xl font-bold tracking-tight"
        >
          <DoorOpen className="size-7" aria-hidden /> FreeRoom
        </Link>
        <nav aria-label="Main">
          <ul className="space-y-1">
            {nav.map(({ to, label, Icon, badge }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/85 transition hover:bg-white/10 hover:text-white',
                      isActive && 'bg-white/20 text-white',
                    )
                  }
                >
                  <Icon className="size-5" aria-hidden />
                  {label}
                  <Badge n={badge} />
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        {me && (
          <div className="mt-auto rounded-2xl bg-white/10 p-3">
            <p className="truncate font-semibold">{me.displayAlias}</p>
            <p className="mt-1 inline-block rounded-full bg-white/20 px-2 py-0.5 text-xs">
              {ROLE_LABEL[me.role]}
            </p>
            <button
              onClick={() => void signOut()}
              className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-white/85 hover:bg-white/10"
            >
              <LogOut className="size-4" aria-hidden /> Sign out
            </button>
          </div>
        )}
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col pb-16 md:pb-0">
        <TopBar />
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white md:hidden"
      >
        <ul className="flex">
          {nav.map(({ to, label, Icon, badge }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn(
                    'relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted',
                    isActive && 'text-brown',
                  )
                }
              >
                <Icon className="size-5" aria-hidden />
                {label.replace('My ', '')}
                {!!badge && (
                  <span
                    className="absolute top-1 right-[calc(50%-1.25rem)] size-2.5 rounded-full bg-gold"
                    aria-label={`${badge} unread`}
                  />
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function TopBar() {
  const config = useConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const onSearch = location.pathname === '/';
  const [q, setQ] = useState(onSearch ? (params.get('q') ?? '') : '');
  useEffect(() => {
    if (onSearch) setQ(params.get('q') ?? '');
  }, [onSearch, params]);

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white/90 px-4 py-3 backdrop-blur md:px-6">
      <Link
        to="/"
        className="flex items-center gap-1.5 font-bold text-brown md:hidden"
        aria-label="FreeRoom home"
      >
        <DoorOpen className="size-6" aria-hidden />
      </Link>
      <form
        role="search"
        className="relative min-w-0 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!onSearch) navigate(`/?q=${encodeURIComponent(q)}`);
        }}
      >
        <label htmlFor="global-search" className="sr-only">
          Search rooms
        </label>
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          id="global-search"
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (onSearch) {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set('q', e.target.value);
              else next.delete('q');
              setParams(next, { replace: true });
            }
          }}
          placeholder="Room for 6 with a projector near the library at 3pm"
          className="h-10 w-full max-w-2xl rounded-xl border border-line bg-cream pr-3 pl-9 text-sm placeholder:text-muted/80"
        />
      </form>
      {config.demoMode && (
        <span className="shrink-0 rounded-full border border-amber/40 bg-amber/10 px-2.5 py-1 text-xs font-semibold text-amber-ink">
          Demo data
        </span>
      )}
    </header>
  );
}
