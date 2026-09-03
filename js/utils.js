// ====================================================================
//  utils.js — Fungsi bantu murni (tidak menyentuh DOM / state global)
// ====================================================================

/**
 * Escape karakter HTML berbahaya agar aman disisipkan ke innerHTML.
 * @param {*} s Nilai apa pun, akan dikonversi ke string.
 * @returns {string} String yang sudah di-escape.
 */
export function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Format angka ke format ribuan Indonesia. Nilai 0/null/undefined -> '—'.
 * @param {number|null|undefined} n
 * @returns {string}
 */
export function fmt(n) {
    return (n == null || n === 0) ? '—' : n.toLocaleString('id-ID');
}

/**
 * Konversi nilai apa pun menjadi angka. Mendukung string dengan koma ribuan.
 * @param {*} v
 * @returns {number} 0 jika tidak bisa di-parse.
 */
export function num(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
}

/**
 * Konversi nilai apa pun menjadi string yang sudah di-trim.
 * @param {*} v
 * @returns {string}
 */
export function str(v) {
    return v == null ? '' : String(v).trim();
}

/**
 * Padding angka menjadi 2 digit (mis. 5 -> "05").
 * @param {number} n
 * @returns {string}
 */
export function pad2(n) {
    return String(n).padStart(2, '0');
}

/**
 * Format objek Date menjadi "DD/MM/YYYY".
 * @param {Date} d
 * @returns {string} String kosong jika d bukan Date valid.
 */
export function formatDate(d) {
    if (!(d instanceof Date) || isNaN(d)) return '';
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
}

/**
 * Bangun kunci angka untuk pengurutan tanggal (YYYYMMDD), dengan fallback
 * membaca pola tanggal dari nama sheet jika dateStr tidak mengandung tanggal.
 * @param {string} dateStr
 * @param {string} sheet
 * @returns {number}
 */
export function dateSortKey(dateStr, sheet) {
    const m = String(dateStr).match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
    if (m) {
        const y = m[3] ? parseInt(m[3]) : 2026;
        return y * 10000 + parseInt(m[2]) * 100 + parseInt(m[1]);
    }
    const s = String(sheet).match(/(\d{1,2})-(\d{1,2})/);
    if (s) return 2026 * 10000 + parseInt(s[2]) * 100 + parseInt(s[1]);
    return 0;
}

/**
 * Parse berbagai format tanggal penjualan (Date, "DD/MM/YYYY", "DD-MM-YY", dll)
 * menjadi objek Date.
 * @param {*} s
 * @returns {Date|null}
 */
export function parseSalesDate(s) {
    if (!s) return null;
    if (s instanceof Date && !isNaN(s)) return s;
    const str = String(s).trim();
    let m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
        let d = parseInt(m[1], 10),
            mo = parseInt(m[2], 10) - 1,
            y = parseInt(m[3], 10);
        if (y < 100) y += 2000;
        const dt = new Date(y, mo, d);
        return isNaN(dt) ? null : dt;
    }
    const dt = new Date(str);
    return isNaN(dt) ? null : dt;
}

/**
 * Tambah n hari ke tanggal d (tanpa mengubah d).
 * @param {Date} d
 * @param {number} n
 * @returns {Date}
 */
export function addDays(d, n) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
}

/**
 * Hitung selisih hari (b - a) dalam satuan hari penuh, berbasis UTC agar
 * tidak terpengaruh perubahan DST.
 * @param {Date} a
 * @param {Date} b
 * @returns {number}
 */
export function daysBetween(a, b) {
    const ms = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
        Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    return Math.floor(ms / 86400000);
}

/**
 * Format tanggal untuk tampilan ID, mengembalikan '—' jika tidak valid.
 * @param {Date} d
 * @returns {string}
 */
export function fmtDateID(d) {
    if (!d || isNaN(d)) return '—';
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
}

/** Urutan nama bulan (index 0 = Januari) dipakai di seluruh aplikasi. */
export const MONTH_ORDER = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober',
    'November', 'Desember', 'Lainnya'
];

