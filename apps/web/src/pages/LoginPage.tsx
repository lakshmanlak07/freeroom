import { CalendarPlus, DoorOpen, Handshake, Search } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { FullPageSpinner, useAuth } from '@/auth/AuthProvider';
import { Button, inputClass } from '@/components/ui/button';
import { useConfig } from '@/config';

const DEMO = [
  { id: 'student1', label: 'Student' },
  { id: 'faculty1', label: 'Faculty' },
  { id: 'admin1', label: 'Admin' },
] as const;

export function BrandPanel({ children }: { children?: React.ReactNode }) {
  return (
    <section className="bg-rail relative flex flex-col justify-between gap-8 px-6 py-8 text-white md:px-12 md:py-14">
      <p className="flex items-center gap-2 text-2xl font-bold tracking-tight">
        <DoorOpen className="size-8" aria-hidden /> FreeRoom
      </p>
      <div className="max-w-md">{children}</div>
      <p className="hidden text-sm text-white/80 md:block">UMass Amherst · v1</p>
    </section>
  );
}

export function LoginPage() {
  const { status, mode, signIn, signInDev, signUp, confirmSignUp } = useAuth();
  const config = useConfig();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [devId, setDevId] = useState('');
  const [step, setStep] = useState<'signIn' | 'signUp' | 'confirm'>('signIn');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  if (status === 'ready') return <Navigate to={from} replace />;
  if (status === 'needsRegistration') return <Navigate to="/register" replace />;
  if (status === 'loading' && !busy) return <FullPageSpinner />;

  const run = (fn: () => Promise<void>) => async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const quick = (id: string) =>
    mode === 'dev'
      ? run(() => signInDev(id))()
      : (setEmail(`${id}@demo.freeroom.test`), passwordRef.current?.focus());

  return (
    <div className="grid min-h-dvh md:grid-cols-[1.1fr_1fr]">
      <BrandPanel>
        <h1 className="text-4xl leading-tight font-bold md:text-5xl">
          Google Maps for empty classrooms.
        </h1>
        <p className="mt-4 text-lg text-white/90">
          See every free room on campus right now, reserve it in two taps, and never get kicked out
          by a class.
        </p>
        <ul className="mt-8 hidden gap-3 md:grid">
          {[
            [Search, 'Find', 'Free rooms near you, filtered by size and equipment.'],
            [CalendarPlus, 'Reserve', 'Drag on the timeline. Classes always win.'],
            [Handshake, 'Claim', 'Ask the holder politely — contact shared only if they agree.'],
          ].map(([Icon, title, body]) => {
            const I = Icon as typeof Search;
            return (
              <li
                key={title as string}
                className="flex gap-3 rounded-2xl bg-white/10 p-4 backdrop-blur"
              >
                <I className="size-6 shrink-0" aria-hidden />
                <span>
                  <strong className="block">{title as string}</strong>
                  <span className="text-sm text-white/90">{body as string}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </BrandPanel>

      <main className="flex items-center justify-center bg-white p-6">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold">
            {step === 'signIn'
              ? 'Sign in'
              : step === 'signUp'
                ? 'Create account'
                : 'Check your email'}
          </h2>

          {config.demoMode && step === 'signIn' && (
            <div className="mt-6 rounded-2xl border border-line bg-cream p-4">
              <p className="text-sm font-semibold">Try the demo</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {DEMO.map((d) => (
                  <Button
                    key={d.id}
                    variant="outline"
                    size="sm"
                    onClick={() => quick(d.id)}
                    disabled={busy}
                  >
                    Demo as {d.label}
                  </Button>
                ))}
              </div>
              {mode === 'cognito' && (
                <p className="mt-2 text-xs text-muted">
                  Fills the demo email — enter the demo password you were given.
                </p>
              )}
            </div>
          )}

          {mode === 'dev' ? (
            <form className="mt-6 space-y-3" onSubmit={run(() => signInDev(devId.trim()))}>
              <p className="text-sm text-muted">
                Local development sign-in (no passwords). Use a new id to try registration.
              </p>
              <label className="block text-sm font-medium">
                Dev user id
                <input
                  className={`${inputClass} mt-1`}
                  value={devId}
                  onChange={(e) => setDevId(e.target.value)}
                  placeholder="newstudent"
                  required
                  pattern="[A-Za-z0-9_-]{3,40}"
                />
              </label>
              <Button type="submit" className="w-full" disabled={busy}>
                Continue
              </Button>
            </form>
          ) : step === 'confirm' ? (
            <form
              className="mt-6 space-y-3"
              onSubmit={run(() => confirmSignUp(email, code.trim(), password))}
            >
              <p className="text-sm text-muted">We sent a 6-digit code to {email}.</p>
              <label className="block text-sm font-medium">
                Verification code
                <input
                  className={`${inputClass} mt-1 tabular`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </label>
              <Button type="submit" className="w-full" disabled={busy}>
                Verify and sign in
              </Button>
            </form>
          ) : (
            <form
              className="mt-6 space-y-3"
              onSubmit={run(async () => {
                if (step === 'signIn') await signIn(email.trim(), password);
                else {
                  await signUp(email.trim(), password);
                  setStep('confirm');
                }
              })}
            >
              <label className="block text-sm font-medium">
                Email
                <input
                  className={`${inputClass} mt-1`}
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label className="block text-sm font-medium">
                Password
                <input
                  ref={passwordRef}
                  className={`${inputClass} mt-1`}
                  type="password"
                  autoComplete={step === 'signIn' ? 'current-password' : 'new-password'}
                  minLength={12}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              {step === 'signUp' && (
                <p className="text-xs text-muted">
                  At least 12 characters with upper, lower, number and symbol.
                </p>
              )}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Please wait…' : step === 'signIn' ? 'Sign in' : 'Create account'}
              </Button>
              <button
                type="button"
                className="w-full text-sm font-medium text-brown underline-offset-2 hover:underline"
                onClick={() => setStep(step === 'signIn' ? 'signUp' : 'signIn')}
              >
                {step === 'signIn' ? 'New here? Create an account' : 'Have an account? Sign in'}
              </button>
            </form>
          )}
          {error && (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-amber/10 px-3 py-2 text-sm text-amber-ink"
            >
              {error}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
