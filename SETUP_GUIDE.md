# Wodoga Platform — Complete Setup Guide
### Written for someone who has never coded before.
### Every step is explained in plain English.

---

## Before You Start — Read This First

You are going to use something called the **Terminal**. It is a black window where you type instructions to your computer. It looks intimidating but you are only copying and pasting commands I give you exactly. You do not need to understand what they mean — just follow each step in order.

**On a Mac:** Press Command + Space, type "Terminal", press Enter.
**On Windows:** Press the Windows key, type "Windows PowerShell", right-click it, choose "Run as Administrator".

When I show you a command like this:

```
npm install
```

That means: click inside the terminal window, type or paste that exact text, then press **Enter**.

---

## PHASE 1 — Install the Tools You Need
### (Do this once. Takes about 20 minutes.)

---

### Step 1 — Install Node.js

Node.js is a program that runs JavaScript on your computer. The frontend needs it.

1. Go to: **https://nodejs.org**
2. Click the big green button that says **LTS** (the recommended version)
3. Download the file and open it
4. Click Next → Next → Install (accept all defaults)
5. When it finishes, close the installer

**Verify it worked** — open your Terminal and type:
```
node --version
```
You should see something like `v20.14.0`. Any number is fine as long as something shows up.

---

### Step 2 — Install Python

Python is what runs the backend server.

1. Go to: **https://python.org/downloads**
2. Click the yellow **Download Python** button
3. Open the downloaded file
4. **IMPORTANT:** On the first screen, check the box that says **"Add Python to PATH"** before clicking anything else
5. Click **Install Now**
6. Wait for it to finish

**Verify it worked:**
```
python --version
```
You should see `Python 3.x.x`.

---

### Step 3 — Install PostgreSQL (the database)

PostgreSQL is the database that stores all patient data.

1. Go to: **https://www.postgresql.org/download**
2. Click your operating system (Windows or macOS)
3. Download and run the installer
4. During installation:
   - Leave the port as **5432** (do not change this)
   - Set a password for the database — **write this password down**, you will need it
   - Leave everything else as default
5. Click through and install

**Verify it worked:**
```
psql --version
```
You should see `psql (PostgreSQL) 15.x` or similar.

---

### Step 4 — Install Git

Git is how you manage code files.

1. Go to: **https://git-scm.com/downloads**
2. Download for your operating system
3. Run the installer — click Next through everything, all defaults are fine

**Verify it worked:**
```
git --version
```
You should see `git version 2.x.x`.

---

## PHASE 2 — Set Up the Database
### (Takes about 10 minutes.)

The database is the filing cabinet where all patient data lives permanently.

---

### Step 5 — Create the database

Open your Terminal and type these commands **one at a time**, pressing Enter after each:

```
psql -U postgres
```

It will ask for a password — type the password you wrote down in Step 3, then press Enter. (You will not see the password as you type — that is normal.)

You should now see a prompt that looks like `postgres=#`

Now type this exactly:
```
CREATE DATABASE wodoga;
```

You should see: `CREATE DATABASE`

Now type:
```
\q
```

This exits the database. You are back to the regular terminal.

---

### Step 6 — Put the database files somewhere on your computer

You need to put the Wodoga project files in a folder on your computer. Create a folder called `wodoga` somewhere easy to find — your Desktop is fine.

Copy the three database files into a folder called `database` inside your `wodoga` folder:
- `schema.sql`
- `seed.sql`

---

### Step 7 — Load the database structure

In your Terminal, navigate to your database folder. Replace `YOUR_USERNAME` with your actual computer username:

**On Mac:**
```
cd /Users/YOUR_USERNAME/Desktop/wodoga/database
```

**On Windows:**
```
cd C:\Users\YOUR_USERNAME\Desktop\wodoga\database
```

Now run the schema (creates all the tables):
```
psql -U postgres -d wodoga -f schema.sql
```

Type your database password when asked. You will see a lot of text — that is normal.

Now run the seed (adds demo data):
```
psql -U postgres -d wodoga -f seed.sql
```

If both commands finish without saying "ERROR", the database is ready. ✓

---

## PHASE 3 — Set Up the Backend (The Server Engine)
### (Takes about 15 minutes.)

---

### Step 8 — Navigate to the backend folder

In your Terminal:

**Mac:**
```
cd /Users/YOUR_USERNAME/Desktop/wodoga/backend
```

**Windows:**
```
cd C:\Users\YOUR_USERNAME\Desktop\wodoga\backend
```