/**
 * Ambil nama bulan (Indonesia) dari objek Date.
 * @param {Date} d
 * @returns {string}
 */
export function monthNameFromDate(d) {
    if (!d || isNaN(d)) return 'Lainnya';
    return MONTH_ORDER[d.getMonth()] || 'Lainnya';
}

/**
 * Nama bulan kalender saat ini (dipakai sebagai bulan default aplikasi).
 * @returns {string}
 */
export function currentMonthName() {
    return MONTH_ORDER[new Date().getMonth()] || 'Lainnya';
}

/**
 * Tentukan bulan yang sebaiknya dipilih otomatis: bulan kalender saat ini
 * jika tersedia di data, jika tidak gunakan bulan terbaru dari data.
 * @param {string[]} months
 * @returns {string|null}
 */
export function preferredMonth(months) {
    const list = Array.isArray(months) ? months.filter(Boolean) : [];
    const now = currentMonthName();
    if (list.includes(now)) return now;
    const ordered = [...new Set(list)].sort((a, b) => MONTH_ORDER.indexOf(a) - MONTH_ORDER.indexOf(b));
    return ordered.length ? ordered[ordered.length - 1] : null;
}

/**
 * Deteksi nama bulan dari nama sheet dan/atau label tanggal.
 * @param {string} sheetName
 * @param {string} dateLabel
 * @returns {string|null}
 */
export function detectMonth(sheetName, dateLabel) {
    const src = (dateLabel + ' ' + sheetName).toUpperCase();
    let m = src.match(/\/(\d{1,2})\/(\d{4})/);
    if (m) return MONTH_ORDER[parseInt(m[1], 10) - 1] || null;
    m = src.match(/(\d{1,2})-(\d{2})/);
    if (m) return MONTH_ORDER[parseInt(m[2], 10) - 1] || null;
    for (const [k, v] of Object.entries(MONTH_ORDER)) {
        if (src.includes(k) && k.length > 2) return v;
    }
    return null;
}

/**
 * Render badge status HTML untuk baris Uang Masuk.
 * @param {string} s
 * @returns {string} HTML badge.
 */
export function statusBadge(s) {
    if (s === 'LUNAS') return '<span class="badge badge-lunas">LUNAS</span>';
    if (s === 'TITIP') return '<span class="badge badge-titip">TITIP</span>';
    if (s === 'TF') return '<span class="badge badge-tf">TF</span>';
    if (s === 'RETUR') return '<span class="badge badge-retur">RETUR</span>';
    return '<span class="muted">' + esc(s) + '</span>';
}

/**
 * Render badge section (PIUTANG / DROPPING).
 * @param {string} s
 * @returns {string} HTML badge.
 */
export function sectionBadge(s) {
    return '<span class="badge badge-section">' + (s === 'PIUTANG TEMPO' ? 'PIUTANG' : 'DROPPING') + '</span>';
}

/**
 * Render badge status untuk tab Cek Data (Lunas/Overdue/Titip/Belum Jatuh Tempo).
 * @param {object|string} rOrSt Baris cek atau string status langsung.
 * @returns {string} HTML badge.
 */
export function statusBadgeCek(rOrSt) {
    const st = (rOrSt && typeof rOrSt === 'object') ? rOrSt.statusCek : rOrSt;
    const umur = (rOrSt && typeof rOrSt === 'object') ? (rOrSt.umurOverdue || 0) : 0;
    const overdue = !!(rOrSt && typeof rOrSt === 'object' && rOrSt.isOverdue);
    if (st === 'Lunas') return '<span class="badge badge-lunas">LUNAS</span>';
    if (st === 'Overdue') return '<span class="badge badge-retur">OVERDUE ' + umur + ' hr</span>';
    if (st === 'Titip') return '<span class="badge badge-titip">TITIP</span>' + (overdue ? ' <span class="badge badge-retur">OVERDUE ' + umur + ' hr</span>' : '');
    if (st === 'Belum Jatuh Tempo') return '<span class="badge badge-tf">BELUM JT</span>';
    return '<span class="badge badge-section">' + esc(st || '') + '</span>';
}

