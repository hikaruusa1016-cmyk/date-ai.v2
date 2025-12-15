# デートプラン AI

「初デート〜数回目のデート」で失敗しにくいプランを短時間で得られるWebアプリケーション。

## ⚠️ **本番環境への公開前に必読！**

**このアプリをそのままVercelなどに公開すると、API料金が爆発的に増える可能性があります。**

詳しくは **[DEPLOYMENT.md](./DEPLOYMENT.md)** を必ず読んでください！

主なリスク：
- APIキーの露出リスク
- 無制限のAPI利用によるコスト増大
- 悪意のあるユーザーによる大量アクセス

## 🚀 クイックスタート

### 必要なもの
- Node.js 16以上
- OpenAI API キー（[こちら](https://platform.openai.com/api-keys)で取得）

### セットアップ手順

#### 1. APIキーを設定
```bash
cd backend
cp .env.example .env
# .env ファイルを編集して、OPENAI_API_KEY を設定
```

#### 2. バックエンドを起動
```bash
cd backend
npm install  # (初回のみ)
npm start
```

サーバーは `http://localhost:3001` で起動します。

#### 3. フロントエンドをブラウザで開く
```bash
# 別のターミナルウィンドウで:
cd frontend
# 静的サーバーを起動
python3 -m http.server 3000
```

または、フロントエンド/index.html を Chrome で直接開く：
```bash
open -a "Google Chrome" frontend/index.html
```

> **注意**: API キーが設定されていない場合、プラン生成時にエラーになります。

---

## 📋 機能

### Step 1: 条件入力
以下の情報を選択式で入力：

- **ユーザー情報**
  - 年代（20代/30代/40代以上）
  - 性格タイプ（インドア派/バランス派/アウトドア派）
  - 興味（グルメ/散歩/映画/美術/ショッピング/スポーツ）

- **相手の情報**
  - 年代、性格タイプ、興味

- **デート情報**
  - 予算レベル（低/中/高）
  - デートの段階（初デート/2〜3回目/関係を深める）
  - エリア（渋谷/新宿/銀座など）
  - デート時間（任意）

### Step 2: プラン生成
入力条件から、LLM（Claude 3.5 Sonnet）が最適なデートプランを生成します。

**出力内容:**
- 1日のスケジュール（時刻、スポット、料金、理由）
- 予算目安
- 会話ネタ（3つ）
- 調整可能なポイント
- 次回へつなぐセリフ

### Step 3: プラン調整
「もっと安くしたい」「雨の日用に」など、自由に調整リクエストを入力。初回入力状態を保持したまま、プランを修正します。

---

## 🏗️ プロジェクト構成

```
date-ai.v2/
├── frontend/
│   └── index.html          # Webアプリケーション（フロント）
├── backend/
│   ├── server.js            # Express API サーバー
│   ├── package.json         # Node.js 依存パッケージ
│   ├── .env                 # 環境変数（APIキー設定）
│   └── .env.example         # 設定テンプレート
└── README.md                # このファイル
```

---

## 🔧 技術スタック

- **フロント**: HTML5, CSS3, Vanilla JavaScript
- **バック**: Node.js + Express
- **LLM**: OpenAI Claude 3.5 Sonnet API
- **プロトコル**: REST API (JSON)

---

## 📝 API仕様

### POST /api/generate-plan

デートプランを生成します。

**リクエスト例:**
```json
{
  "conditions": {
    "user_age_group": "20s",
    "user_personality": "balanced",
    "user_interests": ["gourmet", "walk"],
    "date_budget_level": "medium",
    "date_phase": "first",
    "partner_age_group": "20s",
    "partner_personality": "indoor",
    "partner_interests": ["gourmet"],
    "area": "shibuya"
  },
  "adjustment": null
}
```

**レスポンス例:**
```json
{
  "success": true,
  "plan": {
    "plan_summary": "落ち着いて会話しやすい初デート向けプラン",
    "total_estimated_cost": "6000-8000",
    "schedule": [
      {
        "time": "12:00",
        "type": "lunch",
        "place_name": "〇〇カフェ",
        "area": "shibuya",
        "price_range": "1500-2000",
        "reason": "初対面でも会話しやすい"
      }
    ],
    "adjustable_points": ["budget", "duration"],
    "conversation_topics": ["話題1", "話題2", "話題3"],
    "next_step_phrase": "また一緒に出かけたいね"
  }
}
```

---

## ⚠️ トラブルシューティング

### エラー: "Cannot find module 'openai'"
```bash
cd backend
npm install
```

### エラー: "OPENAI_API_KEY is not set"
`.env` ファイルで API キーを設定してください。

### エラー: "Cannot GET /api/generate-plan"
バックエンドが起動していません。
```bash
cd backend && npm start
```

---

## 🎯 今後の拡張予定

- [ ] ログイン機能
- [ ] ユーザーデータ保存
- [ ] 画像検索・地図統合
- [ ] ToB向けAPI仕様
- [ ] ABテスト機能
- [ ] 予約機能との連携

---

## 📄 ライセンス

MIT License

---

## 📧 お問い合わせ

バグ報告やご提案は、GitHubのIssueで受け付けています。
