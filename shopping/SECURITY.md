# セキュリティポリシー / Security Policy

「おかいものメモ」のセキュリティ方針です。本アプリは**サーバーを持たない静的な
PWA**（HTML/CSS/バニラJS）で、GitHub Pages 上で配信されます。アカウント・ログイン・
サーバー側DBはありません。

## データの取り扱い（プライバシー）

- **すべてのデータは利用者の端末内（localStorage）にのみ保存**します。買い物リスト・
  献立・写真・在庫・称号などはサーバーへ送信されません。
- アカウント登録・ログインは不要。トラッキングや広告SDKは入れていません。
- 料理写真は端末内に保存され、共有するときだけ OS の共有機能（Web Share API）で
  ユーザー操作により外部アプリへ渡されます。

## 外部サービス（オンライン時の拡張機能のみ）

「お店」タブを使ったときだけ、以下に**最小限**のリクエストを送ります。位置情報は
ユーザーが許可したときのみ取得し、検索クエリの座標としてのみ使用します。

| 宛先 | 用途 | 送る情報 |
|------|------|----------|
| `overpass-api.de` | 近隣店舗の検索（OpenStreetMap Overpass API） | 現在地の座標と検索条件 |
| `*.tile.openstreetmap.org` | 地図タイル画像 | 表示範囲のタイル座標 |
| `unpkg.com` | 地図ライブラリ Leaflet の読み込み（SRIで検証） | なし（静的アセット） |
| `fonts.googleapis.com` / `fonts.gstatic.com` | 丸ゴシックフォント | なし（静的アセット） |

外部リンク（クックパッド/X/Facebook）は新規タブで開き、すべて
`rel="noopener noreferrer"` を付与しています。

## 多層防御（実装している対策）

- **Content Security Policy (CSP)**：`script-src` は自分自身と地図CDN(`unpkg.com`)
  のみ許可。**インラインスクリプト・`eval` は不許可**。接続先・画像・フォント・
  スタイルの取得元もホワイトリストで制限し、XSS やデータ持ち出しの被害を最小化します。
- **Subresource Integrity (SRI)**：CDNから読み込む Leaflet（JS/CSS）に SHA-256 の
  整合性ハッシュを付与。改ざん・差し替えがあれば読み込みを拒否し、地図は一覧のみに
  フォールバックします。
- **出力エスケープ**：画面に出す動的テキストはすべて `textContent` 経由で生成し、
  ユーザー入力を `innerHTML` に流し込みません（DOMベースXSSの防止）。
- **Referrer 最小化**：`referrer` ポリシーを `strict-origin-when-cross-origin` に設定。
- **HTTPS / 自動格上げ**：GitHub Pages の HTTPS で配信。CSP の
  `upgrade-insecure-requests` で混在コンテンツを抑止します。
- **クリックジャッキング対策**：別オリジンの iframe に埋め込まれた場合はトップへ
  復帰／表示停止する保険を入れています。
- **入力制限**：各入力欄に `maxlength` を設定。数量・予算などは数値入力に限定。

## 既知の制約

- GitHub Pages では HTTP レスポンスヘッダ（`X-Frame-Options`、`X-Content-Type-Options`、
  ヘッダ版CSPの `frame-ancestors` など）を設定できません。可能な範囲を `<meta>` と
  JavaScript の保険で代替しています。独自ドメイン＋ヘッダ設定可能なホスティングに
  すれば、さらに強化できます。

## 脆弱性の報告

セキュリティ上の問題を見つけた場合は、**公開 issue ではなく**、GitHub の
**Security Advisories（Report a vulnerability）** から非公開でご連絡ください。
できるだけ早く確認し、対応します。再現手順・影響範囲を添えていただけると助かります。
