const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const { searchPlaces, getPlaceDetails } = require('./services/places');
const { getSpotDatabase } = require('./services/spotDatabase');

function createPlaceholderPhotos(title) {
  const palette = ['#667eea', '#764ba2', '#ff6b6b'];
  const safeTitle = (title || 'Spot').replace(/"/g, '');
  return [0, 1, 2].map((variant) => {
    const bg = palette[variant % palette.length];
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='500'><defs><linearGradient id='g${variant}' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='${bg}' stop-opacity='0.9'/><stop offset='100%' stop-color='#1c1c28' stop-opacity='0.8'/></linearGradient></defs><rect width='800' height='500' fill='url(#g${variant})'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='Arial' font-size='42' fill='white' opacity='0.9'>${safeTitle}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  });
}

const app = express();
// 公開エンドポイントのベースURL（Vercel本番でも file:// でも写真URLが切れないように補正）
const PUBLIC_API_BASE = (() => {
  const envBase = (process.env.PUBLIC_API_BASE || '').trim();
  if (envBase) return envBase.replace(/\/$/, '');

  const vercelUrl = (process.env.VERCEL_URL || '').trim();
  if (vercelUrl) {
    const normalized = vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`;
    return normalized.replace(/\/$/, '');
  }

  return `http://localhost:${process.env.PORT || 3001}`;
})();
const PLACES_REFERER =
  (process.env.PLACES_REFERER || PUBLIC_API_BASE || '').replace(/\/$/, '') ||
  'http://localhost:3001';

// スポットデータベースを起動時にロード
const spotDB = getSpotDatabase();
if (spotDB.loaded) {
  const stats = spotDB.getStats();
  console.log(`✅ Spot Database loaded: ${stats.total} spots (${stats.withCoordinates} with coordinates)`);
  console.log(`   Areas: ${Object.keys(stats.byArea).join(', ')}`);
  console.log(`   Categories: ${Object.keys(stats.byCategory).length} types`);
} else {
  console.log('⚠️  Spot Database not loaded - will use Places API only');
}

// CORS設定（本番環境対応）
const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? process.env.FRONTEND_URL || '*'  // 本番環境ではフロントエンドのURLを指定
    : '*',  // 開発環境では全て許可
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());

// 簡易認証ミドルウェア（本番環境用）
// 注意: これは基本的な保護です。本格的な認証にはAuth0などを使用してください
const simpleAuth = (req, res, next) => {
  // 開発環境ではスキップ
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }

  // アクセストークンをチェック（オプション）
  const accessToken = process.env.ACCESS_TOKEN;
  if (accessToken) {
    const providedToken = req.headers['x-access-token'] || req.query.token;
    if (providedToken !== accessToken) {
      return res.status(403).json({ error: 'アクセスが拒否されました' });
    }
  }

  next();
};

// レート制限の設定（本番環境用）
const planGeneratorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分
  max: 10, // 15分間で最大10リクエスト
  message: { error: '短時間に多くのリクエストが送信されました。15分後に再試行してください。' },
  standardHeaders: true,
  legacyHeaders: false,
});

const mapsKeyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分
  max: 10, // 1分間で最大10リクエスト
  message: { error: '短時間に多くのリクエストが送信されました。後でもう一度お試しください。' },
  standardHeaders: true,
  legacyHeaders: false,
});

