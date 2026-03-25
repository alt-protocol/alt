import WalletButton from "@/components/WalletButton";

export function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {/* Stats skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-[1px] bg-outline-ghost rounded-sm overflow-hidden">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-surface-low px-5 py-4">
            <div className="bg-surface-high animate-pulse rounded-sm h-3 w-16 mb-2" />
            <div className="bg-surface-high animate-pulse rounded-sm h-7 w-28" />
          </div>
        ))}
      </div>
      {/* Chart skeleton */}
      <div className="bg-surface-low rounded-sm p-5">
        <div className="bg-surface-high animate-pulse rounded-sm h-[180px] w-full" />
      </div>
      {/* Table skeleton */}
      <div className="bg-surface-low rounded-sm overflow-hidden">
        <div className="bg-surface h-10" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-4 px-5 py-3">
            <div className="bg-surface-high animate-pulse rounded-sm h-4 flex-1" />
            <div className="bg-surface-high animate-pulse rounded-sm h-4 w-24" />
            <div className="bg-surface-high animate-pulse rounded-sm h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function NoWalletState() {
  return (
    <div className="bg-surface-low rounded-sm px-6 py-12 text-center">
      <p className="uppercase text-[0.65rem] tracking-[0.05em] text-foreground-muted font-sans mb-1">
        No wallet detected
      </p>
      <p className="font-display text-lg tracking-[-0.02em] mb-5">
        Connect to view your positions
      </p>
      <WalletButton variant="cta" />
    </div>
  );
}

export function ErrorState() {
  return (
    <div className="bg-surface-low rounded-sm px-6 py-12 text-center">
      <p className="uppercase text-[0.65rem] tracking-[0.05em] text-foreground-muted font-sans mb-1">
        Error loading positions
      </p>
      <p className="font-display text-lg tracking-[-0.02em]">
        Could not fetch portfolio data
      </p>
    </div>
  );
}

export function SyncingState() {
  return (
    <div className="bg-surface-low rounded-sm px-6 py-12 text-center">
      <p className="uppercase text-[0.65rem] tracking-[0.05em] text-foreground-muted font-sans mb-1 animate-pulse">
        Syncing
      </p>
      <p className="font-display text-lg tracking-[-0.02em]">
        Fetching on-chain positions...
      </p>
      <p className="text-foreground-muted text-[0.75rem] font-sans mt-2">
        This may take a moment on first load
      </p>
    </div>
  );
}
