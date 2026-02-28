const fs = require('fs');

const CONFIG = {
  TARGET_ACCOUNT:   process.env.TARGET_ACCOUNT || 'L_ThinkTank',
  BOT_TOKEN:        process.env.BOT_TOKEN,
  CHAT_ID:          process.env.CHAT_ID,
  POLL_INTERVAL_MS: 60000,

  // Instances Nitter publiques (on essaie dans l'ordre)
  NITTER_INSTANCES: [
    'https://nitter.privacydev.net',
    'https://nitter.poast.org',
    'https://nitter.lucahammer.com',
    'https://nitter.1d4.us',
  ],
};

const TARGET_EMOJIS = [
  '\u203C\uFE0F', // ‼️
  '\u203C',       // ‼
  '\u2757\uFE0F', // ❗️
  '\u2757',       // ❗
  '\u2755',       // ❕
];

function containsTargetEmoji(text) {
  return TARGET_EMOJIS.some(function(e) { return text.includes(e); });
}

async function sendTelegram(tweetText, tweetUrl) {
  var message =
    '🚨 @' + CONFIG.TARGET_ACCOUNT + ' vient de poster :\n\n' +
    tweetText + '\n\n' +
    '👉 ' + tweetUrl;

  var res = await fetch('https://api.telegram.org/bot' + CONFIG.BOT_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CONFIG.CHAT_ID, text: message }),
  });

  var data = await res.json();
  if (data.ok) {
    console.log('✅ Message Telegram envoyé !');
  } else {
    console.error('❌ Erreur Telegram :', data.description);
  }
}

// Parse le RSS Nitter manuellement (sans librairie)
function parseRSS(xml) {
  var items = [];
  var itemRegex = /<item>([\s\S]*?)<\/item>/g;
  var match;

  while ((match = itemRegex.exec(xml)) !== null) {
    var block = match[1];

    var titleMatch = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/);
    var linkMatch  = block.match(/<link>([\s\S]*?)<\/link>/);
    var guidMatch  = block.match(/<guid>([\s\S]*?)<\/guid>/);

    var title = titleMatch ? titleMatch[1].trim() : '';
    var link  = linkMatch  ? linkMatch[1].trim()  : '';
    var guid  = guidMatch  ? guidMatch[1].trim()  : link;

    // Extraire l'ID depuis l'URL
    var idMatch = guid.match(/\/status\/(\d+)/);
    var id = idMatch ? idMatch[1] : guid;

    if (title && id) {
      items.push({ id: id, text: title, url: 'https://twitter.com' + (idMatch ? idMatch[0].replace('/status/', '/' + CONFIG.TARGET_ACCOUNT + '/status/') : '') });
    }
  }

  return items;
}

async function fetchRSS() {
  for (var i = 0; i < CONFIG.NITTER_INSTANCES.length; i++) {
    var instance = CONFIG.NITTER_INSTANCES[i];
    var url = instance + '/' + CONFIG.TARGET_ACCOUNT + '/rss';

    try {
      console.log('   Essai: ' + instance);
      var res = await fetch(url, { signal: AbortSignal.timeout(8000) });

      if (!res.ok) {
        console.log('   ❌ Status: ' + res.status);
        continue;
      }

      var xml = await res.text();

      if (!xml.includes('<item>')) {
        console.log('   ❌ Pas de tweets dans le flux');
        continue;
      }

      var tweets = parseRSS(xml);
      console.log('   ✅ ' + tweets.length + ' tweets récupérés depuis ' + instance);
      return tweets;

    } catch (err) {
      console.log('   ❌ Erreur: ' + err.message);
    }
  }

  console.log('⚠️  Toutes les instances Nitter ont échoué');
  return [];
}

var SEEN_FILE = './seen.json';

function loadSeen() {
  try { return JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')); }
  catch (e) { return []; }
}

function saveSeen(ids) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify(ids.slice(-200)));
}

async function main() {
  if (!CONFIG.BOT_TOKEN) { console.error('❌ BOT_TOKEN manquant'); process.exit(1); }
  if (!CONFIG.CHAT_ID)   { console.error('❌ CHAT_ID manquant');   process.exit(1); }

  console.log('🚀 Démarrage...');
  console.log('👁  Surveillance de @' + CONFIG.TARGET_ACCOUNT);
  console.log('⏱  Vérification toutes les ' + CONFIG.POLL_INTERVAL_MS / 1000 + 's');
  console.log('📡 Via Nitter RSS (pas de scraping)\n');

  var seenIds = loadSeen();

  async function poll() {
    console.log('🔍 [' + new Date().toLocaleTimeString() + '] Vérification...');

    var tweets = await fetchRSS();

    if (tweets.length === 0) {
      console.log('');
      return;
    }

    var newTweets = tweets.filter(function(t) { return t.id && !seenIds.includes(t.id); });
    console.log('   ' + newTweets.length + ' nouveau(x) tweet(s)');

    for (var i = 0; i < newTweets.length; i++) {
      var tweet = newTweets[i];
      console.log('   📝 "' + tweet.text.slice(0, 80) + '"');

      if (containsTargetEmoji(tweet.text)) {
        console.log('🎯 Emoji détecté ! Envoi Telegram...');
        await sendTelegram(tweet.text, tweet.url);
      }

      seenIds.push(tweet.id);
    }

    saveSeen(seenIds);
    console.log('');
  }

  await poll();
  setInterval(poll, CONFIG.POLL_INTERVAL_MS);

  process.on('SIGINT', function() { process.exit(0); });
}

main().catch(function(err) {
  console.error('💥 Erreur fatale :', err);
  process.exit(1);
});