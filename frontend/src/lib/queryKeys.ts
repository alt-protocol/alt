export const queryKeys = {
  yields: {
    all: ["yields"] as const,
    detail: (id: string) => ["yield", id] as const,
    history: (id: string, period: string) => ["yieldHistory", id, period] as const,
  },
  positions: {
    list: (wallet: string) => ["positions", wallet] as const,
    history: (wallet: string, period: string) => ["positionHistory", wallet, period] as const,
    events: (wallet: string) => ["positionEvents", wallet] as const,
  },
  vault: {
    balance: (wallet: string, vault: string) => ["vaultBalance", wallet, vault] as const,
  },
  wallet: {
    status: (wallet: string) => ["walletStatus", wallet] as const,
    tokenBalance: (wallet: string, symbol: string) => ["tokenBalance", wallet, symbol] as const,
    portfolio: (wallet: string) => ["walletPortfolio", wallet] as const,
  },
};
