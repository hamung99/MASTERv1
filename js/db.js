// ====================================================================
//  db.js — Lapisan akses IndexedDB (penyimpanan lokal data aplikasi)
// ====================================================================

/** Nama database IndexedDB. */
export const DB_NAME = 'uangMasukDB';
/** Versi skema database. */
export const DB_VERSION = 1;
/** Nama object store tunggal yang dipakai untuk semua kunci data. */
export const DB_STORE = 'rows';

/** Kunci penyimpanan untuk masing-masing kumpulan data. */
export const DB_KEY = 'allRows';
export const DB_KEY_SALES = 'salesRows';
export const DB_KEY_RAPIKAN = 'rapikanCleanRows';
export const DB_KEY_HARGA_BELI = 'rapikanPriceRows';

/** @type {IDBDatabase|null} Instance database yang di-cache setelah dibuka pertama kali. */
let dbInstance = null;

/**
 * Buka (atau buat) koneksi IndexedDB, membuat object store jika belum ada.
 * Hasilnya di-cache di memori agar panggilan berikutnya instan.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
    return new Promise((resolve, reject) => {
        if (dbInstance) return resolve(dbInstance);
        if (!('indexedDB' in window)) return reject(new Error('IndexedDB not supported'));
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(DB_STORE)) {
                db.createObjectStore(DB_STORE);
            }
        };
        req.onsuccess = () => {
            dbInstance = req.result;
            resolve(dbInstance);
        };
        req.onerror = () => reject(req.error);
    });
}

/**
 * Simpan array baris ke IndexedDB dengan kunci tertentu.
 * @param {Array<object>} rows
 * @param {string} key Salah satu dari DB_KEY / DB_KEY_SALES / DB_KEY_RAPIKAN / DB_KEY_HARGA_BELI.
 * @param {() => void} [onSaved] Callback opsional dipanggil setelah selesai
 *   (berhasil maupun gagal) — misalnya untuk memicu sinkronisasi cloud.
 *   Modul ini sengaja tidak mengimpor cloudSync.js secara langsung agar
 *   tidak ada dependensi melingkar; pemanggil yang menentukan efek sampingnya.
 * @returns {Promise<void>}
 */
export async function saveRowsToDB(rows, key, onSaved) {
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(DB_STORE, 'readwrite');
            tx.objectStore(DB_STORE).put(rows, key);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.warn('Save to IndexedDB failed', err);
    }
    if (typeof onSaved === 'function') onSaved();
}

/**
 * Muat array baris dari IndexedDB berdasarkan kunci.
 * @param {string} key
 * @returns {Promise<Array<object>>} Array kosong jika tidak ada data / gagal.
 */
export async function loadRowsFromDB(key) {
    try {
        const db = await openDB();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(DB_STORE, 'readonly');
            const req = tx.objectStore(DB_STORE).get(key);
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        console.warn('Load from IndexedDB failed', err);
        return [];
    }
}