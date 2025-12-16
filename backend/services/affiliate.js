// アフィリエイトリンク生成サービス

// バリューコマースアフィリエイトID
const AFFILIATE_IDS = {
  tabelog: {
    sid: '3759694',
    pid: '892382990'
  }
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

  // 食べログ（全予算レベル対応）
  links.push({
    platform: '食べログ',
    url: generateTabelogLink(restaurantName, area, address),
    icon: '🍽️',
    displayName: '食べログで予約',
    searchHint: restaurantName  // 検索キーワードのヒント
  });

  return links;
}

/**
 * 食べログアフィリエイトリンク生成
 * バリューコマースで動的リンク生成を試みる
 */
function generateTabelogLink(restaurantName, area, address = null) {
  const { sid, pid } = AFFILIATE_IDS.tabelog;

  // 検索クエリ構築
  let searchQuery;
  if (address) {
    // 住所から区/市までを抽出
    const cityMatch = address.match(/[都道府県](.+?[区市町村])/);
    const cityPart = cityMatch ? cityMatch[1] : '';
    searchQuery = cityPart ? `${restaurantName} ${cityPart}` : restaurantName;
  } else {
    searchQuery = restaurantName;
  }

  // 食べログの検索URL
  const tabelogSearchUrl = `https://tabelog.com/rstLst/?sw=${encodeURIComponent(searchQuery)}`;

  // バリューコマースのアフィリエイトリンク（動的リンク生成を試みる）
  // 方法1: 直接リダイレクト（referralパラメータにURL指定）
  return `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=${sid}&pid=${pid}&vc_url=${encodeURIComponent(tabelogSearchUrl)}`;
}

/**
 * アフィリエイト用のトラッキングピクセル取得
 */
function getTrackingPixel(platform) {
  const { sid, pid } = AFFILIATE_IDS.tabelog;
  const pixels = {
    tabelog: `https://ad.jp.ap.valuecommerce.com/servlet/gifbanner?sid=${sid}&pid=${pid}`,
  };

  return pixels[platform] || null;
}

module.exports = {
  generateRestaurantAffiliateLinks,
  getTrackingPixel,
};
