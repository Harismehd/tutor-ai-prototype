import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

// Client-side instance (used in React components)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Creates a server-side Supabase client that forwards the user's JWT token.
 * This ensures Row Level Security (RLS) is correctly enforced at the database level.
 */
export function createServerSupabaseClient(req: NextRequest) {
  // Extract Bearer token from the Authorization header
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

  return createClient(supabaseUrl!, supabaseAnonKey!, {
    global: {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
    auth: {
      persistSession: false, // Don't persist session in server environments
    },
  });
}
