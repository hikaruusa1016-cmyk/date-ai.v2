# 🎯 あなたがやること（完全チェックリスト）

このファイルに従って作業すれば、安全にVercelにデプロイできます！

---

## ✅ ステップ1: 最終確認（5分）

### 1.1 Gitの確認

```bash
# プロジェクトディレクトリで実行
cd /Users/omotehikaru/Documents/開発用/date-ai.v2

# .envファイルがGitに含まれていないことを確認
git status

# もし.envが表示されたら、以下を実行
git rm --cached backend/.env
git rm --cached .env
```

**確認項目**:
- [ ] `.env`ファイルがgit statusに表示されない
- [ ] `.gitignore`に`.env`が含まれている

### 1.2 APIキーの確認

```bash
# 現在のAPIキーを確認
cat backend/.env | grep GOOGLE_MAPS_API_KEY
```

**このキーをメモしておく**: `AIzaSyA_le6vbQ0Lm2auWAfT72b6Uhq58pM-iLQ`

---

## ✅ ステップ2: Google Cloud設定（10分）

### 2.1 HTTPリファラーの設定

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) を開く
2. APIキー `AIzaSyA_le6vbQ0Lm2auWAfT72b6Uhq58pM-iLQ` をクリック
3. **「アプリケーションの制限」** → **「HTTPリファラー」** を選択
4. 以下を追加:

```
https://*.vercel.app/*
http://localhost:*
```

5. **「保存」** をクリック

**確認項目**:
- [ ] HTTPリファラーが設定されている
- [ ] `*.vercel.app`と`localhost`が含まれている

### 2.2 API制限の設定

同じページで:

1. **「APIの制限」** → **「キーを制限する」** を選択
2. 以下のAPIのみチェック:
   - [ ] ✅ Maps JavaScript API
   - [ ] ✅ Places API (New)
3. **「保存」** をクリック

### 2.3 日次クォータの設定

