const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const { searchPlaces, getPlaceDetails } = require('./services/places');

const app = express();

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

async function generateMockPlan(conditions, adjustment) {
  // デモ用モック版プラン生成（Google Places API統合版）
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
  const areaJapanese = areaNameMap[area] || '渋谷';

  // Google Places APIを使って実際の店舗を検索
  const hasPlacesAPI = !!process.env.GOOGLE_MAPS_API_KEY;
  let lunchPlace, activityPlace, cafePlace, dinnerPlace;

  if (hasPlacesAPI) {
    // 予算レベルに応じた検索キーワード（バリエーション追加）
    const lunchKeywords = {
      low: ['カフェランチ', 'カジュアル和食', 'ラーメン おしゃれ', 'パスタ カジュアル', '定食屋 人気'],
      medium: ['イタリアン ランチ', 'おしゃれ レストラン', 'ビストロ', 'カフェレストラン', '和食 個室'],
      high: ['高級レストラン ランチ', 'フレンチ ランチ', '懐石料理 ランチ', 'イタリアン 高級', '寿司 ランチ'],
    };
    const dinnerKeywords = {
      low: ['居酒屋 おしゃれ', 'カジュアルダイニング', '焼肉 カジュアル', 'イタリアン 気軽', 'バル'],
      medium: ['おしゃれ ディナー', 'イタリアン', 'フレンチビストロ', '和食 個室', '焼肉 おしゃれ'],
      high: ['高級ディナー', 'フレンチレストラン', '高級寿司', '会席料理', '鉄板焼き 高級'],
    };

    // 興味に基づいたアクティビティとカフェ（組み合わせ対応）
    const interests = [...conditions.user_interests, ...conditions.partner_interests];
    const uniqueInterests = [...new Set(interests)]; // 重複削除

    let activityKeywords = [];
    let cafeKeywords = [];

    // アクティビティキーワード（全ての興味に対応）
    if (uniqueInterests.includes('gourmet')) activityKeywords.push('グルメスポット', '食べ歩き', 'スイーツ巡り', '市場', 'フードコート', '食品サンプル', 'チョコレート専門店');
    if (uniqueInterests.includes('walk')) activityKeywords.push('散歩道', '商店街', '下町散策', 'レトロな街並み', '川沿い散歩', '坂道', '路地裏');
    if (uniqueInterests.includes('movie')) activityKeywords.push('映画館', 'ミニシアター', 'シネマカフェ', 'IMAXシアター', '映画グッズショップ');
    if (uniqueInterests.includes('art')) activityKeywords.push('美術館', '博物館', 'ギャラリー', 'アート展', '現代アート', '写真展', 'クラフト展');
    if (uniqueInterests.includes('shop')) activityKeywords.push('ショッピングモール', '雑貨屋', 'セレクトショップ', 'アンティーク', '古着屋', 'インテリアショップ', '文房具店');
    if (uniqueInterests.includes('sport')) activityKeywords.push('スポーツ観戦', 'ボウリング', 'ダーツバー', '卓球', 'バッティングセンター', 'ビリヤード', 'アーチェリー', 'スポーツショップ');
    if (uniqueInterests.includes('cafe')) activityKeywords.push('カフェ巡り', 'コーヒー専門店', 'スイーツカフェ', 'ブックカフェ', '猫カフェ', 'テーマカフェ');
    if (uniqueInterests.includes('music')) activityKeywords.push('ライブハウス', '音楽カフェ', 'ジャズバー', 'CDショップ', 'レコードショップ', '楽器店', '音楽イベント');
    if (uniqueInterests.includes('nature')) activityKeywords.push('公園', '庭園', '自然スポット', '散歩道', '植物園', '動物園', '水族館', '花畑');
    if (uniqueInterests.includes('photography')) activityKeywords.push('撮影スポット', '展望台', 'インスタ映えスポット', 'フォトジェニックカフェ', '夜景スポット', 'カメラショップ');

    // デフォルト
    if (activityKeywords.length === 0) activityKeywords = ['観光スポット', '人気スポット', 'デートスポット'];

    // ランダムに1つ選択
    const activityKeyword = activityKeywords[Math.floor(Math.random() * activityKeywords.length)];

    // カフェキーワード選択（予算と興味に応じて）
    if (budget === 'high') {
      cafeKeywords = ['高級カフェ', 'スペシャリティコーヒー', 'パティスリー併設カフェ', 'ホテルラウンジ', 'フレンチカフェ'];
    } else if (uniqueInterests.includes('gourmet')) {
      cafeKeywords = ['スイーツカフェ', 'パンケーキ専門店', 'パフェ専門店', 'ケーキ屋カフェ', 'チョコレートカフェ'];
    } else if (uniqueInterests.includes('walk')) {
      cafeKeywords = ['下町カフェ', 'レトロカフェ', '喫茶店', '昭和レトロカフェ', '路地裏カフェ'];
    } else if (uniqueInterests.includes('movie')) {
      cafeKeywords = ['映画カフェ', 'シネマカフェ', 'レトロシアターカフェ', 'ポップコーンカフェ'];
    } else if (uniqueInterests.includes('art')) {
      cafeKeywords = ['アートカフェ', 'ギャラリーカフェ', 'デザイナーズカフェ', 'ブックカフェ', '文学カフェ'];
    } else if (uniqueInterests.includes('shop')) {
      cafeKeywords = ['雑貨カフェ', 'セレクトショップカフェ', 'インテリアカフェ', '北欧カフェ'];
    } else if (uniqueInterests.includes('sport')) {
      cafeKeywords = ['スポーツカフェ', 'スポーツバー', 'ダーツカフェ', 'ビリヤードカフェ'];
    } else if (uniqueInterests.includes('cafe')) {
      cafeKeywords = ['スペシャリティコーヒー', '自家焙煎カフェ', 'サードウェーブカフェ', 'エスプレッソバー', 'コーヒースタンド'];
    } else if (uniqueInterests.includes('music')) {
      cafeKeywords = ['音楽カフェ', 'ジャズカフェ', 'レコードカフェ', 'ライブカフェ', 'ピアノバー'];
    } else if (uniqueInterests.includes('nature')) {
      cafeKeywords = ['テラスカフェ', 'ガーデンカフェ', '緑が見えるカフェ', '公園カフェ', '植物カフェ'];
    } else if (uniqueInterests.includes('photography')) {
      cafeKeywords = ['インスタ映えカフェ', 'フォトジェニックカフェ', '窓辺カフェ', '絶景カフェ', 'おしゃれカフェ'];
    } else {
      cafeKeywords = ['おしゃれカフェ', 'スイーツカフェ', '隠れ家カフェ', 'インスタ映えカフェ'];
    }

    const cafeKeyword = cafeKeywords[Math.floor(Math.random() * cafeKeywords.length)];

    // ランチ・ディナーもランダムに選択
    const lunchOptions = lunchKeywords[budget] || lunchKeywords.medium;
    const dinnerOptions = dinnerKeywords[budget] || dinnerKeywords.medium;
    const lunchKeyword = lunchOptions[Math.floor(Math.random() * lunchOptions.length)];
    const dinnerKeyword = dinnerOptions[Math.floor(Math.random() * dinnerOptions.length)];

    try {
      [lunchPlace, activityPlace, cafePlace, dinnerPlace] = await Promise.all([
        searchPlaces(lunchKeyword, areaJapanese),
        searchPlaces(activityKeyword, areaJapanese),
        searchPlaces(cafeKeyword, areaJapanese),
        searchPlaces(dinnerKeyword, areaJapanese),
      ]);
      console.log('✅ Places API data fetched successfully');
    } catch (err) {
      console.error('Places API search failed:', err);
    }
  }

  // フォールバック用のモックスポット
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

  // 年代と性格の取得
  const userAge = conditions.user_age_group;
  const partnerAge = conditions.partner_age_group;

  // 性格の組み合わせに応じたプラン
  const isOutdoorFriendly = userPersonality === 'outdoor' || partnerPersonality === 'outdoor';
  const isIndoorPreferred = userPersonality === 'indoor' || partnerPersonality === 'indoor';
  const isActiveType = userPersonality === 'active' || partnerPersonality === 'active';
  const isCalmType = userPersonality === 'calm' || partnerPersonality === 'calm';

  // 年代による時間配分の調整
  const isYounger = (userAge === '20s' || partnerAge === '20s');
  const isOlder = (userAge === '40s' || partnerAge === '40s');

  // 時間帯のバリエーションを生成
  const timeVariations = {
    morning: { start: '09:00', lunch: '11:30', activity: '13:30', cafe: '15:30', dinner: '17:30' },
    noon: { start: '12:00', lunch: '12:00', activity: '14:00', cafe: '16:30', dinner: '18:00' },
    afternoon: { start: '14:00', lunch: '14:00', activity: '16:00', cafe: '17:30', dinner: '19:00' },
    evening: { start: '17:00', lunch: null, activity: '17:00', cafe: '18:30', dinner: '20:00' },
  };

  // 年代と性格に基づいた時間帯選択
  let timePattern = 'noon'; // デフォルト

  // 20代 → 午後〜夕方が多い
  if ((userAge === '20s' || partnerAge === '20s') && Math.random() > 0.5) {
    timePattern = Math.random() > 0.5 ? 'afternoon' : 'evening';
  }
  // 30代以上 → 朝活や昼が多い
  else if ((userAge === '30s' || userAge === '40s' || partnerAge === '30s' || partnerAge === '40s') && Math.random() > 0.6) {
    timePattern = Math.random() > 0.5 ? 'morning' : 'noon';
  }
  // デート段階が初期 → 昼が安全
  else if (phase === 'first' && Math.random() > 0.3) {
    timePattern = 'noon';
  }
  // ランダム要素
  else {
    const patterns = ['morning', 'noon', 'afternoon'];
    timePattern = patterns[Math.floor(Math.random() * patterns.length)];
  }

  const selectedTimes = timeVariations[timePattern];

  // 理由を生成するヘルパー関数
  function generateReason(type, spotName) {
    const userInterests = conditions.user_interests;
    const partnerInterests = conditions.partner_interests;
    const commonInterests = userInterests.filter(i => partnerInterests.includes(i));

    const interestMessages = {
      gourmet: '美食やグルメに興味があるとのことなので',
      walk: '散歩や街歩きが好きとのことなので',
      movie: '映画鑑賞が好きとのことなので',
      art: 'アートや文化に興味があるとのことなので',
      shop: 'ショッピングに興味があるとのことなので',
      sport: 'スポーツ観戦やアクティブな活動が好きとのことなので',
      cafe: 'カフェ巡りが好きとのことなので',
      music: '音楽が好きとのことなので',
      nature: '自然が好きとのことなので',
      photography: '写真撮影が好きとのことなので'
    };

    const personalityMessages = {
      outdoor: 'アウトドア派',
      indoor: 'インドア派',
      active: 'アクティブ',
      calm: '落ち着いた'
    };

    let reason = '';

    // 共通の興味がある場合
    if (commonInterests.length > 0) {
      const interest = commonInterests[0];
      reason = interestMessages[interest] || '';
    } else if (userInterests.length > 0) {
      const interest = userInterests[0];
      reason = interestMessages[interest] || '';
    }

    // タイプ別の追加メッセージ
    if (type === 'lunch') {
      if (phase === 'first') {
        reason += reason ? '、初対面でも会話しやすい落ち着いた環境を選びました' : '初対面でも会話しやすい落ち着いた環境を選びました';
      } else if (isCalmType) {
        reason += reason ? '、落ち着いた雰囲気でリラックスできる場所を選びました' : '落ち着いた雰囲気でリラックスできる場所を選びました';
      } else {
        reason += reason ? '、リラックスして会話を楽しめる場所を選びました' : 'リラックスして会話を楽しめる場所を選びました';
      }
    } else if (type === 'activity') {
      if (isActiveType) {
        reason += reason ? '、アクティブに楽しめる体験を重視しました' : 'アクティブな性格を考慮して、体を動かす体験を選びました';
      } else if (isOutdoorFriendly && !isIndoorPreferred) {
        reason += reason ? '、外での活動を楽しめる場所を選びました' : 'アウトドア派とのことで、外での活動を多めにしました';
      } else if (isIndoorPreferred) {
        reason += reason ? '、屋内でゆったり楽しめる場所を選びました' : 'インドア派とのことで、落ち着いた屋内スポットを選びました';
      } else if (reason) {
        reason += '、一緒に楽しめる体験を重視しました';
      } else {
        reason = `${personalityMessages[userPersonality] || ''}な性格を考慮して、一緒に楽しめる体験を選びました`;
      }
    } else if (type === 'cafe') {
      if (isYounger) {
        reason += reason ? '、SNS映えするおしゃれな空間を選びました' : 'SNS映えするスポットで特別感を演出します';
      } else if (isOlder) {
        reason += reason ? '、落ち着いて会話できる上質な空間を選びました' : '落ち着いた雰囲気で会話を楽しめる場所を選びました';
      } else {
        reason += reason ? '、ゆったりと過ごせる空間を選びました' : 'SNS映えするスポットで特別感を演出します';
      }
    } else if (type === 'dinner') {
      if (budget === 'high') {
        reason += reason ? '、特別な時間を過ごせる高級感のある場所を選びました' : '特別な時間を過ごせる高級感のある場所を選びました';
      } else if (isCalmType) {
        reason += reason ? '、ゆっくり会話できる落ち着いた雰囲気の場所を選びました' : '落ち着いた雰囲気でゆっくり関係を深められる場所を選びました';
      } else {
        reason += reason ? '、ゆったりとした時間で関係を深められる場所を選びました' : 'ゆったりとした時間で関係を深められる場所を選びました';
      }
    }

    return reason || '楽しい時間を過ごせる場所を選びました';
  }

  let schedule = [];

  if (phase === 'first') {
    // 初デート：落ち着いて会話しやすい
    const lunch = lunchPlace || spots.lunch;
    const activity = activityPlace || spots.activity;
    const cafe = cafePlace || { name: spots.lunch.name + ' カフェ', lat: spots.lunch.lat + 0.0003, lng: spots.lunch.lng + 0.0003 };
    const dinner = dinnerPlace || spots.dinner;

    schedule = [
      {
        time: selectedTimes.lunch,
        type: 'lunch',
        place_name: lunch.name,
        lat: lunch.lat,
        lng: lunch.lng,
        area: area,
        price_range: prices.lunch,
        duration: '60min',
        reason: generateReason('lunch', lunch.name),
        info_url: lunch.url || 'https://www.google.com/search?q=' + encodeURIComponent(lunch.name),
        rating: lunch.rating,
      },
      {
        time: selectedTimes.activity,
        type: 'activity',
        place_name: activity.name,
        lat: activity.lat,
        lng: activity.lng,
        area: area,
        price_range: prices.activity,
        duration: '90min',
        reason: generateReason('activity', activity.name),
        info_url: activity.url || 'https://www.google.com/search?q=' + encodeURIComponent(activity.name),
        rating: activity.rating,
      },
      {
        time: selectedTimes.cafe,
        type: 'cafe',
        place_name: cafe.name,
        lat: cafe.lat,
        lng: cafe.lng,
        area: area,
        price_range: prices.cafe,
        duration: '45min',
        reason: generateReason('cafe', cafe.name),
        info_url: cafe.url || 'https://www.google.com/search?q=' + encodeURIComponent(cafe.name),
        rating: cafe.rating,
      },
      {
        time: selectedTimes.dinner,
        type: 'dinner',
        place_name: dinner.name,
        lat: dinner.lat,
        lng: dinner.lng,
        area: area,
        price_range: prices.dinner,
        duration: '90min',
        reason: generateReason('dinner', dinner.name),
        info_url: dinner.url || 'https://www.google.com/search?q=' + encodeURIComponent(dinner.name),
        rating: dinner.rating,
      },
    ];
  } else if (phase === 'second') {
    // 2〜3回目：活動を増やす
    const lunch = lunchPlace || spots.lunch;
    const activity = activityPlace || spots.activity;
    const cafe = cafePlace || { name: spots.lunch.name + ' カフェ', lat: spots.lunch.lat + 0.0003, lng: spots.lunch.lng + 0.0003 };

    schedule = [
      {
        time: selectedTimes.activity,
        type: 'activity',
        place_name: activity.name,
        lat: activity.lat,
        lng: activity.lng,
        area: area,
        price_range: prices.activity,
        duration: '120min',
        reason: generateReason('activity', activity.name),
        info_url: activity.url || 'https://www.google.com/search?q=' + encodeURIComponent(activity.name),
        rating: activity.rating,
      },
      {
        time: selectedTimes.lunch,
        type: 'lunch',
        place_name: lunch.name,
        lat: lunch.lat,
        lng: lunch.lng,
        area: area,
        price_range: prices.lunch,
        duration: '60min',
        reason: generateReason('lunch', lunch.name),
        info_url: lunch.url || 'https://www.google.com/search?q=' + encodeURIComponent(lunch.name),
        rating: lunch.rating,
      },
      {
        time: selectedTimes.activity,
        type: 'walk',
        place_name: areaJapanese + ' 街歩き',
        lat: areaCenter.lat,
        lng: areaCenter.lng,
        area: area,
        price_range: '0',
        duration: '60min',
        reason: generateReason('activity', activity.name),
      },
      {
        time: selectedTimes.cafe,
        type: 'cafe',
        place_name: cafe.name,
        lat: cafe.lat,
        lng: cafe.lng,
        area: area,
        price_range: prices.cafe,
        duration: '45min',
        reason: generateReason('cafe', cafe.name),
        info_url: cafe.url || 'https://www.google.com/search?q=' + encodeURIComponent(cafe.name),
        rating: cafe.rating,
      },
    ];
  } else {
    // 関係を深める段階
    const lunch = lunchPlace || spots.lunch;
    const activity = activityPlace || spots.activity;
    const dinner = dinnerPlace || spots.dinner;

    schedule = [
      {
        time: selectedTimes.activity,
        type: 'activity',
        place_name: activity.name,
        lat: activity.lat,
        lng: activity.lng,
        area: area,
        price_range: prices.activity,
        duration: '120min',
        reason: generateReason('activity', activity.name),
        info_url: activity.url || 'https://www.google.com/search?q=' + encodeURIComponent(activity.name),
        rating: activity.rating,
      },
      {
        time: selectedTimes.lunch,
        type: 'lunch',
        place_name: lunch.name,
        lat: lunch.lat,
        lng: lunch.lng,
        area: area,
        price_range: prices.lunch,
        duration: '90min',
        reason: generateReason('lunch', lunch.name),
        info_url: lunch.url || 'https://www.google.com/search?q=' + encodeURIComponent(lunch.name),
        rating: lunch.rating,
      },
      {
        time: selectedTimes.cafe,
        type: 'shop',
        place_name: areaJapanese + ' ショッピング',
        lat: areaCenter.lat + 0.0005,
        lng: areaCenter.lng + 0.0006,
        area: area,
        price_range: prices.cafe,
        duration: '60min',
        reason: generateReason('shop', 'ショッピング'),
      },
      {
        time: selectedTimes.dinner,
        type: 'dinner',
        place_name: dinner.name,
        lat: dinner.lat,
        lng: dinner.lng,
        area: area,
        price_range: prices.dinner,
        duration: '120min',
        reason: generateReason('dinner', dinner.name),
        info_url: dinner.url || 'https://www.google.com/search?q=' + encodeURIComponent(dinner.name),
        rating: dinner.rating,
      },
    ];
  }

  const costMap = {
    low: '3000-5000',
    medium: '7000-10000',
    high: '15000-25000',
  };

  // プラン全体の理由を生成
  function generatePlanReason() {
    const userInterests = conditions.user_interests;
    const partnerInterests = conditions.partner_interests;
    const commonInterests = userInterests.filter(i => partnerInterests.includes(i));

    const interestNames = {
      gourmet: 'グルメ',
      walk: '散歩・街歩き',
      movie: '映画',
      art: 'アート・文化',
      shop: 'ショッピング',
      sport: 'スポーツ観戦',
      cafe: 'カフェ巡り',
      music: '音楽',
      nature: '自然',
      photography: '写真撮影'
    };

    const budgetNames = {
      low: 'カジュアル',
      medium: '程よい',
      high: '特別な'
    };

    const phaseNames = {
      first: '初めてのデート',
      second: '2〜3回目のデート',
      deeper: '関係を深めるデート'
    };

    let reasons = [];

    // フェーズに応じた理由
    reasons.push(`${phaseNames[phase] || 'デート'}ということで、${phase === 'first' ? '落ち着いて会話できる場所を中心に' : phase === 'second' ? '一緒に楽しめるアクティビティを多めに' : '特別な時間を過ごせる場所を'}選びました`);

    // 共通の興味
    if (commonInterests.length > 0) {
      const interestList = commonInterests.map(i => interestNames[i] || i).join('、');
      reasons.push(`お二人とも${interestList}に興味があるとのことなので、それを楽しめるスポットを入れています`);
    } else if (userInterests.length > 0 && partnerInterests.length > 0) {
      reasons.push(`${interestNames[userInterests[0]] || userInterests[0]}と${interestNames[partnerInterests[0]] || partnerInterests[0]}の要素をバランスよく取り入れました`);
    }

    // 予算
    reasons.push(`予算は${budgetNames[budget] || ''}な${costMap[budget]}円程度で設定しています`);

    // 性格
    if (userPersonality === partnerPersonality) {
      const personalityMsg = userPersonality === 'outdoor' ? 'アウトドア派とのことで、外での活動を多めに' : userPersonality === 'indoor' ? 'インドア派とのことで、落ち着いた屋内スポットを中心に' : '';
      if (personalityMsg) reasons.push(personalityMsg + '組み込んでいます');
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
    plan_reason: generatePlanReason(),
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
