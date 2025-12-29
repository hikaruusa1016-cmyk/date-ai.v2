const axios = require('axios');

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
// リファラ制限に引っかからないよう、デフォルトは PUBLIC_API_BASE かローカルに寄せる
const REFERER_ORIGIN =
  process.env.PLACES_REFERER ||
  process.env.PUBLIC_API_BASE ||
  'http://localhost:3001';

// エリアごとの中心座標（locationBias用 - キャッシュとして使用）
const AREA_CENTERS = {
  '東京都': { lat: 35.6812, lng: 139.7671 },
  '渋谷': { lat: 35.6595, lng: 139.7004 },
  '新宿': { lat: 35.6938, lng: 139.7034 },
  '銀座': { lat: 35.6715, lng: 139.7656 },
  '表参道': { lat: 35.6657, lng: 139.7125 },
  '原宿': { lat: 35.6702, lng: 139.7027 },
  '恵比寿': { lat: 35.6467, lng: 139.7100 },
  '代官山': { lat: 35.6502, lng: 139.7048 },
  '中目黒': { lat: 35.6417, lng: 139.6979 },
  '六本木': { lat: 35.6627, lng: 139.7291 },
  '丸の内': { lat: 35.6812, lng: 139.7671 },
  '東京': { lat: 35.6812, lng: 139.7671 },
  '品川': { lat: 35.6284, lng: 139.7387 },
  '池袋': { lat: 35.7295, lng: 139.7109 },
  '上野': { lat: 35.7141, lng: 139.7774 },
  '浅草': { lat: 35.7148, lng: 139.7967 },
  '秋葉原': { lat: 35.6984, lng: 139.7731 },
  'お台場': { lat: 35.6272, lng: 139.7744 },
  '吉祥寺': { lat: 35.7033, lng: 139.5797 },
  '下北沢': { lat: 35.6613, lng: 139.6681 },
  '自由が丘': { lat: 35.6079, lng: 139.6681 },
  '横浜': { lat: 35.4437, lng: 139.6380 },
  '大阪': { lat: 34.6937, lng: 135.5023 },
};

// Google Geocoding API を使って location の座標を取得
// https://maps.googleapis.com/maps/api/geocode/json?address=ADDRESS&key=API_KEY
async function getCoordinatesForLocation(location) {
  // キャッシュチェック
  if (AREA_CENTERS[location]) {
    return AREA_CENTERS[location];
  }

  if (!API_KEY) {
    console.warn('⚠️ GOOGLE_MAPS_API_KEY not set. Using default Tokyo coordinates.');
    return { lat: 35.6812, lng: 139.7671 };
  }

  try {
    const url = 'https://maps.googleapis.com/maps/api/geocode/json';
    const response = await axios.get(url, {
      params: {
        address: location + ' 日本',  // 日本国内に限定
        key: API_KEY,
        language: 'ja'
      }
    });

    if (response.data?.results?.[0]?.geometry?.location) {
      const coords = response.data.results[0].geometry.location;
      const result = { lat: coords.lat, lng: coords.lng };

      // キャッシュに保存（次回以降の高速化）
      AREA_CENTERS[location] = result;
      console.log(`📍 Geocoded "${location}": ${coords.lat}, ${coords.lng}`);

      return result;
    } else {
      console.warn(`⚠️ Geocoding failed for "${location}". Using default Tokyo coordinates.`);
      return { lat: 35.6812, lng: 139.7671 };
    }
  } catch (err) {
    console.error('Geocoding error:', err.response?.data || err.message);
    return { lat: 35.6812, lng: 139.7671 };
  }
}

