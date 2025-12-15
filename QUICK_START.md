# 🚀 クイックスタートガイド

## 📝 あなたがやること（超シンプル版）

### 1. Google Cloud設定（10分）

```
1. https://console.cloud.google.com/apis/credentials を開く
2. APIキーをクリック
3. HTTPリファラー設定:
   ✅ https://*.vercel.app/*
   ✅ http://localhost:*
4. API制限:
   ✅ Maps JavaScript API
   ✅ Places API (New)
5. 保存
```

### 2. GitHubにプッシュ（5分）

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/date-ai.git
git push -u origin main
```

### 3. Vercelデプロイ（10分）

```
1. https://vercel.com にログイン
2. 「New Project」
3. GitHubから date-ai を選択
4. 環境変数を追加:
   - GOOGLE_MAPS_API_KEY: AIzaSyA_le6vbQ0Lm2auWAfT72b6Uhq58pM-iLQ
   - NODE_ENV: production
5. 「Deploy」
```

### 4. 動作確認（5分）

```
✅ ページが開く
✅ プラン生成できる
✅ 地図が表示される
```

---

## 📋 詳細ガイド

- **完全版**: [YOUR_TODO.md](./YOUR_TODO.md) を見てください
- **トラブルシューティング**: [VERCEL_DEPLOY_GUIDE.md](./VERCEL_DEPLOY_GUIDE.md)
- **セキュリティ**: [SECURITY_CHECKLIST.md](./SECURITY_CHECKLIST.md)

---

## ⚠️ 重要な注意

1. **絶対に`.env`をGitにコミットしない**
2. **Google Cloud APIの制限を必ず設定する**
3. **請求アラートを設定する**（月$50推奨）

---

## 💰 想定コスト

月間1000ユーザー: **$20-30**

無料枠:
- Vercel: 無料
- Maps JavaScript API: 月$200クレジット

有料:
- Places API: $0.017/リクエスト

---

## 🆘 問題が起きたら

1. ブラウザのコンソール（F12）でエラーを確認
2. [YOUR_TODO.md](./YOUR_TODO.md) のトラブルシューティングを見る
3. GitHubのIssueで質問
