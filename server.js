const fs = require('fs');

const CONFIG = {
  TARGET_ACCOUNT:   process.env.TARGET_ACCOUNT || 'L_ThinkTank',
  BOT_TOKEN:        process.env.BOT_TOKEN,
  CHAT_ID:          process.env.CHAT_ID,
  POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS) || 60000,

  // Cookies Twitter de ton compte
  AUTH_TOKEN: process.env.AUTH_TOKEN,
  CT0:        process.env.CT0,
  TWID:       process.env.TWID,
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

async function fetchTweets() {
  var userId = CONFIG.TWID.replace('u%3D', '').replace('u=', '');

  var variables = JSON.stringify({
    userId: userId,
    count: 10,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: false,
    withVoice: false,
    withV2Timeline: true,
  });

  var features = JSON.stringify({
    rweb_lists_timeline_redesign_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    tweetypie_unmention_optimization_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    longform_notetweets_rich_text_read_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  });

  var url = 'https://twitter.com/i/api/graphql/V7H0Ap3_Hh2FyS75OCDO3Q/UserTweets' +
    '?variables=' + encodeURIComponent(variables) +
    '&features=' + encodeURIComponent(features);

  var cookieStr =
    'auth_token=' + CONFIG.AUTH_TOKEN + '; ' +
    'ct0=' + CONFIG.CT0 + '; ' +
    'twid=' + CONFIG.TWID;

  try {
    var res = await fetch(url, {
      headers: {
        'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
        'Cookie': cookieStr,
        'x-csrf-token': CONFIG.CT0,
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-client-language': 'fr',
        'x-twitter-active-user': 'yes',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://twitter.com/',
        'Accept': '*/*',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.log('   ❌ Status HTTP: ' + res.status);
      return [];
    }

    var data = await res.json();

    // Extraire les tweets du JSON GraphQL
    var tweets = [];
    try {
      var instructions = data.data.user.result.timeline_v2.timeline.instructions;
      for (var i = 0; i < instructions.length; i++) {
        var entries = instructions[i].entries || [];
        for (var j = 0; j < entries.length; j++) {
          var entry = entries[j];
          try {
            var result = entry.content.itemContent.tweet_results.result;
            var legacy = result.tweet ? result.tweet.legacy : result.legacy;
            if (legacy && legacy.full_text) {
              var id = legacy.id_str;
              tweets.push({
                id: id,
                text: legacy.full_text,
                url: 'https://twitter.com/' + CONFIG.TARGET_ACCOUNT + '/status/' + id,
              });
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      console.log('   ❌ Erreur parsing JSON: ' + e.message);
    }

    return tweets;

  } catch (err) {
    console.error('   ❌ Erreur fetch: ' + err.message);
    return [];
  }
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
  if (!CONFIG.BOT_TOKEN)   { console.error('❌ BOT_TOKEN manquant');   process.exit(1); }
  if (!CONFIG.CHAT_ID)     { console.error('❌ CHAT_ID manquant');     process.exit(1); }
  if (!CONFIG.AUTH_TOKEN)  { console.error('❌ AUTH_TOKEN manquant');  process.exit(1); }
  if (!CONFIG.CT0)         { console.error('❌ CT0 manquant');         process.exit(1); }
  if (!CONFIG.TWID)        { console.error('❌ TWID manquant');        process.exit(1); }

  console.log('🚀 Démarrage...');
  console.log('👁  Surveillance de @' + CONFIG.TARGET_ACCOUNT);
  console.log('⏱  Vérification toutes les ' + CONFIG.POLL_INTERVAL_MS / 1000 + 's');
  console.log('🔑 Via API Twitter avec cookies\n');

  var seenIds = loadSeen();

  async function poll() {
    console.log('🔍 [' + new Date().toLocaleTimeString() + '] Vérification...');

    var tweets = await fetchTweets();

    if (tweets.length === 0) {
      console.log('   Aucun tweet récupéré\n');
      return;
    }

    var newTweets = tweets.filter(function(t) { return t.id && !seenIds.includes(t.id); });
    console.log('   ' + newTweets.length + ' nouveau(x) tweet(s)');

    for (var i = 0; i < newTweets.length; i++) {
      var tweet = newTweets[i];

      // Ignorer les retweets
      if (tweet.text.startsWith('RT @')) {
        seenIds.push(tweet.id);
        continue;
      }

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