const axios = require('axios');

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Google Directions API (transit) 旧版を利用して簡易的に路線/乗換情報を取得
// 参考: https://developers.google.com/maps/documentation/directions/get-directions
async function getTransitDirections(origin, destination) {
  if (!API_KEY) return null;
  if (!origin || !destination || origin.lat == null || origin.lng == null || destination.lat == null || destination.lng == null) {
    return null;
  }

  try {
    const params = new URLSearchParams({
      origin: `${origin.lat},${origin.lng}`,
      destination: `${destination.lat},${destination.lng}`,
      mode: 'transit',
      language: 'ja',
      key: API_KEY,
      alternatives: 'false'
    });

    const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
    const res = await axios.get(url);
    if (!res.data || res.data.status !== 'OK' || !res.data.routes || res.data.routes.length === 0) {
      console.warn('[Directions] No route found', res.data && res.data.status);
      return null;
    }

    const route = res.data.routes[0];
    const leg = route.legs && route.legs[0];
    if (!leg) return null;

    const steps = (leg.steps || [])
      .filter((s) => s.travel_mode === 'TRANSIT' || s.transit_details)
      .map((s) => {
        const t = s.transit_details || {};
        const line = t.line || {};
        return {
          mode: s.travel_mode === 'TRANSIT' ? 'transit' : (s.travel_mode || '').toLowerCase(),
          line_name: line.short_name || line.name || null,
          agency: line.agencies && line.agencies[0] ? line.agencies[0].name : null,
          vehicle: line.vehicle ? line.vehicle.type : null,
          headsign: t.headsign || null,
          num_stops: t.num_stops || null,
          departure_stop: t.departure_stop ? t.departure_stop.name : null,
          arrival_stop: t.arrival_stop ? t.arrival_stop.name : null,
          departure_time: t.departure_time ? t.departure_time.text : null,
          arrival_time: t.arrival_time ? t.arrival_time.text : null,
          instructions: s.html_instructions || s.summary || null,
        };
      });

    const summary = route.summary || null;
    const durationMinutes = leg.duration && leg.duration.value ? Math.round(leg.duration.value / 60) : null;

    return {
      summary,
      duration_minutes: durationMinutes,
      steps,
    };
  } catch (err) {
    console.error('[Directions] Error fetching transit directions:', err.response?.data || err.message);
    return null;
  }
}

// Google Directions API (driving) を使って車での移動情報を取得
async function getDrivingDirections(origin, destination) {
  if (!API_KEY) return null;
  if (!origin || !destination || origin.lat == null || origin.lng == null || destination.lat == null || destination.lng == null) {
    return null;
  }

  try {
    const params = new URLSearchParams({
      origin: `${origin.lat},${origin.lng}`,
      destination: `${destination.lat},${destination.lng}`,
      mode: 'driving',
      language: 'ja',
      key: API_KEY,
      departure_time: 'now', // リアルタイム交通情報を考慮
      traffic_model: 'best_guess'
    });

    const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
    const res = await axios.get(url);

    if (!res.data || res.data.status !== 'OK' || !res.data.routes || res.data.routes.length === 0) {
      console.warn('[Directions] No driving route found', res.data && res.data.status);
      return null;
    }

    const route = res.data.routes[0];
    const leg = route.legs && route.legs[0];
    if (!leg) return null;

    // 距離と時間を取得
    const distanceMeters = leg.distance?.value || 0;
    const durationSeconds = leg.duration?.value || 0;
    const durationInTrafficSeconds = leg.duration_in_traffic?.value || durationSeconds;

    return {
      distance_meters: distanceMeters,
      distance_km: (distanceMeters / 1000).toFixed(1),
      distance_text: leg.distance?.text || '',
      duration_minutes: Math.ceil(durationSeconds / 60),
      duration_text: leg.duration?.text || '',
      duration_in_traffic_minutes: Math.ceil(durationInTrafficSeconds / 60),
      duration_in_traffic_text: leg.duration_in_traffic?.text || '',
      start_address: leg.start_address || '',
      end_address: leg.end_address || ''
    };
  } catch (err) {
    console.error('[Directions] Error fetching driving directions:', err.response?.data || err.message);
    return null;
  }
}

module.exports = {
  getTransitDirections,
  getDrivingDirections,
};