let openai = null;
if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'sk-your-api-key-here') {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

// プラン生成API（レート制限と簡易認証付き）
app.post('/api/generate-plan', simpleAuth, planGeneratorLimiter, async (req, res) => {
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
      // デモ用モック版（Google Places API統合）
      plan = await generateMockPlan(conditions, adjustment);
      console.log('Generated mock plan for area:', conditions && conditions.area);
    }

    res.json({
      success: true,
      plan: normalizePlan(plan),
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
- エリア: ${conditions.area}
- デートの段階: ${conditions.date_phase}
- 時間帯: ${conditions.time_slot}
- デート予算レベル: ${conditions.date_budget_level}
${conditions.mood ? `- 今日の気分: ${conditions.mood}` : ''}
${conditions.ng_conditions && conditions.ng_conditions.length > 0 ? `- NG条件: ${conditions.ng_conditions.join(', ')}` : ''}
${conditions.custom_request ? `- ユーザーの自由入力リクエスト: ${conditions.custom_request}` : ''}
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
      "reason": "このスポットを選んだ理由",
      "reason_tags": ["タグ1", "タグ2"]
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
4. スケジュールは時間帯に応じて自然な流れで構成してください
5. NG条件を避けたスポットを選んでください
6. ユーザーの自由入力（行きたい場所・時間帯・やりたいこと）があれば、必ずスケジュールに組み込み、その意図が伝わるようにしてください`;

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

// LLMや外部入力で写真が付かない場合でもグリッドを埋める
function normalizePlan(plan) {
  if (!plan || !Array.isArray(plan.schedule)) return plan;
  const schedule = plan.schedule.map((item, idx) => {
    const name = item.place_name || item.name || `スポット${idx + 1}`;
    const photos = item.photos && item.photos.length ? item.photos : createPlaceholderPhotos(name);
    return { ...item, photos };
  });
  return { ...plan, schedule };
}

// time_slotに応じた適切なカテゴリを返す
function getActivityCategoryForTimeSlot(timeSlot) {
  // Google Places API (New) の Primary Types
  if (timeSlot === 'lunch') return 'restaurant';
  if (timeSlot === 'dinner') return 'restaurant';
  // halfday/fullday はデフォルト（多様なカテゴリ）
  return 'tourist_attraction';
}

async function generateMockPlan(conditions, adjustment) {
  // デモ用モック版プラン生成（スポットDB + Google Places API統合版）

  // 調整内容を反映
  let phase = conditions.date_phase;
  let budget = conditions.date_budget_level;
  let area = conditions.area;
  let timeSlot = conditions.time_slot;
  const customRequest = (conditions.custom_request || '').trim();
  const mood = conditions.mood || null;
  const ngConditions = conditions.ng_conditions || [];

  if (adjustment) {
    console.log(`[Adjustment] User request: ${adjustment}`);

    // 予算調整
    if (adjustment.match(/安く|安い|節約|リーズナブル|お金|予算/)) {
      if (budget === 'high') budget = 'medium';
      else if (budget === 'medium') budget = 'low';
      console.log(`[Adjustment] Budget changed to: ${budget}`);
    }
    if (adjustment.match(/高級|贅沢|豪華|特別|リッチ/)) {
      if (budget === 'low') budget = 'medium';
      else if (budget === 'medium') budget = 'high';
      console.log(`[Adjustment] Budget changed to: ${budget}`);
    }

    // デート段階調整
    if (adjustment.match(/初|初めて|初デート|1回目/)) {
      phase = 'first';
      console.log(`[Adjustment] Phase changed to: first`);
    }
    if (adjustment.match(/記念日|特別|アニバーサリー/)) {
      phase = 'anniversary';
      console.log(`[Adjustment] Phase changed to: anniversary`);
    }
    if (adjustment.match(/カジュアル|気軽/)) {
      phase = 'casual';
      console.log(`[Adjustment] Phase changed to: casual`);
    }
  }

  // 予算に応じた価格帯
  const budgetMap = {
    low: { lunch: '1000-1500', activity: '1000-1500', dinner: '1500-2000', cafe: '600-1000' },
    medium: { lunch: '1500-2500', activity: '2000-3000', dinner: '3000-5000', cafe: '1000-1500' },
    high: { lunch: '2500-4000', activity: '3000-5000', dinner: '5000-10000', cafe: '1500-2500' },
  };

  const prices = budgetMap[budget] || budgetMap.medium;
  const hasPlacesAPI = !!process.env.GOOGLE_MAPS_API_KEY;

  // エリア名を日本語に変換
  const areaNameMap = {
    shibuya: '渋谷',
    shinjuku: '新宿',
    ginza: '銀座',
    harajuku: '原宿',
    odaiba: 'お台場',
    ueno: '上野',
    asakusa: '浅草',
    ikebukuro: '池袋',
  };
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
  const areaCenterFor = (areaId) => areaCenters[areaId] || areaCenters.shibuya;
  const areaDistance = (lat1, lon1, lat2, lon2) => {
    const toRad = (deg) => deg * Math.PI / 180;
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // デートエリア表記
  let areaJapanese = areaNameMap[area] || '渋谷';
  const areaCenter = areaCenterFor(area);

  // ===== 優先1: スポットデータベースから検索 =====
  const spotDB = getSpotDatabase();
  let lunchPlace, activityPlace, cafePlace, dinnerPlace;

  if (spotDB.loaded && spotDB.spots.length > 0) {
    console.log(`[SpotDB] Using spot database (${spotDB.spots.length} spots available)`);

    try {
      // ランチ: レストランカテゴリから検索
      const lunchSpot = spotDB.getRandomSpot({
        area,
        category: 'restaurant',
        budget,
        datePhase: phase,
        timeSlot: 'lunch',
        mood,
        ngConditions,
        requireCoordinates: true,
      });

      if (lunchSpot) {
        lunchPlace = spotDB.formatSpotForPlan(lunchSpot);
        console.log(`[SpotDB] ✅ Lunch from DB: ${lunchPlace.place_name}`);
      } else {
        console.log(`[SpotDB] ⚠️  Lunch not found in DB (budget: ${budget}, phase: ${phase})`);
      }

      // カフェ: カフェカテゴリから検索
      const cafeSpot = spotDB.getRandomSpot({
        area,
        category: 'cafe',
        budget,
        datePhase: phase,
        timeSlot: 'afternoon',
        mood,
        ngConditions,
        requireCoordinates: true,
      });

      if (cafeSpot) {
        cafePlace = spotDB.formatSpotForPlan(cafeSpot);
        console.log(`[SpotDB] ✅ Cafe from DB: ${cafePlace.place_name}`);
      } else {
        console.log(`[SpotDB] ⚠️  Cafe not found in DB`);
      }

      // アクティビティ: ムードに応じたカテゴリから検索
      const activityCategories = ['museum', 'theater', 'shopping', 'park'];

      let activitySpot = null;
      for (const category of activityCategories) {
        activitySpot = spotDB.getRandomSpot({
          area,
          category,
          datePhase: phase,
          mood,
          ngConditions,
          requireCoordinates: true,
        });
        if (activitySpot) break;
      }

      if (!activitySpot) {
        // カテゴリ指定なしで検索
        activitySpot = spotDB.getRandomSpot({
          area,
          datePhase: phase,
          mood,
          ngConditions,
          requireCoordinates: true,
        });
      }

      if (activitySpot) {
        activityPlace = spotDB.formatSpotForPlan(activitySpot);
        console.log(`[SpotDB] ✅ Activity from DB: ${activityPlace.place_name}`);
      }

      // ディナー: レストラン/バーカテゴリから検索（ランチと重複しないように）
      const excludeSpotIds = [];
      if (lunchSpot) excludeSpotIds.push(lunchSpot.spot_name);

      const dinnerSpot = spotDB.getRandomSpot({
        area,
        category: 'restaurant',
        budget,
        datePhase: phase,
        timeSlot: 'evening',
        mood,
        ngConditions,
        requireCoordinates: true,
        excludeSpots: excludeSpotIds,
      });

      if (!dinnerSpot) {
        // バーもディナー候補に含める
        const barSpot = spotDB.getRandomSpot({
          area,
          category: 'bar',
          budget,
          datePhase: phase,
          timeSlot: 'evening',
          mood,
          ngConditions,
          requireCoordinates: true,
          excludeSpots: excludeSpotIds,
        });
        if (barSpot) {
          dinnerPlace = spotDB.formatSpotForPlan(barSpot);
          console.log(`[SpotDB] ✅ Dinner (bar) from DB: ${dinnerPlace.place_name}`);
        }
      } else {
        dinnerPlace = spotDB.formatSpotForPlan(dinnerSpot);
        console.log(`[SpotDB] ✅ Dinner from DB: ${dinnerPlace.place_name}`);
      }

      if (!dinnerPlace) {
        console.log(`[SpotDB] ⚠️  Dinner not found in DB (excluding: ${excludeSpotIds.join(', ')})`);
      }

    } catch (err) {
      console.error('[SpotDB] Error searching database:', err);
    }
  }

  // ===== 優先2: Google Places APIでフォールバック（DBで見つからなかったもののみ） =====

  if (hasPlacesAPI && (!lunchPlace || !activityPlace || !cafePlace || !dinnerPlace)) {
    console.log('[Places API] Fetching missing spots from Places API...');

    // 予算レベルに応じた検索キーワード
    const lunchKeywords = {
      low: ['カフェランチ人気', 'カジュアル和食おすすめ', 'ラーメン店おしゃれ', 'パスタランチ', '定食屋評判'],
      medium: ['イタリアンランチ有名', 'レストランランチおすすめ', 'ビストロランチ', 'カフェレストラン人気', '和食ランチ個室'],
      high: ['高級レストランランチ', 'フレンチランチ有名', '懐石料理ランチ', '高級イタリアン', '寿司ランチ高級'],
    };
    const dinnerKeywords = {
      low: ['居酒屋おしゃれ人気', 'カジュアルダイニング', '焼肉カジュアルおすすめ', 'イタリアン気軽', 'バル人気'],
      medium: ['おしゃれディナーおすすめ', 'イタリアン人気', 'フレンチビストロ', '和食個室ディナー', '焼肉おしゃれ'],
      high: ['高級ディナー有名', 'フレンチレストラン高級', '高級寿司', '会席料理', '鉄板焼き高級おすすめ'],
    };

    // アクティビティキーワード（moodベース）
    let activityKeywords = ['観光スポット', '人気スポット', 'デートスポット'];
    if (mood === 'active') {
      activityKeywords = ['スポーツ施設', 'アミューズメント', '体験施設'];
    } else if (mood === 'romantic') {
      activityKeywords = ['絶景スポット', '展望台有名', 'インスタ映え人気'];
    } else if (mood === 'relax') {
      activityKeywords = ['公園人気', '庭園有名', '美術館人気'];
    }
    const activityKeyword = activityKeywords[Math.floor(Math.random() * activityKeywords.length)];

    // カフェキーワード
    let cafeKeywords = ['おしゃれカフェ', 'スイーツカフェ', '隠れ家カフェ'];
    if (budget === 'high') {
      cafeKeywords = ['高級カフェ', 'スペシャリティコーヒー', 'パティスリー併設カフェ'];
    } else if (mood === 'romantic') {
      cafeKeywords = ['雰囲気カフェ', '隠れ家カフェ', 'テラスカフェ'];
    }
    const cafeKeyword = cafeKeywords[Math.floor(Math.random() * cafeKeywords.length)];

    const lunchOptions = lunchKeywords[budget] || lunchKeywords.medium;
    const dinnerOptions = dinnerKeywords[budget] || dinnerKeywords.medium;
    const lunchKeyword = lunchOptions[Math.floor(Math.random() * lunchOptions.length)];
    const dinnerKeyword = dinnerOptions[Math.floor(Math.random() * dinnerOptions.length)];

    // 必要なもののみを並列検索
    try {
      const searches = [];
      const searchTypes = [];

      if (!lunchPlace) {
        searches.push(searchPlaces(lunchKeyword, areaJapanese, { category: 'restaurant' }));
        searchTypes.push('lunch');
      }
      if (!activityPlace) {
        searches.push(searchPlaces(activityKeyword, areaJapanese, { category: 'tourist_attraction' }));
        searchTypes.push('activity');
      }
      if (!cafePlace) {
        searches.push(searchPlaces(cafeKeyword, areaJapanese, { category: 'cafe' }));
        searchTypes.push('cafe');
      }
      if (!dinnerPlace) {
        searches.push(searchPlaces(dinnerKeyword, areaJapanese, { category: 'restaurant' }));
        searchTypes.push('dinner');
      }

      const results = await Promise.all(searches);

      // 結果を対応する変数に代入
      results.forEach((result, index) => {
        const type = searchTypes[index];
        if (result) {
          if (type === 'lunch') lunchPlace = result;
          else if (type === 'activity') activityPlace = result;
          else if (type === 'cafe') cafePlace = result;
          else if (type === 'dinner') dinnerPlace = result;
          console.log(`[Places API] ✅ ${type} fetched from Places API`);
        }
      });

    } catch (err) {
      console.error('[Places API] Search failed:', err);
    }
  }

  // フォールバック用のモックスポット
  const spotsByArea = {
    shibuya: {
      lunch: {name: '渋谷モディ', lat:35.6604, lng:139.7017, address: '東京都渋谷区神南1-21-3'},
      activity: {name:'渋谷センター街', lat:35.6597, lng:139.7006},
      dinner: {name:'渋谷スクランブルスクエア', lat:35.6591, lng:139.7006, address: '東京都渋谷区渋谷2-24-12'}
    },
    shinjuku: {
      lunch: {name:'新宿ミロード', lat:35.6894, lng:139.7023, address: '東京都新宿区西新宿1-1-3'},
      activity: {name:'新宿御苑周辺', lat:35.6852, lng:139.7101},
      dinner: {name:'新宿ルミネ口エリア', lat:35.6895, lng:139.7004, address: '東京都新宿区新宿3-38-2'}
    },
    ginza: {
      lunch: {name:'GINZA SIX', lat:35.6702, lng:139.7636, address: '東京都中央区銀座6-10-1'},
      activity: {name:'銀座通り散策', lat:35.6717, lng:139.7650},
      dinner: {name:'銀座コースレストラン', lat:35.6705, lng:139.7640, address: '東京都中央区銀座4-1'}
    },
    harajuku: {
      lunch: {name:'表参道カフェ', lat:35.6654, lng:139.7120, address: '東京都渋谷区神宮前4-12-10'},
      activity: {name:'竹下通り散策', lat:35.6702, lng:139.7020},
      dinner: {name:'原宿イタリアン', lat:35.6700, lng:139.7034, address: '東京都渋谷区神宮前1-8-8'}
    },
    odaiba: {
      lunch: {name:'お台場ヴィーナスフォート', lat:35.6251, lng:139.7754, address: '東京都江東区青海1-3-15'},
      activity: {name:'お台場海浜公園', lat:35.6298, lng:139.7766},
      dinner: {name:'お台場デックス', lat:35.6272, lng:139.7757, address: '東京都港区台場1-6-1'}
    },
    ueno: {
      lunch: {name:'上野の森さくらテラス', lat:35.7156, lng:139.7745, address: '東京都台東区上野公園1-54'},
      activity: {name:'国立西洋美術館', lat:35.7188, lng:139.7769},
      dinner: {name:'アメ横の居酒屋', lat:35.7138, lng:139.7755, address: '東京都台東区上野4-7-8'}
    },
    asakusa: {
      lunch: {name:'浅草雷門周辺', lat:35.7148, lng:139.7967, address: '東京都台東区浅草2-3-1'},
      activity: {name:'浅草寺散策', lat:35.7140, lng:139.7967},
      dinner: {name:'仲見世通りグルメ', lat:35.7146, lng:139.7967, address: '東京都台東区浅草1-18-1'}
    },
    ikebukuro: {
      lunch: {name:'池袋サンシャイン', lat:35.7296, lng:139.7193, address: '東京都豊島区東池袋3-1-1'},
      activity: {name:'サンシャイン水族館', lat:35.7289, lng:139.7188},
      dinner: {name:'池袋グルメ街', lat:35.7310, lng:139.7101, address: '東京都豊島区西池袋1-1-25'}
    },
  };

  const spots = spotsByArea[area] || spotsByArea.shibuya;

  // 時間帯のバリエーションを生成（time_slotベース）
  const timeVariations = {
    lunch: { start: '12:00', lunch: '12:00', activity: '14:00', cafe: '16:30', dinner: '18:00' },
    dinner: { start: '17:00', lunch: null, activity: '17:00', cafe: '18:30', dinner: '20:00' },
    halfday: { start: '12:00', lunch: '12:00', activity: '14:00', cafe: '16:30', dinner: '18:00' },
    fullday: { start: '09:00', lunch: '11:30', activity: '13:30', cafe: '15:30', dinner: '17:30' },
  };

  const selectedTimes = timeVariations[timeSlot] || timeVariations.lunch;
  const baseTimes = timeVariations.lunch;
  const timeOrDefault = (key, fallback) => selectedTimes[key] || baseTimes[key] || fallback;

  function buildPhotoUrl(photo) {
    if (!photo || !photo.name || !process.env.GOOGLE_MAPS_API_KEY) return null;
    // プロキシ経由で取得し、file:// でも参照できるようにする
    return `${PUBLIC_API_BASE}/api/photo?name=${encodeURIComponent(photo.name)}`;
  }

  function createPlaceholderPhoto(title, variant = 0) {
    const palette = ['#667eea', '#764ba2', '#ff6b6b'];
    const bg = palette[variant % palette.length];
    const safeTitle = (title || 'Spot').replace(/"/g, '');
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='500'>
      <defs>
        <linearGradient id='g${variant}' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0%' stop-color='${bg}' stop-opacity='0.9'/>
          <stop offset='100%' stop-color='#1c1c28' stop-opacity='0.8'/>
        </linearGradient>
      </defs>
      <rect width='800' height='500' fill='url(#g${variant})'/>
      <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='Arial' font-size='42' fill='white' opacity='0.9'>${safeTitle}</text>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  function createPlaceholderPhotos(title) {
    return [
      createPlaceholderPhoto(title, 0),
      createPlaceholderPhoto(title, 1),
      createPlaceholderPhoto(title, 2),
    ];
  }

  function generateMockReviews(title) {
    const base = title || 'このスポット';
    return [
      { author: 'Aさん', rating: 4.6, text: `${base}は雰囲気がよく、会話しやすかったです。` },
      { author: 'Bさん', rating: 4.2, text: `${base}のスタッフが親切で、初デートでも安心でした。` },
      { author: 'Cさん', rating: 4.4, text: `${base}の周辺も散策しやすくて移動がスムーズでした。` },
    ];
  }

  function parsePreferredTime(text, defaultTime) {
    if (!text) return defaultTime;

    const explicit = text.match(/(\d{1,2})[:：](\d{2})/);
    if (explicit) {
      const hour = Math.max(0, Math.min(23, parseInt(explicit[1], 10)));
      const minutes = explicit[2] ? Math.max(0, Math.min(59, parseInt(explicit[2], 10))) : 0;
      return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    const hourOnly = text.match(/(\d{1,2})時/);
    if (hourOnly) {
      const hour = Math.max(0, Math.min(23, parseInt(hourOnly[1], 10)));
      return `${String(hour).padStart(2, '0')}:00`;
    }

    if (text.match(/朝|午前|morning/i)) return '10:00';
    if (text.match(/昼|ランチ|午後|afternoon/i)) return timeOrDefault('lunch', '13:00');
    if (text.match(/夕方|夜|ディナー|dinner|night/i)) return timeOrDefault('dinner', '19:00');

    return defaultTime;
  }

  async function insertCustomRequestSlot(baseSchedule) {
    if (!customRequest) return { schedule: baseSchedule, meetingOverride: null, farewellOverride: null };

    // キーワードから「集合/待ち合わせ」を判定
    const meetingKeywords = /(集合|待ち合わせ|待合せ|meet)/i;
    const farewellKeywords = /(解散|終わり|別れ|バイバイ|帰る|farewell|goodbye)/i;
    const isMeetingRequest = meetingKeywords.test(customRequest);
    const isFarewellRequest = !isMeetingRequest && farewellKeywords.test(customRequest);

    // 時刻を抽出
    const preferredTime = parsePreferredTime(customRequest, timeOrDefault('activity', timeOrDefault('lunch', '12:00')));
    const preferredStartMinutes = (() => {
      const [h, m] = preferredTime.split(':').map(Number);
      return h * 60 + m;
    })();

    // 場所名候補を抽出（時刻や集合/解散ワードを除去）
    const placeText = customRequest
      .replace(/(\d{1,2})[:：]\d{2}/g, '')
      .replace(/(\d{1,2})時/g, '')
      .replace(meetingKeywords, '')
      .replace(farewellKeywords, '')
      .replace(/に行きたい|へ行きたい|に行く|行きたい|で集合|集合|待ち合わせ|待合せ/gi, '')
      .replace(/で解散|解散|終わり|別れ|帰る/gi, '')
      .replace(/^\s+|\s+$/g, '');
    const safeTitle = placeText.length > 0 ? placeText : customRequest;

    let resolvedName = safeTitle;
    let resolvedLat = areaCenter.lat;
    let resolvedLng = areaCenter.lng;
    let resolvedPlaceId = null;
    let resolvedMapUrl = 'https://www.google.com/search?q=' + encodeURIComponent(safeTitle);

    if (hasPlacesAPI && placeText) {
      try {
        let searched = await searchPlaces(placeText, areaJapanese);
        // エリアと合わずにヒットしない場合は東京都全体で再検索
        if (!searched) {
          searched = await searchPlaces(placeText, '東京都');
        }
        if (searched) {
          resolvedName = searched.name || resolvedName;
          resolvedLat = searched.lat || resolvedLat;
          resolvedLng = searched.lng || resolvedLng;
          resolvedPlaceId = searched.place_id || null;
          resolvedMapUrl = searched.url || resolvedMapUrl;
        }
      } catch (err) {
        console.error('[CustomRequest] searchPlaces error:', err.message);
      }
    }

    if (isMeetingRequest) {
      return {
        schedule: baseSchedule,
        meetingOverride: {
          name: resolvedName,
          lat: resolvedLat,
          lng: resolvedLng,
          mapUrl: resolvedMapUrl,
          time: preferredTime,
        },
        farewellOverride: null,
      };
    }

    if (isFarewellRequest) {
      return {
        schedule: baseSchedule,
        meetingOverride: null,
        farewellOverride: {
          name: resolvedName,
          lat: resolvedLat,
          lng: resolvedLng,
          mapUrl: resolvedMapUrl,
          time: preferredTime,
        },
      };
    }

    const customItem = {
      time: preferredTime,
      type: 'custom',
      place_name: resolvedName,
      lat: resolvedLat,
      lng: resolvedLng,
      place_id: resolvedPlaceId,
      area: area,
      price_range: prices.activity,
      duration: '60min',
      reason: `ユーザーリクエスト: ${customRequest}`,
      reason_tags: ['リクエスト反映'],
      info_url: resolvedMapUrl,
      photos: createPlaceholderPhotos(resolvedName),
      reviews: [],
      is_custom: true,
      preferred_start_minutes: preferredStartMinutes,
    };

    const toMinutes = (t) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };

    const withCustom = [];
    let inserted = false;
    for (const item of baseSchedule) {
      if (!inserted && item.time && toMinutes(preferredTime) <= toMinutes(item.time)) {
        withCustom.push(customItem);
        inserted = true;
      }
      withCustom.push(item);
    }
    if (!inserted) {
      withCustom.push(customItem);
    }
    return { schedule: withCustom, meetingOverride: null, farewellOverride: null };
  }

  // 理由とタグを生成するヘルパー関数
  function generateReasonAndTags(type, spotName) {
    let reason = '';
    let tags = [];

    // フェーズベースの理由とタグ
    if (type === 'lunch') {
      if (phase === 'first') {
        reason = '初対面でも会話しやすい落ち着いた環境を選びました';
        tags.push('初デート向け', '会話しやすい');
      } else if (phase === 'anniversary') {
        reason = '記念日にふさわしい特別な雰囲気のお店を選びました';
        tags.push('記念日', '特別感');
      } else if (phase === 'casual') {
        reason = 'カジュアルに楽しめる雰囲気のお店を選びました';
        tags.push('カジュアル', '気軽');
      } else {
        reason = 'リラックスして会話を楽しめる場所を選びました';
        tags.push('リラックス', '会話向き');
      }
    } else if (type === 'activity') {
      if (mood === 'active') {
        reason = 'アクティブに楽しめる体験を重視しました';
        tags.push('アクティブ', '体験重視');
      } else if (mood === 'romantic') {
        reason = 'ロマンチックな雰囲気を楽しめる場所を選びました';
        tags.push('ロマンチック', '雰囲気◎');
      } else if (mood === 'relax') {
        reason = 'ゆったりと落ち着いて楽しめる場所を選びました';
        tags.push('リラックス', '落ち着き');
      } else {
        reason = '一緒に楽しめる体験を重視しました';
        tags.push('楽しめる', '体験');
      }
    } else if (type === 'cafe') {
      if (phase === 'anniversary') {
        reason = '記念日らしい上質な空間で特別な時間を';
        tags.push('記念日', '上質');
      } else if (mood === 'romantic') {
        reason = '雰囲気のある空間でゆっくり過ごせます';
        tags.push('雰囲気◎', 'ゆったり');
      } else {
        reason = 'おしゃれな空間でリフレッシュできる場所を選びました';
        tags.push('おしゃれ', 'リフレッシュ');
      }
    } else if (type === 'dinner') {
      if (budget === 'high') {
        reason = '特別な時間を過ごせる高級感のある場所を選びました';
        tags.push('高級感', '特別');
      } else if (phase === 'anniversary') {
        reason = '記念日を彩る素敵なディナーを楽しめます';
        tags.push('記念日', 'ディナー');
      } else if (mood === 'romantic') {
        reason = 'ロマンチックな雰囲気でゆっくり関係を深められます';
        tags.push('ロマンチック', '落ち着き');
      } else {
        reason = 'ゆったりとした時間で会話を楽しめる場所を選びました';
        tags.push('ゆったり', '会話向き');
      }
    }

    return { reason: reason || '楽しい時間を過ごせる場所を選びました', reason_tags: tags };
  }

  function mapReviews(rawReviews = [], placeName = 'このスポット') {
    const pickReviews = (list) => list.map((r) => ({
      author: r.authorAttribution?.displayName || r.author || '匿名',
      rating: r.rating || null,
      text: (r.text && (r.text.text || r.text)) || r.reviewText || '',
    }));

    const jaReviewsRaw = (rawReviews || []).filter((r) => {
      const lang = r.text?.languageCode || r.languageCode;
      return lang === 'ja';
    });

    if (jaReviewsRaw.length > 0) {
      return pickReviews(jaReviewsRaw);
    }

    return rawReviews && rawReviews.length > 0 ? pickReviews(rawReviews) : [];
  }

  async function hydrateScheduleWithPlaces(baseSchedule, areaName) {
    if (!hasPlacesAPI) return baseSchedule;
    const enriched = [];
    for (const item of baseSchedule) {
      if (item.is_travel || item.is_meeting || item.is_farewell || item.type === 'walk') {
        enriched.push(item);
        continue;
      }

      let placeId = item.place_id || null;
      let details = null;
      let searchPhotos = [];

      try {
        if (!placeId) {
          const searched = await searchPlaces(item.place_name, areaName);
          placeId = searched && searched.place_id;
          searchPhotos = searched && searched.photos ? searched.photos : [];
          if (!item.lat && searched && searched.lat && searched.lng) {
            item.lat = searched.lat;
            item.lng = searched.lng;
          }
        }
        if (placeId) {
          details = await getPlaceDetails(placeId);
        }
      } catch (err) {
        console.error('[Places] hydrate error:', err.message);
      }

      if (details) {
        let photoUrls = (details.photos || [])
          .map(buildPhotoUrl)
          .filter(Boolean);

        if ((!photoUrls || photoUrls.length === 0) && searchPhotos.length > 0) {
          photoUrls = searchPhotos.map(buildPhotoUrl).filter(Boolean);
        }

        photoUrls = photoUrls.slice(0, 3);
        const reviews = mapReviews(details.reviews || [], item.place_name).slice(0, 3);

        enriched.push({
          ...item,
          place_id: placeId || item.place_id || null,
          photos: photoUrls.length ? photoUrls : item.photos,
          reviews: reviews.length ? reviews : item.reviews,
          rating: details.rating || item.rating,
          official_url: details.website || item.official_url,
          address: details.address || item.address,
        });
      } else {
        let fallbackPhotos = [];
        if (searchPhotos && searchPhotos.length > 0) {
          fallbackPhotos = searchPhotos.map(buildPhotoUrl).filter(Boolean).slice(0, 3);
        }
        enriched.push({
          ...item,
          photos: fallbackPhotos.length ? fallbackPhotos : item.photos,
        });
      }
    }
    return enriched;
  }

  function enrichScheduleMedia(list) {
    return list.map((item) => {
      if (item.is_travel || item.is_meeting || item.is_farewell) return item;
      if (item.type === 'walk') return item;
      return {
        ...item,
        photos: item.photos || createPlaceholderPhotos(item.place_name),
        reviews: item.reviews || [],
      };
    });
  }

  let schedule = [];

  if (phase === 'first') {
    // 初デート：落ち着いて会話しやすい
    const lunch = lunchPlace || spots.lunch;
    const activity = activityPlace || spots.activity;
    const cafe = cafePlace || { name: spots.lunch.name + ' カフェ', lat: spots.lunch.lat + 0.0003, lng: spots.lunch.lng + 0.0003 };
    const dinner = dinnerPlace || spots.dinner;

    console.log(`[Plan] Lunch: ${lunch.name}, Activity: ${activity.name}, Cafe: ${cafe.name}, Dinner: ${dinner.name}`);

    const lunchRT = generateReasonAndTags('lunch', lunch.name);
    const activityRT = generateReasonAndTags('activity', activity.name);
    const cafeRT = generateReasonAndTags('cafe', cafe.name);
    const dinnerRT = generateReasonAndTags('dinner', dinner.name);

    schedule = [
      {
        time: timeOrDefault('lunch', '12:00'),
        type: 'lunch',
        place_name: lunch.name,
        lat: lunch.lat,
        lng: lunch.lng,
        area: area,
        address: lunch.address || null,
        price_range: prices.lunch,
        duration: '60min',
        reason: lunchRT.reason,
        reason_tags: lunchRT.reason_tags,
        info_url: lunch.url || 'https://www.google.com/search?q=' + encodeURIComponent(lunch.name),
        official_url: lunch.official_url || null,
        rating: lunch.rating,
      },
      {
        time: timeOrDefault('activity', '14:00'),
        type: 'activity',
        place_name: activity.name,
        lat: activity.lat,
        lng: activity.lng,
        area: area,
        price_range: prices.activity,
        duration: '90min',
        reason: activityRT.reason,
        reason_tags: activityRT.reason_tags,
        info_url: activity.url || 'https://www.google.com/search?q=' + encodeURIComponent(activity.name),
        official_url: activity.official_url || null,
        rating: activity.rating,
      },
      {
        time: timeOrDefault('cafe', '16:30'),
        type: 'cafe',
        place_name: cafe.name,
        lat: cafe.lat,
        lng: cafe.lng,
        area: area,
        price_range: prices.cafe,
        duration: '45min',
        reason: cafeRT.reason,
        reason_tags: cafeRT.reason_tags,
        info_url: cafe.url || 'https://www.google.com/search?q=' + encodeURIComponent(cafe.name),
        official_url: cafe.official_url || null,
        rating: cafe.rating,
      },
      {
        time: timeOrDefault('dinner', '18:00'),
        type: 'dinner',
        place_name: dinner.name,
        lat: dinner.lat,
        lng: dinner.lng,
        area: area,
        address: dinner.address || null,
        price_range: prices.dinner,
        duration: '90min',
        reason: dinnerRT.reason,
        reason_tags: dinnerRT.reason_tags,
        info_url: dinner.url || 'https://www.google.com/search?q=' + encodeURIComponent(dinner.name),
        official_url: dinner.official_url || null,
        rating: dinner.rating,
      },
    ];
  } else if (phase === 'second') {
    // 2〜3回目：活動を増やす
    const lunch = lunchPlace || spots.lunch;
    const activity = activityPlace || spots.activity;
    const cafe = cafePlace || { name: spots.lunch.name + ' カフェ', lat: spots.lunch.lat + 0.0003, lng: spots.lunch.lng + 0.0003 };

    const lunchRT = generateReasonAndTags('lunch', lunch.name);
    const activityRT = generateReasonAndTags('activity', activity.name);
    const cafeRT = generateReasonAndTags('cafe', cafe.name);

    schedule = [
      {
        time: '10:00',
        type: 'activity',
        place_name: activity.name,
        lat: activity.lat,
        lng: activity.lng,
        area: area,
        price_range: prices.activity,
        duration: '120min',
        reason: activityRT.reason,
        reason_tags: activityRT.reason_tags,
        info_url: activity.url || 'https://www.google.com/search?q=' + encodeURIComponent(activity.name),
        official_url: activity.official_url || null,
        rating: activity.rating,
      },
      {
        time: timeOrDefault('lunch', '12:00'),
        type: 'lunch',
        place_name: lunch.name,
        lat: lunch.lat,
        lng: lunch.lng,
        area: area,
        address: lunch.address || null,
        price_range: prices.lunch,
        duration: '60min',
        reason: lunchRT.reason,
        reason_tags: lunchRT.reason_tags,
        info_url: lunch.url || 'https://www.google.com/search?q=' + encodeURIComponent(lunch.name),
        official_url: lunch.official_url || null,
        rating: lunch.rating,
      },
      {
        time: timeOrDefault('activity', '14:00'),
        type: 'walk',
        place_name: areaJapanese + ' 街歩き',
        lat: areaCenter.lat,
        lng: areaCenter.lng,
        area: area,
        price_range: '0',
        duration: '60min',
        reason: activityRT.reason,
        reason_tags: activityRT.reason_tags,
      },
      {
        time: timeOrDefault('cafe', '16:30'),
        type: 'cafe',
        place_name: cafe.name,
        lat: cafe.lat,
        lng: cafe.lng,
        area: area,
        price_range: prices.cafe,
        duration: '45min',
        reason: cafeRT.reason,
        reason_tags: cafeRT.reason_tags,
        info_url: cafe.url || 'https://www.google.com/search?q=' + encodeURIComponent(cafe.name),
        official_url: cafe.official_url || null,
        rating: cafe.rating,
      },
    ];
  } else if (phase === 'anniversary') {
    // 記念日：特別感のあるプラン
    const lunch = lunchPlace || spots.lunch;
    const activity = activityPlace || spots.activity;
    const dinner = dinnerPlace || spots.dinner;

    const lunchRT = generateReasonAndTags('lunch', lunch.name);
    const activityRT = generateReasonAndTags('activity', activity.name);
    const dinnerRT = generateReasonAndTags('dinner', dinner.name);

    schedule = [
      {
        time: timeOrDefault('lunch', '11:30'),
        type: 'lunch',
        place_name: lunch.name,
        lat: lunch.lat,
        lng: lunch.lng,
        area: area,
        address: lunch.address || null,
        price_range: prices.lunch,
        duration: '90min',
        reason: lunchRT.reason,
        reason_tags: lunchRT.reason_tags,
        info_url: lunch.url || 'https://www.google.com/search?q=' + encodeURIComponent(lunch.name),
        official_url: lunch.official_url || null,
        rating: lunch.rating,
      },
      {
        time: timeOrDefault('activity', '13:30'),
        type: 'activity',
        place_name: activity.name,
        lat: activity.lat,
        lng: activity.lng,
        area: area,
        price_range: prices.activity,
        duration: '120min',
        reason: activityRT.reason,
        reason_tags: activityRT.reason_tags,
        info_url: activity.url || 'https://www.google.com/search?q=' + encodeURIComponent(activity.name),
        official_url: activity.official_url || null,
        rating: activity.rating,
      },
      {
        time: timeOrDefault('dinner', '17:30'),
        type: 'dinner',
        place_name: dinner.name,
        lat: dinner.lat,
        lng: dinner.lng,
        area: area,
        address: dinner.address || null,
        price_range: prices.dinner,
        duration: '120min',
        reason: dinnerRT.reason,
        reason_tags: dinnerRT.reason_tags,
        info_url: dinner.url || 'https://www.google.com/search?q=' + encodeURIComponent(dinner.name),
        official_url: dinner.official_url || null,
        rating: dinner.rating,
      },
    ];
  } else {
    // カジュアル：気軽に楽しむプラン
    const lunch = lunchPlace || spots.lunch;
    const activity = activityPlace || spots.activity;
    const cafe = cafePlace || { name: spots.lunch.name + ' カフェ', lat: spots.lunch.lat + 0.0003, lng: spots.lunch.lng + 0.0003 };
    const dinner = dinnerPlace || spots.dinner;

    // 時間帯に応じてスケジュールを変更
    if (timeSlot === 'dinner') {
      // ディナータイムのみ
      const activityRT = generateReasonAndTags('activity', activity.name);
      const cafeRT = generateReasonAndTags('cafe', cafe.name);
      const dinnerRT = generateReasonAndTags('dinner', dinner.name);

      schedule = [
        {
          time: timeOrDefault('activity', '17:00'),
          type: 'activity',
          place_name: activity.name,
          lat: activity.lat,
          lng: activity.lng,
          area: area,
          price_range: prices.activity,
          duration: '60min',
          reason: activityRT.reason,
          reason_tags: activityRT.reason_tags,
          info_url: activity.url || 'https://www.google.com/search?q=' + encodeURIComponent(activity.name),
        official_url: activity.official_url || null,
        rating: activity.rating,
      },
      {
        time: timeOrDefault('cafe', '18:30'),
        type: 'cafe',
        place_name: cafe.name,
          lat: cafe.lat,
          lng: cafe.lng,
          area: area,
          price_range: prices.cafe,
          duration: '45min',
          reason: cafeRT.reason,
          reason_tags: cafeRT.reason_tags,
          info_url: cafe.url || 'https://www.google.com/search?q=' + encodeURIComponent(cafe.name),
          official_url: cafe.official_url || null,
          rating: cafe.rating,
        },
      {
        time: timeOrDefault('dinner', '20:00'),
        type: 'dinner',
        place_name: dinner.name,
          lat: dinner.lat,
          lng: dinner.lng,
          area: area,
          address: dinner.address || null,
          price_range: prices.dinner,
          duration: '90min',
          reason: dinnerRT.reason,
          reason_tags: dinnerRT.reason_tags,
          info_url: dinner.url || 'https://www.google.com/search?q=' + encodeURIComponent(dinner.name),
          official_url: dinner.official_url || null,
          rating: dinner.rating,
        },
      ];
    } else {
      // ランチ・半日・終日
      const lunchRT = generateReasonAndTags('lunch', lunch.name);
      const activityRT = generateReasonAndTags('activity', activity.name);
      const cafeRT = generateReasonAndTags('cafe', cafe.name);

      schedule = [
        {
          time: timeOrDefault('lunch', '12:00'),
          type: 'lunch',
          place_name: lunch.name,
          lat: lunch.lat,
          lng: lunch.lng,
          area: area,
          address: lunch.address || null,
          price_range: prices.lunch,
          duration: '60min',
          reason: lunchRT.reason,
          reason_tags: lunchRT.reason_tags,
          info_url: lunch.url || 'https://www.google.com/search?q=' + encodeURIComponent(lunch.name),
          official_url: lunch.official_url || null,
          rating: lunch.rating,
        },
        {
          time: timeOrDefault('activity', '14:00'),
          type: 'activity',
          place_name: activity.name,
          lat: activity.lat,
          lng: activity.lng,
          area: area,
          price_range: prices.activity,
          duration: '90min',
          reason: activityRT.reason,
          reason_tags: activityRT.reason_tags,
          info_url: activity.url || 'https://www.google.com/search?q=' + encodeURIComponent(activity.name),
          official_url: activity.official_url || null,
          rating: activity.rating,
        },
        {
          time: timeOrDefault('cafe', '16:30'),
          type: 'cafe',
          place_name: cafe.name,
          lat: cafe.lat,
          lng: cafe.lng,
          area: area,
          price_range: prices.cafe,
          duration: '45min',
          reason: cafeRT.reason,
          reason_tags: cafeRT.reason_tags,
          info_url: cafe.url || 'https://www.google.com/search?q=' + encodeURIComponent(cafe.name),
          official_url: cafe.official_url || null,
          rating: cafe.rating,
        },
      ];
    }
  }

  // customMeetingOverride/customFarewellOverride を使うため先に宣言
  let customMeetingOverride = null;
  let customFarewellOverride = null;

  if (customRequest) {
    const customResult = await insertCustomRequestSlot(schedule);
    schedule = customResult.schedule;
    customMeetingOverride = customResult.meetingOverride || null;
    customFarewellOverride = customResult.farewellOverride || null;
  }

  schedule = await hydrateScheduleWithPlaces(schedule, areaJapanese);
  schedule = enrichScheduleMedia(schedule);
  const toMinutesSimple = (t) => {
    if (!t || typeof t !== 'string') return null;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (isNaN(m) ? 0 : m);
  };
  const customSpots = schedule.filter((item) => item.is_custom || (item.reason_tags && item.reason_tags.includes('リクエスト反映')));
  const customIncluded = customSpots.length > 0;
  const customTimeSatisfied = customSpots.length === 0 ? false : customSpots.some((spot) => {
    if (typeof spot.preferred_start_minutes === 'number') {
      const actual = toMinutesSimple(spot.time);
      if (actual == null) return false;
      return Math.abs(actual - spot.preferred_start_minutes) <= 20; // ±20分以内
    }
    return true;
  });

  // アフィリエイトリンクは削除しました

  const costMap = {
    low: '3000-5000',
    medium: '7000-10000',
    high: '15000-25000',
  };

  // プラン全体の理由を生成
  function generatePlanReason() {
    const budgetNames = {
      low: 'カジュアル',
      medium: '程よい',
      high: '特別な'
    };

    const phaseNames = {
      first: '初めてのデート',
      second: '2〜3回目のデート',
      anniversary: '記念日のデート',
      casual: 'カジュアルなデート'
    };

    const timeSlotNames = {
      lunch: 'ランチタイム',
      dinner: 'ディナータイム',
      halfday: '半日',
      fullday: '1日'
    };

    const moodNames = {
      relax: 'リラックスした雰囲気',
      active: 'アクティブな体験',
      romantic: 'ロマンチックな雰囲気',
      casual: '気軽な雰囲気'
    };

    let reasons = [];

    // フェーズに応じた理由
    const phaseDescription = {
      first: '落ち着いて会話できる場所を中心に',
      second: '一緒に楽しめるアクティビティを多めに',
      anniversary: '特別な時間を過ごせる場所を',
      casual: '気軽に楽しめる場所を'
    };
    reasons.push(`${phaseNames[phase] || 'デート'}ということで、${phaseDescription[phase] || '楽しめる場所を'}選びました`);

    // 時間帯
    reasons.push(`${timeSlotNames[timeSlot] || ''}を中心としたプランです`);

    // ムード
    if (mood) {
      reasons.push(`今日の気分は${moodNames[mood] || mood}とのことで、それに合わせたスポットを選びました`);
    }

    // 予算
    reasons.push(`予算は${budgetNames[budget] || ''}な${costMap[budget]}円程度で設定しています`);

    // NG条件
    if (ngConditions.length > 0) {
      const ngNames = {
        outdoor: '屋外',
        indoor: '屋内のみ',
        crowd: '混雑',
        quiet: '静かすぎる場所',
        walk: '長時間歩く',
        rain: '雨天不可'
      };
      const ngList = ngConditions.map(ng => ngNames[ng] || ng).join('、');
      reasons.push(`${ngList}は避けるよう配慮しています`);
    }

    if (customRequest) {
      if (customIncluded && customTimeSatisfied) {
        reasons.push(`自由入力のリクエスト「${customRequest}」をスケジュール内に反映しています`);
      } else if (customIncluded && !customTimeSatisfied) {
        reasons.push(`自由入力のリクエスト「${customRequest}」は希望時刻ちょうどには難しいため、近い時間帯で提案しています`);
      } else {
        reasons.push(`自由入力のリクエスト「${customRequest}」はデートエリアと離れているため、今回はプランに含められませんでした`);
      }
    }

    return reasons.join('。') + '。';
  }

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

  function chooseTravelMode(distanceMeters) {
    // シンプルな距離ベースの移動手段推定（徒歩は20分程度まで許容）
    if (distanceMeters <= 1800) {
      const walkMin = estimateWalkingMinutes(distanceMeters);
      return {
        mode: 'walk',
        label: '徒歩',
        duration: `${walkMin}min`,
        travel_minutes: walkMin,
        reason: '近距離なので徒歩移動が最適です',
      };
    }
    if (distanceMeters <= 4500) {
      return {
        mode: 'train',
        label: '電車/地下鉄',
        duration: '8-12min',
        travel_minutes: 10,
        reason: '中距離なので電車/地下鉄移動が便利です',
      };
    }
    if (distanceMeters <= 7500) {
      return {
        mode: 'train',
        label: '電車/地下鉄',
        duration: '12-18min',
        travel_minutes: 15,
        reason: '少し距離があるため電車移動を推奨します',
      };
    }
    if (distanceMeters <= 12000) {
      return {
        mode: 'train',
        label: '電車/地下鉄',
        duration: '18-28min',
        travel_minutes: 22,
        reason: '長距離のため電車移動が現実的です',
      };
    }
    return {
      mode: 'train',
      label: '電車/地下鉄',
      duration: '25-40min',
      travel_minutes: 30,
      reason: '長距離のため電車移動が現実的です',
    };
  }

  // calculate travel distances/time between consecutive schedule items
  const parseMinutes = (t) => {
    if (!t || typeof t !== 'string') return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (isNaN(m) ? 0 : m);
  };

  // 時間順にソート（ユーザー指定のpreferred_start_minutesがあればそれを優先）
  schedule.sort((a, b) => {
    const aPref = typeof a.preferred_start_minutes === 'number' ? a.preferred_start_minutes : parseMinutes(a.time);
    const bPref = typeof b.preferred_start_minutes === 'number' ? b.preferred_start_minutes : parseMinutes(b.time);
    return aPref - bPref;
  });

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

  // 集合・移動・解散を含む詳細スケジュールを作成
  const detailedSchedule = [];

  const timeToMinutes = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const minutesToTime = (min) => {
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };
  const roundUpTo10 = (min) => Math.ceil(min / 10) * 10;

  // 最寄り駅の情報（エリアごと）
  const areaStations = {
    shibuya: { name: '渋谷駅', exit: 'ハチ公口' },
    shinjuku: { name: '新宿駅', exit: '東口' },
    ginza: { name: '銀座駅', exit: 'A1出口' },
    harajuku: { name: '原宿駅', exit: '竹下口' },
    odaiba: { name: 'お台場海浜公園駅', exit: '改札' },
    ueno: { name: '上野駅', exit: '公園口' },
    asakusa: { name: '浅草駅', exit: '1番出口' },
    ikebukuro: { name: '池袋駅', exit: '東口' },
  };
  const station = areaStations[area] || { name: '渋谷駅', exit: 'ハチ公口' };

  // 開始時刻を計算（最初のスポットの15分前に集合）
  const firstSpotTime = schedule[0].time;
  const [hours, minutes] = firstSpotTime.split(':').map(Number);
  const defaultMeetingTime = `${String(hours).padStart(2, '0')}:${String(Math.max(0, minutes - 15)).padStart(2, '0')}`;
  const meetingTime = (customMeetingOverride && customMeetingOverride.time) || defaultMeetingTime;
  const meetingName = (customMeetingOverride && customMeetingOverride.name) || `${station.name} ${station.exit}`;
  const meetingLat = (customMeetingOverride && customMeetingOverride.lat) || areaCenter.lat;
  const meetingLng = (customMeetingOverride && customMeetingOverride.lng) || areaCenter.lng;

  // 自由入力が別エリアの場合の集合・解散調整
  const distanceThreshold = 2500; // meters
  const isCustomFirst = schedule.length > 0 && schedule[0].is_custom;
  const isCustomLast = schedule.length > 0 && schedule[schedule.length - 1].is_custom;
  const firstCustom = isCustomFirst ? schedule[0] : null;
  const lastCustom = isCustomLast ? schedule[schedule.length - 1] : null;

  const distFromCenter = (item) => {
    if (!item || item.lat == null || item.lng == null) return 0;
    return areaDistance(areaCenter.lat, areaCenter.lng, item.lat, item.lng);
  };

  if (isCustomFirst && distFromCenter(firstCustom) > distanceThreshold) {
    const prefStart = firstCustom.preferred_start_minutes || parseMinutes(firstCustom.time);
    const mt = Math.max(0, prefStart - 10);
    customMeetingOverride = {
      name: firstCustom.place_name || meetingName,
      lat: firstCustom.lat || meetingLat,
      lng: firstCustom.lng || meetingLng,
      mapUrl: firstCustom.info_url || meetingName,
      time: minutesToTime(mt),
    };
    // 解散はデートエリアに戻すので customFarewellOverride は使わない
  }

  if (isCustomLast && distFromCenter(lastCustom) > distanceThreshold) {
    const prefEnd = (lastCustom.preferred_start_minutes || parseMinutes(lastCustom.time)) + (parseInt(lastCustom.duration) || 60);
    const ft = Math.max(0, prefEnd);
    customFarewellOverride = {
      name: lastCustom.place_name || `${station.name}付近`,
      lat: lastCustom.lat || areaCenter.lat,
      lng: lastCustom.lng || areaCenter.lng,
      mapUrl: lastCustom.info_url || `${station.name}付近`,
      time: minutesToTime(ft),
    };
    // 集合はデートエリアのまま
  }

  // 1. 集合
  detailedSchedule.push({
    time: (customMeetingOverride && customMeetingOverride.time) || meetingTime,
    type: 'meeting',
    place_name: (customMeetingOverride && customMeetingOverride.name) || meetingName,
    lat: (customMeetingOverride && customMeetingOverride.lat) || meetingLat,
    lng: (customMeetingOverride && customMeetingOverride.lng) || meetingLng,
    area: area,
    duration: '0min',
    reason: customMeetingOverride
      ? `ユーザー指定の集合場所: ${(customMeetingOverride && customMeetingOverride.name) || meetingName}`
      : `デートのスタート地点。待ち合わせ場所は目立つ場所を選びましょう。`,
    is_meeting: true,
  });

  // 実際のタイムラインを作成（移動時間を考慮して再計算）
  let currentStartMinutes = timeToMinutes(schedule[0].time);

  // 2. スポット間に移動を挿入
  for (let i = 0; i < schedule.length; i++) {
    const item = schedule[i];

    // 移動を追加（2つ目以降のスポット前）
    if (i > 0 && item.travel_time_min > 0) {
      const travelInfo = chooseTravelMode(item.walking_distance_m || 0);
      const preferredStart = item.preferred_start_minutes || null;
      const travelMinutes = travelInfo.travel_minutes || item.travel_time_min;
      // できるだけユーザー希望時刻に間に合うように移動開始を調整
      let travelStartTime = currentStartMinutes;
      if (preferredStart && (preferredStart - travelMinutes) > currentStartMinutes) {
        travelStartTime = preferredStart - travelMinutes;
      }
      const travelEndTime = travelStartTime + travelMinutes;
      const travelDurationText = travelInfo.duration || `${travelInfo.travel_minutes || item.travel_time_min}min`;
      detailedSchedule.push({
        time: minutesToTime(travelStartTime),
        end_time: minutesToTime(travelEndTime),
        type: 'travel',
        place_name: `移動（${travelInfo.label || '移動'}）`,
        duration: travelDurationText,
        walking_distance_m: item.walking_distance_m,
        transport_mode: travelInfo.mode || 'walk',
        transport_label: travelInfo.label || '移動',
        travel_time_min: travelInfo.travel_minutes || item.travel_time_min,
        reason: travelInfo.reason,
        is_travel: true,
      });
      currentStartMinutes = travelEndTime;
    }

    // スポット訪問を追加
    const durationMin = parseInt(item.duration) || 60;
    const preferredStart = item.preferred_start_minutes || null;
    const visitStart = roundUpTo10(Math.max(currentStartMinutes, preferredStart || currentStartMinutes));
    const endTimeMinutes = visitStart + durationMin;
    const endTime = minutesToTime(endTimeMinutes);

    detailedSchedule.push({
      ...item,
      time: minutesToTime(visitStart),
      end_time: endTime,
    });
    currentStartMinutes = endTimeMinutes;
  }

  // 3. 解散
  const lastItem = detailedSchedule[detailedSchedule.length - 1];
  const farewellTime = (customFarewellOverride && customFarewellOverride.time) || lastItem.end_time;
  const farewellName = (customFarewellOverride && customFarewellOverride.name) || `${station.name}付近`;
  const farewellLat = (customFarewellOverride && customFarewellOverride.lat) || areaCenter.lat;
  const farewellLng = (customFarewellOverride && customFarewellOverride.lng) || areaCenter.lng;

  detailedSchedule.push({
    time: farewellTime,
    type: 'farewell',
    place_name: farewellName,
    lat: farewellLat,
    lng: farewellLng,
    area: area,
    duration: '0min',
    reason: customFarewellOverride
      ? `ユーザー指定の解散場所: ${farewellName}`
      : '楽しい一日の終わり。次のデートの約束もここで。',
    is_farewell: true,
  });

  // 元のスケジュールを詳細版に置き換え
  schedule = detailedSchedule;

  // 調整メッセージを生成
  let adjustmentMessage = '';
  if (adjustment) {
    adjustmentMessage = `\n\n✨ 調整内容「${adjustment}」を反映しました！`;
  }

  return {
    plan_summary:
      phase === 'first'
        ? '落ち着いて会話しやすい初デート向けプラン'
        : phase === 'second'
          ? 'より親密になる2〜3回目デート向けプラン'
          : phase === 'anniversary'
            ? '記念日を彩る特別なデートプラン'
            : 'カジュアルに楽しむデートプラン',
    plan_reason: generatePlanReason() + adjustmentMessage,
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
          : phase === 'anniversary'
            ? 'これからもずっと一緒にいたいね。'
            : 'また気軽に会おうね。',
  };
}

// Google Places 検索用エンドポイント（APIキー提供時に有効化）
app.post('/api/search-place', async (req, res) => {
  try {
    const { query, location = '東京都' } = req.body;
    if (!process.env.GOOGLE_MAPS_API_KEY) {
      return res.json({ success: false, message: 'Google Maps API key not configured' });
    }
    let place = await searchPlaces(query, location);
    // フォールバック: API が使えない場合は簡易モックを返す
    if (!place) {
      place = {
        name: `${query}（${location}）`,
        address: location,
        lat: null,
        lng: null,
        rating: null,
        place_id: null,
        url: `https://www.google.com/search?q=${encodeURIComponent(query + ' ' + location)}`,
        mocked: true,
      };
    }
    res.json({ success: true, data: place });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Google Places 詳細情報取得
app.post('/api/place-details', async (req, res) => {
  try {
    const { place_id } = req.body;
    if (!process.env.GOOGLE_MAPS_API_KEY) {
      return res.json({ success: false, message: 'Google Maps API key not configured' });
    }
    let details = await getPlaceDetails(place_id);
    if (!details) {
      details = {
        name: null,
        address: null,
        opening_hours: [],
        website: null,
        rating: null,
        phone: null,
        photos: [],
        mocked: true,
      };
    }
    res.json({ success: true, data: details });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Google Maps APIキーを安全に提供するエンドポイント（レート制限と簡易認証付き）
app.get('/api/maps-key', simpleAuth, mapsKeyLimiter, (_req, res) => {
  // 本番環境では、認証やレート制限を追加すべき
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey || apiKey === 'AIzaSyA_le6vbQ0Lm2auWAfT72b6Uhq58pM-iLQ') {
    return res.status(503).json({ error: 'Maps API not configured' });
  }

  res.json({ apiKey });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Places API 写真プロキシ（リファラ制限を回避するため）
const axios = require('axios');
app.get('/api/photo', async (req, res) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const name = req.query.name;
  const referer =
    (PLACES_REFERER || req.headers.referer || '').replace(/\/$/, '') ||
    'https://maps.googleapis.com';

  if (!apiKey || !name) {
    return res.status(400).send('Missing API key or photo name');
  }

  try {
    const url = `https://places.googleapis.com/v1/${decodeURIComponent(name)}/media?maxWidthPx=800`;
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        Referer: referer,
        'X-Goog-Api-Key': apiKey,
      },
    });
    const contentType = response.headers['content-type'] || 'image/jpeg';
    res.set('Content-Type', contentType);
    res.send(response.data);
  } catch (error) {
    console.error('[Photo proxy] error:', error.response?.data || error.message);
    res.status(500).send('Failed to fetch photo');
  }
});
