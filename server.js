const { chromium } = require('playwright');
const fs = require('fs');

const CONFIG = {
  TARGET_ACCOUNT: process.env.TARGET_ACCOUNT || 'L_ThinkTank',
  BOT_TOKEN:      process.env.BOT_TOKEN,
  CHAT_ID:        process.env.CHAT_ID,
  POLL_INTERVAL_MS: 60000,
};

const TARGET_EMOJIS = ['‼️', '❗️', '❗'];

function containsTargetEmoji(text) {
  return TARGET_EMOJIS.some(function(e) { return text.includes(e); });
}

async function sendTelegram(tweetText, tweetUrl) {
  var message =
    '🚨 @' + CONFIG.TARGET_ACCOUNT + ' vient de poster :\n\n' +
    tweetText + '\n\n' +
    '👉 ' + tweetUrl;

  var url = 'https://api.telegram.org/bot' + CONFIG.BOT_TOKEN + '/sendMessage';

  var res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CONFIG.CHAT_ID,
      text: message,
    }),
  });

  var data = await res.json();

  if (data.ok) {
    console.log('✅ Message Telegram envoyé !');
  } else {
    console.error('❌ Erreur Telegram :', data.description);
  }
}

async function scrapeTweets(browser) {
  var page = await browser.newPage();

  try {
    await page.goto('https://twitter.com/' + CONFIG.TARGET_ACCOUNT, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForSelector('[data-testid="tweet"]', { timeout: 15000 });

    var tweets = await page.evaluate(function() {
      return Array.from(document.querySelectorAll('[data-testid="tweet"]'))
        .slice(0, 10)
        .map(function(el) {
          var textEl = el.querySelector('[data-testid="tweetText"]');
          var text = textEl ? textEl.innerText : '';
          var timeEl = el.querySelector('time');
          var linkEl = timeEl ? timeEl.closest('a') : null;
          var href = linkEl ? linkEl.getAttribute('href') : '';
          var match = href.match(/\/status\/(\d+)/);
          var id = match ? match[1] : '';
          return { id: id, text: text, url: 'https://twitter.com' + href };
        });
    });

    return tweets;

  } catch (err) {
    console.error('❌ Erreur scraping :', err.message);
    return [];
  } finally {
    await page.close();
  }
}

var SEEN_FILE = './seen.json';

function loadSeen() {
  try {
    return JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveSeen(ids) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify(ids.slice(-200)));
}

async function main() {
  if (!CONFIG.BOT_TOKEN) {
    console.error('❌ Variable BOT_TOKEN manquante !');
    process.exit(1);
  }
  if (!CONFIG.CHAT_ID) {
    console.error('❌ Variable CHAT_ID manquante !');
    process.exit(1);
  }

  console.log('🚀 Démarrage...');
  console.log('👁  Surveillance de @' + CONFIG.TARGET_ACCOUNT);
  console.log('⏱  Vérification toutes les ' + CONFIG.POLL_INTERVAL_MS / 1000 + 's\n');

  var browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
  });

  var seenIds = loadSeen();

  async function poll() {
    console.log('🔍 [' + new Date().toLocaleTimeString() + '] Vérification...');

    var tweets = await scrapeTweets(browser);

    if (tweets.length === 0) {
      console.log('⚠️  Aucun tweet récupéré\n');
      return;
    }

    var newTweets = tweets.filter(function(t) {
      return t.id && !seenIds.includes(t.id);
    });

    console.log('   ' + newTweets.length + ' nouveau(x) tweet(s)');

    for (var i = 0; i < newTweets.length; i++) {
      var tweet = newTweets[i];
      if (containsTargetEmoji(tweet.text)) {
        console.log('🎯 Emoji détecté !');
        await sendTelegram(tweet.text, tweet.url);
      }
      seenIds.push(tweet.id);
    }

    saveSeen(seenIds);
    console.log('');
  }

  await poll();
  setInterval(poll, CONFIG.POLL_INTERVAL_MS);

  process.on('SIGINT', async function() {
    console.log('\n👋 Arrêt...');
    await browser.close();
    process.exit(0);
  });
}

main().catch(function(err) {
  console.error('💥 Erreur fatale :', err);
  process.exit(1);
});
