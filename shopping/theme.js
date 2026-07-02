/* =========================================================================
 * theme.js — テーマ（ライト/ダーク）を最速で適用する
 * <head> 内で app.js より先に読み込み、描画前に <html data-theme> を決めて
 * 起動時のチラつき（白フラッシュ）を防ぐ。
 *  - 設定は okaimono.settings の theme（'auto' | 'light' | 'dark'）
 *  - 'auto' は端末の設定（prefers-color-scheme）に追従する
 * ========================================================================= */
(function () {
  'use strict';

  // ステータスバー等の色（<meta name="theme-color">）をテーマに合わせる
  var THEME_COLORS = { light: '#ffb6c8', dark: '#4a2f3d' };

  function readPref() {
    try {
      var s = JSON.parse(localStorage.getItem('okaimono.settings') || '{}');
      return (s.theme === 'light' || s.theme === 'dark') ? s.theme : 'auto';
    } catch (e) {
      return 'auto';
    }
  }

  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var pref = readPref();

  function effective(p) {
    if (p === 'light' || p === 'dark') return p;
    return (mq && mq.matches) ? 'dark' : 'light';
  }

  function apply() {
    var t = effective(pref);
    document.documentElement.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLORS[t]);
  }

  apply();

  // 「おまかせ」中は、端末のライト/ダーク切り替えに即追従する
  if (mq) {
    var onChange = function () { if (pref === 'auto') apply(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  // 設定タブから切り替えるとき app.js が呼ぶ
  window.okaimonoTheme = {
    get: function () { return pref; },
    set: function (p) {
      pref = (p === 'light' || p === 'dark') ? p : 'auto';
      apply();
    }
  };
})();
