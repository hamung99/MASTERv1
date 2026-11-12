/* backup.js — Sinkron otomatis antar perangkat (Supabase) + backup ke file.
   Tabel Supabase: laporan_sync  (lihat setup-supabase.sql). Kode sync dikirim lewat header x-laporan-code.
   Kontrak dengan index.html:
   - window.LaporanBackup.open()  : tombol Menu → "Backup / Sync Data"
   - window.LaporanBackup.last    : {kind:'busy'|'ok'|'empty'|'offline'|'error', msg}
   - event 'laporan-sync-state'   : detail = last (dipakai layar "Belum Ada Data")
   Cara kerja: file Excel dipecah & dikirim satu per satu (hanya yang baru), data kecil (batal/harga/uang masuk/tagihan)
   dikirim sebagai satu paket. Ada nomor revisi (rev) agar satu perangkat tidak menimpa data yang lebih baru. */
(function () {
  'use strict';
  var SB_URL = 'https://ipoeexoidflzpghzyxwq.supabase.co';
  var SB_KEY = 'sb_publishable__ZagXSp6UF-S28fxr3ZSzQ_06tojN8z';
  var TBL = 'laporan_sync', HDR = 'x-laporan-code';
  var DEFAULT_CODE = 'jlEjatp5HujcLXl3RruNSqa6cfqE';   // kode otomatis: tidak perlu diketik di perangkat (harus sama dengan di setup-supabase.sql)
  var K_CODE = 'lb_code', K_REV = 'lb_rev', K_SIG = 'lb_sig', K_DEV = 'lb_dev', CH = 600000;

  var D_PJ = { db: 'pj-v1', st: 'pj-data' };
  var OTHERS = [
    { db: 'pjbatal-v1', st: 'pjbatal-data' },
    { db: 'pjharga-v1', st: 'pjharga-data' },
    { db: 'pjuangmasuk-v1', st: 'pjuangmasuk-data' },
    { db: 'pjtagihan-v1', st: 'pjtagihan-data' }];
  var D_PARSE = { db: 'pj-parse-v1', st: 'c' };

  var busy = false, restoring = false, pushT = null, unsynced = false, warnT = null;
  var LB = { last: { kind: 'busy', msg: 'Memeriksa data…' } };
  window.LaporanBackup = LB;

  /* ---------- util ---------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function devId() { var d = lsGet(K_DEV); if (!d) { d = 'd' + Math.random().toString(36).slice(2, 8); lsSet(K_DEV, d); } return d; }
  function getCode(ask) {
    var c = lsGet(K_CODE) || DEFAULT_CODE;
    if (!c && ask) { c = (prompt('Kode Sync (sama di semua perangkat):') || '').trim(); if (c) lsSet(K_CODE, c); }
    return c;
  }
  function setState(kind, msg) {
    LB.last = { kind: kind, msg: msg || '' };
    var el = document.getElementById('lbStatus'); if (el) el.textContent = msg || '';
    try { window.dispatchEvent(new CustomEvent('laporan-sync-state', { detail: LB.last })); } catch (e) {}
  }
  function errMsg(e) {
    var m = String(e && e.message || e);
    if (/^(401|403)/.test(m)) return 'Ditolak server: kode sync salah (atau policy belum dipasang)';
    if (/^404/.test(m)) return 'Tabel laporan_sync belum ada di Supabase (jalankan setup-supabase.sql)';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Tidak bisa terhubung ke server';
    return 'Gagal: ' + m;
  }
  function hhmm() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  /* ---------- IndexedDB (store dibuat persis seperti index.html) ---------- */
  function open(def) {
    return new Promise(function (ok, no) {
      var r = indexedDB.open(def.db, 1);
      r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains(def.st)) r.result.createObjectStore(def.st); };
      r.onsuccess = function () { var db = r.result; db.onversionchange = function () { db.close(); }; ok(db); };
      r.onerror = function () { no(r.error); };
    });
  }
  function idbGet(def) {
    return open(def).then(function (db) {
      return new Promise(function (ok, no) {
        var q = db.transaction(def.st, 'readonly').objectStore(def.st).get('latest');
        q.onsuccess = function () { db.close(); ok(q.result); };
        q.onerror = function () { db.close(); no(q.error); };
      });
    });
  }
  function idbPut(def, val) {
    return open(def).then(function (db) {
      return new Promise(function (ok, no) {
        var tx = db.transaction(def.st, 'readwrite'); tx.objectStore(def.st).put(val, 'latest');
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

  /* ---------- serialisasi ---------- */
  function ab2b64(buf) {
    var u = new Uint8Array(buf), s = '';
    for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b642ab(b) { var s = atob(b), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; }
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
  function fid(buf) {      // sidik jari isi file (2 hash 32-bit + panjang)
    var u = new Uint8Array(buf), h1 = 0x811c9dc5, h2 = 5381;
    for (var i = 0; i < u.length; i++) { h1 ^= u[i]; h1 = Math.imul(h1, 16777619); h2 = (Math.imul(h2, 33) + u[i]) | 0; }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + '-' + u.length.toString(36);
  }
  function hashStr(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + '-' + s.length.toString(36); }

  /* ---------- baca data lokal ---------- */
  function readFiles() {
    return idbGet(D_PJ).then(function (v) {
      var out = [];
      ((v && v.files) || []).forEach(function (f) {
        var buf = null;
        if (f.buf instanceof ArrayBuffer) buf = f.buf;
        else if (f.buf && ArrayBuffer.isView(f.buf)) buf = f.buf.buffer.slice(f.buf.byteOffset, f.buf.byteOffset + f.buf.byteLength);
        else if (typeof f.b64 === 'string') buf = b642ab(f.b64);
        if (buf) out.push({ name: f.name, buf: buf });
      });
      return out;
    }).catch(function () { return []; });
  }
  function readOtherJson() {
    var o = {};
    return Promise.all(OTHERS.map(function (d) { return idbGet(d).then(function (v) { if (v !== undefined) o[d.db] = enc(v); }); }))
      .then(function () { return JSON.stringify(o); });
  }
  function localSig() {
    return Promise.all([readFiles(), readOtherJson()]).then(function (a) {
      var s = a[0].map(function (f) { return f.name + '|' + fid(f.buf); }).join(';') + '#' + a[1];
      return { sig: hashStr(s), files: a[0], other: a[1] };
    });
  }

  /* ---------- Supabase ---------- */
  function sb(path, code, opt) {
    opt = opt || {};
    var h = { apikey: SB_KEY, 'Content-Type': 'application/json' };
    Object.keys(opt.headers || {}).forEach(function (k) { h[k] = opt.headers[k]; });
    h[HDR] = code; opt.headers = h;
    return fetch(SB_URL + '/rest/v1/' + path, opt).then(function (r) { if (!r.ok) throw new Error(r.status + ''); return r; });
  }
  function getRow(code, key) {
    return sb(TBL + '?key=eq.' + encodeURIComponent(key) + '&select=data', code)
      .then(function (r) { return r.json(); }).then(function (rows) { return rows[0] ? rows[0].data : null; });
  }
  function putRow(code, key, data) {
    return sb(TBL + '?on_conflict=key', code, {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key: key, data: data, updated_at: new Date().toISOString(), device: devId() })
    });
  }
  function putChunks(code, prefix, str, label) {
    var n = Math.max(1, Math.ceil(str.length / CH)), p = Promise.resolve();
    for (var i = 0; i < n; i++) (function (i) {
      p = p.then(function () { if (label) setState('busy', label + ' ' + (i + 1) + '/' + n); return putRow(code, prefix + i, { s: str.slice(i * CH, (i + 1) * CH) }); });
    })(i);
    return p.then(function () { return n; });
  }
  function getChunks(code, prefix, n, label) {
    var parts = [], p = Promise.resolve();
    for (var i = 0; i < n; i++) (function (i) {
      p = p.then(function () {
        if (label) setState('busy', label + ' ' + (i + 1) + '/' + n);
        return getRow(code, prefix + i).then(function (d) { if (!d || typeof d.s !== 'string') throw new Error('Potongan data hilang di server'); parts[i] = d.s; });
      });
    })(i);
    return p.then(function () { return parts.join(''); });
  }

  /* ---------- KIRIM ---------- */
  function push(manual) {
    if (busy || restoring) return Promise.resolve(false);
    var code = getCode(manual);
    if (!code) { setState('empty', 'Kode sync belum diisi'); return Promise.resolve(false); }
    if (!navigator.onLine) { setState('offline', 'Offline — akan dikirim saat online'); if (unsynced) showWarn('Offline — data belum tersimpan ke server.'); return Promise.resolve(false); }
    busy = true; setState('busy', 'Menyiapkan data…');
    return localSig().then(function (L) {
      if (!L.files.length) { busy = false; setState('empty', 'Belum ada file penjualan di perangkat ini, tidak ada yang dikirim'); return false; }
      return getRow(code, 'laporan:meta').then(function (meta) {
        var cr = meta ? (meta.rev || 0) : 0, lr = +lsGet(K_REV) || 0;
        if (cr > lr) {
          if (!manual) { busy = false; setState('error', 'Server berisi data lebih baru (dari perangkat lain). Buka Menu → Backup / Sync untuk memilih.'); showBar('Data di server lebih baru', 'Pilih…', LB.open); return false; }
          if (!confirm('Server berisi data yang LEBIH BARU dari perangkat lain.\nTimpa dengan data di perangkat ini?')) { busy = false; setState('ok', 'Dibatalkan'); return false; }
        }
        var have = {}; ((meta && meta.files) || []).forEach(function (f) { have[f.id] = 1; });
        var files = [], ups = [];
        L.files.forEach(function (f) {
          var id = fid(f.buf), n = Math.max(1, Math.ceil(Math.ceil(f.buf.byteLength / 3) * 4 / CH));
          files.push({ name: f.name, id: id, n: n });
          if (!have[id] && !ups.some(function (u) { return u.id === id; })) ups.push({ id: id, buf: f.buf, name: f.name });
        });
        var p = Promise.resolve();
        ups.forEach(function (u, k) {
          p = p.then(function () { return putChunks(code, 'laporan:file:' + u.id + ':', ab2b64(u.buf), 'Mengirim file ' + (k + 1) + '/' + ups.length + ' —'); });
        });
        return p.then(function () { return putChunks(code, 'laporan:other:', L.other, 'Mengirim data lain'); })
          .then(function (otherN) {
            var rev = Math.max(cr, lr) + 1;
            return putRow(code, 'laporan:meta', { rev: rev, at: Date.now(), device: devId(), files: files, other_n: otherN }).then(function () {
              lsSet(K_REV, String(rev)); lsSet(K_SIG, L.sig); hideBar(); unsynced = false; hideWarn(); busy = false;
              setState('ok', '☁️ Tersinkron ' + hhmm() + ' • ' + files.length + ' file');
              return true;
            });
          });
      });
    }).catch(function (e) { busy = false; console.warn('Kirim gagal:', e); setState('error', errMsg(e)); if (unsynced) showWarn('Data belum tersimpan ke server. ' + errMsg(e)); return false; });
  }

  /* ---------- AMBIL ---------- */
  function pull(auto) {
    if (busy || restoring) return Promise.resolve(false);
    var code = getCode(!auto);
    if (!code) { setState('empty', 'Kode sync belum diisi'); return Promise.resolve(false); }
    if (!navigator.onLine) { setState('offline', 'Offline — tidak bisa mengambil data server'); return Promise.resolve(false); }
    busy = true; setState('busy', 'Mengambil data server…');
    return getRow(code, 'laporan:meta').then(function (meta) {
      if (!meta || !meta.files) { busy = false; setState('empty', 'Belum ada data di server'); if (!auto) alert('Belum ada data di server dengan kode sync ini.'); return false; }
      if (!auto && !confirm('Data di perangkat ini akan DIGANTI dengan data server (' + meta.files.length + ' file Excel). Lanjutkan?')) { busy = false; setState('ok', 'Dibatalkan'); return false; }
      return readFiles().then(function (local) {
        var byId = {}; local.forEach(function (f) { byId[fid(f.buf)] = f.buf; });
        var out = [], p = Promise.resolve();
        meta.files.forEach(function (mf, idx) {
          p = p.then(function () {
            if (byId[mf.id]) { out[idx] = { name: mf.name, buf: byId[mf.id] }; return; }
            return getChunks(code, 'laporan:file:' + mf.id + ':', mf.n, 'Mengambil file ' + (idx + 1) + '/' + meta.files.length + ' —')
              .then(function (b64) { out[idx] = { name: mf.name, buf: b642ab(b64) }; });
          });
        });
        return p.then(function () { return getChunks(code, 'laporan:other:', meta.other_n || 0, 'Mengambil data lain'); })
          .then(function (json) {
            restoring = true;
            var obj = json ? JSON.parse(json) : {};
            return idbPut(D_PJ, { files: out })
              .then(function () { return Promise.all(OTHERS.map(function (d) { return obj[d.db] !== undefined ? idbPut(d, dec(obj[d.db])) : Promise.resolve(); })); })
              .then(function () { return idbClear(D_PARSE); })
              .then(function () { return localSig(); })
              .then(function (L) { lsSet(K_REV, String(meta.rev || 0)); lsSet(K_SIG, L.sig); unsynced = false; hideWarn(); setState('busy', 'Data diterima, memuat ulang…'); setTimeout(function () { location.reload(); }, 300); return true; });
          });
      });
    }).catch(function (e) { busy = false; restoring = false; console.warn('Ambil gagal:', e); setState('error', errMsg(e)); return false; });
  }

  /* ---------- file backup ---------- */
  function exportFile() {
    setState('busy', 'Menyiapkan file backup…');
    return Promise.all([readFiles(), readOtherJson()]).then(function (a) {
      var payload = { v: 2, at: Date.now(), files: a[0].map(function (f) { return { name: f.name, b64: ab2b64(f.buf) }; }), other: JSON.parse(a[1]) };
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      var el = document.createElement('a'), d = new Date();
      el.href = URL.createObjectURL(blob);
      el.download = 'backup-laporan-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json';
      document.body.appendChild(el); el.click(); el.remove();
      setTimeout(function () { URL.revokeObjectURL(el.href); }, 5000);
      setState('ok', '💾 File backup diunduh');
    }).catch(function (e) { setState('error', errMsg(e)); });
  }
  function importFile(file) {
    if (!file) return;
    if (!confirm('Data di perangkat ini akan DIGANTI dengan isi file "' + file.name + '". Lanjutkan?')) return;
    setState('busy', 'Membaca file backup…');
    var fr = new FileReader();
    fr.onerror = function () { setState('error', 'File tidak bisa dibaca'); };
    fr.onload = function () {
      var p;
      try { p = JSON.parse(fr.result); } catch (e) { setState('error', 'File bukan backup yang valid'); return; }
      var other = p && (p.other || null), files = p && p.files;
      if (p && p.stores && !other) {   // format backup versi sebelumnya
        other = {}; OTHERS.forEach(function (d) { if (p.stores[d.db] !== undefined) other[d.db] = p.stores[d.db]; });
        var pj = p.stores[D_PJ.db]; files = pj && pj.files ? pj.files.map(function (f) { return { name: f.name, b64: f.buf && f.buf.__t === 'ab' ? f.buf.d : f.b64 }; }) : [];
      }
      if (!files || !other) { setState('error', 'File bukan backup yang valid'); return; }
      restoring = true;
      idbPut(D_PJ, { files: files.filter(function (f) { return typeof f.b64 === 'string'; }).map(function (f) { return { name: f.name, buf: b642ab(f.b64) }; }) })
        .then(function () { return Promise.all(OTHERS.map(function (d) { return other[d.db] !== undefined ? idbPut(d, dec(other[d.db])) : Promise.resolve(); })); })
        .then(function () { return idbClear(D_PARSE); })
        .then(function () { setState('busy', 'Selesai, memuat ulang…'); setTimeout(function () { location.reload(); }, 300); })
        .catch(function (e) { restoring = false; setState('error', errMsg(e)); });
    };
    fr.readAsText(file);
  }

  /* ---------- tampilan ---------- */
  function hideWarn() { clearTimeout(warnT); var b = document.getElementById('lbWarn'); if (b) b.style.display = 'none'; }
  function showWarn(msg) {
    var b = document.getElementById('lbWarn');
    if (!b) {
      b = document.createElement('div'); b.id = 'lbWarn';
      b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:10002;display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;justify-content:center;max-width:calc(100vw - 20px);padding:.55rem .85rem;border-radius:10px;background:#e65100;color:#fff;font:600 .85rem system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3)';
      b.innerHTML = '<span id="lbWarnMsg"></span><button type="button" id="lbWarnBtn" style="border:0;border-radius:6px;padding:.35rem .7rem;font-weight:700;cursor:pointer;background:#fff;color:#bf360c">☁️ Backup / Sync Data Sekarang</button>';
      document.body.appendChild(b);
      document.getElementById('lbWarnBtn').onclick = function () {
        var bt = this; bt.disabled = true; bt.textContent = 'Mengirim…';
        var reset = function () { bt.disabled = false; bt.textContent = '☁️ Backup / Sync Data Sekarang'; };
        push(true).then(reset, reset);
      };
    }
    document.getElementById('lbWarnMsg').textContent = '⚠ ' + msg;
    b.style.display = 'flex';
  }
  function hideBar() { var b = document.getElementById('lbBar'); if (b) b.style.display = 'none'; }
  function showBar(msg, label, fn) {
    var b = document.getElementById('lbBar');
    if (!b) {
      b = document.createElement('div'); b.id = 'lbBar';
      b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:10px;z-index:10001;display:flex;gap:.6rem;align-items:center;padding:.5rem .8rem;border-radius:10px;background:#1b5e20;color:#fff;font:600 .85rem system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3)';
      b.innerHTML = '<span id="lbBarMsg"></span><button type="button" id="lbBarBtn" style="border:0;border-radius:6px;padding:.3rem .6rem;font-weight:700;cursor:pointer"></button>';
      document.body.appendChild(b);
    }
    document.getElementById('lbBarMsg').textContent = msg;
    var bt = document.getElementById('lbBarBtn'); bt.textContent = label; bt.onclick = function () { hideBar(); fn(); };
    b.style.display = 'flex';
  }
  function ui() {
    var ov = document.getElementById('lbOverlay'); if (ov) return ov;
    ov = document.createElement('div'); ov.id = 'lbOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;padding:12px';
    var btn = 'display:block;width:100%;margin:.35rem 0;padding:.55rem .7rem;border:1px solid var(--border,#ccc);border-radius:8px;background:var(--card,#fff);color:var(--text,#222);font:600 .9rem system-ui,sans-serif;cursor:pointer;text-align:left';
    ov.innerHTML =
      '<div style="width:100%;max-width:430px;max-height:92vh;overflow:auto;background:var(--card,#fff);color:var(--text,#222);border:1px solid var(--border,#ccc);border-radius:12px;padding:1rem 1.1rem;font-family:system-ui,sans-serif">' +
      '<h3 style="margin:0 0 .3rem;font-size:1.05rem">☁️ Backup / Sync Data</h3>' +
      '<p style="margin:0 0 .6rem;font-size:.8rem;opacity:.75">Sinkron otomatis aktif bila kode sync sudah diisi (sama di semua perangkat). Mencakup file Excel, pembatalan faktur, harga beli, uang masuk, dan tagihan.</p>' +
      '<div id="lbStatus" style="font-size:.85rem;font-weight:600;padding:.45rem .6rem;border-radius:8px;background:rgba(128,128,128,.15);margin-bottom:.5rem"></div>' +
      '<button type="button" id="lbCode" style="' + btn + '">🔑 Isi / Ubah Kode Sync</button>' +
      '<button type="button" id="lbPush" style="' + btn + '">⬆️ Kirim ke Server sekarang</button>' +
      '<button type="button" id="lbPull" style="' + btn + '">⬇️ Ambil dari Server (ganti data perangkat)</button>' +
      '<button type="button" id="lbExp" style="' + btn + '">💾 Unduh File Backup</button>' +
      '<button type="button" id="lbImp" style="' + btn + '">📥 Pulihkan dari File Backup</button>' +
      '<input type="file" id="lbFile" accept=".json,application/json" style="display:none">' +
      '<button type="button" id="lbClose" style="' + btn + ';text-align:center;margin-top:.6rem">Tutup</button></div>';
    document.body.appendChild(ov);
    var $ = function (id) { return document.getElementById(id); };
    $('lbCode').onclick = function () {
      var c = prompt('Kode Sync (sama di semua perangkat):', lsGet(K_CODE));
      if (c === null) return;
      lsSet(K_CODE, c.trim());
      if (c.trim()) { setState('ok', 'Kode tersimpan, memeriksa server…'); startup(); } else setState('empty', 'Kode sync dikosongkan');
    };
    $('lbPush').onclick = function () { push(true); };
    $('lbPull').onclick = function () { pull(false); };
    $('lbExp').onclick = exportFile;
    $('lbImp').onclick = function () { $('lbFile').click(); };
    $('lbFile').onchange = function () { importFile(this.files[0]); this.value = ''; };
    $('lbClose').onclick = LB.close;
    ov.addEventListener('click', function (e) { if (e.target === ov) LB.close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') LB.close(); });
    return ov;
  }
  LB.open = function () {
    ui().style.display = 'flex';
    var dd = document.getElementById('dropdown'); if (dd) dd.classList.remove('open', 'show', 'active');
    var s = document.getElementById('lbStatus'); if (s) s.textContent = LB.last.msg || (getCode(false) ? 'Siap' : 'Kode sync belum diisi');
  };
  LB.close = function () { var ov = document.getElementById('lbOverlay'); if (ov) ov.style.display = 'none'; };
  LB.push = function () { return push(true); }; LB.pull = function () { return pull(false); };
  LB.exportFile = exportFile; LB.importFile = importFile;

  /* ---------- otomatis ---------- */
  function schedulePush() {
    if (restoring || !getCode(false)) return;
    clearTimeout(pushT);
    pushT = setTimeout(function () {
      localSig().then(function (L) { if (L.sig !== lsGet(K_SIG) && L.files.length) push(false); });
    }, 6000);
  }
  try {
    new BroadcastChannel('laporan-data').onmessage = function () {
      unsynced = true;                                   // ada perubahan yang belum sampai ke server
      clearTimeout(warnT);
      warnT = setTimeout(function () {                   // bila 20 detik belum tersinkron → munculkan peringatan
        if (unsynced && !restoring && !busy) showWarn('Data belum tersimpan ke server.');
      }, 20000);
      schedulePush();
    };
  } catch (e) {}

  function startup() {
    if (busy || restoring) return;
    localSig().then(function (L) {
      var code = getCode(false), has = L.files.length > 0, dirty = L.sig !== lsGet(K_SIG);
      if (has && dirty) unsynced = true;
      if (!code) {
        setState(has ? 'ok' : 'empty', has ? 'Data ada di perangkat. Sync server belum aktif — isi kode sync.' : 'Mengambil data dari server…');
        if (!has) setTimeout(LB.open, 400);
        return;
      }
      if (!navigator.onLine) { setState(has ? 'ok' : 'offline', has ? 'Offline — memakai data di perangkat' : 'Offline'); return; }
      return getRow(code, 'laporan:meta').then(function (meta) {
        var cr = meta ? (meta.rev || 0) : 0, lr = +lsGet(K_REV) || 0;
        if (!meta) { if (has) return push(false); setState('empty', 'Belum ada data di server'); return; }
        if (cr > lr) {
          if (!has || !dirty) return pull(true);                                    // server lebih baru, perangkat tidak punya perubahan sendiri
          setState('error', 'Perangkat ini dan server sama-sama berisi data berbeda. Pilih: Kirim atau Ambil.');
          setTimeout(LB.open, 400); return;
        }
        if (!has) { setState('empty', 'Belum ada data di perangkat. Pakai "Ambil dari Server" bila ingin memulihkan.'); return; }
        if (dirty) return push(false);
        setState('ok', '☁️ Tersinkron');
      });
    }).catch(function (e) { setState('error', errMsg(e)); });
  }
  function poll() {          // cek berkala: ada data baru dari perangkat lain?
    if (busy || restoring || document.hidden || !navigator.onLine) return;
    var code = getCode(false); if (!code) return;
    localSig().then(function (L) {
      if (L.sig !== lsGet(K_SIG)) { if (L.files.length) { unsynced = true; schedulePush(); } return; }
      unsynced = false; hideWarn();
      return getRow(code, 'laporan:meta').then(function (meta) {
        if (meta && (meta.rev || 0) > (+lsGet(K_REV) || 0)) showBar('Ada data baru dari perangkat lain', 'Ambil sekarang', function () { pull(true); });
      });
    }).catch(function () {});
  }
  window.addEventListener('online', function () { setTimeout(poll, 500); });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { setTimeout(poll, 500); return; }
    if (unsynced && !busy && !restoring && navigator.onLine) push(false);   // tab ditinggalkan: kirim sekarang
  });
  window.addEventListener('offline', function () { if (unsynced) showWarn('Offline — data belum tersimpan ke server.'); });
  window.addEventListener('beforeunload', function (e) {                   // tutup/refresh saat belum tersimpan → browser minta konfirmasi
    if (unsynced && !restoring) { e.preventDefault(); e.returnValue = ''; return ''; }
  });
  setInterval(poll, 60000);
  startup();
})();
