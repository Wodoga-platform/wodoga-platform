# Wodoga Platform — Frontend

Next.js 14 + TypeScript + TailwindCSS frontend.
Connects to the FastAPI backend via the REST API.

---

## Project Structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout (QueryClient, Toaster)
│   │   ├── (auth)/login/page.tsx   # Login + 2FA
│   │   ├── (app)/                  # All authenticated staff pages
│   │   │   ├── layout.tsx          # Wraps with AppLayout (sidebar + topbar)
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── patients/page.tsx
│   │   │   ├── visits/page.tsx
│   │   │   ├── billing/page.tsx
│   │   │   ├── eligibility/page.tsx
│   │   │   ├── referrals/page.tsx
│   │   │   ├── messages/page.tsx
│   │   │   ├── staff/page.tsx
│   │   │   └── audit/page.tsx
│   │   └── portal/
│   │       └── dashboard/page.tsx  # Patient portal (separate experience)
│   ├── components/
│   │   ├── ui/index.tsx            # Badge, Button, Spinner, StatCard, Avatar...
│   │   ├── ui/Modal.tsx            # Accessible modal via Radix UI
│   │   └── layout/AppLayout.tsx    # Topbar + sidebar + notification panel
│   ├── services/
│   │   ├── api.ts                  # Axios client with token injection + refresh
│   │   └── index.ts                # All typed API service functions
│   ├── store/
│   │   └── auth.store.ts           # Zustand auth store with persistence
│   ├── types/
│   │   └── index.ts                # All TypeScript types matching backend
│   ├── utils/
│   │   └── index.ts                # Formatters, cn(), status badges, helpers
│   └── styles/
│       └── globals.css             # Tailwind + component utilities
├── package.json
├── tsconfig.json
├── tailwind.config.js
├── next.config.js
└── .env.local.example
```

---

## Setup

### 1 — Install dependencies
```bash
cd frontend
npm install
```

### 2 — Configure environment
```bash
cp .env.local.example .env.local
```

Minimum required:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 3 — Run development server
```bash
npm run dev
```

Frontend runs at: **http://localhost:3000**

---

## Pages

| Route | Description | Auth Required |
|-------|-------------|---------------|
| `/login` | Staff login with 2FA | No |
| `/dashboard` | Overview stats and today's activity | Yes |
| `/patients` | Patient list, search, detail panel | Yes |
| `/visits` | Visit scheduling, GPS check-in, SOAP notes | Yes |
| `/medications` | Prescriptions and reconciliation | Yes |
| `/care-plans` | Patient care plans | Yes |
| `/referrals` | Referral pipeline (Kanban) | Yes |
| `/billing` | Claims management | Yes |
| `/eligibility` | Insurance verification | Yes |
| `/messages` | Encrypted staff messaging | Yes |
| `/staff` | Staff management | Admin only |
| `/audit` | Audit log viewer | Admin only |
| `/portal/dashboard` | Patient portal | Patient role |

---

## Authentication Flow

1. User enters email + password → `POST /api/v1/auth/login`
2. If MFA enabled → enters 6-digit code → `POST /api/v1/auth/verify-mfa`
3. Tokens stored in Zustand (persisted to localStorage)
4. Every API request automatically injects `Authorization: Bearer <token>`
5. On 401 → automatically refreshes token via `POST /api/v1/auth/refresh`
6. On refresh failure → clears auth state and redirects to `/login`

---

## Adding a New Page

1. Create `src/app/(app)/your-page/page.tsx`
2. Add the route to `NAV_ITEMS` in `AppLayout.tsx` with the required permission
3. Add the API service function to `src/services/index.ts`
4. Add any new types to `src/types/index.ts`

That is the complete pattern. Every page follows the same structure.