// Google Places (New) Text Search
// POST https://places.googleapis.com/v1/places:searchText?key=API_KEY
async function searchPlaces(query, location = '東京都', options = {}) {
  if (!API_KEY) {
    console.warn('⚠️ GOOGLE_MAPS_API_KEY not set. Using mock data.');
    return null;
  }
  try {
    const url = `https://places.googleapis.com/v1/places:searchText`;

    // === ユーザー条件を反映した高度な検索クエリ作成 ===
    let enhancedQuery = query;

    // 予算レベルに応じたキーワード追加
    if (options.budget) {
      const budgetKeywords = {
        'low': 'カジュアル リーズナブル',
        'medium': '人気 おすすめ',
        'high': '高級 上質 ハイクラス',
        'no_limit': '有名 人気'
      };
      enhancedQuery += ' ' + (budgetKeywords[options.budget] || '');
    }

    // デートフェーズに応じたキーワード追加
    if (options.datePhase) {
      const phaseKeywords = {
        'first': '落ち着いた 個室 静か',
        'second': 'おしゃれ 雰囲気',
        'casual': '人気 話題',
        'anniversary': '特別 記念日 高級'
      };
      enhancedQuery += ' ' + (phaseKeywords[options.datePhase] || '');
    }

    // 時間帯に応じたキーワード追加
    if (options.timeSlot) {
      const timeKeywords = {
        'lunch': 'ランチ',
        'dinner': 'ディナー',
        'evening': '夜',
        'halfday': '',
        'fullday': ''
      };
      enhancedQuery += ' ' + (timeKeywords[options.timeSlot] || '');
    }

    // リクエストボディ作成
    const body = {
      textQuery: `${enhancedQuery} ${location}`,
      languageCode: 'ja',
      maxResultCount: 10,  // より多くの候補から選択
      rankPreference: 'RELEVANCE'  // 関連性優先
    };

    // locationBias: エリアの中心座標から半径2.5km以内を優先
    // 動的ジオコーディングで座標を取得
    const center = await getCoordinatesForLocation(location);
    body.locationBias = {
      circle: {
        center: { latitude: center.lat, longitude: center.lng },
        radius: 2500.0  // 2.5km
      }
    };

    // includedType: カテゴリ指定（options.categoryが指定されている場合）
    if (options.category) {
      body.includedType = options.category;
    }

    // 価格レベルフィルター（予算に応じて）
    if (options.budget) {
      const priceLevels = {
        'low': { min: 0, max: 2 },      // $ - $$
        'medium': { min: 1, max: 3 },   // $$ - $$$
        'high': { min: 2, max: 4 },     // $$$ - $$$$
        'no_limit': { min: 0, max: 4 }  // すべて
      };
      const priceRange = priceLevels[options.budget];
      if (priceRange) {
        body.minRating = 3.5;  // 予算指定時は評価3.5以上に絞る
      }
    }

    const headers = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.rating,places.name,places.googleMapsUri,places.types,places.photos',
      // GCPのHTTPリファラ制限回避用（許可リストに同じ値を入れてください）
      Referer: REFERER_ORIGIN,
    };

    const response = await axios.post(url, body, { headers });
    const places = response.data?.places || [];
    if (places.length === 0) return null;

    // ランダム選択: 上位5件からランダムに1つ選ぶ
    const maxResults = Math.min(places.length, 5);
    const randomIndex = options.random !== false ? Math.floor(Math.random() * maxResults) : 0;
    const p = places[randomIndex];
    const lat = p.location?.latitude || null;
    const lng = p.location?.longitude || null;
    const placeName = p.displayName?.text || p.name || query;

    // Google Maps URL（実店舗のリンク優先、なければ座標で検索）
    let mapUrl = p.googleMapsUri || null;
    if (!mapUrl && lat && lng) {
      mapUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    } else if (!mapUrl) {
      mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeName + ' ' + location)}`;
    }

    return {
      name: placeName,
      address: p.formattedAddress || null,
      lat,
      lng,
      rating: p.rating || null,
      place_id: p.name || null,
      url: mapUrl,
      types: p.types || [],
      photos: p.photos || [],
    };
  } catch (err) {
    console.error('Places.searchPlaces error:', err.response?.data || err.message);
    return null;
  }
}

// Google Places (New) Place Details
// GET https://places.googleapis.com/v1/places/{place_id}?key=API_KEY&fields=...
async function getPlaceDetails(placeId) {
  if (!API_KEY || !placeId) return null;
  try {
    // languageCode=ja を付与して日本語の口コミを優先
    const url = `https://places.googleapis.com/v1/${placeId}?languageCode=ja`;
    const headers = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'displayName,formattedAddress,regularOpeningHours,websiteUri,rating,photos,internationalPhoneNumber,reviews',
      Referer: REFERER_ORIGIN,
    };
    const response = await axios.get(url, { headers });
    const r = response.data || {};
    return {
      name: r.displayName?.text || null,
      address: r.formattedAddress || null,
      opening_hours: r.regularOpeningHours?.weekdayDescriptions || [],
      website: r.websiteUri || null,
      rating: r.rating || null,
      phone: r.internationalPhoneNumber || null,
      photos: r.photos || [],
      reviews: r.reviews || [],
    };
  } catch (err) {
    console.error('Places.getPlaceDetails error:', err.response?.data || err.message);
    return null;
  }
}

module.exports = { searchPlaces, getPlaceDetails };
