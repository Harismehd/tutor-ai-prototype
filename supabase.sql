-- ==========================================
-- TUTORAI PROTOTYPE SUPABASE SETUP SCRIPT
-- ==========================================
-- This script sets up the tables, indexes, triggers, and Row Level Security (RLS)
-- policies for the TutorAI multi-tenant tutoring platform.
-- Execute this entire file in your Supabase SQL Editor.

-- Enable UUID extension if not already enabled
create extension if not exists "uuid-ossp";

-- ------------------------------------------
-- 1. TABLE CREATION
-- ------------------------------------------

-- Centres Table
create table if not exists public.centres (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Profiles Table (Teacher / Staff profiles linked to Auth users)
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  centre_id uuid not null references public.centres(id) on delete cascade,
  full_name text,
  role text not null default 'teacher',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Students Table (Belongs to a specific Centre)
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  centre_id uuid not null references public.centres(id) on delete cascade,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Recreate the student_feedback table to enforce the JSONB questions array column
drop table if exists public.student_feedback cascade;

-- Student Feedback Table (AI-generated structured feedback)
create table if not exists public.student_feedback (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  questions jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ------------------------------------------
-- 2. INDEXES & PERFORMANCE OPTIMIZATION
-- ------------------------------------------
create index if not exists idx_profiles_centre_id on public.profiles(centre_id);
create index if not exists idx_students_centre_id on public.students(centre_id);
create index if not exists idx_students_centre_name on public.students(centre_id, name);
create index if not exists idx_feedback_student_id on public.student_feedback(student_id);
create index if not exists idx_feedback_teacher_id on public.student_feedback(teacher_id);

-- ------------------------------------------
-- 3. HELPER FUNCTIONS
-- ------------------------------------------

-- Helper function to get the current user's centre ID.
-- SECURITY DEFINER allows this function to read the profiles table
-- bypasses potential circular RLS checks while verifying the active user session.
create or replace function public.get_user_centre_id()
returns uuid
security definer
set search_path = public
language plpgsql
as $$
begin
  return (
    select centre_id 
    from public.profiles 
    where id = auth.uid()
  );
end;
$$;

-- ------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------

-- Enable RLS on all public tables
alter table public.centres enable row level security;
alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.student_feedback enable row level security;

-- Policies for Centres
drop policy if exists "Users can view their own centre" on public.centres;
create policy "Users can view their own centre"
  on public.centres
  for select
  using (id = public.get_user_centre_id());

-- Policies for Profiles
drop policy if exists "Users can view profiles in their centre" on public.profiles;
create policy "Users can view profiles in their centre"
  on public.profiles
  for select
  using (centre_id = public.get_user_centre_id());

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles
  for update
  using (id = auth.uid() and centre_id = public.get_user_centre_id());

-- Policies for Students
drop policy if exists "Teachers can view students in their centre" on public.students;
create policy "Teachers can view students in their centre"
  on public.students
  for select
  using (centre_id = public.get_user_centre_id());

drop policy if exists "Teachers can insert students in their centre" on public.students;
create policy "Teachers can insert students in their centre"
  on public.students
  for insert
  with check (centre_id = public.get_user_centre_id());

drop policy if exists "Teachers can update students in their centre" on public.students;
create policy "Teachers can update students in their centre"
  on public.students
  for update
  using (centre_id = public.get_user_centre_id())
  with check (centre_id = public.get_user_centre_id());

drop policy if exists "Teachers can delete students in their centre" on public.students;
create policy "Teachers can delete students in their centre"
  on public.students
  for delete
  using (centre_id = public.get_user_centre_id());

-- Policies for Student Feedback
drop policy if exists "Teachers can view feedback for students in their centre" on public.student_feedback;
create policy "Teachers can view feedback for students in their centre"
  on public.student_feedback
  for select
  using (
    exists (
      select 1 
      from public.students s 
      where s.id = student_feedback.student_id 
        and s.centre_id = public.get_user_centre_id()
    )
  );

drop policy if exists "Teachers can insert feedback for students in their centre" on public.student_feedback;
create policy "Teachers can insert feedback for students in their centre"
  on public.student_feedback
  for insert
  with check (
    exists (
      select 1 
      from public.students s 
      where s.id = student_feedback.student_id 
        and s.centre_id = public.get_user_centre_id()
    ) 
    and teacher_id = auth.uid()
  );

drop policy if exists "Teachers can update feedback for students in their centre" on public.student_feedback;
create policy "Teachers can update feedback for students in their centre"
  on public.student_feedback
  for update
  using (
    exists (
      select 1 
      from public.students s 
      where s.id = student_feedback.student_id 
        and s.centre_id = public.get_user_centre_id()
    ) 
    and teacher_id = auth.uid()
  )
  with check (
    exists (
      select 1 
      from public.students s 
      where s.id = student_feedback.student_id 
        and s.centre_id = public.get_user_centre_id()
    ) 
    and teacher_id = auth.uid()
  );

drop policy if exists "Teachers can delete feedback for students in their centre" on public.student_feedback;
create policy "Teachers can delete feedback for students in their centre"
  on public.student_feedback
  for delete
  using (
    exists (
      select 1 
      from public.students s 
      where s.id = student_feedback.student_id 
        and s.centre_id = public.get_user_centre_id()
    ) 
    and teacher_id = auth.uid()
  );

-- ------------------------------------------
-- 5. TRIGGER FOR AUTOMATIC PROFILE CREATION
-- ------------------------------------------

-- Trigger function that automatically creates a public profile row when a new user signs up.
-- It reads user metadata (`centre_id`, `full_name`, `role`) passed during Auth signup.
create or replace function public.handle_new_user()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
  meta_centre_id text;
  centre_uuid uuid;
begin
  -- Retrieve centre_id from user metadata
  meta_centre_id := new.raw_user_meta_data->>'centre_id';
  
  if meta_centre_id is null then
    raise exception 'centre_id metadata is required for profile creation';
  end if;
  
  centre_uuid := meta_centre_id::uuid;

  insert into public.profiles (id, centre_id, full_name, role)
  values (
    new.id,
    centre_uuid,
    coalesce(new.raw_user_meta_data->>'full_name', 'Teacher'),
    coalesce(new.raw_user_meta_data->>'role', 'teacher')
  );
  return new;
exception
  when others then
    raise exception 'Error creating public profile: %', sqlerrm;
end;
$$;

-- Bind the trigger to auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ------------------------------------------
-- 6. SEED DATA
-- ------------------------------------------

-- Insert Centre A and Centre B with static, predictable UUIDs for easy configuration and testing
insert into public.centres (id, name)
values 
  ('a0000000-0000-0000-0000-00000000000a', 'Centre A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Centre B')
on conflict (id) do update set name = excluded.name;

-- Seed student: 蘇卓怡 (belongs to Centre A)
insert into public.students (id, centre_id, name)
values
  ('50000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-00000000000a', '蘇卓怡')
on conflict (id) do update set name = excluded.name, centre_id = excluded.centre_id;

-- Seed student: 梁志強 (belongs to Centre B, for cross-tenant testing)
insert into public.students (id, centre_id, name)
values
  ('60000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-00000000000b', '梁志強')
on conflict (id) do update set name = excluded.name, centre_id = excluded.centre_id;

-- Grant permissions to supabase api keys (standard)
grant all on all tables in schema public to postgres, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.centres to anon;
