// ===== Supabase Client =====

const SUPABASE_URL = 'https://uskwkqibrjmeocildgay.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVza3drcWlicmptZW9jaWxkZ2F5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MzI2NDksImV4cCI6MjA5MTAwODY0OX0.TzpDmbMdLxWQ2atag9FSviQ0feTB6FIGMKJLgdqxfuc';

let _createClient;
if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
  // CDN already loaded (admin.html)
  _createClient = window.supabase.createClient;
} else {
  // ESM fallback (login.html)
  const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  _createClient = mod.createClient;
}

const supabaseClient = _createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ESM export for: import { supabase } from './supabase.js'
export { supabaseClient as supabase };

// Global for inline scripts
if (typeof window !== 'undefined') {
  window.supabaseClient = supabaseClient;
}
