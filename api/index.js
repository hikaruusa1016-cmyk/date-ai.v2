const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const { searchPlaces, getPlaceDetails, getCoordinatesForLocation } = require('./services/places');
const { getSpotDatabase } = require('./services/spotDatabase');
const { getTransitDirections, getDrivingDirections } = require('./services/directions');
const axios = require('axios');

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
app.set('trust proxy', 1); // Vercelのプロキシを信頼する設定

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

// スポットデータベースのインスタンス作成（ロードは遅延させる）
const spotDB = getSpotDatabase();
console.log('✅ Spot Database instance created (Lazy loading enabled)');

// CORS設定（本番環境対応）
const corsOptions = {
  origin: '*', // すべてのオリジンを許可（デバッグと本番の互換性のため）
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-access-token'],
};
app.use(cors(corsOptions));
app.use(express.json());

// 静的ファイル配信（フロントエンド）
const path = require('path');
app.use('/frontend', express.static(path.join(__dirname, '../frontend')));

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

// movement_style ごとの移動ポリシーを定義
function getMovementPreferences(style) {
  const defaults = {
    key: 'balanced',
    label: 'バランス',
    description: '移動と滞在のバランスを取る標準プラン',
    max_leg_minutes: 25,
    max_areas: 2,
    focus: '移動時間は25分程度まで、主要エリア2つ以内で構成',
  };

  const map = {
    single_area: {
      key: 'single_area',
      label: 'ひとつの街でゆっくり',
      description: '徒歩中心・同一エリア内で移動少なめ',
      max_leg_minutes: 15,
      max_areas: 1,
      focus: '半径1km/徒歩10〜15分以内を目安に、滞在時間を長めに確保',
    },
    nearby_areas: {
      key: 'nearby_areas',
      label: '近くのエリアを少し回る',
      description: '徒歩＋短距離移動で2エリア程度',
      max_leg_minutes: 30,
      max_areas: 2,
      focus: '隣接エリアまで、移動20〜30分以内を優先',
    },
    multiple_areas: {
      key: 'multiple_areas',
      label: 'いくつかの街を巡りたい',
      description: '電車移動を含めて複数エリアを巡る',
      max_leg_minutes: 45,
      max_areas: 3,
      focus: '最大3エリア・1区間30〜45分を上限にルートを最適化',
    },
    day_trip: {
      key: 'day_trip',
      label: '遠出したい（日帰り）',
      description: '片道1〜1.5時間の遠出も許容し、現地滞在を重視',
      max_leg_minutes: 90,
      max_areas: 3,
      focus: '長距離移動を含めるが、現地では移動30分以内で目玉スポットを優先',
    },
  };

  return map[style] || defaults;
}

// 最適なデート時間を計算する関数
function calculateOptimalDuration(date_phase, budget_level, movement_style) {
  let baseHours = 3.5; // デフォルト3.5時間

  // 関係性による調整
  if (date_phase === 'first') baseHours = 2.5;
  if (date_phase === 'second') baseHours = 4.0;
  if (date_phase === 'casual') baseHours = 4.0;
  if (date_phase === 'anniversary') baseHours = 5.5;

  // 予算による調整
  if (budget_level === 'low') baseHours -= 0.5;
  if (budget_level === 'high') baseHours += 1.0;
  if (budget_level === 'no_limit') baseHours += 1.5;

  // 移動スタイルによる調整
  if (movement_style === 'single_area') baseHours -= 0.5;
  if (movement_style === 'nearby_areas') baseHours += 0;
  if (movement_style === 'multiple_areas') baseHours += 1.0;
  if (movement_style === 'day_trip') baseHours = 8.0;

  // 2-10時間の範囲に制限
  return Math.max(2, Math.min(10, baseHours));
}

// ウィザードデータをconditions形式に変換する関数
function convertWizardDataToConditions(wizardData) {
  const {
    start_location,
    date_phase,
    start_time,
    end_time,
    budget_level,
    movement_style,
    transportation_modes = ['walk', 'transit'], // Default modes
    preferred_areas = []
  } = wizardData;

  const movement_preferences = getMovementPreferences(movement_style);

  // エリアマッピング（日本語 → 英語）
  const areaMap = {
    '渋谷': 'shibuya',
    '新宿': 'shinjuku',
    '表参道': 'omotesando',
    '原宿': 'harajuku',
    '恵比寿': 'ebisu',
    '代官山': 'daikanyama',
    '中目黒': 'nakameguro',
    '六本木': 'roppongi',
    '銀座': 'ginza',
    '丸の内': 'marunouchi',
    '東京': 'tokyo',
    '品川': 'shinagawa',
    '池袋': 'ikebukuro',
    '上野': 'ueno',
    '浅草': 'asakusa',
    '秋葉原': 'akihabara',
    'お台場': 'odaiba',
    '吉祥寺': 'kichijoji',
    '下北沢': 'shimokitazawa',
    '自由が丘': 'jiyugaoka'
  };

  // スタート地点がnullの場合はデフォルトで渋谷
  const area = start_location ? (areaMap[start_location] || start_location.toLowerCase()) : 'shibuya';

  // 予算マッピング
  const budgetMap = {
    'low': 'low',
    'medium': 'medium',
    'high': 'high',
    'no_limit': 'high' // 気にしない場合は高めに
  };

  // 開始時刻（デフォルトは13:00）
  const dateStartTime = start_time || '13:00';

  // 最適なデート時間を計算
  let optimal_duration = calculateOptimalDuration(date_phase, budget_level, movement_style);

  // 終了時間が指定されている場合は、それを優先して所要時間を計算
  if (end_time) {
    const parseTime = (t) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + (m || 0);
    };

    const startMin = parseTime(dateStartTime);
    const endMin = parseTime(end_time);

    // 日またぎ対応（例: 23:00開始、01:00終了など）は簡易的に考慮
    // ここでは単純に終了時刻が開始時刻より小さい場合は翌日とみなして+24時間する
    let diff = endMin - startMin;
    if (endMin < startMin) {
      diff = (endMin + 24 * 60) - startMin;
    }

    if (diff > 0) {
      // 分を時間（小数）に変換
      optimal_duration = diff / 60;
      console.log(`[Conditions] Overriding optimal_duration to ${optimal_duration.toFixed(1)}h based on end_time ${end_time}`);
    }
  }

  return {
    area,
    date_phase,
    start_time: dateStartTime,
    optimal_duration,
    date_budget_level: budgetMap[budget_level] || 'medium',
    mood: null, // ウィザードでは取得しない
    ng_conditions: [], // ウィザードでは取得しない
    custom_request: null, // ウィザードでは取得しない
    // 追加情報
    movement_style,
    movement_preferences,
    transportation_modes, // 選択された移動手段
    preferred_areas: preferred_areas.map(area => areaMap[area] || area.toLowerCase()),
    end_time: end_time || null // 終了時間をプロンプト生成用に保持
  };
}

