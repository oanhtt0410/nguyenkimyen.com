/* Địa chỉ nhận đăng ký lấy từ assets/js/config.js (nạp trước file này).
   LEAD_ENDPOINT trống = KHÔNG gửi dữ liệu ra ngoài: form chỉ hiện bản tóm tắt
   để khách tự gửi qua Zalo hoặc gọi điện. */
const CFG = window.NY_CONFIG || {};
const LEAD_ENDPOINT = (CFG.LEAD_ENDPOINT || "").trim();

(function () {
  "use strict";

  var PHONE_TEL = "tel:0982241411";
  var PHONE_DISPLAY = "0982 241 411";
  var ZALO_URL = "https://zalo.me/" + (String(CFG.ZALO_PHONE || "").replace(/\D/g, "") || "0982241411");
  var SEND_TIMEOUT = 20000;

  var SVG_NS = "http://www.w3.org/2000/svg";

  /* ---------- Menu mobile (drawer) ---------- */
  function initMenu() {
    var toggle = document.querySelector(".menu-toggle");
    var nav = document.getElementById("site-nav");
    var backdrop = document.querySelector(".nav-backdrop");
    if (!toggle || !nav || !backdrop) return;

    var closeBtn = nav.querySelector(".nav-close");
    var desktop = window.matchMedia("(min-width: 1024px)");

    function isOpen() {
      return toggle.getAttribute("aria-expanded") === "true";
    }

    function focusables() {
      return Array.prototype.slice.call(nav.querySelectorAll("a[href], button:not([disabled])"));
    }

    function open() {
      nav.classList.add("is-open");
      backdrop.hidden = false;
      requestAnimationFrame(function () { backdrop.classList.add("is-visible"); });
      toggle.setAttribute("aria-expanded", "true");
      document.body.classList.add("menu-open");
      var first = nav.querySelector(".nav-list a");
      if (first) first.focus();
    }

    function close(returnFocus) {
      if (!isOpen()) return;
      nav.classList.remove("is-open");
      backdrop.classList.remove("is-visible");
      backdrop.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      document.body.classList.remove("menu-open");
      if (returnFocus) toggle.focus();
    }

    toggle.addEventListener("click", function () {
      if (isOpen()) close(true); else open();
    });
    if (closeBtn) closeBtn.addEventListener("click", function () { close(true); });
    backdrop.addEventListener("click", function () { close(true); });

    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) close(false);
    });

    document.addEventListener("keydown", function (e) {
      if (!isOpen()) return;
      if (e.key === "Escape") {
        close(true);
        return;
      }
      if (e.key === "Tab") {
        var items = focusables();
        if (!items.length) return;
        var first = items[0];
        var last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    var onChange = function (mq) { if (mq.matches) close(false); };
    if (desktop.addEventListener) desktop.addEventListener("change", onChange);
    else if (desktop.addListener) desktop.addListener(onChange);
  }

  /* ---------- Hiện dần khi cuộn ---------- */
  function initReveal() {
    var items = document.querySelectorAll(".reveal");
    if (!items.length) return;
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      items.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Tiện ích ---------- */
  function normalizePhone(raw) {
    var s = String(raw || "").replace(/[\s.\-()]/g, "");
    var m = s.match(/^(?:0|\+?840?)([35789]\d{8})$/);
    return m ? "0" + m[1] : null;
  }

  function formatPhone(p) {
    return p.replace(/^(\d{4})(\d{3})(\d{3})$/, "$1 $2 $3");
  }

  // Trình duyệt cũ không hỗ trợ \p{L} thì dùng dải chữ Latin + tiếng Việt.
  var LETTER_RE = (function () {
    try { return new RegExp("\\p{L}", "u"); } catch (e) { return /[A-Za-zÀ-ỹ]/; }
  })();
  var EMAIL_RE = /^[a-z0-9._%+\-]+@[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?)*\.[a-z]{2,}$/;

  function cleanName(raw) {
    return String(raw || "").replace(/\s+/g, " ").trim();
  }

  function cleanEmail(raw) {
    return String(raw || "").trim().toLowerCase();
  }

  function nameError(value) {
    if (!value) return "Vui lòng nhập họ và tên.";
    if (value.length < 2 || value.length > 80) return "Họ và tên cần từ 2 đến 80 ký tự.";
    if (!LETTER_RE.test(value)) return "Họ và tên chưa đúng. Vui lòng nhập họ tên bằng chữ, ví dụ Nguyễn Thị Lan.";
    return "";
  }

  function emailError(value) {
    if (!value) return "";
    if (value.length > 120 || !EMAIL_RE.test(value) || value.indexOf("..") >= 0) {
      return "Email chưa đúng định dạng, ví dụ ten@gmail.com. Nếu không có email, vui lòng để trống.";
    }
    return "";
  }

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    }
    if (text) node.textContent = text;
    return node;
  }

  function icon(paths) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "i");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    paths.forEach(function (d) {
      var p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", d);
      svg.appendChild(p);
    });
    return svg;
  }

  var ICON_PHONE = ["M5 4h3.2l1.8 4.6-2.3 1.5a11 11 0 0 0 6.2 6.2l1.5-2.3L20 15.8V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"];
  var ICON_CHAT = ["M4 5h16v11H10l-4 3.5V16H4z", "M8 9.5h8", "M8 12.5h5"];
  var ICON_CHECK = ["M5 12.5l4.2 4.2L19 7"];

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return fallbackCopy(text); }
      );
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    ta.style.fontSize = "16px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { ta.setSelectionRange(0, text.length); } catch (e) { /* bỏ qua */ }
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  /* ---------- Link thư mục khi mở trực tiếp bằng file:// ---------- */
  function fixFileLinks() {
    if (location.protocol !== "file:") return;
    document.querySelectorAll("a[href]").forEach(function (a) {
      var href = a.getAttribute("href");
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) return;
      var hashAt = href.indexOf("#");
      var path = hashAt < 0 ? href : href.slice(0, hashAt);
      var hash = hashAt < 0 ? "" : href.slice(hashAt);
      if (path && path.charAt(path.length - 1) === "/") {
        a.setAttribute("href", path + "index.html" + hash);
      }
    });
  }

  /* ---------- Form đăng ký dùng chung ---------- */
  function initForms() {
    document.querySelectorAll("form[data-form]").forEach(setupForm);
  }

  function fieldInputs(field) {
    return Array.prototype.slice.call(field.querySelectorAll("input, textarea, select"));
  }

  function setupForm(form) {
    var fields = Array.prototype.slice.call(form.querySelectorAll(".field"));

    // Nhóm radio/checkbox: gắn mô tả lỗi của nhóm cho từng ô chọn.
    fields.forEach(function (field) {
      var describedBy = field.getAttribute("aria-describedby");
      if (field.tagName === "FIELDSET" && describedBy) {
        fieldInputs(field).forEach(function (input) {
          var own = input.getAttribute("aria-describedby");
          input.setAttribute("aria-describedby", own ? own + " " + describedBy : describedBy);
        });
      }
    });

    form.querySelectorAll("textarea[maxlength]").forEach(function (ta) {
      var counterId = ta.getAttribute("data-counter");
      var counter = counterId && document.getElementById(counterId);
      if (!counter) return;
      var max = ta.getAttribute("maxlength");
      var update = function () { counter.textContent = ta.value.length + "/" + max + " ký tự"; };
      ta.addEventListener("input", update);
      update();
    });

    function revalidate(e) {
      if (form.getAttribute("data-submitted") !== "true") return;
      var field = e.target.closest(".field");
      if (field) validateField(field);
    }
    form.addEventListener("input", revalidate);
    form.addEventListener("change", revalidate);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (form.getAttribute("data-sending") === "true") return;
      form.setAttribute("data-submitted", "true");
      var status = form.querySelector(".form-status");
      if (status) status.textContent = "";

      var invalid = fields.filter(function (f) { return !validateField(f); });
      if (invalid.length) {
        if (status) {
          status.textContent = invalid.length === 1
            ? "Vui lòng kiểm tra lại 1 mục được đánh dấu bên dưới."
            : "Vui lòng kiểm tra lại " + invalid.length + " mục được đánh dấu bên dưới.";
        }
        focusField(invalid[0]);
        return;
      }

      var data = collect(form, fields);
      if (!LEAD_ENDPOINT) {
        showConfirm(form, data.summary, data.name);
      } else {
        sendLead(form, data);
      }
    });
  }

  function focusField(field) {
    var inputs = fieldInputs(field);
    if (!inputs.length) return;
    var target = inputs.filter(function (i) { return i.checked; })[0] || inputs[0];
    target.focus();
  }

  function setError(field, message) {
    var error = field.querySelector(".field-error");
    var inputs = fieldInputs(field);
    if (message) {
      field.classList.add("has-error");
      if (error) {
        error.textContent = message;
        error.hidden = false;
      }
      inputs.forEach(function (i) { i.setAttribute("aria-invalid", "true"); });
    } else {
      field.classList.remove("has-error");
      if (error) {
        error.textContent = "";
        error.hidden = true;
      }
      inputs.forEach(function (i) { i.removeAttribute("aria-invalid"); });
    }
  }

  function validateField(field) {
    var type = field.getAttribute("data-type");
    var required = field.hasAttribute("data-required");
    var customMsg = field.getAttribute("data-error");
    var inputs = fieldInputs(field);
    var message = "";

    if (type === "name") {
      message = nameError(cleanName(inputs[0].value));
    } else if (type === "email") {
      message = emailError(cleanEmail(inputs[0].value));
    } else if (type === "phone") {
      var value = inputs[0].value.trim();
      if (!value) {
        message = "Vui lòng nhập số điện thoại.";
      } else if (!normalizePhone(value)) {
        message = "Số điện thoại chưa đúng. Vui lòng nhập số di động Việt Nam gồm 10 số, ví dụ 0982 241 411.";
      }
    } else if (type === "radio" && required) {
      if (!inputs.some(function (i) { return i.checked; })) {
        message = customMsg || "Vui lòng chọn một mục.";
      }
    } else if (type === "checkbox" && required) {
      if (!inputs.some(function (i) { return i.checked; })) {
        message = customMsg || "Vui lòng chọn ít nhất một mục.";
      }
    } else if (type === "consent") {
      if (!inputs[0].checked) {
        message = customMsg || "Vui lòng đánh dấu ô đồng ý để Nguyễn Yến có thể liên hệ lại.";
      }
    }

    setError(field, message);
    return !message;
  }

  function checkedValues(inputs) {
    return inputs.filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
  }

  /* payload gửi Apps Script: fields chỉ gồm các câu trả lời khác
     (không lặp họ tên, SĐT, email, kênh liên hệ, đồng ý), bỏ mục để trống. */
  function collect(form, fields) {
    var name = "";
    var phone = "";
    var email = "";
    var contact = "";
    var details = {};
    var lines = [form.getAttribute("data-title") || "Đăng ký"];

    fields.forEach(function (field) {
      var type = field.getAttribute("data-type");
      var label = field.getAttribute("data-label");
      var inputs = fieldInputs(field);
      var value = "";

      if (type === "name") {
        name = cleanName(inputs[0].value);
        lines.push("Họ tên: " + name);
        return;
      }
      if (type === "phone") {
        phone = normalizePhone(inputs[0].value);
        lines.push("SĐT: " + formatPhone(phone));
        return;
      }
      if (type === "email") {
        email = cleanEmail(inputs[0].value);
        if (email) lines.push("Email: " + email);
        return;
      }
      if (type === "consent") return;
      if (type === "radio" || type === "checkbox") {
        value = checkedValues(inputs).join(", ");
      } else if (type === "text") {
        value = inputs[0].value.trim();
      }
      if (!value) return;
      if (label) lines.push(label + ": " + value);
      if (field.getAttribute("data-role") === "contact") {
        contact = value;
      } else if (label) {
        details[label] = value;
      }
    });

    var trap = form.querySelector('input[name="website"]');
    var payload = {
      action: "lead",
      form: form.getAttribute("data-form"),
      page: location.pathname,
      time: new Date().toISOString(),
      name: name,
      phone: phone,
      email: email,
      contact: contact,
      consent: true,
      fields: details,
      website: trap ? trap.value : ""
    };
    var track = window.NY_TRACK && window.NY_TRACK.leadFields();
    if (track) payload.track = track;

    return { payload: payload, name: name, contact: contact, summary: lines.join("\n") };
  }

  function getResultBox(form) {
    var box = form.parentNode.querySelector(".result-box");
    if (box) box.parentNode.removeChild(box);
    box = el("div", { "class": "result-box", tabindex: "-1" });
    form.parentNode.insertBefore(box, form.nextSibling);
    return box;
  }

  function hideFormIntro(form, hide) {
    var card = form.closest(".form-card");
    if (!card) return;
    card.querySelectorAll(".form-intro").forEach(function (n) { n.hidden = hide; });
  }

  function showConfirm(form, summary, name) {
    var box = getResultBox(form);

    var badge = el("div", { "class": "result-icon", "aria-hidden": "true" });
    badge.appendChild(icon(ICON_CHECK));
    box.appendChild(badge);
    box.appendChild(el("h3", null, "Cảm ơn " + (name || "bạn") + ", thông tin của bạn đã sẵn sàng"));
    box.appendChild(el("p", null,
      "Trang web chưa tự động gửi dữ liệu. Bấm “Gửi qua Zalo” để sao chép nội dung dưới đây và mở Zalo của Nguyễn Yến, sau đó dán vào khung chat và gửi. Hoặc bấm “Gọi ngay” để trao đổi trực tiếp."));

    var summaryId = form.getAttribute("data-form") + "-summary";
    box.appendChild(el("p", { "class": "confirm-summary", id: summaryId }, summary));

    var actions = el("div", { "class": "confirm-actions" });
    var zalo = el("a", {
      "class": "btn btn-zalo",
      href: ZALO_URL,
      target: "_blank",
      rel: "noopener",
      "aria-describedby": summaryId
    });
    zalo.appendChild(icon(ICON_CHAT));
    zalo.appendChild(document.createTextNode("Gửi qua Zalo"));

    var call = el("a", { "class": "btn btn-outline", href: PHONE_TEL });
    call.appendChild(icon(ICON_PHONE));
    call.appendChild(document.createTextNode("Gọi ngay"));

    actions.appendChild(zalo);
    actions.appendChild(call);
    box.appendChild(actions);

    var status = el("p", { "class": "confirm-status", role: "status", "aria-live": "polite" });
    box.appendChild(status);

    var editWrap = el("p", { "class": "confirm-edit" });
    var edit = el("button", { type: "button", "class": "link-btn" }, "Sửa thông tin");
    editWrap.appendChild(edit);
    box.appendChild(editWrap);

    var copiedOnce = false;
    zalo.addEventListener("click", function (e) {
      // Lần bấm sau (khi trình duyệt chặn cửa sổ mới): để link mở Zalo như bình thường.
      if (copiedOnce) return;
      e.preventDefault();
      copyText(summary).then(function (ok) {
        copiedOnce = true;
        status.classList.toggle("is-warning", !ok);
        status.textContent = ok
          ? "Đã sao chép nội dung — hãy dán vào khung chat Zalo."
          : "Chưa sao chép tự động được. Vui lòng chạm giữ vào nội dung ở khung trên để sao chép, rồi dán vào khung chat Zalo.";
        var win = window.open(ZALO_URL, "_blank");
        if (win) {
          try { win.opener = null; } catch (err) { /* bỏ qua */ }
        } else {
          status.textContent += " Nếu Zalo chưa mở, vui lòng bấm lại nút “Gửi qua Zalo”.";
        }
      });
    });

    edit.addEventListener("click", function () {
      box.parentNode.removeChild(box);
      form.hidden = false;
      hideFormIntro(form, false);
      var first = form.querySelector("input, textarea");
      if (first) first.focus();
    });

    form.hidden = true;
    hideFormIntro(form, true);
    box.focus();
  }

  function channelText(contact) {
    return contact === "Điện thoại" ? "điện thoại" : (contact || "Zalo hoặc điện thoại");
  }

  function showThanks(form, contact, name) {
    var box = getResultBox(form);
    var badge = el("div", { "class": "result-icon", "aria-hidden": "true" });
    badge.appendChild(icon(ICON_CHECK));
    box.appendChild(badge);
    box.setAttribute("role", "status");
    box.appendChild(el("h3", null, "Cảm ơn " + (name || "bạn") + "!"));
    var message = form.getAttribute("data-success") || "Nguyễn Yến sẽ liên hệ lại với bạn.";
    box.appendChild(el("p", null, message.replace("{kenh}", channelText(contact))));
    var p = el("p");
    p.appendChild(document.createTextNode("Nếu cần trao đổi sớm hơn, bạn có thể gọi "));
    p.appendChild(el("a", { href: PHONE_TEL }, PHONE_DISPLAY));
    p.appendChild(document.createTextNode(" hoặc "));
    p.appendChild(el("a", { href: ZALO_URL, target: "_blank", rel: "noopener" }, "nhắn Zalo"));
    p.appendChild(document.createTextNode("."));
    box.appendChild(p);
    form.hidden = true;
    hideFormIntro(form, true);
    box.focus();
  }

  function showSendError(form, message) {
    var status = form.querySelector(".form-status");
    if (!status) return;
    status.textContent = "";
    status.appendChild(document.createTextNode(
      (message ? message + " Bạn cũng có thể " : "Chưa gửi được thông tin. Bạn vui lòng ")));
    status.appendChild(el("a", { href: ZALO_URL, target: "_blank", rel: "noopener" }, "nhắn Zalo"));
    status.appendChild(document.createTextNode(" hoặc "));
    status.appendChild(el("a", { href: PHONE_TEL }, "gọi " + PHONE_DISPLAY));
    status.appendChild(document.createTextNode(" để được hỗ trợ."));
  }

  function sendLead(form, data) {
    var button = form.querySelector('[type="submit"]');
    var status = form.querySelector(".form-status");
    var label = button ? button.textContent : "";
    form.setAttribute("data-sending", "true");
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.textContent = "Đang gửi…";
    }

    var controller = "AbortController" in window ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, SEND_TIMEOUT) : null;
    var done = false;

    // text/plain: yêu cầu "đơn giản", không phát sinh preflight CORS tới Apps Script.
    fetch(LEAD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(data.payload),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      return res.json();
    }).then(function (json) {
      if (json && json.ok === true) {
        done = true;
        if (window.NY_TRACK) window.NY_TRACK.leadDone(data.payload.form);
        showThanks(form, data.contact, data.name);
        return;
      }
      throw new Error((json && typeof json.error === "string" && json.error) || "");
    }).catch(function (err) {
      var message = err && err.name !== "AbortError" && err.name !== "TypeError" && err.name !== "SyntaxError"
        ? err.message : "";
      showSendError(form, message);
      if (status) {
        status.setAttribute("tabindex", "-1");
        status.focus();
      }
    }).then(function () {
      if (timer) clearTimeout(timer);
      form.removeAttribute("data-sending");
      if (button && !done) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.textContent = label;
      }
    });
  }

  function init() {
    fixFileLinks();
    initMenu();
    initReveal();
    initForms();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
