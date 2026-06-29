/* =========================================================================
 * app.js — おかいものメモ Phase 1（コアロジック）
 *  - リストCRUD ＋ localStorage 永続化
 *  - 予測入力（学習辞書 catalog）＋ サジェスト ＋「いつもの」
 *  - 売り場順の並び替え（categories.js）
 *  - 予算・合計金額の概算
 *  - ご褒美演出
 * 依存：categories.js（window.OKAIMONO_CATEGORIES）
 * ========================================================================= */
(function () {
  'use strict';

  var CAT = window.OKAIMONO_CATEGORIES;

  /* ---------- localStorage キー ---------- */
  var KEYS = {
    items:    'okaimono.items',
    catalog:  'okaimono.catalog',
    staples:  'okaimono.staples',
    budget:   'okaimono.budget',
    settings: 'okaimono.settings'
  };

  /* ---------- 状態 ---------- */
  var state = {
    items:    load(KEYS.items, []),
    catalog:  load(KEYS.catalog, []),
    staples:  load(KEYS.staples, []),
    budget:   load(KEYS.budget, { amount: 0 }),
    settings: load(KEYS.settings, { sortByAisle: true, showBudget: true })
  };

  // 初回起動なら「いつもの」のおすすめを少しだけ用意（消してもOK）。
  if (state.staples.length === 0 && state.items.length === 0 && state.catalog.length === 0) {
    state.staples = ['牛乳', 'たまご', '食パン', 'お米', 'トイレットペーパー', 'キャベツ'];
    save(KEYS.staples, state.staples);
  }

  /* ---------- ストレージ ---------- */
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 容量超過など */ }
  }
  function persist() {
    save(KEYS.items, state.items);
    save(KEYS.catalog, state.catalog);
    save(KEYS.staples, state.staples);
    save(KEYS.budget, state.budget);
    save(KEYS.settings, state.settings);
  }

  /* ---------- DOM ヘルパ ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* =====================================================================
   * 予測学習（catalog）
   * ===================================================================== */
  function catalogEntry(name) {
    var n = name.trim();
    for (var i = 0; i < state.catalog.length; i++) {
      if (state.catalog[i].name === n) return state.catalog[i];
    }
    return null;
  }

  // 商品を追加したときに学習辞書を更新（頻度・最近使った日・単位/単価を記憶）。
  function learn(item) {
    var entry = catalogEntry(item.name);
    if (!entry) {
      entry = {
        name: item.name,
        category: item.category,
        count: 0,
        lastUsed: 0,
        defaultUnit: item.unit || '',
        defaultPrice: null
      };
      state.catalog.push(entry);
    }
    entry.count += 1;
    entry.lastUsed = Date.now();
    entry.category = item.category;
    if (item.unit) entry.defaultUnit = item.unit;
    if (item.price != null && item.price !== '') entry.defaultPrice = Number(item.price);
  }

  // 単価が後から入力されたら、それも辞書に反映しておく（次回の自動補完用）。
  function rememberPrice(name, price) {
    var entry = catalogEntry(name);
    if (entry && price != null && price !== '') entry.defaultPrice = Number(price);
  }

  // 入力文字列に対するサジェスト候補（頻度→最近使った順）。
  function suggestFor(query) {
    var q = query.trim().toLowerCase();
    var pool = state.catalog.slice();
    // 既にリストにある名前は候補から外す（重複追加を避ける）。
    var inList = {};
    state.items.forEach(function (it) { inList[it.name] = true; });

    var matched = pool.filter(function (c) {
      if (inList[c.name]) return false;
      if (!q) return true;
      return c.name.toLowerCase().indexOf(q) !== -1;
    });
    matched.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return (b.lastUsed || 0) - (a.lastUsed || 0);
    });
    return matched.slice(0, 8);
  }

  /* =====================================================================
   * アイテム操作
   * ===================================================================== */
  function addItem(name, qty, opts) {
    name = (name || '').trim();
    if (!name) return null;
    opts = opts || {};

    // 同名が未完了で既にあれば数量だけ増やす。
    var existing = null;
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].name === name && !state.items[i].checked) { existing = state.items[i]; break; }
    }
    if (existing) {
      existing.qty += (qty || 1);
      learn(existing);
      persist();
      render();
      flashCard(existing.id);
      return existing;
    }

    var entry = catalogEntry(name);
    var item = {
      id: uid(),
      name: name,
      category: opts.category || (entry && entry.category) || CAT.classify(name),
      qty: qty || 1,
      unit: opts.unit || (entry && entry.defaultUnit) || '',
      price: (opts.price != null ? opts.price
             : (entry && entry.defaultPrice != null ? entry.defaultPrice : null)),
      checked: false,
      addedAt: Date.now()
    };
    state.items.push(item);
    learn(item);
    persist();
    render();
    flashCard(item.id);
    return item;
  }

  function findItem(id) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
    return null;
  }

  function toggleChecked(id) {
    var it = findItem(id);
    if (!it) return;
    it.checked = !it.checked;
    if (it.checked) { it.checkedAt = Date.now(); reward(); }
    persist();
    render();
  }

  function changeQty(id, delta) {
    var it = findItem(id);
    if (!it) return;
    it.qty = Math.max(1, it.qty + delta);
    persist();
    render();
  }

  function setPrice(id, price) {
    var it = findItem(id);
    if (!it) return;
    it.price = (price === '' || price == null) ? null : Number(price);
    rememberPrice(it.name, it.price);
    persist();
    updateBudget();
  }

  function removeItem(id) {
    state.items = state.items.filter(function (it) { return it.id !== id; });
    persist();
    render();
  }

  function clearChecked() {
    state.items = state.items.filter(function (it) { return !it.checked; });
    persist();
    render();
  }

  function clearAll() {
    state.items = [];
    persist();
    render();
  }

  /* =====================================================================
   * レンダリング：リスト
   * ===================================================================== */
  var listArea = $('#listArea');
  var emptyState = $('#emptyState');

  function render() {
    renderList();
    updateBudget();
    renderStaples();
  }

  function renderList() {
    listArea.innerHTML = '';
    if (state.items.length === 0) {
      emptyState.hidden = false;
      return;
    }
    emptyState.hidden = true;

    if (state.settings.sortByAisle) {
      renderByAisle();
    } else {
      renderFlat();
    }
  }

  // 未完了→売り場順、完了は最後にまとめる。
  function sortedItems() {
    var unchecked = state.items.filter(function (i) { return !i.checked; });
    var checked   = state.items.filter(function (i) { return i.checked; });
    return { unchecked: unchecked, checked: checked };
  }

  function renderFlat() {
    var s = sortedItems();
    s.unchecked.forEach(function (it) { listArea.appendChild(itemCard(it)); });
    appendCheckedGroup(s.checked);
  }

  function renderByAisle() {
    var s = sortedItems();
    // 売り場ごとにグループ化
    var groups = {};
    s.unchecked.forEach(function (it) {
      var key = it.category || 'other';
      (groups[key] = groups[key] || []).push(it);
    });
    // CATEGORIES の order 順に表示
    CAT.list.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (cat) {
      var arr = groups[cat.key];
      if (!arr || !arr.length) return;
      var wrap = el('div', 'aisle');
      var head = el('div', 'aisle-head');
      head.appendChild(el('span', 'aisle-emoji', cat.emoji));
      head.appendChild(el('span', null, cat.label));
      head.appendChild(el('span', 'aisle-count', arr.length + '点'));
      wrap.appendChild(head);
      arr.forEach(function (it) { wrap.appendChild(itemCard(it)); });
      listArea.appendChild(wrap);
    });
    appendCheckedGroup(s.checked);
  }

  function appendCheckedGroup(checked) {
    if (!checked.length) return;
    var wrap = el('div', 'aisle');
    var head = el('div', 'aisle-head');
    head.appendChild(el('span', 'aisle-emoji', '🛒'));
    head.appendChild(el('span', null, 'カゴに入れた'));
    head.appendChild(el('span', 'aisle-count', checked.length + '点'));
    wrap.appendChild(head);
    checked.forEach(function (it) { wrap.appendChild(itemCard(it)); });
    listArea.appendChild(wrap);
  }

  function itemCard(it) {
    var card = el('div', 'item-card' + (it.checked ? ' is-checked' : ''));
    card.dataset.id = it.id;

    // チェックボタン
    var check = el('button', 'check-btn');
    check.type = 'button';
    check.innerHTML = '✓';
    check.setAttribute('aria-label', it.checked ? 'カゴから戻す' : 'カゴに入れる');
    check.addEventListener('click', function () { toggleChecked(it.id); });
    card.appendChild(check);

    // 本体（名前＋メタ）
    var body = el('div', 'item-body');
    var name = el('div', 'item-name', it.name);
    body.appendChild(name);

    var meta = el('div', 'item-meta');
    var cat = CAT.getCategory(it.category);
    meta.appendChild(el('span', null, cat.emoji + ' ' + cat.label));
    if (state.settings.showBudget) {
      var priceInput = el('input', 'item-price-input');
      priceInput.type = 'number';
      priceInput.inputMode = 'numeric';
      priceInput.min = '0';
      priceInput.placeholder = '単価¥';
      if (it.price != null) priceInput.value = it.price;
      priceInput.addEventListener('change', function () { setPrice(it.id, priceInput.value); });
      priceInput.addEventListener('click', function (e) { e.stopPropagation(); });
      meta.appendChild(priceInput);
    }
    body.appendChild(meta);
    card.appendChild(body);

    // 数量
    var qtyGroup = el('div', 'qty-group');
    var minus = el('button', 'qty-btn', '−'); minus.type = 'button';
    var num = el('span', 'qty-num', String(it.qty));
    var plus = el('button', 'qty-btn', '＋'); plus.type = 'button';
    minus.addEventListener('click', function () { changeQty(it.id, -1); });
    plus.addEventListener('click', function () { changeQty(it.id, 1); });
    qtyGroup.appendChild(minus); qtyGroup.appendChild(num); qtyGroup.appendChild(plus);
    card.appendChild(qtyGroup);

    // 削除
    var del = el('button', 'del-btn', '🗑');
    del.type = 'button';
    del.setAttribute('aria-label', it.name + 'を削除');
    del.addEventListener('click', function () { removeItem(it.id); });
    card.appendChild(del);

    return card;
  }

  function flashCard(id) {
    requestAnimationFrame(function () {
      var card = listArea.querySelector('.item-card[data-id="' + id + '"]');
      if (!card) return;
      card.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }],
        { duration: 280, easing: 'ease' }
      );
    });
  }

  /* =====================================================================
   * 予算・合計
   * ===================================================================== */
  var totalText = $('#totalText');
  var budgetOfText = $('#budgetOfText');
  var budgetFill = $('#budgetFill');
  var budgetWarn = $('#budgetWarn');
  var budgetBar = $('#budgetBar');

  function calcTotal() {
    var sum = 0;
    state.items.forEach(function (it) {
      if (it.price != null) sum += Number(it.price) * (it.qty || 1);
    });
    return sum;
  }

  function updateBudget() {
    if (!state.settings.showBudget) {
      budgetBar.hidden = true;
      return;
    }
    budgetBar.hidden = false;

    var total = calcTotal();
    totalText.textContent = '¥' + total.toLocaleString('ja-JP');

    var budget = Number(state.budget.amount) || 0;
    if (budget > 0) {
      budgetOfText.textContent = '/ 予算 ¥' + budget.toLocaleString('ja-JP');
      var ratio = total / budget;
      budgetFill.style.width = Math.min(100, ratio * 100) + '%';
      var over = total > budget;
      budgetFill.classList.toggle('is-over', over);
      budgetWarn.hidden = !over;
      if (over) {
        var diff = total - budget;
        budgetWarn.textContent = '🐱 予算を ¥' + diff.toLocaleString('ja-JP') + ' オーバーしてるよ〜';
      }
    } else {
      budgetOfText.textContent = '（予算は設定タブから）';
      budgetFill.style.width = '0%';
      budgetFill.classList.remove('is-over');
      budgetWarn.hidden = true;
    }
  }

  /* =====================================================================
   * よく買うもの（staples ＋ catalog 上位）
   * ===================================================================== */
  var staplesArea = $('#staplesArea');

  function renderStaples() {
    if (!staplesArea) return;
    staplesArea.innerHTML = '';

    var inList = {};
    state.items.forEach(function (it) { if (!it.checked) inList[it.name] = true; });

    // 「いつもの」＋ catalog 上位（重複は除く）
    var names = [];
    var seen = {};
    state.staples.forEach(function (n) { if (!seen[n]) { seen[n] = true; names.push({ name: n, pinned: true }); } });
    state.catalog.slice().sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return (b.lastUsed || 0) - (a.lastUsed || 0);
    }).slice(0, 16).forEach(function (c) {
      if (!seen[c.name]) { seen[c.name] = true; names.push({ name: c.name, pinned: false }); }
    });

    if (names.length === 0) {
      staplesArea.appendChild(el('p', 'chip-empty', 'まだありません。買い物すると、ここに「よく買うもの」がたまります🛒'));
      return;
    }

    names.forEach(function (n) {
      var entry = catalogEntry(n.name);
      var catKey = (entry && entry.category) || CAT.classify(n.name);
      var cat = CAT.getCategory(catKey);
      var added = !!inList[n.name];

      var chip = el('button', 'chip' + (added ? ' is-added' : ''));
      chip.type = 'button';
      chip.appendChild(el('span', 'chip-cat', cat.emoji));
      chip.appendChild(el('span', null, n.name));
      if (n.pinned) {
        var x = el('span', 'chip-x', '✕');
        x.title = '「いつもの」から外す';
        x.addEventListener('click', function (e) {
          e.stopPropagation();
          state.staples = state.staples.filter(function (s) { return s !== n.name; });
          persist();
          renderStaples();
        });
        chip.appendChild(x);
      }
      chip.addEventListener('click', function () {
        addItem(n.name, 1);
        chip.classList.add('is-added');
      });
      staplesArea.appendChild(chip);
    });
  }

  /* =====================================================================
   * ご褒美演出
   * ===================================================================== */
  var rewardLayer = $('#rewardLayer');
  var PRAISE = ['えらい！', 'やったね♪', 'ナイス買い物！', 'すてき✨', 'グッジョブ👍', 'かしこい！'];
  var CONFETTI_COLORS = ['#ffb6c8', '#b9e7d4', '#d8c7f0', '#ffd9a0', '#bfe0ff'];

  function reward() {
    if (!rewardLayer) return;
    var bubble = el('div', 'reward-bubble', PRAISE[Math.floor(Math.random() * PRAISE.length)] + ' 🐱');
    rewardLayer.appendChild(bubble);
    for (var i = 0; i < 14; i++) {
      var c = el('div', 'confetti');
      c.style.left = (35 + Math.random() * 30) + '%';
      c.style.top = '34%';
      c.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      c.style.animationDelay = (Math.random() * 0.15) + 's';
      c.style.transform = 'translateX(' + ((Math.random() - 0.5) * 120) + 'px)';
      rewardLayer.appendChild(c);
    }
    setTimeout(function () { rewardLayer.innerHTML = ''; }, 1300);
  }

  /* =====================================================================
   * 追加バー ＆ サジェスト
   * ===================================================================== */
  var addForm = $('#addForm');
  var nameInput = $('#nameInput');
  var qtyInput = $('#qtyInput');
  var suggestBox = $('#suggestBox');
  var activeSuggest = -1;

  function showSuggest() {
    var items = suggestFor(nameInput.value);
    suggestBox.innerHTML = '';
    activeSuggest = -1;

    if (nameInput.value.trim() === '' && items.length === 0) { suggestBox.hidden = true; return; }

    if (items.length) {
      var hint = el('div', 'suggest-hint', nameInput.value.trim() ? 'もしかして…' : 'よく買うもの');
      suggestBox.appendChild(hint);
    }
    items.forEach(function (c) {
      var cat = CAT.getCategory(c.category);
      var row = el('div', 'suggest-item');
      row.appendChild(el('span', 's-emoji', cat.emoji));
      row.appendChild(el('span', null, c.name));
      var metaParts = [];
      if (c.defaultPrice != null) metaParts.push('¥' + c.defaultPrice);
      metaParts.push(c.count + '回');
      row.appendChild(el('span', 's-meta', metaParts.join(' · ')));
      row.addEventListener('mousedown', function (e) { e.preventDefault(); pickSuggest(c.name); });
      suggestBox.appendChild(row);
    });
    suggestBox.hidden = items.length === 0;
  }

  function pickSuggest(name) {
    addItem(name, parseInt(qtyInput.value, 10) || 1);
    nameInput.value = '';
    qtyInput.value = '1';
    suggestBox.hidden = true;
    nameInput.focus();
  }

  nameInput.addEventListener('input', showSuggest);
  nameInput.addEventListener('focus', showSuggest);
  nameInput.addEventListener('blur', function () {
    setTimeout(function () { suggestBox.hidden = true; }, 120);
  });
  nameInput.addEventListener('keydown', function (e) {
    var rows = suggestBox.querySelectorAll('.suggest-item');
    if (e.key === 'ArrowDown' && rows.length) {
      e.preventDefault();
      activeSuggest = Math.min(rows.length - 1, activeSuggest + 1);
      highlightSuggest(rows);
    } else if (e.key === 'ArrowUp' && rows.length) {
      e.preventDefault();
      activeSuggest = Math.max(0, activeSuggest - 1);
      highlightSuggest(rows);
    } else if (e.key === 'Enter' && activeSuggest >= 0 && rows[activeSuggest]) {
      e.preventDefault();
      rows[activeSuggest].dispatchEvent(new MouseEvent('mousedown'));
    }
  });
  function highlightSuggest(rows) {
    rows.forEach(function (r, i) { r.classList.toggle('is-active', i === activeSuggest); });
  }

  addForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    addItem(name, parseInt(qtyInput.value, 10) || 1);
    nameInput.value = '';
    qtyInput.value = '1';
    suggestBox.hidden = true;
    nameInput.focus();
  });

  /* =====================================================================
   * タブ切替
   * ===================================================================== */
  var tabBtns = document.querySelectorAll('.tab-btn');
  var panels = document.querySelectorAll('.tab-panel');
  tabBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.dataset.target;
      tabBtns.forEach(function (b) {
        var on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panels.forEach(function (p) {
        var on = p.dataset.tab === target;
        p.hidden = !on;
        p.classList.toggle('is-active', on);
      });
      // 追加バーはリストタブのみ表示
      $('#addBar').style.display = (target === 'list') ? '' : 'none';
    });
  });

  /* =====================================================================
   * 設定 UI
   * ===================================================================== */
  var budgetInput = $('#budgetInput');
  var sortToggle = $('#sortToggle');
  var budgetToggle = $('#budgetToggle');

  budgetInput.value = state.budget.amount || '';
  sortToggle.checked = !!state.settings.sortByAisle;
  budgetToggle.checked = !!state.settings.showBudget;

  budgetInput.addEventListener('input', function () {
    state.budget.amount = parseInt(budgetInput.value, 10) || 0;
    save(KEYS.budget, state.budget);
    updateBudget();
  });
  sortToggle.addEventListener('change', function () {
    state.settings.sortByAisle = sortToggle.checked;
    save(KEYS.settings, state.settings);
    render();
  });
  budgetToggle.addEventListener('change', function () {
    state.settings.showBudget = budgetToggle.checked;
    save(KEYS.settings, state.settings);
    render();
  });

  $('#clearCheckedBtn').addEventListener('click', function () {
    if (state.items.some(function (i) { return i.checked; })) {
      if (confirm('完了したものをリストから消しますか？')) clearChecked();
    }
  });
  $('#clearAllBtn').addEventListener('click', function () {
    if (state.items.length && confirm('リストを全部消しますか？（取り消せません）')) clearAll();
  });

  // 「いつもの」登録
  var newStapleInput = $('#newStapleInput');
  $('#addStapleBtn').addEventListener('click', function () {
    var n = newStapleInput.value.trim();
    if (!n) return;
    if (state.staples.indexOf(n) === -1) state.staples.unshift(n);
    save(KEYS.staples, state.staples);
    newStapleInput.value = '';
    renderStaples();
  });
  newStapleInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $('#addStapleBtn').click(); }
  });

  /* =====================================================================
   * Service Worker 登録（PWA）
   * ===================================================================== */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* オフライン無効でも動く */ });
    });
  }

  /* ---------- 初期描画 ---------- */
  render();
})();
