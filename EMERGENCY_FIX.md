# 🚨 緊急対応：.envファイルがGitにコミットされている

## ⚠️ 状況

`.env`ファイルがGit履歴に含まれており、GitHubにもプッシュされています。
これは**APIキーが公開されている**ことを意味します。

## 🔥 即座に実行すること

### ステップ1: APIキーを無効化（最優先！）

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) を開く
2. APIキー `AIzaSyA_le6vbQ0Lm2auWAfT72b6Uhq58pM-iLQ` を見つける
3. **「削除」または「無効化」** をクリック
4. 新しいAPIキーを生成

**すぐにやってください！このキーは既に公開されています。**

---

## ステップ2: Git履歴から.envを削除

以下のコマンドを実行して、Git履歴から`.env`を完全に削除します：

```bash
# プロジェクトディレクトリに移動
cd /Users/omotehikaru/Documents/開発用/date-ai.v2

# BFG Repo-Cleanerを使って.envを削除（推奨）
# まずはインストール（Homebrewがある場合）
brew install bfg

# .envファイルを履歴から削除
bfg --delete-files .env

# または、git filter-branchを使う方法（BFGがない場合）
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch backend/.env .env' \
  --prune-empty --tag-name-filter cat -- --all

# リモートリポジトリに強制プッシュ
git push origin --force --all
git push origin --force --tags
```

**注意**: 強制プッシュは危険な操作です。他の人と共同作業している場合は注意してください。

---

## ステップ3: 新しいAPIキーの設定

1. Google Cloud Consoleで新しいAPIキーを生成
2. ローカルの`backend/.env`を更新：

```bash
# backend/.envを編集
OPENAI_API_KEY=sk-your-api-key-here
GOOGLE_MAPS_API_KEY=NEW_API_KEY_HERE
PORT=3001
```

3. 新しいAPIキーに制限を設定：
   - HTTPリファラー: `https://*.vercel.app/*`, `http://localhost:*`
   - API制限: Maps JavaScript API, Places API (New)のみ

---

## ステップ4: .gitignoreの確認

`.gitignore`が正しく設定されているか確認：

```bash
cat .gitignore | grep .env
```

以下が含まれているはずです：

```
.env
.env.local
.env.production
```

---

## ステップ5: 再度コミット

```bash
# 変更を確認
git status

# .envがリストにないことを確認
# あれば削除
git rm --cached backend/.env .env

# 新しいコミット
git add .
git commit -m "fix: Remove .env from git history and update security"
git push
```

---

## 📋 チェックリスト

- [ ] **古いAPIキーを無効化した**（最重要！）
- [ ] **新しいAPIキーを生成した**
- [ ] **Git履歴から.envを削除した**
- [ ] **GitHubに強制プッシュした**
- [ ] **新しいAPIキーに制限を設定した**
- [ ] **backend/.envを新しいキーで更新した**
- [ ] **.gitignoreが正しく設定されている**

---

## 🔍 今後の予防策

1. **コミット前に必ず確認**:
   ```bash
   git status
   git diff --cached
   ```

2. **pre-commitフックを使う**（推奨）:
   ```bash
   # .git/hooks/pre-commit を作成
   #!/bin/bash
   if git rev-parse --verify HEAD >/dev/null 2>&1
   then
       against=HEAD
   else
       against=4b825dc642cb6eb9a060e54bf8d69288fbee4904
   fi

   if git diff --cached --name-only $against | grep -E '\.env$'
   then
       echo "Error: .env file is about to be committed!"
       exit 1
   fi
   ```

3. **GitHub Secretsを使う**（本番環境）:
   - 環境変数はVercelやGitHub Actionsで設定
   - `.env`は絶対にコミットしない

---

## ⚠️ もしVercelにデプロイ済みの場合

1. Vercelダッシュボードで環境変数を更新
2. 新しいAPIキーに置き換え
3. 再デプロイ

---

**すぐに実行してください！APIキーが公開されている状態は非常に危険です。**
