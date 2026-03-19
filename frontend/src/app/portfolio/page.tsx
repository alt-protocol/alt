export default function Portfolio() {
  return (
    <div className="min-h-screen bg-white dark:bg-black text-black dark:text-white">
      <header className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 flex items-center justify-between">
        <a href="/" className="text-xl font-bold">Alt</a>
        <nav className="flex gap-4 text-sm text-zinc-500">
          <a href="/dashboard" className="hover:text-black dark:hover:text-white transition-colors">Dashboard</a>
          <a href="/portfolio" className="text-black dark:text-white font-medium">Portfolio</a>
        </nav>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">Portfolio</h1>
        <p className="text-zinc-500">
          Connect your wallet to view on-chain positions across Kamino, Drift, and Exponent.
        </p>
        <p className="text-zinc-400 text-sm mt-2">
          Wallet adapter integration coming soon.
        </p>
      </main>
    </div>
  );
}
