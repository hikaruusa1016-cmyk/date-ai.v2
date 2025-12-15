# Vercelデプロイ完全ガイド

このガイドに従って、安全にアプリをVercelにデプロイしましょう。

## ⚠️ デプロイ前の最終確認

- [ ] [SECURITY_CHECKLIST.md](./SECURITY_CHECKLIST.md) を完了している
- [ ] Google Cloud APIの制限を設定済み
- [ ] `.env`ファイルがGitにコミットされていない

---

## 📋 あなたがやること（ステップバイステップ）

### ステップ1: Vercelアカウントの準備

1. [Vercel](https://vercel.com/) にアクセス
2. GitHubアカウントでサインアップ/ログイン
3. 無料プランで開始

### ステップ2: GitHubリポジトリの作成

```bash
# プロジェクトディレクトリで実行
git init
git add .
git commit -m "Initial commit"

# GitHubで新しいリポジトリを作成後
git remote add origin https://github.com/your-username/date-ai.git
git branch -M main
git push -u origin main
```

**重要**: `.env`ファイルが含まれていないことを確認！

```bash
# 確認コマンド
git status
# .envが表示されないことを確認
```

### ステップ3: Vercelでプロジェクトをインポート

1. [Vercel Dashboard](https://vercel.com/dashboard) を開く
2. 「Add New...」→「Project」をクリック
3. GitHubリポジトリから`date-ai`を選択
4. 「Import」をクリック

### ステップ4: 環境変数の設定（重要！）

「Environment Variables」セクションで以下を設定：

#### 必須の環境変数

| キー | 値 | 環境 |
|------|-----|------|
| `GOOGLE_MAPS_API_KEY` | `AIzaSy...` (あなたのキー) | Production, Preview, Development |
| `NODE_ENV` | `production` | Production のみ |

#### オプション（OpenAI使用時）

| キー | 値 | 環境 |
|------|-----|------|
| `OPENAI_API_KEY` | `sk-...` | Production, Preview, Development |

**設定方法**:
1. 「Environment Variables」の下の入力欄にキー名を入力
2. 値を入力（APIキーをコピペ）
3. 環境を選択（Production, Preview, Development）
4. 「Add」をクリック
5. すべての環境変数を追加したら「Deploy」をクリック

### ステップ5: デプロイを待つ

- デプロイには2-3分かかります
- 進行状況がリアルタイムで表示されます
- エラーが出た場合は、ログを確認

### ステップ6: デプロイ成功後の確認

デプロイが完了したら、以下を確認：

1. **URLを確認**
   - `https://your-app.vercel.app` のような形式

2. **動作確認**
   ```
   ✅ ページが表示される
   ✅ プラン生成が動作する
   ✅ 地図が表示される
   ✅ Google Maps linkが動作する
   ```

3. **レート制限のテスト**
   - 連続で15回プラン生成を試す
   - 15回目でエラーが出ることを確認

### ステップ7: Google Cloud APIの制限設定（必須！）

デプロイ後、必ずこれを実施：

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) を開く
2. APIキーをクリック
3. 「アプリケーションの制限」で **「HTTPリファラー」** を選択
4. 以下を追加：

```
https://your-app.vercel.app/*
https://*.vercel.app/*
http://localhost:*
```

5. 「APIの制限」で **「キーを制限する」** を選択
6. 以下のAPIのみ許可：
   - ✅ Maps JavaScript API
   - ✅ Places API (New)

7. **「保存」** をクリック

8. [Quotas & System Limits](https://console.cloud.google.com/apis/api/places-backend.googleapis.com/quotas) で日次制限を設定：
   - Places API: 1日 **1000リクエスト**
   - Maps JavaScript API: 1日 **10000ロード**

9. [Billing Alerts](https://console.cloud.google.com/billing) で請求アラートを設定：
   - 月 **$10** で警告メール
   - 月 **$50** で重要警告メール

---

## 🔧 トラブルシューティング

### エラー: "Module not found"

**原因**: 依存関係がインストールされていない

**解決策**:
```bash
cd backend
npm install
git add package.json package-lock.json
git commit -m "Add dependencies"
git push
```

### エラー: "地図が表示されない"

**原因**: Google Maps APIのHTTPリファラー制限

**解決策**:
1. Google Cloud Consoleで確認
2. `https://your-app.vercel.app/*` が含まれているか確認
3. 2-3分待って再度試す（設定反映に時間がかかる）

### エラー: "Cannot read property 'apiKey' of undefined"

**原因**: Vercelの環境変数が設定されていない

**解決策**:
1. Vercelダッシュボード → Settings → Environment Variables
2. `GOOGLE_MAPS_API_KEY` が設定されているか確認
3. 再デプロイ（Deployments → ⋯ → Redeploy）

### レート制限が効いていない

**原因**: express-rate-limitが正しく動作していない

**確認方法**:
```bash
# 連続リクエストのテスト
for i in {1..20}; do
  curl https://your-app.vercel.app/api/generate-plan \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{"conditions": {"area": "shibuya", ...}}'
  echo "Request $i"
done
```

15回目でエラーが出るはずです。

---

## 🚀 デプロイ後のチェックリスト

- [ ] アプリが正常に表示される
- [ ] プラン生成が動作する
- [ ] 地図が表示される
- [ ] レート制限が機能している
- [ ] Google Cloud APIの制限が設定されている
- [ ] 日次クォータが設定されている
- [ ] 請求アラートが設定されている

---

## 💰 コスト監視

### 毎週チェックすること

1. [Google Cloud Console](https://console.cloud.google.com/)
   - Dashboard → Billing → Cost table
   - 今月の使用量を確認

2. [Vercel Analytics](https://vercel.com/dashboard)
   - トラフィック数を確認
   - エラー率を確認

### 異常なコストを検知したら

1. **即座にAPIを無効化**
   - Google Cloud Console → APIs & Services → Disable

2. **原因を調査**
   - Vercelのログを確認
   - 異常なトラフィックソースを特定

3. **対策を実施**
   - 悪意のあるIPをブロック
   - レート制限を強化

---

## 🔄 継続的なメンテナンス

### 月次タスク

- [ ] Google Cloud Consoleでコストを確認
- [ ] APIキーをローテーション（推奨）
- [ ] ログをチェックしてエラーを確認

### 四半期タスク

- [ ] セキュリティアップデート
- [ ] 依存関係の更新
- [ ] レート制限の調整

---

## 📞 サポート

問題が解決しない場合：

1. [DEPLOYMENT.md](./DEPLOYMENT.md) を再確認
2. [SECURITY_CHECKLIST.md](./SECURITY_CHECKLIST.md) を確認
3. GitHubのIssueで質問

---

## ✅ 完了！

おめでとうございます！アプリが本番環境で稼働しています。

定期的にコストとセキュリティをチェックして、安全に運用しましょう。