/**
 * Normalisasi teks pencarian: lowercase, hilangkan diakritik & pemisah,
 * rapikan spasi ganda.
 * @param {*} v
 * @returns {string}
 */
export function normalizeSearchText(v) {
    return String(v == null ? '' : v)
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[\/\\,;|:_\-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Cocokkan query multi-kata terhadap kumpulan field secara fleksibel:
 * setiap kata pada query harus ditemukan di SALAH SATU field (bisa beda
 * field untuk tiap kata), sehingga "RAJU KARANGSAMBUNG" bisa cocok walau
 * "RAJU" ada di kolom SALES dan "KARANGSAMBUNG" ada di kolom ALAMAT.
 * @param {string} query
 * @param {Array<*>} fields
 * @returns {boolean}
 */
export function flexibleSearchMatch(query, fields) {
    const q = normalizeSearchText(query);
    if (!q) return true;
    const fieldValues = (fields || [])
        .filter(v => v != null && String(v).trim() !== '')
        .map(v => normalizeSearchText(v));
    const tokens = q.split(' ').filter(Boolean);
    return tokens.every(token =>
        fieldValues.some(field => field.includes(token))
    );
}

/**
 * Normalisasi teks untuk pencocokan fuzzy di tab Cek Data (huruf kecil,
 * hanya alfanumerik).
 * @param {*} v
 * @returns {string}
 */
export function normCekText(v) {
    return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/**
 * Bandingkan dua teks apakah "mirip" (sama persis atau salah satu substring
 * dari yang lain) setelah dinormalisasi.
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
export function cekTextSimilar(a, b) {
    a = normCekText(a);
    b = normCekText(b);
    if (!a || !b) return false;
    return a === b || a.includes(b) || b.includes(a);
}


/**
 * Ambil snapshot pembayaran terakhir dari agregat Data Uang Masuk.
 * Di aplikasi ini field `tagihan` berarti tagihan/sisa TERAKHIR, bukan nilai
 * faktur awal. Fungsi ini menjadi satu sumber logika untuk Cek Data.
 * @param {object|null} u Agregat Uang Masuk per faktur.
 * @param {number} [fallback=0] Nominal fallback bila tidak ada tagihan UM.
 * @returns {{tagihan:number,pembayaran:number,status:string,tanggal:string,referenceAmount:number}}
 */
export function latestPaymentSnapshot(u, fallback = 0) {
    const x = u || {};
    const tagihan = Number(x.latestTagihan) || Number(x.tagihanUM) || 0;
    const pembayaran = Number(x.latestPaidAmount) || 0;
    const referenceAmount = tagihan || Number(fallback) || 0;
    return {
        tagihan,
        pembayaran,
        status: String(x.latestStatus || ''),
        tanggal: String(x.latestDateLabel || ''),
        referenceAmount
    };
}

/**
 * Nominal yang dipakai fuzzy matching pembayaran. Prioritasnya selalu
 * tagihan terakhir Uang Masuk, sesuai aturan bisnis aplikasi.
 */
export function cekPaymentReferenceAmount(u, fallback = 0) {
    return latestPaymentSnapshot(u, fallback).referenceAmount;
}

/**
 * Skor kecocokan nominal pembayaran vs tagihan (0-7) untuk fuzzy matching
 * di tab Cek Data. Dipakai bersama oleh tabel Cek Data Tempo maupun
 * rekonsiliasi Uang Masuk, supaya keduanya selalu sepakat. Skor bertingkat:
 * - 7 = nominal sama persis (toleransi Rp1)
 * - 5 = pembayaran cicilan wajar (45%-99% dari tagihan)
 * - 4 = mendekati sama (selisih kecil, dalam toleransi ~3%)
 * - 0 = tidak ada kecocokan nominal yang meyakinkan
 * @param {number} paid Jumlah yang dibayar.
 * @param {number} nominal Nominal tagihan.
 * @returns {number} 0, 4, 5, atau 7.
 */
export function cekAmountScore(paid, nominal) {
    paid = Number(paid) || 0;
    nominal = Number(nominal) || 0;
    if (!paid || !nominal) return 0;
    const diff = Math.abs(paid - nominal);
    if (diff <= 1) return 7;
    if (paid < nominal && paid >= nominal * 0.45) return 5;
    if (diff <= Math.max(1000, nominal * 0.03)) return 4;
    return 0;
}

/**
 * Jarak edit Levenshtein antara dua string (jumlah minimum operasi
 * sisip/hapus/ganti 1 karakter untuk mengubah a menjadi b). Dipakai oleh
 * cekFakturSimilarity supaya typo "digit kurang/lebih" (bukan cuma digit
 * tertukar di posisi yang sama) tetap terdeteksi mirip.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshteinDistance(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = new Array(n + 1);
    let curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(
                prev[j] + 1, // hapus
                curr[j - 1] + 1, // sisip
                prev[j - 1] + cost // ganti
            );
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

/**
 * Skor kemiripan dua No.Faktur (0-8), dipakai sebagai penguat kecil saat
 * fuzzy matching. Pakai jarak edit Levenshtein (bukan cuma perbandingan
 * posisi-per-posisi) supaya typo umum seperti digit tertukar, digit
 * kurang, atau digit kelebihan (mis. "011003260800396" vs
 * "01100360800396", beda 1 digit hilang) tetap dianggap mirip -- bukan
 * langsung dianggap "tidak ada kecocokan" hanya karena panjangnya beda.
 * Dipakai bersama oleh tabel Cek Data Tempo & rekonsiliasi Uang Masuk.
 * @param {*} a
 * @param {*} b
 * @returns {number} 0, 1, 3, atau 8.
 */
export function cekFakturSimilarity(a, b) {
    a = String(a || '').replace(/\D/g, '');
    b = String(b || '').replace(/\D/g, '');
    if (!a || !b) return 0;
    if (a === b) return 8;
    // Jangan terapkan toleransi typo ke nomor pendek (< 4 digit) -- terlalu
    // rawan collision (banyak nomor pendek yang beda transaksi tapi kebetulan mirip).
    if (Math.min(a.length, b.length) < 4) return 0;
    const dist = levenshteinDistance(a, b);
    if (dist <= 1) return 3; // typo 1 digit: tertukar, kurang, atau lebih
    if (dist <= 2) return 1; // typo 2 digit
    return 0;
}

/**
 * Pecah token kata dari teks yang sudah dinormalisasi lewat normCekText.
 * Dipakai untuk membangun index pencarian fuzzy (lihat cekTextSimilar).
 * @param {*} v
 * @returns {string[]}
 */
export function normCekTokens(v) {
    const n = normCekText(v);
    return n ? n.split(' ').filter(Boolean) : [];
}

/**
 * Serahkan kendali sebentar ke browser (event loop) supaya proses yang
 * berat tidak membuat UI freeze. Dipakai oleh chunkedFilter dan proses
 * berat lain yang jalan per-chunk (mis. fuzzy matching Cek Data Tempo).
 * @returns {Promise<void>}
 */
export function yieldToMain() {
    return new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => resolve());
        } else {
            setTimeout(resolve, 0);
        }
    });
}

/**
 * Filter array besar tanpa memblokir UI: proses per-chunk, lalu kasih
 * jeda ke browser (yieldToMain) di antara chunk.
 * @param {Array<*>} arr
 * @param {function(*): boolean} predicate
 * @param {number} [chunkSize=300]
 * @returns {Promise<Array<*>>}
 */
export async function chunkedFilter(arr, predicate, chunkSize = 300) {
    const out = [];
    const list = arr || [];
    for (let i = 0; i < list.length; i++) {
        if (predicate(list[i])) out.push(list[i]);
        if ((i + 1) % chunkSize === 0) await yieldToMain();
    }
    return out;
}