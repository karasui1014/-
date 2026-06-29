/* =========================================================================
 * recipes.js — 献立（レシピ）→ 材料 の初期データ
 * 献立を選ぶと、材料がまとめてお買い物リストに入る。
 * 材料名は categories.js で売り場分類されるよう、一般的な呼び方にしている。
 * window.OKAIMONO_RECIPES として公開。
 * ========================================================================= */
(function (global) {
  'use strict';

  // items: 材料。name は必須、qty/unit は任意（省略は 1）。
  var RECIPES = [
    {
      id: 'curry', name: 'カレーライス', emoji: '🍛',
      items: [
        { name: '豚こま肉', qty: 1 }, { name: 'じゃがいも', qty: 3 },
        { name: 'にんじん', qty: 1 }, { name: '玉ねぎ', qty: 2 },
        { name: 'カレールー', qty: 1 }, { name: 'お米', qty: 1 }
      ]
    },
    {
      id: 'nikujaga', name: '肉じゃが', emoji: '🥘',
      items: [
        { name: '牛こま肉', qty: 1 }, { name: 'じゃがいも', qty: 3 },
        { name: 'にんじん', qty: 1 }, { name: '玉ねぎ', qty: 1 },
        { name: 'しらたき', qty: 1 }, { name: '醤油', qty: 1 }, { name: 'みりん', qty: 1 }
      ]
    },
    {
      id: 'misoshiru', name: 'お味噌汁', emoji: '🍲',
      items: [
        { name: '豆腐', qty: 1 }, { name: 'わかめ', qty: 1 },
        { name: 'ねぎ', qty: 1 }, { name: '味噌', qty: 1 }, { name: 'だし', qty: 1 }
      ]
    },
    {
      id: 'oyakodon', name: '親子丼', emoji: '🍚',
      items: [
        { name: '鶏もも肉', qty: 1 }, { name: '玉ねぎ', qty: 1 },
        { name: 'たまご', qty: 1 }, { name: '醤油', qty: 1 },
        { name: 'みりん', qty: 1 }, { name: 'お米', qty: 1 }
      ]
    },
    {
      id: 'hamburg', name: 'ハンバーグ', emoji: '🍔',
      items: [
        { name: '合いびき肉', qty: 1 }, { name: '玉ねぎ', qty: 1 },
        { name: 'パン粉', qty: 1 }, { name: 'たまご', qty: 1 },
        { name: 'ケチャップ', qty: 1 }, { name: 'ソース', qty: 1 }
      ]
    },
    {
      id: 'shogayaki', name: '生姜焼き', emoji: '🐖',
      items: [
        { name: '豚ロース肉', qty: 1 }, { name: '玉ねぎ', qty: 1 },
        { name: 'しょうが', qty: 1 }, { name: '醤油', qty: 1 }, { name: 'みりん', qty: 1 }
      ]
    },
    {
      id: 'nabe', name: 'お鍋', emoji: '🍲',
      items: [
        { name: '白菜', qty: 1 }, { name: 'ねぎ', qty: 1 }, { name: '豆腐', qty: 1 },
        { name: 'しめじ', qty: 1 }, { name: '鶏もも肉', qty: 1 }, { name: 'ポン酢', qty: 1 }
      ]
    },
    {
      id: 'chahan', name: 'チャーハン', emoji: '🍚',
      items: [
        { name: 'お米', qty: 1 }, { name: 'たまご', qty: 1 },
        { name: 'ねぎ', qty: 1 }, { name: 'ハム', qty: 1 }, { name: '醤油', qty: 1 }
      ]
    },
    {
      id: 'mabo', name: '麻婆豆腐', emoji: '🌶️',
      items: [
        { name: '豆腐', qty: 2 }, { name: '豚ひき肉', qty: 1 },
        { name: 'ねぎ', qty: 1 }, { name: 'にんにく', qty: 1 }, { name: 'しょうが', qty: 1 }
      ]
    },
    {
      id: 'salad', name: 'サラダ', emoji: '🥗',
      items: [
        { name: 'レタス', qty: 1 }, { name: 'トマト', qty: 2 },
        { name: 'きゅうり', qty: 1 }, { name: 'ドレッシング', qty: 1 }
      ]
    },
    {
      id: 'yakizakana', name: '焼き魚定食', emoji: '🐟',
      items: [
        { name: 'さけ', qty: 2 }, { name: '大根', qty: 1 },
        { name: 'お米', qty: 1 }, { name: '味噌', qty: 1 }
      ]
    },
    {
      id: 'pasta', name: 'ミートスパゲティ', emoji: '🍝',
      items: [
        { name: 'パスタ', qty: 1 }, { name: '合いびき肉', qty: 1 },
        { name: '玉ねぎ', qty: 1 }, { name: 'トマト缶', qty: 1 }, { name: 'にんにく', qty: 1 }
      ]
    }
  ];

  global.OKAIMONO_RECIPES = { list: RECIPES };
})(window);
