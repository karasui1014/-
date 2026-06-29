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
    photos:    'okaimono.photos',    // 献立ごとの料理写真（dataURL）
    plans:     'okaimono.plans'      // これから作る献立 [{id,name,emoji,servings,items}]
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
    photos:    load(KEYS.photos, {}),      // { recipeId: dataURL }
    plans:     load(KEYS.plans, [])        // これから作る献立
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
    save(KEYS.plans, state.plans);
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
    renderPlan();
    renderList();
    updateBudget();
    renderStaples();
    renderDue();
    renderInventory();
    renderRecipes();
    renderZubora();
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
  var recipeResult = $('#recipeResult');
  var recipeQuery = '';

  function baseRecipes() {
    return (window.OKAIMONO_RECIPES && window.OKAIMONO_RECIPES.list) || [];
  }
  function zuboraRecipes() {
    return (window.OKAIMONO_RECIPES && window.OKAIMONO_RECIPES.zubora) || [];
  }
  function allRecipes() {
    return state.recipes.concat(baseRecipes());   // 自作を先頭に（献立グリッド用）
  }
  // 検索・推定・似ているメニューでは ズボラメシも対象にする。
  function searchPool() {
    return state.recipes.concat(baseRecipes(), zuboraRecipes());
  }

  // クックパッドの検索URL（作り方を見る）。
  function cookpadUrl(name) {
    return 'https://cookpad.com/search/' + encodeURIComponent(name);
  }

  /* ---------- あいまい検索（完全一致でなくても近ければ出す） ---------- */
  // カタカナ→ひらがな・小文字化・空白除去でゆるく正規化する。
  function normJ(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '')
      .replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); })
      .replace(/鶏/g, '鳥');   // 「鶏」と「鳥」を同一視（とり料理の表記ゆれ対策）
  }
  function levenshtein(a, b) {
    var m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      for (j = 0; j <= n; j++) prev[j] = cur[j];
    }
    return prev[n];
  }
  function simRatio(a, b) {
    var max = Math.max(a.length, b.length);
    return max ? 1 - levenshtein(a, b) / max : 0;
  }
  // 料理名クエリに対するレシピの一致スコア（0なら不一致）。
  function recipeScore(r, qNorm) {
    if (!qNorm) return 1;
    var name = normJ(r.name);
    if (name === qNorm) return 100;
    if (name.indexOf(qNorm) !== -1) return 80;   // 例：かれー → カレーライス
    if (qNorm.indexOf(name) !== -1) return 75;   // 例：カレーライス → カレー
    var best = 0;
    for (var i = 0; i < r.items.length; i++) {
      var inm = normJ(r.items[i].name);
      if (inm && (inm.indexOf(qNorm) !== -1 || qNorm.indexOf(inm) !== -1)) best = Math.max(best, 45);
    }
    var ratio = simRatio(name, qNorm);           // タイプミス・言い回しのゆれ
    if (ratio >= 0.5) best = Math.max(best, Math.round(ratio * 60));
    return best;
  }
  function scoredRecipes(q) {
    var qN = normJ(q);
    return searchPool().map(function (r) { return { r: r, s: recipeScore(r, qN) }; })
      .filter(function (x) { return x.s > 0; })
      .sort(function (a, b) { return b.s - a.s; });
  }
  function bestRecipe(q) {
    var arr = scoredRecipes(q);
    return arr.length ? arr[0] : null;
  }
  // 材料の重なりが多い献立を「似ているメニュー」として返す。
  function ingredientSet(r) {
    var s = {}; r.items.forEach(function (it) { s[normJ(it.name)] = true; }); return s;
  }
  function similarRecipes(target, n) {
    var ts = ingredientSet(target);
    return searchPool().filter(function (r) { return recipeKey(r) !== recipeKey(target); })
      .map(function (r) {
        var rs = ingredientSet(r), shared = 0;
        for (var k in rs) if (ts[k]) shared++;
        return { r: r, shared: shared };
      })
      .filter(function (x) { return x.shared > 0; })
      .sort(function (a, b) { return b.shared - a.shared; })
      .slice(0, n).map(function (x) { return x.r; });
  }

  // 入力した料理名を「作れるレシピ」に解決する。
  //  1) 登録レシピ/ズボラメシに近いものがあればそれ
  //  2) 無ければ材料を自動推定（recipes.js の guess）して仮レシピを作る
  //  3) それも無ければ null（クックパッド導線へ）
  function resolveRecipe(query) {
    var q = (query || '').trim();
    if (!q) return null;
    var top = bestRecipe(q);
    if (top && top.s >= 45) {
      return { recipe: top.r, approx: top.s < 75 || normJ(top.r.name) !== normJ(q), inferred: false };
    }
    var guess = (window.OKAIMONO_RECIPES && window.OKAIMONO_RECIPES.guess)
      ? window.OKAIMONO_RECIPES.guess(q) : null;
    if (guess && guess.length) {
      return {
        recipe: { id: 'g:' + q, name: q, emoji: '🍳',
                  items: guess.map(function (nm) { return { name: nm, qty: 1 }; }) },
        approx: true, inferred: true
      };
    }
    if (top) {   // スコアは低いが一応の候補
      return { recipe: top.r, approx: true, inferred: false };
    }
    return null;
  }

  /* ---------- 「決定」：入力した料理名の材料を検索して表示 ---------- */
  function decideRecipe(query) {
    var q = (query || '').trim();
    if (!q) { toast('作りたい料理を入れてね'); return; }
    recipeQuery = q;
    if (recipeSearch) recipeSearch.value = q;
    var res = resolveRecipe(q);
    if (res) {
      renderRecipeResult(res.recipe, q, res.approx, res.inferred);
    } else {
      renderRecipeResultNone(q);
    }
    renderRecipes();
    if (recipeResult && recipeResult.scrollIntoView) {
      recipeResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function renderRecipeResult(r, query, approx, inferred) {
    if (!recipeResult) return;
    recipeResult.hidden = false;
    recipeResult.innerHTML = '';

    var head = el('div', 'rr-head');
    head.appendChild(el('span', 'rr-emoji', r.emoji || '🍽️'));
    var ht = el('div', 'rr-headtext');
    ht.appendChild(el('div', 'rr-title', r.name + ' の材料'));
    if (inferred) ht.appendChild(el('div', 'rr-sub', '🔎 自動検索した予想の材料です（調整できます）'));
    else if (approx) ht.appendChild(el('div', 'rr-sub', '「' + query + '」に近い献立だよ'));
    head.appendChild(ht);
    var close = el('button', 'rr-close', '✕'); close.type = 'button';
    close.addEventListener('click', function () { recipeResult.hidden = true; });
    head.appendChild(close);
    recipeResult.appendChild(head);

    // 材料プレビュー（表示のみ。リスト反映は「これを作る」で）
    var chips = el('div', 'rr-ings');
    r.items.forEach(function (it) {
      var cat = CAT.getCategory(CAT.classify(it.name));
      var chip = el('span', 'rr-ing');
      chip.appendChild(el('span', 'rr-ing-emoji', cat.emoji));
      chip.appendChild(el('span', null, it.name));
      chips.appendChild(chip);
    });
    recipeResult.appendChild(chips);

    // 人数（簡易の量づけに使う）
    var servWrap = el('div', 'rr-serv');
    servWrap.appendChild(el('span', 'rr-serv-label', '👥 作る人数'));
    var servInput = el('input', 'rr-serv-input');
    servInput.type = 'number'; servInput.inputMode = 'numeric';
    servInput.min = '1'; servInput.max = '20'; servInput.value = '2';
    servWrap.appendChild(servInput);
    servWrap.appendChild(el('span', 'rr-serv-unit', '人前'));
    recipeResult.appendChild(servWrap);

    var acts = el('div', 'rr-actions');
    var makeBtn = el('button', 'big-btn', '🍳 これを作る（リストに材料を入れる）'); makeBtn.type = 'button';
    makeBtn.addEventListener('click', function () {
      var s = Math.max(1, Math.min(20, parseInt(servInput.value, 10) || 2));
      makeThis(r, s);
    });
    acts.appendChild(makeBtn);
    var cp = el('a', 'big-btn ghost', '👩‍🍳 作り方を見る（クックパッド ↗）');
    cp.href = cookpadUrl(r.name); cp.target = '_blank'; cp.rel = 'noopener noreferrer';
    acts.appendChild(cp);
    recipeResult.appendChild(acts);

    // 似ているメニュー（タップでその料理の材料に切り替え）
    var sims = similarRecipes(r, 4);
    if (sims.length) {
      recipeResult.appendChild(el('div', 'rr-simhead', '🍳 似ているメニューもどうぞ'));
      var simWrap = el('div', 'rr-sims');
      sims.forEach(function (s) {
        var b = el('button', 'rr-sim', (s.emoji || '🍽️') + ' ' + s.name); b.type = 'button';
        b.addEventListener('click', function () { decideRecipe(s.name); });
        simWrap.appendChild(b);
      });
      recipeResult.appendChild(simWrap);
    }
  }

  function renderRecipeResultNone(query) {
    if (!recipeResult) return;
    recipeResult.hidden = false;
    recipeResult.innerHTML = '';
    recipeResult.appendChild(el('p', 'rr-none', '「' + query + '」の材料が見つかりませんでした。'));
    var cp = el('a', 'big-btn', '🍳 クックパッドで「' + query + '」の材料・作り方を見る ↗');
    cp.href = cookpadUrl(query); cp.target = '_blank'; cp.rel = 'noopener noreferrer';
    recipeResult.appendChild(cp);
    var mk = el('button', 'big-btn ghost', '✏️ この名前で自分の献立をつくる'); mk.type = 'button';
    mk.addEventListener('click', function () {
      if (recipeName) { recipeName.value = query; recipeName.scrollIntoView({ behavior: 'smooth' }); recipeItems.focus(); }
    });
    recipeResult.appendChild(mk);
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

    if (cnt > 0) {
      var countRow = el('div', 'recipe-count');
      countRow.appendChild(el('span', null, '🍳 作った ' + cnt + '回'));
      var undo = el('button', 'recipe-count-undo', '↩︎ 戻す');
      undo.type = 'button';
      undo.title = 'カウントを1つ戻す';
      undo.addEventListener('click', function (e) { e.stopPropagation(); decCook(r); });
      countRow.appendChild(undo);
      card.appendChild(countRow);
    }

    if (photo) {
      var pimg = el('img', 'recipe-photo');
      pimg.src = photo;
      pimg.alt = r.name + 'の写真';
      pimg.addEventListener('click', function (e) { e.stopPropagation(); shareDish(r); });
      card.appendChild(pimg);
    }

    var actions = el('div', 'recipe-actions');
    var addBtn = el('button', 'recipe-add-btn', '🍳 これを作る');
    addBtn.type = 'button';
    addBtn.addEventListener('click', function () { makeThis(r, 2); });
    actions.appendChild(addBtn);

    var howBtn = el('button', 'recipe-how-btn', '👩‍🍳 作り方');
    howBtn.type = 'button';
    actions.appendChild(howBtn);
    card.appendChild(actions);

    // 「写真」「シェア」（作ったカウントは写真をのせると自動で +1）
    var actions2 = el('div', 'recipe-actions2');
    var photoBtn = el('button', 'recipe-photo-btn', photo ? '📷 写真をかえる' : '📷 写真をのせる（作った+1）');
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
    var q = recipeQuery.trim();
    // 完全一致でなくても、近い名前・材料・タイプミスでもヒットする。
    var list = q ? scoredRecipes(q).map(function (x) { return x.r; }) : allRecipes();
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

  /* ---------- ズボラメシ（時短・節約メニュー） ---------- */
  var zuboraArea = $('#zuboraArea');
  var zuboraCatsEl = $('#zuboraCats');
  var zuboraCat = 'all';   // 表示中のカテゴリ

  function renderZubora() {
    if (!zuboraArea) return;
    var cats = (window.OKAIMONO_RECIPES && window.OKAIMONO_RECIPES.zuboraCats) || [];
    var list = zuboraRecipes();

    // カテゴリの絞り込みチップ
    if (zuboraCatsEl) {
      zuboraCatsEl.innerHTML = '';
      var all = el('button', 'chip' + (zuboraCat === 'all' ? ' is-added' : ''), 'ぜんぶ');
      all.type = 'button';
      all.addEventListener('click', function () { zuboraCat = 'all'; renderZubora(); });
      zuboraCatsEl.appendChild(all);
      cats.forEach(function (c) {
        var chip = el('button', 'chip' + (zuboraCat === c.key ? ' is-added' : ''));
        chip.type = 'button';
        chip.appendChild(el('span', 'chip-cat', c.emoji));
        chip.appendChild(el('span', null, c.label));
        chip.addEventListener('click', function () { zuboraCat = c.key; renderZubora(); });
        zuboraCatsEl.appendChild(chip);
      });
    }

    zuboraArea.innerHTML = '';
    list.filter(function (r) { return zuboraCat === 'all' || r.cat === zuboraCat; })
        .forEach(function (r) { zuboraArea.appendChild(recipeCard(r)); });
  }

  /* =====================================================================
   * 作る献立プラン（リスト上部に献立→下に必要な材料）
   *  - 「これを作る」で献立をプランに追加し、材料を自動でリストに反映
   *  - 人数で量を簡易スケール（基準2人前）、被る材料は1つにまとめる
   * ===================================================================== */
  function makeThis(r, servings) {
    addPlan(r, servings || 2);
    selectTab('list');
    toast('🍳「' + r.name + '」をリストに追加！材料は上にまとめたよ');
  }

  function addPlan(r, servings) {
    servings = Math.max(1, Math.min(20, servings || 2));
    var items = (r.items || []).map(function (it) {
      return { name: it.name, qty: it.qty || 1, unit: it.unit || '' };
    });
    var existing = null;
    for (var i = 0; i < state.plans.length; i++) {
      if (state.plans[i].name === r.name) { existing = state.plans[i]; break; }
    }
    if (existing) {
      existing.servings = servings;
      existing.items = items;
    } else {
      state.plans.push({
        id: 'p' + uid(), name: r.name, emoji: r.emoji || '🍽️',
        servings: servings, items: items
      });
    }
    recomputePlanItems();
    render();
  }

  function removePlan(id) {
    state.plans = state.plans.filter(function (p) { return p.id !== id; });
    recomputePlanItems();
    render();
  }

  function setPlanServings(id, n) {
    var p = null;
    for (var i = 0; i < state.plans.length; i++) if (state.plans[i].id === id) { p = state.plans[i]; break; }
    if (!p) return;
    p.servings = Math.max(1, Math.min(20, n || 1));
    recomputePlanItems();
    render();
  }

  // プラン由来の材料を作り直す。手動追加品・チェック状態・単価はできるだけ保つ。
  function recomputePlanItems() {
    var prev = {};
    state.items.forEach(function (it) { if (it.fromPlan) prev[it.name] = it; });
    // いったんプラン由来を外す
    state.items = state.items.filter(function (it) { return !it.fromPlan; });

    // 既に手動で入っている（未完了の）品の名前
    var manual = {};
    state.items.forEach(function (it) { if (!it.checked) manual[it.name] = true; });

    // 人数でスケールしつつ、同じ材料は数量をまとめる
    var agg = {};
    state.plans.forEach(function (p) {
      var mult = (p.servings || 2) / 2;   // 基準は2人前
      (p.items || []).forEach(function (ing) {
        var q = Math.max(1, Math.round((ing.qty || 1) * mult));
        if (!agg[ing.name]) agg[ing.name] = { name: ing.name, qty: 0, unit: ing.unit || '' };
        agg[ing.name].qty += q;
      });
    });

    Object.keys(agg).forEach(function (name) {
      if (manual[name]) return;   // 手動でもう入っているものは二重にしない
      var a = agg[name];
      var entry = catalogEntry(name);
      var p = prev[name];
      state.items.push({
        id: uid(),
        name: name,
        category: (entry && entry.category) || CAT.classify(name),
        qty: a.qty,
        unit: a.unit || (entry && entry.defaultUnit) || '',
        price: p ? p.price : (entry && entry.defaultPrice != null ? entry.defaultPrice : null),
        prevPrice: (entry && entry.defaultPrice != null) ? entry.defaultPrice : null,
        checked: p ? !!p.checked : false,
        checkedAt: p ? p.checkedAt : undefined,
        fromPlan: true,
        addedAt: p ? p.addedAt : Date.now()
      });
    });
    persist();
  }

  /* ---------- 作る献立の表示（リスト上部） ---------- */
  var planArea = $('#planArea');
  function renderPlan() {
    if (!planArea) return;
    planArea.innerHTML = '';
    if (!state.plans.length) { planArea.hidden = true; return; }
    planArea.hidden = false;

    planArea.appendChild(el('div', 'plan-head', '🍳 作る献立'));
    state.plans.forEach(function (p) {
      var row = el('div', 'plan-row');
      row.appendChild(el('span', 'plan-emoji', p.emoji || '🍽️'));
      row.appendChild(el('span', 'plan-name', p.name));

      var serv = el('div', 'plan-serv');
      var input = el('input', 'plan-serv-input');
      input.type = 'number'; input.inputMode = 'numeric'; input.min = '1'; input.max = '20';
      input.value = p.servings || 2;
      input.addEventListener('change', function () {
        setPlanServings(p.id, parseInt(input.value, 10) || 1);
      });
      input.addEventListener('click', function (e) { e.stopPropagation(); });
      serv.appendChild(input);
      serv.appendChild(el('span', 'plan-serv-unit', '人前'));
      row.appendChild(serv);

      var del = el('button', 'plan-del', '✕');
      del.type = 'button';
      del.setAttribute('aria-label', p.name + 'を献立から外す');
      del.addEventListener('click', function () { removePlan(p.id); });
      row.appendChild(del);

      planArea.appendChild(row);
    });
    planArea.appendChild(el('p', 'plan-note', '↑ の献立に必要な材料を、下にまとめています（人数で量を調整）'));
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

  // 写真をのせたとき自動で +1 する（手動ボタンは廃止）。
  function incCook(r) {
    var key = recipeKey(r);
    var c = state.cooks[key] || { count: 0, last: 0 };
    c.count += 1;
    c.last = Date.now();
    state.cooks[key] = c;
    save(KEYS.cooks, state.cooks);
    reward();
    render();
    maybeCelebrateTitle();
  }

  // 間違えてカウントしたときに 1つ戻す。
  function decCook(r) {
    var key = recipeKey(r);
    var c = state.cooks[key];
    if (!c || !c.count) return;
    c.count -= 1;
    if (c.count <= 0) delete state.cooks[key];
    save(KEYS.cooks, state.cooks);
    render();
    toast('「' + r.name + '」のカウントを1つ戻したよ');
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
    // 次の称号の名前はまだ見せない（獲得したときのお楽しみ）。
    if (cpNext) cpNext.textContent = maxed
      ? '最高位の称号を達成！もう料理の神さまです✨'
      : 'あと ' + ((idx + 1) * 3 - n) + ' 種類で 次の称号 をゲット🌟（名前はお楽しみ）';

    stampCard.innerHTML = '';
    // 今のサイクル（3つ）のスタンプ
    var within = maxed ? 3 : (n - idx * 3);
    var row = el('div', 'stamp-row');
    for (var s = 0; s < 3; s++) {
      var st = el('div', 'stamp' + (s < within ? ' is-filled' : ''), s < within ? '⭐' : '○');
      row.appendChild(st);
    }
    stampCard.appendChild(row);

    // 称号コレクション（獲得済み＝名前を表示／未獲得＝名前は「？？？」で伏せる）
    var chips = el('div', 'title-chips');
    TITLES.forEach(function (t, i) {
      var unlocked = i <= idx;
      var chip = el('div', 'title-chip' + (i === idx ? ' is-current' : (unlocked ? '' : ' is-locked')));
      chip.appendChild(el('span', 'tc-ico', unlocked ? t.icon : '🔒'));
      chip.appendChild(el('span', null, unlocked ? t.name : '？？？'));
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
          // 写真をのせたら「作った」を自動で +1（間違えたらカードの「↩︎戻す」で戻せる）
          incCook(r);
          toast('📷「' + r.name + '」の写真をのせて、作った +1！');
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
    // タブを切り替えたら先頭まで戻す（リストなら「作る献立」が一番上に見える）。
    if (window.scrollTo) {
      try { window.scrollTo({ top: 0, behavior: 'auto' }); }
      catch (e) { window.scrollTo(0, 0); }
    }
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

  /* ---------- 料理名のサジェスト（文脈から予測して候補表示） ---------- */
  var recipeSuggest = $('#recipeSuggest');
  var rsActive = -1;

  function predictDishList(q) {
    return (window.OKAIMONO_RECIPES && window.OKAIMONO_RECIPES.predict)
      ? window.OKAIMONO_RECIPES.predict(q, 8) : [];
  }
  function dishEmojiOf(name) {
    return (window.OKAIMONO_RECIPES && window.OKAIMONO_RECIPES.dishEmoji)
      ? window.OKAIMONO_RECIPES.dishEmoji(name) : '🍽️';
  }
  function showRecipeSuggest() {
    if (!recipeSuggest || !recipeSearch) return;
    var q = recipeSearch.value;
    var names = q.trim() ? predictDishList(q) : [];
    recipeSuggest.innerHTML = '';
    rsActive = -1;
    if (!names.length) { recipeSuggest.hidden = true; return; }

    recipeSuggest.appendChild(el('div', 'rs-hint', '🔎 もしかして…（タップで材料を検索）'));
    names.forEach(function (name) {
      var row = el('div', 'rs-item');
      row.appendChild(el('span', 'rs-emoji', dishEmojiOf(name)));
      row.appendChild(el('span', 'rs-name', name));
      var known = !!bestRecipe(name);   // 登録ありか自動推定かをひとことで
      row.appendChild(el('span', 'rs-tag', known ? '材料あり' : '自動検索'));
      row.addEventListener('mousedown', function (e) {
        e.preventDefault();
        recipeSuggest.hidden = true;
        decideRecipe(name);
      });
      recipeSuggest.appendChild(row);
    });
    recipeSuggest.hidden = false;
  }
  function highlightRecipeSuggest(rows) {
    rows.forEach(function (r, i) { r.classList.toggle('is-active', i === rsActive); });
    if (rows[rsActive] && rows[rsActive].scrollIntoView) {
      rows[rsActive].scrollIntoView({ block: 'nearest' });
    }
  }

  var recipeSearch = $('#recipeSearch');
  if (recipeSearch) recipeSearch.addEventListener('input', function () {
    recipeQuery = recipeSearch.value;
    renderRecipes();
    showRecipeSuggest();
  });
  if (recipeSearch) recipeSearch.addEventListener('focus', showRecipeSuggest);
  if (recipeSearch) recipeSearch.addEventListener('blur', function () {
    setTimeout(function () { if (recipeSuggest) recipeSuggest.hidden = true; }, 140);
  });
  // 「決定」ボタン／Enterで、入力した料理名の材料を検索して表示。
  var recipeDecideBtn = $('#recipeDecideBtn');
  if (recipeDecideBtn) recipeDecideBtn.addEventListener('click', function () {
    if (recipeSuggest) recipeSuggest.hidden = true;
    decideRecipe(recipeSearch ? recipeSearch.value : '');
  });
  if (recipeSearch) recipeSearch.addEventListener('keydown', function (e) {
    var rows = recipeSuggest ? recipeSuggest.querySelectorAll('.rs-item') : [];
    if (e.key === 'ArrowDown' && rows.length) {
      e.preventDefault();
      rsActive = Math.min(rows.length - 1, rsActive + 1);
      highlightRecipeSuggest(rows);
    } else if (e.key === 'ArrowUp' && rows.length) {
      e.preventDefault();
      rsActive = Math.max(0, rsActive - 1);
      highlightRecipeSuggest(rows);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rsActive >= 0 && rows[rsActive]) {
        rows[rsActive].dispatchEvent(new MouseEvent('mousedown'));
      } else {
        if (recipeSuggest) recipeSuggest.hidden = true;
        decideRecipe(recipeSearch.value);
      }
    } else if (e.key === 'Escape') {
      if (recipeSuggest) recipeSuggest.hidden = true;
    }
  });

  // 献立／ズボラメシ の切り替え
  var segRecipes = $('#segRecipes');
  var segZubora = $('#segZubora');
  var recipesPane = $('#recipesPane');
  var zuboraPane = $('#zuboraPane');
  function showMenuPane(which) {
    var zub = which === 'zubora';
    if (recipesPane) recipesPane.hidden = zub;
    if (zuboraPane) zuboraPane.hidden = !zub;
    if (segRecipes) segRecipes.classList.toggle('is-active', !zub);
    if (segZubora) segZubora.classList.toggle('is-active', zub);
    if (zub) renderZubora();
  }
  if (segRecipes) segRecipes.addEventListener('click', function () { showMenuPane('recipes'); });
  if (segZubora) segZubora.addEventListener('click', function () { showMenuPane('zubora'); });

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
   * Service Worker 登録（PWA）＋ 自動アップデート
   *  - 新しいバージョンを公開すると、新SWが制御を引き継いだ瞬間に
   *    自動でページを再読み込みして最新版に切り替える。
   *  - データは localStorage 保存なので、リロードしても内容はそのまま。
   *  - 入力中はその場で奪わず、操作が一段落してから更新する。
   * ===================================================================== */
  if ('serviceWorker' in navigator) {
    var swFirstControl = !navigator.serviceWorker.controller;  // 初回はまだ制御者がいない
    var swReloading = false;

    function reloadForUpdate() {
      if (swReloading) return;
      swReloading = true;
      var ae = document.activeElement;
      var typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') &&
                   ae.value && ae.value.length > 0;
      if (typing) {
        toast('✨ 新しいバージョンに更新します（入力おわりに）');
        var go = function () { location.reload(); };
        window.addEventListener('blur', go, { once: true });
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'hidden') go();
        }, { once: true });
        setTimeout(go, 60000);   // 念のため、しばらく操作が無ければ更新
        return;
      }
      location.reload();
    }

    // 新SWが制御を取った（＝新バージョンが有効化された）らリロード。
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (swFirstControl) { swFirstControl = false; return; }  // 初回登録の制御取得は除く
      reloadForUpdate();
    });

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        if (!reg) return;
        // 開いている間も新バージョンを拾えるよう、起動時＋定期的に更新チェック。
        try { reg.update(); } catch (e) {}
        setInterval(function () { try { reg.update(); } catch (e) {} }, 60 * 60 * 1000);
      }).catch(function () { /* オフライン無効でも動く */ });
    });
    // タブに戻ってきたタイミングでも更新を確認（公開直後をすばやく反映）。
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg) { try { reg.update(); } catch (e) {} }
      }).catch(function () {});
    });
  }

  /* ---------- 初期描画 ---------- */
  render();
})();
