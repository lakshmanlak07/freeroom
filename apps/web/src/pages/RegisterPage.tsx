import { RegisterRequestSchema, type ShareChannel } from '@freeroom/shared';
import { ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ApiError } from '@/api/client';
import { FullPageSpinner, useAuth } from '@/auth/AuthProvider';
import { Button, inputClass } from '@/components/ui/button';
import { BrandPanel } from './LoginPage';

/** Onboarding (/register). Role is never chosen here: everyone starts as Student (PRD §7, option 2). */
export function RegisterPage() {
  const { status, api, refresh } = useAuth();
  const navigate = useNavigate();
  const [universityId, setUniversityId] = useState('');
  const [displayAlias, setAlias] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [shareChannel, setShare] = useState<ShareChannel>('email');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'signedOut') return <Navigate to="/login" replace />;
  if (status === 'ready') return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const body = {
      universityId: universityId.trim(),
      displayAlias: displayAlias.trim(),
      contact: {
        ...(email.trim() && { email: email.trim() }),
        ...(phone.trim() && { phone: phone.trim() }),
      },
      shareChannel,
    };
    const parsed = RegisterRequestSchema.safeParse(body);
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((i) => `${i.path.join('.') || 'form'}: ${i.message}`).join('. '),
      );
      return;
    }
    if (!body.contact[shareChannel]) {
      setError(`Add a ${shareChannel} to share it.`);
      return;
    }
    setBusy(true);
    try {
      await api.register(parsed.data);
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'UID_ALREADY_REGISTERED'
          ? 'This University ID is already registered to another account. If that isn’t you, contact FreeRoom support.'
          : err instanceof Error
            ? err.message
            : 'Registration failed.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh md:grid-cols-[1fr_1.1fr]">
      <BrandPanel>
        <h1 className="text-4xl leading-tight font-bold">Welcome to FreeRoom</h1>
        <p className="mt-6 flex gap-3 rounded-2xl bg-white/10 p-4 text-white/95 backdrop-blur">
          <ShieldCheck className="size-6 shrink-0" aria-hidden />
          Your University ID is used once to verify you and is never shown — we only keep a one-way
          fingerprint of it. Others see your alias, never your name or contact.
        </p>
      </BrandPanel>
      <main className="flex items-center justify-center bg-white p-6">
        <form className="w-full max-w-md space-y-4" onSubmit={submit} noValidate>
          <h2 className="text-2xl font-bold">Set up your profile</h2>
          <label className="block text-sm font-medium">
            University ID
            <input
              className={`${inputClass} mt-1 tabular`}
              value={universityId}
              onChange={(e) => setUniversityId(e.target.value)}
              autoComplete="off"
              inputMode="text"
              required
              aria-describedby="uid-note"
            />
            <span id="uid-note" className="mt-1 block text-xs font-normal text-muted">
              Verifies one account per person. Stored only as a keyed hash; never displayed or
              shared.
            </span>
          </label>
          <div className="rounded-xl bg-cream px-3 py-2 text-sm">
            <span className="font-medium">Role: Student</span>
            <span className="block text-xs text-muted">
              Faculty/Staff and Tutor roles are granted by a FreeRoom admin after sign-up.
            </span>
          </div>
          <label className="block text-sm font-medium">
            Display alias
            <input
              className={`${inputClass} mt-1`}
              value={displayAlias}
              maxLength={40}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="Night Owl"
              required
            />
            <span className="mt-1 block text-xs font-normal text-muted">
              Shown on your reservations instead of your name.
            </span>
          </label>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-1 text-sm font-medium">Contact (private)</legend>
            <label className="text-sm">
              Email
              <input
                className={`${inputClass} mt-1`}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Phone
              <input
                className={`${inputClass} mt-1`}
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium">Share if I approve someone’s request</legend>
            <div className="mt-2 flex gap-2">
              {(['email', 'phone'] as const).map((c) => (
                <label
                  key={c}
                  className="flex flex-1 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm has-[:checked]:border-brown has-[:checked]:bg-cream"
                >
                  <input
                    type="radio"
                    name="share"
                    value={c}
                    checked={shareChannel === c}
                    onChange={() => setShare(c)}
                    className="accent-brown"
                  />
                  {c === 'email' ? 'My email' : 'My phone'}
                </label>
              ))}
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="rounded-xl bg-amber/10 px-3 py-2 text-sm text-amber-ink">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? 'Saving…' : 'Finish setup'}
          </Button>
        </form>
      </main>
    </div>
  );
}
