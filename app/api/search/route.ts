import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase';

// Input validation schema using Zod
const searchRequestSchema = z.object({
  q: z.string().trim().min(1, 'Search query cannot be empty').max(100, 'Search query is too long'),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const queryParam = searchParams.get('q') || '';

    // Validate the query parameter
    const validation = searchRequestSchema.safeParse({ q: queryParam });
    if (!validation.success) {
      return NextResponse.json(
        { 
          error: 'Validation failed', 
          details: validation.error.flatten().fieldErrors 
        },
        { status: 400 }
      );
    }

    const { q } = validation.data;
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized: Missing access token' }, 
        { status: 401 }
      );
    }

    // Verify Supabase configuration variables exist and are not placeholder values
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!sbUrl || !sbKey || sbUrl.toLowerCase().includes('placeholder') || sbKey.toLowerCase().includes('placeholder')) {
      console.error('[Configuration Error]: Supabase environment variables are missing or set to placeholder.');
      return NextResponse.json(
        { 
          error: 'Configuration Error: Supabase connection keys are missing or invalid placeholder values in the server configuration.',
          code: 'DB_CONFIG_ERROR' 
        },
        { status: 500 }
      );
    }

    const supabase = createServerSupabaseClient(req);

    // Verify user authentication using the extracted JWT with connection safety catch
    let user;
    try {
      const { data, error: authError } = await supabase.auth.getUser(token);
      if (authError || !data?.user) {
        return NextResponse.json(
          { error: 'Unauthorized: Invalid or expired session' }, 
          { status: 401 }
        );
      }
      user = data.user;
    } catch (networkError: any) {
      console.error('[Database Connection Error]: Failed to connect to Supabase auth client:', networkError);
      return NextResponse.json(
        { 
          error: 'Database Connection Error: Failed to connect to Supabase database client. Please verify network access and credentials.', 
          code: 'DB_CONNECTION_FAILED' 
        },
        { status: 502 }
      );
    }

    // Query the students table. 
    // Supabase RLS automatically filters rows to return only students belonging to the user's centre.
    const { data: students, error: dbError } = await supabase
      .from('students')
      .select('id, name, centre_id, created_at')
      .ilike('name', `%${q}%`)
      .order('name', { ascending: true });

    if (dbError) {
      console.error('Database student search error:', dbError);
      return NextResponse.json({ error: 'Failed to search students' }, { status: 500 });
    }

    return NextResponse.json({ students });
  } catch (error: any) {
    console.error('Search API Route Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
