import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-8">
      <div className="max-w-md text-center">
        <h1 className="font-headline text-4xl mb-3 text-foreground">404</h1>
        <p className="text-foreground-muted text-sm mb-6">
          This page does not exist.
        </p>
        <Link
          href="/discover"
          className="bg-white text-surface font-sans text-sm uppercase tracking-[0.05em] px-6 py-2 rounded-sm hover:opacity-90 transition-opacity"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
