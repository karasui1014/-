/* =========================================================================
 * recipes.js — 献立（レシピ）→ 材料 ＋ かんたんな作り方
 * 献立を選ぶと材料がまとめてリストに入る。作り方は短い手順＋クックパッド検索。
 * 材料名は categories.js で売り場分類されるよう一般的な呼び方にしている。
 * window.OKAIMONO_RECIPES として公開。
 * ========================================================================= */
(function (global) {
  'use strict';

  // items: 材料（name 必須、qty/unit 任意）。steps: かんたんな作り方。
  var RECIPES = [
    {
      id: 'curry', name: 'カレーライス', emoji: '🍛',
      items: [
        { name: '豚こま肉', qty: 1 }, { name: 'じゃがいも', qty: 3 },
        { name: 'にんじん', qty: 1 }, { name: '玉ねぎ', qty: 2 },
        { name: 'カレールー', qty: 1 }, { name: 'お米', qty: 1 }
      ],
      steps: [
        '野菜と肉を一口大に切る',
        '鍋で肉→玉ねぎ→にんじん・じゃがいもの順に炒める',
        '水を入れて15分ほど煮る（アクを取る）',
        '火を止めてルーを溶かし、とろみが出るまで弱火で煮る',
        'ごはんによそって完成'
      ]
    },
    {
      id: 'nikujaga', name: '肉じゃが', emoji: '🥘',
      items: [
        { name: '牛こま肉', qty: 1 }, { name: 'じゃがいも', qty: 3 },
        { name: 'にんじん', qty: 1 }, { name: '玉ねぎ', qty: 1 },
        { name: 'しらたき', qty: 1 }, { name: '醤油', qty: 1 }, { name: 'みりん', qty: 1 }
      ],
      steps: [
        '野菜を乱切り、玉ねぎはくし切りにする',
        '鍋で肉を炒め、野菜も加えて炒める',
        'だし汁・砂糖・みりん・醤油を入れて落としぶた',
        'じゃがいもが柔らかくなるまで中火で煮る'
      ]
    },
    {
      id: 'misoshiru', name: 'お味噌汁', emoji: '🍲',
      items: [
        { name: '豆腐', qty: 1 }, { name: 'わかめ', qty: 1 },
        { name: 'ねぎ', qty: 1 }, { name: '味噌', qty: 1 }, { name: 'だし', qty: 1 }
      ],
      steps: [
        'だしを沸かす',
        '豆腐とわかめを入れてひと煮立ち',
        '火を弱めて味噌を溶き入れる',
        'ねぎを散らして完成（煮立たせない）'
      ]
    },
    {
      id: 'oyakodon', name: '親子丼', emoji: '🍚',
      items: [
        { name: '鶏もも肉', qty: 1 }, { name: '玉ねぎ', qty: 1 },
        { name: 'たまご', qty: 1 }, { name: '醤油', qty: 1 },
        { name: 'みりん', qty: 1 }, { name: 'お米', qty: 1 }
      ],
      steps: [
        '鶏肉と玉ねぎを薄めに切る',
        'だし・醤油・みりんを煮立て、鶏と玉ねぎを煮る',
        '溶き卵を回し入れ、半熟でふたをして火を止める',
        '温かいごはんにのせる'
      ]
    },
    {
      id: 'hamburg', name: 'ハンバーグ', emoji: '🍔',
      items: [
        { name: '合いびき肉', qty: 1 }, { name: '玉ねぎ', qty: 1 },
        { name: 'パン粉', qty: 1 }, { name: 'たまご', qty: 1 },
        { name: 'ケチャップ', qty: 1 }, { name: 'ソース', qty: 1 }
      ],
      steps: [
        '玉ねぎをみじん切りにして炒め、冷ます',
        'ひき肉・玉ねぎ・卵・パン粉・塩こしょうをよく練る',
        '小判形にして中央をくぼませる',
        '中火で焼き、ふたをして蒸し焼きに',
        'ケチャップ＋ソースを煮詰めてかける'
      ]
    },
    {
      id: 'shogayaki', name: '生姜焼き', emoji: '🐖',
      items: [
        { name: '豚ロース肉', qty: 1 }, { name: '玉ねぎ', qty: 1 },
        { name: 'しょうが', qty: 1 }, { name: '醤油', qty: 1 }, { name: 'みりん', qty: 1 }
      ],
      steps: [
        'しょうがをすりおろし、醤油・みりん・酒とタレを作る',
        '豚肉と玉ねぎを焼く',
        'タレを絡めて照りが出たら完成'
      ]
    },
    {
      id: 'nabe', name: 'お鍋', emoji: '🍲',
      items: [
        { name: '白菜', qty: 1 }, { name: 'ねぎ', qty: 1 }, { name: '豆腐', qty: 1 },
        { name: 'しめじ', qty: 1 }, { name: '鶏もも肉', qty: 1 }, { name: 'ポン酢', qty: 1 }
      ],
      steps: [
        '具材を食べやすく切る',
        'だしを張った鍋に火の通りにくいものから入れる',
        '煮えたらポン酢でいただく'
      ]
    },
    {
      id: 'chahan', name: 'チャーハン', emoji: '🍚',
      items: [
        { name: 'お米', qty: 1 }, { name: 'たまご', qty: 1 },
        { name: 'ねぎ', qty: 1 }, { name: 'ハム', qty: 1 }, { name: '醤油', qty: 1 }
      ],
      steps: [
        '具を細かく切る',
        '熱した油に溶き卵→すぐごはんを入れて炒める',
        'ハム・ねぎを加え、醤油・塩こしょうで味付け',
        '鍋肌に醤油を回して香ばしく仕上げる'
      ]
    },
    {
      id: 'mabo', name: '麻婆豆腐', emoji: '🌶️',
      items: [
        { name: '豆腐', qty: 2 }, { name: '豚ひき肉', qty: 1 },
        { name: 'ねぎ', qty: 1 }, { name: 'にんにく', qty: 1 }, { name: 'しょうが', qty: 1 }
      ],
      steps: [
        '豆腐を角切り、にんにく・しょうが・ねぎをみじん切り',
        'ひき肉を炒め、薬味と豆板醤を加える',
        '水・鶏がら・醤油で味付けし豆腐を入れる',
        '水溶き片栗粉でとろみをつける'
      ]
    },
    {
      id: 'salad', name: 'サラダ', emoji: '🥗',
      items: [
        { name: 'レタス', qty: 1 }, { name: 'トマト', qty: 2 },
        { name: 'きゅうり', qty: 1 }, { name: 'ドレッシング', qty: 1 }
      ],
      steps: [
        '野菜を洗って食べやすく切る',
        '冷やしておく',
        '食べる直前にドレッシングをかける'
      ]
    },
    {
      id: 'yakizakana', name: '焼き魚定食', emoji: '🐟',
      items: [
        { name: 'さけ', qty: 2 }, { name: '大根', qty: 1 },
        { name: 'お米', qty: 1 }, { name: '味噌', qty: 1 }
      ],
      steps: [
        '鮭に軽く塩をふって少し置く',
        'グリルで両面を焼く',
        '大根をおろして添える',
        'ごはん・お味噌汁と一緒に'
      ]
    },
    {
      id: 'pasta', name: 'ミートスパゲティ', emoji: '🍝',
      items: [
        { name: 'パスタ', qty: 1 }, { name: '合いびき肉', qty: 1 },
        { name: '玉ねぎ', qty: 1 }, { name: 'トマト缶', qty: 1 }, { name: 'にんにく', qty: 1 }
      ],
      steps: [
        'にんにく・玉ねぎをみじん切りにして炒める',
        'ひき肉を加えて炒め、トマト缶を入れて煮込む',
        '塩こしょう・ケチャップで味を調える',
        'ゆでたパスタと和える'
      ]
    }
  ];

  /* =======================================================================
   * ズボラメシ（時短・節約のかんたんメニュー）
   * cat: rice=米類 / noodle=麺類 / solo=一人暮らし飯 / saving=1000円以下節約飯
   * ===================================================================== */
  var ZUBORA = [
    { id: 'z_tkg', name: '卵かけご飯', emoji: '🍚', cat: 'rice',
      items: [{ name: 'ご飯', qty: 1 }, { name: 'たまご', qty: 1 }, { name: '醤油', qty: 1 }],
      steps: ['温かいご飯にたまごを割り入れる', '醤油をひとまわし、よく混ぜる'] },
    { id: 'z_tunamayo', name: 'ツナマヨ丼', emoji: '🍙', cat: 'rice',
      items: [{ name: 'ご飯', qty: 1 }, { name: 'ツナ缶', qty: 1 }, { name: 'マヨネーズ', qty: 1 }, { name: '醤油', qty: 1 }],
      steps: ['ツナ缶の油を切ってマヨ・醤油で和える', 'ご飯にのせる'] },
    { id: 'z_natto', name: '納豆ご飯', emoji: '🫛', cat: 'rice',
      items: [{ name: 'ご飯', qty: 1 }, { name: '納豆', qty: 1 }, { name: 'ねぎ', qty: 1 }],
      steps: ['納豆をよく混ぜる', 'ご飯にのせ、ねぎを散らす'] },
    { id: 'z_yakiniku', name: '焼き肉のっけ丼', emoji: '🥩', cat: 'rice',
      items: [{ name: 'ご飯', qty: 1 }, { name: '豚こま肉', qty: 1 }, { name: '焼肉のたれ', qty: 1 }],
      steps: ['豚こまを焼いて焼肉のたれを絡める', 'ご飯にのせる'] },
    { id: 'z_kamatama', name: '釜玉うどん', emoji: '🍜', cat: 'noodle',
      items: [{ name: 'うどん', qty: 1 }, { name: 'たまご', qty: 1 }, { name: 'めんつゆ', qty: 1 }, { name: 'ねぎ', qty: 1 }],
      steps: ['うどんを茹でて湯切り', '熱いうちに卵・めんつゆを絡め、ねぎを散らす'] },
    { id: 'z_aburasoba', name: '油そば風', emoji: '🍝', cat: 'noodle',
      items: [{ name: '中華麺', qty: 1 }, { name: 'ごま油', qty: 1 }, { name: '醤油', qty: 1 }, { name: 'ねぎ', qty: 1 }, { name: 'たまご', qty: 1 }],
      steps: ['麺を茹でて湯切り', 'ごま油・醤油・酢を絡め、卵黄とねぎをのせる'] },
    { id: 'z_nattopasta', name: '納豆パスタ', emoji: '🍝', cat: 'noodle',
      items: [{ name: 'パスタ', qty: 1 }, { name: '納豆', qty: 1 }, { name: 'めんつゆ', qty: 1 }, { name: 'のり', qty: 1 }],
      steps: ['パスタを茹でる', '納豆・めんつゆを和えて、のりをのせる'] },
    { id: 'z_peperon', name: 'ペペロンチーノ', emoji: '🍝', cat: 'noodle',
      items: [{ name: 'パスタ', qty: 1 }, { name: 'にんにく', qty: 1 }, { name: '唐辛子', qty: 1 }, { name: 'オリーブオイル', qty: 1 }],
      steps: ['にんにくと唐辛子を油で熱する', '茹でたパスタと和えて塩で調える'] },
    { id: 'z_hitorinabe', name: '一人鍋', emoji: '🍲', cat: 'solo',
      items: [{ name: '白菜', qty: 1 }, { name: '豆腐', qty: 1 }, { name: '豚こま肉', qty: 1 }, { name: 'ポン酢', qty: 1 }],
      steps: ['だしを張り、具材を入れて煮る', 'ポン酢でいただく'] },
    { id: 'z_mushidori', name: 'レンジ蒸し鶏', emoji: '🐔', cat: 'solo',
      items: [{ name: '鶏むね肉', qty: 1 }, { name: '塩', qty: 1 }, { name: '料理酒', qty: 1 }],
      steps: ['鶏むねに塩・酒をふる', 'ラップしてレンジで加熱、そぎ切り'] },
    { id: 'z_champuru', name: '豆腐チャンプルー', emoji: '🍳', cat: 'solo',
      items: [{ name: '豆腐', qty: 1 }, { name: 'たまご', qty: 1 }, { name: 'もやし', qty: 1 }, { name: '醤油', qty: 1 }],
      steps: ['豆腐を炒めて一度出す', 'もやしを炒め、豆腐・卵を戻して醤油で味付け'] },
    { id: 'z_yasaiitame', name: '野菜炒め', emoji: '🥬', cat: 'solo',
      items: [{ name: 'キャベツ', qty: 1 }, { name: 'もやし', qty: 1 }, { name: '豚こま肉', qty: 1 }, { name: '塩こしょう', qty: 1 }],
      steps: ['豚こまを炒める', '野菜を加えて塩こしょうで手早く炒める'] },
    { id: 'z_moyashi', name: 'もやし炒め', emoji: '🌱', cat: 'saving',
      items: [{ name: 'もやし', qty: 2 }, { name: '豚こま肉', qty: 1 }, { name: '醤油', qty: 1 }],
      steps: ['豚こまを炒める', 'もやしを加えて醤油でさっと炒める'] },
    { id: 'z_tamagocha', name: '卵チャーハン', emoji: '🍚', cat: 'saving',
      items: [{ name: 'ご飯', qty: 1 }, { name: 'たまご', qty: 1 }, { name: 'ねぎ', qty: 1 }, { name: '醤油', qty: 1 }],
      steps: ['卵を炒めてご飯を入れる', 'ねぎ・醤油で味付けして仕上げる'] },
    { id: 'z_udonsuki', name: 'うどんすき', emoji: '🍲', cat: 'saving',
      items: [{ name: 'うどん', qty: 1 }, { name: '白菜', qty: 1 }, { name: '油揚げ', qty: 1 }, { name: 'めんつゆ', qty: 1 }],
      steps: ['めんつゆのだしで白菜と油揚げを煮る', 'うどんを入れて温める'] },
    { id: 'z_okonomi', name: 'お好み焼き', emoji: '🥞', cat: 'saving',
      items: [{ name: 'キャベツ', qty: 1 }, { name: '小麦粉', qty: 1 }, { name: 'たまご', qty: 1 }, { name: 'ソース', qty: 1 }],
      steps: ['刻んだキャベツ・粉・卵・水を混ぜる', '両面焼いてソースをかける'] }
  ];

  // ズボラメシのカテゴリ表示名。
  var ZUBORA_CATS = [
    { key: 'rice',   label: '米類',          emoji: '🍚' },
    { key: 'noodle', label: '麺類',          emoji: '🍜' },
    { key: 'solo',   label: '一人暮らし飯',  emoji: '🍳' },
    { key: 'saving', label: '1000円以下節約飯', emoji: '💰' }
  ];

  /* =======================================================================
   * 材料の自動推定（登録にない料理でも「これを作る」できるように）
   *  - keys：料理名にこのキーワードが含まれたら items を使う（長い一致を優先）
   *  - ネット接続やAPIキー不要で、端末内で瞬時に推定する簡易エンジン
   * ===================================================================== */
  var GUESS = [
    { keys: ['クリームシチュー', 'シチュー'], items: ['鶏もも肉', 'じゃがいも', 'にんじん', '玉ねぎ', 'シチュールー', '牛乳'] },
    { keys: ['グラタン'], items: ['マカロニ', '鶏もも肉', '玉ねぎ', '牛乳', 'チーズ', 'バター'] },
    { keys: ['オムライス'], items: ['お米', 'たまご', '鶏もも肉', '玉ねぎ', 'ケチャップ'] },
    { keys: ['からあげ', '唐揚げ', 'から揚げ'], items: ['鶏もも肉', '醤油', 'にんにく', 'しょうが', '片栗粉'] },
    { keys: ['コロッケ'], items: ['じゃがいも', '合いびき肉', '玉ねぎ', 'パン粉'] },
    { keys: ['餃子', 'ぎょうざ', 'ギョウザ'], items: ['豚ひき肉', 'キャベツ', 'にら', '餃子の皮'] },
    { keys: ['すき焼き', 'すきやき'], items: ['牛肉', '白菜', 'ねぎ', 'しらたき', '焼き豆腐', '醤油', '砂糖'] },
    { keys: ['しゃぶしゃぶ'], items: ['豚肉', '白菜', 'ねぎ', '豆腐', 'ポン酢'] },
    { keys: ['ハヤシライス', 'ハヤシ'], items: ['牛こま肉', '玉ねぎ', 'ハヤシルー', 'お米'] },
    { keys: ['チンジャオロース', '青椒肉絲'], items: ['牛肉', 'ピーマン', 'たけのこ', 'オイスターソース'] },
    { keys: ['酢豚'], items: ['豚肉', 'ピーマン', '玉ねぎ', 'にんじん', 'ケチャップ', '酢'] },
    { keys: ['エビフライ', 'えびフライ'], items: ['えび', 'パン粉', 'たまご', '小麦粉'] },
    { keys: ['とんかつ', 'トンカツ', 'カツ'], items: ['豚ロース肉', 'パン粉', 'たまご', 'キャベツ'] },
    { keys: ['カルボナーラ'], items: ['パスタ', 'ベーコン', 'たまご', '生クリーム', 'チーズ'] },
    { keys: ['チキン南蛮'], items: ['鶏もも肉', 'たまご', '酢', '砂糖', 'マヨネーズ'] },
    { keys: ['麻婆なす', 'マーボーナス', '麻婆茄子'], items: ['なす', '豚ひき肉', '豆板醤', 'ねぎ'] },
    { keys: ['ぶり大根', 'ブリ大根'], items: ['ぶり', '大根', '醤油', 'みりん'] },
    { keys: ['さばの味噌煮', 'サバの味噌煮', 'さば味噌'], items: ['さば', '味噌', 'みりん', 'しょうが'] },
    { keys: ['肉豆腐'], items: ['牛こま肉', '豆腐', 'ねぎ', '醤油', 'みりん'] },
    { keys: ['ロールキャベツ'], items: ['キャベツ', '合いびき肉', '玉ねぎ', 'コンソメ'] },
    { keys: ['ポテトサラダ', 'ポテサラ'], items: ['じゃがいも', 'きゅうり', 'にんじん', 'ハム', 'マヨネーズ'] },
    { keys: ['きんぴら'], items: ['ごぼう', 'にんじん', '醤油', 'ごま油'] },
    { keys: ['たこ焼き', 'タコ焼き'], items: ['たこ', 'たこ焼き粉', 'たまご', 'ねぎ', 'ソース'] },
    { keys: ['おでん'], items: ['大根', 'たまご', 'ちくわ', 'こんにゃく', 'だし'] },
    { keys: ['ピザ'], items: ['ピザ生地', 'チーズ', 'トマトソース', 'ピーマン'] },
    { keys: ['グリーンカレー'], items: ['鶏もも肉', 'ココナッツミルク', 'なす', 'グリーンカレーペースト'] },
    { keys: ['天ぷら', 'てんぷら'], items: ['えび', 'なす', 'かぼちゃ', '天ぷら粉'] },
    { keys: ['ラーメン'], items: ['中華麺', 'ねぎ', 'チャーシュー', 'メンマ'] },
    { keys: ['焼きそば', 'やきそば'], items: ['焼きそば麺', 'キャベツ', '豚こま肉', 'ソース'] },
    { keys: ['おにぎり'], items: ['お米', 'のり', '塩'] }
  ];

  function normalizeJ(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '')
      .replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
  }

  // 料理名から材料を推定する。当たらなければ null。
  function guessIngredients(name) {
    var n = normalizeJ(name);
    if (!n) return null;
    var best = null, bestLen = 0;
    GUESS.forEach(function (g) {
      g.keys.forEach(function (k) {
        var nk = normalizeJ(k);
        if (n.indexOf(nk) !== -1 && nk.length > bestLen) { bestLen = nk.length; best = g; }
      });
    });
    if (best) return best.items.slice();

    // キーワードのざっくりルール（語尾・含み）で最後の推定。
    var rules = [
      { t: ['カレー', 'かれー'], items: ['豚こま肉', 'じゃがいも', 'にんじん', '玉ねぎ', 'カレールー', 'お米'] },
      { t: ['鍋', 'なべ'], items: ['白菜', 'ねぎ', '豆腐', '鶏もも肉', 'ポン酢'] },
      { t: ['サラダ', 'さらだ'], items: ['レタス', 'トマト', 'きゅうり', 'ドレッシング'] },
      { t: ['パスタ', 'スパゲ', 'ぱすた'], items: ['パスタ', 'にんにく', '玉ねぎ', 'オリーブオイル'] },
      { t: ['うどん', 'そば'], items: ['うどん', 'ねぎ', 'めんつゆ'] },
      { t: ['チャーハン', 'ちゃーはん', '炒飯'], items: ['お米', 'たまご', 'ねぎ', '醤油'] },
      { t: ['炒め', 'いため'], items: ['豚こま肉', 'キャベツ', 'もやし', '醤油'] },
      { t: ['スープ', 'すーぷ', '汁'], items: ['玉ねぎ', 'にんじん', 'コンソメ', 'ねぎ'] },
      { t: ['丼', 'どん'], items: ['お米', '玉ねぎ', 'たまご', '醤油'] },
      { t: ['焼き魚', '塩焼き'], items: ['さけ', '大根', '塩'] }
    ];
    for (var i = 0; i < rules.length; i++) {
      for (var j = 0; j < rules[i].t.length; j++) {
        if (n.indexOf(normalizeJ(rules[i].t[j])) !== -1) return rules[i].items.slice();
      }
    }
    return null;
  }

  global.OKAIMONO_RECIPES = {
    list: RECIPES,
    zubora: ZUBORA,
    zuboraCats: ZUBORA_CATS,
    guess: guessIngredients
  };
})(window);