1. [Places API Quotas](https://console.cloud.google.com/apis/api/places-backend.googleapis.com/quotas) を開く
2. 「Text Search (New)」をクリック
3. **「Edit Quotas」** をクリック
4. **「1000」** に設定
5. **「Save」** をクリック

**確認項目**:
- [ ] Places API: 1日1000リクエストまで
- [ ] 設定が保存されている

### 2.4 請求アラートの設定

1. [Billing Alerts](https://console.cloud.google.com/billing) を開く
2. **「Create Budget」** をクリック
3. 以下を設定:
   - Budget name: `date-ai-monthly-budget`
   - Amount: `$50`
   - Threshold rules:
     - 50% → メール通知
     - 90% → メール通知
     - 100% → メール通知
4. **「Finish」** をクリック

**確認項目**:
- [ ] 月$50の予算アラートが設定されている
- [ ] メール通知が有効になっている

---

## ✅ ステップ3: GitHubリポジトリ作成（5分）

### 3.1 GitHubで新しいリポジトリを作成

1. [GitHub](https://github.com/new) を開く
2. Repository name: `date-ai`
3. Visibility: **Private**（推奨）または Public
4. **「Create repository」** をクリック

### 3.2 ローカルからプッシュ

```bash
cd /Users/omotehikaru/Documents/開発用/date-ai.v2

# Gitの初期化（まだの場合）
git init
git add .
git commit -m "Initial commit: Date planning AI app"

# GitHubリポジトリに接続
git remote add origin https://github.com/YOUR_USERNAME/date-ai.git
git branch -M main
git push -u origin main
```

**YOUR_USERNAMEを自分のGitHubユーザー名に置き換える**

**確認項目**:
- [ ] GitHubにコードがプッシュされている
- [ ] `.env`ファイルが含まれていない（GitHubで確認）

---

## ✅ ステップ4: Vercelデプロイ（10分）

### 4.1 Vercelにサインアップ

1. [Vercel](https://vercel.com/signup) を開く
2. **「Continue with GitHub」** をクリック
3. 権限を許可

### 4.2 プロジェクトをインポート

1. [Vercel Dashboard](https://vercel.com/new) を開く
2. **「Import Git Repository」** をクリック
3. `date-ai` リポジトリを選択
4. **「Import」** をクリック

### 4.3 環境変数を設定（重要！）

**「Environment Variables」** セクションで以下を追加:

| Name | Value | Environment |
|------|-------|-------------|
| `GOOGLE_MAPS_API_KEY` | `AIzaSyA_le6vbQ0Lm2auWAfT72b6Uhq58pM-iLQ` | Production, Preview, Development |
| `NODE_ENV` | `production` | Production のみ |

**オプション（OpenAI APIを使う場合）**:

| Name | Value | Environment |
|------|-------|-------------|
| `OPENAI_API_KEY` | `sk-...`（あなたのキー） | Production, Preview, Development |

### 4.4 デプロイ

1. すべての環境変数を追加したら **「Deploy」** をクリック
2. 2-3分待つ
3. デプロイ完了後、URLをコピー（例: `https://date-ai-abc123.vercel.app`）

**確認項目**:
- [ ] デプロイが成功している
- [ ] URLをコピーした

---

## ✅ ステップ5: 動作確認（10分）

### 5.1 基本動作の確認

デプロイしたURL（`https://date-ai-abc123.vercel.app`）を開く:

- [ ] ページが表示される
- [ ] フォームが動作する
- [ ] プラン生成ボタンを押す
- [ ] プランが生成される
- [ ] 地図が表示される
- [ ] 「Google Mapsでルート全体を見る」ボタンが動作する

### 5.2 レート制限のテスト

同じブラウザで連続15回プラン生成を試す:

```
1回目: ✅ 成功
2回目: ✅ 成功
...
10回目: ✅ 成功
11回目: ❌ エラー「短時間に多くのリクエストが送信されました」
```

**確認項目**:
- [ ] 15分で10回までリクエストできる
- [ ] 11回目でエラーが表示される

### 5.3 Google Cloud APIの最終確認

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) を開く
2. APIキーの詳細を開く
3. **「Application restrictions」** が **「HTTP referrers」** になっているか確認
4. Vercelのドメインが含まれているか確認

**デプロイしたVercelのドメインを追加**:

```
https://date-ai-abc123.vercel.app/*
https://*.vercel.app/*
http://localhost:*
```

**確認項目**:
- [ ] VercelのドメインがHTTPリファラーに追加されている
- [ ] 地図が正常に表示される

---

## ✅ ステップ6: コスト管理設定（5分）

### 6.1 Google Cloudの請求ダッシュボードを確認

1. [Google Cloud Billing](https://console.cloud.google.com/billing) を開く
2. 現在の使用量を確認
3. 予算アラートが設定されているか確認

### 6.2 Vercelのアナリティクスを有効化

1. Vercelダッシュボードで `date-ai` プロジェクトを開く
2. **「Analytics」** タブをクリック
3. トラフィックを監視

**確認項目**:
- [ ] 請求アラートが設定されている
- [ ] Vercelアナリティクスが有効

---

## 🎉 完了！

おめでとうございます！デートプランAIが本番環境で稼働しています。

### 定期的にチェックすること

#### 毎週（推奨）
- [ ] [Google Cloud Console](https://console.cloud.google.com/) でコストを確認
- [ ] Vercelでトラフィックを確認

#### 月次
- [ ] 請求額を確認
- [ ] 異常なアクセスがないか確認
- [ ] ログをチェック

---

## ⚠️ 問題が起きたら

### エラー: 地図が表示されない

1. ブラウザのコンソールを開く（F12）
2. エラーメッセージを確認
3. Google Cloud Consoleで:
   - HTTPリファラーにVercelドメインが含まれているか
   - Maps JavaScript APIが有効か
   - APIキーが正しいか

### エラー: プラン生成ができない

1. Vercelダッシュボード → Deployments → ログを確認
2. 環境変数が設定されているか確認:
   - Settings → Environment Variables
   - `GOOGLE_MAPS_API_KEY`が設定されているか

### API料金が高すぎる

1. **即座に対応**:
   - [Google Cloud Console](https://console.cloud.google.com/apis/api/places-backend.googleapis.com/quotas) でAPIを一時無効化
2. 原因を調査:
   - Vercelのログで異常なトラフィックを確認
3. 対策:
   - レート制限を強化
   - HTTPリファラーを確認

---

## 📞 サポート

質問や問題があれば:

1. [VERCEL_DEPLOY_GUIDE.md](./VERCEL_DEPLOY_GUIDE.md) を確認
2. [DEPLOYMENT.md](./DEPLOYMENT.md) を確認
3. [SECURITY_CHECKLIST.md](./SECURITY_CHECKLIST.md) を確認
4. GitHubのIssueで質問

---

**このファイルをチェックリストとして使い、すべての項目を完了してください！**
