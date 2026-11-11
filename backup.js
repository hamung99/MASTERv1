/* backup.js — Backup / Sync semua data (Supabase tabel pj_sync + file cadangan lokal)
   Kontrak dengan index.html:
   - window.LaporanBackup.open()  : tombol "Backup / Sync Semua Data"
   - window.LaporanBackup.last    : {kind:'busy'|'ok'|'empty'|'offline'|'error', msg}
   - event 'laporan-sync-state'   : detail = last
   Data cloud disimpan di pj_sync dengan key 'laporan:meta' dan 'laporan:chunk:N'.
   Fitur Tagihan tetap memakai sinkronisasinya sendiri (key 'tagihan'). */
(function () {
  'use strict';
  var SB_URL = 'https://ipoeexoidflzpghzyxwq.supabase.co';
  var SB_KEY = 'sb_publishable__ZagXSp6UF-S28fxr3ZSzQ_06tojN8z';
  var CODE_K = 'pj_sync_code', SYNCED_K = 'lb_synced', CHUNK = 600000;

  var D_PJ = { db: 'pj-v1', st: 'pj-data' };
  var D_BATAL = { db: 'pjbatal-v1', st: 'pjbatal-data' };
  var D_HARGA = { db: 'pjharga-v1', st: 'pjharga-data' };
  var D_UM = { db: 'pjuangmasuk-v1', st: 'pjuangmasuk-data' };
  var D_TG = { db: 'pjtagihan-v1', st: 'pjtagihan-data' };
  var D_PARSE = { db: 'pj-parse-v1', st: 'c' };
  var CLOUD_DBS = [D_PJ, D_BATAL, D_HARGA, D_UM];
  var FILE_DBS = [D_PJ, D_BATAL, D_HARGA, D_UM, D_TG];

  var busy = false, restoring = false, dirty = false, pushT = null;
  var LB = { last: { kind: 'busy', msg: 'Memeriksa data…' } };
  window.LaporanBackup = LB;

  /* ---------- util ---------- */
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function devId() { var d = lsGet('pj_dev'); if (!d) { d = 'd' + Math.random().toString(36).slice(2, 8); lsSet('pj_dev', d); } return d; }
  function getCode(ask) {
    var c = lsGet(CODE_K);
    if (!c && ask) { c = (prompt('Kode Sync (harus sama di semua perangkat):') || '').trim(); if (c) lsSet(CODE_K, c); }
    return c;
  }
  function setState(kind, msg) {
    LB.last = { kind: kind, msg: msg || '' };
    var el = document.getElementById('lbStatus'); if (el) el.textContent = msg || '';
    try { window.dispatchEvent(new CustomEvent('laporan-sync-state', { detail: LB.last })); } catch (e) {}
  }
  function errMsg(e) {
    var m = String(e && e.message || e);
    if (/^(401|403)/.test(m)) return 'Ditolak server (kode sync salah / akses tabel belum diizinkan)';
    if (/^404/.test(m)) return 'Tabel pj_sync belum ada di Supabase';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Tidak bisa terhubung ke server';
    return 'Gagal: ' + m;
  }

  /* ---------- IndexedDB ---------- */
  function open(def) {
    return new Promise(function (ok, no) {
      var r = indexedDB.open(def.db, 1);
      r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains(def.st)) r.result.createObjectStore(def.st); };
      r.onsuccess = function () { var db = r.result; db.onversionchange = function () { db.close(); }; ok(db); };
      r.onerror = function () { no(r.error); };
    });
  }
  function idbGet(def, key) {
    return open(def).then(function (db) {
      return new Promise(function (ok, no) {
        var q = db.transaction(def.st, 'readonly').objectStore(def.st).get(key || 'latest');
        q.onsuccess = function () { db.close(); ok(q.result); };
        q.onerror = function () { db.close(); no(q.error); };
      });
    });
  }
  function idbPut(def, val) {
    return open(def).then(function (db) {
      return new Promise(function (ok, no) {
        var tx = db.transaction(def.st, 'readwrite');
        tx.objectStore(def.st).put(val, 'latest');
        tx.oncomplete = function () { db.close(); ok(); };
        tx.onerror = tx.onabort = function () { db.close(); no(tx.error); };
      });
    });
  }
  function idbClear(def) {
    return open(def).then(function (db) {
      return new Promise(function (ok) {
        var tx = db.transaction(def.st, 'readwrite'); tx.objectStore(def.st).clear();
        tx.oncomplete = tx.onerror = tx.onabort = function () { db.close(); ok(); };
      });
    });
  }

  /* ---------- serialisasi (ArrayBuffer/Map/Set/Date aman) ---------- */
  function ab2b64(buf) {
    var u = new Uint8Array(buf), s = '';
    for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b642ab(b) {
    var s = atob(b), u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u.buffer;
  }
  function enc(v) {
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof ArrayBuffer) return { __t: 'ab', d: ab2b64(v) };
    if (ArrayBuffer.isView(v)) return { __t: 'view', c: v.constructor.name, d: ab2b64(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)) };
    if (v instanceof Map) return { __t: 'map', d: Array.from(v.entries()).map(function (e) { return [enc(e[0]), enc(e[1])]; }) };
    if (v instanceof Set) return { __t: 'set', d: Array.from(v.values()).map(enc) };
    if (v instanceof Date) return { __t: 'date', d: v.getTime() };
    if (Array.isArray(v)) return v.map(enc);
    var o = {}; Object.keys(v).forEach(function (k) { o[k] = enc(v[k]); }); return o;
  }
  function dec(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(dec);
    if (v.__t === 'ab') return b642ab(v.d);
    if (v.__t === 'view') { var C = window[v.c] || Uint8Array; return new C(b642ab(v.d)); }
    if (v.__t === 'map') return new Map(v.d.map(function (e) { return [dec(e[0]), dec(e[1])]; }));
    if (v.__t === 'set') return new Set(v.d.map(dec));
    if (v.__t === 'date') return new Date(v.d);
    var o = {}; Object.keys(v).forEach(function (k) { o[k] = dec(v[k]); }); return o;
  }

  function collect(defs) {
    var stores = {};
    return Promise.all(defs.map(function (d) {
      return idbGet(d).then(function (v) { if (v !== undefined) stores[d.db] = enc(v); });
    })).then(function () { return { v: 1, at: Date.now(), device: devId(), stores: stores }; });
  }
  function restore(payload) {
    if (!payload || !payload.stores) return Promise.reject(new Error('Format backup tidak dikenali'));
    restoring = true;
    var all = FILE_DBS;
    return Promise.all(all.map(function (d) {
      return payload.stores[d.db] !== undefined ? idbPut(d, dec(payload.stores[d.db])) : Promise.resolve();
    })).then(function () { return idbClear(D_PARSE); })   // cache hasil baca Excel dibuat ulang otomatis
      .then(function () { lsSet(SYNCED_K, '1'); });
  }
  function hasLocal() {
    return idbGet(D_PJ).then(function (v) { return !!(v && v.files && v.files.length); }).catch(function () { return false; });
  }

  /* ---------- Supabase ---------- */
  function hdr(code, extra) {
    var h = { apikey: SB_KEY, 'x-pj-code': code, 'Content-Type': 'application/json' };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }
  function sb(path, code, opt) {
    opt = opt || {}; opt.headers = hdr(code, opt.headers);
    return fetch(SB_URL + '/rest/v1/' + path, opt).then(function (r) {
      if (!r.ok) throw new Error(r.status + '');
      return r;
    });
  }
  function getMeta(code) {
    return sb('pj_sync?key=eq.' + encodeURIComponent('laporan:meta') + '&select=data,updated_at', code)
      .then(function (r) { return r.json(); }).then(function (rows) { return rows[0] ? rows[0].data : null; });
  }
  function cloudPush(manual) {
    if (busy) return Promise.resolve(false);
    var code = getCode(manual);
    if (!code) { setState('empty', 'Kode sync belum diisi'); return Promise.resolve(false); }
    if (!navigator.onLine) { setState('offline', 'Offline — akan dikirim saat online'); dirty = true; return Promise.resolve(false); }
    busy = true; setState('busy', 'Mengumpulkan data…');
    return hasLocal().then(function (has) {
      if (!has) { busy = false; setState('empty', 'Belum ada data penjualan di perangkat ini, tidak ada yang dikirim'); return false; }
      return collect(CLOUD_DBS).then(function (payload) {
        var json = JSON.stringify(payload), n = Math.max(1, Math.ceil(json.length / CHUNK)), p = Promise.resolve();
        var now = new Date().toISOString(), dev = devId();
        var files = (idbFilesCount(payload));
        for (var i = 0; i < n; i++) (function (i) {
          p = p.then(function () {
            setState('busy', 'Mengirim ke cloud… ' + (i + 1) + '/' + n);
            return sb('pj_sync?on_conflict=key', code, {
              method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
              body: JSON.stringify({ key: 'laporan:chunk:' + i, data: { s: json.slice(i * CHUNK, (i + 1) * CHUNK) }, updated_at: now, device: dev })
            });
          });
        })(i);
        return p.then(function () {
          return sb('pj_sync?on_conflict=key', code, {
            method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({ key: 'laporan:meta', data: { n: n, size: json.length, at: payload.at, files: files, device: dev }, updated_at: now, device: dev })
          });
        }).then(function () {
          lsSet(SYNCED_K, '1'); dirty = false; busy = false;
          var d = new Date(); setState('ok', '☁️ Terkirim ' + files + ' file • ' + pad(d.getHours()) + ':' + pad(d.getMinutes()));
          return true;
        });
      });
    }).catch(function (e) { busy = false; console.warn('Backup gagal:', e); setState('error', errMsg(e)); return false; });
  }
  function idbFilesCount(payload) {
    try { var s = payload.stores[D_PJ.db]; return s && s.files ? s.files.length : 0; } catch (e) { return 0; }
  }
  function pad(n) { return String(n).padStart(2, '0'); }

  /* ambil dari cloud; auto=true → tanpa konfirmasi/prompt */
  function cloudPull(auto) {
    if (busy) return Promise.resolve(false);
    var code = getCode(!auto);
    if (!code) { setState('empty', 'Kode sync belum diisi'); return Promise.resolve(false); }
    if (!navigator.onLine) { setState('offline', 'Offline — tidak bisa mengambil data server'); return Promise.resolve(false); }
    busy = true; setState('busy', 'Mengambil data server…');
    return getMeta(code).then(function (meta) {
      if (!meta || !meta.n) { busy = false; setState('empty', 'Belum ada backup di cloud'); if (!auto) alert('Belum ada backup di cloud dengan kode sync ini.'); return false; }
      if (!auto && !confirm('Data di perangkat ini akan DIGANTI dengan backup cloud (' + (meta.files || '?') + ' file Excel). Lanjutkan?')) { busy = false; setState('ok', 'Dibatalkan'); return false; }
      var parts = [], p = Promise.resolve();
      for (var i = 0; i < meta.n; i++) (function (i) {
        p = p.then(function () {
          setState('busy', 'Mengambil data server… ' + (i + 1) + '/' + meta.n);
          return sb('pj_sync?key=eq.' + encodeURIComponent('laporan:chunk:' + i) + '&select=data', code)
            .then(function (r) { return r.json(); })
            .then(function (rows) { if (!rows[0] || typeof rows[0].data.s !== 'string') throw new Error('Potongan data ' + i + ' hilang'); parts[i] = rows[0].data.s; });
        });
      })(i);
      return p.then(function () {
        return restore(JSON.parse(parts.join('')));
      }).then(function () {
        setState('busy', 'Data diterima, memuat ulang…');
        setTimeout(function () { location.reload(); }, 300);
        return true;
      });
    }).catch(function (e) { busy = false; restoring = false; console.warn('Ambil data gagal:', e); setState('error', errMsg(e)); return false; });
  }

  /* ---------- file cadangan lokal ---------- */
  function exportFile() {
    setState('busy', 'Menyiapkan file backup…');
    return collect(FILE_DBS).then(function (payload) {
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      var a = document.createElement('a'), d = new Date();
      a.href = URL.createObjectURL(blob);
      a.download = 'backup-laporan-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      setState('ok', '💾 File backup diunduh');
    }).catch(function (e) { setState('error', errMsg(e)); });
  }
  function importFile(file) {
    if (!file) return;
    if (!confirm('Data di perangkat ini akan DIGANTI dengan isi file "' + file.name + '". Lanjutkan?')) return;
    setState('busy', 'Membaca file backup…');
    var fr = new FileReader();
    fr.onload = function () {
      try { restore(JSON.parse(fr.result)).then(function () { setState('busy', 'Selesai, memuat ulang…'); setTimeout(function () { location.reload(); }, 300); })
        .catch(function (e) { restoring = false; setState('error', errMsg(e)); }); }
      catch (e) { setState('error', 'File bukan backup yang valid'); }
    };
    fr.onerror = function () { setState('error', 'File tidak bisa dibaca'); };
    fr.readAsText(file);
  }

  /* ---------- tampilan ---------- */
  function ui() {
    var ov = document.getElementById('lbOverlay');
    if (ov) return ov;
    ov = document.createElement('div'); ov.id = 'lbOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;padding:12px';
    var btn = 'display:block;width:100%;margin:.35rem 0;padding:.55rem .7rem;border:1px solid var(--border,#ccc);border-radius:8px;background:var(--card,#fff);color:var(--text,#222);font:600 .9rem system-ui,sans-serif;cursor:pointer;text-align:left';
    ov.innerHTML =
      '<div style="width:100%;max-width:420px;max-height:92vh;overflow:auto;background:var(--card,#fff);color:var(--text,#222);border:1px solid var(--border,#ccc);border-radius:12px;padding:1rem 1.1rem;font-family:system-ui,sans-serif">' +
      '<h3 style="margin:0 0 .3rem;font-size:1.05rem">☁️ Backup / Sync Semua Data</h3>' +
      '<p style="margin:0 0 .6rem;font-size:.8rem;opacity:.75">Mencakup file Excel penjualan, pembatalan faktur, harga beli, dan uang masuk. Tagihan tersinkron otomatis terpisah.</p>' +
      '<div id="lbStatus" style="font-size:.85rem;font-weight:600;padding:.45rem .6rem;border-radius:8px;background:rgba(128,128,128,.15);margin-bottom:.5rem"></div>' +
      '<button type="button" id="lbPush" style="' + btn + '">⬆️ Kirim ke Cloud</button>' +
      '<button type="button" id="lbPull" style="' + btn + '">⬇️ Ambil dari Cloud (ganti data perangkat)</button>' +
      '<button type="button" id="lbExp" style="' + btn + '">💾 Unduh File Backup</button>' +
      '<button type="button" id="lbImp" style="' + btn + '">📥 Pulihkan dari File Backup</button>' +
      '<button type="button" id="lbCode" style="' + btn + '">🔑 Ubah Kode Sync</button>' +
      '<input type="file" id="lbFile" accept=".json,application/json" style="display:none">' +
      '<button type="button" id="lbClose" style="' + btn + ';text-align:center;margin-top:.6rem">Tutup</button></div>';
    document.body.appendChild(ov);
    var $ = function (id) { return document.getElementById(id); };
    $('lbPush').onclick = function () { cloudPush(true); };
    $('lbPull').onclick = function () { cloudPull(false); };
    $('lbExp').onclick = exportFile;
    $('lbImp').onclick = function () { $('lbFile').click(); };
    $('lbFile').onchange = function () { importFile(this.files[0]); this.value = ''; };
    $('lbCode').onclick = function () {
      var c = prompt('Kode Sync (harus sama di semua perangkat):', lsGet(CODE_K));
      if (c !== null) { lsSet(CODE_K, c.trim()); setState('ok', c.trim() ? 'Kode sync disimpan' : 'Kode sync dikosongkan'); }
    };
    $('lbClose').onclick = LB.close;
    ov.addEventListener('click', function (e) { if (e.target === ov) LB.close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') LB.close(); });
    return ov;
  }
  LB.open = function () {
    var ov = ui(); ov.style.display = 'flex';
    var dd = document.getElementById('dropdown'); if (dd) dd.classList.remove('open', 'show', 'active');
    document.getElementById('lbStatus').textContent = LB.last.msg || (getCode(false) ? 'Siap' : 'Kode sync belum diisi');
  };
  LB.close = function () { var ov = document.getElementById('lbOverlay'); if (ov) ov.style.display = 'none'; };
  LB.push = function () { return cloudPush(true); };
  LB.pull = function () { return cloudPull(false); };
  LB.exportFile = exportFile; LB.importFile = importFile;

  /* ---------- otomatis ---------- */
  function schedulePush() {
    if (restoring || !getCode(false)) return;
    dirty = true; clearTimeout(pushT);
    pushT = setTimeout(function () { if (dirty && !restoring) cloudPush(false); }, 8000);
  }
  try { new BroadcastChannel('laporan-data').onmessage = schedulePush; } catch (e) {}
  window.addEventListener('online', function () { if (dirty) schedulePush(); });

  function init() {
    hasLocal().then(function (has) {
      var code = getCode(false);
      if (has) {
        setState('ok', 'Data ada di perangkat ini');
        if (code && navigator.onLine) {
          getMeta(code).then(function (m) { if (!m) cloudPush(false); }).catch(function () {});   // belum ada backup di cloud → kirim
        }
        return;
      }
      /* perangkat/alamat baru dan masih kosong → ambil dari cloud bila perangkat ini belum pernah sinkron */
      if (lsGet(SYNCED_K)) { setState('empty', 'Belum ada data di perangkat ini'); return; }
      if (!navigator.onLine) { setState('offline', 'Offline'); return; }
      if (code) { cloudPull(true); return; }
      setState('empty', 'Kode sync belum diisi');
      var tries = 0, iv = setInterval(function () {      // kode bisa diisi lewat prompt Tagihan
        if (++tries > 40 || restoring) { clearInterval(iv); return; }
        if (getCode(false)) { clearInterval(iv); cloudPull(true); }
      }, 3000);
    }).catch(function (e) { setState('error', errMsg(e)); });
  }
  init();
})();
