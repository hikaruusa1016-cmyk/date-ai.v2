#!/bin/bash

echo "🎯 デートプラン生成API テスト"
echo ""

# テストリクエスト
curl -X POST http://localhost:3001/api/generate-plan \
  -H "Content-Type: application/json" \
  -d '{
    "conditions": {
      "user_age_group": "20s",
      "user_personality": "balanced",
      "user_interests": ["gourmet", "walk"],
      "date_budget_level": "medium",
      "date_phase": "first",
      "partner_age_group": "20s",
      "partner_personality": "indoor",
      "partner_interests": ["gourmet", "movie"],
      "area": "shibuya",
      "date_duration": "normal"
    },
    "adjustment": null
  }' | jq '.' 2>/dev/null || echo "jq がインストールされていません"

echo ""
echo "✅ テスト完了！"
