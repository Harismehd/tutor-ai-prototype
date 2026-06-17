'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ShieldCheck, School, Mail, Lock, User, ArrowRight, Loader2, Info, LockKeyhole } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  
  // Auth Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [centreId, setCentreId] = useState('a0000000-0000-0000-0000-00000000000a'); // Default to Centre A
  
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
        // Register flow
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              centre_id: centreId,
              full_name: fullName,
              role: 'teacher',
            },
          },
        });

        if (error) throw error;

        if (data.user && data.session) {
          // If auto-signed in after signup
          setMessage({ type: 'success', text: 'Registration successful! Redirecting...' });
          setTimeout(() => {
            router.push('/dashboard');
            router.refresh();
          }, 1000);
        } else {
          // If email confirmation is required (Supabase default is often enabled unless disabled)
          setMessage({ 
            type: 'success', 
            text: 'Registration successful! Please sign in or check your email (if confirmation is active).' 
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

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    alert(`${label} copied to clipboard!`);
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#0b0f19] text-white font-sans selection:bg-indigo-500 selection:text-white">
      {/* Left panel: Testing Instructions & Architecture Overview */}
      <div className="md:w-1/2 p-8 lg:p-12 flex flex-col justify-between border-b md:border-b-0 md:border-r border-slate-800/80 bg-gradient-to-br from-[#0c1224] via-[#0d1630] to-[#0a0f21]">
        <div>
          <div className="flex items-center gap-2 mb-8">
            <div className="bg-indigo-600/20 text-indigo-400 p-2 rounded-xl border border-indigo-500/25">
              <LockKeyhole className="w-6 h-6" />
            </div>
            <span className="font-extrabold text-2xl tracking-tight bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-transparent">
              TutorAI <span className="text-indigo-400 text-sm font-normal">Prototype v1.0</span>
            </span>
          </div>

          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-extrabold leading-tight text-white mb-2">
                Multi-Tenant Isolation Architecture
              </h1>
              <p className="text-slate-400 text-sm leading-relaxed">
                This environment demonstrates database-level row-level security (RLS). All teacher data, student records, and feedback items are locked down. The frontend never filters data—isolation is enforced by PostgreSQL.
              </p>
            </div>

            {/* Tenant Isolation Info Box */}
            <div className="p-5 rounded-2xl bg-[#121c36] border border-slate-800/80 space-y-4">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-indigo-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-semibold text-slate-200">How to test security:</h4>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Create two different accounts, one for <strong>Centre A</strong> and one for <strong>Centre B</strong>. Log in and search for students. Notice that student names are never leaked between centres.
                  </p>
                </div>
              </div>

              {/* Seed Details */}
              <div className="pt-3 border-t border-slate-800/80 space-y-3">
                <div>
                  <span className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider">Centre A Seed Student:</span>
                  <div className="flex justify-between items-center bg-[#0a0f21] px-3 py-2 rounded-lg border border-slate-800 mt-1">
                    <span className="text-xs font-semibold text-emerald-400">蘇卓怡 (Chinese Characters)</span>
                    <button 
                      onClick={() => copyToClipboard('蘇卓怡', 'Student name')}
                      className="text-[10px] text-slate-400 hover:text-white hover:underline transition"
                    >
                      Copy Name
                    </button>
                  </div>
                </div>

                <div>
                  <span className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider">Centre B Seed Student:</span>
                  <div className="flex justify-between items-center bg-[#0a0f21] px-3 py-2 rounded-lg border border-slate-800 mt-1">
                    <span className="text-xs font-semibold text-indigo-300">梁志強 (Chinese Characters)</span>
                    <button 
                      onClick={() => copyToClipboard('梁志強', 'Student name')}
                      className="text-[10px] text-slate-400 hover:text-white hover:underline transition"
                    >
                      Copy Name
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Static Centre IDs */}
            <div className="space-y-2 text-xs">
              <h3 className="font-semibold text-slate-300">Preset Centre UUIDs:</h3>
              <div className="grid grid-cols-1 gap-2">
                <div className="bg-[#101524] p-3 rounded-lg border border-slate-800 flex justify-between items-center">
                  <div>
                    <span className="text-indigo-400 font-bold block">Centre A</span>
                    <span className="text-[10px] font-mono text-slate-500">a0000000-0000-0000-0000-00000000000a</span>
                  </div>
                  <button 
                    onClick={() => copyToClipboard('a0000000-0000-0000-0000-00000000000a', 'Centre A UUID')}
                    className="text-[10px] text-slate-400 hover:text-white"
                  >
                    Copy
                  </button>
                </div>
                <div className="bg-[#101524] p-3 rounded-lg border border-slate-800 flex justify-between items-center">
                  <div>
                    <span className="text-indigo-400 font-bold block">Centre B</span>
                    <span className="text-[10px] font-mono text-slate-500">b0000000-0000-0000-0000-00000000000b</span>
                  </div>
                  <button 
                    onClick={() => copyToClipboard('b0000000-0000-0000-0000-00000000000b', 'Centre B UUID')}
                    className="text-[10px] text-slate-400 hover:text-white"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-8 text-xs text-slate-500 border-t border-slate-900">
          Powered by Supabase RLS & Google Gemini Vision. No images are stored on server or database.
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
                : 'Create an account and map it to a specific centre'}
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

                {/* Centre Mapping Selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">Assign to Centre</label>
                  <div className="relative">
                    <School className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <select
                      value={centreId}
                      onChange={(e) => setCentreId(e.target.value)}
                      className="w-full bg-[#111827] border border-slate-800 focus:border-indigo-500 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white outline-none transition-all focus:ring-2 focus:ring-indigo-500/20 appearance-none cursor-pointer"
                    >
                      <option value="a0000000-0000-0000-0000-00000000000a">Centre A (Demo)</option>
                      <option value="b0000000-0000-0000-0000-00000000000b">Centre B (Demo)</option>
                    </select>
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
