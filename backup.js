/* backup.js — Backup / Pulihkan data ke FILE (tanpa server, tanpa Supabase).
   Kontrak dengan index.html:
   - window.LaporanBackup.open()  : tombol Menu → "Backup / Pulihkan Data"
   - window.LaporanBackup.last    : {kind:'busy'|'ok'|'empty'|'error', msg}
   - event 'laporan-sync-state'   : detail = last (dipakai layar "Belum Ada Data") */
(function () {
  'use strict';
  var D_PJ = { db: 'pj-v1', st: 'pj-data' };
  var ALL = [D_PJ,
    { db: 'pjbatal-v1', st: 'pjbatal-data' },
    { db: 'pjharga-v1', st: 'pjharga-data' },
    { db: 'pjuangmasuk-v1', st: 'pjuangmasuk-data' },
    { db: 'pjtagihan-v1', st: 'pjtagihan-data' }];
  var D_PARSE = { db: 'pj-parse-v1', st: 'c' };
  var LB = { last: { kind: 'busy', msg: 'Memeriksa data…' } };
  window.LaporanBackup = LB;

  function pad(n) { return String(n).padStart(2, '0'); }
  function setState(kind, msg) {
    LB.last = { kind: kind, msg: msg || '' };
    var el = document.getElementById('lbStatus'); if (el) el.textContent = msg || '';
    try { window.dispatchEvent(new CustomEvent('laporan-sync-state', { detail: LB.last })); } catch (e) {}
  }

  /* ---- IndexedDB (store dibuat sama persis dengan index.html) ---- */
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

  /* ---- serialisasi (ArrayBuffer / Map / Set / Date aman) ---- */
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

  function hasLocal() {
    return idbGet(D_PJ).then(function (v) { return !!(v && v.files && v.files.length); }).catch(function () { return false; });
  }

  /* ---- unduh / pulihkan file ---- */
  function exportFile() {
    setState('busy', 'Menyiapkan file backup…');
    var stores = {};
    return Promise.all(ALL.map(function (d) {
      return idbGet(d).then(function (v) { if (v !== undefined) stores[d.db] = enc(v); });
    })).then(function () {
      var blob = new Blob([JSON.stringify({ v: 1, at: Date.now(), stores: stores })], { type: 'application/json' });
      var a = document.createElement('a'), d = new Date();
      a.href = URL.createObjectURL(blob);
      a.download = 'backup-laporan-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      setState('ok', '💾 File backup diunduh');
    }).catch(function (e) { setState('error', 'Gagal: ' + (e && e.message || e)); });
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
      if (!p || !p.stores) { setState('error', 'File bukan backup yang valid'); return; }
      Promise.all(ALL.map(function (d) { return p.stores[d.db] !== undefined ? idbPut(d, dec(p.stores[d.db])) : Promise.resolve(); }))
        .then(function () { return idbClear(D_PARSE); })      // cache hasil baca Excel dibuat ulang otomatis
        .then(function () { setState('busy', 'Selesai, memuat ulang…'); setTimeout(function () { location.reload(); }, 300); })
        .catch(function (e) { setState('error', 'Gagal: ' + (e && e.message || e)); });
    };
    fr.readAsText(file);
  }

  /* ---- tampilan ---- */
  function ui() {
    var ov = document.getElementById('lbOverlay'); if (ov) return ov;
    ov = document.createElement('div'); ov.id = 'lbOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;padding:12px';
    var btn = 'display:block;width:100%;margin:.35rem 0;padding:.55rem .7rem;border:1px solid var(--border,#ccc);border-radius:8px;background:var(--card,#fff);color:var(--text,#222);font:600 .9rem system-ui,sans-serif;cursor:pointer;text-align:left';
    ov.innerHTML =
      '<div style="width:100%;max-width:420px;max-height:92vh;overflow:auto;background:var(--card,#fff);color:var(--text,#222);border:1px solid var(--border,#ccc);border-radius:12px;padding:1rem 1.1rem;font-family:system-ui,sans-serif">' +
      '<h3 style="margin:0 0 .3rem;font-size:1.05rem">💾 Backup / Pulihkan Data</h3>' +
      '<p style="margin:0 0 .6rem;font-size:.8rem;opacity:.75">Data tersimpan di browser perangkat ini. Unduh file backup secara berkala, lalu pulihkan di perangkat lain atau setelah data browser terhapus.</p>' +
      '<div id="lbStatus" style="font-size:.85rem;font-weight:600;padding:.45rem .6rem;border-radius:8px;background:rgba(128,128,128,.15);margin-bottom:.5rem"></div>' +
      '<button type="button" id="lbExp" style="' + btn + '">💾 Unduh File Backup</button>' +
      '<button type="button" id="lbImp" style="' + btn + '">📥 Pulihkan dari File Backup</button>' +
      '<input type="file" id="lbFile" accept=".json,application/json" style="display:none">' +
      '<button type="button" id="lbClose" style="' + btn + ';text-align:center;margin-top:.6rem">Tutup</button></div>';
    document.body.appendChild(ov);
    var $ = function (id) { return document.getElementById(id); };
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
    var s = document.getElementById('lbStatus'); if (s) s.textContent = LB.last.msg || '';
  };
  LB.close = function () { var ov = document.getElementById('lbOverlay'); if (ov) ov.style.display = 'none'; };
  LB.exportFile = exportFile; LB.importFile = importFile;

  hasLocal().then(function (has) {
    setState(has ? 'ok' : 'empty', has ? 'Data ada di perangkat ini' : 'Belum ada data di perangkat ini');
  });
})();
