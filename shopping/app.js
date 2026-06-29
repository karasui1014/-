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
    items:     'okaimono.items',
    catalog:   'okaimono.catalog',
    staples:   'okaimono.staples',
    budget:    'okaimono.budget',
    settings:  'okaimono.settings',
    inventory: 'okaimono.inventory',
    recipes:   'okaimono.recipes',
    cooks:     'okaimono.cooks',     // 献立ごとの「作った回数」
    photos:    'okaimono.photos'     // 献立ごとの料理写真（dataURL）
  };

  // このアプリのURL（SNSシェアのフォールバック用）
  var APP_URL = location.href.split('#')[0].split('?')[0];

  /* ---------- 状態 ---------- */
  var state = {
    items:     load(KEYS.items, []),
    catalog:   load(KEYS.catalog, []),
    staples:   load(KEYS.staples, []),
    budget:    load(KEYS.budget, { amount: 0 }),
    settings:  load(KEYS.settings, { sortByAisle: true, showBudget: true }),
    inventory: load(KEYS.inventory, []),   // [{name,lastBought,intervalDays,history,manual}]
    recipes:   load(KEYS.recipes, []),     // ユーザー自作の献立
    cooks:     load(KEYS.cooks, {}),       // { recipeId: {count,last} }
    photos:    load(KEYS.photos, {})       // { recipeId: dataURL }
  };
  // 後から増えた設定のデフォルト
  if (state.settings.showReminder === undefined) state.settings.showReminder = true;
  // 称号の「演出済みレベル」。初回は今のレベルにそろえて、過去分の連続演出を防ぐ。
  if (state.settings.titleSeen === undefined) {
    state.settings.titleSeen = currentTitleIndex(distinctCookedCount());
  }

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
    save(KEYS.inventory, state.inventory);
    save(KEYS.recipes, state.recipes);
    save(KEYS.cooks, state.cooks);
  }
  // 写真は容量が大きいので persist() とは分けて保存する。
  function savePhotos() {
    try {
      localStorage.setItem(KEYS.photos, JSON.stringify(state.photos));
      return true;
    } catch (e) {
      toast('写真の保存容量がいっぱいです🙏');
      return false;
    }
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
      // 前回この場所で買ったときの値段（catalogの値が変わっても比較用にこのまま残す）
      prevPrice: (entry && entry.defaultPrice != null) ? entry.defaultPrice : null,
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
    if (it.checked) {
      it.checkedAt = Date.now();
      recordPurchase(it.name);   // 在庫・購入周期を学習
      if (!isAllComplete()) reward();   // 全部完了する瞬間はコンプリート演出にまとめる
    }
    persist();
    render();
  }

  // リストの全品が完了済みか（1品以上あって、全部チェック済み）。
  function isAllComplete() {
    return state.items.length > 0 && state.items.every(function (i) { return i.checked; });
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
    render();
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
  var completeBanner = $('#completeBanner');
  var nextTripBtn = $('#nextTripBtn');
  var wasComplete = isAllComplete();   // 起動時にすでに完了済みなら演出はスキップ

  function render() {
    renderList();
    updateBudget();
    renderStaples();
    renderDue();
    renderInventory();
    renderRecipes();
    renderTitleBadge();
    renderCookProgress();
  }

  function renderList() {
    var complete = isAllComplete();
    if (completeBanner) {
      completeBanner.hidden = !complete;
      if (complete && !wasComplete) celebrateComplete();
    }
    wasComplete = complete;

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
      if (it.prevPrice != null) {
        var prevNum = Number(it.prevPrice);
        var curNum = it.price != null ? Number(it.price) : null;
        var prevLabel = '前回¥' + prevNum.toLocaleString('ja-JP');
        var prevCls = 'item-prev-price';
        if (curNum != null && curNum !== prevNum) {
          prevCls += curNum > prevNum ? ' is-up' : ' is-down';
          prevLabel += curNum > prevNum ? ' ↑' : ' ↓';
        }
        meta.appendChild(el('span', prevCls, prevLabel));
      }
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
   * 買い忘れ・在庫（Phase 2）
   * ===================================================================== */
  var dueArea = $('#dueArea');
  var dueChips = $('#dueChips');
  var inventoryArea = $('#inventoryArea');
  var dueHidden = false;   // この起動中だけ非表示（リロードで戻る）

  function invEntry(name) {
    for (var i = 0; i < state.inventory.length; i++) {
      if (state.inventory[i].name === name) return state.inventory[i];
    }
    return null;
  }

  // カゴに入れた（＝買った）ときに在庫・購入周期を記録／学習する。
  function recordPurchase(name) {
    var inv = invEntry(name);
    if (!inv) {
      inv = { name: name, lastBought: 0, intervalDays: 7, history: [], manual: false };
      state.inventory.push(inv);
    }
    var now = Date.now();
    var last = inv.history.length ? inv.history[inv.history.length - 1] : 0;
    // 直近12時間以内のチェックは同じ買い物とみなし、履歴を増やさない。
    if (now - last > 12 * 3600 * 1000) {
      inv.history.push(now);
      if (inv.history.length > 8) inv.history = inv.history.slice(-8);
    }
    inv.lastBought = now;
    // 手動設定がなければ、購入間隔の平均から周期を自動推定。
    if (!inv.manual && inv.history.length >= 2) {
      var gaps = [];
      for (var i = 1; i < inv.history.length; i++) {
        gaps.push((inv.history[i] - inv.history[i - 1]) / 86400000);
      }
      var avg = gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length;
      inv.intervalDays = Math.max(2, Math.min(90, Math.round(avg)));
    }
  }

  function catKeyOf(name) {
    var e = catalogEntry(name);
    return (e && e.category) || CAT.classify(name);
  }

  // 周期を過ぎていて、今リストに無いものを「そろそろ」候補に。
  function dueItems() {
    if (!state.settings.showReminder) return [];
    var now = Date.now();
    var inList = {};
    state.items.forEach(function (it) { if (!it.checked) inList[it.name] = true; });
    return state.inventory.filter(function (inv) {
      if (inv.lastBought <= 0 || inList[inv.name]) return false;
      return (now - inv.lastBought) >= inv.intervalDays * 86400000;
    }).sort(function (a, b) {
      // より「遅れている」ものを上に
      return (now - b.lastBought) / (b.intervalDays * 86400000) -
             (now - a.lastBought) / (a.intervalDays * 86400000);
    }).slice(0, 8);
  }

  function renderDue() {
    if (!dueArea) return;
    var due = dueHidden ? [] : dueItems();
    if (!due.length) { dueArea.hidden = true; return; }
    dueArea.hidden = false;
    dueChips.innerHTML = '';
    var now = Date.now();
    due.forEach(function (inv) {
      var cat = CAT.getCategory(catKeyOf(inv.name));
      var days = Math.floor((now - inv.lastBought) / 86400000);
      var chip = el('button', 'chip');
      chip.type = 'button';
      chip.appendChild(el('span', 'chip-cat', cat.emoji));
      chip.appendChild(el('span', null, inv.name));
      chip.appendChild(el('span', 'chip-sub', '(' + days + '日前)'));
      chip.addEventListener('click', function () { addItem(inv.name, 1); });
      dueChips.appendChild(chip);
    });
  }

  function renderInventory() {
    if (!inventoryArea) return;
    inventoryArea.innerHTML = '';
    if (!state.inventory.length) {
      inventoryArea.appendChild(el('p', 'inv-empty',
        'まだ記録がありません。カゴに入れると、ここに記録されます🧺'));
      return;
    }
    var now = Date.now();
    state.inventory.slice().sort(function (a, b) { return b.lastBought - a.lastBought; })
      .forEach(function (inv) {
        var cat = CAT.getCategory(catKeyOf(inv.name));
        var row = el('div', 'inv-row');
        row.appendChild(el('span', 'inv-emoji', cat.emoji));

        var body = el('div', 'inv-body');
        body.appendChild(el('div', 'inv-name', inv.name));
        var days = inv.lastBought ? Math.floor((now - inv.lastBought) / 86400000) : null;
        var due = days != null && days >= inv.intervalDays;
        var when = (days == null) ? '' :
          ('前回 ' + (days === 0 ? '今日' : days + '日前') + ' · ');
        var meta = el('div', 'inv-meta' + (due ? ' is-due' : ''),
          (due ? '🔔 そろそろ · ' : '') + when + '約' + inv.intervalDays + '日ごと');
        body.appendChild(meta);
        row.appendChild(body);

        var iv = el('div', 'inv-interval');
        var ivInput = el('input');
        ivInput.type = 'number'; ivInput.inputMode = 'numeric'; ivInput.min = '1';
        ivInput.value = inv.intervalDays;
        ivInput.addEventListener('change', function () {
          var v = parseInt(ivInput.value, 10);
          if (v > 0) { inv.intervalDays = v; inv.manual = true; persist(); render(); }
        });
        iv.appendChild(ivInput);
        iv.appendChild(el('span', null, '日'));
        row.appendChild(iv);

        var del = el('button', 'inv-del', '🗑');
        del.type = 'button';
        del.setAttribute('aria-label', inv.name + 'を在庫から削除');
        del.addEventListener('click', function () {
          state.inventory = state.inventory.filter(function (x) { return x !== inv; });
          persist(); render();
        });
        row.appendChild(del);

        inventoryArea.appendChild(row);
      });
  }

  /* =====================================================================
   * 献立（レシピ）（Phase 2 / 作り方・検索を追加）
   * ===================================================================== */
  var recipeArea = $('#recipeArea');
  var recipeNoMatch = $('#recipeNoMatch');
  var recipeQuery = '';

  function allRecipes() {
    var base = (window.OKAIMONO_RECIPES && window.OKAIMONO_RECIPES.list) || [];
    return state.recipes.concat(base);   // 自作を先頭に
  }

  // クックパッドの検索URL（作り方を見る）。
  function cookpadUrl(name) {
    return 'https://cookpad.com/search/' + encodeURIComponent(name);
  }

  function recipeCard(r) {
    var key = recipeKey(r);
    var cnt = cookCount(r);
    var photo = state.photos[key];

    var card = el('div', 'recipe-card' + (r.custom ? ' is-custom' : ''));
    card.appendChild(el('div', 'recipe-emoji', r.emoji || '🍽️'));
    card.appendChild(el('div', 'recipe-name', r.name));
    card.appendChild(el('div', 'recipe-items',
      r.items.map(function (it) { return it.name; }).join('、')));

    if (cnt > 0) card.appendChild(el('div', 'recipe-count', '🍳 作った ' + cnt + '回'));

    if (photo) {
      var pimg = el('img', 'recipe-photo');
      pimg.src = photo;
      pimg.alt = r.name + 'の写真';
      pimg.addEventListener('click', function (e) { e.stopPropagation(); shareDish(r); });
      card.appendChild(pimg);
    }

    var actions = el('div', 'recipe-actions');
    var addBtn = el('button', 'recipe-add-btn', '＋ 材料を追加');
    addBtn.type = 'button';
    addBtn.addEventListener('click', function () { addRecipeToList(r); });
    actions.appendChild(addBtn);

    var howBtn = el('button', 'recipe-how-btn', '👩‍🍳 作り方');
    howBtn.type = 'button';
    actions.appendChild(howBtn);
    card.appendChild(actions);

    // 「作った！」「写真」「シェア」
    var actions2 = el('div', 'recipe-actions2');
    var madeBtn = el('button', 'recipe-made-btn', cnt > 0 ? '🍳 作った！(' + cnt + ')' : '🍳 作った！');
    madeBtn.type = 'button';
    madeBtn.addEventListener('click', function (e) { e.stopPropagation(); markCooked(r); });
    actions2.appendChild(madeBtn);

    var photoBtn = el('button', 'recipe-photo-btn', photo ? '📷 写真をかえる' : '📷 写真をのせる');
    photoBtn.type = 'button';
    photoBtn.addEventListener('click', function (e) { e.stopPropagation(); pickPhoto(r); });
    actions2.appendChild(photoBtn);

    if (photo) {
      var shareBtn = el('button', 'recipe-share-btn', '📤 シェア');
      shareBtn.type = 'button';
      shareBtn.addEventListener('click', function (e) { e.stopPropagation(); shareDish(r); });
      actions2.appendChild(shareBtn);
    }
    card.appendChild(actions2);

    // 作り方（手順＋クックパッド）— トグルで開閉
    var how = el('div', 'recipe-how');
    how.hidden = true;
    if (r.steps && r.steps.length) {
      var ol = el('ol', 'recipe-steps');
      r.steps.forEach(function (s) { ol.appendChild(el('li', null, s)); });
      how.appendChild(ol);
    } else {
      how.appendChild(el('p', 'recipe-steps-none', 'かんたんな手順は未登録。クックパッドで探してね👇'));
    }
    var link = el('a', 'recipe-cookpad', '🍳 クックパッドで作り方を見る ↗');
    link.href = cookpadUrl(r.name);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    how.appendChild(link);
    card.appendChild(how);

    howBtn.addEventListener('click', function () {
      how.hidden = !how.hidden;
      howBtn.classList.toggle('is-open', !how.hidden);
    });

    if (r.custom) {
      var del = el('button', 'recipe-del', '✕');
      del.type = 'button';
      del.setAttribute('aria-label', r.name + 'を削除');
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        state.recipes = state.recipes.filter(function (x) { return x.id !== r.id; });
        persist(); renderRecipes();
      });
      card.appendChild(del);
    }
    return card;
  }

  function renderRecipes() {
    if (!recipeArea) return;
    recipeArea.innerHTML = '';
    var q = recipeQuery.trim().toLowerCase();
    var list = allRecipes().filter(function (r) {
      return !q || r.name.toLowerCase().indexOf(q) !== -1;
    });
    list.forEach(function (r) { recipeArea.appendChild(recipeCard(r)); });

    // 検索したのに見つからない → クックパッド導線＋自作のおすすめ
    if (recipeNoMatch) {
      if (q && list.length === 0) {
        recipeNoMatch.hidden = false;
        recipeNoMatch.innerHTML = '';
        recipeNoMatch.appendChild(el('p', 'nomatch-title',
          '「' + recipeQuery.trim() + '」の献立はまだ登録がないよ'));
        var cp = el('a', 'big-btn', '🍳 クックパッドで「' + recipeQuery.trim() + '」の作り方を見る ↗');
        cp.href = cookpadUrl(recipeQuery.trim());
        cp.target = '_blank'; cp.rel = 'noopener noreferrer';
        recipeNoMatch.appendChild(cp);
        var mk = el('button', 'ghost-btn', '✏️ この名前で自分の献立をつくる');
        mk.type = 'button';
        mk.style.marginTop = '8px';
        mk.addEventListener('click', function () {
          if (recipeName) { recipeName.value = recipeQuery.trim(); recipeName.focus(); }
        });
        recipeNoMatch.appendChild(mk);
      } else {
        recipeNoMatch.hidden = true;
      }
    }
  }

  function addRecipeToList(r) {
    var added = 0;
    r.items.forEach(function (it) {
      var exists = state.items.some(function (x) { return x.name === it.name && !x.checked; });
      if (!exists) { addItem(it.name, it.qty || 1, { unit: it.unit }); added++; }
    });
    toast(added > 0 ? (r.name + ' の材料を ' + added + '品 追加したよ🛒')
                    : (r.name + ' の材料はもう全部リストにあるよ😊'));
  }

  function saveCustomRecipe() {
    var name = recipeName.value.trim();
    var raw = recipeItems.value.trim();
    if (!name) { toast('献立の名前を入れてね'); return; }
    var parts = raw.split(/[、,，\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!parts.length) { toast('材料を入れてね'); return; }
    state.recipes.unshift({
      id: 'u' + uid(), name: name, emoji: '🍽️', custom: true,
      items: parts.map(function (p) { return { name: p, qty: 1 }; })
    });
    persist();
    recipeName.value = ''; recipeItems.value = '';
    renderRecipes();
    toast('「' + name + '」を保存したよ✨');
  }

  /* =====================================================================
   * 称号・スタンプ（作った献立の種類でランクアップ）
   * 3種類ごとにスタンプ→称号。10段階で「料理の創造神」へ。
   * ===================================================================== */
  var TITLES = [
    { name: '料理初心者',     icon: '🍳' },
    { name: 'キッチン見習い', icon: '🧑‍🍳' },
    { name: '献立ハンター',   icon: '🎯' },
    { name: '食材テイマー',   icon: '🥕' },
    { name: '味の錬金術師',   icon: '⚗️' },
    { name: '食卓の守護者',   icon: '🛡️' },
    { name: '美食の探求者',   icon: '🔭' },
    { name: 'レジェンドシェフ', icon: '🏆' },
    { name: '献立大賢者',     icon: '🔮' },
    { name: '料理の創造神',   icon: '👑' }
  ];

  function recipeKey(r) { return r.id || ('n:' + r.name); }
  function cookCount(r) {
    var c = state.cooks[recipeKey(r)];
    return (c && c.count) || 0;
  }
  // 「作った（1回以上）」献立の種類数。
  function distinctCookedCount() {
    var n = 0;
    for (var k in state.cooks) {
      if (state.cooks.hasOwnProperty(k) && state.cooks[k] && state.cooks[k].count > 0) n++;
    }
    return n;
  }
  function currentTitleIndex(n) {
    return Math.min(9, Math.floor(n / 3));   // 9 = TITLES の最終indexと一致
  }

  function markCooked(r) {
    var key = recipeKey(r);
    var c = state.cooks[key] || { count: 0, last: 0 };
    c.count += 1;
    c.last = Date.now();
    state.cooks[key] = c;
    save(KEYS.cooks, state.cooks);
    reward();
    toast('🍳「' + r.name + '」を作った！（' + c.count + '回目）');
    render();
    maybeCelebrateTitle();
  }

  // 新しい称号に到達していたらお祝い演出。
  function maybeCelebrateTitle() {
    var idx = currentTitleIndex(distinctCookedCount());
    var seen = state.settings.titleSeen || 0;
    if (idx > seen) {
      state.settings.titleSeen = idx;
      save(KEYS.settings, state.settings);
      celebrateTitle(idx);
    }
  }

  function celebrateTitle(idx) {
    var t = TITLES[idx];
    if (rewardLayer) {
      var bubble = el('div', 'reward-bubble reward-title', t.icon + ' 称号「' + t.name + '」獲得！');
      rewardLayer.appendChild(bubble);
      for (var i = 0; i < 30; i++) {
        var c = el('div', 'confetti');
        c.style.left = (6 + Math.random() * 88) + '%';
        c.style.top = '24%';
        c.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        c.style.animationDelay = (Math.random() * 0.35) + 's';
        c.style.transform = 'translateX(' + ((Math.random() - 0.5) * 240) + 'px)';
        rewardLayer.appendChild(c);
      }
      setTimeout(function () { rewardLayer.innerHTML = ''; }, 2000);
    }
    toast(t.icon + ' 新しい称号「' + t.name + '」を手に入れた！');
  }

  /* ---------- 称号バッジ（ヘッダー上部） ---------- */
  var titleBadge = $('#titleBadge');
  var tbIcon = $('#tbIcon');
  var tbName = $('#tbName');

  function renderTitleBadge() {
    if (!titleBadge) return;
    var idx = currentTitleIndex(distinctCookedCount());
    var t = TITLES[idx];
    tbIcon.textContent = t.icon;
    tbName.textContent = t.name;
    titleBadge.hidden = false;
    titleBadge.className = 'title-badge tl-' + idx +
      (idx >= 5 ? ' glam' : '') + (idx >= 8 ? ' glam-max' : '');
  }

  /* ---------- 称号・スタンプの進捗（献立タブ） ---------- */
  var cpIcon = $('#cpIcon');
  var cpName = $('#cpName');
  var cpCount = $('#cpCount');
  var cpBarFill = $('#cpBarFill');
  var cpNext = $('#cpNext');
  var stampCard = $('#stampCard');

  function renderCookProgress() {
    if (!stampCard) return;
    var n = distinctCookedCount();
    var idx = currentTitleIndex(n);
    if (cpIcon) cpIcon.textContent = TITLES[idx].icon;
    if (cpName) cpName.textContent = TITLES[idx].name;
    if (cpCount) cpCount.textContent = '作った献立 ' + n + '種類';

    var maxed = idx >= TITLES.length - 1;
    if (cpBarFill) cpBarFill.style.width = maxed ? '100%' :
      Math.min(100, ((n - idx * 3) / 3) * 100) + '%';
    if (cpNext) cpNext.textContent = maxed
      ? '最高位の称号を達成！もう料理の神さまです✨'
      : 'あと ' + ((idx + 1) * 3 - n) + ' 種類で「' + TITLES[idx + 1].name + '」🌟';

    stampCard.innerHTML = '';
    // 今のサイクル（3つ）のスタンプ
    var within = maxed ? 3 : (n - idx * 3);
    var row = el('div', 'stamp-row');
    for (var s = 0; s < 3; s++) {
      var st = el('div', 'stamp' + (s < within ? ' is-filled' : ''), s < within ? '⭐' : '○');
      row.appendChild(st);
    }
    stampCard.appendChild(row);

    // 称号コレクション（獲得済み＝カラー、未獲得＝グレー）
    var chips = el('div', 'title-chips');
    TITLES.forEach(function (t, i) {
      var unlocked = i <= idx;
      var chip = el('div', 'title-chip' + (i === idx ? ' is-current' : (unlocked ? '' : ' is-locked')));
      chip.appendChild(el('span', 'tc-ico', unlocked ? t.icon : '🔒'));
      chip.appendChild(el('span', null, t.name));
      chips.appendChild(chip);
    });
    stampCard.appendChild(chips);
  }

  /* =====================================================================
   * 料理写真のアップロード ＆ SNSシェア（X / インスタ / Facebook）
   *  - スマホは Web Share API（navigator.share）で各アプリへ直接投稿
   *  - PCはダウンロード＋X/Facebookのフォールバック
   * ===================================================================== */
  // 写真は端末内に保存するため、長辺1080px・JPEGに圧縮して容量を抑える。
  function compressImage(file, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.width, h = img.height;
        var scale = Math.min(1, maxDim / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale));
        var ch = Math.max(1, Math.round(h * scale));
        var canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
        try { resolve(canvas.toDataURL('image/jpeg', quality)); }
        catch (e) { reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('load error')); };
      img.src = url;
    });
  }

  function pickPhoto(r) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      compressImage(f, 1080, 0.82).then(function (dataUrl) {
        var key = recipeKey(r);
        state.photos[key] = dataUrl;
        if (savePhotos()) {
          renderRecipes();
          toast('📷「' + r.name + '」の写真をのせたよ！');
        } else {
          delete state.photos[key];
          renderRecipes();
        }
      }).catch(function () { toast('写真を読み込めませんでした😢'); });
    });
    input.click();
  }

  function dataURLtoFile(dataUrl, name) {
    var arr = dataUrl.split(',');
    var mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    var bstr = atob(arr[1]);
    var n = bstr.length;
    var u8 = new Uint8Array(n);
    while (n--) u8[n] = bstr.charCodeAt(n);
    return new File([u8], name, { type: mime });
  }

  function shareDish(r) {
    var dataUrl = state.photos[recipeKey(r)];
    var text = '🍳今日のごはんは「' + r.name + '」♪ #おかいものメモ #おうちごはん';
    // スマホ：画像つきでネイティブ共有（X・インスタ・Facebook等を選べる）
    if (dataUrl && navigator.share && navigator.canShare) {
      try {
        var file = dataURLtoFile(dataUrl, 'dish.jpg');
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], text: text }).catch(function () {});
          return;
        }
      } catch (e) { /* フォールバックへ */ }
    }
    openShareFallback(r, dataUrl, text);
  }

  function openShareFallback(r, dataUrl, text) {
    var backdrop = el('div', 'share-sheet-backdrop');
    var sheet = el('div', 'share-sheet');
    sheet.appendChild(el('h3', null, '📤「' + r.name + '」をシェア'));
    sheet.appendChild(el('p', 'ss-note', dataUrl
      ? 'スマホなら「写真でシェア」から、X・インスタ・Facebookに直接投稿できます。'
      : '先に「📷 写真をのせる」で写真を登録すると、SNSにシェアできます。'));

    function close() { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }

    if (dataUrl && navigator.share && navigator.canShare) {
      var nativeBtn = el('button', 'ss-btn', '📱 写真でシェア（X・インスタ・Facebook）');
      nativeBtn.type = 'button';
      nativeBtn.addEventListener('click', function () {
        close();
        try {
          var file = dataURLtoFile(dataUrl, 'dish.jpg');
          if (navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], text: text }).catch(function () {});
            return;
          }
        } catch (e) {}
        navigator.share({ text: text }).catch(function () {});
      });
      sheet.appendChild(nativeBtn);
    }

    if (dataUrl) {
      var saveLink = el('a', 'ss-btn', '📥 画像を保存（インスタ投稿用）');
      saveLink.href = dataUrl;
      saveLink.download = (r.name || 'dish') + '.jpg';
      sheet.appendChild(saveLink);
    }

    var x = el('a', 'ss-btn', '🐦 Xに投稿');
    x.href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text);
    x.target = '_blank'; x.rel = 'noopener noreferrer';
    sheet.appendChild(x);

    var fb = el('a', 'ss-btn', '📘 Facebookでシェア');
    fb.href = 'https://www.facebook.com/sharer/sharer.php?u=' +
      encodeURIComponent(APP_URL) + '&quote=' + encodeURIComponent(text);
    fb.target = '_blank'; fb.rel = 'noopener noreferrer';
    sheet.appendChild(fb);

    var insta = el('div', 'ss-btn ss-static', '📷 Instagramは画像を保存→アプリから投稿してね');
    sheet.appendChild(insta);

    var closeBtn = el('button', 'ss-close', '閉じる');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', close);
    sheet.appendChild(closeBtn);

    backdrop.appendChild(sheet);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
    document.body.appendChild(backdrop);
  }

  /* ---------- 小さなトースト ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById('appToast');
    if (!t) {
      t = el('div', 'app-toast');
      t.id = 'appToast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-show'); }, 1900);
  }
  window.okaimonoToast = toast;   // stores.js（お店タブ）からも使う

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

  // 全品コンプリート時の演出（個別のreward()より大きく・長く表示）。
  function celebrateComplete() {
    if (!rewardLayer) return;
    var bubble = el('div', 'reward-bubble reward-complete', '🎉 コンプリート！🎉');
    rewardLayer.appendChild(bubble);
    for (var i = 0; i < 26; i++) {
      var c = el('div', 'confetti');
      c.style.left = (8 + Math.random() * 84) + '%';
      c.style.top = '22%';
      c.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      c.style.animationDelay = (Math.random() * 0.3) + 's';
      c.style.transform = 'translateX(' + ((Math.random() - 0.5) * 220) + 'px)';
      rewardLayer.appendChild(c);
    }
    setTimeout(function () { rewardLayer.innerHTML = ''; }, 1700);
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

  function selectTab(target) {
    tabBtns.forEach(function (b) {
      var on = b.dataset.target === target;
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
  }

  tabBtns.forEach(function (btn) {
    btn.addEventListener('click', function () { selectTab(btn.dataset.target); });
  });
  // 起動時のホームは「献立」タブ
  selectTab('menu');

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

  /* ---------- Phase 2 の配線 ---------- */
  var reminderToggle = $('#reminderToggle');
  reminderToggle.checked = !!state.settings.showReminder;
  reminderToggle.addEventListener('change', function () {
    state.settings.showReminder = reminderToggle.checked;
    save(KEYS.settings, state.settings);
    renderDue();
  });

  var dueClose = $('#dueClose');
  if (dueClose) dueClose.addEventListener('click', function () {
    dueHidden = true;
    dueArea.hidden = true;
  });

  if (nextTripBtn) nextTripBtn.addEventListener('click', function () {
    clearChecked();   // 完了した品をリストから片付けて、次のお買い物へ
    toast('🛍️ 次のお買い物、いってらっしゃい♪');
  });

  var recipeName = $('#recipeName');
  var recipeItems = $('#recipeItems');
  $('#saveRecipeBtn').addEventListener('click', saveCustomRecipe);

  var recipeSearch = $('#recipeSearch');
  if (recipeSearch) recipeSearch.addEventListener('input', function () {
    recipeQuery = recipeSearch.value;
    renderRecipes();
  });

  /* =====================================================================
   * ホーム画面に追加（スマホでアプリ化）
   *  - Android/Chrome: beforeinstallprompt を捕まえてワンタップ追加
   *  - iOS/Safari: 自動プロンプトが無いので、共有メニューの手順を案内
   * ===================================================================== */
  var installBanner = $('#installBanner');
  var installText = $('#installText');
  var installBtn = $('#installBtn');
  var installClose = $('#installClose');
  var deferredPrompt = null;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           window.navigator.standalone === true;
  }
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }
  function dismissInstall() {
    installBanner.hidden = true;
    state.settings.installDismissed = true;
    save(KEYS.settings, state.settings);
  }
  function showInstallBanner(kind) {
    if (isStandalone() || state.settings.installDismissed) return;
    if (kind === 'ios') {
      installText.textContent = '共有ボタン → 「ホーム画面に追加」で、アプリのように使えます';
      installBtn.hidden = true;
    } else {
      installText.textContent = 'ホーム画面に追加して、アプリみたいに使えます♪';
      installBtn.hidden = false;
    }
    installBanner.hidden = false;
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBanner('android');
  });
  window.addEventListener('appinstalled', function () { dismissInstall(); });

  installBtn.addEventListener('click', function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () {
      deferredPrompt = null;
      installBanner.hidden = true;
    });
  });
  installClose.addEventListener('click', dismissInstall);

  if (isIOS()) showInstallBanner('ios');

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
