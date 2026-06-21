'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ShieldCheck, School, Mail, Lock, User, ArrowRight, Loader2, LockKeyhole, Info } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  
  // Auth Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [centreId, setCentreId] = useState(''); // Empty by default (requires teacher input, no hardcoded dropdown seeds)
  
  // UI states
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Check if user is already logged in
  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        router.push('/dashboard');
      }
    };
    checkUser();
  }, [router]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (activeTab === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        setMessage({ type: 'success', text: 'Login successful! Redirecting...' });
        setTimeout(() => {
          router.push('/dashboard');
          router.refresh();
        }, 1000);
      } else {
        // Register flow - require a centre ID to be entered
        if (!centreId.trim()) {
          throw new Error('Please enter your centre ID to complete registration.');
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              centre_id: centreId.trim(),
              full_name: fullName.trim(),
              role: 'teacher',
            },
          },
        });

        if (error) throw error;

        if (data.user && data.session) {
          setMessage({ type: 'success', text: 'Registration successful! Redirecting...' });
          setTimeout(() => {
            router.push('/dashboard');
            router.refresh();
          }, 1000);
        } else {
          setMessage({ 
            type: 'success', 
            text: 'Registration successful! Please sign in with your credentials.' 
          });
          setActiveTab('login');
        }
      }
    } catch (err: any) {
      console.error(err);
      setMessage({ type: 'error', text: err.message || 'An error occurred during authentication.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#0b0f19] text-white font-sans selection:bg-indigo-500 selection:text-white">
      {/* Left panel: Security & RLS Architecture Information (No hardcoded test accounts/UUID leaks) */}
      <div className="md:w-1/2 p-8 lg:p-12 flex flex-col justify-between border-b md:border-b-0 md:border-r border-slate-800/80 bg-gradient-to-br from-[#0c1224] via-[#0d1630] to-[#0a0f21]">
        <div>
          <div className="flex items-center gap-2 mb-8">
            <div className="bg-indigo-600/20 text-indigo-400 p-2 rounded-xl border border-indigo-500/25">
              <LockKeyhole className="w-6 h-6" />
            </div>
            <span className="font-extrabold text-2xl tracking-tight bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-transparent">
              TutorAI <span className="text-indigo-400 text-sm font-normal">Platform Gateway</span>
            </span>
          </div>

          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-extrabold leading-tight text-white mb-2">
                Multi-Tenant Isolation Architecture
              </h1>
              <p className="text-slate-400 text-sm leading-relaxed">
                This platform is engineered with a Zero-Trust data model. All data access is isolated at the database layer using PostgreSQL Row Level Security (RLS) policies. Security checks are executed within the database transaction, completely independent of frontend state.
              </p>
            </div>

            {/* Architecture description boxes */}
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-[#121c36]/60 border border-slate-800/40 flex gap-3.5 items-start">
                <School className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-extrabold text-slate-200 uppercase tracking-wider">Centre-Based RLS</h4>
                  <p className="text-xs text-slate-400 mt-1 leading-normal">
                    Teachers are assigned to a unique Centre ID upon registration. Row Level Security policies intercept all operations, verifying database-level access boundaries between centres.
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-[#121c36]/60 border border-slate-800/40 flex gap-3.5 items-start">
                <ShieldCheck className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-extrabold text-slate-200 uppercase tracking-wider">In-Memory AI Vision Pipeline</h4>
                  <p className="text-xs text-slate-400 mt-1 leading-normal">
                    Worksheets are analyzed in-memory via serverless API abstractions and discarded immediately. No images are saved, ensuring strict data privacy and compliance.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-8 text-xs text-slate-500 border-t border-slate-900">
          TutorAI Enterprise. Review setup documentation for administrative test account credentials and schema definitions.
        </div>
      </div>

      {/* Right panel: Login/Register Form */}
      <div className="md:w-1/2 flex items-center justify-center p-8 lg:p-12 bg-[#090d16]">
        <div className="w-full max-w-md space-y-8">
          <div className="flex flex-col items-center">
            {/* Tabs */}
            <div className="flex bg-[#121c33] p-1 rounded-xl w-full border border-slate-800/80 mb-6">
              <button
                type="button"
                onClick={() => { setActiveTab('login'); setMessage(null); }}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                  activeTab === 'login'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('register'); setMessage(null); }}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                  activeTab === 'register'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Create Account
              </button>
            </div>

            <h2 className="text-2xl font-bold tracking-tight text-white text-center">
              {activeTab === 'login' ? 'Teacher Sign In' : 'Register New Teacher'}
            </h2>
            <p className="text-slate-400 text-sm mt-1 text-center">
              {activeTab === 'login'
                ? 'Enter your credentials to access your centre'
                : 'Create an account and input your assigned centre ID'}
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-5">
            {activeTab === 'register' && (
              <>
                {/* Full Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">Full Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      required
                      placeholder="Jane Doe"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full bg-[#111827] border border-slate-800 focus:border-indigo-500 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-all focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                </div>

                {/* Centre ID input box (No hardcoded seeds) */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">Centre ID (UUID)</label>
                  <div className="relative">
                    <School className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      required
                      placeholder="e.g., a0000000-0000-0000-0000-00000000000a"
                      value={centreId}
                      onChange={(e) => setCentreId(e.target.value)}
                      className="w-full bg-[#111827] border border-slate-800 focus:border-indigo-500 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-all focus:ring-2 focus:ring-indigo-500/20 font-mono"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="email"
                  required
                  placeholder="teacher@centre.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#111827] border border-slate-800 focus:border-indigo-500 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-all focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#111827] border border-slate-800 focus:border-indigo-500 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-all focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>

            {/* Notification Messages */}
            {message && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                  message.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                }`}
              >
                <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                <span>{message.text}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2 group hover:shadow-lg hover:shadow-indigo-500/10"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  {activeTab === 'login' ? 'Sign In' : 'Create Account'}
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
