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
 * @param {string} address - 店舗の住所（オプション）
 * @returns {Array} アフィリエイトリンクの配列
 */
function generateRestaurantAffiliateLinks(restaurantName, area, budget, address = null) {
  const links = [];

  // Retty（全予算レベル対応）
  links.push({
    platform: 'Retty',
    url: generateRettyLink(restaurantName, area, address),
    icon: '🍴',
    displayName: 'Rettyで探す'
  });

  // 一休レストラン（medium/high のみ）
  if (budget === 'medium' || budget === 'high') {
    links.push({
      platform: '一休',
      url: generateIkkyuLink(restaurantName, area, address),
      icon: '💎',
      displayName: '一休で予約'
    });
  }

  return links;
}

/**
 * Rettyアフィリエイトリンク生成
 * 住所情報がある場合は、より詳細な検索クエリを使用
 */
function generateRettyLink(restaurantName, area, address = null) {
  const a8mat = AFFILIATE_IDS.retty;

  // 検索クエリ構築：住所があればそれを含める
  let searchQuery;
  if (address) {
    // 住所から不要な情報を削除（日本、郵便番号など）
    const cleanAddress = address.replace(/^日本、〒?\d{3}-?\d{4}\s*/, '').replace(/^日本、/, '');
    searchQuery = encodeURIComponent(`${restaurantName} ${cleanAddress}`);
  } else {
    searchQuery = encodeURIComponent(`${restaurantName} ${area}`);
  }

  const rettySearchUrl = `https://retty.me/area/PRE13/search/?keyword=${searchQuery}`;

  // A8.netのトラッキングリンク + リダイレクト先URL
  return `https://px.a8.net/svt/ejp?a8mat=${a8mat}&a8ejpredirect=${encodeURIComponent(rettySearchUrl)}`;
}

/**
 * 一休レストランアフィリエイトリンク生成
 * 住所情報を含めてより精度の高い検索を実現
 */
function generateIkkyuLink(restaurantName, area, address = null) {
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

  // 検索クエリ構築：住所があれば店舗名+住所の一部で検索
  let searchQuery;
  if (address) {
    // 住所から区/市までを抽出（例：「東京都渋谷区道玄坂...」→「渋谷区」）
    const cityMatch = address.match(/[都道府県](.+?[区市町村])/);
    const cityPart = cityMatch ? cityMatch[1] : '';
    searchQuery = encodeURIComponent(`${restaurantName} ${cityPart}`);
  } else {
    searchQuery = encodeURIComponent(restaurantName);
  }

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
