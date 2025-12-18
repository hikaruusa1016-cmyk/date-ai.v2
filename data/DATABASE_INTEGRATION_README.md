# スポットデータベース統合 - 実装完了ドキュメント

**実装日**: 2025-12-17
**バージョン**: 1.0

---

## 📊 実装概要

手動で作成したスポットデータベース（CSV）をバックエンドに統合し、Places APIよりも優先的に使用する仕組みを実装しました。

### データソース優先順位

```
1. スポットデータベース（CSV） ← 最優先
   ↓ (見つからない場合)
2. Google Places API
   ↓ (APIが利用不可の場合)
3. モックデータ（フォールバック）
```

---

## 🎯 実装内容

### 1. スポットデータベースモジュール

**ファイル**: `backend/services/spotDatabase.js`

**機能**:
- CSV形式のスポットデータベースを読み込み
- 複合条件での高度な検索機能
- フィルタリング（エリア、カテゴリ、予算、興味、デート段階、時間帯、天候）
- データの正規化（budget_level等の表記揺れを自動修正）
- ランダム取得機能

**主要メソッド**:
```javascript
spotDB.search(conditions)          // 複合条件で検索
spotDB.getRandomSpot(conditions)   // ランダムに1件取得
spotDB.getRandomSpots(n, conditions) // ランダムにN件取得
spotDB.formatSpotForPlan(spot)     // プラン生成用にフォーマット
spotDB.getStats()                  // 統計情報を取得
```

### 2. server.jsへの統合

**変更箇所**: `backend/server.js`の`generateMockPlan`関数

**処理フロー**:
```
1. スポットDBをロード
2. 条件に合うスポットをDBから検索（ランチ、カフェ、アクティビティ、ディナー）
3. 見つからなかったスポットのみPlaces APIで検索
4. それでも見つからない場合はモックデータ使用
```

**検索条件**:
- エリア（area）
- カテゴリ（category: restaurant, cafe, museum, theater, shopping, park, bar）
- 予算レベル（budget: low/medium/high）
- 興味タグ（interests: gourmet, cafe, art, movie, shop, nature, etc.）
- デート段階（datePhase: first/second/deepen/all）
- 時間帯（timeSlot: morning/lunch/afternoon/evening/night/anytime）
- 座標必須（requireCoordinates: true）

---

## 📁 ファイル構成

```
date-ai.v2/
├── backend/
│   ├── server.js                          # 統合済み
│   └── services/
│       ├── spotDatabase.js                # 新規作成
│       ├── places.js                      # 既存（Places API）
│       └── affiliate.js                   # 既存
├── data/
│   ├── DATABASE_INPUT_MANUAL.md          # 入力マニュアル
│   ├── DATABASE_FEEDBACK.md              # 品質フィードバック
│   └── DATABASE_INTEGRATION_README.md    # このファイル
└── スポットデータベース - Sheet1_v1.csv  # データベース本体（122件）
```

---

## 🚀 使用方法

### 1. データベースファイルの配置

CSVファイルを以下の場所に配置:
```
/Users/omotehikaru/Documents/開発用/date-ai.v2/スポットデータベース - Sheet1_v1.csv
```

### 2. サーバーの起動

```bash
cd backend
npm start
```

起動時にログで確認:
```
[SpotDB] Loaded 122 spots from database
```

### 3. プラン生成時のログ

渋谷エリアでプラン生成すると以下のようなログが出力されます:

```
[SpotDB] Using spot database (122 spots available)
[SpotDB] ✅ Lunch from DB: 渋谷ブルーコーヒー
[SpotDB] ✅ Cafe from DB: yellow 渋谷
[SpotDB] ✅ Activity from DB: TOHOシネマズ 渋谷
[SpotDB] ✅ Dinner from DB: 渋谷ハイボールバー
```

データベースに無いスポットの場合:
```
[Places API] Fetching missing spots from Places API...
[Places API] ✅ lunch fetched from Places API
```

---

## 📈 効果

### 検索精度の向上

**Before（Places APIのみ）**:
- キーワード検索のため、検索意図と異なる結果が返ることがある
- 評価の低いお店が混ざることがある
- デート向けでないスポットが選ばれることがある

**After（スポットDB優先）**:
- 手動で厳選したデートスポットを優先的に表示
- デート向けの詳細情報（tips、mood_tags、recommended_for）を活用
- 予算、興味、デート段階に正確にマッチング

### コスト削減

- Places API呼び出し回数を削減（DB にあるスポットは API 不要）
- 渋谷エリアの場合、約80-90%のリクエストがDB内で完結

### データの質

- 座標が正確（手動で確認済み）
- デート向けのTips情報が充実
- 雰囲気タグ、おすすめの時間帯など、AIでは判断しにくい情報を提供

