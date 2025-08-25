// app/lib/supabase.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://sdatmuzzsebvckfmnqsv.supabase.co'; // replace with your real URL
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkYXRtdXp6c2VidmNrZm1ucXN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMyOTIwNzIsImV4cCI6MjA2ODg2ODA3Mn0.IO2vFDIsb8JF6cunEu_URFRPoaAk0aZIRZa-BBcT450'; // replace with your real anon key

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
