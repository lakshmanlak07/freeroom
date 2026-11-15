import { Compass } from 'lucide-react';
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