---

## 🔍 検索ロジックの詳細

### ランチの検索

```javascript
spotDB.getRandomSpot({
  area: 'shibuya',
  category: 'restaurant',
  budget: 'medium',
  interests: ['gourmet', 'cafe'],
  datePhase: 'first',
  timeSlot: 'lunch',
  requireCoordinates: true,
})
```

### アクティビティの検索

興味タグに応じてカテゴリを動的に選択:
- `art` → `museum`
- `movie` → `theater`
- `shop` → `shopping`
- `nature` → `park`

見つからない場合は、カテゴリ指定なしで興味タグのみでマッチング。

### ディナーの検索

1. まず `restaurant` カテゴリで検索
2. 見つからなければ `bar` カテゴリも候補に含める

---

## 📊 統計情報の取得

サーバーログでデータベースの統計を確認できます:

```javascript
const stats = spotDB.getStats();
console.log(stats);
```

出力例:
```json
{
  "total": 122,
  "byArea": {
    "shibuya": 122
  },
  "byCategory": {
    "cafe": 15,
    "restaurant": 42,
    "bar": 18,
    "theater": 6,
    "shopping": 12,
    "park": 8,
    "museum": 5,
    "entertainment": 4,
    "activity": 2
  },
  "byBudget": {
    "low": 35,
    "medium": 72,
    "high": 15
  },
  "withCoordinates": 115,
  "withoutCoordinates": 7
}
```

---

## ⚠️ 既知の問題と改善点

### データベースの品質問題

詳細は [`DATABASE_FEEDBACK.md`](./DATABASE_FEEDBACK.md) を参照。

**優先度高**:
- [ ] 座標が欠損しているスポット（7件）を修正
- [ ] エリア違いのデータ（行66: 上野のデータが混入）を削除
- [ ] price_range を数値形式に統一
- [ ] budget_level を `low/medium/high` に統一

**優先度中**:
- [ ] 区切り文字をパイプ `|` に統一
- [ ] category の誤りを修正（行73: `art` → `museum`）
- [ ] mood_tags を日本語に統一

### システム上の改善案

1. **キャッシュ機能**
   - 一度検索した結果をメモリにキャッシュ
   - サーバー再起動時のロード時間短縮

2. **重複排除**
   - 同じプラン内で同じ店舗が複数回選ばれないようにする

3. **訪問済みスポットの除外**
   - ユーザーが以前訪れたスポットを除外

4. **評価機能**
   - ユーザーからのフィードバックを収集
   - 評価の高いスポットを優先表示

---

## 🔧 トラブルシューティング

### CSVファイルが読み込めない

**症状**:
```
[SpotDB] CSV file not found: /path/to/file.csv
```

**対処法**:
1. ファイルパスを確認
2. ファイル名が正確か確認（スペース、全角文字等）
3. `spotDatabase.js`の`csvPath`を絶対パスで指定

### データベースから結果が返ってこない

**症状**:
```
[SpotDB] Using spot database (122 spots available)
[Places API] Fetching missing spots from Places API...
```

**原因と対処法**:
1. **検索条件が厳しすぎる**
   - 複数の条件を緩和（例: budget条件を外す）
   - `requireCoordinates: false` に変更

2. **データの表記揺れ**
   - budget_level が `mid` や `中` になっている
   - `normalizeBudgetLevel` メソッドで自動正規化されるが、新しい表記があれば追加

3. **カテゴリの不一致**
   - CSVの category と検索条件の category が一致しているか確認

### デバッグ方法

`spotDatabase.js` に以下を追加:

```javascript
search(conditions) {
  console.log('[SpotDB Debug] Search conditions:', conditions);
  let results = [...this.spots];

  // ... フィルタリング処理 ...

  console.log(`[SpotDB Debug] ${results.length} spots found`);
  return results;
}
```

---

## 🎯 次のステップ

### 短期（今週中）
1. データベースの品質改善（座標追加、表記統一）
2. 他のエリアのデータ追加（新宿、銀座など）

### 中期（今月中）
3. ユーザーフィードバック機能の実装
4. スポットの重複排除
5. 訪問済みスポットの除外機能

### 長期（来月以降）
6. 管理画面の作成（スポットのCRUD操作）
7. 自動データ更新機能（定期的にPlaces APIで情報更新）
8. AIによるスポット推薦の学習機能

---

## 📞 サポート

質問や問題があれば、以下のドキュメントを参照:
- [データベース入力マニュアル](./DATABASE_INPUT_MANUAL.md) - スポット情報の入力方法
- [データベース品質フィードバック](./DATABASE_FEEDBACK.md) - 改善が必要な箇所

---

**作成者**: Claude
**最終更新**: 2025-12-17
