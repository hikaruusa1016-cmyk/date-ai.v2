# セキュリティチェックリスト

Vercelやその他のプラットフォームにデプロイする前に、必ずこのチェックリストを確認してください。

## 📋 デプロイ前チェックリスト

### 1. Git管理の確認

- [ ] `.gitignore`に`.env`が含まれている
- [ ] `.env`ファイルがGitにコミットされていない
- [ ] APIキーがソースコード内にハードコードされていない
  - [ ] `frontend/index.html`にAPIキーがない
  - [ ] `backend/server.js`にAPIキーがない

```bash
# 確認コマンド
git status
git log --all -- backend/.env  # 履歴にも含まれていないか確認
grep -r "AIzaSy" frontend/  # フロントエンドにAPIキーがないか確認
```

### 2. Google Cloud API設定

- [ ] **HTTPリファラーの設定**
  - 本番ドメイン（例：`https://yourapp.vercel.app/*`）を追加
  - プレビューデプロイ用（例：`https://*.vercel.app/*`）を追加
  - ローカル開発用（`http://localhost:*`）は本番では削除

- [ ] **API制限の設定**
  - Places API (New) のみ許可
  - Maps JavaScript API のみ許可
  - 不要なAPIは無効化

- [ ] **日次クォータの設定**
  - Places API: 1日1000リクエストまで（推奨）
  - Maps JavaScript API: 1日10000ロードまで（推奨）

- [ ] **請求アラートの設定**
  - 月$10を超えたらメール通知
  - 月$50を超えたらメール通知（より重要）

### 3. Vercel設定

- [ ] 環境変数を Vercel ダッシュボードで設定
  - `GOOGLE_MAPS_API_KEY`
  - `OPENAI_API_KEY`（使用する場合）
  - `PORT` は不要（Vercelが自動設定）

- [ ] プロダクション環境とプレビュー環境で異なるAPIキーを使用（推奨）

### 4. レート制限の確認

- [ ] `express-rate-limit`がインストールされている
- [ ] プラン生成APIにレート制限が適用されている
- [ ] マップキーAPIにレート制限が適用されている

```javascript
// backend/server.js で確認
app.post('/api/generate-plan', planGeneratorLimiter, ...);
app.get('/api/maps-key', mapsKeyLimiter, ...);
```

### 5. セキュリティヘッダーの確認

- [ ] CORS設定が適切（必要なドメインのみ許可）
- [ ] `vercel.json`に適切なヘッダー設定がある（推奨）

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        }
      ]
    }
  ]
}
```

### 6. コスト管理

- [ ] Google Cloud Consoleで請求情報を確認
- [ ] 予算アラートが設定されている
- [ ] 無料枠の上限を理解している
  - Maps JavaScript API: 月$200クレジット
  - Places API: 従量課金（無料枠なし）

### 7. モニタリング

- [ ] Google Cloud Consoleでダッシュボードを確認
- [ ] Vercelのアナリティクスを有効化
- [ ] エラーログの監視設定

### 8. 本番環境テスト

デプロイ後、以下をテスト：

- [ ] プラン生成が正常に動作する
- [ ] 地図が正しく表示される
- [ ] レート制限が機能している（連続15回リクエストでエラー）
- [ ] 不正なAPIキーでアクセスできない

```bash
# レート制限のテスト
for i in {1..15}; do
  curl https://yourapp.vercel.app/api/generate-plan \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{"conditions": {...}}'
done
```

## 🚨 緊急時の対応

### APIキーが漏洩した場合

1. **即座に古いキーを無効化**
   - [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   - 該当キーの「削除」または「無効化」

2. **新しいキーを生成**
   - 新しいAPIキーを作成
   - 適切な制限を設定

3. **Vercelの環境変数を更新**
   - Vercelダッシュボードで新しいキーに更新
   - 再デプロイ

4. **被害状況の確認**
   - Google Cloud Consoleで使用状況を確認
   - 異常なトラフィックがないかチェック

### API料金が急増した場合

1. **即座にAPIを無効化**
   - Google Cloud ConsoleでAPIを一時的に無効化

2. **原因の特定**
   - Vercelのログで異常なトラフィックを確認
   - Google Cloud Consoleで使用状況を分析

3. **レート制限の強化**
   - `max`を減らす（10 → 5）
   - `windowMs`を延長（15分 → 30分）

4. **IPアドレスのブロック**
   - 必要に応じてCloudflareなどでIPをブロック

## 📊 推奨モニタリング設定

### Google Cloud Monitoring

```
アラート名: API使用量が1日の上限に達した
条件: Places API リクエスト数 > 1000 / 日
通知: メール
```

### Vercel Analytics

- ページビュー数の監視
- APIエンドポイントの応答時間
- エラー率

## ✅ デプロイ承認

すべてのチェック項目を確認し、問題がなければデプロイを進めてください。

- [ ] すべてのチェック項目を確認した
- [ ] DEPLOYMENT.mdを読んだ
- [ ] 想定コストを理解している
- [ ] 緊急時の対応手順を理解している

**承認者**: ________________
**日付**: ________________

---

## 🔗 参考リンク

- [Google Cloud Console](https://console.cloud.google.com/)
- [Vercel Dashboard](https://vercel.com/dashboard)
- [Google Maps Platform 料金](https://mapsplatform.google.com/pricing/)
- [Express Rate Limit ドキュメント](https://github.com/express-rate-limit/express-rate-limit)
