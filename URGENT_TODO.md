# 🚨 緊急対応が必要です！

## 問題

`.env`ファイルがGitにコミットされ、GitHubに公開されています。
**APIキーが誰でも見られる状態です。**

---

## 📋 今すぐやること（15分）

### ステップ1: 古いAPIキーを無効化（5分）⚡最優先！

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) を開く
2. APIキー `AIzaSyA_le6vbQ0Lm2auWAfT72b6Uhq58pM-iLQ` を探す
3. キーをクリック → **「削除」** をクリック
4. 確認画面で **「削除」** をクリック

✅ **完了したらチェック**: [ ]

---

### ステップ2: 新しいAPIキーを生成（3分）

1. 同じページで **「認証情報を作成」** → **「APIキー」** をクリック
2. 新しいキーが生成されたら、**コピー**して安全な場所にメモ
3. **「キーを制限」** をクリック
4. 以下を設定：
   - **アプリケーションの制限**: HTTPリファラー
     - `https://*.vercel.app/*`
     - `http://localhost:*`
   - **APIの制限**: キーを制限する
     - ✅ Maps JavaScript API
     - ✅ Places API (New)
5. **「保存」** をクリック

✅ **新しいAPIキー**: `AIzaSyAgkZXiOtbesCGxNQLu_H5iGsQHg30vQTg`（ここにメモ）

---

### ステップ3: Git履歴から.envを削除（5分）

ターミナルで以下を実行：

```bash
cd /Users/omotehikaru/Documents/開発用/date-ai.v2

# スクリプトを実行
./FIX_ENV_LEAK.sh
```

スクリプトが質問してきたら `y` を入力。

完了したら：

```bash
# GitHubに強制プッシュ
git push origin --force --all
```

✅ **完了したらチェック**: [✅]

---

### ステップ4: 新しいAPIキーでローカル設定を更新（2分）

1. `backend/.env` ファイルを開く
2. 以下のように更新：

```env
OPENAI_API_KEY=sk-your-api-key-here
GOOGLE_MAPS_API_KEY=ここに新しいAPIキーを貼り付け
PORT=3001
```

3. 保存

✅ **完了したらチェック**: [ ]

---

### ステップ5: 動作確認（2分）

```bash
# バックエンドを再起動
cd backend
npm start
```

ブラウザで `http://localhost:3001` を開いて、地図が表示されるか確認。

✅ **地図が表示される**: [ ]

---

## ✅ 完了後の確認

すべてのチェックボックスにチェックが入りましたか？

- [ ] 古いAPIキーを削除した
- [ ] 新しいAPIキーを生成・制限した
- [ ] Git履歴から.envを削除した
- [ ] GitHubに強制プッシュした
- [ ] backend/.envを新しいキーで更新した
- [ ] 動作確認が完了した

---

## 🔒 今後の予防策

**コミット前に必ず確認**:

```bash
git status
# .env が表示されないことを確認してからコミット
```

**もし.envが表示されたら**:

```bash
git reset HEAD backend/.env .env
```

---

## ❓ よくある質問

### Q: 強制プッシュは安全？

A: このプロジェクトをあなた一人で開発している場合は安全です。
   他の人と共同開発している場合は、事前に相談してください。

### Q: 新しいAPIキーの料金は？

A: 月$200の無料クレジット内で収まります（通常使用の場合）。
   日次制限（1000リクエスト）を設定すれば安心です。

### Q: Git履歴の削除に失敗した

A: 以下を試してください：

```bash
# 手動で削除
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch backend/.env .env' \
  --prune-empty -- --all

# クリーンアップ
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

---

**すぐに実行してください！**
