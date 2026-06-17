'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Loader2 } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const checkSessionAndRedirect = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          router.replace('/dashboard');
        } else {
          router.replace('/login');
        }
      } catch (err) {
        console.error('Error checking session on homepage:', err);
        router.replace('/login');
      }
    };
    
    checkSessionAndRedirect();
  }, [router]);

  return (
    <div className="min-h-screen bg-[#080c14] text-white flex flex-col items-center justify-center gap-3">
      <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
      <p className="text-slate-400 text-sm font-medium">Redirecting to session context...</p>
    </div>
  );
}
