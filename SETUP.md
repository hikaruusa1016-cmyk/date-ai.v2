# 🎯 デートプラン自動生成サービス - セットアップガイド

## 📋 目次
1. [最初の1分で開始](#最初の1分で開始)
2. [詳細セットアップ](#詳細セットアップ)
3. [OpenAI APIキー設定](#openai-apiキー設定)
4. [トラブルシューティング](#トラブルシューティング)

---

## 🚀 最初の1分で開始

### 方法1: 自動起動スクリプト（推奨）

```bash
cd /Users/omotehikaru/Documents/開発用/date-ai.v2
bash start.sh
```

これだけで:
- ✅ バックエンドサーバーが自動起動
- ✅ Chromeでフロントエンドが自動で開く
- ✅ すぐにテストできる！

### 方法2: 手動起動

**ターミナル1（バックエンド）:**
```bash
cd /Users/omotehikaru/Documents/開発用/date-ai.v2/backend
npm install  # 初回のみ
npm start
```

**ターミナル2（フロントエンド）:**
```bash
# 方法A: Chromeで直接開く
open -a "Google Chrome" /Users/omotehikaru/Documents/開発用/date-ai.v2/frontend/index.html

# 方法B: 静的サーバーで開く
cd /Users/omotehikaru/Documents/開発用/date-ai.v2/frontend
python3 -m http.server 3000
# ブラウザで http://localhost:3000 にアクセス
```

---

## 📦 詳細セットアップ

### 前提要件
- **Node.js** 16以上
  - 確認: `node --version`
  - インストール: https://nodejs.org/

- **npm** 7以上
  - 確認: `npm --version`
  - 通常、Node.jsと一緒にインストールされます

- **Chrome ブラウザ**
  - このアプリはChromeで最適化されています

### インストール手順

#### 1. リポジトリをクローン（またはダウンロード）

```bash
cd /Users/omotehikaru/Documents/開発用/date-ai.v2
```

#### 2. バックエンドの依存パッケージをインストール

```bash
cd backend
npm install
```

出力例:
```
added 100 packages, audited 101 packages in 7s
```

#### 3. フロントエンドの確認

フロントエンドはスタンドアロンのHTMLファイルなので、インストール不要です。

---

## 🔑 OpenAI APIキー設定

### APIキーなしで使える！

**現在、APIキーなしでもデモ版として動作します。**

デモ版では以下のプランが自動生成されます：
- 初デート向け、2〜3回目向け、関係を深める段階向けのプランテンプレート
- 選択した条件に応じた動的なプラン

### 本物のAIで生成したい場合

#### 1. OpenAI APIキーを取得

1. https://platform.openai.com/api-keys にアクセス
2. ログイン（アカウントがなければ作成）
3. 「Create new secret key」をクリック
4. APIキーをコピー（二度と表示されません！）

#### 2. .env ファイルを設定

```bash
cd /Users/omotehikaru/Documents/開発用/date-ai.v2/backend

# .env ファイルを編集
nano .env
```

内容:
```env
OPENAI_API_KEY=sk-your-actual-api-key-here
PORT=3001
```

`:` → `x` → `Enter` で保存（nano）

#### 3. サーバーを再起動

```bash
npm start
```

---

## 🎮 使い方

### ステップ1: 条件を入力
1. 「あなたの年代」を選択
2. 「あなたの性格タイプ」を選択
3. 「あなたの興味」から複数選択
4. 相手の情報も同様に入力
5. 予算レベルとデートの段階を選択
6. デートエリアを選択

### ステップ2: プラン生成
「✨ プランを生成する」ボタンをクリック

### ステップ3: プラン調整（オプション）
生成されたプランに対して：
- 「もう少し安くしたい」
- 「雨の日用に変更したい」
- 「夜は短めに」

などと入力して、「🔄 プランを修正」をクリック

---

## 🐛 トラブルシューティング

### 問題: "Cannot GET /api/generate-plan"

**原因**: バックエンドが起動していない

**解決策**:
```bash
cd /Users/omotehikaru/Documents/開発用/date-ai.v2/backend
npm start
```

### 問題: "Cannot find module 'openai'"

**原因**: 依存パッケージがインストールされていない

**解決策**:
```bash
cd /Users/omotehikaru/Documents/開発用/date-ai.v2/backend
npm install
```

### 問題: ポート 3001 は既に使用されている

**原因**: 別のプロセスがポート 3001 を使用している

**解決策**:
```bash
# プロセスを確認
lsof -i :3001

# プロセスを終了
kill -9 <PID>

# または自動的に終了
pkill -f "node server.js"
```

### 問題: Chromeが開かない

**原因**: パスが違う、またはChromeがインストールされていない

**解決策**:
```bash
# 手動でHTMLを開く
open -a "Google Chrome" /Users/omotehikaru/Documents/開発用/date-ai.v2/frontend/index.html

# またはファイルをダブルクリック
```

### 問題: "OPENAI_API_KEY is not set" エラー

**原因**: APIキーが設定されていない

**解決策**:
- デモ版を使う（設定不要）
- または上記の「OpenAI APIキー設定」を参照

---

## 📊 プロジェクト構成

```
date-ai.v2/
├── README.md              # 概要とドキュメント
├── SETUP.md              # このファイル（セットアップガイド）
├── start.sh              # 自動起動スクリプト
├── test-api.sh           # API テストスクリプト
│
├── frontend/
│   └── index.html         # Webアプリケーション（HTML+CSS+JS）
│
└── backend/
    ├── server.js          # Express API サーバー
    ├── package.json       # Node.js依存パッケージ定義
    ├── .env              # 環境変数（APIキー設定）
    └── .env.example      # 環境変数テンプレート
```

---

## 📞 サポート

問題が解決しない場合:

1. **APIが起動しているか確認**
   ```bash
   curl http://localhost:3001/api/generate-plan
   ```

2. **ブラウザコンソールを確認** (Chrome F12 → Console)
   - 赤いエラーメッセージをチェック

3. **サーバーログを確認**
   - バックエンドのターミナル出力を見る

---

## 🎉 お疲れ様です！

これで完璧なデートプラン生成アプリが完成しました。

ぜひ試してみてください！

```bash
bash start.sh
```

Happy Dating! 💘
