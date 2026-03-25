---
name: add-backend-route
description: Scaffold a new API endpoint — add to existing router or create a new one, with schema and frontend integration
user_invocable: true
---

# Add Backend Route

Scaffold a new API endpoint for Akashi. Covers adding to an existing router or creating a new one.

**Ask the user for:** endpoint path, HTTP method, what data it returns, and whether it needs rate limiting.

---

## Option A: Add endpoint to existing router

Existing routers: `app/routers/yields.py`, `app/routers/protocols.py`, `app/routers/portfolio.py`.

### Pattern

```python
@router.get("/path", response_model=SchemaOut)
def get_thing(
    param: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    # Query logic
    result = db.query(Model).filter(...).first()
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    return SchemaOut.model_validate(result)
```

**For mutation endpoints**, add rate limiting:

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

# The limiter is already configured in main.py and available via app.state
# Import it in the router:
from fastapi import Request

@router.post("/path", response_model=SchemaOut)
@limiter.limit("10/minute")
def create_thing(
    request: Request,  # required by slowapi
    body: SchemaIn,
    db: Session = Depends(get_db),
):
    ...
```

### Key imports
```python
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.dependencies import get_db
from app.schemas import YourSchema
```

---

## Option B: Create new router file

Create `backend/app/routers/{name}.py`:

```python
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.dependencies import get_db
from app.schemas import YourSchemaOut

router = APIRouter()


@router.get("/{name}", response_model=list[YourSchemaOut])
def list_things(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows = db.query(Model).offset(offset).limit(limit).all()
    return [YourSchemaOut.model_validate(r) for r in rows]


@router.get("/{name}/{id}", response_model=YourSchemaOut)
def get_thing(
    id: int,
    db: Session = Depends(get_db),
):
    row = db.query(Model).filter(Model.id == id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    return YourSchemaOut.model_validate(row)
```

Then register in `backend/app/main.py`:

```python
from app.routers import {name}  # noqa: E402

# Add with other router includes:
app.include_router({name}.router, prefix="/api")
```

---

## Step 2: Add Pydantic schema

Add to `backend/app/schemas/__init__.py`:

```python
class YourSchemaOut(BaseModel):
    id: int
    # ... fields matching the model

    model_config = {"from_attributes": True}
```

**Rules:**
- Never return raw dicts from endpoints — always use a Pydantic `response_model`
- Use `model_config = {"from_attributes": True}` so `model_validate(orm_obj)` works
- Input schemas (for POST/PUT) don't need `from_attributes`
- All schemas live in `app/schemas/__init__.py`

---

## Step 3: Frontend integration

### 3a. Add API function to `frontend/src/lib/api.ts`

```typescript
// Add type
export interface YourThing {
  id: number;
  // ...
}

// Add API function
getThings: async (params?: { limit?: number }): Promise<YourThing[]> => {
  const sp = new URLSearchParams();
  if (params?.limit) sp.set("limit", String(params.limit));
  const res = await fetch(`${API_URL}/api/{name}?${sp}`);
  if (!res.ok) throw new Error("Failed to fetch things");
  return res.json();
},
```

### 3b. Consume via TanStack Query in components

```typescript
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const { data, isLoading } = useQuery({
  queryKey: ["things"],
  queryFn: () => api.getThings(),
});
```

**Rules:**
- Never use `useEffect` for data fetching — always TanStack Query
- Never inline `fetch()` calls in components — add to `lib/api.ts`
- Types live in `lib/api.ts` alongside the API functions

---

## Router conventions

- All routers use `prefix="/api"` when registered in `main.py`
- `Depends(get_db)` for database sessions (auto-closed)
- `response_model` on every endpoint
- `@limiter.limit()` on mutation endpoints (POST/PUT/DELETE)
- Private validation helpers prefixed with `_` (e.g., `_validate_wallet()`)
- Pagination: `limit` (default 100, max 500) + `offset` (default 0)
- Timestamps always UTC: `datetime.now(timezone.utc)`

---

## Checklist

- [ ] Schema added to `app/schemas/__init__.py`
- [ ] Endpoint added to router (existing or new file)
- [ ] New router registered in `main.py` (if new file)
- [ ] API function added to `frontend/src/lib/api.ts`
- [ ] Health check passes: `curl http://localhost:8000/api/health`
- [ ] Frontend builds: `cd frontend && npm run build`
