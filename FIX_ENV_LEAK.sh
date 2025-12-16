#!/bin/bash

# 🚨 .envファイルをGit履歴から削除するスクリプト
# 実行前に必ずGoogle CloudでAPIキーを無効化してください！

echo "⚠️  このスクリプトはGit履歴から.envファイルを削除します"
echo "⚠️  続行する前に、Google Cloud ConsoleでAPIキーを無効化してください！"
echo ""
read -p "APIキーを無効化しましたか？ (y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]
then
    echo "❌ 中止しました。まずAPIキーを無効化してください。"
    exit 1
fi

echo ""
echo "🔧 Git履歴から.envを削除中..."

# filter-branchを使って.envを削除
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch backend/.env .env 2>/dev/null || true' \
  --prune-empty --tag-name-filter cat -- --all

# リポジトリをクリーンアップ
echo "🧹 リポジトリをクリーンアップ中..."
rm -rf .git/refs/original/
git reflog expire --expire=now --all
git gc --prune=now --aggressive

echo ""
echo "✅ 完了！次のステップ："
echo "1. git push origin --force --all"
echo "2. Google Cloud Consoleで新しいAPIキーを生成"
echo "3. backend/.envを新しいキーで更新"
echo "4. 変更をコミット: git add . && git commit -m 'Update API keys'"
echo ""
echo "⚠️  強制プッシュは慎重に行ってください！"
