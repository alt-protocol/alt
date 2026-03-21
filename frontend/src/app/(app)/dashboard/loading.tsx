export default function DashboardLoading() {
  return (
    <main className="max-w-[1200px] mx-auto px-[3.5rem] py-[2.25rem]">
      {/* Hero skeleton */}
      <div className="mb-[2.25rem]">
        <div className="bg-surface-high animate-pulse rounded-sm h-5 w-40 mb-4" />
        <div className="bg-surface-high animate-pulse rounded-sm h-14 w-64 mb-2" />
        <div className="bg-surface-high animate-pulse rounded-sm h-14 w-48 mb-4" />
        <div className="bg-surface-high animate-pulse rounded-sm h-4 w-96 mt-4" />
      </div>

      {/* Stats bar skeleton */}
      <div className="grid grid-cols-4 gap-[1px] bg-outline-ghost rounded-sm overflow-hidden mb-[2.25rem]">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-surface-low px-5 py-4">
            <div className="bg-surface-high animate-pulse rounded-sm h-3 w-16 mb-2" />
            <div className="bg-surface-high animate-pulse rounded-sm h-7 w-20" />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="bg-surface-low rounded-sm overflow-hidden">
        <div className="px-5 py-3">
          <div className="bg-surface-high animate-pulse rounded-sm h-5 w-40" />
        </div>
        <div className="bg-surface h-10" />
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="flex gap-4 px-5 py-3">
            <div className="bg-surface-high animate-pulse rounded-sm h-4 flex-[2]" />
            <div className="bg-surface-high animate-pulse rounded-sm h-4 w-20" />
            <div className="bg-surface-high animate-pulse rounded-sm h-4 w-24" />
            <div className="bg-surface-high animate-pulse rounded-sm h-4 w-20" />
            <div className="bg-surface-high animate-pulse rounded-sm h-4 w-16" />
            <div className="bg-surface-high animate-pulse rounded-sm h-4 w-16" />
          </div>
        ))}
      </div>
    </main>
  );
}