---

### Step 9 — Create a Python virtual environment

This keeps the backend's software separate from everything else on your computer:

```
python -m venv venv
```

Now activate it:

**Mac:**
```
source venv/bin/activate
```

**Windows:**
```
venv\Scripts\activate
```

You will know it worked because your terminal prompt now starts with `(venv)`.

---

### Step 10 — Install the backend packages

```
pip install -r requirements.txt
```

This downloads about 30 small programs the backend needs. It will take 2-3 minutes. You will see a lot of text. Wait until it finishes and you see your prompt again.

---

### Step 11 — Create your environment file

This file tells the backend your passwords and settings. In your Terminal, type:

**Mac:**
```
cp .env.example .env
```

**Windows:**
```
copy .env.example .env
```

Now open the `.env` file. You can use Notepad (Windows) or TextEdit (Mac).

Find these lines and fill them in:

```
DATABASE_URL=postgresql+asyncpg://postgres:YOUR_DB_PASSWORD@localhost:5432/wodoga
```
Replace `YOUR_DB_PASSWORD` with the password you wrote down in Step 3.

```
SECRET_KEY=
```
After the `=` sign, type any long random string of letters and numbers. Example:
`SECRET_KEY=wodoga2025mysupersecretkey8472ksj29dk1`

```
JWT_SECRET_KEY=
```
Type a DIFFERENT long random string here:
`JWT_SECRET_KEY=jwtsecret2025kd82hsa72kdk29sl1a9sk2`

```
ENCRYPTION_KEY=
```
Type another different string, exactly 32 characters:
`ENCRYPTION_KEY=wodoga32charencryptionkey2025ab`

```
APP_ENV=development
```
Leave this as `development` for now.

Save and close the file.

---

### Step 12 — Start the backend server

Make sure you are still in the backend folder with `(venv)` showing, then type:

```
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

You should see something like:
```
[Wodoga] Starting Wodoga Platform v2.0.0 (development)
[Wodoga] Database connected.
INFO: Uvicorn running on http://0.0.0.0:8000
```

**The backend is now running.** Do not close this terminal window.

To verify it works, open your web browser and go to:
```
http://localhost:8000/health
```
You should see: `{"status":"healthy","version":"2.0.0"}`

You can also see the full API documentation at:
```
http://localhost:8000/docs
```

---

## PHASE 4 — Set Up the Frontend (What You See on Screen)
### (Takes about 10 minutes.)

---

### Step 13 — Open a NEW terminal window

Leave the backend terminal open and running. Open a brand new terminal window.

---

### Step 14 — Navigate to the frontend folder

**Mac:**
```
cd /Users/YOUR_USERNAME/Desktop/wodoga/frontend
```

**Windows:**
```
cd C:\Users\YOUR_USERNAME\Desktop\wodoga\frontend
```

---

### Step 15 — Install the frontend packages

```
npm install
```

This downloads everything the frontend needs. It will take 2-5 minutes and install hundreds of small files. Wait until it is completely finished.

---

### Step 16 — Create the frontend environment file

**Mac:**
```
cp .env.local.example .env.local
```

**Windows:**
```
copy .env.local.example .env.local
```

Open `.env.local` in Notepad or TextEdit. It should already say:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Leave this exactly as it is. Save and close.

---

### Step 17 — Start the frontend

```
npm run dev
```

You will see something like:
```
▲ Next.js 14.2.3
- Local: http://localhost:3000
✓ Ready in 2.1s
```

**The frontend is now running.**

---

## PHASE 5 — Use Wodoga
### You are now running a complete healthcare platform on your computer.

---

### Step 18 — Open Wodoga in your browser

Go to: **http://localhost:3000**

You should see the Wodoga login screen.

---

### Step 19 — Sign in with the demo account

Use these credentials:

| Field | Value |
|-------|-------|
| Email | `s.johnson@arlingtonhh.com` |
| Password | `Demo1234!` |
| Role | Admin |

Click **Continue**. You will be asked for a 6-digit verification code. Because this is a demo, the code appears on screen — enter the 6 digits shown.

You are now inside Wodoga.

---

### Demo accounts for each role:

| Role | Email | Password |
|------|-------|----------|
| Admin | s.johnson@arlingtonhh.com | Demo1234! |
| Provider | m.chen@arlingtonhh.com | Demo1234! |
| Pharmacy Staff | l.patel@arlingtonhh.com | Demo1234! |
| Caregiver | c.rivera@arlingtonhh.com | Demo1234! |
| Biller | a.brooks@arlingtonhh.com | Demo1234! |

---

## PHASE 6 — Starting Wodoga Every Day
### After the first setup, starting Wodoga takes 2 minutes.

---

### Every time you want to run Wodoga:

**Terminal Window 1 — Start the backend:**
```
cd /Users/YOUR_USERNAME/Desktop/wodoga/backend
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Terminal Window 2 — Start the frontend:**
```
cd /Users/YOUR_USERNAME/Desktop/wodoga/frontend
npm run dev
```

