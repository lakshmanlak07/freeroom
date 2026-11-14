import { Button } from '@/components/ui/button';

export function App() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-3xl font-bold">FreeRoom</h1>
      <p className="mt-2 text-neutral-600">Find a free classroom on campus.</p>
      <Button className="mt-4">Find a room</Button>
    </main>
  );
}
