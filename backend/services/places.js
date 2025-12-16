const axios = require('axios');

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Google Places (New) Text Search
// POST https://places.googleapis.com/v1/places:searchText?key=API_KEY
async function searchPlaces(query, location = '東京都', options = {}) {
  if (!API_KEY) {
    console.warn('⚠️ GOOGLE_MAPS_API_KEY not set. Using mock data.');
    return null;
  }
  try {
    const url = `https://places.googleapis.com/v1/places:searchText`;
    const body = { textQuery: `${query} ${location}`, languageCode: 'ja' };
    const headers = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.rating,places.name,places.googleMapsUri'
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
    const url = `https://places.googleapis.com/v1/${placeId}`;
    const headers = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'displayName,formattedAddress,regularOpeningHours,websiteUri,rating,photos,internationalPhoneNumber'
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
    };
  } catch (err) {
    console.error('Places.getPlaceDetails error:', err.response?.data || err.message);
    return null;
  }
}

module.exports = { searchPlaces, getPlaceDetails };
