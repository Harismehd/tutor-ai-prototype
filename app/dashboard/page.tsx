'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { 
  Search, Upload, Activity, LogOut, UserCheck, Sparkles, Clock, 
  AlertTriangle, CheckCircle2, FileImage, Loader2, Camera, User, School, BookOpen
} from 'lucide-react';

interface Student {
  id: string;
  name: string;
  centre_id: string;
  created_at: string;
}

interface QuestionFeedback {
  question_number: number;
  is_correct: boolean;
  correct_answer: string;
  mistake_type: string;
  topic_tag: string;
}

interface FeedbackRecord {
  id: string;
  student_id: string;
  teacher_id: string;
  questions: QuestionFeedback[];
  created_at: string;
  teacher_name?: string; // resolved in UI
}

export default function DashboardPage() {
  const router = useRouter();
  
  // Auth & Profile state
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<{ full_name: string; role: string; centre_name: string } | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [studentsList, setStudentsList] = useState<Student[]>([]);
  const [searching, setSearching] = useState(false);

  // Selected student & student feedback history state
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [studentHistory, setStudentHistory] = useState<FeedbackRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Image Upload & AI analysis state (supports multiple images/pages)
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<FeedbackRecord | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Centre-wide recent feedback state (demonstrates data-sharing in centre)
  const [recentCentreActivity, setRecentCentreActivity] = useState<any[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);

  // 1. Authentication & Session check
  useEffect(() => {
    const getSessionAndProfile = async () => {
      try {
        const { data: { session: activeSession } } = await supabase.auth.getSession();
        
        if (!activeSession) {
          router.push('/login');
          return;
        }

        setSession(activeSession);

        // Fetch profile and join centre name (demonstrating secure join query under RLS)
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('full_name, role, centres(name)')
          .eq('id', activeSession.user.id)
          .single();

        if (profileError) {
          throw profileError;
        }

        setProfile({
          full_name: profileData.full_name || 'Teacher',
          role: profileData.role || 'teacher',
          centre_name: (profileData.centres as any)?.name || 'Unknown Centre',
        });

      } catch (err) {
        console.error('Error fetching session/profile:', err);
        router.push('/login');
      } finally {
        setCheckingAuth(false);
      }
    };

    getSessionAndProfile();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        router.push('/login');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

  // 2. Fetch Centre Activity (any analysis run inside the active centre)
  const fetchCentreActivity = async () => {
    if (!session) return;
    setLoadingActivity(true);
    try {
      // Query recent feedbacks. 
      // RLS ensures only records belonging to the teacher's centre are returned.
      const { data, error } = await supabase
        .from('student_feedback')
        .select(`
          id,
          questions,
          created_at,
          students(name),
          profiles(full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(6);

      if (error) throw error;
      setRecentCentreActivity(data || []);
    } catch (err) {
      console.error('Error fetching activity:', err);
    } finally {
      setLoadingActivity(false);
    }
  };

  useEffect(() => {
    if (session) {
      fetchCentreActivity();
    }
  }, [session]);

  // 3. Supabase Realtime Subscription for Live Updates
  useEffect(() => {
    if (!session) return;

    // Subscribe to new rows in the student_feedback table.
    // Supabase Realtime automatically filters updates according to active Postgres RLS boundaries.
    const channel = supabase
      .channel('realtime-student-feedback-channel')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'student_feedback',
        },
        (payload) => {
          // Refetch centre-wide activity log
          fetchCentreActivity();
          
          // Refetch current student's feedback history if active
          if (selectedStudent && payload.new.student_id === selectedStudent.id) {
            fetchStudentHistory(selectedStudent.id);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, selectedStudent]);

  // 4. Search-as-you-type trigger (directly on the client to bypass local Node DNS blocks)
  useEffect(() => {
    const searchStudents = async () => {
      if (searchQuery.trim().length === 0) {
        setStudentsList([]);
        return;
      }

      setSearching(true);
      try {
        // Query database directly from the browser. 
        // Supabase client automatically attaches the active session token, enforcing RLS.
        const { data, error } = await supabase
          .from('students')
          .select('id, name, centre_id, created_at')
          .ilike('name', `%${searchQuery}%`)
          .order('name', { ascending: true });

        if (error) {
          throw error;
        }

        setStudentsList(data || []);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setSearching(false);
      }
    };

    const delayDebounce = setTimeout(() => {
      searchStudents();
    }, 300); // 300ms debounce

    return () => clearTimeout(delayDebounce);
  }, [searchQuery, session]);

  // 5. Fetch selected student feedback history
  const fetchStudentHistory = async (studentId: string) => {
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from('student_feedback')
        .select(`
          id,
          student_id,
          teacher_id,
          questions,
          created_at,
          profiles(full_name)
        `)
        .eq('student_id', studentId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      const formattedData = (data || []).map((item: any) => ({
        ...item,
        teacher_name: item.profiles?.full_name || 'Teacher',
      }));

      setStudentHistory(formattedData);
    } catch (err) {
      console.error('Error fetching history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleSelectStudent = (student: Student) => {
    setSelectedStudent(student);
    setAnalysisResult(null);
    setAnalysisError(null);
    setImagePreviews([]);
    setImageFiles([]);
    fetchStudentHistory(student.id);
  };

  // 6. Handle multi-image selection & base64 conversion
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles = Array.from(files);
    setImageFiles(newFiles);
    setAnalysisResult(null);
    setAnalysisError(null);

    const newPreviews: string[] = [];
    let loadedCount = 0;

    newFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        newPreviews.push(reader.result as string);
        loadedCount++;
        if (loadedCount === newFiles.length) {
          setImagePreviews(newPreviews);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  // 7. Handle AI analysis upload (Multi-image, client-side Supabase write)
  const handleAnalyzeWorksheet = async () => {
    if (!selectedStudent || imagePreviews.length === 0) return;

    setAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          studentId: selectedStudent.id,
          imagesBase64: imagePreviews,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Worksheet analysis failed');
      }

      // Save the AI feedback results into the database directly from the browser.
      // This is fully secured by PostgreSQL Row Level Security (RLS) policies.
      const { data: savedFeedback, error: insertError } = await supabase
        .from('student_feedback')
        .insert({
          student_id: selectedStudent.id,
          teacher_id: session.user.id,
          questions: result.feedback.questions,
        })
        .select()
        .single();

      if (insertError) {
        throw new Error(insertError.message || 'Failed to save analysis feedback to database.');
      }

      setAnalysisResult(savedFeedback);
      
      // Reset image preview state after successful upload
      setImagePreviews([]);
      setImageFiles([]);
      
      // Refresh local states
      fetchStudentHistory(selectedStudent.id);
      fetchCentreActivity();

    } catch (err: any) {
      console.error('Analysis error:', err);
      setAnalysisError(err.message || 'An error occurred during image processing.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-[#090d16] text-white flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
        <p className="text-slate-400 text-sm font-medium">Verifying tenant security session...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080c14] text-white flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Header */}
      <header className="bg-[#0b101c]/80 backdrop-blur-md border-b border-slate-900 px-6 py-4 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600/20 text-indigo-400 p-2 rounded-xl border border-indigo-500/20">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h1 className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
              TutorAI Platform
            </h1>
            <span className="text-[10px] text-indigo-400 font-semibold block uppercase tracking-wider">
              Secure Multi-Tenant Dashboard
            </span>
          </div>
        </div>

        {/* Profile Card & Log Out */}
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-3 px-3.5 py-1.5 rounded-xl bg-[#111827] border border-slate-800">
            <div className="bg-indigo-500/20 w-8 h-8 rounded-lg flex items-center justify-center text-indigo-300 font-bold border border-indigo-500/10">
              {profile?.full_name.charAt(0).toUpperCase()}
            </div>
            <div className="text-left">
              <span className="text-xs font-bold text-slate-200 block leading-tight">{profile?.full_name}</span>
              <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1">
                <School className="w-3 h-3" /> {profile?.centre_name}
              </span>
            </div>
          </div>

          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex flex-col lg:flex-row max-w-7xl w-full mx-auto p-4 sm:p-6 gap-6">
        
        {/* Left Sidebar: Student Directory & Search */}
        <div className="lg:w-1/3 flex flex-col gap-6">
          <div className="bg-[#0b101c] border border-slate-800/80 rounded-2xl p-5 flex flex-col gap-4 shadow-xl">
            <div className="flex items-center gap-2 text-indigo-400">
              <UserCheck className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Student Search</span>
            </div>
            <h2 className="text-xl font-bold tracking-tight text-white">Find Student Profile</h2>
            <p className="text-xs text-slate-400 leading-normal">
              Type the student name to lookup their records under secure Row Level Security (RLS).
            </p>

            {/* Search Input */}
            <div className="relative mt-2">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Search name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#111827] border border-slate-800 focus:border-indigo-500 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-all"
              />
              {searching && (
                <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-500 animate-spin" />
              )}
            </div>

            {/* Search Results */}
            <div className="space-y-2 max-h-48 overflow-y-auto mt-2">
              {studentsList.length > 0 ? (
                studentsList.map((student) => (
                  <button
                    key={student.id}
                    onClick={() => handleSelectStudent(student)}
                    className={`w-full text-left p-3 rounded-xl border flex items-center justify-between transition-all duration-200 ${
                      selectedStudent?.id === student.id
                        ? 'bg-indigo-600/10 border-indigo-500 text-white shadow-inner'
                        : 'bg-[#111827]/60 border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold text-sm border border-indigo-500/10">
                        {student.name.charAt(0)}
                      </div>
                      <span className="text-sm font-semibold">{student.name}</span>
                    </div>
                  </button>
                ))
              ) : searchQuery ? (
                <div className="text-center py-6 border border-dashed border-slate-800 rounded-xl">
                  <p className="text-xs text-slate-500">No students found matching "{searchQuery}"</p>
                  <p className="text-[10px] text-slate-600 mt-1">
                    (RLS isolates access boundaries by centre)
                  </p>
                </div>
              ) : (
                <div className="text-center py-6 border border-dashed border-slate-800 rounded-xl text-slate-500 text-xs">
                  Enter search query above.
                </div>
              )}
            </div>
          </div>

          {/* Centre-wide Activity Panel (RLS Realtime Demo) */}
          <div className="bg-[#0b101c] border border-slate-800/80 rounded-2xl p-5 flex flex-col gap-4 shadow-xl">
            <div className="flex items-center gap-2 text-emerald-400">
              <Activity className="w-4 h-4 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-wider">Centre Activity Logs</span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-200">Recent Runs at {profile?.centre_name}</h3>
              <p className="text-[11px] text-slate-400 mt-1 leading-normal">
                This feed updates in real-time when any teacher in your centre analyzes a worksheet.
              </p>
            </div>

            <div className="space-y-3 mt-1">
              {loadingActivity ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-slate-600" />
                </div>
              ) : recentCentreActivity.length > 0 ? (
                recentCentreActivity.map((act) => {
                  const totalQuestions = act.questions?.length || 0;
                  const correctQuestions = act.questions?.filter((q: any) => q.is_correct).length || 0;
                  const firstTopic = act.questions?.[0]?.topic_tag || 'Math';

                  return (
                    <div 
                      key={act.id} 
                      className="p-3 bg-[#111827]/40 border border-slate-800/50 rounded-xl space-y-1.5 text-left"
                    >
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="font-bold text-slate-300 flex items-center gap-1">
                          <User className="w-3 h-3 text-slate-500" /> {act.students?.name}
                        </span>
                        <span className="text-slate-500">
                          {new Date(act.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-indigo-200 truncate">
                        Score: {correctQuestions}/{totalQuestions} questions correct
                      </p>
                      <div className="flex justify-between items-center text-[9px] text-slate-500 pt-1 border-t border-slate-800/60">
                        <span>By: {act.profiles?.full_name}</span>
                        <span className="bg-indigo-950 text-indigo-400 px-1.5 py-0.5 rounded font-semibold border border-indigo-900/30">
                          {firstTopic}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-slate-500 text-center py-4 border border-dashed border-slate-800 rounded-xl">
                  No activity logged yet.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right Area: Student Workspace (Analysis panel + Student history) */}
        <div className="flex-1 flex flex-col bg-[#0b101c] border border-slate-800/80 rounded-2xl min-h-[500px] shadow-xl overflow-hidden">
          {selectedStudent ? (
            <div className="flex flex-col flex-1">
              
              {/* Selected Student Banner */}
              <div className="bg-[#111827]/60 border-b border-slate-800/80 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-extrabold text-xl shadow-lg shadow-indigo-600/15">
                    {selectedStudent.name.charAt(0)}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white tracking-tight">
                      {selectedStudent.name}
                    </h2>
                    <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                      <BookOpen className="w-3.5 h-3.5 text-slate-500" />
                      ID: <span className="font-mono text-slate-300">{selectedStudent.id}</span>
                    </p>
                  </div>
                </div>

                <div className="bg-[#18233c] text-indigo-300 px-3.5 py-1.5 rounded-xl border border-indigo-500/10 text-xs font-semibold flex items-center gap-1.5 self-start sm:self-auto">
                  <School className="w-3.5 h-3.5" />
                  <span>Aligned to {profile?.centre_name}</span>
                </div>
              </div>

              {/* Workspace Content */}
              <div className="p-6 flex flex-col gap-6 flex-1 overflow-y-auto">
                
                {/* AI Worksheet Upload Panel */}
                <div className="bg-[#111827]/40 border border-slate-800 rounded-2xl p-5 space-y-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="text-sm font-bold text-white">AI Worksheet Scan & Analysis</h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Upload one or multiple pages of the worksheet. The AI parses the correction in-memory.
                      </p>
                    </div>
                    <span className="bg-emerald-950 text-emerald-400 text-[10px] font-bold px-2 py-1 rounded-lg border border-emerald-900/30">
                      Zero Image Storage Enforced
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                    
                    {/* Upload box */}
                    <div className="flex flex-col gap-3">
                      <label className="border-2 border-dashed border-slate-800 hover:border-indigo-500/50 rounded-2xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer bg-[#090d16]/50 hover:bg-[#0a101f] transition-all relative overflow-hidden min-h-[160px]">
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleImageChange}
                          className="hidden"
                          disabled={analyzing}
                        />
                        {imagePreviews.length > 0 ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 p-3">
                            <div className="grid grid-cols-3 gap-1.5 w-full h-full max-h-[100px] overflow-y-auto">
                              {imagePreviews.map((preview, index) => (
                                <img 
                                  key={index}
                                  src={preview} 
                                  alt={`Page ${index + 1}`} 
                                  className="object-cover w-full h-16 rounded border border-slate-800" 
                                />
                              ))}
                            </div>
                            <div className="mt-2 text-indigo-400 text-[11px] font-bold">
                              {imagePreviews.length} page(s) selected (Click to change)
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="p-3 bg-slate-900 rounded-xl text-slate-400 border border-slate-800">
                              <Camera className="w-6 h-6" />
                            </div>
                            <div className="text-center">
                              <p className="text-xs font-semibold text-slate-200">Scan or Upload Pages</p>
                              <p className="text-[10px] text-slate-500 mt-1">supports multiple file selection</p>
                            </div>
                          </>
                        )}
                      </label>

                      {imagePreviews.length > 0 && (
                        <button
                          type="button"
                          onClick={handleAnalyzeWorksheet}
                          disabled={analyzing}
                          className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white font-bold py-2.5 rounded-xl text-xs transition-all flex items-center justify-center gap-2"
                        >
                          {analyzing ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>AI Analyzing Worksheet...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-4 h-4" />
                              <span>Analyze with AI</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {/* AI Live Output Panel */}
                    <div className="bg-[#090d16] border border-slate-800/80 rounded-2xl p-5 min-h-[160px] flex flex-col justify-center">
                      {analyzing ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-6">
                          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                          <div className="text-center">
                            <p className="text-xs font-bold text-slate-200">Evaluating calculations...</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">Performing step-by-step verification</p>
                          </div>
                        </div>
                      ) : analysisResult ? (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 border-b border-slate-800/60 pb-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            <h4 className="text-xs font-extrabold text-slate-200 uppercase tracking-wider">AI feedback generated</h4>
                          </div>

                          <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                            {analysisResult.questions.map((q) => (
                              <div key={q.question_number} className="p-3 bg-[#111827]/70 border border-slate-800/80 rounded-xl text-left space-y-1 text-xs">
                                <div className="flex justify-between items-center">
                                  <span className="font-bold text-slate-300">Question {q.question_number}</span>
                                  {q.is_correct ? (
                                    <span className="text-emerald-400 font-bold">✓ Correct</span>
                                  ) : (
                                    <span className="text-rose-400 font-bold">✗ Incorrect</span>
                                  )}
                                </div>
                                {!q.is_correct && (
                                  <div className="pt-1.5 border-t border-slate-800/40 text-slate-300 space-y-1 mt-1">
                                    <p><span className="text-[10px] text-slate-500 uppercase tracking-wider block">Correct Answer:</span> <strong className="text-emerald-400">{q.correct_answer}</strong></p>
                                    <p><span className="text-[10px] text-slate-500 uppercase tracking-wider block">Mistake details:</span> {q.mistake_type}</p>
                                    <span className="inline-block bg-indigo-950 text-indigo-400 px-1.5 py-0.5 rounded text-[10px] font-bold border border-indigo-900/30 mt-1">
                                      {q.topic_tag}
                                    </span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : analysisError ? (
                        <div className="text-center p-4 space-y-2 text-rose-400 bg-rose-500/5 border border-rose-500/10 rounded-xl">
                          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
                          <h4 className="text-xs font-bold">Analysis Failed</h4>
                          <p className="text-[10px] text-slate-400 leading-normal">{analysisError}</p>
                        </div>
                      ) : (
                        <div className="text-center py-6 text-slate-500">
                          <FileImage className="w-8 h-8 mx-auto text-slate-700 mb-2" />
                          <p className="text-xs font-medium">No active analysis</p>
                          <p className="text-[10px] text-slate-600 mt-0.5">Upload worksheet pages to start evaluation</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Selected Student Feedback History Logs */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-slate-300">
                      <Clock className="w-4 h-4" />
                      <h3 className="text-sm font-bold">Feedback History</h3>
                    </div>
                    <span className="text-[10px] text-slate-500">
                      Showing past evaluations
                    </span>
                  </div>

                  <div className="space-y-4">
                    {loadingHistory ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-slate-700" />
                      </div>
                    ) : studentHistory.length > 0 ? (
                      studentHistory.map((hist) => (
                        <div 
                          key={hist.id} 
                          className="bg-[#111827]/40 border border-slate-800 rounded-2xl p-5 space-y-3 text-left transition-all duration-200 hover:border-slate-700"
                        >
                          <div className="flex justify-between items-start border-b border-slate-800/60 pb-2">
                            <div className="text-left text-[10px] text-slate-400">
                              <span className="font-semibold text-slate-300">Evaluation Run:</span> <span className="font-mono text-slate-400">{hist.id.substring(0, 8)}...</span>
                            </div>
                            <div className="text-right text-[10px] text-slate-500">
                              <span className="font-semibold text-slate-400 block">{hist.teacher_name}</span>
                              <span>{new Date(hist.created_at).toLocaleDateString()} {new Date(hist.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </div>

                          <div className="space-y-2">
                            {hist.questions.map((q) => (
                              <div key={q.question_number} className="p-2.5 rounded-lg bg-[#090d16] border border-slate-800/80 text-xs space-y-1">
                                <div className="flex justify-between items-center">
                                  <span className="font-semibold text-slate-300">Question {q.question_number}</span>
                                  {q.is_correct ? (
                                    <span className="text-emerald-400 font-bold">✓</span>
                                  ) : (
                                    <span className="text-rose-400 font-bold">✗</span>
                                  )}
                                </div>
                                {!q.is_correct && (
                                  <div className="text-[11px] text-slate-400 space-y-0.5 pt-1.5 border-t border-slate-800/30">
                                    <p>Correction: <strong className="text-emerald-400">{q.correct_answer}</strong></p>
                                    <p>Mistake: {q.mistake_type}</p>
                                    <p>Topic: <span className="text-indigo-400">{q.topic_tag}</span></p>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl text-slate-500 text-xs">
                        No previous feedback stored for this student.
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
              <div className="w-16 h-16 rounded-2xl bg-slate-900/50 border border-slate-800 flex items-center justify-center text-slate-400 mb-4 animate-bounce">
                <User className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-300">No Student Selected</h3>
              <p className="text-xs text-slate-500 max-w-sm mt-1 leading-normal">
                Search and select a student from the sidebar to view their profile, past worksheet scans, and analyze new assignments.
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