// プラン生成API（レート制限と簡易認証付き）
// プラン生成API（レート制限と簡易認証付き）
// Vercelのルーティング挙動（パス書き換え）に対応するため、/api有り無し両方で待ち受け
// また、VercelのRewriteで直接server.jsに来た場合（パス情報が失われる場合）の対策としてデフォルトルートも追加
const handleGeneratePlan = async (req, res) => {
  try {
    let { conditions, adjustment = null } = req.body;

    // 新しいウィザード形式のデータを既存のconditions形式に変換
    if (req.body.wizard_data) {
      conditions = convertWizardDataToConditions(req.body.wizard_data);
    }

    // conditionsが存在しない場合はエラー
    if (!conditions) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: conditions or wizard_data is required'
      });
    }

    // movement_styleに応じた移動ポリシーを補完
    conditions.movement_preferences = conditions.movement_preferences || getMovementPreferences(conditions.movement_style);

    console.log('Received generate-plan request, area:', conditions.area);

    let plan;

    // Vercel Functionのタイムアウト（10秒）対策
    // Vercel Functionのタイムアウト（10秒）対策
    // 5秒経過してもAIが終わらない場合は、強制的にモックデータを返してエラー回避する
    const TIMEOUT_MS = 5000;
    const startTime = Date.now();

    const generatePromise = (async () => {
      if (openai) {
        console.log('Using OpenAI API for plan generation (model: gpt-4o-mini)...');
        const prompt = generatePrompt(conditions, adjustment);
        const message = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: "json_object" },
        });

        const responseText = message.choices[0].message.content;
        let p;
        try {
          p = JSON.parse(responseText);
        } catch (e) {
          console.error('JSON Parse Error:', e);
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          p = jsonMatch ? JSON.parse(jsonMatch[0]) : parsePlanFromText(responseText);
        }

        // AI生成プランをベースに、モック生成関数の後処理（ハイドレーション＆詳細計算）を通す
        // これにより、実在するスポットの詳細情報付与や、移動時間の計算、終了時間の補正が行われる
        console.log('[PlanGen] Passing AI plan to post-processing logic...');
        return await generateMockPlan(conditions, adjustment, true, p);
      } else {
        console.log('OpenAI API not configured, using Mock generation...');
        return await generateMockPlan(conditions, adjustment);
      }
    })();

    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        console.warn(`⚠️ Plan generation timed out after ${TIMEOUT_MS}ms. Falling back to Mock data.`);
        resolve('TIMEOUT');
      }, TIMEOUT_MS);
    });

    // 競走させる
    const result = await Promise.race([generatePromise, timeoutPromise]);

    if (result === 'TIMEOUT') {
      // タイムアウト時はモック生成に切り替え
      // 重要: ここでさらに外部APIを呼ぶと確実に10秒を超えるため、外部API呼び出しを禁止する
      console.warn('⚠️ Using internal mock data ONLY due to timeout.');
      plan = await generateMockPlan(conditions, adjustment, false);
    } else {
      plan = result;
    }

    res.json({
      success: true,
      plan: normalizePlan(plan),
      conditions: conditions
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
app.post('/api/generate-plan', simpleAuth, planGeneratorLimiter, handleGeneratePlan);
app.post('/generate-plan', simpleAuth, planGeneratorLimiter, handleGeneratePlan);
// Vercel Rewrite対策：ルートへのPOSTもプラン生成として扱う
app.post('/', simpleAuth, planGeneratorLimiter, handleGeneratePlan);


// デート段階ごとのルール定義
const datePhaseRules = {
  first: {
    label: '初デート',
    avoid: '密室（カラオケ個室、映画館）、長時間拘束（3時間以上の単一アクティビティ）、距離が近すぎる場所',
    recommend: 'オープンテラス、カフェ、公園、美術館など開放的な場所。2-3時間で完結し、途中で切り上げやすい構成',
    keywords: '明るい、開放的、カジュアル、話しやすい環境'
  },
  second: {
    label: '2〜3回目のデート',
    avoid: '高級すぎる場所（気を使わせる）',
    recommend: 'ショッピング、体験型施設、動物園・水族館など、会話が途切れても楽しめるアクティビティ',
    keywords: 'アクティブ、カジュアル、楽しい、共通の趣味探し'
  },
  casual: {
    label: '付き合っているカップル',
    avoid: 'なし（自由度高め）',
    recommend: '映画、カラオケ個室、隠れ家的な店など、2人だけの空間を楽しめる場所',
    keywords: 'リラックス、プライベート、居心地の良い、2人の世界'
  },
  anniversary: {
    label: '記念日・特別な日',
    avoid: 'カジュアルすぎる場所、チェーン店',
    recommend: '高層レストラン、夜景スポット、特別感のあるホテルラウンジ、フレンチ・イタリアン',
    keywords: 'ロマンチック、特別感、ラグジュアリー、夜景、記念撮影スポット'
  }
};

function generatePrompt(conditions, adjustment) {
  const movementPreferences = conditions.movement_preferences || getMovementPreferences(conditions.movement_style);
  const datePhaseRule = datePhaseRules[conditions.date_phase] || null;

  let prompt = `あなたはデートプラン生成の専門家です。以下の条件に基づいて、完璧なデートプランをJSON形式で生成してください。

【ユーザーの条件】
- エリア: ${conditions.area}
- デートの段階: ${datePhaseRule ? datePhaseRule.label : conditions.date_phase}
- 開始時刻: ${conditions.start_time}
- 推奨デート時間: 約${conditions.optimal_duration}時間（${datePhaseRule ? datePhaseRule.label : conditions.date_phase}、予算${conditions.date_budget_level}、移動スタイルを考慮して最適化）
- デート予算レベル: ${conditions.date_budget_level}
${conditions.mood ? `- 今日の気分: ${conditions.mood}` : ''}
${conditions.ng_conditions && conditions.ng_conditions.length > 0 ? `- NG条件: ${conditions.ng_conditions.join(', ')}` : ''}
${conditions.custom_request ? `- ユーザーの自由入力リクエスト: ${conditions.custom_request}` : ''}
`;

  if (datePhaseRule) {
    prompt += `\n【デート段階の詳細ガイドライン】\n`;
    prompt += `- 避けるべき場所・要素: ${datePhaseRule.avoid}\n`;
    prompt += `- 推奨する場所・要素: ${datePhaseRule.recommend}\n`;
    prompt += `- キーワード: ${datePhaseRule.keywords}\n`;
  }

  if (movementPreferences) {
    prompt += `- 移動方針: ${movementPreferences.label}（${movementPreferences.description}）。${movementPreferences.focus}\n`;
  }
  if (conditions.preferred_areas && conditions.preferred_areas.length > 0) {
    prompt += `- 途中で立ち寄りたいエリア: ${conditions.preferred_areas.join(', ')}（可能な範囲で経路に組み込む）\n`;
  }
  if (conditions.end_time) {
    prompt += `\n【重要】終了時刻の指定: ${conditions.end_time}頃に解散\n`;
    prompt += `- ユーザーは${conditions.end_time}までのデートを希望しています。プラン全体の終了時間が${conditions.end_time}前後になるように、スポットの数や滞在時間を十分に確保してください。\n`;
    prompt += `- 早く終わりすぎないように（1時間以上早く終わるのはNG）、カフェや散策などを挟んで時間を調整してください。\n`;
  }

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
1. 開始時刻${conditions.start_time}から約${conditions.optimal_duration}時間のプランを作成してください
2. デート段階のガイドラインを必ず遵守してください（避けるべき場所・推奨する場所・キーワードを反映）
3. 予算レベルを超えないようにしてください
4. 指定されたエリア周辺で現実的な移動範囲内にしてください
5. スケジュールは開始時刻と推奨時間を踏まえて自然な流れで構成してください
6. NG条件を避けたスポットを選んでください
7. ユーザーの自由入力（行きたい場所・時間帯・やりたいこと）があれば、必ずスケジュールに組み込み、その意図が伝わるようにしてください
8. 終了時刻が${conditions.end_time}と指定されている場合、必ずその時刻まで続くようにスポット数や滞在時間を調整してください（早すぎる解散はNG）`;

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

async function generateMockPlan(conditions, adjustment, allowExternalApi = true, preGeneratedPlan = null) {
  // デモ用モック版プラン生成（スポットDB + Google Places API統合版）
  const generationStartTime = Date.now();

  // 調整内容を反映
  let phase = conditions.date_phase;
  let budget = conditions.date_budget_level;
  let area = conditions.area;
  const dateStartTime = conditions.start_time || '13:00';
  const optimalDuration = conditions.optimal_duration || 3.5;
  const customRequest = (conditions.custom_request || '').trim();
  const mood = conditions.mood || null;
  const ngConditions = conditions.ng_conditions || [];
  const movementPref = conditions.movement_preferences || getMovementPreferences(conditions.movement_style);

  // 開始時刻と推奨時間から動的にスケジュール時刻を計算（外部API無しでも使う）
  function calculateScheduleTimes(startTime, durationHours) {
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMinute;

    const addMinutes = (minutes) => {
      const totalMinutes = startMinutes + minutes;
      const hour = Math.floor(totalMinutes / 60) % 24;
      const minute = totalMinutes % 60;
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    };

    const totalMinutes = durationHours * 60;

    return {
      start: startTime,
      lunch: addMinutes(0),
      activity: addMinutes(Math.floor(totalMinutes * 0.3)),
      cafe: addMinutes(Math.floor(totalMinutes * 0.6)),
      dinner: addMinutes(Math.floor(totalMinutes * 0.8))
    };
  }

  const selectedTimes = calculateScheduleTimes(dateStartTime, optimalDuration);
  const timeOrDefault = (key, fallback) => selectedTimes[key] || fallback;

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
    ueno: { lat: 35.7138, lng: 139.7770 },
    shibuya: { lat: 35.6595, lng: 139.7004 },
    shinjuku: { lat: 35.6895, lng: 139.6917 },
    ginza: { lat: 35.6719, lng: 139.7645 },
    harajuku: { lat: 35.6704, lng: 139.7028 },
    odaiba: { lat: 35.6270, lng: 139.7769 },
    asakusa: { lat: 35.7148, lng: 139.7967 },
    ikebukuro: { lat: 35.7296, lng: 139.7160 },
  };
  const areaDistance = (lat1, lon1, lat2, lon2) => {
    const toRad = (deg) => deg * Math.PI / 180;
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // デートエリア表記
  // areaがareaNameMapに存在しない場合、areaの値をそのまま使用（太田駅など新しいエリアに対応）
  let areaJapanese = areaNameMap[area] || area;

  // エリアの中心座標を取得（Geocoding APIを使用）
  let areaCenter;
  if (areaCenters[area]) {
    // キャッシュに存在する場合はそれを使用
    areaCenter = areaCenters[area];
    console.log(`📍 Area center from cache for "${area}":`, areaCenter);
  } else {
    // 存在しない場合はGeocodingで取得
    areaCenter = await getCoordinatesForLocation(areaJapanese);
    console.log(`📍 Area center from geocoding for "${areaJapanese}":`, areaCenter);
  }

  // ===== 優先1: スポットデータベースから検索 =====
  // 必要な時だけロード（遅延ロード）
  if (!spotDB.loaded) {
    console.log('[SpotDB] Loading database on-demand...');
    spotDB.load();
  }

  const spotDBInstance = spotDB;
  let lunchPlace, activityPlace, cafePlace, dinnerPlace;

  // データベースが対応しているエリアかチェック
  const dbSupportedAreas = spotDBInstance.loaded ? Object.keys(spotDBInstance.getStats().byArea) : [];
  const isAreaSupportedByDB = dbSupportedAreas.includes(area);

  if (spotDBInstance.loaded && spotDBInstance.spots.length > 0 && isAreaSupportedByDB) {
    console.log(`[SpotDB] Using spot database (${spotDBInstance.spots.length} spots available)`);

    try {
      // ランチ: レストランカテゴリから検索
      const lunchSpot = spotDBInstance.getRandomSpot({
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
  } else if (!isAreaSupportedByDB) {
    console.log(`[SpotDB] Area '${area}' not in database (supported: ${dbSupportedAreas.join(', ')}). Using Places API.`);
  }

  // ===== 優先2: Google Places APIでフォールバック（DBで見つからなかったもののみ） =====

  if (allowExternalApi && hasPlacesAPI && (!lunchPlace || !activityPlace || !cafePlace || !dinnerPlace)) {
    if (!lunchPlace && !activityPlace && !cafePlace && !dinnerPlace) {
      console.log('[Places API] Using Places API as primary source for this area...');
    } else {
      console.log('[Places API] Fetching missing spots from Places API...');
    }

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

    // 2フェーズ検索: 最初のスポットの座標を使って残りのスポットを同じエリアから検索
    try {
      // 既に選択されたスポットのIDを追跡（重複を避けるため）
      const usedPlaceIds = [];

      // Places API検索用のオプションを作成（ユーザー条件を含む）
      const searchOptions = {
        budget,
        datePhase: phase,
        excludePlaceIds: usedPlaceIds
      };

      // === Phase 1: lunch と activity を検索（営業時間を考慮） ===
      const phase1Searches = [];
      const phase1Types = [];
      const phase1Times = [];

      if (!lunchPlace) {
        const lunchTime = selectedTimes.lunch;
        phase1Searches.push(searchPlaceWithOpeningHours(lunchKeyword, areaJapanese, lunchTime, {
          category: 'restaurant',
          ...searchOptions
        }));
        phase1Types.push('lunch');
        phase1Times.push(lunchTime);
      }
      if (!activityPlace) {
        const activityTime = selectedTimes.activity;
        phase1Searches.push(searchPlaceWithOpeningHours(activityKeyword, areaJapanese, activityTime, {
          ...searchOptions
        }));
        phase1Types.push('activity');
        phase1Times.push(activityTime);
      }

      if (phase1Searches.length > 0) {
        console.log(`🔍 Phase 1: Searching for ${phase1Types.map((t, i) => `${t} (${phase1Times[i]})`).join(', ')} near ${areaJapanese}`);
        const phase1Results = await Promise.all(phase1Searches);

        // 結果を変数に代入し、最初に見つかった座標をキャッシュに保存
        let firstCoords = null;
        phase1Results.forEach((result, index) => {
          const type = phase1Types[index];
          if (result) {
            const categoryMap = {
              lunch: 'restaurant',
              activity: 'tourist_attraction'
            };

            const enhancedResult = {
              ...result,
              place_name: result.name || result.place_name,
              category: categoryMap[type] || 'restaurant'
            };

            if (type === 'lunch') lunchPlace = enhancedResult;
            else if (type === 'activity') activityPlace = enhancedResult;

            console.log(`[Places API] ✅ ${type} fetched: ${enhancedResult.name} at (${result.lat}, ${result.lng})`);

            // 使用済みスポットIDを記録（重複を避けるため）
            if (result.place_id) {
              usedPlaceIds.push(result.place_id);
              console.log(`[Duplicate Check] Added ${result.place_id} to exclusion list`);
            }

            // 最初に見つかった座標を記録
            if (!firstCoords && result.lat && result.lng) {
              firstCoords = { lat: result.lat, lng: result.lng };
              console.log(`📍 Phase 1 first result coordinates: (${firstCoords.lat}, ${firstCoords.lng})`);
            }
          }
        });

        // キャッシュを更新して Phase 2 の検索で使用
        if (firstCoords) {
          console.log(`📍 Updating areaCenter for "${areaJapanese}" with Phase 1 coordinates: (${firstCoords.lat}, ${firstCoords.lng})`);
          // Phase 2 の検索で使用するため、areaCenter を更新
          areaCenter = firstCoords;
        }
      }

      // === Phase 2: cafe と dinner を Phase 1 の座標付近で検索（営業時間を考慮） ===
      const phase2Searches = [];
      const phase2Types = [];
      const phase2Times = [];

      // Phase 2用に最新の除外リストを含むオプションを作成
      console.log(`[Duplicate Check] Before Phase 2, usedPlaceIds: ${usedPlaceIds.length} items - ${usedPlaceIds.join(', ')}`);

      if (!cafePlace) {
        const cafeTime = selectedTimes.cafe;
        phase2Searches.push(searchPlaceWithOpeningHours(cafeKeyword, areaJapanese, cafeTime, {
          category: 'cafe',
          budget,
          datePhase: phase,
          excludePlaceIds: usedPlaceIds,  // 最新の除外リストを明示的に渡す
          coords: areaCenter  // Phase 1 の座標を使用
        }));
        phase2Types.push('cafe');
        phase2Times.push(cafeTime);
      }
      if (!dinnerPlace) {
        const dinnerTime = selectedTimes.dinner;
        phase2Searches.push(searchPlaceWithOpeningHours(dinnerKeyword, areaJapanese, dinnerTime, {
          category: 'restaurant',
          budget,
          datePhase: phase,
          excludePlaceIds: usedPlaceIds,  // 最新の除外リストを明示的に渡す
          coords: areaCenter  // Phase 1 の座標を使用
        }));
        phase2Types.push('dinner');
        phase2Times.push(dinnerTime);
      }

      if (phase2Searches.length > 0) {
        console.log(`🔍 Phase 2: Searching for ${phase2Types.map((t, i) => `${t} (${phase2Times[i]})`).join(', ')} near updated coordinates (${areaCenter.lat}, ${areaCenter.lng})`);
        const phase2Results = await Promise.all(phase2Searches);

        phase2Results.forEach((result, index) => {
          const type = phase2Types[index];
          if (result) {
            const categoryMap = {
              cafe: 'cafe',
              dinner: 'restaurant'
            };

            const enhancedResult = {
              ...result,
              place_name: result.name || result.place_name,
              category: categoryMap[type] || 'restaurant'
            };

            if (type === 'cafe') cafePlace = enhancedResult;
            else if (type === 'dinner') dinnerPlace = enhancedResult;

            console.log(`[Places API] ✅ ${type} fetched: ${enhancedResult.name} at (${result.lat}, ${result.lng})`);

            // 使用済みスポットIDを記録（重複を避けるため）
            if (result.place_id) {
              usedPlaceIds.push(result.place_id);
              console.log(`[Duplicate Check] Added ${result.place_id} to exclusion list`);
            }
          }
        });
      }

      console.log(`[Duplicate Check] Total used place IDs: ${usedPlaceIds.length}`);
      if (usedPlaceIds.length > 0) {
        console.log(`[Duplicate Check] Excluded places: ${usedPlaceIds.join(', ')}`);
      }

    } catch (err) {
      console.error('[Places API] Search failed:', err);
    }
  }

  // Geocoding APIが失敗した場合、取得したスポットの座標からエリア中心を推測
  console.log(`🔍 Checking if area center needs recalculation. Current: (${areaCenter.lat}, ${areaCenter.lng})`);
  console.log(`🔍 Available spots: lunch=${!!lunchPlace}, activity=${!!activityPlace}, cafe=${!!cafePlace}, dinner=${!!dinnerPlace}`);
  if (lunchPlace) console.log(`  lunch coords: (${lunchPlace.lat}, ${lunchPlace.lng})`);
  if (activityPlace) console.log(`  activity coords: (${activityPlace.lat}, ${activityPlace.lng})`);
  if (cafePlace) console.log(`  cafe coords: (${cafePlace.lat}, ${cafePlace.lng})`);
  if (dinnerPlace) console.log(`  dinner coords: (${dinnerPlace.lat}, ${dinnerPlace.lng})`);

  if (areaCenter.lat === 35.6812 && areaCenter.lng === 139.7671) {
    // デフォルト東京座標のままの場合、Places APIで取得したスポットから計算
    const spotsWithCoords = [lunchPlace, activityPlace, cafePlace, dinnerPlace].filter(s => s && s.lat && s.lng);
    console.log(`🔍 Spots with coords: ${spotsWithCoords.length}`);
    if (spotsWithCoords.length > 0) {
      const avgLat = spotsWithCoords.reduce((sum, s) => sum + s.lat, 0) / spotsWithCoords.length;
      const avgLng = spotsWithCoords.reduce((sum, s) => sum + s.lng, 0) / spotsWithCoords.length;
      areaCenter = { lat: avgLat, lng: avgLng };
      console.log(`📍 Area center calculated from ${spotsWithCoords.length} spots: (${avgLat}, ${avgLng})`);
    } else {
      console.log(`⚠️ No spots with coordinates found, keeping default Tokyo coordinates`);
    }
  } else {
    console.log(`✅ Area center already set, no recalculation needed`);
  }

  // フォールバック用のモックスポット
  const spotsByArea = {
    shibuya: {
      lunch: { name: '渋谷モディ', lat: 35.6604, lng: 139.7017, address: '東京都渋谷区神南1-21-3' },
      activity: { name: '渋谷センター街', lat: 35.6597, lng: 139.7006 },
      dinner: { name: '渋谷スクランブルスクエア', lat: 35.6591, lng: 139.7006, address: '東京都渋谷区渋谷2-24-12' }
    },
    shinjuku: {
      lunch: { name: '新宿ミロード', lat: 35.6894, lng: 139.7023, address: '東京都新宿区西新宿1-1-3' },
      activity: { name: '新宿御苑周辺', lat: 35.6852, lng: 139.7101 },
      dinner: { name: '新宿ルミネ口エリア', lat: 35.6895, lng: 139.7004, address: '東京都新宿区新宿3-38-2' }
    },
    ginza: {
      lunch: { name: 'GINZA SIX', lat: 35.6702, lng: 139.7636, address: '東京都中央区銀座6-10-1' },
      activity: { name: '銀座通り散策', lat: 35.6717, lng: 139.7650 },
      dinner: { name: '銀座コースレストラン', lat: 35.6705, lng: 139.7640, address: '東京都中央区銀座4-1' }
    },
    harajuku: {
      lunch: { name: '表参道カフェ', lat: 35.6654, lng: 139.7120, address: '東京都渋谷区神宮前4-12-10' },
      activity: { name: '竹下通り散策', lat: 35.6702, lng: 139.7020 },
      dinner: { name: '原宿イタリアン', lat: 35.6700, lng: 139.7034, address: '東京都渋谷区神宮前1-8-8' }
    },
    odaiba: {
      lunch: { name: 'お台場ヴィーナスフォート', lat: 35.6251, lng: 139.7754, address: '東京都江東区青海1-3-15' },
      activity: { name: 'お台場海浜公園', lat: 35.6298, lng: 139.7766 },
      dinner: { name: 'お台場デックス', lat: 35.6272, lng: 139.7757, address: '東京都港区台場1-6-1' }
    },
    ueno: {
      lunch: { name: '上野の森さくらテラス', lat: 35.7156, lng: 139.7745, address: '東京都台東区上野公園1-54' },
      activity: { name: '国立西洋美術館', lat: 35.7188, lng: 139.7769 },
      dinner: { name: 'アメ横の居酒屋', lat: 35.7138, lng: 139.7755, address: '東京都台東区上野4-7-8' }
    },
    asakusa: {
      lunch: { name: '浅草雷門周辺', lat: 35.7148, lng: 139.7967, address: '東京都台東区浅草2-3-1' },
      activity: { name: '浅草寺散策', lat: 35.7140, lng: 139.7967 },
      dinner: { name: '仲見世通りグルメ', lat: 35.7146, lng: 139.7967, address: '東京都台東区浅草1-18-1' }
    },
    ikebukuro: {
      lunch: { name: '池袋サンシャイン', lat: 35.7296, lng: 139.7193, address: '東京都豊島区東池袋3-1-1' },
      activity: { name: 'サンシャイン水族館', lat: 35.7289, lng: 139.7188 },
      dinner: { name: '池袋グルメ街', lat: 35.7310, lng: 139.7101, address: '東京都豊島区西池袋1-1-25' }
    },
  };

  // フォールバック用スポット（選択したエリアの座標を使用）
  const createGenericSpots = (areaName, center) => ({
    lunch: {
      name: `${areaName} レストラン`,
      lat: center.lat,
      lng: center.lng,
      address: areaName
    },
    activity: {
      name: `${areaName}散策`,
      lat: center.lat + 0.001,
      lng: center.lng + 0.001
    },
    dinner: {
      name: `${areaName} ディナー`,
      lat: center.lat + 0.002,
      lng: center.lng - 0.001,
      address: areaName
    }
  });

  const spots = spotsByArea[area] || createGenericSpots(areaJapanese, areaCenter);

  // LLMを使って動的に検索クエリを生成する関数
  async function generateSearchQueries(time, location, options = {}) {
    console.log(`🤖 [LLM Query Generation] Generating queries for ${location} at ${time}`);

    const [hour] = time.split(':').map(Number);

    // ユーザー条件を整理
    const budgetLabels = {
      'low': 'カジュアル・リーズナブル（1000-2000円程度）',
      'medium': '中価格帯（2000-4000円程度）',
      'high': '高級・上質（4000円以上）',
      'no_limit': '予算制限なし・有名店'
    };

    const phaseLabels = {
      'first': '初デート（落ち着いた雰囲気、個室あり、静か）',
      'second': '2回目以降のデート（おしゃれ、会話しやすい）',
      'casual': 'カジュアルデート（人気店、話題の店）',
      'anniversary': '記念日・特別な日（高級、特別感、記念日対応）'
    };

    const categoryLabels = {
      'cafe': 'カフェ',
      'restaurant': 'レストラン',
      'bar': 'バー・居酒屋'
    };

    const budget = budgetLabels[options.budget] || budgetLabels['medium'];
    const phase = phaseLabels[options.datePhase] || phaseLabels['casual'];
    const category = categoryLabels[options.category] || 'カフェやレストラン';

    const prompt = `あなたはデートスポット検索の専門家です。以下の条件で、Google Places APIで検索する最適な日本語クエリを5つ生成してください。

【条件】
- 時刻: ${time}（${hour}時台）
- エリア: ${location}
- 予算: ${budget}
- デートのタイプ: ${phase}
- カテゴリ: ${category}

【重要な要件】
1. その時間に営業している可能性が高い店を見つけられるクエリ
2. 予算感とデートのタイプに合った雰囲気のクエリ
3. 必ずエリア名「${location}」を含める
4. 1つのクエリは3-6単語程度
5. 多様なアプローチで検索できるよう、5つのクエリは異なる角度から攻める

【出力形式】
クエリのみを1行ずつ、5行で出力してください。説明や番号は不要です。

例:
池袋 早朝営業 カフェ おしゃれ
池袋 モーニング ベーカリーカフェ
池袋 朝カフェ 個室あり
池袋 ブレックファスト 静か
池袋 コーヒーショップ デート`;

    try {
      if (!openai) {
        console.warn('⚠️ OpenAI not configured, using fallback queries');
        return generateFallbackQueries(time, location, options);
      }

      // タイムアウト設定（2秒）
      const llmPromise = openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 150
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('LLM timeout')), 2000);
      });

      const response = await Promise.race([llmPromise, timeoutPromise]);

      const content = response.choices[0].message.content.trim();
      const queries = content.split('\n').filter(q => q.trim().length > 0).map(q => q.trim());

      console.log(`✅ [LLM] Generated ${queries.length} queries:`);
      queries.forEach((q, i) => console.log(`   ${i + 1}. ${q}`));

      return queries.length > 0 ? queries : generateFallbackQueries(time, location, options);
    } catch (error) {
      console.error('❌ [LLM] Query generation failed:', error.message);
      return generateFallbackQueries(time, location, options);
    }
  }

  // LLMが使えない場合のフォールバッククエリ生成
  function generateFallbackQueries(time, location, options = {}) {
    console.log(`🔄 [Fallback] Generating fallback queries`);

    const [hour] = time.split(':').map(Number);
    const queries = [];

    // 基本的な時間帯キーワード
    let timeKeywords = [];
    if (hour >= 6 && hour < 11) {
      timeKeywords = ['モーニング', '朝食', 'カフェ', 'ブレックファスト', '早朝営業'];
    } else if (hour >= 11 && hour < 15) {
      timeKeywords = ['ランチ', 'カフェ', 'レストラン', '定食'];
    } else if (hour >= 15 && hour < 17) {
      timeKeywords = ['カフェ', 'ティータイム', 'スイーツ'];
    } else if (hour >= 17 && hour < 22) {
      timeKeywords = ['ディナー', 'レストラン', '居酒屋'];
    } else {
      timeKeywords = ['24時間', '深夜営業', 'バー'];
    }

    // 予算キーワード
    const budgetKeywords = {
      'low': ['カジュアル', 'リーズナブル'],
      'medium': ['人気', 'おすすめ'],
      'high': ['高級', '上質'],
      'no_limit': ['有名', '人気']
    };
    const budgetWords = budgetKeywords[options.budget] || budgetKeywords['medium'];

    // デートフェーズキーワード
    const phaseKeywords = {
      'first': ['個室', '落ち着いた'],
      'second': ['おしゃれ', '雰囲気'],
      'casual': ['話題', 'デート'],
      'anniversary': ['記念日', '特別']
    };
    const phaseWords = phaseKeywords[options.datePhase] || phaseKeywords['casual'];

    // クエリを生成（多様な組み合わせ）
    queries.push(`${location} ${timeKeywords[0]} ${budgetWords[0]}`);
    queries.push(`${location} ${timeKeywords[1] || timeKeywords[0]} ${phaseWords[0]}`);
    queries.push(`${location} ${timeKeywords[2] || timeKeywords[0]}`);
    queries.push(`${location} ${timeKeywords[0]} ${phaseWords[1] || phaseWords[0]}`);
    queries.push(`${location} ${budgetWords[1] || budgetWords[0]} ${timeKeywords[1] || timeKeywords[0]}`);

    return queries;
  }

  // 営業時間を考慮してスポットを検索する関数（LLMベース）
  async function searchPlaceWithOpeningHours(query, location, time, options = {}, maxRetries = 10) {
    console.log(`🔍 [Search with Hours] Searching for "${query}" at ${time}`);
    console.log(`   User conditions: budget=${options.budget}, phase=${options.datePhase}, category=${options.category}`);

    // LLMで動的にクエリを生成
    const generatedQueries = await generateSearchQueries(time, location, options);

    // 元のクエリも含める（最初に試す）
    const allQueries = [query, ...generatedQueries];

    // 最大リトライ回数を調整（生成されたクエリ数に応じて）
    const effectiveRetries = Math.min(maxRetries, allQueries.length * 2);

    for (let retry = 0; retry < effectiveRetries; retry++) {
      const searchQuery = allQueries[retry % allQueries.length];
      console.log(`   Try ${retry + 1}/${effectiveRetries}: "${searchQuery}"`);

      try {
        const spot = await searchPlaces(searchQuery, location, { ...options, random: true });
        if (!spot || !spot.place_id) {
          console.log(`   No spot found`);
          continue;
        }

        // 営業時間をチェック
        const details = await getPlaceDetails(spot.place_id);
        if (!details || !details.opening_hours || details.opening_hours.length === 0) {
          console.log(`   ${spot.name}: No opening hours info, using it`);
          return { ...spot, opening_hours: [], is_open: true };
        }

        const isOpen = isOpenAtTime(details.opening_hours, time);
        console.log(`   ${spot.name}: ${isOpen ? '✅ Open' : '❌ Closed'}`);

        if (isOpen) {
          return { ...spot, opening_hours: details.opening_hours, is_open: true };
        }
      } catch (err) {
        console.error(`   Search error:`, err.message);
      }
    }

    console.warn(`⚠️ [Search with Hours] No open spot found after ${effectiveRetries} tries`);
    return null;
  }

  // 営業時間をチェックする関数
  function isOpenAtTime(openingHours, scheduledTime) {
    if (!openingHours || openingHours.length === 0) {
      // 営業時間情報がない場合は営業していると仮定
      return true;
    }

    // scheduledTimeを"HH:MM"形式から分に変換
    const [hour, minute] = scheduledTime.split(':').map(Number);
    const scheduledMinutes = hour * 60 + minute;

    // 現在の曜日を取得（0=日曜, 1=月曜, ..., 6=土曜）
    const today = new Date();
    const dayOfWeek = today.getDay();

    // Google Places APIの営業時間フォーマット: "月曜日: 17:00～23:00"
    const dayNames = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
    const targetDay = dayNames[dayOfWeek];

    // 該当曜日の営業時間を探す
    const todayHours = openingHours.find(h => h.startsWith(targetDay));
    console.log(`   Target day: ${targetDay}, Today's hours: ${todayHours}`);
    if (!todayHours) {
      console.log(`   No hours found for ${targetDay}, assuming open`);
      return true; // 該当曜日の情報がない場合は営業していると仮定
    }

    // "定休日"チェック
    if (todayHours.includes('定休日') || todayHours.includes('休業')) {
      console.log(`   Closed today (定休日)`);
      return false;
    }

    // "24 時間営業"チェック
    if (todayHours.includes('24 時間営業') || todayHours.includes('24時間営業')) {
      console.log(`   Open 24 hours`);
      return true;
    }

    // 営業時間をパース
    // 対応フォーマット:
    // - "月曜日: 17:00～23:00" (コロン形式)
    // - "月曜日: 17時00分～23時00分" (時分形式)
    // - "月曜日: 11時00分～14時00分, 17時00分～22時00分" (複数時間帯)

    // 曜日部分を除去
    const hoursOnly = todayHours.replace(/^[^:]+:\s*/, '');

    // 複数の時間帯をパース（カンマ区切り）
    const timeRanges = hoursOnly.split(',').map(s => s.trim());

    // 各時間帯をチェック（どれか1つでも営業していればOK）
    for (const range of timeRanges) {
      // コロン形式: "17:00～23:00" または 時分形式: "17時00分～23時00分"
      const timeMatch = range.match(/(\d{1,2})[:時](\d{2})(?:分)?[~～〜](\d{1,2})[:時](\d{2})(?:分)?/);

      if (!timeMatch) {
        console.log(`   Could not parse time range: ${range}`);
        continue;
      }

      const openHour = parseInt(timeMatch[1]);
      const openMinute = parseInt(timeMatch[2]);
      const closeHour = parseInt(timeMatch[3]);
      const closeMinute = parseInt(timeMatch[4]);

      const openMinutes = openHour * 60 + openMinute;
      const closeMinutes = closeHour * 60 + closeMinute;

      console.log(`   Checking range: ${openHour}:${String(openMinute).padStart(2, '0')} (${openMinutes} min) ～ ${closeHour}:${String(closeMinute).padStart(2, '0')} (${closeMinutes} min)`);
      console.log(`   Scheduled: ${scheduledTime} (${scheduledMinutes} min)`);

      // 営業時間内かチェック
      // 深夜営業の場合（例: 18:00～2:00）は closeMinutes < openMinutes
      let isInRange = false;
      if (closeMinutes < openMinutes) {
        // 深夜営業: 開店時間以降 OR 閉店時間以前
        isInRange = scheduledMinutes >= openMinutes || scheduledMinutes <= closeMinutes;
        console.log(`   Late-night hours, in range: ${isInRange}`);
      } else {
        // 通常営業: 開店時間以降 AND 閉店時間以前
        isInRange = scheduledMinutes >= openMinutes && scheduledMinutes <= closeMinutes;
        console.log(`   Regular hours, in range: ${isInRange}`);
      }

      if (isInRange) {
        console.log(`   ✅ Open in this time range`);
        return true;
      }
    }

    console.log(`   ❌ Not open in any time range`);
    return false;
  }

  // 営業している代替店舗を検索する関数
  async function findOpenAlternative(item, areaName, maxRetries = 5) {
    console.log(`🔍 [Opening Hours] Searching for alternative to ${item.place_name} that is open at ${item.time}`);

    // 時刻を分に変換
    const [hour] = item.time.split(':').map(Number);

    // 時間帯に応じたキーワードを生成
    let timeBasedKeywords = [];
    if (hour >= 6 && hour < 11) {
      // 朝の時間帯: モーニング、朝食
      timeBasedKeywords = ['モーニング', '朝食', 'ブレックファスト', 'カフェ'];
    } else if (hour >= 11 && hour < 15) {
      // ランチタイム
      timeBasedKeywords = ['ランチ', '定食', 'カフェ'];
    } else if (hour >= 17 && hour < 22) {
      // ディナータイム
      timeBasedKeywords = ['ディナー', '居酒屋', 'レストラン'];
    } else if (hour >= 22 || hour < 6) {
      // 深夜・早朝
      timeBasedKeywords = ['24時間', '深夜営業', 'バー'];
    } else {
      // その他の時間
      timeBasedKeywords = ['カフェ', 'レストラン'];
    }

    // カテゴリに基づいて検索クエリを生成
    const categoryKeywords = {
      'restaurant': timeBasedKeywords,
      'cafe': ['カフェ', 'コーヒー', 'ベーカリー', '喫茶店'],
      'museum': ['博物館', '美術館', 'ミュージアム'],
      'tourist_attraction': ['観光', 'スポット']
    };

    const keywords = categoryKeywords[item.category] || timeBasedKeywords;

    for (let retry = 0; retry < maxRetries; retry++) {
      const keyword = keywords[retry % keywords.length];
      const searchQuery = `${keyword} ${areaName}`;

      try {
        const alternative = await searchPlaces(searchQuery, areaName, {
          category: item.category,
          budget: budget,
          datePhase: phase,
          random: true // ランダムに選択
        });

        if (!alternative) continue;

        // 営業時間をチェック
        if (alternative.place_id) {
          const details = await getPlaceDetails(alternative.place_id);
          if (details && details.opening_hours) {
            const isOpen = isOpenAtTime(details.opening_hours, item.time);
            if (isOpen) {
              console.log(`✅ [Opening Hours] Found open alternative: ${alternative.name}`);
              return {
                ...alternative,
                opening_hours: details.opening_hours,
                is_open: true
              };
            } else {
              console.log(`⚠️ [Opening Hours] Alternative ${alternative.name} is also closed, retrying...`);
            }
          } else {
            // 営業時間情報がない場合は採用
            console.log(`ℹ️ [Opening Hours] Alternative ${alternative.name} has no opening hours info, using it`);
            return alternative;
          }
        }
      } catch (err) {
        console.error(`❌ [Opening Hours] Error searching alternative:`, err.message);
      }
    }

    console.warn(`⚠️ [Opening Hours] Could not find open alternative for ${item.place_name}, keeping original`);
    return null;
  }

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

  async function hydrateScheduleWithPlaces(baseSchedule, areaName, startTime) {
    if (!hasPlacesAPI) return baseSchedule;

    // もし残り時間が少なければ（7.5秒経過していたら）ハイドレーションをスキップ
    if (startTime && (Date.now() - startTime) > 7500) {
      console.warn(`[Hydrate] Skipping hydration due to timeout risk (elapsed: ${Date.now() - startTime}ms)`);
      return baseSchedule;
    }

    console.log(`[Hydrate] Starting parallel hydration for ${baseSchedule.length} items...`);

    const enrichPromises = baseSchedule.map(async (item) => {
      if (item.is_travel || item.is_meeting || item.is_farewell || item.type === 'walk') {
        return item;
      }

      let placeId = item.place_id || null;
      let details = null;
      let searchPhotos = [];

      try {
        if (!placeId && item.place_name) {
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
        console.error(`[Places] hydrate error for ${item.place_name}:`, err.message);
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

        // 営業時間チェック
        const openingHours = details.opening_hours || [];
        console.log(`🕒 [Opening Hours] Checking ${item.place_name} at ${item.time}`);
        console.log(`   Opening hours data:`, openingHours);
        const isOpen = isOpenAtTime(openingHours, item.time);
        console.log(`   Is open: ${isOpen}`);

        // 営業していない場合は代替を検索
        if (!isOpen && openingHours.length > 0) {
          console.warn(`⚠️ [Opening Hours] ${item.place_name} is closed at ${item.time}`);
          console.warn(`   Opening hours:`, openingHours);

          // 代替店舗を検索
          const alternative = await findOpenAlternative(item, areaName);
          if (alternative) {
            // 代替店舗が見つかった場合は置き換え
            const altDetails = alternative.opening_hours ? null : await getPlaceDetails(alternative.place_id);
            const altPhotos = altDetails?.photos || alternative.photos || [];
            const altPhotoUrls = altPhotos.map(buildPhotoUrl).filter(Boolean).slice(0, 3);
            const altReviews = altDetails?.reviews ? mapReviews(altDetails.reviews, alternative.name).slice(0, 3) : [];

            console.log(`✅ [Opening Hours] Replaced ${item.place_name} with ${alternative.name}`);

            return {
              ...item,
              place_name: alternative.name,
              place_id: alternative.place_id || null,
              lat: alternative.lat || item.lat,
              lng: alternative.lng || item.lng,
              address: alternative.address || altDetails?.address || item.address,
              rating: alternative.rating || altDetails?.rating || item.rating,
              official_url: alternative.website || altDetails?.website || item.official_url,
              photos: altPhotoUrls.length ? altPhotoUrls : item.photos,
              reviews: altReviews.length ? altReviews : item.reviews,
              opening_hours: alternative.opening_hours || altDetails?.opening_hours || [],
              is_open: true,
            };
          } else {
            // 代替が見つからなかった場合は警告フラグを追加
            console.warn(`⚠️ [Opening Hours] No alternative found for ${item.place_name}, keeping original with warning`);
            return {
              ...item,
              place_id: placeId || item.place_id || null,
              photos: photoUrls.length ? photoUrls : item.photos,
              reviews: reviews.length ? reviews : item.reviews,
              rating: details.rating || item.rating,
              official_url: details.website || item.official_url,
              address: details.address || item.address,
              opening_hours: openingHours,
              is_open: false,
              closed_warning: `この店舗は${item.time}には営業していない可能性があります。事前に営業時間をご確認ください。`,
            };
          }
        }

        // 駐車場情報を整形
        let parkingInfo = null;
        if (details.parking && details.parking.available) {
          const types = [];
          if (details.parking.free_parking_lot) types.push('無料駐車場');
          if (details.parking.paid_parking_lot) types.push('有料駐車場');
          if (details.parking.paid_street_parking) types.push('路上駐車');
          if (details.parking.valet_parking) types.push('バレーパーキング');

          parkingInfo = {
            available: true,
            types: types,
            text: types.length > 0 ? types.join('、') + 'あり' : '駐車場あり'
          };
        }

        return {
          ...item,
          place_id: placeId || item.place_id || null,
          photos: photoUrls.length ? photoUrls : item.photos,
          reviews: reviews.length ? reviews : item.reviews,
          rating: details.rating || item.rating,
          official_url: details.website || item.official_url,
          parking: parkingInfo,
          address: details.address || item.address,
          opening_hours: openingHours,
          is_open: isOpen,
        };
      } else {
        let fallbackPhotos = [];
        if (searchPhotos && searchPhotos.length > 0) {
          fallbackPhotos = searchPhotos.map(buildPhotoUrl).filter(Boolean).slice(0, 3);
        }
        return {
          ...item,
          photos: fallbackPhotos.length ? fallbackPhotos : item.photos,
        };
      }
    });

    const enriched = await Promise.all(enrichPromises);
    console.log(`[Hydrate] Parallel hydration complete.`);
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

  if (preGeneratedPlan && preGeneratedPlan.schedule) {
    schedule = preGeneratedPlan.schedule;
    console.log('[MockGen] Using pre-generated schedule from AI (skipping internal spot selection)');
  } else if (phase === 'first') {
    // 初デート：落ち着いて会話しやすい
    const lunch = lunchPlace || spots.lunch;
    const activity = activityPlace || spots.activity || { name: `${areaJapanese}散策`, lat: areaCenter.lat, lng: areaCenter.lng };
    const cafe = cafePlace || (spotsByArea[area] && spotsByArea[area].cafe) || {
      name: `${areaJapanese}カフェ`,
      lat: areaCenter.lat + 0.0015,
      lng: areaCenter.lng + 0.0015,
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(areaJapanese + 'カフェ')}`,
      place_id: null
    };
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
        category: lunch.category || 'restaurant',
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
        category: activity.category || 'museum',
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
        category: cafe.category || 'cafe',
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
        category: dinner.category || 'restaurant',
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
    const activity = activityPlace || spots.activity || { name: `${areaJapanese}散策`, lat: areaCenter.lat, lng: areaCenter.lng };
    const cafe = cafePlace || (spotsByArea[area] && spotsByArea[area].cafe) || {
      name: `${areaJapanese}カフェ`,
      lat: areaCenter.lat + 0.0015,
      lng: areaCenter.lng + 0.0015,
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(areaJapanese + 'カフェ')}`,
      place_id: null
    };

    const lunchRT = generateReasonAndTags('lunch', lunch.name);
    const activityRT = generateReasonAndTags('activity', activity.name);
    const cafeRT = generateReasonAndTags('cafe', cafe.name);

    schedule = [
      {
        time: '10:00',
        type: 'activity',
        category: activity.category || 'museum',
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
        category: lunch.category || 'restaurant',
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
        category: 'walk',
        place_name: areaJapanese + ' 街歩き',
        lat: areaCenter.lat,
        lng: areaCenter.lng,
        area: area,
        price_range: '0',
        duration: '60min',
        reason: activityRT.reason,
        reason_tags: activityRT.reason_tags,
        photos: [], // 街歩きには画像を表示しない
        reviews: [], // 街歩きにはレビューを表示しない
      },
      {
        time: timeOrDefault('cafe', '16:30'),
        type: 'cafe',
        category: cafe.category || 'cafe',
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
    const activity = activityPlace || spots.activity || { name: `${areaJapanese}散策`, lat: areaCenter.lat, lng: areaCenter.lng };
    const dinner = dinnerPlace || spots.dinner;

    const lunchRT = generateReasonAndTags('lunch', lunch.name);
    const activityRT = generateReasonAndTags('activity', activity.name);
    const dinnerRT = generateReasonAndTags('dinner', dinner.name);

    schedule = [
      {
        time: timeOrDefault('lunch', '11:30'),
        type: 'lunch',
        category: lunch.category || 'restaurant',
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
        category: activity.category || 'museum',
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
        category: dinner.category || 'restaurant',
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
    const activity = activityPlace || spots.activity || { name: `${areaJapanese}散策`, lat: areaCenter.lat, lng: areaCenter.lng };
    const cafe = cafePlace || (spotsByArea[area] && spotsByArea[area].cafe) || {
      name: `${areaJapanese}カフェ`,
      lat: areaCenter.lat + 0.0015,
      lng: areaCenter.lng + 0.0015,
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(areaJapanese + 'カフェ')}`,
      place_id: null
    };
    const dinner = dinnerPlace || spots.dinner;

    // 標準的なスケジュール（開始時刻と推奨時間に基づいて自動調整）
    const lunchRT = generateReasonAndTags('lunch', lunch.name);
    const activityRT = generateReasonAndTags('activity', activity.name);
    const cafeRT = generateReasonAndTags('cafe', cafe.name);

    schedule = [
      {
        time: selectedTimes.lunch,
        type: 'lunch',
        category: lunch.category || 'restaurant',
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
        time: selectedTimes.activity,
        type: 'activity',
        category: activity.category || 'museum',
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
        time: selectedTimes.cafe,
        type: 'cafe',
        category: cafe.category || 'cafe',
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

  // customMeetingOverride/customFarewellOverride を使うため先に宣言
  let customMeetingOverride = null;
  let customFarewellOverride = null;

  if (customRequest) {
    const customResult = await insertCustomRequestSlot(schedule);
    schedule = customResult.schedule;
    customMeetingOverride = customResult.meetingOverride || null;
    customFarewellOverride = customResult.farewellOverride || null;
  }

  schedule = await hydrateScheduleWithPlaces(schedule, areaJapanese, generationStartTime);
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

    // 時間帯と推奨デート時間
    reasons.push(`${dateStartTime}開始、約${optimalDuration}時間のプランです`);

    // ムード
    if (mood) {
      reasons.push(`今日の気分は${moodNames[mood] || mood}とのことで、それに合わせたスポットを選びました`);
    }

    // 移動方針
    if (movementPref && movementPref.label) {
      reasons.push(`移動方針は「${movementPref.label}」。${movementPref.focus || '移動時間を抑えて巡れるように構成しました'}`);
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
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function estimateWalkingMinutes(distanceMeters) {
    const walkingSpeedMPerMin = 5000 / 60; // ~83.33 m/min
    return Math.max(1, Math.round(distanceMeters / walkingSpeedMPerMin));
  }

  function buildDirectionsLink(origin, destination) {
    const o = origin && origin.lat != null && origin.lng != null ? `${origin.lat},${origin.lng}` : '';
    const d = destination && destination.lat != null && destination.lng != null ? `${destination.lat},${destination.lng}` : '';
    if (!o || !d) return null;
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}&travelmode=transit`;
  }

  function buildTransitNote(prevItem, nextItem, travelInfo) {
    const fromName = (prevItem && prevItem.place_name) || '出発地';
    const toName = (nextItem && nextItem.place_name) || '目的地';
    return `${fromName} から ${toName} は公共交通機関（${travelInfo.label || '電車/地下鉄'}）を推奨します。Googleマップのルート案内で路線と乗換を確認してください。`;
  }

  function chooseTravelMode(distanceMeters) {
    const legCap = movementPref && movementPref.max_leg_minutes ? movementPref.max_leg_minutes : null;
    const transportationModes = conditions.transportation_modes || ['walk', 'transit'];

    const addReason = (base) => {
      if (legCap && base.travel_minutes > legCap) {
        return {
          ...base,
          duration: `${legCap}min以内`,
          travel_minutes: legCap,
          reason: `${base.reason}（移動方針: ${movementPref.label}に合わせて上限${legCap}分）`,
        };
      }
      if (movementPref && movementPref.label) {
        return {
          ...base,
          reason: `${base.reason}（移動方針: ${movementPref.label}）`,
        };
      }
      return base;
    };

    // 徒歩が選択されていて、近距離の場合
    if (transportationModes.includes('walk') && distanceMeters <= 1800) {
      const walkMin = estimateWalkingMinutes(distanceMeters);
      return addReason({
        mode: 'walk',
        label: '徒歩',
        duration: `${walkMin}min`,
        travel_minutes: walkMin,
        reason: '近距離なので徒歩移動が最適です',
      });
    }

    // 車が選択されている場合
    if (transportationModes.includes('car')) {
      // 車での移動時間を概算（平均時速30km）
      const carMinutes = Math.ceil((distanceMeters / 1000) / 30 * 60);
      // 駐車時間を加算（5分）
      const totalMinutes = carMinutes + 5;

      return addReason({
        mode: 'car',
        label: '車',
        duration: `${totalMinutes}min`,
        travel_minutes: totalMinutes,
        distance_km: (distanceMeters / 1000).toFixed(1),
        reason: '車での移動が便利です（駐車時間込み）',
      });
    }

    // タクシーが選択されている場合
    if (transportationModes.includes('taxi')) {
      const taxiMinutes = Math.ceil((distanceMeters / 1000) / 30 * 60) + 3; // 乗降時間込み

      return addReason({
        mode: 'taxi',
        label: 'タクシー',
        duration: `${taxiMinutes}min`,
        travel_minutes: taxiMinutes,
        reason: 'タクシーでの移動が便利です',
      });
    }

    // 電車・地下鉄が選択されている場合（デフォルト）
    if (distanceMeters <= 4500) {
      return addReason({
        mode: 'train',
        label: '電車/地下鉄',
        duration: '8-12min',
        travel_minutes: 10,
        reason: '中距離なので電車/地下鉄移動が便利です',
      });
    }
    if (distanceMeters <= 7500) {
      return addReason({
        mode: 'train',
        label: '電車/地下鉄',
        duration: '12-18min',
        travel_minutes: 15,
        reason: '少し距離があるため電車移動を推奨します',
      });
    }
    if (distanceMeters <= 12000) {
      return addReason({
        mode: 'train',
        label: '電車/地下鉄',
        duration: '18-28min',
        travel_minutes: 22,
        reason: '長距離のため電車移動が現実的です',
      });
    }
    return addReason({
      mode: 'train',
      label: '電車/地下鉄',
      duration: '25-40min',
      travel_minutes: 30,
      reason: '長距離のため電車移動が現実的です',
    });
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
  const travelCapMinutes = movementPref && movementPref.max_leg_minutes ? movementPref.max_leg_minutes : null;
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
    if (travelCapMinutes && item.travel_time_min > travelCapMinutes) {
      item.travel_time_min = travelCapMinutes;
    }
    prev = item;
  }

  // 集合・移動・解散を含む詳細スケジュールを作成
  const detailedSchedule = [];

  const timeToMinutes = (t) => {
    if (!t || typeof t !== 'string') return 0;
    const [hStr, mStr] = t.split(':');
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr || '0', 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
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
    '渋谷': { name: '渋谷駅', exit: 'ハチ公口' },
    shinjuku: { name: '新宿駅', exit: '東口' },
    '新宿': { name: '新宿駅', exit: '東口' },
    ginza: { name: '銀座駅', exit: 'A1出口' },
    '銀座': { name: '銀座駅', exit: 'A1出口' },
    harajuku: { name: '原宿駅', exit: '竹下口' },
    '原宿': { name: '原宿駅', exit: '竹下口' },
    odaiba: { name: 'お台場海浜公園駅', exit: '改札' },
    'お台場': { name: 'お台場海浜公園駅', exit: '改札' },
    ueno: { name: '上野駅', exit: '公園口' },
    '上野': { name: '上野駅', exit: '公園口' },
    asakusa: { name: '浅草駅', exit: '1番出口' },
    '浅草': { name: '浅草駅', exit: '1番出口' },
    ikebukuro: { name: '池袋駅', exit: '東口' },
    '池袋': { name: '池袋駅', exit: '東口' },
  };

  // エリア名に「駅」が含まれている場合、それをそのまま使用
  // 含まれていない場合は areaStations から取得、なければエリア名 + '駅'
  let station;
  if (area.includes('駅')) {
    station = { name: area, exit: '改札' };
  } else {
    station = areaStations[area] || { name: area + '駅', exit: '改札' };
  }

  // 開始時刻を計算（最初のスポットの15分前に集合）
  const firstSpotTime = schedule[0]?.time || '12:00';
  const [hours, minutes] = firstSpotTime.split(':').map(Number);
  const defaultMeetingTime = `${String(hours).padStart(2, '0')}:${String(Math.max(0, minutes - 15)).padStart(2, '0')}`;
  const meetingTime = (customMeetingOverride && customMeetingOverride.time) || defaultMeetingTime;
  const meetingName = (customMeetingOverride && customMeetingOverride.name) || `${station.name} ${station.exit}`;
  const meetingLat = (customMeetingOverride && customMeetingOverride.lat) || areaCenter.lat;
  const meetingLng = (customMeetingOverride && customMeetingOverride.lng) || areaCenter.lng;
  console.log(`📍 Meeting point: ${meetingName} at (${meetingLat}, ${meetingLng}), areaCenter:`, areaCenter);

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
  const initialStart = schedule[0]?.time || meetingTime || '12:00';
  let currentStartMinutes = timeToMinutes(initialStart);

  // 2. スポット間に移動を挿入
  for (let i = 0; i < schedule.length; i++) {
    const item = schedule[i];
    const prevSpot = i > 0 ? schedule[i - 1] : null;

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
      const directionsUrl = buildDirectionsLink(prevSpot, item);
      const directionsNote = travelInfo.mode === 'train'
        ? buildTransitNote(prevSpot, item, travelInfo)
        : null;
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
        directions_url: directionsUrl,
        directions_note: directionsNote,
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

    const actualStartTime = minutesToTime(visitStart);
    const visitItem = {
      ...item,
      time: actualStartTime,
      end_time: endTime,
    };

    // タイムライン確定後に正確な時刻で営業時間を再チェック
    // （ハイドレーション時点では仮の時刻でチェックしていたため、ズレが生じる可能性がある）
    if (visitItem.opening_hours && visitItem.opening_hours.length > 0) {
      const isOpen = isOpenAtTime(visitItem.opening_hours, actualStartTime);
      if (isOpen) {
        // 営業していれば、誤った警告があれば削除
        if (visitItem.closed_warning) {
          delete visitItem.closed_warning;
          visitItem.is_open = true;
          console.log(`✅ [Re-Check] ${visitItem.place_name} is open at ${actualStartTime} (Warning removed)`);
        }
      } else {
        // 営業していなければ、警告を追加（または時刻を更新）
        visitItem.is_open = false;
        visitItem.closed_warning = `この店舗は${actualStartTime}には営業していない可能性があります。事前に営業時間をご確認ください。`;
        console.warn(`⚠️ [Re-Check] ${visitItem.place_name} is closed at ${actualStartTime} (Warning added/updated)`);
      }
    }

    detailedSchedule.push(visitItem);
    currentStartMinutes = endTimeMinutes;
  }

  // 3. 解散
  const lastItem = detailedSchedule.length > 0 ? detailedSchedule[detailedSchedule.length - 1] : null;

  if (!lastItem) {
    // スポットが見つからなかった場合の最低限の解散処理
    detailedSchedule.push({
      time: '18:00',
      type: 'farewell',
      place_name: `${station.name}付近`,
      lat: areaCenter.lat,
      lng: areaCenter.lng,
      area: area,
      duration: '0min',
      reason: '今日はありがとうございました。また別のエリアでもデートしましょう！',
      is_farewell: true,
    });
  } else {
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
  }

  // 交通経路の詳細（電車/地下鉄）の補足を追加
  async function enrichTransitInfo(list) {
    if (!process.env.GOOGLE_MAPS_API_KEY) return list;
    const enhanced = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (item.is_travel && item.transport_mode === 'train') {
        const origin = i > 0 ? list[i - 1] : null;
        const destination = i + 1 < list.length ? list[i + 1] : null;
        const transit = await getTransitDirections(origin, destination);
        enhanced.push({
          ...item,
          transit_route: transit || null,
        });
      } else {
        enhanced.push(item);
      }
    }
    return enhanced;
  }

  schedule = await enrichTransitInfo(detailedSchedule);

  // 調整メッセージを生成
  let adjustmentMessage = '';
  if (adjustment) {
    adjustmentMessage = `\n\n✨ 調整内容「${adjustment}」を反映しました！`;
  }

  // 既存のサマリーロジックをラップ
  const defaultSummary = phase === 'first'
    ? '落ち着いて会話しやすい初デート向けプラン'
    : phase === 'second'
      ? 'より親密になる2〜3回目デート向けプラン'
      : phase === 'anniversary'
        ? '記念日を彩る特別なデートプラン'
        : 'カジュアルに楽しむデートプラン';

  const defaultNextStep = phase === 'first'
    ? '今日は本当に楽しかった。また会いたい。'
    : phase === 'second'
      ? 'この前よりも君のこともっと知りたいな。'
      : phase === 'anniversary'
        ? 'これからもずっと一緒にいたいね。'
        : 'また気軽に会おうね。';

  return {
    ...preGeneratedPlan, // AI生成のプロパティがある場合は優先
    plan_summary: (preGeneratedPlan && preGeneratedPlan.plan_summary) || defaultSummary,
    plan_reason: (preGeneratedPlan && preGeneratedPlan.plan_reason) || (generatePlanReason() + adjustmentMessage),
    total_estimated_cost: (preGeneratedPlan && preGeneratedPlan.total_estimated_cost) || costMap[budget],
    schedule: schedule, // 詳細計算・ハイドレーション済みのスケジュール
    adjustable_points: (preGeneratedPlan && preGeneratedPlan.adjustable_points) || ['予算', '所要時間', '屋内/屋外', 'グルメのジャンル'],
    risk_flags: (preGeneratedPlan && preGeneratedPlan.risk_flags) || [],
    conversation_topics: (preGeneratedPlan && preGeneratedPlan.conversation_topics) || [
      '最近やってみたいこと',
      '子どもの頃の思い出',
      'お互いの家族について',
    ],
    next_step_phrase: (preGeneratedPlan && preGeneratedPlan.next_step_phrase) || defaultNextStep,
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

// 代替スポット取得API
app.post('/api/get-alternative-spots', async (req, res) => {
  try {
    const {
      category = 'restaurant',
      area = 'shibuya',
      budget = 'medium',
      datePhase = 'casual',
      timeSlot = 'lunch',
      mood = null,
      ngConditions = [],
      excludeSpots = [],
      limit = 5
    } = req.body;

    console.log(`[Alternatives] Fetching alternatives for ${category} in ${area}`);
    console.log(`[Alternatives] Exclude spots: ${excludeSpots.join(', ')}`);

    // エリア名を英語から日本語に変換
    const areaMap = {
      'shibuya': '渋谷',
      'shinjuku': '新宿',
      'harajuku': '原宿',
      'omotesando': '表参道',
      'ebisu': '恵比寿',
      'roppongi': '六本木',
      'ginza': '銀座',
      'odaiba': 'お台場',
      'ueno': '上野',
      'asakusa': '浅草',
      'ikebukuro': '池袋',
    };
    const areaJapanese = areaMap[area] || area;
    console.log(`[Alternatives] Area mapping: ${area} -> ${areaJapanese}`);

    const spotDB = getSpotDatabase();
    const alternatives = [];

    if (spotDB.loaded && spotDB.spots.length > 0) {
      console.log(`[Alternatives] Total spots in DB: ${spotDB.spots.length}`);

      // まずカテゴリとエリアでフィルタ
      const categoryMatches = spotDB.spots.filter(s => s.category === category && s.area_name === areaJapanese);
      console.log(`[Alternatives] Category+Area matches: ${categoryMatches.length}`);

      // スポットデータベースから候補を取得（優先度付きフィルタリング）
      const allSpots = spotDB.spots.filter(spot => {
        // 必須条件：エリア、カテゴリ、座標
        if (spot.area_name !== areaJapanese) return false;
        if (spot.category !== category) return false;
        if (!spot.lat || !spot.lng) return false;

        // 除外スポット
        if (excludeSpots.includes(spot.spot_name)) return false;

        // NG条件フィルタ（厳密に適用）
        if (ngConditions.length > 0) {
          if (ngConditions.includes('outdoor') && spot.indoor_outdoor === 'outdoor') return false;
          if (ngConditions.includes('indoor') && spot.indoor_outdoor === 'indoor') return false;
          if (ngConditions.includes('crowd') && spot.tags && spot.tags.includes('混雑')) return false;
        }

        return true;
      });

      // 予算とフェーズでソート（完全一致を優先、それ以外も含める）
      const scored = allSpots.map(spot => {
        let score = 0;

        // 予算が一致する場合は優先
        if (budget && spot.price_range === budget) score += 10;

        // デートフェーズが一致する場合は優先
        if (datePhase && spot.recommended_for && typeof spot.recommended_for === 'string') {
          const phases = spot.recommended_for.split(',').map(p => p.trim());
          const phaseMap = {
            'first': '初デート',
            'second': '2回目以降',
            'anniversary': '記念日',
            'casual': 'カジュアル'
          };
          if (phases.includes(phaseMap[datePhase]) || phases.includes('全て')) {
            score += 5;
          }
        }

        return { spot, score };
      });

      // スコアでソート（高い順）してからランダム要素を加える
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return Math.random() - 0.5;
      });

      const selected = scored.slice(0, limit).map(item => item.spot);

      for (const spot of selected) {
        alternatives.push(spotDB.formatSpotForPlan(spot));
      }

      console.log(`[Alternatives] Found ${alternatives.length} alternatives from database`);
    }

    // 候補が少ない場合はGoogle Places APIで補完（オプション）
    // 今回はデータベースのみで対応

    res.json({
      success: true,
      alternatives,
      count: alternatives.length
    });

  } catch (error) {
    console.error('[Alternatives] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ルートパスのルーティング
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/wizard.html'));
});

app.get('/wizard.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/wizard.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
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

// Vercel サーバーレス関数としてエクスポート
// Expressアプリをサーバーレス関数ハンドラーとしてラップ
module.exports = (req, res) => {
  // すでにExpressがセットアップされているので、リクエストを処理
  return app(req, res);
};
