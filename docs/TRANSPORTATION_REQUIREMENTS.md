# 車移動対応 - 要件定義書

## 📋 現状の課題

### 現在の移動手段
- **徒歩のみ**: 1.8km以内
- **電車/地下鉄のみ**: 1.8km以上

### 問題点
1. **地方ユーザーへの対応不足**
   - 公共交通機関が少ない地域では車が主要な移動手段
   - 駐車場情報がないため実用性が低い

2. **都市部でも車デートのニーズあり**
   - ドライブデート
   - 荷物が多い場合
   - 雨天時の快適性

3. **移動時間の精度不足**
   - 車の場合、距離に対する時間が電車と大きく異なる
   - 渋滞や駐車場探しの時間が考慮されていない

---

## 🎯 目標

### ユーザー体験の向上
1. 車移動を選択したユーザーに最適化されたプラン
2. 駐車場情報の提供
3. より正確な移動時間の算出

---

## 💡 提案する実装案

### 案A: ウィザードで交通手段を選択（推奨）

#### UI/UX設計

**STEP 5: 移動スタイル選択の拡張**

現在:
```
□ ひとつの街でゆっくり
□ 近くのエリアを少し回る
□ いくつかの街を巡りたい
□ 遠出したい（日帰り）
```

提案:
```
【移動スタイル】
□ ひとつの街でゆっくり（徒歩中心）
□ 近くのエリアを少し回る
□ いくつかの街を巡りたい
□ 遠出したい（日帰り）

【移動手段】（複数選択可）
☑ 徒歩
☑ 電車・地下鉄
□ 車（駐車場情報を含める）
□ タクシー・配車アプリ
□ 自転車・レンタサイクル
```

#### メリット
- ユーザーの実際の移動手段に合わせられる
- 車ユーザーには駐車場情報を優先表示
- 複数選択可能（電車+徒歩など）

#### デメリット
- ウィザードの項目が増える
- 選択肢が多すぎると迷う可能性

---

### 案B: 地域自動判定 + 手動切り替え

#### UI/UX設計

**自動判定ロジック**
- スタート地点のエリアから判定
  - 東京23区内 → デフォルト「電車・徒歩」
  - 地方都市 → デフォルト「車」

**手動切り替えUI**
プラン表示画面に「移動手段を変更」ボタン
```
[プラン表示中]

移動手段: 🚃 電車・徒歩 [変更]

↓ クリック

[モーダル]
このプランの移動手段を変更しますか？

○ 電車・徒歩（現在）
○ 車（駐車場情報を表示）
○ タクシー中心

[プランを再生成]
```

#### メリット
- ウィザードがシンプルなまま
- 地域特性を自動考慮
- 後から変更可能

#### デメリット
- 自動判定の精度が課題
- 再生成が必要（時間がかかる）

---

### 案C: スマートな初期値 + 簡易切り替え

#### UI/UX設計

**STEP 2: スタート地点選択時にヒント表示**
```
スタート地点: [池袋] 📍

💡 このエリアは電車移動が便利です
   車でお越しの場合は後で設定できます
```

**STEP 5: 移動スタイルをシンプルに**
```
【動き方】
□ ゆっくり派（徒歩中心）
□ バランス派
□ アクティブ派（複数エリア）

【主な移動手段】
● 電車・徒歩（推奨） ○ 車 ○ おまかせ
```

**プラン表示画面でアイコン表示**
```
[移動セグメント]
🚶 徒歩 5分 → [カフェへ]
🚃 電車 12分 → [美術館へ]
🚗 車 8分（駐車場あり）→ [レストランへ]
```

#### メリット
- 情報量が適切
- エリア特性を考慮
- リアルタイムで確認できる

#### デメリット
- 実装が複雑

---

## 🚗 車移動時の機能拡張

### 1. 駐車場情報の取得・表示

**Google Places APIの活用**
```javascript
// 検索時に駐車場情報を取得
{
  parking_options: {
    free_parking_lot: boolean,
    paid_parking_lot: boolean,
    paid_street_parking: boolean,
    valet_parking: boolean
  }
}
```

**UI表示例**
```
📍 渋谷カフェ
⏰ 10:00-11:00 (60分)
🅿️ 専用駐車場あり（有料）
   └ 周辺コインパーキング 3件
```

### 2. 移動時間の算出改善

**Google Directions API（Driving mode）**
```javascript
// リアルタイム交通情報を考慮
{
  mode: 'driving',
  departure_time: 'now', // or specific timestamp
  traffic_model: 'best_guess'
}
```

**表示例**
```
🚗 車で移動 約15分
   ┗ 通常時: 12分 / 混雑時: 20分
   駐車時間込み: 約20分
```

### 3. ルート最適化

**車移動時の考慮事項**
- 駐車場の有無で優先度変更
- 一方通行や幹線道路を考慮
- 駐車場→目的地の徒歩距離も計算

---

## 📊 実装優先度

### Phase 1: 基本対応（必須）
1. ✅ ウィザードに「移動手段」選択を追加（案A簡易版）
2. ✅ 車移動時の時間算出ロジック実装
3. ✅ Google Places APIから駐車場情報取得

### Phase 2: 情報拡充
4. ⬜ 駐車場の詳細情報表示（料金、台数など）
5. ⬜ 周辺コインパーキング検索機能
6. ⬜ 渋滞情報を考慮した時間算出

### Phase 3: UX改善
7. ⬜ 移動手段の途中変更機能
8. ⬜ 移動手段ごとのコスト比較表示
9. ⬜ ドライブデート特化プラン（景色の良いルートなど）

---

## 🎨 具体的なUI改善案

### ウィザード STEP 5（改善版）

