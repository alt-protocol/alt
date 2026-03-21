# Architecture Improvement TODO

## Critical
- [ ] **1. Add pagination** to all list endpoints (yields, positions, history)
- [ ] **2. Tune connection pool** (`pool_size=20, max_overflow=10`)
- [ ] **3. Add rate limiting** (especially on `/portfolio/{wallet}/track`)
- [ ] **4. Add missing DB indexes** (snapshot_at, composite uniques)

## High
- [ ] **5. Add retry logic** with exponential backoff to all external API calls
- [ ] **6. Add `coalesce=True`** to APScheduler jobs
- [ ] **7. Fix N+1 queries** in position fetchers (batch-load opportunities)
- [ ] **8. Fix duplicate snapshots** (idempotency on cron inserts)
- [ ] **9. Fix aggressive deactivation** (don't deactivate on single API failure)

## Medium
- [ ] **10. Add React Error Boundaries** on frontend
- [ ] **11. Tighten CORS** (whitelist methods/headers)
- [ ] **12. Normalize APY calculations** (consistent decimal→% convention)
- [ ] **13. Frontend table virtualization** for large lists
- [ ] **14. Frontend memoization** (React.memo on table rows, useCallback)

## Low / Future
- [ ] **15. Add basic tests** (API smoke tests, frontend component tests)
- [ ] **16. Add Docker / docker-compose** for local dev
- [ ] **17. Add CI/CD pipeline** (GitHub Actions)
- [ ] **18. Add structured logging** (JSON format, request IDs)
- [ ] **19. Add monitoring** (Sentry for errors, basic health depth)
- [ ] **20. Move cron to separate worker** (when >100 tracked wallets)
- [ ] **21. Add Redis caching** for yield data (when >100 concurrent users)
