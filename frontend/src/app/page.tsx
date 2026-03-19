import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center bg-white dark:bg-black">
      <h1 className="text-5xl font-bold tracking-tight mb-4">Alt</h1>
      <p className="text-xl text-zinc-500 max-w-md mb-8">
        Curated, non-custodial yield opportunities on Solana.
        Your keys, your funds — we just surface the best rates.
      </p>
      <Link
        href="/dashboard"
        className="rounded-full bg-black text-white dark:bg-white dark:text-black px-8 py-3 text-sm font-semibold hover:opacity-80 transition-opacity"
      >
        Explore Yields
      </Link>
    </main>
  );
}
