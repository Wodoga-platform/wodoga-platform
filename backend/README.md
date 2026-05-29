# Wodoga Platform — Backend API

FastAPI backend with PostgreSQL, JWT authentication, MFA,
role-based access control, and immutable audit logging.

---

## Project Structure

```
backend/
├── app/
│   ├── main.py              # Application entry point, all middleware
│   ├── config.py            # Typed settings from environment variables
│   ├── database.py          # Async SQLAlchemy engine and session factory
│   ├── dependencies.py      # Shared FastAPI dependencies (auth, tenant, audit)
│   ├── api/
│   │   └── v1/
│   │       ├── auth.py          # Login, MFA, refresh, logout
│   │       ├── patients.py      # Patient CRUD + summary
│   │       ├── visits.py        # Visit scheduling + SOAP notes + GPS
│   │       ├── vitals.py        # Vital signs recording and history
│   │       ├── medications.py   # Prescriptions and refill tracking
│   │       ├── care_plans.py    # Care plan builder
│   │       ├── referrals.py     # Referral pipeline
│   │       ├── billing.py       # Claims management
│   │       ├── eligibility.py   # Insurance eligibility + provider contracts
│   │       ├── documents.py     # Secure file upload/download
│   │       ├── messages.py      # Encrypted internal messaging
│   │       ├── staff.py         # Staff management
│   │       ├── audit_logs.py    # Audit log access
│   │       ├── notifications.py # System notifications
│   │       ├── pharm_orders.py  # Pharmaceutical order pipeline
│   │       ├── oasis.py         # OASIS-E assessments
│   │       └── portal.py        # Patient portal endpoints
│   ├── core/
│   │   ├── security.py      # JWT, bcrypt, TOTP MFA, field encryption
│   │   ├── permissions.py   # RBAC permission constants and checker
│   │   ├── audit.py         # Immutable audit logging service
│   │   └── exceptions.py    # Domain exceptions with HTTP mapping
│   └── services/
│       ├── eligibility.py   # Waystar/Availity API integration
│       └── storage.py       # Azure Blob Storage service
├── requirements.txt
├── .env.example
└── README.md
```

---

## Setup

### 1 — Create virtual environment
```bash
cd backend
python -m venv venv
source venv/bin/activate        # Mac/Linux
venv\Scripts\activate           # Windows
```

### 2 — Install dependencies
```bash
pip install -r requirements.txt
```

### 3 — Configure environment
```bash
cp .env.example .env
# Open .env and fill in all required values
```

Minimum required for local development:
```
DATABASE_URL=postgresql+asyncpg://postgres:password@localhost:5432/wodoga
SECRET_KEY=any-64-character-random-string
JWT_SECRET_KEY=any-different-64-character-random-string
ENCRYPTION_KEY=any-32-character-string
APP_ENV=development
```

### 4 — Set up the database
```bash
# Make sure PostgreSQL is running, then:
psql -U postgres -c "CREATE DATABASE wodoga;"
psql -U postgres -d wodoga -f ../database/schema.sql
psql -U postgres -d wodoga -f ../database/seed.sql
```

### 5 — Run the development server
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The API is now running at:
- http://localhost:8000
- http://localhost:8000/docs  (Swagger UI)
- http://localhost:8000/redoc (ReDoc)
- http://localhost:8000/health

---

## Authentication Flow

### Login (no MFA)
```
POST /api/v1/auth/login
{ "email": "s.johnson@arlingtonhh.com", "password": "Demo1234!" }

→ Returns: { access_token, refresh_token, user }
```

### Login (with MFA enabled)
```
Step 1: POST /api/v1/auth/login
→ Returns: { mfa_required: true, temp_token }

Step 2: POST /api/v1/auth/verify-mfa
{ "temp_token": "...", "mfa_code": "123456" }
→ Returns: { access_token, refresh_token, user }
```

### Using the access token
```
All authenticated requests must include:
Authorization: Bearer <access_token>
```

### Refresh tokens
```
POST /api/v1/auth/refresh
{ "refresh_token": "..." }
→ Returns new access_token + refresh_token (old one revoked)
```

---

## Key Security Features

| Feature | Implementation |
|---------|---------------|
| Passwords | bcrypt with 12 rounds |
| Sessions | JWT (30 min) + refresh token (7 days) |
| MFA | TOTP via pyotp — Google Authenticator compatible |
| Tenant isolation | PostgreSQL RLS + session-level org context |
| Permission checks | Server-side only — never trusted from client |
| Audit logging | Append-only — UPDATE/DELETE revoked at DB level |
| Field encryption | Fernet symmetric encryption for MFA secrets |
| Rate limiting | slowapi — configurable per endpoint |
| Security headers | Applied to every response via middleware |
| Account lockout | After 5 failed attempts, locked for 30 minutes |

---

## API Conventions

All responses follow this structure:

**Success:**
```json
{
  "data": { ... },
  "pagination": { "page": 1, "per_page": 25, "total": 150, "pages": 6 }
}
```

**Error:**
```json
{
  "error": "permission_denied",
  "message": "You do not have permission to perform this action."
}
```

All responses include:
- `X-Request-ID` header for log correlation
- `X-Response-Time` header in milliseconds
