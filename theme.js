/* theme.js — tema terang/gelap. Dipanggil di <head>, jadi tema terpasang sebelum halaman tampil. */
(function () {
  var K = 'pj_theme', root = document.documentElement;
  function get() { try { return localStorage.getItem(K) || ''; } catch (e) { return ''; } }
  function set(v) { try { localStorage.setItem(K, v); } catch (e) {} }
  function sys() { return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  function apply(t) {
    if (t === 'dark') root.setAttribute('data-theme', 'dark'); else root.removeAttribute('data-theme');
    var b = document.getElementById('themeBtn');
    if (b) { b.textContent = t === 'dark' ? '☀️' : '🌙'; b.title = t === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap'; }
  }
  var cur = get() || sys();
  apply(cur);

  function addBtn() {
    if (document.getElementById('themeBtn') || !document.body) return;
    var b = document.createElement('button');
    b.id = 'themeBtn'; b.type = 'button';
    b.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9998;width:38px;height:38px;border-radius:50%;' +
      'border:1px solid rgba(128,128,128,.45);background:var(--card,#fff);color:var(--text,#222);font-size:18px;' +
      'line-height:1;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2);padding:0';
    b.addEventListener('click', function () {
      cur = (root.getAttribute('data-theme') === 'dark') ? 'light' : 'dark';
      set(cur); apply(cur);
    });
    document.body.appendChild(b);
    apply(cur);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addBtn); else addBtn();
  window.addEventListener('storage', function (e) { if (e.key === K && e.newValue) { cur = e.newValue; apply(cur); } });
  window.PJTheme = { set: function (t) { cur = t; set(t); apply(t); }, get: function () { return cur; } };
})();
