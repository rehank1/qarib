// Deployment settings. Everything here is PUBLIC (it ships inside the app). The Supabase "anon" key is public by
// design: it only allows what the database's row-level security allows. Never put the secret "service" key here.
export const CONFIG = Object.freeze({
  version: '1.1.0', // keep in step with the release tag (v1.1.0)
  supabaseUrl: 'https://lgjivmerhgmypxhepqlt.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxnaml2bWVyaGdteXB4aGVwcWx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwMzA4ODAsImV4cCI6MjExMDYwNjg4MH0.FOgoh1H_Oo0CI2l-Llay6kwRTCFXaifFE3eoZZu62nU', // public anon key (role: anon)
  updateRepo: 'rehank1/qarib', // GitHub repo whose Releases carry the APK
  appName: 'Qarīb',
  masjidLimit: 3,
  staleDays: 45, // jamaat times older than this are flagged "may be out of date"
});
