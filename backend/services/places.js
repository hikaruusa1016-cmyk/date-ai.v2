const axios = require('axios');

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const REFERER_ORIGIN = process.env.PLACES_REFERER || 'http://localhost:8080';

// エリアごとの中心座標（locationBias用）
const AREA_CENTERS = {
  '東京都': { lat: 35.6812, lng: 139.7671 },
  '渋谷': { lat: 35.6595, lng: 139.7004 },
  '新宿': { lat: 35.6938, lng: 139.7034 },
  '銀座': { lat: 35.6715, lng: 139.7656 },
  '表参道': { lat: 35.6657, lng: 139.7125 },
  '恵比寿': { lat: 35.6467, lng: 139.7100 },
  '六本木': { lat: 35.6627, lng: 139.7291 },
  '横浜': { lat: 35.4437, lng: 139.6380 },
  '大阪': { lat: 34.6937, lng: 135.5023 },
};

// Google Places (New) Text Search
// POST https://places.googleapis.com/v1/places:searchText?key=API_KEY
async function searchPlaces(query, location = '東京都', options = {}) {
  if (!API_KEY) {
    console.warn('⚠️ GOOGLE_MAPS_API_KEY not set. Using mock data.');
    return null;
  }
  try {
    const url = `https://places.googleapis.com/v1/places:searchText`;

    // リクエストボディ作成
    const body = {
      textQuery: `${query} ${location}`,
      languageCode: 'ja',
      maxResultCount: 10  // より多くの候補から選択
    };

    // locationBias: エリアの中心座標から半径2.5km以内を優先
    const center = AREA_CENTERS[location] || AREA_CENTERS['東京都'];
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
