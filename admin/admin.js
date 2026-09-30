/* CRM khách đăng ký — Sống chủ động cùng Nguyễn Yến (phiên bản 2.1.0)
 * Mọi dữ liệu khách được hiển thị bằng textContent (không innerHTML) để chống XSS.
 * Mật khẩu chỉ được gửi tới Apps Script để kiểm tra; trình duyệt chỉ giữ token phiên (12 giờ) trong sessionStorage.
 */
(function () {
  "use strict";

  var CFG = window.NY_CONFIG || {};
  var ENDPOINT = String(CFG.LEAD_ENDPOINT || "").trim();
  var CFG_SHEET_URL = String(CFG.SHEET_URL || "").trim();
  var DEMO = !ENDPOINT;
  var LOCAL = location.protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  var TIMEOUT_MS = 20000;
  var REFRESH_MS = 60000;
  var DAY = 864e5;
  var OVERDUE_MS = 24 * 3600 * 1000;
  var SS_SESSION = "ny_crm_session";
  var LS_SIZE = "ny_crm_textsize";
  var DEMO_USER = "nguyenyen";
  var DEFAULT_STATUSES = ["Mới", "Đã liên hệ", "Đang tư vấn", "Hoàn tất", "Không phù hợp"];
  var CLOSED = ["Hoàn tất", "Không phù hợp"];
  var FIELD_LABELS = {
    "phap-luat": "Tư vấn pháp luật",
    "suc-khoe": "Sức khỏe chủ động",
    "hoc-ai": "Học & ứng dụng AI",
    "trang-chu": "Trang chủ"
  };
  var FIELD_SHORT = { "phap-luat": "Pháp luật", "suc-khoe": "Sức khỏe", "hoc-ai": "Học AI", "trang-chu": "Trang chủ" };
  var DEVICE_LABELS = { desktop: "Máy tính", mobile: "Điện thoại", tablet: "Máy tính bảng" };
  var RANGE_LABELS = { today: "hôm nay", "7": "7 ngày qua", "30": "30 ngày qua", all: "từ trước đến nay" };
  var MSG_EXPIRED = "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.";
  var CSV_HEADERS = ["Mã", "Thời gian", "Họ và tên", "Số điện thoại", "Email", "Lĩnh vực", "Chi tiết", "Liên hệ qua",
    "Trạng thái", "Ghi chú", "Hẹn liên hệ lại", "Số lần đăng ký", "Lần đăng ký gần nhất", "Khách cũ", "Người cập nhật",
    "Cập nhật lúc", "Trang", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "Nguồn đầu tiên",
    "Referrer", "Thiết bị", "Mã khách", "Số lượt truy cập", "Hành trình", "Nguồn", "Quá hạn 24 giờ"];
  var LETTER_RE = (function () {
    try { return new RegExp("\\p{L}", "u"); } catch (e) { return /[A-Za-zÀ-ỹ]/; }
  })();
  var EMAIL_RE = /^[a-z0-9._%+\-]+@[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?)*\.[a-z]{2,}$/;

  var state = {
    token: "",
    exp: 0,
    user: "",
    name: "",
    leads: [],
    dups: [],
    stats: null,
    range: "30",
    statuses: DEFAULT_STATUSES.slice(),
    sheetUrl: "",
    filter: emptyFilter(),
    panel: "overview",
    loading: false,
    lastSync: 0,
    timer: null,
    openId: null,
    dirty: false,
    lastFocus: null
  };

  function emptyFilter() {
    return { tab: "all", chip: "", q: "", from: "", to: "", source: "", kind: "" };
  }

  /* ---------------- Tiện ích ---------------- */

  function $(id) { return document.getElementById(id); }

  function el(tag, opts, children) {
    var node = document.createElement(tag);
    opts = opts || {};
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined) node.textContent = opts.text;
    if (opts.attrs) {
      Object.keys(opts.attrs).forEach(function (k) { node.setAttribute(k, opts.attrs[k]); });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function num(n) { return Number(n || 0).toLocaleString("vi-VN"); }
  function pct(a, b) {
    if (!b) return "—";
    var p = a / b * 100;
    return (p >= 10 || p === 0 ? Math.round(p) : Math.round(p * 10) / 10).toLocaleString("vi-VN") + "%";
  }

  function fmtDate(d) {
    return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function fmtDay(d) { return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear(); }
  function fmtTime(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function fmtShort(ts) {
    if (!ts) return "—";
    var d = new Date(ts);
    var y = d.getFullYear() === new Date().getFullYear() ? "" : "/" + d.getFullYear();
    return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + y + " " + fmtTime(d);
  }

  function ago(ts, now) {
    if (!ts) return "";
    now = now || Date.now();
    var m = Math.floor(Math.max(0, now - ts) / 60000);
    if (m < 1) return "vừa xong";
    if (m < 60) return m + " phút trước";
    var h = Math.floor(m / 60);
    if (h < 24) return h + " giờ trước";
    var d = Math.round((startOfDay(now) - startOfDay(ts)) / DAY);
    if (d <= 1) return "hôm qua";
    if (d < 30) return d + " ngày trước";
    if (d < 365) return Math.floor(d / 30) + " tháng trước";
    return Math.floor(d / 365) + " năm trước";
  }

  function parseVnDate(s) {
    var m = String(s || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (!m) return 0;
    return new Date(+m[3], +m[2] - 1, +m[1], +m[4] || 0, +m[5] || 0).getTime();
  }

  function startOfDay(ts) {
    var d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function dateInputToTs(v) {
    var m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null;
  }
  function tsToInput(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function vnToInput(s) {
    var m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? m[3] + "-" + m[2] + "-" + m[1] : "";
  }
  function inputToVn(v) {
    var m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? m[3] + "/" + m[2] + "/" + m[1] : "";
  }
  function isoToLabel(iso) {
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? m[3] + "/" + m[2] : String(iso);
  }

  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
  }

  function phoneDigits(p) {
    var d = String(p || "").replace(/\D/g, "");
    if (/^84\d{9}$/.test(d)) d = "0" + d.slice(2);
    return d;
  }
  function fmtPhone(p) {
    var d = phoneDigits(p);
    return /^0\d{9}$/.test(d) ? d.slice(0, 4) + " " + d.slice(4, 7) + " " + d.slice(7) : String(p || "");
  }
  function telHref(p) { return "tel:" + phoneDigits(p); }
  function zaloHref(p) { return "https://zalo.me/" + phoneDigits(p); }

  function cleanName(raw) { return String(raw || "").replace(/\s+/g, " ").trim(); }
  function cleanEmail(raw) { return String(raw || "").trim().toLowerCase(); }
  function nameError(v) {
    if (!v) return "Vui lòng nhập họ và tên.";
    if (v.length < 2 || v.length > 80) return "Họ và tên cần từ 2 đến 80 ký tự.";
    if (!LETTER_RE.test(v)) return "Họ và tên chưa đúng. Vui lòng nhập bằng chữ, ví dụ Nguyễn Thị Lan.";
    return "";
  }
  function emailError(v) {
    if (!v) return "";
    if (v.length > 120 || !EMAIL_RE.test(v) || v.indexOf("..") >= 0) return "Email chưa đúng định dạng, ví dụ ten@gmail.com.";
    return "";
  }
  function validEmail(v) { return !!v && !emailError(v); }

  function statusIndex(s) {
    var i = DEFAULT_STATUSES.indexOf(s);
    return i < 0 ? 4 : i;
  }

  function formKeyOf(lead) {
    if (FIELD_LABELS[lead.formKey]) return lead.formKey;
    for (var k in FIELD_LABELS) if (FIELD_LABELS[k] === lead.field) return k;
    return "other";
  }

  /* Nguồn rút gọn cho người dùng: Facebook / Zalo / Google / YouTube / TikTok / Trực tiếp / Khác */
  function simpleSource(l) {
    var s = String(l.us || "").toLowerCase();
    var ref = String(l.ref || "").toLowerCase();
    function byName(x) {
      if (/facebook|instagram|messenger|^fb$|fb\.com|fb\.me/.test(x)) return "Facebook";
      if (/zalo/.test(x)) return "Zalo";
      if (/google/.test(x)) return "Google";
      if (/youtube|youtu\.be/.test(x)) return "YouTube";
      if (/tiktok/.test(x)) return "TikTok";
      return "";
    }
    if (s && s !== "(direct)") return byName(s) || "Khác";
    if (ref) return byName(ref) || "Khác";
    return "Trực tiếp";
  }
  function sourceKind(l) {
    var um = String(l.um || "").toLowerCase();
    if (/cpc|ppc|paid|ads?$/.test(um)) return "quảng cáo";
    if (um === "oa") return "Zalo OA";
    if (um === "organic") return "tìm kiếm";
    return "";
  }

  /* "Vấn đề cần tư vấn: Thừa kế\nMô tả ngắn: …" → { main: "Thừa kế", rest: "…" } */
  function needParts(details) {
    var vals = String(details || "").split("\n").map(function (line) {
      var i = line.indexOf(": ");
      return (i > 0 && i < 60 ? line.slice(i + 2) : line).trim();
    }).filter(Boolean);
    return { main: vals[0] || "", rest: vals.slice(1).join(". ") };
  }

  function ssGet(k) { try { return sessionStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* bỏ qua */ } }
  function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) { /* bỏ qua */ } }
  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* bỏ qua */ } }

  var toastTimer = null;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function isOverdue(l, now) {
    return l.status === DEFAULT_STATUSES[0] && l.waitFrom > 0 && (now || Date.now()) - l.waitFrom > OVERDUE_MS;
  }
  function followTs(l) { return parseVnDate(l.followUp); }
  function followDue(l) {
    var t = followTs(l);
    return !!t && CLOSED.indexOf(l.status) < 0 && t <= startOfDay(Date.now());
  }

  function normalizeLead(raw) {
    var l = {
      id: String(raw.id || ""),
      time: String(raw.time || ""),
      timestamp: Number(raw.timestamp) || 0,
      name: cleanName(raw.name),
      email: String(raw.email || "").trim(),
      field: String(raw.field || ""),
      formKey: String(raw.formKey || ""),
      phone: String(raw.phone || ""),
      contact: String(raw.contact || ""),
      details: String(raw.details || ""),
      page: String(raw.page || ""),
      status: String(raw.status || DEFAULT_STATUSES[0]),
      note: String(raw.note || ""),
      updatedBy: String(raw.updatedBy || ""),
      updatedAt: String(raw.updatedAt || ""),
      count: Math.max(1, Number(raw.count) || 1),
      lastAt: String(raw.lastAt || ""),
      followUp: String(raw.followUp || ""),
      oldIds: Array.isArray(raw.oldIds) ? raw.oldIds.map(String) : [],
      us: String(raw.us || ""), um: String(raw.um || ""), uc: String(raw.uc || ""),
      ux: String(raw.ux || ""), ut: String(raw.ut || ""),
      source: String(raw.source || "Không rõ"),
      ft: String(raw.ft || ""),
      ref: String(raw.ref || ""),
      dev: String(raw.dev || ""),
      vid: String(raw.vid || ""),
      visits: Number(raw.visits) || 0,
      journey: String(raw.journey || ""),
      waitFrom: Number(raw.waitFrom) || 0,
      row: Number(raw.row) || 0
    };
    if (!l.timestamp) l.timestamp = parseVnDate(l.time);
    if (!l.waitFrom) l.waitFrom = l.timestamp;
    l.formKey = formKeyOf(l);
    l.src = simpleSource(l);
    return l;
  }

  function normalizeDup(raw) {
    var d = {
      time: String(raw.time || ""), timestamp: Number(raw.timestamp) || parseVnDate(raw.time),
      leadId: String(raw.leadId || ""), name: cleanName(raw.name), email: String(raw.email || "").trim(),
      field: String(raw.field || ""), phone: String(raw.phone || ""),
      contact: String(raw.contact || ""), details: String(raw.details || ""), page: String(raw.page || ""),
      reason: String(raw.reason || ""), source: String(raw.source || ""), uc: String(raw.uc || ""),
      dev: String(raw.dev || ""), formKey: formKeyOf({ field: String(raw.field || "") })
    };
    return d;
  }

  /* ---------------- Gọi API ---------------- */

  function apiError(message, code) {
    var err = new Error(message);
    err.code = code;
    return err;
  }

  function api(action, data) {
    if (DEMO) return demoApi(action, data || {});
    if (action !== "login" && state.exp && Date.now() > state.exp) {
      return Promise.reject(apiError(MSG_EXPIRED, "EXPIRED"));
    }
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    var body = { action: action };
    if (action !== "login") body.token = state.token;
    Object.keys(data || {}).forEach(function (k) { body[k] = data[k]; });

    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
      redirect: "follow",
      credentials: "omit",
      cache: "no-store"
    })
      .then(function (res) {
        if (!res.ok) throw apiError("Máy chủ báo lỗi (mã " + res.status + "). Vui lòng thử lại sau.", "HTTP");
        return res.text();
      })
      .then(function (text) {
        var json;
        try { json = JSON.parse(text); } catch (e) {
          throw apiError("Máy chủ trả dữ liệu không hợp lệ. Kiểm tra lại URL /exec và quyền truy cập “Bất kỳ ai”.", "BAD_JSON");
        }
        if (json && json.auth) throw apiError(json.error || MSG_EXPIRED, "EXPIRED");
        if (!json || json.ok !== true) throw apiError((json && json.error) || "Có lỗi xảy ra.", (json && json.code) || "SERVER");
        return json;
      })
      .catch(function (err) {
        if (err && err.code) throw err;
        if (err && err.name === "AbortError") {
          throw apiError("Máy chủ phản hồi quá lâu (hơn 20 giây). Vui lòng bấm “Làm mới” để thử lại.", "TIMEOUT");
        }
        throw apiError("Không kết nối được máy chủ. Kiểm tra mạng Internet rồi bấm “Làm mới”.", "NETWORK");
      })
      .then(function (json) { clearTimeout(timer); return json; },
        function (err) { clearTimeout(timer); throw err; });
  }

  function isExpired(err) { return err && err.code === "EXPIRED"; }

  /* ---------------- Dữ liệu mẫu (chế độ xem thử) ---------------- */

  var demo = null;

  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function srcLabel(us, um) {
    if (!us || us === "(direct)") return "Truy cập trực tiếp";
    var names = { facebook: "Facebook", zalo: "Zalo", google: "Google", youtube: "YouTube", tiktok: "TikTok" };
    var kinds = { cpc: "quảng cáo", social: "mạng xã hội", organic: "tìm kiếm", referral: "liên kết", oa: "Zalo OA" };
    return (names[us] || us) + (um && um !== "(none)" ? " – " + (kinds[um] || um) : "");
  }

  function demoShorten(s, max) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  var DEMO_PEOPLE = [
    ["Nguyễn Thị Lan", "lan.nguyen58@gmail.com"], ["Trần Văn Hùng", ""], ["Lê Thị Minh Hạnh", "hanhle.ktv@gmail.com"],
    ["Phạm Quốc Bảo", ""], ["Võ Thị Thu Hà", "thuha.vo@yahoo.com"], ["Đặng Văn Tâm", ""],
    ["Hoàng Thị Mai", "maihoang1962@gmail.com"], ["Bùi Đức Thắng", ""], ["Ngô Thị Kim Oanh", "kimoanh.ngo@gmail.com"],
    ["Đỗ Văn Nam", ""], ["Huỳnh Thị Bích Ngọc", "bichngoc.huynh@gmail.com"], ["Phan Thanh Sơn", ""],
    ["Vũ Thị Hồng Nhung", "nhungvu.hn@gmail.com"], ["Trương Văn Lộc", ""], ["Lý Thị Hoa", "hoaly.tn@gmail.com"],
    ["Mai Xuân Trường", ""], ["Đinh Thị Thanh Tâm", "thanhtam.dinh@gmail.com"], ["Cao Văn Phúc", ""],
    ["Dương Thị Ngọc Anh", "ngocanh.duong@gmail.com"], ["Lâm Quang Vinh", ""], ["Tạ Thị Thu Trang", "trangta.edu@gmail.com"],
    ["Hồ Văn Khánh", ""]
  ];

  function buildDemo() {
    var r = rng(20260928);
    var now = Date.now();
    var H = 3600 * 1000;
    var today = startOfDay(now);
    var days = [];
    for (var i = 44; i >= 0; i--) {
      var ts = today - i * DAY;
      var wd = new Date(ts).getDay();
      var v = Math.round(20 + (44 - i) * 0.55 + 7 * Math.sin(i / 3.2) + r() * 9 + (wd === 0 || wd === 6 ? 6 : 0));
      days.push({ ts: ts, v: v, pv: Math.round(v * (1.45 + r() * 0.35)), s: Math.round(v * (1.12 + r() * 0.1)) });
    }
    var phones = DEMO_PEOPLE.map(function () {
      return "0900" + String(100 + Math.floor(r() * 900)) + String(100 + Math.floor(r() * 900));
    });
    var S = {
      fbAds: ["facebook", "cpc", "tuvan-phapluat-t9"], fb: ["facebook", "social", ""],
      zalo: ["zalo", "social", "suckhoe-zalo-nhom"], zaloOa: ["zalo", "oa", "lop-ai-thang10"],
      gg: ["google", "organic", ""], yt: ["youtube", "social", ""], direct: ["(direct)", "(none)", ""]
    };
    var P = { "phap-luat": "/tu-van-phap-luat/", "suc-khoe": "/suc-khoe-chu-dong/", "hoc-ai": "/hoc-ung-dung-ai/", "trang-chu": "/" };
    var D = {
      "phap-luat": ["Vấn đề cần tư vấn: Thừa kế\nMô tả ngắn: Bố mất không để lại di chúc, 4 anh chị em muốn biết cách chia nhà đất.",
        "Vấn đề cần tư vấn: Nhà đất\nMô tả ngắn: Tranh chấp ranh giới đất với nhà hàng xóm, đã hòa giải ở phường chưa thành.",
        "Vấn đề cần tư vấn: Di chúc\nMô tả ngắn: Muốn lập di chúc để lại căn hộ cho con gái.",
        "Vấn đề cần tư vấn: Hôn nhân gia đình\nMô tả ngắn: Hỏi về chia tài sản chung sau ly hôn.",
        "Vấn đề cần tư vấn: Tranh chấp dân sự trong gia đình\nMô tả ngắn: Anh em tranh chấp tiền gửi tiết kiệm của mẹ."],
      "suc-khoe": ["Bạn quan tâm cho ai?: Cha mẹ, người thân\nChủ đề quan tâm: Dinh dưỡng hằng ngày, Chăm sóc người thân đang điều trị",
        "Bạn quan tâm cho ai?: Bản thân\nChủ đề quan tâm: Vận động phù hợp, Nghỉ ngơi và tinh thần",
        "Bạn quan tâm cho ai?: Cả gia đình\nChủ đề quan tâm: Dinh dưỡng hằng ngày"],
      "hoc-ai": ["Bạn đã dùng AI chưa?: Chưa dùng bao giờ\nBạn muốn dùng AI để: Soạn thảo văn bản, tài liệu\nHình thức mong muốn: Học trực tuyến",
        "Bạn đã dùng AI chưa?: Đã dùng cơ bản\nBạn muốn dùng AI để: Chia sẻ kiến thức, làm nội dung\nHình thức mong muốn: Học trực tiếp"],
      "trang-chu": ["Bạn quan tâm lĩnh vực nào?: Tư vấn pháp luật, Sức khỏe chủ động\nLời nhắn ngắn: Tôi muốn hỏi về việc lập di chúc cho bố mẹ.",
        "Bạn quan tâm lĩnh vực nào?: Học & ứng dụng AI"]
    };
    // [giờ trước, form, nguồn, thiết bị, trạng thái, ghi chú, người xử lý, số lần, hẹn (ngày so với hôm nay), người (1..22)]
    var T = [
      [0.4, "phap-luat", "fbAds", "mobile", "Mới", "", "", 1, null, 1],
      [3, "suc-khoe", "zalo", "mobile", "Mới", "", "", 1, null, 2],
      [9, "hoc-ai", "zaloOa", "desktop", "Mới", "", "", 2, null, 3],
      [27, "phap-luat", "fbAds", "mobile", "Mới", "", "", 1, null, 4],
      [31, "trang-chu", "gg", "desktop", "Mới", "", "", 1, null, 5],
      [52, "suc-khoe", "fb", "mobile", "Mới", "", "", 3, null, 6],
      [20, "phap-luat", "direct", "mobile", "Đã liên hệ", "Đã gọi, khách hẹn gửi giấy tờ qua Zalo.", "Yên", 1, 0, 7],
      [44, "hoc-ai", "zaloOa", "tablet", "Đang tư vấn", "Gửi lịch lớp tháng 10, chờ khách chọn buổi.", "Linh", 1, 0, 8],
      [70, "phap-luat", "fbAds", "desktop", "Đang tư vấn", "Đã trao đổi 15 phút, cần rà soát sổ đỏ.", "Cô Yến", 2, -1, 9],
      [96, "suc-khoe", "zalo", "mobile", "Đã liên hệ", "Đã thêm vào nhóm Zalo chia sẻ.", "Linh", 1, 2, 10],
      [120, "phap-luat", "gg", "mobile", "Hoàn tất", "Đã định hướng hình thức di chúc có công chứng.", "Cô Yến", 1, null, 11],
      [150, "trang-chu", "yt", "mobile", "Đã liên hệ", "Khách quan tâm cả lớp AI.", "Yên", 1, 5, 12],
      [190, "hoc-ai", "direct", "desktop", "Hoàn tất", "Đã đăng ký lớp trực tuyến.", "Linh", 1, null, 13],
      [230, "phap-luat", "fbAds", "mobile", "Không phù hợp", "Cần luật sư bào chữa tại tòa — ngoài phạm vi, đã giới thiệu nơi khác.", "Yên", 1, null, 14],
      [260, "suc-khoe", "fb", "mobile", "Hoàn tất", "", "Linh", 1, null, 7],
      [300, "phap-luat", "zalo", "mobile", "Đang tư vấn", "", "Cô Yến", 1, null, 15],
      [380, "trang-chu", "direct", "desktop", "Hoàn tất", "Đã gửi thông tin lớp AI.", "Linh", 1, null, 16],
      [460, "hoc-ai", "zaloOa", "mobile", "Hoàn tất", "", "Linh", 1, null, 17],
      [540, "phap-luat", "gg", "desktop", "Hoàn tất", "Đã tư vấn phương án hòa giải.", "Cô Yến", 1, null, 18],
      [620, "suc-khoe", "zalo", "tablet", "Đã liên hệ", "", "Yên", 1, null, 19],
      [700, "phap-luat", "fbAds", "mobile", "Hoàn tất", "", "Cô Yến", 1, null, 20],
      [800, "hoc-ai", "direct", "mobile", "Không phù hợp", "Số máy không liên lạc được.", "Linh", 1, null, 21],
      [900, "trang-chu", "fb", "mobile", "Hoàn tất", "", "Yên", 1, null, 22],
      [1000, "phap-luat", "gg", "desktop", "Hoàn tất", "", "Cô Yến", 1, null, 4]
    ];
    var history = {};
    function hist(id, ts, by, change) {
      (history[id] = history[id] || []).push({ time: fmtDate(new Date(ts)), timestamp: ts, by: by, change: change });
    }
    var leads = T.map(function (t, i) {
      var ts = now - t[0] * H;
      var d = new Date(ts);
      var id = "NY-" + String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + "-D" + String.fromCharCode(65 + (i % 26)) + pad(i + 1);
      var src = S[t[2]];
      var person = DEMO_PEOPLE[t[9] - 1];
      var details = D[t[1]][i % D[t[1]].length];
      var visits = 1 + (i % 4);
      var jt = [];
      var jts = ts - (visits > 1 ? 2 * DAY : 0) - 25 * 60000;
      var srcText = src[0] === "(direct)" ? "Truy cập trực tiếp" : src[0] + " / " + src[1] + (src[2] ? " · " + src[2] : "");
      if (visits > 1) jt.push(pad(new Date(jts).getDate()) + "/" + pad(new Date(jts).getMonth() + 1) + " " + fmtTime(new Date(jts)) + " · Xem trang Trang chủ — nguồn: " + srcText);
      var j2 = new Date(ts - 6 * 60000);
      var stamp = pad(j2.getDate()) + "/" + pad(j2.getMonth() + 1) + " " + fmtTime(j2);
      jt.push(stamp + " · Xem trang " + FIELD_LABELS[t[1]] + (visits > 1 ? "" : " — nguồn: " + srcText));
      jt.push(stamp + " · Bấm nút Đăng ký (" + (t[3] === "mobile" ? "Thanh nút dưới đáy (mobile)" : "Hero (đầu trang)") + ")");
      jt.push(stamp + " · Bắt đầu điền form " + FIELD_LABELS[t[1]]);
      var lead = {
        id: id, time: fmtDate(d), timestamp: ts, name: person[0], email: person[1],
        field: FIELD_LABELS[t[1]], formKey: t[1],
        phone: phones[t[9] - 1], contact: i % 3 === 1 ? "Điện thoại" : "Zalo",
        details: details, page: P[t[1]], status: t[4], note: t[5], updatedBy: t[6],
        updatedAt: t[6] ? fmtDate(new Date(ts + 2 * H)) : "",
        count: t[7], lastAt: t[7] > 1 ? fmtDate(new Date(ts + (t[0] > 20 ? 20 : t[0] / 2) * H)) : fmtDate(d),
        followUp: t[8] === null ? "" : fmtDay(new Date(today + t[8] * DAY + 12 * H)),
        oldIds: [], us: src[0], um: src[1], uc: src[2], ux: t[2] === "fbAds" ? "video-di-chuc" : "", ut: "",
        source: srcLabel(src[0], src[1]),
        ft: srcText + " · " + fmtDay(new Date(jts)), ref: src[0] === "google" ? "https://www.google.com/" : "",
        dev: t[3], vid: "vdemo" + pad(i + 1) + "x", visits: visits, journey: jt.join("\n"), waitFrom: ts, row: T.length - i + 1
      };
      hist(id, ts, "Website", "Tạo mới từ form " + lead.field);
      if (t[7] > 1) {
        for (var k = 2; k <= t[7]; k++) hist(id, ts + (k - 1) * 3 * H, "Website", "Đăng ký lại lần " + k + " từ form " + lead.field + "\nNội dung mới: " + demoShorten(details.replace(/\n/g, "; "), 120));
      }
      if (t[6]) {
        var ch = [];
        if (t[4] !== DEFAULT_STATUSES[0]) ch.push("Trạng thái: Mới → " + t[4]);
        if (t[5]) ch.push("Ghi chú: " + t[5]);
        if (lead.followUp) ch.push("Hẹn liên hệ lại: " + lead.followUp);
        if (ch.length) hist(id, ts + 2 * H, t[6], ch.join("\n"));
      }
      return lead;
    });
    // Khách cũ: cùng số điện thoại, khác lĩnh vực → liên kết hai chiều
    var byPhone = {};
    leads.forEach(function (l) { (byPhone[l.phone] = byPhone[l.phone] || []).push(l); });
    Object.keys(byPhone).forEach(function (p) {
      var g = byPhone[p];
      if (g.length < 2) return;
      g.forEach(function (l) { l.oldIds = g.filter(function (o) { return o !== l; }).map(function (o) { return o.id; }); });
    });
    var dups = [];
    leads.forEach(function (l) {
      for (var k = 2; k <= l.count; k++) {
        var t2 = l.timestamp + (k - 1) * 3 * H;
        if (t2 > now) t2 = now - 60000 * k;
        dups.push({ time: fmtDate(new Date(t2)), timestamp: t2, leadId: l.id, name: l.name, email: l.email, field: l.field,
          phone: l.phone, contact: l.contact, details: l.details.split("\n")[0], page: l.page,
          reason: "Trùng số điện thoại và lĩnh vực", source: l.source, uc: l.uc, dev: l.dev, vid: l.vid });
      }
    });
    var back = leads[10];
    dups.push({ time: fmtDate(new Date(now - 200 * H)), timestamp: now - 200 * H, leadId: back.id, name: back.name, email: back.email,
      field: back.field, phone: back.phone, contact: "Zalo", details: "Vấn đề cần tư vấn: Di chúc", page: back.page,
      reason: "Trùng số điện thoại và lĩnh vực — khách quay lại sau khi hoàn tất", source: "Google – tìm kiếm", uc: "", dev: "desktop", vid: back.vid });
    dups.sort(function (a, b) { return b.timestamp - a.timestamp; });
    return { days: days, leads: leads, dups: dups, history: history };
  }

  function demoStats(range) {
    var now = Date.now();
    var today = startOfDay(now);
    var from = range === "all" ? 0 : today - (range === "today" ? 0 : Number(range) - 1) * DAY;
    var days = demo.days.filter(function (d) { return d.ts >= from; });
    var V = 0, PV = 0, SS = 0;
    days.forEach(function (d) { V += d.v; PV += d.pv; SS += d.s; });
    var leads = demo.leads.filter(function (l) { return l.timestamp >= from; });
    var dups = demo.dups.filter(function (d) { return d.timestamp >= from; });
    function group(list, keyFn, shares) {
      var m = {};
      shares.forEach(function (s) { m[s[0]] = { key: s[0], visitors: Math.round(V * s[1]), sessions: Math.round(SS * s[1]), pageviews: Math.round(PV * s[1]), leads: 0 }; });
      list.forEach(function (l) {
        var k = keyFn(l);
        if (!k) return;
        if (!m[k]) m[k] = { key: k, visitors: 0, sessions: 0, pageviews: 0, leads: 0 };
        m[k].leads++;
      });
      return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.visitors - a.visitors || b.leads - a.leads; });
    }
    var dayList = days.map(function (d) {
      var dd = new Date(d.ts);
      var iso = dd.getFullYear() + "-" + pad(dd.getMonth() + 1) + "-" + pad(dd.getDate());
      var lc = demo.leads.filter(function (l) { return l.timestamp >= d.ts && l.timestamp < d.ts + DAY; }).length;
      var dc = demo.dups.filter(function (l) { return l.timestamp >= d.ts && l.timestamp < d.ts + DAY; }).length;
      return { day: iso, pv: d.pv, visitors: d.v, leads: lc, dups: dc };
    });
    var pages = group(leads, function (l) { return FIELD_LABELS[l.formKey]; },
      [["Tư vấn pháp luật", 0.36], ["Trang chủ", 0.34], ["Sức khỏe chủ động", 0.17], ["Học & ứng dụng AI", 0.13]]);
    pages.forEach(function (p) { p.pageviews = Math.round(p.visitors * 1.4); p.rate = p.visitors ? p.leads / p.visitors : 0; });
    var cta = Math.round(V * 0.19);
    return {
      ok: true, range: range, generatedAt: now, sheetUrl: "",
      kpi: { pageviews: PV, visitors: V, sessions: SS, leads: leads.length, dups: dups.length,
        conversion: V ? leads.length / V : 0, callClicks: Math.round(V * 0.04), zaloClicks: Math.round(V * 0.06) },
      funnel: [
        { step: "Truy cập website", n: V }, { step: "Cuộn xem 50% trang", n: Math.round(V * 0.58) },
        { step: "Bấm nút Đăng ký", n: cta }, { step: "Bắt đầu điền form", n: Math.round(V * 0.11) },
        { step: "Đăng ký thành công", n: leads.length }
      ],
      days: dayList,
      sources: group(leads, function (l) { return l.source; },
        [["Facebook – quảng cáo", 0.36], ["Zalo – mạng xã hội", 0.2], ["Truy cập trực tiếp", 0.19], ["Google – tìm kiếm", 0.13],
          ["Zalo – Zalo OA", 0.06], ["YouTube – mạng xã hội", 0.04], ["Facebook – mạng xã hội", 0.02]]),
      campaigns: group(leads, function (l) { return l.uc; },
        [["tuvan-phapluat-t9", 0.36], ["suckhoe-zalo-nhom", 0.2], ["lop-ai-thang10", 0.06]]),
      devices: group(leads, function (l) { return DEVICE_LABELS[l.dev]; }, [["Điện thoại", 0.68], ["Máy tính", 0.27], ["Máy tính bảng", 0.05]]),
      pages: pages,
      ctaPlaces: [
        ["Hero (đầu trang)", "Tư vấn pháp luật", 0.28], ["Thanh nút dưới đáy (mobile)", "Tư vấn pháp luật", 0.2],
        ["Mục: Dịch vụ tư vấn pháp luật cho cá nhân, gia đình", "Tư vấn pháp luật", 0.12], ["Hero (đầu trang)", "Sức khỏe chủ động", 0.12],
        ["Thanh nút dưới đáy (mobile)", "Trang chủ", 0.1], ["Đầu trang (menu)", "Trang chủ", 0.09], ["Hero (đầu trang)", "Học & ứng dụng AI", 0.09]
      ].map(function (c) { return { key: c[0], page: c[1], n: Math.round(cta * c[2]) }; }).filter(function (c) { return c.n > 0; }),
      videos: [
        { key: "Đừng phụ lòng chính mình", plays: Math.round(V * 0.09), viewers: Math.round(V * 0.08), completes: Math.round(V * 0.04) },
        { key: "Không phải tình cờ", plays: Math.round(V * 0.06), viewers: Math.round(V * 0.05), completes: Math.round(V * 0.025) }
      ].filter(function (v) { return v.plays > 0; })
    };
  }

  function demoJourney(vid) {
    var l = demo.leads.filter(function (x) { return x.vid === vid; })[0];
    if (!l) return [];
    var ev = [];
    var src = srcLabel(l.us, l.um);
    var page = FIELD_LABELS[l.formKey];
    var t = l.timestamp;
    if (l.visits > 1) {
      var t0 = t - 2 * DAY - 25 * 60000;
      ev.push({ t: t0, sess: "s1", ev: "pageview", pageLabel: "Trang chủ", detail: "Trang chủ", source: src, uc: l.uc, dev: l.dev });
      ev.push({ t: t0 + 60000, sess: "s1", ev: "scroll_50", pageLabel: "Trang chủ", detail: "", source: src, uc: l.uc, dev: l.dev });
      if (l.formKey === "suc-khoe") ev.push({ t: t0 + 120000, sess: "s1", ev: "video_play", pageLabel: "Sức khỏe chủ động", detail: "Đừng phụ lòng chính mình", source: src, uc: l.uc, dev: l.dev });
    }
    var s = "s2";
    ev.push({ t: t - 6 * 60000, sess: s, ev: "pageview", pageLabel: page, detail: page, source: src, uc: l.uc, dev: l.dev });
    ev.push({ t: t - 5 * 60000, sess: s, ev: "scroll_50", pageLabel: page, detail: "", source: src, uc: l.uc, dev: l.dev });
    ev.push({ t: t - 4 * 60000, sess: s, ev: "cta_click", pageLabel: page, detail: l.dev === "mobile" ? "Thanh nút dưới đáy (mobile)" : "Hero (đầu trang)", source: src, uc: l.uc, dev: l.dev });
    ev.push({ t: t - 3 * 60000, sess: s, ev: "form_start", pageLabel: page, detail: page, source: src, uc: l.uc, dev: l.dev });
    ev.push({ t: t, sess: s, ev: "lead", pageLabel: page, detail: page, source: src, uc: l.uc, dev: l.dev });
    return ev;
  }

  function demoUpdate(data) {
    var lead = demo.leads.filter(function (l) { return l.id === data.id; })[0];
    if (!lead) throw apiError("Không tìm thấy khách.", "SERVER");
    var changes = [];
    var name = lead.name;
    var email = lead.email;
    if (data.name !== undefined) {
      name = cleanName(data.name);
      var ne = nameError(name);
      if (ne) throw apiError(ne, "SERVER");
    }
    if (data.email !== undefined) {
      email = cleanEmail(data.email);
      var ee = emailError(email);
      if (ee) throw apiError(ee, "SERVER");
    }
    if (data.status && DEFAULT_STATUSES.indexOf(data.status) < 0) throw apiError("Trạng thái không hợp lệ.", "SERVER");
    var note = data.note === undefined ? lead.note : String(data.note).slice(0, 1000);
    var follow = data.followUp === undefined ? lead.followUp : String(data.followUp);
    if (name !== lead.name) changes.push("Họ tên: " + (lead.name || "(trống)") + " → " + name);
    if (email !== lead.email) changes.push("Email: " + (lead.email || "(trống)") + " → " + (email || "(đã xóa)"));
    if (data.status && data.status !== lead.status) changes.push("Trạng thái: " + lead.status + " → " + data.status);
    if (note !== lead.note) changes.push(note.trim() === "" ? "Ghi chú: (đã xóa)" : "Ghi chú: " + demoShorten(note, 300));
    if (follow !== lead.followUp) changes.push("Hẹn liên hệ lại: " + (follow || "(đã xóa)"));
    if (!changes.length) return { ok: true, changed: false, lead: JSON.parse(JSON.stringify(lead)) };
    lead.name = name;
    lead.email = email;
    if (data.status) lead.status = data.status;
    lead.note = note;
    lead.followUp = follow;
    lead.updatedBy = String(data.updatedBy || DEMO_USER).slice(0, 50);
    lead.updatedAt = fmtDate(new Date());
    (demo.history[lead.id] = demo.history[lead.id] || []).push({ time: lead.updatedAt, timestamp: Date.now(), by: lead.updatedBy, change: changes.join("\n") });
    return { ok: true, changed: true, lead: JSON.parse(JSON.stringify(lead)) };
  }

  function demoApi(action, data) {
    if (!demo) demo = buildDemo();
    var copy = function (o) { return JSON.parse(JSON.stringify(o)); };
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (action === "login") {
          if (!LOCAL) return reject(apiError("CRM chưa kết nối Google Sheet nên chưa có dữ liệu khách.", "AUTH"));
          if (String(data.u || "").trim().toLowerCase() !== DEMO_USER || !data.p) {
            return reject(apiError("Sai tài khoản hoặc mật khẩu.", "AUTH"));
          }
          return resolve({ ok: true, token: "demo", exp: Date.now() + 12 * 3600 * 1000, user: DEMO_USER });
        }
        if (action === "list") return resolve({ ok: true, leads: copy(demo.leads), dups: copy(demo.dups), statuses: DEFAULT_STATUSES.slice(), sheetUrl: "" });
        if (action === "stats") return resolve(demoStats(data.range || "30"));
        if (action === "journey") return resolve({ ok: true, vid: data.vid, events: demoJourney(data.vid) });
        if (action === "history") {
          var items = (demo.history[data.id] || []).slice().sort(function (a, b) { return b.timestamp - a.timestamp; });
          return resolve({ ok: true, id: data.id, history: copy(items.slice(0, 50)) });
        }
        if (action === "update") {
          try { return resolve(demoUpdate(data)); } catch (err) { return reject(err); }
        }
        resolve({ ok: true });
      }, 250);
    });
  }

  /* ---------------- Cỡ chữ ---------------- */

  function applyTextSize(size) {
    var lg = size === "lg";
    document.documentElement.classList.toggle("size-lg", lg);
    Array.prototype.forEach.call(document.querySelectorAll(".textsize__btn"), function (b) {
      b.setAttribute("aria-pressed", (b.getAttribute("data-size") === "lg") === lg ? "true" : "false");
    });
  }

  /* ---------------- Đăng nhập / phiên ---------------- */

  function saveSession() {
    ssSet(SS_SESSION, JSON.stringify({ token: state.token, exp: state.exp, user: state.user, name: state.name }));
  }

  function loadSession() {
    try {
      var s = JSON.parse(ssGet(SS_SESSION) || "null");
      if (s && s.token && s.exp) return s;
    } catch (e) { /* bỏ qua */ }
    return null;
  }

  function showLogin(message, kind) {
    stopTimer();
    closeDrawer(true);
    $("app-view").hidden = true;
    $("login-view").hidden = false;
    var s = loadSession();
    $("login-user").value = state.user || (s && s.user) || (DEMO ? DEMO_USER : "");
    $("login-name").value = state.name || "";
    $("login-pass").value = "";
    var errBox = $("login-error");
    var infoBox = $("login-info");
    errBox.hidden = true;
    infoBox.hidden = true;
    if (message) {
      var box = kind === "info" ? infoBox : errBox;
      box.textContent = message;
      box.hidden = false;
    }
    ($("login-user").value ? $("login-pass") : $("login-user")).focus();
  }

  function onLogin(e) {
    e.preventDefault();
    var user = $("login-user").value.trim();
    var pass = $("login-pass").value;
    var errBox = $("login-error");
    $("login-info").hidden = true;
    if (!user || !pass) {
      errBox.textContent = !user ? "Vui lòng nhập tài khoản." : "Vui lòng nhập mật khẩu.";
      errBox.hidden = false;
      (!user ? $("login-user") : $("login-pass")).focus();
      return;
    }
    var btn = $("login-submit");
    btn.disabled = true;
    btn.textContent = "Đang kiểm tra…";
    errBox.hidden = true;

    api("login", { u: user, p: pass }).then(function (res) {
      state.token = String(res.token);
      state.exp = Number(res.exp) || Date.now() + 12 * 3600 * 1000;
      state.user = String(res.user || user);
      state.name = $("login-name").value.trim().slice(0, 50);
      saveSession();
      $("login-pass").value = "";
      setPwVisible(false);
      startApp();
    }).catch(function (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
      $("login-pass").focus();
      $("login-pass").select();
    }).then(function () {
      btn.disabled = false;
      btn.textContent = "Đăng nhập";
    });
  }

  function setPwVisible(show) {
    $("login-pass").type = show ? "text" : "password";
    $("login-toggle").textContent = show ? "Ẩn" : "Hiện";
    $("login-toggle").setAttribute("aria-pressed", show ? "true" : "false");
    $("login-toggle").setAttribute("aria-label", show ? "Ẩn mật khẩu" : "Hiện mật khẩu");
  }

  function clearData() {
    state.token = "";
    state.exp = 0;
    state.leads = [];
    state.dups = [];
    state.stats = null;
    state.lastSync = 0;
    ssDel(SS_SESSION);
  }

  function logout() {
    if (!DEMO && state.token) api("logout").catch(function () { /* phiên có thể đã hết hạn */ });
    clearData();
    showLogin("Bạn đã đăng xuất.", "info");
  }

  function sessionExpired() {
    clearData();
    showLogin(MSG_EXPIRED, "info");
  }

  /* ---------------- Tải dữ liệu ---------------- */

  function startApp() {
    $("login-view").hidden = true;
    $("app-view").hidden = false;
    $("user-name").textContent = "Xin chào, " + (state.name || state.user);
    setSheetButton(state.sheetUrl);
    showPanel(state.panel, true);
    loadAll();
    startTimer();
  }

  function setSheetButton(url) {
    var u = /^https:\/\//i.test(url || "") ? url : (/^https:\/\//i.test(CFG_SHEET_URL) ? CFG_SHEET_URL : "");
    var btn = $("btn-sheet");
    if (u) { btn.href = u; btn.hidden = false; } else { btn.hidden = true; btn.removeAttribute("href"); }
  }

  function setLoading(on) {
    state.loading = on;
    var btn = $("btn-refresh");
    btn.disabled = on;
    btn.textContent = on ? "Đang tải…" : "Làm mới";
  }

  function showError(err, hasData) {
    var box = $("app-error");
    box.textContent = err.message + (hasData ? " Số liệu bên dưới là của lần tải trước." : "");
    box.hidden = false;
  }

  function loadAll() {
    if (state.loading) return Promise.resolve();
    setLoading(true);
    return Promise.all([api("list"), api("stats", { range: state.range })]).then(function (res) {
      applyList(res[0]);
      applyStats(res[1]);
      $("app-error").hidden = true;
    }).catch(function (err) {
      if (isExpired(err)) return sessionExpired();
      showError(err, state.leads.length > 0);
      if (!state.leads.length) renderLeads(true);
    }).then(function () { setLoading(false); });
  }

  function loadStats() {
    var range = state.range;
    $("sync-overview").textContent = "Đang tải số liệu…";
    return api("stats", { range: range }).then(function (res) {
      if (range === state.range) applyStats(res);
    }).catch(function (err) {
      if (isExpired(err)) return sessionExpired();
      showError(err, !!state.stats);
      syncText();
    });
  }

  function applyList(res) {
    state.leads = (res.leads || []).map(normalizeLead);
    state.dups = (res.dups || []).map(normalizeDup);
    if (Array.isArray(res.statuses) && res.statuses.length) state.statuses = res.statuses.map(String);
    if (res.sheetUrl) { state.sheetUrl = String(res.sheetUrl); setSheetButton(state.sheetUrl); }
    state.lastSync = Date.now();
    renderSourceOptions();
    renderChips();
    renderLeads();
    renderDups();
    renderAlerts();
    renderBigCards();
    renderLatest();
    refreshOpenDrawer();
    syncText();
  }

  function applyStats(res) {
    state.stats = res;
    renderOverview();
    renderBigCards();
    syncText();
  }

  function syncText() {
    if (!state.lastSync) return;
    var t = new Date(state.lastSync);
    var text = "Cập nhật lúc " + pad(t.getHours()) + ":" + pad(t.getMinutes()) + ":" + pad(t.getSeconds()) +
      " · tự làm mới mỗi 60 giây" + (DEMO ? " · dữ liệu mẫu" : "");
    $("sync-overview").textContent = text;
    $("sync-leads").textContent = text;
  }

  function startTimer() {
    stopTimer();
    state.timer = setInterval(function () {
      if (DEMO || $("app-view").hidden || document.visibilityState !== "visible") return;
      if (state.exp && Date.now() > state.exp) return sessionExpired();
      if (state.dirty) return;
      loadAll();
    }, REFRESH_MS);
  }

  function stopTimer() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }

  /* ---------------- Tổng quan ---------------- */

  function leadCounters() {
    var now = Date.now();
    var c = { pending: 0, overdue: 0, today: 0, byStatus: {} };
    state.leads.forEach(function (l) {
      if (l.status === DEFAULT_STATUSES[0]) c.pending++;
      if (isOverdue(l, now)) c.overdue++;
      if (followDue(l)) c.today++;
      c.byStatus[l.status] = (c.byStatus[l.status] || 0) + 1;
    });
    return c;
  }

  function rangeStart(range) {
    if (range === "all") return null;
    return startOfDay(Date.now()) - (range === "today" ? 0 : Number(range) - 1) * DAY;
  }

  function renderBigCards() {
    var box = $("big-cards");
    if (!box) return;
    clear(box);
    var c = leadCounters();
    var k = (state.stats && state.stats.kpi) || null;
    var from = rangeStart(state.range);
    var inRange = state.leads.filter(function (l) { return from === null || l.timestamp >= from; }).length;
    [
      { cls: c.pending ? "bigcard--new" : "bigcard--zero", label: "Khách mới chờ liên hệ", value: c.pending,
        sub: c.pending ? "trạng thái “Mới”, chưa ai gọi" : "Đã liên hệ hết khách mới", go: "Xem danh sách",
        onClick: function () { goLeads({ chip: "s:" + DEFAULT_STATUSES[0] }); } },
      { cls: c.overdue ? "bigcard--danger" : "bigcard--zero", label: "Quá hạn 24 giờ", value: c.overdue,
        sub: c.overdue ? "khách “Mới” chờ quá 24 giờ" : "Không có khách quá hạn", go: "Gọi ngay",
        onClick: function () { goLeads({ chip: "overdue" }); } },
      { cls: c.today ? "bigcard--today" : "bigcard--zero", label: "Cần gọi hôm nay", value: c.today,
        sub: "theo ngày hẹn gọi lại", go: "Xem danh sách",
        onClick: function () { goLeads({ chip: "today" }); } },
      { cls: "bigcard--total", label: "Tổng đăng ký trong kỳ", value: k ? k.leads : inRange,
        sub: RANGE_LABELS[state.range] + (k && k.dups ? " · " + num(k.dups) + " lần gửi trùng" : ""), go: "Xem danh sách",
        onClick: function () { goLeads({ from: from }); } }
    ].forEach(function (o) {
      var b = el("button", { className: "bigcard " + o.cls, attrs: { type: "button" } }, [
        el("span", { className: "bigcard__label", text: o.label }),
        el("span", { className: "bigcard__num", text: num(o.value) }),
        el("span", { className: "bigcard__sub", text: o.sub }),
        el("span", { className: "bigcard__go", text: o.go + " →" })
      ]);
      b.addEventListener("click", o.onClick);
      box.appendChild(b);
    });
  }

  function renderLatest() {
    var box = $("latest");
    if (!box) return;
    clear(box);
    var list = state.leads.slice().sort(function (a, b) { return b.timestamp - a.timestamp || b.row - a.row; }).slice(0, 5);
    if (!list.length) {
      box.appendChild(el("p", { className: "nodata", text: "Chưa có khách đăng ký." }));
      return;
    }
    var wrap = el("div", { className: "latest" });
    var now = Date.now();
    list.forEach(function (l) {
      wrap.appendChild(el("div", { className: "latest__row", attrs: { "data-id": l.id } }, [
        el("span", { className: "latest__name", text: l.name || "(Chưa có tên)" }),
        el("span", { className: "latest__phone", text: fmtPhone(l.phone) }),
        fieldBadge(l),
        el("span", { className: "latest__time", text: fmtShort(l.timestamp) + " · " + ago(l.timestamp, now) }),
        el("span", { className: "latest__btns" }, [
          el("a", { className: "btn btn--primary btn--sm", text: "Gọi", attrs: { href: telHref(l.phone), "aria-label": "Gọi " + (l.name || fmtPhone(l.phone)) } }),
          el("button", { className: "btn btn--ghost btn--sm", text: "Chi tiết", attrs: { type: "button", "data-open": l.id } })
        ])
      ]));
    });
    box.appendChild(wrap);
  }

  function kpiCard(o) {
    var tag = o.onClick ? "button" : "div";
    var node = el(tag, { className: "kpi" + (o.cls ? " " + o.cls : "") }, [
      el("span", { className: "kpi__label", text: o.label }),
      el("span", { className: "kpi__num", text: o.value }),
      o.sub ? el("span", { className: "kpi__sub", text: o.sub }) : null
    ]);
    if (o.onClick) {
      node.type = "button";
      node.addEventListener("click", o.onClick);
    }
    return node;
  }

  function renderOverview() {
    var s = state.stats;
    if (!s) return;
    var k = s.kpi || {};
    var box = $("kpis");
    clear(box);
    [
      { label: "Khách truy cập", value: num(k.visitors), sub: num(k.sessions) + " phiên truy cập", cls: "kpi--main" },
      { label: "Lượt xem trang", value: num(k.pageviews), sub: k.visitors ? "≈ " + (Math.round(k.pageviews / k.visitors * 10) / 10).toLocaleString("vi-VN") + " trang / khách" : "" },
      { label: "Tỉ lệ đăng ký", value: pct(k.leads, k.visitors), sub: num(k.leads) + " đăng ký / " + num(k.visitors) + " khách", cls: "kpi--gold" },
      { label: "Đăng ký trùng", value: num(k.dups), sub: "gửi lại cùng lĩnh vực", onClick: function () { showPanel("dups"); } }
    ].forEach(function (o) { box.appendChild(kpiCard(o)); });

    renderDayChart(s.days || []);
    renderFunnel(s.funnel || [], k);
    var rateCols = [
      { label: "Khách", key: "visitors", strong: true },
      { label: "Đăng ký", key: "leads" },
      { label: "Tỉ lệ", get: function (r) { return pct(r.leads, r.visitors); } }
    ];
    metricTable("t-sources", "Nguồn", s.sources || [], rateCols, "visitors");
    metricTable("t-campaigns", "Chiến dịch", s.campaigns || [], rateCols, "visitors",
      "Chưa có chiến dịch. Thêm utm_campaign vào link quảng cáo để theo dõi (xem hướng dẫn).");
    metricTable("t-devices", "Thiết bị", s.devices || [], rateCols, "visitors");
    metricTable("t-pages", "Trang", (s.pages || []).filter(function (p) { return p.visitors || p.leads; }), [
      { label: "Lượt xem", key: "pageviews", cls: "hide-sm" },
      { label: "Khách", key: "visitors", strong: true },
      { label: "Đăng ký", key: "leads" },
      { label: "Tỉ lệ", get: function (r) { return pct(r.leads, r.visitors); } }
    ], "visitors");
    metricTable("t-cta", "Vị trí nút", s.ctaPlaces || [], [{ label: "Lượt bấm", key: "n", strong: true }], "n", null,
      function (r) { return r.page; });
    metricTable("t-videos", "Video", s.videos || [], [
      { label: "Lượt phát", key: "plays", strong: true },
      { label: "Người xem", key: "viewers", cls: "hide-sm" },
      { label: "Xem hết", key: "completes" }
    ], "plays", "Chưa có lượt xem video trong khoảng này.");
  }

  function renderDayChart(days) {
    var box = $("chart-days");
    clear(box);
    var list = days.slice();
    var weekly = list.length > 62;
    if (weekly) {
      var w = [];
      list.forEach(function (d, i) {
        if (i % 7 === 0) w.push({ day: d.day, visitors: 0, leads: 0, dups: 0, pv: 0 });
        var cur = w[w.length - 1];
        cur.visitors += d.visitors; cur.leads += d.leads; cur.dups += d.dups; cur.pv += d.pv;
      });
      list = w;
    }
    var totalV = 0, totalL = 0, totalD = 0, maxV = 0, maxL = 0;
    list.forEach(function (d) {
      totalV += d.visitors; totalL += d.leads; totalD += d.dups;
      if (d.visitors > maxV) maxV = d.visitors;
      if (d.leads > maxL) maxL = d.leads;
    });
    if (!list.length || (!totalV && !totalL)) {
      box.appendChild(el("p", { className: "nodata", text: "Chưa có dữ liệu truy cập trong khoảng này." }));
      return;
    }
    var plot = el("div", { className: "daychart__plot", attrs: { role: "img",
      "aria-label": "Biểu đồ " + (weekly ? "theo tuần" : "theo ngày") + ": tổng " + totalV + " khách truy cập, " + totalL + " đăng ký" } });
    plot.appendChild(el("span", { className: "daychart__max", text: "Cao nhất: " + num(maxV) + " khách · " + num(maxL) + " đăng ký" }));
    list.forEach(function (d) {
      var col = el("div", { className: "daychart__col", attrs: {
        title: (weekly ? "Tuần từ " : "") + isoToLabel(d.day) + ": " + d.visitors + " khách, " + d.leads + " đăng ký" + (d.dups ? ", " + d.dups + " trùng" : "") } });
      var b1 = el("span", { className: "daychart__bar" });
      b1.style.height = (maxV ? d.visitors / maxV * 100 : 0) + "%";
      var b2 = el("span", { className: "daychart__bar daychart__bar--lead" });
      b2.style.height = (maxL ? d.leads / maxL * 100 : 0) + "%";
      col.appendChild(b1);
      col.appendChild(b2);
      plot.appendChild(col);
    });
    box.appendChild(plot);
    var axis = el("div", { className: "daychart__axis" });
    var picks = list.length === 1 ? [0] : list.length === 2 ? [0, 1] : [0, Math.floor((list.length - 1) / 2), list.length - 1];
    picks.forEach(function (i) { axis.appendChild(el("span", { text: (weekly ? "Tuần " : "") + isoToLabel(list[i].day) })); });
    box.appendChild(axis);
    box.appendChild(el("p", { className: "daychart__sum",
      text: "Tổng: " + num(totalV) + " lượt khách · " + num(totalL) + " đăng ký · " + num(totalD) + " đăng ký trùng" +
        (weekly ? " (gộp theo tuần)" : "") + ". Cột đăng ký dùng thang riêng để dễ nhìn." }));
  }

  function renderFunnel(steps, k) {
    var box = $("funnel");
    clear(box);
    var first = steps.length ? steps[0].n : 0;
    if (!first) {
      box.appendChild(el("p", { className: "nodata", text: "Chưa có dữ liệu truy cập trong khoảng này." }));
    } else {
      steps.forEach(function (s, i) {
        var fill = el("div", { className: "funnel__fill" });
        fill.style.width = Math.min(100, first ? s.n / first * 100 : 0) + "%";
        box.appendChild(el("div", { className: "funnel__row" }, [
          el("div", { className: "funnel__top" }, [
            el("span", { className: "funnel__name", text: (i + 1) + ". " + s.step }),
            el("span", { className: "funnel__num", text: num(s.n) + (i ? " · " + pct(s.n, first) : "") })
          ]),
          el("div", { className: "funnel__track" }, [fill])
        ]));
      });
    }
    box.appendChild(el("p", { className: "muted small",
      text: "Ngoài form, khách còn bấm Gọi " + num(k.callClicks) + " lần và bấm Zalo " + num(k.zaloClicks) + " lần." }));
  }

  function metricTable(id, firstLabel, rows, cols, shareKey, emptyText, subFn) {
    var box = $(id);
    clear(box);
    if (!rows.length) {
      box.appendChild(el("p", { className: "nodata", text: emptyText || "Chưa có dữ liệu trong khoảng này." }));
      return;
    }
    var total = 0;
    rows.forEach(function (r) { total += Number(r[shareKey]) || 0; });
    var head = el("tr", {}, [el("th", { text: firstLabel, attrs: { scope: "col" } })]);
    cols.forEach(function (c) { head.appendChild(el("th", { text: c.label, className: c.cls || "", attrs: { scope: "col" } })); });
    var body = el("tbody");
    rows.slice(0, 15).forEach(function (r) {
      var first = el("td", {}, [el("span", { text: r.key || "Không rõ" })]);
      if (subFn && subFn(r)) first.appendChild(el("span", { className: "sub", text: subFn(r) }));
      if (total) {
        var f = el("div", { className: "share__fill" });
        f.style.width = Math.round((Number(r[shareKey]) || 0) / total * 100) + "%";
        first.appendChild(el("div", { className: "share" }, [f]));
      }
      var tr = el("tr", {}, [first]);
      cols.forEach(function (c) {
        var v = c.get ? c.get(r) : num(r[c.key]);
        tr.appendChild(el("td", { text: v, className: (c.cls || "") + (c.strong ? " num-strong" : "") }));
      });
      body.appendChild(tr);
    });
    box.appendChild(el("table", { className: "mtable" }, [el("thead", {}, [head]), body]));
  }

  function renderAlerts() {
    var box = $("alerts");
    clear(box);
    var c = leadCounters();
    if (c.overdue) {
      var b1 = el("button", { className: "btn btn--danger btn--sm", text: "Xem danh sách", attrs: { type: "button" } });
      b1.addEventListener("click", function () { goLeads({ chip: "overdue" }); });
      box.appendChild(el("div", { className: "alert-row alert-row--danger", attrs: { role: "alert" } }, [
        el("span", { text: c.overdue + " khách “Mới” đã quá 24 giờ chưa được liên hệ." }), b1]));
    }
    if (c.today) {
      var b2 = el("button", { className: "btn btn--ghost btn--sm", text: "Xem khách cần gọi", attrs: { type: "button" } });
      b2.addEventListener("click", function () { goLeads({ chip: "today" }); });
      box.appendChild(el("div", { className: "alert-row alert-row--gold" }, [
        el("span", { text: c.today + " khách hẹn gọi lại hôm nay (hoặc đã qua ngày hẹn)." }), b2]));
    }
    $("count-leads").textContent = state.leads.length;
    $("count-dups").textContent = state.dups.length;
  }

  /* ---------------- Khách đăng ký: lọc & hiển thị ---------------- */

  function filteredLeads() {
    var f = state.filter;
    var from = dateInputToTs(f.from);
    var to = dateInputToTs(f.to);
    if (to !== null) to += DAY;
    var q = f.q.trim();
    var qDigits = /^[\d\s.+\-]+$/.test(q) ? phoneDigits(q) : "";
    var qFold = fold(q);
    var now = Date.now();

    return state.leads.filter(function (l) {
      if (f.tab !== "all" && l.formKey !== f.tab) return false;
      if (f.chip.indexOf("s:") === 0 && l.status !== f.chip.slice(2)) return false;
      if (f.chip === "overdue" && !isOverdue(l, now)) return false;
      if (f.chip === "today" && !followDue(l)) return false;
      if (f.source && l.src !== f.source) return false;
      if (f.kind === "repeat" && l.count < 2) return false;
      if (f.kind === "old" && !l.oldIds.length) return false;
      if (f.kind === "noemail" && l.email) return false;
      if (from !== null && l.timestamp < from) return false;
      if (to !== null && l.timestamp >= to) return false;
      if (q) {
        if (qDigits && phoneDigits(l.phone).indexOf(qDigits) >= 0) return true;
        var hay = fold([l.id, l.name, l.email, l.phone, l.field, l.contact, l.details, l.note, l.page, l.status,
          l.updatedBy, l.source, l.src, l.uc].join(" "));
        return hay.indexOf(qFold) >= 0;
      }
      return true;
    }).sort(function (a, b) { return b.timestamp - a.timestamp || b.row - a.row; });
  }

  function renderChips() {
    var box = $("f-status-chips");
    clear(box);
    var c = leadCounters();
    var items = [{ v: "", label: "Tất cả", n: state.leads.length }];
    state.statuses.forEach(function (s) { items.push({ v: "s:" + s, label: s, n: c.byStatus[s] || 0 }); });
    items.push({ v: "overdue", label: "Quá hạn", n: c.overdue, cls: "chip--danger" });
    items.push({ v: "today", label: "Cần gọi hôm nay", n: c.today });
    items.forEach(function (it) {
      box.appendChild(el("button", { className: "chip" + (it.cls ? " " + it.cls : ""),
        attrs: { type: "button", "data-chip": it.v, "aria-pressed": state.filter.chip === it.v ? "true" : "false" } }, [
        it.label, el("span", { className: "chip__n", text: String(it.n) })
      ]));
    });
  }

  function renderSourceOptions() {
    var sel = $("f-source");
    var current = state.filter.source;
    var seen = {};
    state.leads.forEach(function (l) { seen[l.src] = (seen[l.src] || 0) + 1; });
    var keys = Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a]; });
    clear(sel);
    sel.appendChild(el("option", { text: "Tất cả nguồn", attrs: { value: "" } }));
    keys.forEach(function (s) { sel.appendChild(el("option", { text: s + " (" + seen[s] + ")", attrs: { value: s } })); });
    sel.value = seen[current] ? current : "";
    state.filter.source = sel.value;
  }

  function fieldBadge(l) {
    return el("span", { className: "badge badge--field badge--" + l.formKey, text: FIELD_SHORT[l.formKey] || l.field || "Không rõ",
      attrs: { title: l.field || "" } });
  }

  function leadBadges(l) {
    var out = [];
    if (isOverdue(l)) out.push(el("span", { className: "badge badge--overdue", text: "Quá hạn 24h" }));
    if (l.count > 1) out.push(el("span", { className: "badge badge--repeat", text: "Đăng ký " + l.count + " lần" }));
    if (l.oldIds.length) out.push(el("span", { className: "badge badge--old", text: "Khách cũ" }));
    if (l.followUp && CLOSED.indexOf(l.status) < 0) {
      var due = followDue(l);
      out.push(el("span", { className: "badge " + (due ? "badge--follow-due" : "badge--follow"),
        text: (due && followTs(l) < startOfDay(Date.now()) ? "Quá ngày hẹn " : "Hẹn gọi ") + l.followUp.slice(0, 5) }));
    }
    return out;
  }

  function actionLinks(l) {
    var who = l.name || fmtPhone(l.phone);
    return [
      el("a", { className: "btn btn--primary btn--sm", text: "Gọi", attrs: { href: telHref(l.phone), "aria-label": "Gọi " + who } }),
      el("a", { className: "btn btn--zalo btn--sm", text: "Zalo", attrs: { href: zaloHref(l.phone), target: "_blank", rel: "noopener noreferrer", "aria-label": "Nhắn Zalo cho " + who } }),
      el("button", { className: "btn btn--ghost btn--sm", text: "Chi tiết", attrs: { type: "button", "data-open": l.id, "aria-label": "Xem chi tiết " + who } })
    ];
  }

  function statusSelect(l) {
    var sel = el("select", { className: "status-select status status--" + statusIndex(l.status),
      attrs: { "data-status-for": l.id, "aria-label": "Trạng thái của " + (l.name || fmtPhone(l.phone)) } });
    var opts = state.statuses.slice();
    if (opts.indexOf(l.status) < 0) opts.unshift(l.status);
    opts.forEach(function (s) { sel.appendChild(el("option", { text: s, attrs: { value: s } })); });
    sel.value = l.status;
    return sel;
  }

  function custBlock(l) {
    return el("div", { className: "cust" }, [
      el("span", { className: "cust__name" + (l.name ? "" : " cust__name--none"), text: l.name || "(Chưa có tên)" }),
      el("span", { className: "cust__phone", text: fmtPhone(l.phone) }),
      l.email ? el("span", { className: "cust__email", text: l.email }) : null,
      el("div", { className: "badges" }, leadBadges(l))
    ]);
  }

  function needBlock(l) {
    var p = needParts(l.details);
    var node = el("div", { className: "need", attrs: { title: l.details || "" } });
    if (!p.main) { node.textContent = "—"; return node; }
    node.appendChild(el("span", { className: "need__main", text: p.main }));
    if (p.rest) node.appendChild(document.createTextNode(" — " + p.rest));
    return node;
  }

  function renderRow(l, idx) {
    var cls = isOverdue(l) ? "row-overdue" : l.status === DEFAULT_STATUSES[0] ? "row-new" : "";
    var kind = sourceKind(l);
    return el("tr", { className: cls, attrs: { "data-id": l.id } }, [
      el("td", { className: "cell-no", text: String(idx + 1) }),
      el("td", {}, [custBlock(l)]),
      el("td", {}, [fieldBadge(l)]),
      el("td", {}, [needBlock(l)]),
      el("td", { attrs: { title: l.source + (l.uc ? " · " + l.uc : "") } }, [
        el("div", { className: "cell-src", text: l.src }),
        kind ? el("span", { className: "cell-ago", text: kind }) : null
      ]),
      el("td", {}, [el("div", { className: "cell-time" }, [fmtShort(l.timestamp),
        el("span", { className: "cell-ago", text: ago(l.timestamp) })])]),
      el("td", {}, [statusSelect(l), el("span", { className: "saved", attrs: { "data-saved-for": l.id, "aria-live": "polite" } })]),
      el("td", {}, [el("div", { className: "cell-actions" }, actionLinks(l))])
    ]);
  }

  function renderCard(l) {
    var overdue = isOverdue(l);
    var badges = leadBadges(l);
    var kind = sourceKind(l);
    return el("article", { className: "card" + (overdue ? " card--overdue" : l.status === DEFAULT_STATUSES[0] ? " card--new" : ""), attrs: { "data-id": l.id } }, [
      el("div", { className: "card__line" }, [fieldBadge(l), el("span", { className: "card__meta", text: fmtShort(l.timestamp) + " · " + ago(l.timestamp) })]),
      el("div", { className: "card__name" + (l.name ? "" : " cust__name--none"), text: l.name || "(Chưa có tên)" }),
      el("div", { className: "card__phone", text: fmtPhone(l.phone) }),
      l.email ? el("div", { className: "cust__email", text: l.email }) : null,
      badges.length ? el("div", { className: "badges" }, badges) : null,
      needBlock(l),
      el("div", { className: "card__meta", text: "Nguồn: " + l.src + (kind ? " (" + kind + ")" : "") + (l.contact ? " · Muốn liên hệ qua " + l.contact : "") }),
      el("div", { className: "card__status" }, [
        el("span", { className: "card__status-label", text: "Trạng thái" }),
        statusSelect(l),
        el("span", { className: "saved", attrs: { "data-saved-for": l.id, "aria-live": "polite" } })
      ]),
      el("div", { className: "card__actions" }, actionLinks(l))
    ]);
  }

  function renderLeads(networkError) {
    var list = filteredLeads();
    var tbody = $("lead-rows");
    var cards = $("lead-cards");
    clear(tbody);
    clear(cards);
    var fr = document.createDocumentFragment();
    var fc = document.createDocumentFragment();
    list.forEach(function (l, i) { fr.appendChild(renderRow(l, i)); fc.appendChild(renderCard(l)); });
    tbody.appendChild(fr);
    cards.appendChild(fc);

    var empty = list.length === 0;
    $("empty-state").hidden = !empty;
    document.querySelector("#panel-leads .table-wrap").classList.toggle("is-empty", empty);
    if (empty) {
      if (networkError) {
        $("empty-title").textContent = "Chưa tải được danh sách";
        $("empty-text").textContent = "Có thể mạng đang chập chờn. Vui lòng bấm “Làm mới” để thử lại.";
      } else if (!state.leads.length) {
        $("empty-title").textContent = "Chưa có khách đăng ký";
        $("empty-text").textContent = "Khi khách gửi form trên website, thông tin sẽ hiện ở đây.";
      } else {
        $("empty-title").textContent = "Không có khách phù hợp bộ lọc";
        $("empty-text").textContent = "Thử bỏ bớt điều kiện lọc hoặc bấm “Xóa lọc”.";
      }
    }
    $("result-count").textContent = state.leads.length ? "Đang hiện " + list.length + " / " + state.leads.length + " khách" : "";
  }

  function replaceLeadNodes(id, msg, kind) {
    var l = findLead(id);
    if (!l) return;
    Array.prototype.forEach.call(document.querySelectorAll("#lead-rows tr[data-id], #lead-cards [data-id]"), function (node) {
      if (node.getAttribute("data-id") !== id) return;
      var isRow = node.tagName === "TR";
      var idx = isRow ? Number(node.firstChild.textContent) - 1 : 0;
      var fresh = isRow ? renderRow(l, idx) : renderCard(l);
      node.parentNode.replaceChild(fresh, node);
      var s = fresh.querySelector("[data-saved-for]");
      if (s && msg) { s.textContent = msg; s.className = "saved saved--" + kind; }
    });
  }

  function onInlineStatus(e) {
    var sel = e.target.closest ? e.target.closest("[data-status-for]") : null;
    if (!sel) return;
    var id = sel.getAttribute("data-status-for");
    var l = findLead(id);
    if (!l) return;
    var value = sel.value;
    var old = l.status;
    var saved = sel.parentNode.querySelector("[data-saved-for]");
    sel.className = "status-select status status--" + statusIndex(value);
    sel.disabled = true;
    if (saved) { saved.textContent = "Đang lưu…"; saved.className = "saved saved--saving"; }
    api("update", { id: id, status: value, updatedBy: state.name || state.user }).then(function (res) {
      var updated = normalizeLead(res.lead || {});
      for (var i = 0; i < state.leads.length; i++) if (state.leads[i].id === id) state.leads[i] = updated;
      replaceLeadNodes(id, "Đã lưu ✓", "ok");
      afterLeadChanged(id);
      toast("Đã đổi trạng thái " + (updated.name || fmtPhone(updated.phone)) + ": " + old + " → " + updated.status);
    }).catch(function (err) {
      if (isExpired(err)) return sessionExpired();
      replaceLeadNodes(id, "Chưa lưu được: " + err.message, "error");
    });
  }

  function afterLeadChanged(id) {
    renderChips();
    renderAlerts();
    renderBigCards();
    renderLatest();
    if (state.openId === id) {
      var l = findLead(id);
      if (l) { fillDrawer(l, state.dirty); loadHistory(id); }
    }
  }

  function renderDups() {
    var tbody = $("dup-rows");
    var cards = $("dup-cards");
    clear(tbody);
    clear(cards);
    state.dups.forEach(function (d) {
      var who = el("div", { className: "cust" }, [
        el("span", { className: "cust__name" + (d.name ? "" : " cust__name--none"), text: d.name || "(Chưa có tên)" }),
        el("span", { className: "cust__phone", text: fmtPhone(d.phone) }),
        d.email ? el("span", { className: "cust__email", text: d.email }) : null
      ]);
      var open = el("button", { className: "btn btn--ghost btn--sm", text: "Xem khách", attrs: { type: "button", "data-open": d.leadId } });
      tbody.appendChild(el("tr", { attrs: { "data-id": d.leadId } }, [
        el("td", {}, [el("div", { className: "cell-time" }, [fmtShort(d.timestamp), el("span", { className: "cell-ago", text: d.leadId })])]),
        el("td", {}, [who]),
        el("td", {}, [fieldBadge(d)]),
        el("td", {}, [needBlock(d)]),
        el("td", { text: d.reason }),
        el("td", {}, [el("div", { className: "cell-src", text: d.source || "Không rõ" }), d.uc ? el("span", { className: "cell-ago", text: d.uc }) : null]),
        el("td", {}, [open])
      ]));
      var open2 = el("button", { className: "btn btn--ghost btn--sm", text: "Xem khách", attrs: { type: "button", "data-open": d.leadId } });
      cards.appendChild(el("article", { className: "card", attrs: { "data-id": d.leadId } }, [
        el("div", { className: "card__line" }, [fieldBadge(d), el("span", { className: "card__meta", text: fmtShort(d.timestamp) })]),
        el("div", { className: "card__name" + (d.name ? "" : " cust__name--none"), text: d.name || "(Chưa có tên)" }),
        el("div", { className: "card__phone", text: fmtPhone(d.phone) }),
        d.email ? el("div", { className: "cust__email", text: d.email }) : null,
        el("div", { className: "card__meta", text: d.reason }),
        needBlock(d),
        open2
      ]));
    });
    var empty = !state.dups.length;
    $("dup-empty").hidden = !empty;
    document.querySelector("#panel-dups .table-wrap").classList.toggle("is-empty", empty);
  }

  /* ---------------- Panel chi tiết ---------------- */

  function findLead(id) {
    for (var i = 0; i < state.leads.length; i++) if (state.leads[i].id === id) return state.leads[i];
    return null;
  }

  function fillContact(l) {
    var title = $("drawer-title");
    title.textContent = l.name || "(Chưa có tên)";
    title.classList.toggle("is-empty", !l.name);
    $("d-phone").textContent = fmtPhone(l.phone);
    var ev = $("d-email-view");
    ev.textContent = l.email ? "Email: " + l.email : "Chưa có email";
    ev.classList.toggle("is-empty", !l.email);
    var mail = $("d-mail");
    if (validEmail(l.email.toLowerCase())) { mail.href = "mailto:" + l.email; mail.hidden = false; }
    else { mail.removeAttribute("href"); mail.hidden = true; }
    $("d-call").href = telHref(l.phone);
    $("d-call").setAttribute("aria-label", "Gọi " + fmtPhone(l.phone));
    $("d-zalo").href = zaloHref(l.phone);
  }

  function fillDrawer(l, keepForm) {
    $("d-id").textContent = l.id;
    fillContact(l);
    var badges = $("d-badges");
    clear(badges);
    leadBadges(l).forEach(function (b) { badges.appendChild(b); });
    $("d-time").textContent = l.time ? l.time + " (" + ago(l.timestamp) + ")" : "—";
    $("d-field").textContent = l.field || "—";
    $("d-contact").textContent = l.contact || "—";
    $("d-count").textContent = l.count > 1 ? l.count + " lần (gần nhất " + (l.lastAt || "—") + ")" : "1 lần";
    var src = l.src + (l.source && l.source !== l.src ? " (" + l.source + ")" : "") + (l.uc ? " · chiến dịch " + l.uc : "");
    var extra = [];
    if (l.ux) extra.push("nội dung: " + l.ux);
    if (l.ut) extra.push("từ khóa: " + l.ut);
    if (l.ref) extra.push("từ " + l.ref);
    $("d-source").textContent = src + (extra.length ? " — " + extra.join("; ") : "");
    $("d-ft").textContent = l.ft || "—";
    $("d-dev").textContent = (DEVICE_LABELS[l.dev] || "Không rõ") + (l.visits ? " · " + l.visits + " lượt truy cập" : "");
    $("d-page").textContent = l.page || "—";
    var oldBox = $("d-old");
    var oldList = $("d-old-list");
    clear(oldList);
    oldBox.hidden = !l.oldIds.length;
    l.oldIds.forEach(function (id) {
      var o = findLead(id);
      var b = el("button", { className: "btn btn--ghost btn--sm", text: (o ? (FIELD_SHORT[o.formKey] || o.field) + " — " + (o.time || id).slice(0, 10) : id), attrs: { type: "button", "data-goto": id } });
      oldList.appendChild(b);
    });
    $("d-details").textContent = l.details || "(Khách không ghi thêm nội dung)";
    $("d-history").textContent = l.updatedBy || l.updatedAt
      ? "Cập nhật gần nhất: " + (l.updatedBy || "—") + " – " + (l.updatedAt || "—")
      : "Chưa có cập nhật nào.";
    if (keepForm) return;

    var sel = $("d-status");
    clear(sel);
    var opts = state.statuses.slice();
    if (opts.indexOf(l.status) < 0) opts.unshift(l.status);
    opts.forEach(function (s) { sel.appendChild(el("option", { text: s, attrs: { value: s } })); });
    sel.value = l.status;
    $("d-follow").value = vnToInput(l.followUp);
    $("d-note").value = l.note;
    $("d-note-count").textContent = l.note.length;
    $("d-name").value = l.name;
    $("d-email").value = l.email;
    state.dirty = false;
  }

  function openDrawer(id) {
    var l = findLead(id);
    if (!l) { toast("Không tìm thấy khách " + id + " trong danh sách hiện tại."); return; }
    if (state.openId && state.openId !== id && state.dirty && !window.confirm("Bạn chưa lưu thay đổi. Vẫn chuyển sang khách khác?")) return;
    if (!state.openId) state.lastFocus = document.activeElement;
    state.openId = id;
    setSaveStatus("", "");
    setContactStatus("", "");
    $("d-edit").open = !l.name;
    fillDrawer(l, false);
    clear($("d-timeline"));
    clear($("d-journey"));
    $("drawer-overlay").hidden = false;
    $("drawer").hidden = false;
    document.body.style.overflow = "hidden";
    $("drawer").querySelector(".drawer__body").scrollTop = 0;
    $("drawer-close").focus();
    loadHistory(id);
    loadJourney(l);
  }

  var historyToken = 0;
  function loadHistory(id) {
    var token = ++historyToken;
    var list = $("d-timeline");
    var status = $("d-timeline-status");
    var retry = $("d-timeline-retry");
    retry.hidden = true;
    if (!list.firstChild) status.textContent = "Đang tải lịch sử…";
    api("history", { id: id }).then(function (res) {
      if (token !== historyToken || state.openId !== id) return;
      renderTimeline(res.history || []);
    }).catch(function (err) {
      if (token !== historyToken || state.openId !== id) return;
      if (isExpired(err)) return sessionExpired();
      clear(list);
      status.textContent = "Chưa tải được lịch sử: " + err.message;
      retry.hidden = false;
    });
  }

  function renderTimeline(items) {
    var list = $("d-timeline");
    clear(list);
    $("d-timeline-status").textContent = items.length ? "" : "Chưa có lịch sử cho khách này.";
    items.forEach(function (h) {
      var change = String(h.change || "");
      var isCreate = change.indexOf("Tạo mới") === 0;
      list.appendChild(el("li", { className: "timeline__item" + (isCreate ? " timeline__item--create" : "") }, [
        el("div", { className: "timeline__meta" }, [el("strong", { text: String(h.by || "—") }), " – " + String(h.time || "—")]),
        el("p", { className: "timeline__change", text: change })
      ]));
    });
  }

  var EVENT_TEXT = {
    pageview: function (e) { return "Xem trang " + (e.pageLabel || e.detail || e.page || ""); },
    scroll_50: function () { return "Cuộn xem nửa trang"; },
    scroll_90: function () { return "Cuộn xem gần hết trang"; },
    cta_click: function (e) { return "Bấm nút Đăng ký — " + (e.detail || "không rõ vị trí"); },
    form_start: function (e) { return "Bắt đầu điền form " + (e.detail || ""); },
    zalo_click: function (e) { return "Bấm Zalo — " + (e.detail || ""); },
    call_click: function (e) { return "Bấm Gọi điện — " + (e.detail || ""); },
    video_play: function (e) { return "Xem video “" + (e.detail || "") + "”"; },
    video_complete: function (e) { return "Xem hết video “" + (e.detail || "") + "”"; },
    lead: function (e) { return "ĐĂNG KÝ THÀNH CÔNG — " + (e.detail || ""); },
    lead_dup: function (e) { return "Đăng ký lại — " + (e.detail || ""); }
  };

  var journeyToken = 0;
  function loadJourney(l) {
    var token = ++journeyToken;
    var box = $("d-journey");
    var status = $("d-journey-status");
    var retry = $("d-journey-retry");
    retry.hidden = true;
    clear(box);
    if (!l.vid) {
      renderRawJourney(l, "Khách đăng ký khi website chưa bật ghi nhận truy cập (hoặc trình duyệt chặn), nên chưa có hành trình chi tiết.");
      return;
    }
    status.textContent = "Đang tải hành trình…";
    api("journey", { vid: l.vid }).then(function (res) {
      if (token !== journeyToken || state.openId !== l.id) return;
      var evs = res.events || [];
      if (!evs.length) return renderRawJourney(l, "Chưa có sự kiện truy cập nào của khách này trong sheet “Truy cập”.");
      renderJourney(evs);
    }).catch(function (err) {
      if (token !== journeyToken || state.openId !== l.id) return;
      if (isExpired(err)) return sessionExpired();
      status.textContent = "Chưa tải được hành trình: " + err.message;
      retry.hidden = false;
    });
  }

  function renderRawJourney(l, message) {
    var box = $("d-journey");
    clear(box);
    $("d-journey-status").textContent = l.journey ? "Hành trình trình duyệt ghi lại lúc khách gửi form:" : message;
    if (l.journey) box.appendChild(el("p", { className: "journey__raw", text: l.journey }));
  }

  function renderJourney(evs) {
    var box = $("d-journey");
    clear(box);
    var sessions = [];
    var bySess = {};
    evs.forEach(function (e) {
      var key = e.sess || "phien";
      if (!bySess[key]) { bySess[key] = { first: e, items: [] }; sessions.push(bySess[key]); }
      bySess[key].items.push(e);
    });
    $("d-journey-status").textContent = sessions.length + " lần truy cập, " + evs.length + " thao tác (cũ nhất ở trên).";
    sessions.forEach(function (s, i) {
      var f = s.first;
      var d = new Date(Number(f.t));
      var head = el("div", { className: "journey__head" }, [
        "Lần " + (i + 1) + " · " + fmtDate(d),
        el("span", { className: "sub", text: "Nguồn: " + (f.source || "Không rõ") + (f.uc ? " · " + f.uc : "") +
          (DEVICE_LABELS[f.dev] ? " · " + DEVICE_LABELS[f.dev] : "") })
      ]);
      var ol = el("ol", { className: "timeline" });
      s.items.forEach(function (e) {
        var txt = (EVENT_TEXT[e.ev] || function () { return e.ev; })(e);
        var isLead = e.ev === "lead" || e.ev === "lead_dup";
        ol.appendChild(el("li", { className: "timeline__item" + (isLead ? " timeline__item--lead" : "") }, [
          el("div", { className: "timeline__meta", text: fmtTime(new Date(Number(e.t))) }),
          el("p", { className: "timeline__change", text: txt })
        ]));
      });
      box.appendChild(el("div", { className: "journey__sess" }, [head, ol]));
    });
  }

  function closeDrawer(force) {
    if ($("drawer").hidden) return;
    if (!force && state.dirty && !window.confirm("Bạn chưa lưu thay đổi. Vẫn đóng panel?")) return;
    $("drawer").hidden = true;
    $("drawer-overlay").hidden = true;
    document.body.style.overflow = "";
    state.openId = null;
    state.dirty = false;
    if (state.lastFocus && document.body.contains(state.lastFocus)) state.lastFocus.focus();
  }

  function refreshOpenDrawer() {
    if (!state.openId || $("drawer").hidden) return;
    var l = findLead(state.openId);
    if (l) fillDrawer(l, state.dirty);
  }

  function setSaveStatus(text, kind) {
    var s = $("d-save-status");
    s.textContent = text;
    s.className = "save-status" + (kind ? " save-status--" + kind : "");
  }
  function setContactStatus(text, kind) {
    var s = $("d-contact-status");
    s.textContent = text;
    s.className = "save-status" + (kind ? " save-status--" + kind : "");
  }

  function markDirty() { state.dirty = true; setSaveStatus("Chưa lưu", ""); }

  function applyUpdated(id, res) {
    var updated = normalizeLead(res.lead || {});
    for (var i = 0; i < state.leads.length; i++) if (state.leads[i].id === id) state.leads[i] = updated;
    return updated;
  }

  function onSave(e) {
    e.preventDefault();
    var id = state.openId;
    if (!id) return;
    var note = $("d-note").value;
    if (note.length > 1000) { setSaveStatus("Ghi chú tối đa 1000 ký tự.", "error"); return; }
    var followRaw = $("d-follow").value;
    if (followRaw && !inputToVn(followRaw)) { setSaveStatus("Ngày hẹn chưa đúng.", "error"); return; }
    var btn = $("d-save");
    btn.disabled = true;
    setSaveStatus("Đang lưu…", "saving");

    api("update", { id: id, status: $("d-status").value, note: note, followUp: inputToVn(followRaw), updatedBy: state.name || state.user })
      .then(function (res) {
        var updated = applyUpdated(id, res);
        state.dirty = false;
        if (res.changed === false) {
          if (state.openId === id) fillDrawer(updated, false);
          setSaveStatus("Không có thay đổi nào để lưu.", "");
          return;
        }
        renderLeads();
        afterLeadChanged(id);
        if (state.openId === id) fillDrawer(updated, false);
        setSaveStatus("Đã lưu ✓", "ok");
      })
      .catch(function (err) {
        if (isExpired(err)) { state.dirty = false; return sessionExpired(); }
        setSaveStatus("Chưa lưu được: " + err.message, "error");
      })
      .then(function () { btn.disabled = false; });
  }

  function onContactSave(e) {
    e.preventDefault();
    var id = state.openId;
    var l = findLead(id);
    if (!l) return;
    var name = cleanName($("d-name").value);
    var email = cleanEmail($("d-email").value);
    var err = nameError(name);
    if (err) { setContactStatus(err, "error"); $("d-name").focus(); return; }
    err = emailError(email);
    if (err) { setContactStatus(err, "error"); $("d-email").focus(); return; }
    var btn = $("d-contact-save");
    btn.disabled = true;
    setContactStatus("Đang lưu…", "saving");
    api("update", { id: id, name: name, email: email, updatedBy: state.name || state.user })
      .then(function (res) {
        var updated = applyUpdated(id, res);
        if (res.changed === false) { setContactStatus("Không có thay đổi nào để lưu.", ""); return; }
        renderLeads();
        renderDups();
        afterLeadChanged(id);
        if (state.openId === id) { fillContact(updated); $("d-name").value = updated.name; $("d-email").value = updated.email; }
        setContactStatus("Đã lưu ✓", "ok");
      })
      .catch(function (err2) {
        if (isExpired(err2)) return sessionExpired();
        setContactStatus("Chưa lưu được: " + err2.message, "error");
      })
      .then(function () { btn.disabled = false; });
  }

  function trapFocus(e) {
    if (e.key !== "Tab" || $("drawer").hidden) return;
    var nodes = Array.prototype.filter.call($("drawer").querySelectorAll("a[href], button:not([disabled]), select, textarea, input, summary"),
      function (n) { return n.offsetParent !== null; });
    if (!nodes.length) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }

  function copyPhone() {
    var l = findLead(state.openId);
    if (!l) return;
    var text = phoneDigits(l.phone);
    var done = function () { toast("Đã sao chép số " + fmtPhone(text)); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else {
      fallbackCopy(text);
      done();
    }
  }

  function fallbackCopy(text) {
    var ta = el("textarea", { attrs: { readonly: "" } });
    ta.style.position = "fixed";
    ta.style.top = "-100px";
    ta.style.opacity = "0";
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { /* bỏ qua */ }
    document.body.removeChild(ta);
  }

  /* ---------------- Xuất CSV ---------------- */

  function csvCell(v, isPhone) {
    var s = String(v === undefined || v === null ? "" : v);
    if (isPhone && /^\d+$/.test(s)) s = '="' + s + '"';
    else if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function buildCsv(list) {
    var lines = [CSV_HEADERS.map(function (h) { return csvCell(h); }).join(",")];
    list.forEach(function (l) {
      lines.push([
        csvCell(l.id), csvCell(l.time), csvCell(l.name), csvCell(phoneDigits(l.phone), true), csvCell(l.email),
        csvCell(l.field), csvCell(l.details), csvCell(l.contact), csvCell(l.status), csvCell(l.note),
        csvCell(l.followUp), csvCell(l.count), csvCell(l.lastAt), csvCell(l.oldIds.join(", ")),
        csvCell(l.updatedBy), csvCell(l.updatedAt), csvCell(l.page),
        csvCell(l.us), csvCell(l.um), csvCell(l.uc), csvCell(l.ux), csvCell(l.ut), csvCell(l.ft), csvCell(l.ref),
        csvCell(DEVICE_LABELS[l.dev] || l.dev), csvCell(l.vid), csvCell(l.visits || ""), csvCell(l.journey),
        csvCell(l.source), csvCell(isOverdue(l) ? "Có" : "")
      ].join(","));
    });
    return "\uFEFF" + lines.join("\r\n");
  }

  function exportCsv() {
    var list = filteredLeads();
    if (!list.length) { toast("Không có dữ liệu để xuất theo bộ lọc hiện tại."); return; }
    var blob = new Blob([buildCsv(list)], { type: "text/csv;charset=utf-8" });
    var d = new Date();
    var name = "khach-dang-ky-" + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + ".csv";
    var url = URL.createObjectURL(blob);
    var a = el("a", { attrs: { href: url, download: name } });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("Đã xuất " + list.length + " khách ra tệp " + name);
  }

  /* ---------------- Điều hướng ---------------- */

  function showPanel(name, silent) {
    state.panel = name;
    ["overview", "leads", "dups"].forEach(function (p) {
      $("panel-" + p).hidden = p !== name;
      $("tab-" + p).setAttribute("aria-selected", p === name ? "true" : "false");
      $("tab-" + p).tabIndex = p === name ? 0 : -1;
    });
    if (!silent) window.scrollTo(0, 0);
  }

  function setTab(tab) {
    state.filter.tab = tab;
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-tab") === tab ? "true" : "false");
    });
    renderLeads();
  }

  function setChip(v) {
    state.filter.chip = v;
    Array.prototype.forEach.call(document.querySelectorAll("#f-status-chips [data-chip]"), function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-chip") === v ? "true" : "false");
    });
  }

  function resetFilters() {
    $("f-search").value = "";
    $("f-source").value = "";
    $("f-kind").value = "";
    $("f-from").value = "";
    $("f-to").value = "";
    state.filter = emptyFilter();
    setChip("");
  }

  function goLeads(opts) {
    resetFilters();
    if (opts.chip) setChip(opts.chip);
    if (opts.from) {
      state.filter.from = tsToInput(opts.from);
      $("f-from").value = state.filter.from;
      $("f-more").open = true;
    }
    showPanel("leads");
    setTab("all");
  }

  function onListClick(e) {
    var target = e.target;
    var openBtn = target.closest("[data-open]");
    if (openBtn) { openDrawer(openBtn.getAttribute("data-open")); return; }
    if (target.closest("a, button, select, label, .saved")) return;
    var item = target.closest("[data-id]");
    if (item) openDrawer(item.getAttribute("data-id"));
  }

  function bind() {
    $("login-form").addEventListener("submit", onLogin);
    $("login-toggle").addEventListener("click", function () { setPwVisible($("login-pass").type === "password"); });

    $("btn-refresh").addEventListener("click", function () { loadAll(); });
    $("btn-csv").addEventListener("click", exportCsv);
    $("btn-logout").addEventListener("click", logout);
    Array.prototype.forEach.call(document.querySelectorAll(".textsize__btn"), function (b) {
      b.addEventListener("click", function () {
        var size = b.getAttribute("data-size") === "lg" ? "lg" : "md";
        lsSet(LS_SIZE, size);
        applyTextSize(size);
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll(".mainnav__tab"), function (b) {
      b.addEventListener("click", function () { showPanel(b.getAttribute("data-panel")); });
      b.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        var order = ["overview", "leads", "dups"];
        var i = order.indexOf(b.getAttribute("data-panel")) + (e.key === "ArrowRight" ? 1 : -1);
        var next = order[(i + order.length) % order.length];
        showPanel(next, true);
        $("tab-" + next).focus();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".seg__btn"), function (b) {
      b.addEventListener("click", function () {
        var r = b.getAttribute("data-range");
        if (r === state.range) return;
        state.range = r;
        Array.prototype.forEach.call(document.querySelectorAll(".seg__btn"), function (x) {
          x.setAttribute("aria-pressed", x === b ? "true" : "false");
        });
        renderBigCards();
        loadStats();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
      b.addEventListener("click", function () { setTab(b.getAttribute("data-tab")); });
    });
    $("f-status-chips").addEventListener("click", function (e) {
      var b = e.target.closest("[data-chip]");
      if (!b) return;
      setChip(b.getAttribute("data-chip"));
      renderLeads();
    });
    $("latest-all").addEventListener("click", function () { goLeads({}); });

    var searchTimer = null;
    $("f-search").addEventListener("input", function () {
      var v = this.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { state.filter.q = v; renderLeads(); }, 150);
    });
    [["f-source", "source"], ["f-kind", "kind"], ["f-from", "from"], ["f-to", "to"]].forEach(function (p) {
      $(p[0]).addEventListener("change", function () { state.filter[p[1]] = this.value; renderLeads(); });
    });
    $("f-clear").addEventListener("click", function () { resetFilters(); setTab("all"); });

    ["lead-rows", "lead-cards", "dup-rows", "dup-cards", "latest"].forEach(function (id) { $(id).addEventListener("click", onListClick); });
    ["lead-rows", "lead-cards"].forEach(function (id) { $(id).addEventListener("change", onInlineStatus); });

    $("drawer-close").addEventListener("click", function () { closeDrawer(false); });
    $("drawer-overlay").addEventListener("click", function () { closeDrawer(false); });
    $("d-form").addEventListener("submit", onSave);
    $("d-contact-form").addEventListener("submit", onContactSave);
    $("d-status").addEventListener("change", markDirty);
    $("d-follow").addEventListener("change", markDirty);
    $("d-note").addEventListener("input", function () { $("d-note-count").textContent = this.value.length; markDirty(); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-follow]"), function (b) {
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-follow");
        if (v === "clear") $("d-follow").value = "";
        else $("d-follow").value = tsToInput(startOfDay(Date.now()) + Number(v) * DAY + 12 * 3600 * 1000);
        markDirty();
      });
    });
    $("d-old-list").addEventListener("click", function (e) {
      var b = e.target.closest("[data-goto]");
      if (b) openDrawer(b.getAttribute("data-goto"));
    });
    $("d-copy").addEventListener("click", copyPhone);
    $("d-timeline-retry").addEventListener("click", function () { if (state.openId) loadHistory(state.openId); });
    $("d-journey-retry").addEventListener("click", function () { var l = findLead(state.openId); if (l) loadJourney(l); });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("drawer").hidden) closeDrawer(false);
      trapFocus(e);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible" || $("app-view").hidden || DEMO) return;
      if (state.exp && Date.now() > state.exp) return sessionExpired();
      if (Date.now() - state.lastSync >= REFRESH_MS && !state.dirty) loadAll();
    });
  }

  /* ---------------- Khởi động ---------------- */

  function init() {
    applyTextSize(lsGet(LS_SIZE) === "lg" ? "lg" : "md");
    bind();
    try { sessionStorage.removeItem("ny_admin_key"); sessionStorage.removeItem("ny_admin_user"); } catch (e) { /* bỏ qua */ }
    if (DEMO && LOCAL) $("demo-banner").hidden = false;
    var s = loadSession();
    if (s && (DEMO ? s.token === "demo" : s.token !== "demo")) {
      state.user = String(s.user || "");
      state.name = String(s.name || "");
      if (Date.now() > Number(s.exp)) { sessionExpired(); return; }
      state.token = s.token;
      state.exp = Number(s.exp);
      startApp();
      return;
    }
    showLogin("");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
