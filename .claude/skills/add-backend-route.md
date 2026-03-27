---
name: add-backend-route
description: Scaffold a new API endpoint in the appropriate backend module (Discover, Manage, or Monitor)
user_invocable: true
---

# Add Backend Route

Scaffold a new API endpoint for Akashi. Routes belong to one of 3 modules.

> **Architecture:** The backend is a modular monolith with 3 modules (Discover, Manage, Monitor).

**Ask the user for:** endpoint path, HTTP method, which module it belongs to, what data it returns, and whether it needs rate limiting or API key auth.

---

## For Node.js backend (`backend/`)

### Which module?

| Module | Routes prefix | When to use |
|--------|--------------|-------------|
| **Discover** | `/api/discover/*` | Yield data, protocol info, APY history |
| **Manage** | `/api/manage/*` | Transaction building, submission, simulation |
| **Monitor** | `/api/monitor/*` | Portfolio, positions, events, wallet tracking |

### Pattern (Fastify + Zod)

Add to the appropriate `backend/src/{module}/routes/*.ts`:

```typescript
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';

const ResponseSchema = z.object({
  id: z.number(),
  // ... fields
});

export async function registerRoutes(app: FastifyInstance) {
  app.get('/api/{module}/{path}', {
    schema: {
      querystring: z.object({
        limit: z.coerce.number().min(1).max(500).default(100),
        offset: z.coerce.number().min(0).default(0),
      }),
      response: { 200: z.object({ data: z.array(ResponseSchema) }) },
    },
  }, async (request, reply) => {
    const { limit, offset } = request.query;
    // Query from module's own schema only
    const rows = await db.select().from(table).limit(limit).offset(offset);
    return { data: rows };
  });
}
```

**For mutation endpoints with API key auth** (Manage module):
```typescript
app.post('/api/manage/tx/something', {
  preHandler: [requireApiKey],  // from shared/auth.ts
  schema: { body: InputSchema, response: { 200: OutputSchema } },
}, async (request, reply) => { ... });
```

### Frontend integration

Add to `frontend/src/lib/api.ts`:
```typescript
export interface YourType { ... }

getSomething: async (): Promise<YourType[]> => {
  const res = await fetch(`${API_URL}/api/{module}/{path}`);
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
},
```

Consume via TanStack Query — never `useEffect` for data fetching.

### Key rules
- Each module only queries its own DB schema
- Zod schemas for validation + auto-generated Swagger docs
- `@fastify/rate-limit` on mutation endpoints
- Pagination: `limit` (default 100, max 500) + `offset` (default 0)

---

## Checklist

- [ ] Route added to correct module
- [ ] Zod/Pydantic schema defined
- [ ] API function added to `frontend/src/lib/api.ts`
- [ ] Health check passes
- [ ] Frontend builds
