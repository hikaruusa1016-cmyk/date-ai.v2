// アフィリエイトリンク生成サービス

// A8.netアフィリエイトID
const AFFILIATE_IDS = {
  retty: '45KFSS+DQRA0Y+4EI4+BWVTE',
  ikyu: '45KFSS+CZDC76+1OK+ODHIA',
};

/**
 * レストラン予約用のアフィリエイトリンクを生成
 * @param {string} restaurantName - レストラン名
 * @param {string} area - エリア（渋谷、新宿など）
 * @param {string} budget - 予算レベル (low/medium/high)
 * @returns {Array} アフィリエイトリンクの配列
 */
function generateRestaurantAffiliateLinks(restaurantName, area, budget) {
  const links = [];

  // Retty（全予算レベル対応）
  links.push({
    platform: 'Retty',
    url: generateRettyLink(restaurantName, area),
    icon: '🍴',
    displayName: 'Rettyで探す'
  });

  // 一休レストラン（medium/high のみ）
  if (budget === 'medium' || budget === 'high') {
    links.push({
      platform: '一休',
      url: generateIkkyuLink(restaurantName, area),
      icon: '💎',
      displayName: '一休で予約'
    });
  }

  return links;
}

/**
 * Rettyアフィリエイトリンク生成
 */
function generateRettyLink(restaurantName, area) {
  const a8mat = AFFILIATE_IDS.retty;

  // レストラン名とエリアで検索
  const searchQuery = encodeURIComponent(`${restaurantName} ${area}`);
  const rettySearchUrl = `https://retty.me/area/PRE13/search/?keyword=${searchQuery}`;

  // A8.netのトラッキングリンク + リダイレクト先URL
  return `https://px.a8.net/svt/ejp?a8mat=${a8mat}&a8ejpredirect=${encodeURIComponent(rettySearchUrl)}`;
}

/**
 * 一休レストランアフィリエイトリンク生成
 */
function generateIkkyuLink(restaurantName, area) {
  const a8mat = AFFILIATE_IDS.ikyu;

  // エリアコード変換（一休用）
  const areaCodeMap = {
    'shibuya': 'Y055',
    'shinjuku': 'Y010',
    'ginza': 'Y020',
    'omotesando': 'Y055',
    'ebisu': 'Y055',
    'roppongi': 'Y040',
    '渋谷': 'Y055',
    '新宿': 'Y010',
    '銀座': 'Y020',
    '表参道': 'Y055',
    '恵比寿': 'Y055',
    '六本木': 'Y040',
  };

  const areaCode = areaCodeMap[area] || 'Y055'; // デフォルト: 渋谷
  const searchQuery = encodeURIComponent(restaurantName);
  const ikkyuSearchUrl = `https://restaurant.ikyu.com/search/?area=${areaCode}&keyword=${searchQuery}`;

  // A8.netのトラッキングリンク + リダイレクト先URL
  return `https://px.a8.net/svt/ejp?a8mat=${a8mat}&a8ejpredirect=${encodeURIComponent(ikkyuSearchUrl)}`;
}

/**
 * アフィリエイト用のトラッキングピクセル取得
 */
function getTrackingPixel(platform) {
  const pixels = {
    retty: 'https://www15.a8.net/0.gif?a8mat=45KFSS+DQRA0Y+4EI4+BWVTE',
    ikyu: 'https://www10.a8.net/0.gif?a8mat=45KFSS+CZDC76+1OK+ODHIA',
  };

  return pixels[platform] || null;
}

module.exports = {
  generateRestaurantAffiliateLinks,
  getTrackingPixel,
};
