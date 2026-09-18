// api/config.js — final
// Mendukung beberapa nama env var sekaligus.
// Prioritas: SUPABASE_URL > SUP_URL
//            SUPABASE_ANON_KEY > SUP_KEY

export const config = { runtime: "nodejs" };

export default function handler(req, res) {
  const url =
    process.env.SUPABASE_URL ||
    process.env.SUP_URL ||
    "";

  const anon =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUP_KEY ||
    "";

  if (!url || !anon) {
    return res.status(500).json({
      error: "Konfigurasi Supabase belum lengkap.",
      _diag: {
        has_SUPABASE_URL: !!process.env.SUPABASE_URL,
        has_SUP_URL: !!process.env.SUP_URL,
        has_SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
        has_SUP_KEY: !!process.env.SUP_KEY
      }
    });
  }

  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
  res.setHeader("Content-Type", "application/json");

  return res.status(200).json({
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: anon
  });
}