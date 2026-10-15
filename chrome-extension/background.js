// 周辺相場マップ 取り込みボタン(公開版用。https://hujihisahousing.github.io/market-app/ にだけ取り込む)
// ツールバーのボタンを押すと、いま開いている物件ページの文章を読み、開いている「周辺相場マップ」(index.html)に追加する。
// - 一覧ページで物件をドラッグして選んでから押すと、選んだ範囲の物件を1件ずつ、まとめて追加する。
//   何も選んでいない(または、ほぼページ全体を選んでいる)ときは、そのページの1件を追加する。
// - 読むのは、ボタンを押したそのページだけ(activeTab)。自動でほかのページを巡ったり、外部へ送信したりはしない。
// - 追加は、アプリが用意している window.marketAppImport(文章, URL, モード, 物件URL一覧) を呼ぶだけ。

var DEFAULT_APP_URL = "https://hujihisahousing.github.io/market-app/"; // 公開版のアプリ
var APP_ORIGIN = "https://hujihisahousing.github.io/market-app/"; // この住所のページだけを、取り込み先として探す

// 目印: ボタンに、いつも青い「相」を出す
function restBadge() {
  chrome.action.setBadgeBackgroundColor({ color: "#1565c0" });
  chrome.action.setBadgeText({ text: "相" });
}
restBadge();
chrome.runtime.onInstalled.addListener(restBadge);
chrome.runtime.onStartup.addListener(restBadge);

function flash(text, color) {
  chrome.action.setBadgeBackgroundColor({ color: color || "#c0392b" });
  chrome.action.setBadgeText({ text: text });
  setTimeout(restBadge, 3500);
}

// 失敗の理由は、ボタンを押したページに表示する(気づけるように)
function tellUser(tabId, message) {
  flash("×");
  if (!tabId) return;
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: "MAIN",
    func: function (m) { alert("周辺相場マップ 取り込みボタン\n\n" + m); },
    args: [message]
  }).catch(function () {});
}

async function findAppTab() {
  var tabs = await chrome.tabs.query({});
  for (var i = 0; i < tabs.length; i++) {
    var u = tabs[i].url || "";
    if (u.indexOf(APP_ORIGIN) === 0) return tabs[i];
  }
  return null;
}

async function waitLoaded(tabId) {
  for (var i = 0; i < 40; i++) {
    var t = await chrome.tabs.get(tabId);
    if (t.status === "complete") break;
    await new Promise(function (r) { setTimeout(r, 250); });
  }
  await new Promise(function (r) { setTimeout(r, 800); }); // アプリの初期化を待つ
}

// ボタンを押したページで実行される(ページの中で動く)。選択範囲があればその文章と、含まれる物件ページのURLを返す
function readPage() {
  var full = document.body.innerText || "";
  var sel = "";
  var links = [];
  try {
    var s = window.getSelection();
    sel = s ? String(s) : "";
    if (sel.trim().length > 30 && sel.length < full.length * 0.7) {
      var seen = {};
      for (var r = 0; r < s.rangeCount; r++) {
        var frag = s.getRangeAt(r).cloneContents();
        frag.querySelectorAll("a[href]").forEach(function (a) {
          var h = a.href || "";
          if (/\/(?:nc_\d+|b-\d+)\/?/.test(h) && !/inquire|toiawase|request/.test(h)) {
            var u = h.split("?")[0].split("#")[0];
            if (!seen[u]) { seen[u] = true; links.push(u); }
          }
        });
      }
      return { text: sel, mode: "selection", links: links };
    }
  } catch (e) {}
  // 何も選んでいないとき: ページ全体の文章と、ページ内の物件ページのURL(順番どおり)
  var pageLinks = [], seen2 = {};
  try {
    var as = document.querySelectorAll("a[href]");
    for (var i = 0; i < as.length && i < 3000; i++) {
      var h2 = as[i].href || "";
      if (/\/(?:nc_\d+|b-\d+)\/?/.test(h2) && !/inquire|toiawase|request/.test(h2)) {
        var u2 = h2.split("?")[0].split("#")[0];
        if (!seen2[u2]) { seen2[u2] = true; pageLinks.push(u2); }
      }
    }
  } catch (e) {}
  return { text: full, mode: "page", links: pageLinks };
}

chrome.action.onClicked.addListener(async function (tab) {
  try {
    if (!tab || !tab.id || !/^https?:/.test(tab.url || "")) {
      flash("!");
      return;
    }

    // 押したことが分かるよう、すぐにボタンに「…」(処理中)を出す。終わると、✓ などに変わる
    chrome.action.setBadgeBackgroundColor({ color: "#ef6c00" });
    chrome.action.setBadgeText({ text: "…" });

    // 1) ボタンを押したページの文章を読む(選択範囲があれば、その範囲だけ)
    var read = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
    var page = read && read[0] && read[0].result;
    if (!page || !page.text) { tellUser(tab.id, "このページの文章を読み取れませんでした。"); return; }

    // 2) 開いている「周辺相場マップ」のタブを探す(無ければ、前回のアドレスで開く)
    var app = await findAppTab();
    if (!app) {
      var saved = await chrome.storage.local.get("appUrl");
      var url = saved.appUrl || DEFAULT_APP_URL;
      try {
        app = await chrome.tabs.create({ url: url, active: false });
        await waitLoaded(app.id);
      } catch (e) {
        app = null;
      }
    }
    if (!app) {
      tellUser(tab.id, "「周辺相場マップ」(index.html)が開かれていません。先にChromeで開いてから、もう一度押してください。");
      return;
    }
    await chrome.storage.local.set({ appUrl: app.url });

    // 3) アプリに追加させる
    var out;
    try {
      out = await chrome.scripting.executeScript({
        target: { tabId: app.id },
        world: "MAIN",
        func: function (t, u, m, l) { return window.marketAppImport ? window.marketAppImport(t, u, m, l) : "noapp"; },
        args: [page.text, tab.url, page.mode, page.links]
      });
    } catch (e) {
      tellUser(tab.id, "「周辺相場マップ」のタブに書き込めません。\n「周辺相場マップ」のタブを開き直して(F5キー)、もう一度押してください。");
      return;
    }
    var result = out && out[0] && out[0].result;
    // 取り込めたら、B案のアプリ(「物件データ」の画面)のタブを前に出して、入った行を見せる
    function showApp() {
      try {
        chrome.tabs.update(app.id, { active: true });
        chrome.windows.update(app.windowId, { focused: true });
      } catch (e) {}
    }
    if (typeof result === "number" && result > 0) {
      flash(result > 1 ? "✓" + result : "✓", "#2e7d32");
      showApp();
    } else if (result === 0) {
      flash("既", "#757575"); // 読み取った物件は、すべて追加済みだった(入っている行を見せる)
      showApp();
    } else if (result === true) {
      flash("✓", "#2e7d32");
      showApp();
    } else if (result === "noapp") {
      tellUser(tab.id, "開いているアプリが古い版です。「周辺相場マップ」のタブを開き直してください(Ctrl+Shift+R)。");
    } else if (typeof result === "string") {
      tellUser(tab.id, result);
    } else {
      // 数でも文字でもない結果(国交省の「検討地に近い3件」など、時間のかかる取り込みの結果)。追加は進んでいるので、アプリを前に出す
      flash("✓", "#2e7d32");
      showApp();
    }
  } catch (e) {
    flash("×");
    console.error(e);
  }
});
