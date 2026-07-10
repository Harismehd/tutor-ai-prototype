# TutorAI Platform - System Deployment & Handover Guide

TutorAI is an enterprise-grade multi-tenant tutoring platform designed to demonstrate secure database-level tenant isolation, search-as-you-type student query matching, and an in-memory AI-assisted multi-page worksheet evaluation workflow.

---

## 🏗️ Architectural & Security Principles

1. **Multi-Tenant Database Isolation (PostgreSQL RLS)**: 
   Access control is strictly enforced at the database layer using PostgreSQL Row Level Security (RLS) policies. A custom `get_user_centre_id()` security definer function looks up the authenticated user's `centre_id` on the `profiles` table. This prevents recursive lookup loops, bypasses frontend-only filters, and guards against IDOR (Insecure Direct Object Reference) vulnerabilities or cross-centre data leakage.
2. **In-Memory Vision Pipeline & Zero Storage Footprint**: 
   Worksheet images are processed purely in memory as base64 strings and sent directly to the AI vision endpoint. No visual files are written to disk, server memory, or database tables. The AI feedback is parsed and only textual evaluation records are stored, ensuring strict visual privacy and student data safety.
3. **Supabase Realtime Broadcast**: 
   Live activities and feedback runs automatically sync across separate teacher devices within the same centre using Supabase Realtime subscriptions. Security is fully preserved as Supabase filters the broadcast messages on the fly matching the teacher's active PostgreSQL RLS privileges.
4. **Swappable AI Provider Abstraction**: 
   A unified AI provider interface allows swapping the default AI Vision provider (`openai` or `gemini`) using environment variables, requiring zero code modifications.

---

## 🔑 Environment Variables Configuration

To run the application in production (Vercel) or locally, configure the following environment variables. 

> [!IMPORTANT]
> **No Hardcoded Keys**: The codebase contains **zero** hardcoded API keys or secret credentials. All values are read dynamically from the environment.

### Required Configuration Keys

| Variable | Description | Example / Recommended Value |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase Project API Endpoint. | `https://your-project-id.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase Project Anonymous API Key. | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `AI_PROVIDER` | Swappable grading provider (`gemini` or `openai`). Defaults to `gemini` if omitted. | `gemini` |
| `GEMINI_API_KEY` | Google AI Studio Gemini API Key (Required if using Gemini provider). | `AIzaSyD...` |
| `GEMINI_MODEL` | Gemini vision reasoning engine fallback (Optional). Defaults to `gemini-2.5-flash`. | `gemini-1.5-pro-latest` or `gemini-2.5-flash` |
| `OPENAI_API_KEY` | OpenAI Developer Platform API Key (Required if using OpenAI provider). | `sk-proj-...` |
| `OPENAI_MODEL` | OpenAI vision model fallback (Optional). Defaults to `gpt-4o`. | `gpt-4o` |
| `AI_PIPELINE_PASSES` | Number of model consensus grading passes (Optional). Defaults to `1`. | `1` (Fast) or `3` (Self-consistency vote) |
| `AI_PIPELINE_MAX_CONCURRENCY` | Maximum concurrent calls to the model provider API (Optional). Defaults to `3`. | `3` |

---

## 🗄️ Database Setup & SQL Migrations (`supabase.sql`)

### Option A: Fresh Database Installation
If setting up a new Supabase database:
1. Open the **SQL Editor** in your Supabase project dashboard.
2. Paste the contents of [supabase.sql](file:///c:/Users/Haris%20Awan/Documents/projects/freelancing/TutorAI%20Prototype/supabase.sql) into a new query window.
3. Click **Run** to generate the tables, configure indexes, enable RLS policies, map database triggers, and load seed records.

### Option B: Non-Destructive Update (Add Compatibility Columns)
If you already have a live database with active teacher/student data, **do not drop the tables**. Run the following SQL migration script in your Supabase SQL Editor to append the backward-compatibility columns. This instantly resolves legacy frontend query crashes (`Error 42703: column "student_feedback.mistake" does not exist`) while preserving all data:

```sql
-- Non-destructive migration to add nullable legacy columns for backward compatibility
ALTER TABLE public.student_feedback ADD COLUMN IF NOT EXISTS mistake text;
ALTER TABLE public.student_feedback ADD COLUMN IF NOT EXISTS correct_answer text;
ALTER TABLE public.student_feedback ADD COLUMN IF NOT EXISTS reason_traditional_chinese text;
ALTER TABLE public.student_feedback ADD COLUMN IF NOT EXISTS weak_area_tag text;

-- Grant permissions to authenticate keys (standard setup validation)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_feedback TO authenticated;
```

---

## 🚀 Local Installation & Execution

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Local Env
Create a `.env.local` file in the root folder of the project using the template specified in the Environment Variables section.

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Build Production Bundle
To compile and optimize the application for production:
```bash
npm run build
```

---

## 🧪 Administrative Seed Data for Testing

Use these preset IDs in the application to evaluate RLS security boundaries:

### Seed Centres
* **Centre A ID**: `a0000000-0000-0000-0000-00000000000a`
* **Centre B ID**: `b0000000-0000-0000-0000-00000000000b`

### Seed Students
* **蘇卓怡** (Belongs to **Centre A**, ID: `50000000-0000-0000-0000-000000000005`)
* **梁志強** (Belongs to **Centre B**, ID: `60000000-0000-0000-0000-000000000006`)

---

## 🛠️ Verification Protocols

### Protocol 1: Verify Multi-Tenant Boundary Isolation
1. Go to the dashboard login page and click **Create Account** to register a new user mapped to **Centre A**:
   * **Full Name**: `Teacher Alice`
   * **Centre ID**: `a0000000-0000-0000-0000-00000000000a`
   * **Email**: `alice@centrea.com`
2. Search for **"蘇"** in the student finder. The seed student **蘇卓怡** will appear.
3. Search for **"梁"**. The result list will remain empty because **梁志強** is restricted by Postgres RLS.
4. Sign out and register a new user mapped to **Centre B**:
   * **Full Name**: `Teacher Bob`
   * **Centre ID**: `b0000000-0000-0000-0000-00000000000b`
   * **Email**: `bob@centreb.com`
5. Search for **"梁"** to verify **梁志強** is visible. Search for **"蘇"** to verify **蘇卓怡** is hidden.

### Protocol 2: Run Multi-Image Worksheet Analysis
1. Select a student profile from the search results.
2. Upload multiple worksheet pages using the upload grid.
3. Click **Analyze with AI**.
4. The system will route the image array in-memory to the AI provider, retrieve structured JSON questions feedback, and log only the structured results to Supabase.
5. Confirm that the new entry is appended to the **Feedback History** timeline.

### Protocol 3: Realtime Subscription Sync
1. Open two separate browser tabs (Session 1 and Session 2) logged into the same centre (e.g. `bob@centreb.com`).
2. Select student **梁志強** on both sessions.
3. Upload and analyze a worksheet on Session 1.
4. Observe Session 2: The **Recent Runs** activity log and **Feedback History** list will instantly update in real-time, without requiring a page refresh.
