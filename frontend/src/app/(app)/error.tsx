"use client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-8">
      <div className="max-w-md text-center">
        <h2 className="font-headline text-xl mb-3 text-foreground">
          Something went wrong
        </h2>
        <p className="text-foreground-muted text-sm mb-6">
          An unexpected error occurred. Please try again.
        </p>
        <button
          onClick={reset}
          className="bg-white text-surface font-sans text-sm uppercase tracking-[0.05em] px-6 py-2 rounded-sm hover:opacity-90 transition-opacity"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
