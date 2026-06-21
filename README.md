# TutorAI Platform - System Deployment Guide

TutorAI is an enterprise-grade multi-tenant tutoring platform designed to demonstrate secure database-level tenant isolation, search-as-you-type student query matching, and an in-memory AI-assisted multi-page worksheet evaluation workflow.

---

## Architectural Principles

1.  **Multi-Tenant Database Isolation (PostgreSQL RLS)**: Access control is strictly enforced at the database layer using PostgreSQL Row Level Security (RLS) policies. All user data, student directories, and feedback evaluations are isolated by centre boundaries, preventing IDOR vulnerabilities or cross-centre data leakage.
2.  **In-Memory Vision Pipeline**: Worksheet image files are parsed in-memory as base64 strings and sent directly to the AI vision completions endpoint. No image files are written to disk, server memory, or database tables, ensuring strict visual privacy and compliance.
3.  **Supabase Realtime Broadcast**: Live activities and feedback runs automatically sync across separate teacher devices within the same centre using Supabase Realtime subscriptions. Security is fully preserved as Supabase filters the broadcast messages on the fly matching the teacher's active PostgreSQL RLS privileges.
4.  **Swappable AI Provider Abstraction**: A unified AI provider interface allows swapping the default AI Vision provider (`openai` GPT-4o or `gemini` 2.5) using environment variables, requiring zero code modifications.

---

## Database Schema & Row Level Security (`supabase.sql`)

The database consists of the following relational structures:
*   `centres`: Declares the tutoring centres.
*   `profiles`: Connects authenticated teachers/staff to their center and sets roles.
*   `students`: List of student directories associated with a specific centre (supporting Traditional Chinese characters).
*   `student_feedback`: Stores AI-generated structured feedback.

### Feedback JSONB Schema
The `student_feedback` table stores analysis results in a structured `questions` `jsonb` array column, following the format below:
```json
{
  "questions": [
    {
      "question_number": 1,
      "is_correct": true,
      "correct_answer": "",
      "mistake_type": "None",
      "topic_tag": "Algebra"
    },
    {
      "question_number": 2,
      "is_correct": false,
      "correct_answer": "45",
      "mistake_type": "Calculation Error",
      "topic_tag": "Subtraction"
    }
  ]
}
```

### RLS Policies
The isolation logic is implemented by a `security definer` function `get_user_centre_id()`, which reads the active auth context (`auth.uid()`) to retrieve the user's `centre_id` from the `profiles` table. The tables have RLS enabled and compare their `centre_id` fields directly against this returned ID.

A database trigger `on_auth_user_created` automatically builds a profile record on the `profiles` table whenever a new user registers through Supabase Auth, extracting metadata like `centre_id` and `full_name` passed during registration.

---

## Installation & Local Configuration

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

# AI Provider Settings ('openai' or 'gemini')
DEFAULT_AI_PROVIDER=openai

# OpenAI Settings (obtain key from OpenAI Platform)
OPENAI_API_KEY=your-openai-key-here
OPENAI_MODEL=gpt-4o

# Google Gemini Settings (obtain key from Google AI Studio)
GEMINI_API_KEY=your-gemini-key-here
GEMINI_MODEL=gemini-2.5-flash
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

## Administrative Seed Data for Testing

Use these preset IDs to log in and evaluate the security boundary logic:

### Seed Centres
*   **Centre A ID**: `a0000000-0000-0000-0000-00000000000a`
*   **Centre B ID**: `b0000000-0000-0000-0000-00000000000b`

### Seed Students
*   **蘇卓怡** (Belongs to **Centre A**, ID: `50000000-0000-0000-0000-000000000005`)
*   **梁志強** (Belongs to **Centre B**, ID: `60000000-0000-0000-0000-000000000006`)

---

## Verification Protocols

### Protocol 1: Verify Multi-Tenant Boundary Isolation
1. Access the web interface and click **Create Account** to register a new user mapped to **Centre A**:
   * **Full Name**: `Teacher Alice`
   * **Centre ID**: `a0000000-0000-0000-0000-00000000000a`
   * **Email**: `alice@centrea.com`
2. Search for **"蘇"** in the student finder. The seed student **蘇卓怡** will appear.
3. Search for **"梁"**. The result list will remain empty because **梁志強** is restricted by RLS.
4. Sign out and register a new user mapped to **Centre B**:
   * **Full Name**: `Teacher Bob`
   * **Centre ID**: `b0000000-0000-0000-0000-00000000000b`
   * **Email**: `bob@centreb.com`
5. Search for **"梁"** to verify **梁志強** is visible. Search for **"蘇"** to verify **蘇卓怡** is hidden.

### Protocol 2: Run Multi-Image Worksheet Analysis
1. Select the student profile from the search results.
2. Upload multiple worksheet pages using the upload grid (you can select multiple images from your file manager or phone gallery).
3. Click **Analyze with AI**.
4. The system will route the image array in-memory to the AI provider, retrieve structured JSON questions feedback, and log only the structured results to Supabase.
5. Confirm that the new entry is appended to the **Feedback History** list showing a structured checklist card (`Question 1 ✓`, `Question 2 ✗`, etc.).

### Protocol 3: Realtime Subscription Sync
1. Open two separate browser tabs (Session 1 and Session 2) logged into the same centre (e.g. `bob@centreb.com`).
2. Select student **梁志強** on both sessions.
3. Upload and analyze a worksheet on Session 1.
4. Observe Session 2: The **Recent Runs** activity log and **Feedback History** list will instantly update with the new record in real-time, without requiring a page refresh.
