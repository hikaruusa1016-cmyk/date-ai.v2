#!/bin/bash

# フロントエンドのみを起動するスクリプト（開発・テスト用）

echo "🌐 フロントエンド開発サーバーを起動しています..."
echo ""

# プロジェクトルートを取得
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

# ポート8080でシンプルなHTTPサーバーを起動
cd "$PROJECT_ROOT/frontend"

echo "✅ フロントエンド開発サーバーが起動しました！"
echo ""
echo "📝 アクセス情報:"
echo "   URL: http://localhost:8080/wizard.html"
echo ""
echo "🛑 終了するには、このターミナルで Ctrl+C を押してください"
echo ""

# Python3があればそれを使用、なければPython2
if command -v python3 &> /dev/null; then
    python3 -m http.server 8080
elif command -v python &> /dev/null; then
    python -m SimpleHTTPServer 8080
else
    echo "❌ Pythonが見つかりません。Pythonをインストールしてください。"
    exit 1
fi
