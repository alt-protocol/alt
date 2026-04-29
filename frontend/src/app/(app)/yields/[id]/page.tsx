"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

const CategoryDetailView = dynamic(
  () => import("@/components/CategoryDetailView"),
  { ssr: false },
);

export default function YieldDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const detailQuery = useQuery({
    queryKey: queryKeys.yields.detail(id),
    queryFn: () => api.getYieldDetail(Number(id)),
    enabled: !!id,
  });

  const y = detailQuery.data;

  return (
    <main className="max-w-[1200px] mx-auto px-[3.5rem] py-[2.25rem]">
      {detailQuery.isLoading && (
        <div className="space-y-4">
          <div className="h-8 w-64 bg-surface-high rounded-sm animate-pulse" />
          <div className="grid grid-cols-4 gap-[1px] bg-outline-ghost rounded-sm overflow-hidden">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-surface-low px-5 py-4 h-20 animate-pulse" />
            ))}
          </div>
          <div className="h-[200px] bg-surface-low rounded-sm animate-pulse" />
        </div>
      )}

      {detailQuery.isError && (
        <div className="text-center py-24">
          <p className="text-foreground-muted font-sans text-sm">Opportunity not found.</p>
          <Link href="/discover" className="mt-3 inline-block text-neon font-sans text-[0.8rem] uppercase tracking-[0.05em] hover:underline">
            Back to Discover
          </Link>
        </div>
      )}

      {y && <CategoryDetailView yield_={y} id={id} />}
    </main>
  );
}
