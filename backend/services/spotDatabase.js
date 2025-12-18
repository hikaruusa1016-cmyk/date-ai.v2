/**
 * スポットデータベース管理モジュール
 *
 * 手動で作成したCSVデータベースを読み込み、検索機能を提供します。
 * Places APIのフォールバック、または優先データソースとして使用できます。
 */

const fs = require('fs');
const path = require('path');

class SpotDatabase {
  constructor(csvPath) {
    this.spots = [];
    this.csvPath = csvPath || path.join(__dirname, '../../スポットデータベース - Sheet1_v1.csv');
    this.loaded = false;
  }

  /**
   * CSVファイルを読み込む
   */
  load() {
    try {
      if (!fs.existsSync(this.csvPath)) {
        console.warn(`[SpotDB] CSV file not found: ${this.csvPath}`);
        return false;
      }

      const csvContent = fs.readFileSync(this.csvPath, 'utf-8');
      const lines = csvContent.split('\n');

      // ヘッダー行をパース
      const headers = this.parseCSVLine(lines[0]);

      // データ行をパース
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = this.parseCSVLine(line);
        const spot = {};

        headers.forEach((header, index) => {
          spot[header] = values[index] || '';
        });

        // データ型変換
        spot.lat = spot.lat ? parseFloat(spot.lat) : null;
        spot.lng = spot.lng ? parseFloat(spot.lng) : null;
        spot.stay_minutes = spot.stay_minutes ? parseInt(spot.stay_minutes) : 60;
        spot.weather_ok = spot.weather_ok === 'TRUE' || spot.weather_ok === 'true';

        // 配列フィールドをパース
        spot.interest_tags = this.parseArray(spot.interest_tags);
        spot.recommended_for = this.parseArray(spot.recommended_for);
        spot.best_time_slot = this.parseArray(spot.best_time_slot);

        this.spots.push(spot);
      }

      this.loaded = true;
      console.log(`[SpotDB] Loaded ${this.spots.length} spots from database`);
      return true;

    } catch (error) {
      console.error('[SpotDB] Error loading CSV:', error);
      return false;
    }
  }

  /**
   * CSV行をパース（カンマ区切り、ダブルクォート対応）
   */
  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  }

  /**
   * パイプまたはカンマ区切りの文字列を配列にパース
   */
  parseArray(str) {
    if (!str) return [];

    // パイプ区切りを優先
    if (str.includes('|')) {
      return str.split('|').map(s => s.trim()).filter(s => s);
    }

    // カンマ区切り
    return str.split(',').map(s => s.trim()).filter(s => s);
  }

  /**
   * エリアでフィルタリング
   */
  filterByArea(areaId) {
    return this.spots.filter(spot => spot.area_id === areaId);
  }

  /**
   * カテゴリでフィルタリング
   */
  filterByCategory(category) {
    return this.spots.filter(spot => spot.category === category);
  }

  /**
   * 興味タグでフィルタリング（部分一致）
   */
  filterByInterests(interests) {
    if (!interests || interests.length === 0) return this.spots;

    return this.spots.filter(spot => {
      return interests.some(interest =>
        spot.interest_tags.includes(interest)
      );
    });
  }

  /**
   * 予算レベルでフィルタリング
   */
  filterByBudget(budgetLevel) {
    const normalized = this.normalizeBudgetLevel(budgetLevel);
    return this.spots.filter(spot => {
      const spotBudget = this.normalizeBudgetLevel(spot.budget_level);
      return spotBudget === normalized;
    });
  }

  /**
   * 予算レベルを正規化（mid → medium など）
   */
  normalizeBudgetLevel(level) {
    const normalized = level.toLowerCase();
    if (normalized === 'mid' || normalized === 'middle' || normalized === '中') {
      return 'medium';
    }
    if (normalized === 'free') return 'low';
    return normalized;
  }

  /**
   * デート段階でフィルタリング
   */
  filterByDatePhase(phase) {
    return this.spots.filter(spot => {
      return spot.recommended_for.includes(phase) || spot.recommended_for.includes('all');
    });
  }

  /**
   * 時間帯でフィルタリング
   */
  filterByTimeSlot(timeSlot) {
    return this.spots.filter(spot => {
      return spot.best_time_slot.includes(timeSlot) || spot.best_time_slot.includes('anytime');
    });
  }

  /**
   * 天候でフィルタリング
   */
  filterByWeather(needsWeatherProof = false) {
    if (!needsWeatherProof) return this.spots;
    return this.spots.filter(spot => spot.weather_ok === true);
  }

  /**
   * 複合条件で検索
   */
  search(conditions) {
    let results = [...this.spots];

    // エリアフィルタ
    if (conditions.area) {
      results = results.filter(spot => spot.area_id === conditions.area);
    }

    // カテゴリフィルタ
    if (conditions.category) {
      results = results.filter(spot => spot.category === conditions.category);
    }

    // 興味タグフィルタ
    if (conditions.interests && conditions.interests.length > 0) {
      results = results.filter(spot => {
        return conditions.interests.some(interest =>
          spot.interest_tags.includes(interest)
        );
      });
    }

    // 予算レベルフィルタ
    if (conditions.budget) {
      const normalized = this.normalizeBudgetLevel(conditions.budget);
      results = results.filter(spot => {
        const spotBudget = this.normalizeBudgetLevel(spot.budget_level);
        return spotBudget === normalized;
      });
    }

    // デート段階フィルタ
    if (conditions.datePhase) {
      results = results.filter(spot => {
        return spot.recommended_for.includes(conditions.datePhase) ||
               spot.recommended_for.includes('all');
      });
    }

    // 時間帯フィルタ
    if (conditions.timeSlot) {
      results = results.filter(spot => {
        return spot.best_time_slot.includes(conditions.timeSlot) ||
               spot.best_time_slot.includes('anytime');
      });
    }

    // 天候フィルタ
    if (conditions.weatherProof) {
      results = results.filter(spot => spot.weather_ok === true);
    }

    // ムードフィルタ
    if (conditions.mood) {
      results = results.filter(spot => {
        // mood_tagsに指定されたムードが含まれているかチェック
        return spot.mood_tags && spot.mood_tags.toLowerCase().includes(conditions.mood.toLowerCase());
      });
    }

    // NG条件フィルタ
    if (conditions.ngConditions && conditions.ngConditions.length > 0) {
      results = results.filter(spot => {
        for (const ng of conditions.ngConditions) {
          // outdoor: 屋外を避ける → indoor_outdoorが'outdoor'のスポットを除外
          if (ng === 'outdoor' && spot.indoor_outdoor === 'outdoor') return false;
          // indoor: 屋内のみを避ける → indoor_outdoorが'indoor'のスポットを除外
          if (ng === 'indoor' && spot.indoor_outdoor === 'indoor') return false;
          // crowd: 混雑を避ける → mood_tagsに'賑やか'が含まれるスポットを除外
          if (ng === 'crowd' && spot.mood_tags && spot.mood_tags.includes('賑やか')) return false;
          // quiet: 静かすぎる場所を避ける → mood_tagsに'静か'が含まれるスポットを除外
          if (ng === 'quiet' && spot.mood_tags && spot.mood_tags.includes('静か')) return false;
          // walk: 長時間歩くのを避ける → stay_minutesが大きいスポットを除外（例：120分以上）
          if (ng === 'walk' && spot.stay_minutes > 120) return false;
          // rain: 雨天不可を避ける → weather_okがfalseのスポットを除外
          if (ng === 'rain' && !spot.weather_ok) return false;
        }
        return true;
      });
    }

    // 座標があるもの優先
    if (conditions.requireCoordinates) {
      results = results.filter(spot => spot.lat && spot.lng);
    }

    // 除外スポットフィルタ
    if (conditions.excludeSpots && conditions.excludeSpots.length > 0) {
      results = results.filter(spot => !conditions.excludeSpots.includes(spot.spot_name));
    }

    return results;
  }

  /**
   * ランダムに1件取得
   */
  getRandomSpot(conditions = {}) {
    const results = this.search(conditions);
    if (results.length === 0) return null;

    const randomIndex = Math.floor(Math.random() * results.length);
    return results[randomIndex];
  }

  /**
   * ランダムにN件取得
   */
  getRandomSpots(n, conditions = {}) {
    const results = this.search(conditions);
    if (results.length === 0) return [];

    // シャッフル
    const shuffled = [...results].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(n, shuffled.length));
  }

  /**
   * スポット情報をフォーマット（プラン生成用）
   */
  formatSpotForPlan(spot) {
    // Google Mapリンクを生成（スポット名で検索）
    const googleMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(spot.spot_name + ' ' + spot.area_name)}`;

    // short_descriptionとtipsを組み合わせてカスタマイズされたコメントを生成
    let customReason = '';
    if (spot.short_description && spot.tips) {
      customReason = `${spot.short_description} ${spot.tips}`;
    } else if (spot.short_description) {
      customReason = spot.short_description;
    } else if (spot.tips) {
      customReason = spot.tips;
    } else {
      // フォールバック：mood_tagsから生成
      customReason = `${spot.spot_name}は${spot.mood_tags}な雰囲気で楽しめます。`;
    }

    return {
      name: spot.spot_name,  // Places APIと同じ構造（lunch.name でアクセスされる）
      place_name: spot.spot_name,  // 後方互換性
      area: spot.area_name,
      lat: spot.lat,
      lng: spot.lng,
      address: spot.address,
      price_range: spot.price_range,
      duration: `${spot.stay_minutes}min`,
      reason: customReason,
      url: googleMapUrl,  // Google MapのURL（スポット名で検索）
      info_url: googleMapUrl,  // 後方互換性（Google Map）
      official_url: spot.official_url || spot.source_url,  // 公式HPのURL（別フィールドとして追加）
      tips: spot.tips,
      rating: null, // DBには評価情報がないので null
    };
  }

  /**
   * 統計情報を取得
   */
  getStats() {
    const stats = {
      total: this.spots.length,
      byArea: {},
      byCategory: {},
      byBudget: {},
      withCoordinates: 0,
      withoutCoordinates: 0,
    };

    this.spots.forEach(spot => {
      // エリア別
      stats.byArea[spot.area_id] = (stats.byArea[spot.area_id] || 0) + 1;

      // カテゴリ別
      stats.byCategory[spot.category] = (stats.byCategory[spot.category] || 0) + 1;

      // 予算別
      const budget = this.normalizeBudgetLevel(spot.budget_level);
      stats.byBudget[budget] = (stats.byBudget[budget] || 0) + 1;

      // 座標の有無
      if (spot.lat && spot.lng) {
        stats.withCoordinates++;
      } else {
        stats.withoutCoordinates++;
      }
    });

    return stats;
  }
}

// シングルトンインスタンス
let instance = null;

/**
 * SpotDatabaseのシングルトンインスタンスを取得
 */
function getSpotDatabase() {
  if (!instance) {
    instance = new SpotDatabase();
    instance.load();
  }
  return instance;
}

module.exports = {
  SpotDatabase,
  getSpotDatabase,
};
