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

  // A8.netのトラッキングリンク経由でRetty検索ページへ
  return `https://px.a8.net/svt/ejp?a8mat=${a8mat}`;
}

/**
 * 一休レストランアフィリエイトリンク生成
 */
function generateIkkyuLink(restaurantName, area) {
  const a8mat = AFFILIATE_IDS.ikyu;

  // A8.netのトラッキングリンク経由で一休検索ページへ
  return `https://px.a8.net/svt/ejp?a8mat=${a8mat}`;
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
