/* =========================================================================
 * stores.js — おかいものメモ Phase 3（お店検索・効率ルート）
 *  - ブラウザ Geolocation で現在地取得（許可制・オンライン時のみ）
 *  - OpenStreetMap の Overpass API で近隣スーパー等を検索（無料・キー不要）
 *  - Leaflet + OSMタイルで地図表示（CDNから遅延ロード／失敗時は一覧のみ）
 *  - 複数店の「効率よく回る順番」を最近傍法で提案
 * オフラインのコア機能とは独立。地図やAPIはオンライン時のみの拡張。
 * ========================================================================= */
(function () {
  'use strict';

  var KEY = 'okaimono.stores';
  var OVERPASS = 'https://overpass-api.de/api/interpreter';
  var LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  var LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  var RADIUS = 1500; // m

  /* ---------- 保存（自前の最小localStorage） ---------- */
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(stores)); } catch (e) {}
  }

  var stores = load();           // 保存したお店 [{id,name,lat,lon,type}]
  var currentPos = null;         // {lat,lon}（この起動中のみ）
  var lastResults = [];          // 直近の検索結果
  var selected = {};             // ルートに含める保存店 id → true
  stores.forEach(function (s) { selected[s.id] = true; });

  /* ---------- DOM ---------- */
  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function toast(msg) { if (window.okaimonoToast) window.okaimonoToast(msg); }

  var findBtn, statusBox, mapWrap, resultsBox, savedWrap, savedBox, routeBtn, routeArea, routeList, inStoreRoute;

  /* ---------- 距離（ハバーサイン, m） ---------- */
  function distance(a, b) {
    var R = 6371000, toRad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toRad, dLon = (b.lon - a.lon) * toRad;
    var la1 = a.lat * toRad, la2 = b.lat * toRad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function fmtDist(m) {
    return m < 1000 ? Math.round(m) + 'm' : (m / 1000).toFixed(m < 10000 ? 1 : 0) + 'km';
  }

  /* ---------- 状態表示 ---------- */
  function setStatus(msg, kind) {
    if (!statusBox) return;
    if (!msg) { statusBox.hidden = true; return; }
    statusBox.hidden = false;
    statusBox.textContent = msg;
    statusBox.className = 'store-status' + (kind ? ' is-' + kind : '');
  }

  /* ---------- 現在地 ---------- */
  function getLocation() {
    return new Promise(function (resolve, reject) {
      if (!('geolocation' in navigator)) { reject(new Error('no-geo')); return; }
      navigator.geolocation.getCurrentPosition(
        function (pos) { resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }); },
        function (err) { reject(err); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });
  }

  /* ---------- Leaflet 遅延ロード ---------- */
  var leafletPromise = null;
  function ensureLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function (resolve, reject) {
      if (!document.querySelector('link[data-leaflet]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = LEAFLET_CSS; link.setAttribute('data-leaflet', '1');
        document.head.appendChild(link);
      }
      var s = document.createElement('script');
      s.src = LEAFLET_JS; s.async = true;
      var to = setTimeout(function () { reject(new Error('leaflet-timeout')); }, 8000);
      s.onload = function () { clearTimeout(to); resolve(window.L); };
      s.onerror = function () { clearTimeout(to); reject(new Error('leaflet-error')); };
      document.head.appendChild(s);
    });
    return leafletPromise;
  }

  /* ---------- 地図 ---------- */
  var map = null, markerLayer = null, routeLayer = null;
  function showMap(pos, results) {
    return ensureLeaflet().then(function (L) {
      mapWrap.hidden = false;
      if (!map) {
        map = L.map('map', { zoomControl: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap contributors'
        }).addTo(map);
        markerLayer = L.layerGroup().addTo(map);
        routeLayer = L.layerGroup().addTo(map);
      }
      map.setView([pos.lat, pos.lon], 15);
      markerLayer.clearLayers();
      L.circleMarker([pos.lat, pos.lon], {
        radius: 8, color: '#ff8fac', fillColor: '#ff8fac', fillOpacity: 0.9
      }).bindPopup('現在地').addTo(markerLayer);
      (results || []).forEach(function (r) {
        L.marker([r.lat, r.lon]).bindPopup(r.name).addTo(markerLayer);
      });
      setTimeout(function () { map.invalidateSize(); }, 100);
      return true;
    });
  }

  /* ---------- Overpass 検索 ---------- */
  function buildQuery(pos) {
    return '[out:json][timeout:20];(' +
      'nwr["shop"="supermarket"](around:' + RADIUS + ',' + pos.lat + ',' + pos.lon + ');' +
      'nwr["shop"="convenience"](around:' + RADIUS + ',' + pos.lat + ',' + pos.lon + ');' +
      'nwr["shop"="drugstore"](around:' + RADIUS + ',' + pos.lat + ',' + pos.lon + ');' +
      'nwr["shop"="chemist"](around:' + RADIUS + ',' + pos.lat + ',' + pos.lon + ');' +
      ');out center 50;';
  }
  var TYPE_LABEL = {
    supermarket: 'スーパー', convenience: 'コンビニ',
    drugstore: 'ドラッグストア', chemist: 'ドラッグストア'
  };
  function parseElements(json, pos) {
    var out = [];
    (json.elements || []).forEach(function (e) {
      var lat = e.lat != null ? e.lat : (e.center && e.center.lat);
      var lon = e.lon != null ? e.lon : (e.center && e.center.lon);
      if (lat == null || lon == null) return;
      var tags = e.tags || {};
      out.push({
        id: (e.type || 'n') + e.id,
        name: tags.name || tags.brand || 'お店',
        type: tags.shop || 'shop',
        lat: lat, lon: lon,
        dist: distance(pos, { lat: lat, lon: lon })
      });
    });
    // 同名・近接の重複をざっくり除去しつつ距離順
    out.sort(function (a, b) { return a.dist - b.dist; });
    var seen = {}, dedup = [];
    out.forEach(function (r) {
      var k = r.name + '@' + r.lat.toFixed(4) + ',' + r.lon.toFixed(4);
      if (!seen[k]) { seen[k] = true; dedup.push(r); }
    });
    return dedup.slice(0, 30);
  }

  function searchNearby(pos) {
    return fetch(OVERPASS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(buildQuery(pos))
    }).then(function (res) {
      if (!res.ok) throw new Error('overpass-' + res.status);
      return res.json();
    }).then(function (json) { return parseElements(json, pos); });
  }

  /* ---------- 検索ボタン ---------- */
  function onFind() {
    setStatus('現在地を確認しています…');
    resultsBox.innerHTML = '';
    getLocation().then(function (pos) {
      currentPos = pos;
      setStatus('近くのお店を探しています…');
      // 地図は出せたら出す（失敗してもOK）
      showMap(pos, []).catch(function () {
        mapWrap.hidden = true;
        toast('地図は表示できませんでした（オフライン？）一覧で表示します');
      });
      return searchNearby(pos);
    }).then(function (results) {
      lastResults = results;
      if (!results.length) {
        setStatus('近くにお店が見つかりませんでした。', 'warn');
      } else {
        setStatus(results.length + '件 見つかりました（近い順）', 'ok');
        if (map) showMap(currentPos, results).catch(function () {});
      }
      renderResults();
    }).catch(function (err) {
      handleError(err);
    });
  }

  function handleError(err) {
    var code = err && err.code;
    if (code === 1) {            // PERMISSION_DENIED
      setStatus('位置情報が許可されていません。ブラウザの設定から許可してね。', 'warn');
    } else if (code === 2 || code === 3) {
      setStatus('現在地を取得できませんでした。電波の良い場所で試してね。', 'warn');
    } else if (err && err.message === 'no-geo') {
      setStatus('この端末は位置情報に対応していません。', 'warn');
    } else {
      setStatus('検索に失敗しました。オンラインのときに試してね。', 'warn');
    }
  }

  /* ---------- 検索結果の描画 ---------- */
  function isSaved(id) { return stores.some(function (s) { return s.id === id; }); }

  function renderResults() {
    resultsBox.innerHTML = '';
    lastResults.forEach(function (r) {
      var card = el('div', 'store-card');
      var body = el('div', 'store-body');
      body.appendChild(el('div', 'store-name', r.name));
      body.appendChild(el('div', 'store-meta',
        (TYPE_LABEL[r.type] || 'お店') + ' · ' + fmtDist(r.dist)));
      card.appendChild(body);

      var focus = el('button', 'store-mini', '📍');
      focus.type = 'button'; focus.title = '地図で見る';
      focus.addEventListener('click', function () {
        if (map) { map.setView([r.lat, r.lon], 17); mapWrap.hidden = false; }
        else toast('地図はオンラインのときに表示できます');
      });
      card.appendChild(focus);

      var saveBtn = el('button', 'store-save' + (isSaved(r.id) ? ' is-saved' : ''));
      saveBtn.type = 'button';
      saveBtn.textContent = isSaved(r.id) ? '保存済み' : '⭐ 保存';
      saveBtn.addEventListener('click', function () { toggleSave(r); });
      card.appendChild(saveBtn);

      resultsBox.appendChild(card);
    });
  }

  function toggleSave(r) {
    if (isSaved(r.id)) {
      stores = stores.filter(function (s) { return s.id !== r.id; });
      delete selected[r.id];
    } else {
      stores.push({ id: r.id, name: r.name, lat: r.lat, lon: r.lon, type: r.type });
      selected[r.id] = true;
      toast('「' + r.name + '」を保存したよ⭐');
    }
    save();
    renderResults();
    renderSaved();
  }

  /* ---------- 保存したお店 ---------- */
  function renderSaved() {
    savedWrap.hidden = stores.length === 0;
    if (!savedBox) return;
    savedBox.innerHTML = '';
    stores.forEach(function (s) {
      var card = el('div', 'store-card');

      var chk = el('input', 'store-check');
      chk.type = 'checkbox';
      chk.checked = selected[s.id] !== false;
      chk.addEventListener('change', function () { selected[s.id] = chk.checked; });
      card.appendChild(chk);

      var body = el('div', 'store-body');
      body.appendChild(el('div', 'store-name', s.name));
      var meta = TYPE_LABEL[s.type] || 'お店';
      if (currentPos) meta += ' · ' + fmtDist(distance(currentPos, s));
      body.appendChild(el('div', 'store-meta', meta));
      card.appendChild(body);

      var del = el('button', 'store-mini', '🗑');
      del.type = 'button'; del.title = '保存から削除';
      del.addEventListener('click', function () {
        stores = stores.filter(function (x) { return x.id !== s.id; });
        delete selected[s.id];
        save(); renderSaved(); renderResults();
      });
      card.appendChild(del);

      savedBox.appendChild(card);
    });
  }

  /* ---------- 効率ルート（最近傍法） ---------- */
  function nearestNeighbor(start, pts) {
    var remaining = pts.slice(), order = [], cur = start, total = 0;
    while (remaining.length) {
      var bi = 0, bd = Infinity;
      for (var i = 0; i < remaining.length; i++) {
        var d = distance(cur, remaining[i]);
        if (d < bd) { bd = d; bi = i; }
      }
      total += bd;
      cur = remaining[bi];
      order.push({ store: cur, leg: bd });
      remaining.splice(bi, 1);
    }
    return { order: order, total: total };
  }

  function onRoute() {
    if (!currentPos) {
      setStatus('先に「近くのお店を探す」で現在地を取得してね。', 'warn');
      return;
    }
    var chosen = stores.filter(function (s) { return selected[s.id] !== false; });
    if (chosen.length < 1) { toast('回るお店にチェックを入れてね'); return; }

    var result = nearestNeighbor(currentPos, chosen);
    routeArea.hidden = false;
    routeList.innerHTML = '';

    var startRow = el('div', 'route-row');
    startRow.appendChild(el('span', 'route-num', '出'));
    startRow.appendChild(el('span', 'route-name', '現在地'));
    routeList.appendChild(startRow);

    result.order.forEach(function (o, i) {
      var row = el('div', 'route-row');
      row.appendChild(el('span', 'route-num', String(i + 1)));
      var b = el('div', 'route-namewrap');
      b.appendChild(el('span', 'route-name', o.store.name));
      b.appendChild(el('span', 'route-leg', '+' + fmtDist(o.leg)));
      row.appendChild(b);
      var focus = el('button', 'store-mini', '📍');
      focus.type = 'button';
      focus.addEventListener('click', function () {
        if (map) { map.setView([o.store.lat, o.store.lon], 17); mapWrap.hidden = false; }
      });
      row.appendChild(focus);
      routeList.appendChild(row);
    });

    var totalRow = el('div', 'route-total', '合計の移動距離（目安）約 ' + fmtDist(result.total));
    routeList.appendChild(totalRow);

    drawRoute(result.order);
    renderInStoreRoute();
    setStatus(chosen.length + '店の回り方を提案しました🧭', 'ok');
  }

  /* ---------- 店内の回り方（売り場順） ---------- */
  function currentListItems() {
    try {
      return JSON.parse(localStorage.getItem('okaimono.items') || '[]')
        .filter(function (it) { return !it.checked; });
    } catch (e) { return []; }
  }

  function renderInStoreRoute() {
    if (!inStoreRoute) return;
    inStoreRoute.innerHTML = '';
    inStoreRoute.appendChild(el('div', 'instore-head', '🏪 店内の回り方（売り場順）'));

    var CAT = window.OKAIMONO_CATEGORIES;
    var items = currentListItems();
    if (!CAT || !items.length) {
      inStoreRoute.appendChild(el('p', 'instore-empty',
        'お買い物リストが空です。リストに入れると、売り場順の回り方が出ます🧺'));
      return;
    }
    // 売り場ごとにまとめ、売り場の並び順にステップ表示
    var groups = {};
    items.forEach(function (it) {
      var key = it.category || (CAT.classify ? CAT.classify(it.name) : 'other');
      (groups[key] = groups[key] || []).push(it);
    });
    var step = 0;
    CAT.list.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (cat) {
      var arr = groups[cat.key];
      if (!arr || !arr.length) return;
      step++;
      var row = el('div', 'instore-row');
      row.appendChild(el('span', 'instore-num', String(step)));
      var body = el('div', 'instore-body');
      body.appendChild(el('span', 'instore-aisle', cat.emoji + ' ' + cat.label));
      body.appendChild(el('span', 'instore-items', arr.map(function (i) { return i.name; }).join('、')));
      row.appendChild(body);
      inStoreRoute.appendChild(row);
    });
  }

  function drawRoute(order) {
    if (!map || !window.L || !routeLayer) return;
    routeLayer.clearLayers();
    var pts = [[currentPos.lat, currentPos.lon]];
    order.forEach(function (o) { pts.push([o.store.lat, o.store.lon]); });
    window.L.polyline(pts, { color: '#6fcfae', weight: 4, opacity: 0.85, dashArray: '6 6' }).addTo(routeLayer);
    order.forEach(function (o, i) {
      window.L.marker([o.store.lat, o.store.lon]).bindPopup((i + 1) + '. ' + o.store.name).addTo(routeLayer);
    });
    try { map.fitBounds(window.L.latLngBounds(pts).pad(0.2)); } catch (e) {}
  }

  /* ---------- 初期化 ---------- */
  function init() {
    findBtn = $('#findStoresBtn');
    statusBox = $('#storeStatus');
    mapWrap = $('#mapWrap');
    resultsBox = $('#storeResults');
    savedWrap = $('#savedWrap');
    savedBox = $('#savedStores');
    routeBtn = $('#routeBtn');
    routeArea = $('#routeArea');
    routeList = $('#routeList');
    inStoreRoute = $('#inStoreRoute');
    if (!findBtn) return;

    findBtn.addEventListener('click', onFind);
    routeBtn.addEventListener('click', onRoute);
    renderSaved();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
