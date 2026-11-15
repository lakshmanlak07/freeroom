/** Light / Dark / System as a 3-way toggle group (aria-pressed on each button). */
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePref } from '@/lib/theme';
import { cn } from '@/lib/utils';

const OPTIONS: { pref: ThemePref; label: string; Icon: typeof Sun }[] = [
  { pref: 'light', label: 'Light', Icon: Sun },
  { pref: 'dark', label: 'Dark', Icon: Moon },
  { pref: 'system', label: 'System', Icon: Monitor },
];

/** `onRail`: white-on-brown sidebar styling; otherwise themed surface styling. */
export function ThemeToggle({ onRail = false }: { onRail?: boolean }) {
  const { pref, setPref } = useTheme();
  return (
    <div
      role="group"
      aria-label="Theme"
      className={cn(
        'grid grid-cols-3 gap-1 rounded-xl p-1',
        onRail ? 'bg-black/20' : 'border border-line bg-cream',
      )}
    >
      {OPTIONS.map(({ pref: p, label, Icon }) => (
        <button
          key={p}
          type="button"
          aria-pressed={pref === p}
          onClick={() => setPref(p)}
          className={cn(
            'flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium md:min-h-8',
            onRail
              ? pref === p
                ? 'bg-white/25 text-white'
                : 'text-white/85 hover:bg-white/10'
              : pref === p
                ? 'bg-surface text-espresso shadow-sm'
                : 'text-muted hover:text-espresso',
          )}
        >
          <Icon className="size-4" aria-hidden /> {label}
        </button>
      ))}
    </div>
  );
}
