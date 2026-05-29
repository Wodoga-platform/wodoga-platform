# Wodoga Platform

Home Health & Pharmaceutical Operations SaaS Platform.

## Project Structure

```
wodoga/
├── database/               ← PostgreSQL schema and seed data
│   ├── schema.sql          Start here — creates all 21 tables
│   ├── seed.sql            Demo organization, roles, and staff
│   └── README.md           Table reference and setup instructions
│
├── backend/                ← FastAPI Python server
│   ├── app/
│   │   ├── main.py         Application entry point — all routers registered
│   │   ├── config.py       Settings loaded from .env
│   │   ├── database.py     Database connection and tenant context
│   │   ├── dependencies.py Shared FastAPI dependencies (auth, audit)
│   │   ├── api/v1/
│   │   │   ├── auth.py         Login, MFA, refresh, logout
│   │   │   ├── patients.py     Patient CRUD and summary
│   │   │   ├── visits.py       Scheduling, GPS, SOAP notes
│   │   │   ├── vitals.py       Vital signs and clinical alerts
│   │   │   ├── eligibility.py  Insurance verification
│   │   │   ├── clinical_ops.py Medications, billing, referrals, messages, staff, audit
│   │   │   └── portal.py       Patient portal endpoints
│   │   └── core/
│   │       ├── security.py     JWT, bcrypt, MFA, encryption
│   │       ├── permissions.py  RBAC constants and checker
│   │       ├── audit.py        Immutable audit logging
│   │       └── exceptions.py   Domain exceptions
│   ├── requirements.txt    Python dependencies
│   ├── .env.example        Copy to .env and fill in values
│   └── README.md           Backend setup and API reference
│
├── frontend/               ← Next.js 14 React TypeScript app
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx              Root layout
│   │   │   ├── (auth)/login/           Login + 2FA page
│   │   │   ├── (app)/                  All staff pages (requires login)
│   │   │   │   ├── dashboard/          Overview and stats
│   │   │   │   ├── patients/           Patient records
│   │   │   │   ├── visits/             Home visits
│   │   │   │   ├── vitals/             Vital signs
│   │   │   │   ├── medications/        Prescriptions
│   │   │   │   ├── care-plans/         Care plan builder
│   │   │   │   ├── referrals/          Referral pipeline
│   │   │   │   ├── billing/            Insurance claims
│   │   │   │   ├── eligibility/        Coverage verification
│   │   │   │   ├── pharm-orders/       Pharmaceutical orders
│   │   │   │   ├── messages/           Secure messaging
│   │   │   │   ├── oasis/              OASIS assessments
│   │   │   │   ├── staff/              Staff management
│   │   │   │   ├── audit/              Audit log
│   │   │   │   └── notifications/      Notification center
│   │   │   └── portal/
│   │   │       ├── login/              Patient portal login
│   │   │       └── dashboard/          Patient portal home
│   │   ├── components/
│   │   │   ├── layout/AppLayout.tsx    Topbar + sidebar
│   │   │   └── ui/                     Badge, Button, Modal, etc.
│   │   ├── services/
│   │   │   ├── api.ts                  Axios client + token refresh
│   │   │   └── index.ts                All API service functions
│   │   ├── store/auth.store.ts         Zustand auth state
│   │   ├── types/index.ts              TypeScript types
│   │   ├── utils/index.ts              Helpers and formatters
│   │   └── styles/globals.css          Tailwind + design tokens
│   ├── package.json
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── next.config.js
│   ├── .env.local.example  Copy to .env.local and fill in values
│   └── README.md           Frontend setup instructions
│
├── SETUP_GUIDE.md          ← START HERE — plain English setup for non-developers
├── PLATFORM_RUNDOWN.md     Full feature list, third-party connections, priority order
└── README.md               This file
```

## Quick Start

Read `SETUP_GUIDE.md` first. It walks through every step in plain English.

**Minimum to get running locally:**
1. Install Node.js, Python, PostgreSQL, Git
2. Run `database/schema.sql` and `database/seed.sql`
3. Configure `backend/.env`
4. Start backend: `uvicorn app.main:app --reload`
5. Configure `frontend/.env.local`
6. Start frontend: `npm run dev`
7. Open http://localhost:3000

**Demo login:** `s.johnson@arlingtonhh.com` / `Demo1234!`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, TypeScript, TailwindCSS, React Query, Zustand |
| Backend | FastAPI (Python), SQLAlchemy, Pydantic |
| Database | PostgreSQL 15 with Row Level Security |
| Auth | JWT + TOTP MFA (Google Authenticator compatible) |
| Cloud | Microsoft Azure (App Service + PostgreSQL + Blob Storage) |

## License

Proprietary. All rights reserved.
