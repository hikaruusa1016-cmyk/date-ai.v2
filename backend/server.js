const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

let openai = null;
if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'sk-your-api-key-here') {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

// プラン生成API
app.post('/api/generate-plan', async (req, res) => {
  try {
    const { conditions, adjustment = null } = req.body;
    console.log('Received generate-plan request, area:', conditions && conditions.area);

    let plan;

    if (openai) {
      // 実際のOpenAI API
      const prompt = generatePrompt(conditions, adjustment);

      const message = await openai.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      plan = jsonMatch ? JSON.parse(jsonMatch[0]) : parsePlanFromText(responseText);
    } else {
      // デモ用モック版
      plan = generateMockPlan(conditions, adjustment);
      console.log('Generated mock plan for area:', conditions && conditions.area);
    }

    res.json({
      success: true,
      plan: plan,
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

function generatePrompt(conditions, adjustment) {
  let prompt = `あなたはデートプラン生成の専門家です。以下の条件に基づいて、完璧なデートプランをJSON形式で生成してください。

【ユーザーの条件】
- ユーザーの年代: ${conditions.user_age_group}
- ユーザーの性格: ${conditions.user_personality}
- ユーザーの興味: ${conditions.user_interests.join(', ')}
- デート予算レベル: ${conditions.date_budget_level}
- デートの段階: ${conditions.date_phase}
- パートナーの年代: ${conditions.partner_age_group}
- パートナーの性格: ${conditions.partner_personality}
- パートナーの興味: ${conditions.partner_interests.join(', ')}
- エリア: ${conditions.area}
${conditions.visited_places ? `- 訪問済み場所: ${conditions.visited_places.join(', ')}` : ''}
${conditions.weather_preference ? `- 天気の好み: ${conditions.weather_preference}` : ''}
${conditions.date_duration ? `- デートの時間: ${conditions.date_duration}` : ''}
`;

  if (adjustment) {
    prompt += `\n【ユーザーからの調整リクエスト】\n${adjustment}`;
    prompt += `\n前回のプランを基に、このリクエストを反映して修正したプランを生成してください。`;
  }

  prompt += `\n
【出力形式（必ず以下のJSON形式で返してください）】
\`\`\`json
{
  "plan_summary": "このプランの説明（1文）",
  "total_estimated_cost": "予算の目安（例：6000-8000）",
  "schedule": [
    {
      "time": "時刻（HH:MM形式）",
      "type": "lunch|dinner|activity|walk|shop|cafe",
      "place_name": "場所の名前",
      "area": "エリア",
      "price_range": "価格帯（例：1500-2000）",
      "duration": "所要時間（例：60min）",
      "reason": "このスポットを選んだ理由"
    }
  ],
  "adjustable_points": ["調整できるポイント"],
  "risk_flags": [],
  "conversation_topics": ["話題1", "話題2", "話題3"],
  "next_step_phrase": "次回につなげる一言"
}
\`\`\`

【ルール】
1. 初デートの場合は、密室や長時間拘束を避けてください
2. 予算レベルを超えないようにしてください
3. 指定されたエリア周辺で現実的な移動範囲内にしてください
4. スケジュールは午前中から夜間まで、自然な流れで構成してください
5. 共通の話題が生まれやすいスポットを組み入れてください`;

  return prompt;
}

function parsePlanFromText(text) {
  // フォールバック：テキストからプランを解析
  return {
    plan_summary: 'デートプランが生成されました',
    total_estimated_cost: '5000-8000',
    schedule: [
      {
        time: '12:00',
        type: 'lunch',
        place_name: 'カフェ',
        area: '渋谷',
        price_range: '1500-2000',
        reason: 'リラックスできる環境',
      },
    ],
    adjustable_points: ['予算', '時間', '場所'],
    risk_flags: [],
    conversation_topics: ['共通の趣味', '地元ネタ', '最近の出来事'],
    next_step_phrase: 'また一緒に出かけたいね',
  };
}

function generateMockPlan(conditions, adjustment) {
  // デモ用モック版プラン生成
  const phase = conditions.date_phase;
  const budget = conditions.date_budget_level;
  const area = conditions.area;
  const userPersonality = conditions.user_personality;
  const partnerPersonality = conditions.partner_personality;

  // 予算に応じた価格帯
  const budgetMap = {
    low: { lunch: '1000-1500', activity: '1000-1500', dinner: '1500-2000', cafe: '600-1000' },
    medium: { lunch: '1500-2500', activity: '2000-3000', dinner: '3000-5000', cafe: '1000-1500' },
    high: { lunch: '2500-4000', activity: '3000-5000', dinner: '5000-10000', cafe: '1500-2500' },
  };

  const prices = budgetMap[budget] || budgetMap.medium;

  // エリア別スポット
  const spotsByArea = {
    shibuya: { lunch: {name: '渋谷モディ', lat:35.6604, lng:139.7017}, activity: {name:'渋谷センター街', lat:35.6597, lng:139.7006}, dinner: {name:'渋谷スクランブルスクエア', lat:35.6591, lng:139.7006} },
    shinjuku: { lunch: {name:'新宿ミロード', lat:35.6894, lng:139.7023}, activity: {name:'新宿御苑周辺', lat:35.6852, lng:139.7101}, dinner: {name:'新宿ルミネ口エリア', lat:35.6895, lng:139.7004} },
    ginza: { lunch: {name:'GINZA SIX', lat:35.6702, lng:139.7636}, activity: {name:'銀座通り散策', lat:35.6717, lng:139.7650}, dinner: {name:'銀座コースレストラン', lat:35.6705, lng:139.7640} },
    harajuku: { lunch: {name:'表参道カフェ', lat:35.6654, lng:139.7120}, activity: {name:'竹下通り散策', lat:35.6702, lng:139.7020}, dinner: {name:'原宿イタリアン', lat:35.6700, lng:139.7034} },
    odaiba: { lunch: {name:'お台場ヴィーナスフォート', lat:35.6251, lng:139.7754}, activity: {name:'お台場海浜公園', lat:35.6298, lng:139.7766}, dinner: {name:'お台場デックス', lat:35.6272, lng:139.7757} },
    ueno: { lunch: {name:'上野の森さくらテラス', lat:35.7156, lng:139.7745}, activity: {name:'国立西洋美術館', lat:35.7188, lng:139.7769}, dinner: {name:'アメ横の居酒屋', lat:35.7138, lng:139.7755} },
    asakusa: { lunch: {name:'浅草雷門周辺', lat:35.7148, lng:139.7967}, activity: {name:'浅草寺散策', lat:35.7140, lng:139.7967}, dinner: {name:'仲見世通りグルメ', lat:35.7146, lng:139.7967} },
    ikebukuro: { lunch: {name:'池袋サンシャイン', lat:35.7296, lng:139.7193}, activity: {name:'サンシャイン水族館', lat:35.7289, lng:139.7188}, dinner: {name:'池袋グルメ街', lat:35.7310, lng:139.7101} },
  };

  const spots = spotsByArea[area] || spotsByArea.shibuya;
  // area center fallback coordinates
  const areaCenters = {
    ueno: {lat:35.7138, lng:139.7770},
    shibuya: {lat:35.6595, lng:139.7004},
    shinjuku: {lat:35.6895, lng:139.6917},
    ginza: {lat:35.6719, lng:139.7645},
    harajuku: {lat:35.6704, lng:139.7028},
    odaiba: {lat:35.6270, lng:139.7769},
    asakusa: {lat:35.7148, lng:139.7967},
    ikebukuro: {lat:35.7296, lng:139.7160},
  };
  const areaCenter = areaCenters[area] || {lat:35.6595, lng:139.7004};
  console.log('generateMockPlan: area=', area, ' -> spots=', spots);

  // 性格の組み合わせに応じたプラン
  const isOutdoorFriendly = userPersonality === 'outdoor' || partnerPersonality === 'outdoor';
  const isIndoorPreferred = userPersonality === 'indoor' || partnerPersonality === 'indoor';

  let schedule = [];

  if (phase === 'first') {
    // 初デート：落ち着いて会話しやすい
    schedule = [
      {
        time: '12:00',
        type: 'lunch',
        place_name: spots.lunch.name,
        lat: spots.lunch.lat,
        lng: spots.lunch.lng,
        area: area,
        price_range: prices.lunch,
        duration: '60min',
        reason: '初対面でも会話しやすい落ち着いた環境',
        info_url: 'https://www.google.com/search?q=' + encodeURIComponent(spots.lunch.name + ' ' + area)
      },
      {
        time: '14:00',
        type: 'activity',
        place_name: isIndoorPreferred ? (spots.activity.name + '（展示）') : (spots.activity.name + '（散歩）'),
        lat: spots.activity.lat,
        lng: spots.activity.lng,
        area: area,
        price_range: prices.activity,
        duration: '90min',
        reason: '共通の話題が生まれやすい施設',
        info_url: 'https://www.google.com/search?q=' + encodeURIComponent(spots.activity.name + ' ' + area)
      },
      {
        time: '16:30',
        type: 'cafe',
        place_name: spots.lunch.name + ' カフェ',
        lat: spots.lunch.lat + 0.0003,
        lng: spots.lunch.lng + 0.0003,
        area: area,
        price_range: prices.cafe,
        duration: '45min',
        reason: '疲れを癒しながら深い会話を',
        info_url: 'https://www.google.com/search?q=' + encodeURIComponent(spots.lunch.name + ' カフェ ' + area)
      },
      {
        time: '18:00',
        type: 'dinner',
        place_name: spots.dinner.name,
        lat: spots.dinner.lat,
        lng: spots.dinner.lng,
        area: area,
        price_range: prices.dinner,
        duration: '90min',
        reason: 'カジュアルで食べやすい雰囲気',
        info_url: 'https://www.google.com/search?q=' + encodeURIComponent(spots.dinner.name + ' ' + area)
      },
    ];
  } else if (phase === 'second') {
    // 2〜3回目：活動を増やす
    schedule = [
      {
        time: '11:00',
        type: 'activity',
        place_name: spots.activity + ' アート展覧会',
        area: area,
        price_range: prices.activity,
        duration: '120min',
        reason: '新しい共有体験で距離を縮める',
      },
      {
        time: '13:30',
        type: 'lunch',
        place_name: spots.lunch + ' グルメスポット',
        area: area,
        price_range: prices.lunch,
        duration: '60min',
        reason: 'お互いの食の好みをより知る',
      },
      {
        time: '15:00',
        type: 'walk',
        place_name: area + ' 街歩き',
        area: area,
        price_range: '0',
        duration: '60min',
        reason: 'リラックスした雰囲気で会話も弾む',
      },
      {
        time: '17:00',
        type: 'cafe',
        place_name: spots.lunch + ' トレンディカフェ',
        area: area,
        price_range: prices.cafe,
        duration: '45min',
        reason: 'SNS映えするスポットで特別感を演出',
      },
    ];
  } else {
    // 関係を深める段階
    schedule = [
      {
        time: '10:00',
        type: 'activity',
        place_name: spots.activity.name + ' 体験教室',
        lat: spots.activity.lat,
        lng: spots.activity.lng,
        area: area,
        price_range: prices.activity,
        duration: '120min',
        reason: '一緒に学ぶ時間を大切に',
      },
      {
        time: '12:30',
        type: 'lunch',
        place_name: spots.lunch.name + ' こだわりレストラン',
        lat: spots.lunch.lat,
        lng: spots.lunch.lng,
        area: area,
        price_range: prices.lunch,
        duration: '90min',
        reason: 'より高級感のある場所で特別感を',
      },
      {
        time: '14:30',
        type: 'shop',
        place_name: spots.lunch.name + ' ショッピング',
        lat: spots.lunch.lat + 0.0005,
        lng: spots.lunch.lng + 0.0006,
        area: area,
        price_range: prices.cafe,
        duration: '60min',
        reason: 'お互いの趣味を知って一緒に選ぶ',
      },
      {
        time: '17:00',
        type: 'dinner',
        place_name: spots.dinner.name + ' プレミアムレストラン',
        lat: spots.dinner.lat,
        lng: spots.dinner.lng,
        area: area,
        price_range: prices.dinner,
        duration: '120min',
        reason: 'ゆったりとした時間で関係を深める',
      },
    ];
  }

  const costMap = {
    low: '3000-5000',
    medium: '7000-10000',
    high: '15000-25000',
  };

  // helper: distance (meters)
  function haversineDistance(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => deg * Math.PI / 180;
    const R = 6371000; // meters
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  function estimateWalkingMinutes(distanceMeters) {
    const walkingSpeedMPerMin = 5000 / 60; // ~83.33 m/min
    return Math.max(1, Math.round(distanceMeters / walkingSpeedMPerMin));
  }

  // calculate travel distances/time between consecutive schedule items
  let prev = null;
  for (let i = 0; i < schedule.length; i++) {
    const item = schedule[i];
    if (item.lat == null || item.lng == null) {
      // fallback to area center
      item.lat = areaCenter.lat;
      item.lng = areaCenter.lng;
    }
    if (prev) {
      const dist = Math.round(haversineDistance(prev.lat, prev.lng, item.lat, item.lng));
      item.walking_distance_m = dist;
      item.travel_time_min = estimateWalkingMinutes(dist);
    } else {
      const dist0 = Math.round(haversineDistance(areaCenter.lat, areaCenter.lng, item.lat, item.lng));
      item.walking_distance_m = dist0;
      item.travel_time_min = estimateWalkingMinutes(dist0);
    }
    prev = item;
  }

  return {
    plan_summary:
      phase === 'first'
        ? '落ち着いて会話しやすい初デート向けプラン'
        : phase === 'second'
          ? 'より親密になる2〜3回目デート向けプラン'
          : '関係を深める特別なデートプラン',
    total_estimated_cost: costMap[budget],
    schedule: schedule,
    adjustable_points: ['予算', '所要時間', '屋内/屋外', 'グルメのジャンル'],
    risk_flags: [],
    conversation_topics: [
      '最近やってみたいこと',
      '子どもの頃の思い出',
      'お互いの家族について',
    ],
    next_step_phrase:
      phase === 'first'
        ? '今日は本当に楽しかった。また会いたい。'
        : phase === 'second'
          ? 'この前よりも君のこともっと知りたいな。'
          : '君と過ごす時間が本当に好きです。',
  };
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
