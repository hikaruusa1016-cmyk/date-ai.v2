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
    // エリア名を日本語で表示用に変換
    const areaNameMap = {
      'shibuya': '渋谷',
      'shinjuku': '新宿',
      'ginza': '銀座',
      'omotesando': '表参道',
      'ebisu': '恵比寿',
      'roppongi': '六本木',
      'ueno': '上野',
      'asakusa': '浅草',
      'ikebukuro': '池袋',
      'harajuku': '原宿',
      'odaiba': 'お台場',
    };
    const areaDisplayName = areaNameMap[area] || area;

    links.push({
      platform: '一休',
      url: generateIkkyuLink(restaurantName, area, address),
      icon: '💎',
      displayName: `一休(${areaDisplayName}エリア)`
    });
  }

  return links;
}

/**
 * Rettyアフィリエイトリンク生成
 * 店舗名で検索結果ページに飛ばす
 */
function generateRettyLink(restaurantName, area, address = null) {
  const a8mat = AFFILIATE_IDS.retty;

  // 検索クエリ構築：店舗名（正確な店舗名で検索）
  let searchQuery;
  if (address) {
    // 住所から区/市までを抽出
    const cityMatch = address.match(/[都道府県](.+?[区市町村])/);
    const cityPart = cityMatch ? cityMatch[1] : '';
    // 店舗名 + 区/市名で検索（例: "日本橋 すし処 二ノ宮 上野店 台東区"）
    searchQuery = cityPart ? `${restaurantName} ${cityPart}` : restaurantName;
  } else {
    searchQuery = restaurantName;
  }

  // Rettyの検索URL
  const rettySearchUrl = `https://retty.me/search/?keyword=${encodeURIComponent(searchQuery)}`;

  // A8.netのトラッキングリンク + リダイレクト先URL
  return `https://px.a8.net/svt/ejp?a8mat=${a8mat}&a8ejpredirect=${encodeURIComponent(rettySearchUrl)}`;
}

/**
 * 一休レストランアフィリエイトリンク生成
 * 店舗名で検索結果ページに飛ばす
 */
function generateIkkyuLink(restaurantName, area, address = null) {
  const a8mat = AFFILIATE_IDS.ikyu;

  // エリアコード変換（一休用） - 東京23区のエリアコード
  const areaCodeMap = {
    'shibuya': 'Y055',    // 渋谷・恵比寿・代官山エリア
    'shinjuku': 'Y010',   // 新宿エリア
    'ginza': 'Y020',      // 銀座・有楽町・築地エリア
    'omotesando': 'Y050', // 青山・表参道エリア
    'ebisu': 'Y055',      // 渋谷・恵比寿・代官山エリア
    'roppongi': 'Y040',   // 六本木・麻布エリア
    'ueno': 'Y100',       // 上野・浅草・日暮里エリア
    'asakusa': 'Y100',    // 上野・浅草・日暮里エリア
    'ikebukuro': 'Y140',  // 池袋エリア
    'harajuku': 'Y050',   // 青山・表参道エリア
    'odaiba': 'Y190',     // お台場エリア
    '渋谷': 'Y055',
    '新宿': 'Y010',
    '銀座': 'Y020',
    '表参道': 'Y050',
    '恵比寿': 'Y055',
    '六本木': 'Y040',
    '上野': 'Y100',
    '浅草': 'Y100',
    '池袋': 'Y140',
    '原宿': 'Y050',
    'お台場': 'Y190',
  };

  const areaCode = areaCodeMap[area] || 'Y010'; // デフォルト: 新宿

  // 一休の検索URL（店舗名 + エリアコードで検索）
  const ikkyuSearchUrl = `https://restaurant.ikyu.com/search/?area=${areaCode}&keyword=${encodeURIComponent(restaurantName)}`;

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
