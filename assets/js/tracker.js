/* Ghi nhận lượt truy cập ẩn danh (nguồn truy cập, thiết bị, hành trình trên trang) gửi về Apps Script.
   Không thu thập họ tên, email hay nội dung form. Không chạy khi:
   LEAD_ENDPOINT trống · trình duyệt là bot · đang xem trên máy (localhost) — trừ khi thêm ?track=1 vào địa chỉ.
   Cung cấp window.NY_TRACK = { track, flush, leadFields, leadDone } cho main.js. */
(function () {
  "use strict";

  var NOOP = {
    track: function () {},
    flush: function () {},
    leadFields: function () { return null; },
    leadDone: function () {}
  };
  window.NY_TRACK = NOOP;

  var CFG = window.NY_CONFIG || {};
  var API = String(CFG.LEAD_ENDPOINT || "").trim();
  if (!API) return;

  var nav = window.navigator || {};
  var loc = window.location;
  var qs;
  try { qs = new URLSearchParams(loc.search); } catch (e) { return; }

  if (/bot|crawl|spider|slurp|headless|lighthouse|facebookexternalhit|embedly|telegrambot|whatsapp\/|pingdom|gtmetrix/i
      .test(nav.userAgent || "")) return;

  var local = loc.protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\]|::1|0\.0\.0\.0)$/.test(loc.hostname) ||
    /\.local$/.test(loc.hostname);
  if (local) {
    if (qs.get("track") === "1") store(sessionStorage, "ny_force", "1");
    if (read(sessionStorage, "ny_force") !== "1") return;
  }

  var SESSION_IDLE = 30 * 60 * 1000;
  var JOURNEY_MAX = 30;
  var FORM_NAMES = {
    "phap-luat": "Tư vấn pháp luật",
    "suc-khoe": "Sức khỏe chủ động",
    "hoc-ai": "Học & ứng dụng AI",
    "trang-chu": "Trang chủ"
  };

  function read(st, k) { try { return st.getItem(k); } catch (e) { return null; } }
  function store(st, k, v) { try { st.setItem(k, v); } catch (e) { /* chế độ riêng tư: bỏ qua */ } }
  function rid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function clip(s, n) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, n); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function stamp(d) { return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  function pageLabel(path) {
    var p = String(path || "").replace(/index\.html$/, "");
    if (/\/tu-van-phap-luat\/?$/.test(p)) return "Tư vấn pháp luật";
    if (/\/suc-khoe-chu-dong\/?$/.test(p)) return "Sức khỏe chủ động";
    if (/\/hoc-ung-dung-ai\/?$/.test(p)) return "Học & ứng dụng AI";
    if (p === "/" || p === "") return "Trang chủ";
    return "Trang khác (" + clip(p, 60) + ")";
  }

  // ---------- Nguồn truy cập ----------
  function fromReferrer() {
    var ref = document.referrer, host = "";
    try { host = ref ? new URL(ref).hostname.replace(/^www\./, "") : ""; } catch (e) { host = ""; }
    if (!host || host === loc.hostname.replace(/^www\./, "")) return null;
    var rules = [
      [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, "facebook", "social"],
      [/(^|\.)zalo\.(me|vn)$|zaloapp/, "zalo", "social"],
      [/(^|\.)google\./, "google", "organic"],
      [/(^|\.)coccoc\.com$/, "coccoc", "organic"],
      [/(^|\.)bing\.com$/, "bing", "organic"],
      [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube", "social"],
      [/(^|\.)tiktok\.com$/, "tiktok", "social"],
      [/(^|\.)instagram\.com$/, "instagram", "social"]
    ];
    for (var i = 0; i < rules.length; i++) {
      if (rules[i][0].test(host)) return { us: rules[i][1], um: rules[i][2] };
    }
    return { us: host, um: "referral" };
  }

  function detectSource() {
    var us = qs.get("utm_source");
    if (us) {
      return { us: clip(us, 100), um: clip(qs.get("utm_medium"), 100), uc: clip(qs.get("utm_campaign"), 100),
        ux: clip(qs.get("utm_content"), 100), ut: clip(qs.get("utm_term"), 100), utm: true };
    }
    if (qs.get("gclid")) return { us: "google", um: "cpc" };
    if (qs.get("fbclid")) return { us: "facebook", um: "social" };
    if (qs.get("zarsrc")) return { us: "zalo", um: "social" };
    return fromReferrer();
  }

  function sourceText(s) {
    if (!s.us || s.us === "(direct)") return "Truy cập trực tiếp";
    return s.us + (s.um && s.um !== "(none)" ? " / " + s.um : "") + (s.uc ? " · " + s.uc : "");
  }

  function device() {
    var ua = nav.userAgent || "";
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ||
        (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)) return "tablet";
    if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return "mobile";
    return "desktop";
  }

  // ---------- Khách, phiên, hành trình ----------
  var now = Date.now();
  var vid = read(localStorage, "ny_vid");
  if (!/^[a-z0-9]{6,40}$/.test(vid || "")) {
    vid = rid("v");
    store(localStorage, "ny_vid", vid);
  }

  var sess = null;
  try { sess = JSON.parse(read(sessionStorage, "ny_sess") || "null"); } catch (e) { sess = null; }
  var found = detectSource();
  var isNewSession = !sess || !sess.id || now - (sess.last || 0) > SESSION_IDLE;
  if (isNewSession) {
    var s0 = found || { us: "(direct)", um: "(none)" };
    var ref = "";
    try { ref = document.referrer ? new URL(document.referrer).origin + new URL(document.referrer).pathname : ""; } catch (e) { ref = ""; }
    if (ref && ref.indexOf(loc.origin) === 0) ref = "";
    sess = { id: rid("s"), us: s0.us, um: s0.um || "", uc: s0.uc || "", ux: s0.ux || "", ut: s0.ut || "", ref: clip(ref, 250) };
    var visits = (parseInt(read(localStorage, "ny_visits"), 10) || 0) + 1;
    store(localStorage, "ny_visits", String(visits));
  } else if (found && found.utm) {
    // Khách bấm một link quảng cáo mới trong cùng phiên: cập nhật nguồn
    sess.us = found.us; sess.um = found.um; sess.uc = found.uc; sess.ux = found.ux; sess.ut = found.ut;
  }
  sess.last = now;
  store(sessionStorage, "ny_sess", JSON.stringify(sess));

  var ft = read(localStorage, "ny_ft");
  if (!ft) {
    var d0 = new Date();
    ft = clip(sourceText(sess), 150) + " · " + pad(d0.getDate()) + "/" + pad(d0.getMonth() + 1) + "/" + d0.getFullYear();
    store(localStorage, "ny_ft", ft);
  }
  var DEV = device();

  function journey() {
    try { return JSON.parse(read(localStorage, "ny_journey") || "[]"); } catch (e) { return []; }
  }
  function remember(text) {
    var j = journey();
    j.push(stamp(new Date()) + " · " + clip(text, 160));
    store(localStorage, "ny_journey", JSON.stringify(j.slice(-JOURNEY_MAX)));
  }

  // ---------- Hàng đợi gửi ----------
  var queue = [];
  var timer = null;

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    while (queue.length) {
      var body = JSON.stringify({ action: "events", events: queue.splice(0, 40) });
      var sent = false;
      try {
        if (nav.sendBeacon) sent = nav.sendBeacon(API, new Blob([body], { type: "text/plain;charset=UTF-8" }));
      } catch (e) { sent = false; }
      if (!sent && window.fetch) {
        try {
          fetch(API, { method: "POST", mode: "no-cors", keepalive: true, credentials: "omit",
            headers: { "Content-Type": "text/plain;charset=utf-8" }, body: body }).catch(function () {});
        } catch (e) { /* bỏ qua */ }
      }
    }
  }

  function track(ev, detail, now2) {
    queue.push({
      ev: ev, detail: clip(detail, 150), page: loc.pathname, vid: vid, sess: sess.id, ts: Date.now(),
      us: sess.us, um: sess.um, uc: sess.uc, ux: sess.ux, ut: sess.ut, ref: sess.ref, dev: DEV
    });
    if (now2) flush();
    else if (!timer) timer = setTimeout(flush, 10000);
  }

  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);

  // Lượt xem trang
  var label = pageLabel(loc.pathname);
  remember("Xem trang " + label + (isNewSession ? " — nguồn: " + sourceText(sess) : ""));
  track("pageview", label, true);

  // Cuộn 50% / 90%
  var scrolled = {};
  function onScroll() {
    var doc = document.documentElement;
    var max = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0);
    if (!max) return;
    var pos = (window.scrollY || doc.scrollTop || 0) + window.innerHeight;
    [50, 90].forEach(function (p) {
      if (!scrolled[p] && pos >= max * p / 100) {
        scrolled[p] = true;
        track("scroll_" + p, label);
      }
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  // Vị trí nút được bấm
  function place(el) {
    if (el.closest(".mobile-bar")) return "Thanh nút dưới đáy (mobile)";
    if (el.closest(".site-header")) return "Đầu trang (menu)";
    if (el.closest(".hero")) return "Hero (đầu trang)";
    if (el.closest(".site-footer")) return "Chân trang";
    if (el.closest(".result-box")) return "Sau khi gửi form";
    var sec = el.closest("section");
    if (sec) {
      var h = sec.querySelector("h2, h3");
      if (h) return "Mục: " + clip(h.textContent, 70);
      if (sec.id) return "Mục #" + sec.id;
    }
    return "Khác";
  }

  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href") || "";
    var where;
    if (/#dang-ky$/.test(href)) {
      where = place(a);
      remember("Bấm nút Đăng ký (" + where + ")");
      track("cta_click", where, true);
    } else if (/^tel:/i.test(href)) {
      where = place(a);
      remember("Bấm Gọi điện (" + where + ")");
      track("call_click", where, true);
    } else if (/zalo\.me\//i.test(href)) {
      where = place(a);
      remember("Bấm Zalo (" + where + ")");
      track("zalo_click", where, true);
    }
  }, true);

  // Bắt đầu điền form (mỗi form một lần cho mỗi lượt xem trang)
  var started = {};
  document.addEventListener("focusin", function (e) {
    var form = e.target && e.target.closest ? e.target.closest("form.lead-form") : null;
    if (!form || e.target.name === "website") return;
    var key = form.getAttribute("data-form") || "form";
    if (started[key]) return;
    started[key] = true;
    var name = FORM_NAMES[key] || key;
    remember("Bắt đầu điền form " + name);
    track("form_start", name, true);
  });

  // Video
  Array.prototype.forEach.call(document.querySelectorAll("video"), function (v) {
    var name = (v.getAttribute("aria-label") || "").replace(/^video\s*(ca khúc\s*)?/i, "");
    if (!name) {
      var src = v.currentSrc || (v.querySelector("source") || {}).src || "video";
      name = decodeURIComponent(String(src).split("/").pop().replace(/\.[a-z0-9]+$/i, ""));
    }
    name = clip(name, 100);
    var played = false, ended = false;
    v.addEventListener("play", function () {
      if (played) return;
      played = true;
      remember("Xem video " + name);
      track("video_play", name, true);
    });
    v.addEventListener("ended", function () {
      if (ended) return;
      ended = true;
      remember("Xem hết video " + name);
      track("video_complete", name, true);
    });
  });

  window.NY_TRACK = {
    track: track,
    flush: flush,
    /* Gắn vào payload lead (object "track") */
    leadFields: function () {
      var lines = journey();
      var text = lines.join("\n");
      while (text.length > 1900 && lines.length > 1) { lines.shift(); text = lines.join("\n"); }
      return {
        vid: vid, sess: sess.id, us: sess.us, um: sess.um, uc: sess.uc, ux: sess.ux, ut: sess.ut,
        ref: sess.ref, ft: ft, dev: DEV, visits: parseInt(read(localStorage, "ny_visits"), 10) || 1, journey: text
      };
    },
    leadDone: function (formKey) {
      remember("Đăng ký thành công (" + (FORM_NAMES[formKey] || formKey || "form") + ")");
      flush();
    }
  };
})();
