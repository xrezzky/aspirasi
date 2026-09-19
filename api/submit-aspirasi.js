// api/submit-aspirasi.js
// Satu-satunya pintu resmi untuk mengirim aspirasi ke database.
// Kenapa lewat server (bukan langsung dari browser ke Supabase):
// anon key itu publik & kelihatan di jaringan, jadi kalau insert
// dilakukan langsung dari browser, bot bisa niru request itu dan
// melewati apa pun pemeriksaan yang cuma ada di HTML/JS. Dengan
// lewat sini, pemeriksaan anti-bot (honeypot + jeda waktu) betul-
// betul dipaksakan di server, dan insert-nya sendiri pakai
// SERVICE_ROLE_KEY yang tidak pernah dikirim ke browser.

export const config = { runtime: "nodejs" };

const MIN_SECONDS = 3;      // manusia butuh waktu isi form; bot biasanya < 1 detik
const MAX_LEN = { pesan: 3000, solusi: 3000, nama: 120, kontak: 120 };
const RATE_LIMIT_WINDOW_MIN = 10; // jendela waktu rate limit
const RATE_LIMIT_MAX = 5;         // maksimal N aspirasi per visitor_id per jendela waktu

function bad(res, status, msg) {
  return res.status(status).json({ error: msg });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return bad(res, 405, "Method not allowed");

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return bad(res, 400, "Body tidak valid"); }
  }
  if (!body || typeof body !== "object") return bad(res, 400, "Body kosong");

  const {
    kategori, jenjang, kelas, pesan, solusi,
    nama = "", kontak = "",
    hp = "",              // honeypot: HARUS kosong
    ts = 0,               // timestamp (ms) saat form dimuat di client
    visitorId = null      // ID anonim per-browser, dipakai untuk rate limit
  } = body;

  // ---- 1. HONEYPOT ----
  // Field ini disembunyikan secara visual di form; pengguna manusia
  // tidak pernah mengisinya. Bot pengisi-form-otomatis sering
  // mengisi SEMUA field yang mereka temukan di DOM, termasuk ini.
  if (typeof hp === "string" && hp.trim() !== "") {
    // Jangan kasih tahu bot kalau ketahuan — cukup tolak diam-diam
    // dengan pesan generik yang sama seperti error biasa.
    return bad(res, 400, "Gagal mengirim aspirasi.");
  }

  // ---- 2. JEDA WAKTU MINIMUM ----
  const elapsedSec = (Date.now() - Number(ts)) / 1000;
  if (!ts || !isFinite(elapsedSec) || elapsedSec < MIN_SECONDS) {
    return bad(res, 400, "Gagal mengirim aspirasi.");
  }

  // ---- 3. VALIDASI DASAR ----
  const required = { kategori, jenjang, kelas, pesan, solusi };
  for (const [k, v] of Object.entries(required)) {
    if (typeof v !== "string" || !v.trim()) {
      return bad(res, 400, `Field "${k}" wajib diisi.`);
    }
  }
  if (pesan.length > MAX_LEN.pesan || solusi.length > MAX_LEN.solusi ||
      nama.length > MAX_LEN.nama || kontak.length > MAX_LEN.kontak) {
    return bad(res, 400, "Salah satu isian terlalu panjang.");
  }
  const allowedKategori = ["Saran", "Kritik", "Ide Kegiatan", "Keluhan"];
  if (!allowedKategori.includes(kategori)) {
    return bad(res, 400, "Kategori tidak valid.");
  }

  // ---- 4. INSERT VIA SERVICE ROLE (bypass RLS, hanya server yg bisa) ----
  const url = process.env.SUPABASE_URL || process.env.SUP_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url || !serviceKey) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset di Vercel");
    return bad(res, 500, "Konfigurasi server belum lengkap.");
  }

  const authHeaders = {
    "Content-Type": "application/json",
    "apikey": serviceKey,
    "Authorization": `Bearer ${serviceKey}`
  };

  // ---- 5. RATE LIMIT (per visitor_id, bukan per-IP — VPN/jaringan
  // beda tetap bisa dibatasi selama browser/ID lokalnya sama) ----
  if (visitorId && typeof visitorId === "string") {
    try {
      const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60000).toISOString();
      const countRes = await fetch(
        `${url}/rest/v1/aspirasi?visitor_id=eq.${encodeURIComponent(visitorId)}&created_at=gte.${encodeURIComponent(since)}&select=id`,
        { headers: { ...authHeaders, "Prefer": "count=exact", "Range": "0-0" } }
      );
      const range = countRes.headers.get("content-range"); // format: "0-0/N"
      const total = range ? parseInt(range.split("/")[1], 10) : 0;
      if (total >= RATE_LIMIT_MAX) {
        return bad(res, 429, "Kamu sudah mengirim beberapa aspirasi baru-baru ini. Coba lagi beberapa menit lagi.");
      }
    } catch (e) {
      console.error("Rate limit check gagal (dilewati):", e);
      // gagal cek rate limit bukan alasan untuk block total; lanjutkan saja
    }
  }

  try {
    const r = await fetch(`${url}/rest/v1/rpc/kirim_aspirasi`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        p_kategori: kategori.trim(),
        p_jenjang: jenjang.trim(),
        p_kelas: kelas.trim(),
        p_pesan: pesan.trim(),
        p_solusi: solusi.trim(),
        p_nama: (nama || "").trim(),
        p_kontak: (kontak || "").trim(),
        p_visitor_id: visitorId || null
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error("Supabase RPC error:", r.status, errText);
      return bad(res, 502, "Gagal menyimpan aspirasi. Coba lagi sebentar lagi.");
    }

    const code = await r.json(); // function mengembalikan text -> JSON string
    return res.status(200).json({ code });
  } catch (e) {
    console.error(e);
    return bad(res, 500, "Terjadi kesalahan server.");
  }
}