Then open: **http://localhost:3000**

---

## TROUBLESHOOTING — Common Problems and Fixes

---

### Problem: "command not found" when typing python, node, or psql

**Fix:** The program was not added to your PATH. Close the terminal completely, reopen it, and try again. If it still fails, reinstall the program from scratch and make sure to check "Add to PATH" during installation.

---

### Problem: Database connection failed when starting the backend

**Fix:** Check two things:
1. Is PostgreSQL running? On Mac, look for an elephant icon in your menu bar. On Windows, check Services.
2. Is your password correct in the `.env` file? Open it and double-check `DATABASE_URL`.

---

### Problem: "Module not found" or "cannot find module"

**Fix:** You probably skipped the install step. Make sure you ran:
- `pip install -r requirements.txt` (backend)
- `npm install` (frontend)

---

### Problem: Port 8000 or 3000 already in use

**Fix:** Something else is using that port. In your terminal:

**Mac:**
```
lsof -ti:8000 | xargs kill -9
lsof -ti:3000 | xargs kill -9
```

**Windows:**
```
netstat -ano | findstr :8000
taskkill /PID [the number shown] /F
```

---

### Problem: The login page loads but signing in gives an error

**Fix:** The backend is probably not running. Check Terminal Window 1 — if it shows an error or has stopped, restart it with the backend start command.

---

### Problem: npm install fails with permission errors (Windows)

**Fix:** Close PowerShell, reopen it by right-clicking and choosing "Run as Administrator", then run `npm install` again.

---

### Problem: `psql -U postgres` asks for a password and I forgot it

**Fix:** You need to reset the PostgreSQL password. Search "reset postgresql password" for your operating system — it takes about 5 minutes.

---

## WHAT'S NEXT — Taking It Live on the Internet

Running on your computer means only YOU can use it. To let other people use Wodoga from anywhere, you need to deploy it to the cloud. Here is what that involves:

1. **Create a Microsoft Azure account** at portal.azure.com (free to start)
2. **Create an Azure PostgreSQL database** (replaces your local one)
3. **Deploy the backend** to Azure App Service
4. **Deploy the frontend** to Azure Static Web Apps or Vercel
5. **Buy a domain name** (e.g., wodoga.com) at Namecheap.com (~$12/year)
6. **Point the domain** to your Azure deployment

When you are ready for that step, I will write the exact same style of guide for going live. Every command will be provided the same way — copy, paste, press Enter.

---

## QUICK REFERENCE

| What | Where |
|------|-------|
| Staff login | http://localhost:3000 |
| Backend API docs | http://localhost:8000/docs |
| Backend health | http://localhost:8000/health |
| Database name | wodoga |
| Database user | postgres |
| Backend port | 8000 |
| Frontend port | 3000 |

---

## FILE LOCATIONS

Your complete Wodoga project should look like this:

```
wodoga/
├── database/
│   ├── schema.sql
│   ├── seed.sql
│   └── README.md
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── dependencies.py
│   │   ├── api/v1/
│   │   │   ├── auth.py
│   │   │   ├── patients.py
│   │   │   ├── visits.py
│   │   │   ├── vitals.py
│   │   │   ├── eligibility.py
│   │   │   ├── clinical_ops.py
│   │   │   └── portal.py
│   │   └── core/
│   │       ├── security.py
│   │       ├── permissions.py
│   │       ├── audit.py
│   │       └── exceptions.py
│   ├── requirements.txt
│   ├── .env          ← your private settings (never share this)
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── app/
    │   ├── components/
    │   ├── services/
    │   ├── store/
    │   ├── types/
    │   └── utils/
    ├── package.json
    ├── .env.local          ← your private settings
    └── .env.local.example
```

---

*If you follow every step in order and something still does not work, write down exactly what you see on the screen and we will fix it together.*
