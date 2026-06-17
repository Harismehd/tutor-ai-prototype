# TutorAI Tutoring Centre Platform

TutorAI is a production-quality, multi-tenant tutoring platform designed to demonstrate secure database-level tenant isolation, search-as-you-type student directory lookup, and an in-memory AI-assisted worksheet analysis workflow.

---

## Key Features & Architecture

1.  **Multi-Tenant Database Isolation**: Strict boundaries are enforced directly at the database layer using PostgreSQL Row Level Security (RLS) policies. All user data, student records, and feedback entries are strictly isolated by centre membership, preventing IDOR vulnerabilities or cross-tenant data leaks.
2.  **In-Memory Vision Pipeline**: Worksheet images are captured and processed entirely in-memory using base64 payloads to query visual models. To protect user privacy and minimize storage overhead, images are never saved to disk, database tables, or Supabase Storage, and are discarded immediately after analysis.
3.  **Swappable AI Provider Abstraction**: A unified factory structure allows swapping the default AI Vision provider (Google Gemini or OpenAI GPT-4o) using environment variables, requiring zero code changes in the business logic layer.
4.  **Zod Schema Validation**: Robust Zod validation schemas defend endpoints against malformed payloads and enhance API routing reliability.

---

## Database Schema Design (`supabase.sql`)

The PostgreSQL database structure consists of four core tables:
*   `centres`: Declares tutoring center entities.
*   `profiles`: Connects authenticated teachers/staff to their center and sets roles.
*   `students`: Lists student details associated with a specific centre (with full traditional Chinese character support).
*   `student_feedback`: Stores AI-generated structured feedback (mistake description, correct answer, Chinese reasoning, concept tags).

### RLS Policies
The isolation logic is implemented by a `security definer` function `get_user_centre_id()`, which reads the active auth context (`auth.uid()`) to retrieve the user's `centre_id` from the `profiles` table. The tables have RLS enabled and compare their `centre_id` fields directly against this returned ID.

A database trigger `on_auth_user_created` automatically builds a profile record on the `profiles` table whenever a new user registers through Supabase Auth, extracting metadata like `centre_id` and `full_name` passed during registration.

---

## Installation & Setup

### 1. Database Setup
1. Create a new project on the [Supabase Dashboard](https://database.new).
2. Open the **SQL Editor** in your Supabase project.
3. Paste the contents of the `supabase.sql` file into a new query window and click **Run**. This will generate the tables, configure indexes, enable RLS policies, map database triggers, and load seed records.

### 2. Environment Configuration
Create a `.env.local` file in the root folder of the project using the structure below:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# AI Provider Settings ('gemini' or 'openai')
DEFAULT_AI_PROVIDER=gemini

# Google Gemini Settings (obtain key from Google AI Studio)
GEMINI_API_KEY=your-gemini-key-here
GEMINI_MODEL=gemini-2.5-flash

# OpenAI Settings (obtain key from OpenAI Platform)
OPENAI_API_KEY=your-openai-key-here
OPENAI_MODEL=gpt-4o
```

### 3. Local Development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the local server:
   ```bash
   npm run dev
   ```
3. Open your browser and navigate to `http://localhost:3000`.

---

## Verification Protocols

Use these steps to verify RLS isolation and the AI vision pipeline:

### Step A: Verify Tenant Boundary Isolation
1. Access the web interface and register a new user mapped to **Centre A** (`Teacher Alice`, `alice@centrea.com`).
2. Search for **"蘇"** in the student finder. The seed student **蘇卓怡** (Centre A) will appear.
3. Search for **"梁"**. The result list will remain empty because **梁志強** (Centre B) is restricted by RLS.
4. Sign out and register a new user mapped to **Centre B** (`Teacher Bob`, `bob@centreb.com`).
5. Search for **"梁"** to verify **梁志強** is visible. Search for **"蘇"** to verify **蘇卓怡** is hidden.

### Step B: Run Worksheet Analysis
1. Select the student profile from the search results.
2. Upload a sample worksheet image file (typed text or handwriting).
3. Click **Analyze with AI**.
4. The backend handler will route the image in-memory to the AI provider, retrieve structured JSON feedback (mistake definition, correct answers, traditional Chinese reasoning), and log only the textual results to Supabase.
5. Confirm that the new entry is appended to the **Feedback History** list and the **Centre Activity Log**.
6. Check your Supabase Storage dashboard to verify that no buckets or image files were created (confirming zero visual data persistence).

---

## Production Deployment to Vercel

1. Push your project files to your GitHub repository (refer to the Git instructions below).
2. Open the [Vercel Dashboard](https://vercel.com) and click **Add New** -> **Project**.
3. Import your GitHub repository.
4. Expand the **Environment Variables** section and paste your config variables (from your `.env.local` file).
5. Click **Deploy**. Vercel will build and launch your production build.
