/** Per-user session state — tracks verified data from tool calls. */

export interface OpportunityInfo {
  name: string;
  maxLeverage: number | null;
  category: string;
  tokens: string[];
}

export interface SwapQuoteInfo {
  inputMint: string;
  outputMint: string;
  summary: string;
  timestamp: number;
}

export interface SessionState {
  /** Opportunity IDs returned by the last search_yields call. */
  validOpportunityIds: Set<number>;
  lastSearchTimestamp: number | null;

  /** Verified opportunity details keyed by ID. */
  opportunities: Map<number, OpportunityInfo>;

  /** Last verified swap quote. */
  lastSwapQuote: SwapQuoteInfo | null;

  /** When this task/session started. */
  taskStartedAt: number;

  /** Timestamp of last user message. */
  lastMessageAt: number;
}

const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes

const sessions = new Map<number, SessionState>();

function createSession(): SessionState {
  const now = Date.now();
  return {
    validOpportunityIds: new Set(),
    lastSearchTimestamp: null,
    opportunities: new Map(),
    lastSwapQuote: null,
    taskStartedAt: now,
    lastMessageAt: now,
  };
}

/** Get or create a session for this user. Resets if stale (>30min gap). */
export function getOrCreateSession(telegramUserId: number): SessionState {
  let session = sessions.get(telegramUserId);
  if (!session) {
    session = createSession();
    sessions.set(telegramUserId, session);
    return session;
  }

  // Reset if new task (gap > 30 min)
  if (Date.now() - session.lastMessageAt > SESSION_GAP_MS) {
    resetSession(session);
  }

  session.lastMessageAt = Date.now();
  return session;
}

/** Clear ephemeral session data (search results, swap quotes). Keep timestamps. */
export function resetSession(session: SessionState): void {
  session.validOpportunityIds.clear();
  session.lastSearchTimestamp = null;
  session.opportunities.clear();
  session.lastSwapQuote = null;
  session.taskStartedAt = Date.now();
  session.lastMessageAt = Date.now();
}

/** Check if this is a new task (session was just reset due to time gap). */
export function isNewTask(session: SessionState): boolean {
  // If taskStartedAt is very recent and no search results, it's a fresh session
  return session.validOpportunityIds.size === 0 && session.lastSearchTimestamp === null;
}

// Periodic cleanup: remove sessions inactive for >30 min
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastMessageAt > SESSION_GAP_MS) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);
