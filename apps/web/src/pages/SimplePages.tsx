import { Compass, Construction } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/EmptyState';

export function NotFoundPage() {
  return (
    <div className="p-6">
      <EmptyState
        icon={Compass}
        title="Page not found"
        body="That link doesn’t lead to a room — or anywhere else."
        action={
          <Link to="/" className="font-semibold text-brown-ink underline underline-offset-2">
            Find a free room
          </Link>
        }
      />
    </div>
  );
}

/** Placeholder for screens built in P6 (map, my reservations, notifications, demo). */
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-bold">{title}</h1>
      <EmptyState
        icon={Construction}
        title="Coming in the next build"
        body="This screen lands with the claims and map work."
      />
    </div>
  );
}
