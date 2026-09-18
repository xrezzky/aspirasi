// api/config.js — Vercel Serverless Function
// Membagikan Supabase URL + anon key dari env vars.
// anon key AMAN dibagikan (dilindungi RLS). Service role key JANGAN pernah di sini.

export default function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;

  if (!url || !anon) {
    return res.status(500).json({
      error: "Konfigurasi server belum lengkap. Set SUPABASE_URL dan SUPABASE_ANON_KEY di Vercel."
    });
  }

  // Cache 5 menit di CDN, 60 detik di browser.
  // Aman karena isinya bukan rahasia.
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
  res.setHeader("Content-Type", "application/json");

  return res.status(200).json({
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: anon
  });
}