```html
<div class="movement-selection">
  <h2>動き方を選んでください</h2>

  <!-- 移動スタイル -->
  <div class="movement-style">
    <div class="option-card">
      <h3>🚶 ゆっくり派</h3>
      <p>ひとつの街で徒歩中心</p>
    </div>
    <div class="option-card">
      <h3>🎯 バランス派</h3>
      <p>近くのエリアを2-3箇所</p>
    </div>
    <div class="option-card">
      <h3>✈️ アクティブ派</h3>
      <p>複数のエリアを巡る</p>
    </div>
  </div>

  <!-- 移動手段（新規追加） -->
  <div class="transportation-mode">
    <h3>主な移動手段</h3>
    <p class="hint">💡 複数選択できます</p>

    <div class="mode-chips">
      <label class="chip multi-select selected">
        <input type="checkbox" checked>
        <span>🚶 徒歩</span>
      </label>

      <label class="chip multi-select selected">
        <input type="checkbox" checked>
        <span>🚃 電車・地下鉄</span>
      </label>

      <label class="chip multi-select">
        <input type="checkbox">
        <span>🚗 車（駐車場情報含む）</span>
      </label>

      <label class="chip multi-select">
        <input type="checkbox">
        <span>🚕 タクシー</span>
      </label>
    </div>
  </div>
</div>
```

### プラン表示画面（移動セグメント）

```html
<div class="schedule-item travel">
  <div class="travel-icon">🚗</div>
  <div class="travel-info">
    <div class="travel-header">
      <span class="time">10:45</span>
      <span class="mode-badge car">車で移動</span>
    </div>
    <div class="travel-details">
      <div class="duration">約15分</div>
      <div class="distance">4.2km</div>
    </div>
    <div class="parking-info">
      🅿️ 目的地に専用駐車場あり（¥300/h）
    </div>
    <div class="route-note">
      💡 平日午前は比較的空いています
    </div>
  </div>
</div>
```

---

## 💰 コスト試算

### 追加APIコスト

**Google Directions API (Driving mode)**
- 料金: $5.00 per 1,000 requests
- 想定: プラン1回あたり3-4リクエスト = 0.015-0.02円/プラン

**Google Places API (Parking情報)**
- 追加コストなし（既存のPlace Details内に含まれる）

**合計追加コスト**
- 約0.02円/プラン（無視できるレベル）

---

## 🎯 推奨実装方針

### 最小実装（MVP）

**案A の簡易版を推奨**

1. **ウィザード STEP 5に追加**
   ```
   【主な移動手段】（任意）
   □ おまかせ（推奨）
   □ 電車・徒歩中心
   □ 車中心（駐車場情報を含める）
   ```

2. **バックエンド修正**
   - `transportation_preference`: `auto` | `public_transit` | `car`
   - 車選択時は Directions API (driving mode) 使用
   - 駐車場情報を優先的に取得・表示

3. **フロントエンド表示改善**
   - 🚗 アイコン表示
   - 🅿️ 駐車場情報の表示
   - 移動時間に「駐車時間込み」の注釈

### 実装順序

1. **Week 1**: データ構造・API統合
   - `wizardData.transportation_preference` 追加
   - Google Directions API (driving) 統合
   - 駐車場情報取得ロジック

2. **Week 2**: UI/UX実装
   - ウィザード UI追加
   - プラン表示画面の移動セグメント改善
   - アイコン・スタイル調整

3. **Week 3**: テスト・改善
   - 地方エリアでのテスト
   - 駐車場情報の精度確認
   - ユーザーフィードバック収集

---

## 📝 データ構造案

### wizardData 拡張
```javascript
{
  // 既存フィールド
  start_location: "池袋",
  movement_style: "nearby_areas",

  // 新規追加
  transportation_preference: "auto", // "auto" | "public_transit" | "car" | "mixed"
  car_available: true, // 車を利用可能か
}
```

### 移動セグメント拡張
```javascript
{
  type: "travel",
  transport_mode: "car", // "walk" | "train" | "car" | "taxi"
  transport_label: "車",
  duration: "15min",
  travel_time_min: 15,

  // 車移動時の追加情報
  driving_info: {
    distance_km: 4.2,
    normal_duration: "12min",
    traffic_duration: "18min", // 渋滞時
    parking_time: "5min", // 駐車時間
  },

  parking_info: {
    available: true,
    type: "dedicated", // "dedicated" | "paid_lot" | "street" | "none"
    notes: "専用駐車場あり（¥300/h）"
  }
}
```

---

## ✅ チェックリスト

### 実装前の確認事項
- [ ] Google Directions API の有効化確認
- [ ] APIキーの権限設定
- [ ] 駐車場情報フィールドの理解

### 実装後の確認事項
- [ ] 都市部での動作確認
- [ ] 地方エリアでの動作確認
- [ ] 駐車場情報の表示精度
- [ ] 移動時間の妥当性
- [ ] レスポンス速度（API追加による影響）

---

## 🔮 将来的な拡張案

1. **ドライブデート特化機能**
   - 景色の良いルート提案
   - ドライブスルー可能な店舗
   - 車内で楽しめるプレイリスト提案

2. **リアルタイム最適化**
   - 渋滞情報を考慮した出発時刻提案
   - 駐車場の空き情報（リアルタイム）

3. **マルチモーダル対応**
   - 行きは電車、帰りは車（代行）
   - レンタカー情報の統合
   - カーシェア連携

---

## 📚 参考資料

- [Google Maps Platform - Directions API](https://developers.google.com/maps/documentation/directions)
- [Google Places API - Place Details](https://developers.google.com/maps/documentation/places/web-service/details)
- [駐車場情報の取得方法](https://developers.google.com/maps/documentation/places/web-service/place-data-fields#parking)
