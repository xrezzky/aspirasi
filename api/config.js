// api/config.js — versi diagnostik
// Setelah berhasil, kembali ke versi bersih (lihat Langkah 4).

export const config = { runtime: "nodejs" };

export default function handler(req, res) {
  // kumpulkan semua nama env var yang MIRIP (untuk deteksi typo)
  const allKeys = Object.keys(process.env);
  const suspicious = allKeys.filter(k =>
    /supabase|SUPABASE|Supabase/i.test(k)
  );

  const url  = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;

  // diagnostik — jangan bocorkan value, hanya metadata
  const diag = {
    ok: !!(url && anon),
    has_url: !!url,
    has_anon: !!anon,
    url_length: url ? url.length : 0,
    anon_length: anon ? anon.length : 0,
    url_has_quotes: url ? (url.startsWith('"') || url.startsWith("'")) : null,
    anon_has_quotes: anon ? (anon.startsWith('"') || anon.startsWith("'")) : null,
    url_has_whitespace: url ? (url !== url.trim()) : null,
    anon_has_whitespace: anon ? (anon !== anon.trim()) : null,
    url_starts_ok: url ? url.startsWith("https://") : null,
    anon_starts_ok: anon ? anon.startsWith("eyJ") : null,
    // semua nama env yang mirip SUPABASE (untuk deteksi typo)
    supabase_like_keys: suspicious,
    node_env: process.env.NODE_ENV || null,
    vercel_env: process.env.VERCEL_ENV || null
  };

  // kalau lengkap, kirim config asli
  if (url && anon) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      SUPABASE_URL: url,
      SUPABASE_ANON_KEY: anon,
      _diag: diag
    });
  }

  // kalau tidak lengkap, kirim diagnostik saja
  res.setHeader("Cache-Control", "no-store");
  return res.status(500).json({
    error: "Env var belum terbaca oleh fungsi.",
    _diag: diag
  });
}
