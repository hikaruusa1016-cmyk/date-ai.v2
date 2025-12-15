#!/bin/bash

# デートプラン自動生成サービス - 起動スクリプト

echo "🚀 デートプラン自動生成サービス を起動しています..."
echo ""

# プロセスチェック
if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  ポート 3001 は既に使用されています。既存のプロセスを終了します..."
    pkill -f "node server.js"
    sleep 1
fi

# バックエンドの起動
echo "📡 バックエンドサーバーを起動中..."
cd "$(dirname "$0")/backend"
node server.js &
BACKEND_PID=$!
sleep 2

# サーバーの確認
if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null ; then
    echo "✅ バックエンドサーバーが起動しました (PID: $BACKEND_PID)"
else
    echo "❌ バックエンドサーバーの起動に失敗しました"
    exit 1
fi

echo ""
echo "🌐 Chromeでフロントエンドを開いています..."

# Chromeでフロントエンドを開く
FRONTEND_PATH="$(dirname "$0")/frontend/index.html"
open -a "Google Chrome" "file://$FRONTEND_PATH"

echo "✅ ブラウザが起動しました！"
echo ""
echo "📝 サーバー情報:"
echo "   バックエンド: http://localhost:3001"
echo "   フロントエンド: file://$FRONTEND_PATH"
echo ""
echo "🛑 終了するには、このターミナルで Ctrl+C を押してください"
echo ""

# クリーンアップ処理
cleanup() {
    echo ""
    echo "🛑 サーバーを停止しています..."
    kill $BACKEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# バックエンドプロセスの監視
wait $BACKEND_PID
