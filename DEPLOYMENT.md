# デプロイガイド（Vercel）

このアプリケーションをVercelにデプロイする際のセキュリティとコスト管理のガイドです。

## 🚨 重要な注意事項

### 現在の実装で公開すると危険な理由

1. **APIキーが露出する可能性**
   - フロントエンドにAPIキーが含まれる
   - ソースコードを見れば誰でもキーを取得可能

2. **無制限の利用**
   - レート制限は実装済みだが、完全には防げない
   - 悪意のあるユーザーによる大量アクセスでAPI料金が高額になる可能性

3. **認証がない**
   - 誰でも自由にアクセス可能
   - ユーザー制限ができない

---

## ✅ 安全にデプロイする方法

### ステップ1: 環境変数の設定

Vercelのダッシュボードで以下の環境変数を設定：

```
OPENAI_API_KEY=your-openai-api-key
GOOGLE_MAPS_API_KEY=your-google-maps-api-key
PORT=3001
```

**重要**: `.env`ファイルは絶対にGitにコミットしない！

### ステップ2: Google Cloud APIの制限設定

[Google Cloud Console](https://console.cloud.google.com/apis/credentials) でAPIキーの制限を設定：

#### アプリケーションの制限
- **HTTPリファラー**を選択
- 許可するリファラー:
  ```
  https://your-domain.vercel.app/*
  https://*.vercel.app/*  (プレビューデプロイ用)
  ```

#### APIの制限
- **キーを制限する**を選択
- 許可するAPI:
  - ✅ Maps JavaScript API
  - ✅ Places API (New)

### ステップ3: Google Cloud APIの割り当て制限

[Google Cloud Console](https://console.cloud.google.com/apis/api/places-backend.googleapis.com/quotas) で日次制限を設定：

- **Places API (New)**: 1日あたり1000リクエストまで
- **Maps JavaScript API**: 1日あたり28,000リクエストまで

これにより、最悪の場合でも料金が一定額を超えないようになります。

### ステップ4: コスト管理

#### Google Maps Platform
- [料金計算ツール](https://mapsplatform.google.com/pricing/) で概算を確認
- 無料枠:
  - Places API (New): $0 クレジット（従量課金のみ）
  - Maps JavaScript API: 月$200の無料クレジット

#### 推奨設定
- 請求アラートを設定（例：月$10を超えたらメール通知）
- [Google Cloud Console > Billing > Budgets & alerts](https://console.cloud.google.com/billing)

---

## 📋 Vercelデプロイ手順

### 1. vercel.jsonの作成

プロジェクトルートに以下を作成：

```json
{
  "version": 2,
  "builds": [
    {
      "src": "backend/server.js",
      "use": "@vercel/node"
    },
    {
      "src": "frontend/**",
      "use": "@vercel/static"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "backend/server.js"
    },
    {
      "src": "/(.*)",
      "dest": "frontend/$1"
    }
  ]
}
```

### 2. package.jsonの確認

バックエンドの依存関係を確認：

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "dotenv": "^16.0.3",
    "openai": "^4.0.0",
    "axios": "^1.6.0",
    "express-rate-limit": "^7.0.0"
  }
}
```

### 3. Vercelにデプロイ

```bash
# Vercel CLIのインストール
npm install -g vercel

# プロジェクトのルートディレクトリで実行
vercel

# 環境変数を設定（本番環境）
vercel env add GOOGLE_MAPS_API_KEY
vercel env add OPENAI_API_KEY

# 本番環境にデプロイ
vercel --prod
```

---

## 🔒 追加のセキュリティ対策（推奨）

### 1. 認証の追加

本格的に公開する場合は、以下のいずれかを実装：

- **Auth0** / **Clerk**: サードパーティ認証サービス
- **NextAuth.js**: Next.jsを使っている場合
- **カスタム認証**: JWTトークンベースの認証

### 2. より厳格なレート制限

現在の実装:
- プラン生成: 15分で10リクエスト
- マップキー取得: 1分で10リクエスト

本番環境では以下を検討：
- IPアドレスごとの制限
- ユーザーアカウントごとの日次制限
- Cloudflareなどを使ったDDoS対策

### 3. APIキーのローテーション

定期的に新しいAPIキーを生成し、古いキーを無効化：
- 月1回程度のローテーション推奨
- 漏洩が疑われる場合は即座に無効化

---

## 💰 想定コスト（月間）

### 無料枠内の場合（月間1000ユーザー想定）

| サービス | 無料枠 | 想定使用量 | コスト |
|---------|--------|-----------|--------|
| Places API (New) | なし | 4000リクエスト | $20 |
| Maps JavaScript API | $200クレジット | 10000ロード | 無料 |
| OpenAI API | 従量課金 | 使用次第 | $10-50 |
| Vercel Hosting | 100GB帯域 | ~5GB | 無料 |
| **合計** | - | - | **$30-70** |

### コスト削減のヒント

1. **Places APIの使用を最小限に**
   - キャッシュを実装（Redisなど）
   - 同じエリアの検索結果を1時間キャッシュ

2. **OpenAI APIの代替**
   - GPT-3.5-turboを使用（GPT-4より安い）
   - キャッシュを実装

3. **無料ユーザー制限**
   - 1日3回まで無料
   - それ以上は有料プランへ誘導

---

## 🔧 トラブルシューティング

### Q: デプロイ後、地図が表示されない

**A**: 以下を確認：
1. Google Cloud ConsoleでHTTPリファラーにVercelのドメインを追加
2. 環境変数`GOOGLE_MAPS_API_KEY`が正しく設定されているか
3. ブラウザのコンソールでエラーを確認

### Q: API料金が予想以上に高い

**A**: 以下を実施：
1. Google Cloud Consoleで日次制限を設定
2. Vercelのログで異常なトラフィックがないか確認
3. レート制限を厳格化（1分5リクエストなど）

### Q: レート制限エラーが頻発

**A**: 以下を調整：
- `windowMs`を延長（15分→30分）
- `max`を増加（10→20）
- ユーザーごとの制限に変更（現在はIPベース）

---

## 📚 参考リンク

- [Vercel デプロイメントドキュメント](https://vercel.com/docs)
- [Google Maps Platform 料金](https://mapsplatform.google.com/pricing/)
- [Express Rate Limit](https://github.com/express-rate-limit/express-rate-limit)
- [OpenAI API 料金](https://openai.com/pricing)
