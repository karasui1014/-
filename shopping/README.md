# おかいものメモ 🐱🧺

主婦のための、**かわいい**お買い物リスト PWA。
スマホ単体で完結（端末内保存・ログイン不要・無料・オフラインOK）。
よく買うものはワンタップ、店内は売り場順でスイスイ。

> 純フロントエンド（HTML / CSS / バニラ JS）。ビルド不要・サーバー不要。

---

## ✨ できること（Phase 1 / MVP）

- **買うものリスト** … 追加 / 数量変更 / チェックで「カゴに入れた」/ 削除。完了品は下に薄く移動。
- **予測入力（学習）** … 一度書いたものを覚えて、入力途中でサジェスト。よく買うものは「⭐よく買う」タブからワンタップ追加。単位・単価も前回値を自動補完。
- **売り場順の並び替え** … 商品名から自動でカテゴリ分類し、野菜→お肉→お魚→乳製品…の売り場順にカード表示。
- **予算・合計金額の概算** … 品ごとの単価を記憶してカゴ合計をリアルタイム表示。予算バー＋オーバー時のやさしい警告。
- **かわいいUI ＋ PWA** … パステル配色・丸ゴシック・子ねこマスコット・チェック時の「えらい！」ご褒美演出。ホーム画面に追加＆オフライン動作。

データはすべて端末内（`localStorage`）に保存され、外部に送信されません。

---

## 📁 ファイル構成

```
shopping/
├── index.html       … 画面（ヘッダー／リスト／追加バー／タブ）
├── style.css        … パステルテーマ（CSS変数）＋丸ゴシック
├── app.js           … リストCRUD・localStorage・予測学習・予算・演出
├── categories.js    … 売り場カテゴリ定義＋自動分類辞書
├── manifest.json    … PWAマニフェスト
├── sw.js            … Service Worker（オフライン・キャッシュ）
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

### データモデル（localStorage キー）
| キー | 内容 |
|------|------|
| `okaimono.items` | 今のリスト `[{id,name,category,qty,unit,price,checked,addedAt}]` |
| `okaimono.catalog` | 学習辞書 `[{name,category,count,lastUsed,defaultUnit,defaultPrice}]` |
| `okaimono.staples` | 「いつもの」定番品（ワンタップ追加用） |
| `okaimono.budget` | 予算設定 |
| `okaimono.settings` | 売り場順ON/OFF・合計表示ON/OFF など |

> Phase 2（献立・在庫）/ Phase 3（お店検索・ルート）で `inventory` / `stores` などを追加予定。

---

## 🏃 ローカルで動かす

ブラウザのセキュリティ上、Service Worker は `file://` では動かないため、簡易サーバで開きます。

```bash
cd shopping
python3 -m http.server 8000
# → ブラウザで http://localhost:8000/ を開く
```

スマホで確認する場合は、PCと同じWi-Fiで `http://<PCのIP>:8000/` を開きます。

---

## 🚀 デプロイ（無料・ビルド不要）

静的ファイルだけなので、そのまま公開できます。

- **Cloudflare Pages** … リポジトリを連携。Build command なし、出力ディレクトリに `shopping`（またはルート）を指定。
- **GitHub Pages** … リポジトリの Settings → Pages で公開ブランチを指定。`/shopping/` 配下のURLで開く。

> PWA（ホーム画面に追加・オフライン）には **HTTPS** が必要です。上記サービスは標準でHTTPS対応です。

---

## ✅ 動作確認（Verification）

- **永続化**：品を追加 → リロード → 残っていること。再入力でサジェスト候補に出ること。
- **売り場順**：野菜・肉・日用品を混ぜて追加 → カテゴリ順に並ぶこと（設定でON/OFF切替）。
- **予算**：単価入力 → 合計とバーがリアルタイム更新、予算超過でやさしい警告。
- **PWA**：`manifest.json` / `sw.js` 認識・「ホーム画面に追加」可・機内モードでコア機能が動くこと。

---

## 🗺 今後（別PR予定）

- **Phase 2** … 献立から材料を自動追加 / 買い忘れリマインド・在庫メモ
- **Phase 3** … 位置情報で近くのスーパー検索 ＆ 効率よく回るルート提案（OpenStreetMap・Leaflet）

---

made with 🩷 for everyday shopping.
