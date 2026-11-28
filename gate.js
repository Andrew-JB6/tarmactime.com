// Tarmac Time issues list, reader gate, and on-site reader.
(function () {
  var API = "https://tarmactime-signup.tarmactime.workers.dev";
  var TOKEN_KEY = "tt_read_token";
  var EMAIL_PATTERN =
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

  // ---- token -------------------------------------------------------------
  function getToken() {
    try {
      var token = localStorage.getItem(TOKEN_KEY) || "";
      if (!token) return "";
      var body = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
      var claims = JSON.parse(atob(body + "===".slice((body.length + 3) % 4)));
      if (!claims || !claims.exp || claims.exp * 1000 < Date.now()) {
        localStorage.removeItem(TOKEN_KEY);
        return "";
      }
      return token;
    } catch (e) {
      return "";
    }
  }
  function setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
    } catch (e) {}
  }
  function clearToken() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }

  function emailLooksValid(value) {
    var email = value.trim().toLowerCase();
    if (email.length < 3 || email.length > 254 || email.indexOf("..") !== -1) return false;
    return EMAIL_PATTERN.test(email);
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "America/Phoenix",
      });
    } catch (e) {
      return "";
    }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // ---- gate modal ----------------------------------------------------------
  var gate = null;
  var onUnlock = null;

  function buildGate() {
    var dialog = document.createElement("dialog");
    dialog.className = "gate";
    dialog.setAttribute("aria-labelledby", "gate-title");
    dialog.innerHTML =
      '<div class="gate-inner">' +
      '<button type="button" class="gate-close" aria-label="Close">&times;</button>' +
      '<p class="gate-eyebrow">Free for members</p>' +
      '<h2 id="gate-title">Join to read <em>this issue.</em></h2>' +
      '<p class="gate-issue" hidden></p>' +
      '<p class="gate-copy">Join Tarmac Time free to read every past issue. New issues arrive in your inbox every other week.</p>' +
      '<form class="gate-form gate-join join-form" novalidate>' +
      '<div class="hp" aria-hidden="true"><label>Company<input name="company" type="text" tabindex="-1" autocomplete="off" value="" /></label></div>' +
      '<div class="join-fields">' +
      '<div class="field"><label for="gate-name">First name <span>Optional</span></label>' +
      '<input id="gate-name" name="first_name" type="text" autocomplete="given-name" maxlength="80" /></div>' +
      '<div class="field"><label for="gate-email">Email</label>' +
      '<input id="gate-email" name="email" type="email" autocomplete="email" inputmode="email" spellcheck="false" maxlength="254" required /></div>' +
      '<button type="submit">Join and read</button>' +
      "</div></form>" +
      '<form class="gate-form gate-member join-form" novalidate hidden>' +
      '<div class="join-fields">' +
      '<div class="field"><label for="gate-member-email">Your subscriber email</label>' +
      '<input id="gate-member-email" name="email" type="email" autocomplete="email" inputmode="email" spellcheck="false" maxlength="254" required /></div>' +
      '<button type="submit">Continue reading</button>' +
      "</div></form>" +
      '<p class="form-status gate-status" tabindex="-1" hidden></p>' +
      '<p class="gate-switch"><button type="button" class="gate-toggle">Already a subscriber? Enter your email</button></p>' +
      "</div>";

    var joinForm = dialog.querySelector(".gate-join");
    var memberForm = dialog.querySelector(".gate-member");
    var status = dialog.querySelector(".gate-status");
    var toggle = dialog.querySelector(".gate-toggle");
    var copy = dialog.querySelector(".gate-copy");

    function showStatus(message, isError) {
      status.hidden = !message;
      status.textContent = message || "";
      status.classList.toggle("is-error", !!isError);
      status.setAttribute("role", isError ? "alert" : "status");
    }

    function setMemberMode(member) {
      joinForm.hidden = member;
      memberForm.hidden = !member;
      showStatus("");
      toggle.textContent = member ? "New here? Join free" : "Already a subscriber? Enter your email";
      copy.textContent = member
        ? "Enter the email you subscribed with and we'll open the issue."
        : "Join Tarmac Time free to read every past issue. New issues arrive in your inbox every other week.";
      var field = member ? memberForm.querySelector("input[type=email]") : joinForm.querySelector("#gate-email");
      field.focus();
    }

    toggle.addEventListener("click", function () {
      setMemberMode(memberForm.hidden);
    });
    dialog.querySelector(".gate-close").addEventListener("click", function () {
      dialog.close();
    });
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) dialog.close();
    });

    function submit(form, path, payload, busyLabel) {
      var button = form.querySelector("button[type=submit]");
      var label = button.textContent;
      var emailInput = form.querySelector("input[type=email]");
      emailInput.setAttribute("aria-invalid", "false");
      if (!emailLooksValid(emailInput.value)) {
        emailInput.setAttribute("aria-invalid", "true");
        showStatus("Check the email address and try again.", true);
        emailInput.focus();
        return;
      }
      button.disabled = true;
      button.textContent = busyLabel;
      showStatus("");
      fetch(API + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (response) {
          return response.json().then(
            function (data) {
              return { ok: response.ok, data: data || {} };
            },
            function () {
              return { ok: false, data: {} };
            }
          );
        })
        .then(function (result) {
          button.disabled = false;
          button.textContent = label;
          if (result.ok && result.data.ok && result.data.token) {
            setToken(result.data.token);
            dialog.close();
            if (onUnlock) onUnlock();
            return;
          }
          if (result.ok && result.data.ok) {
            showStatus("You're on the list. Check your inbox for the newest issue.", false);
            return;
          }
          showStatus(result.data.error || "Something went wrong. Please try again.", true);
        })
        .catch(function () {
          button.disabled = false;
          button.textContent = label;
          showStatus("Something went wrong. Please try again.", true);
        });
    }

    joinForm.addEventListener("submit", function (event) {
      event.preventDefault();
      submit(
        joinForm,
        "/",
        {
          email: joinForm.querySelector("#gate-email").value.trim(),
          first_name: joinForm.querySelector("#gate-name").value,
          company: joinForm.querySelector("input[name=company]").value,
        },
        "Joining"
      );
    });
    memberForm.addEventListener("submit", function (event) {
      event.preventDefault();
      submit(memberForm, "/access", { email: memberForm.querySelector("input[type=email]").value.trim() }, "Checking");
    });

    dialog.setMemberMode = setMemberMode;
    dialog.showStatus = showStatus;
    document.body.appendChild(dialog);
    return dialog;
  }

  function openGate(issueTitle, unlock) {
    if (!gate) gate = buildGate();
    onUnlock = unlock;
    var issue = gate.querySelector(".gate-issue");
    issue.hidden = !issueTitle;
    issue.textContent = issueTitle || "";
    gate.showStatus("");
    gate.querySelector(".gate-join").hidden = false;
    gate.querySelector(".gate-member").hidden = true;
    gate.querySelector(".gate-toggle").textContent = "Already a subscriber? Enter your email";
    if (typeof gate.showModal === "function") gate.showModal();
    else gate.setAttribute("open", "");
    var first = gate.querySelector("#gate-email");
    if (first) first.focus();
  }

  function readerUrl(id) {
    return "/issue/?id=" + encodeURIComponent(id);
  }

  // ---- issues list (home page) ------------------------------------------------
  function renderList(list, posts) {
    list.textContent = "";
    if (!posts.length) {
      list.appendChild(el("li", "issue-empty", "The first issue is on its way."));
      return;
    }
    posts.forEach(function (post) {
      var li = el("li", "issue");
      var a = el("a", "issue-link");
      a.href = readerUrl(post.id);
      a.setAttribute("data-id", post.id);
      if (post.thumbnail_url) {
        var img = el("img", "issue-thumb");
        img.src = post.thumbnail_url;
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        img.width = 96;
        img.height = 54;
        a.appendChild(img);
      }
      var text = el("span", "issue-text");
      text.appendChild(el("span", "issue-date", formatDate(post.publish_date)));
      text.appendChild(el("span", "issue-title", post.title));
      if (post.subtitle) text.appendChild(el("span", "issue-sub", post.subtitle));
      a.appendChild(text);
      bindIssueLink(a);
      li.appendChild(a);
      list.appendChild(li);
    });
  }

  function bindIssueLink(a) {
    if (a.__ttBound) return;
    a.__ttBound = true;
    a.addEventListener("click", function (event) {
      if (getToken()) return;
      event.preventDefault();
      var titleNode = a.querySelector(".issue-title");
      openGate(titleNode ? titleNode.textContent : "", function () {
        location.href = a.getAttribute("href");
      });
    });
  }

  function initList() {
    var list = document.getElementById("issue-list");
    if (!list) return;
    // Titles are already in the HTML for crawlers. Refresh them from the
    // public list, and keep the static copy if that request fails.
    Array.prototype.forEach.call(list.querySelectorAll("a.issue-link"), bindIssueLink);
    fetch(API + "/posts", { headers: { Accept: "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("posts");
        return r.json();
      })
      .then(function (data) {
        renderList(list, (data && data.posts) || []);
      })
      .catch(function () {
        if (list.querySelector("a.issue-link")) return;
        list.textContent = "";
        var li = el("li", "issue-empty");
        li.textContent = "Issues are unavailable right now. Please try again shortly.";
        list.appendChild(li);
      });
  }

  // ---- reader page ---------------------------------------------------------------
  var FRAME_HEAD =
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: data:; style-src \'unsafe-inline\' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; media-src https:;">' +
    '<base target="_blank">' +
    "<style>html,body{margin:0;background:#0B0B0B;overflow:hidden}" +
    "img{max-width:100%;height:auto}" +
    "a,a.link,a *{color:#C9A44C !important;-webkit-text-decoration-color:#C9A44C !important;text-decoration-color:#C9A44C !important}" +
    ".bh__byline_social_wrapper{display:none !important}" +
    "mark[style*='#ffffff'],mark[style*='#FFFFFF'],mark[style*='255, 255, 255']{background:transparent !important}</style>";

  // Links between issues point at beehiiv, which asks readers to log in.
  // Send them to the on-site reader instead.
  function relinkIssues(doc) {
    fetch(API + "/posts", { headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !data.posts) return;
        var bySlug = {};
        data.posts.forEach(function (post) {
          if (post.slug) bySlug[post.slug] = post.id;
        });
        Array.prototype.forEach.call(doc.querySelectorAll("a[href]"), function (a) {
          try {
            var url = new URL(a.getAttribute("href"));
            var m = url.pathname.match(/^\/p\/([^/]+)\/?$/);
            if (url.hostname === "tarmactime.beehiiv.com" && m && bySlug[m[1]]) {
              a.setAttribute("href", location.origin + "/issue/?id=" + encodeURIComponent(bySlug[m[1]]));
            }
          } catch (e) {}
        });
      })
      .catch(function () {});
  }

  function buildSrcdoc(html) {
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, function (m) { return m + FRAME_HEAD; });
    return "<!DOCTYPE html><html><head>" + FRAME_HEAD + "</head><body>" + html + "</body></html>";
  }

  function initReader() {
    var root = document.getElementById("reader");
    if (!root) return;
    var params = new URLSearchParams(location.search);
    var id = params.get("id") || "latest";
    var status = document.getElementById("reader-status");
    var frame = document.getElementById("reader-frame");

    function say(message) {
      status.hidden = !message;
      status.textContent = message || "";
    }

    function fit() {
      try {
        var doc = frame.contentDocument;
        if (!doc || !doc.documentElement) return;
        frame.style.height = doc.documentElement.scrollHeight + "px";
      } catch (e) {}
    }

    function show(post) {
      document.title = post.title + " — Tarmac Time";
      frame.hidden = false;
      frame.onload = function () {
        fit();
        try {
          var doc = frame.contentDocument;
          relinkIssues(doc);
          if (window.ResizeObserver) new ResizeObserver(fit).observe(doc.body);
          Array.prototype.forEach.call(doc.images, function (img) {
            img.addEventListener("load", fit);
          });
        } catch (e) {}
      };
      frame.srcdoc = buildSrcdoc(post.html);
      say("");
    }

    function load() {
      say("Loading the issue…");
      var headers = { Accept: "application/json" };
      var token = getToken();
      if (id !== "latest") {
        if (!token) return locked();
        headers.Authorization = "Bearer " + token;
      }
      fetch(API + "/post/" + encodeURIComponent(id), { headers: headers })
        .then(function (r) {
          return r.json().then(function (d) {
            return { status: r.status, data: d || {} };
          });
        })
        .then(function (res) {
          if (res.status === 401) {
            clearToken();
            return locked();
          }
          if (res.status === 200 && res.data.ok && res.data.post) return show(res.data.post);
          say(res.data.error || "We couldn't load that issue. Please try again.");
        })
        .catch(function () {
          say("We couldn't load that issue. Please try again.");
        });
    }

    function locked() {
      say("Join Tarmac Time free to read this issue.");
      var again = document.getElementById("reader-unlock");
      again.hidden = false;
      again.onclick = function () {
        openGate("", function () {
          again.hidden = true;
          load();
        });
      };
      openGate("", function () {
        again.hidden = true;
        load();
      });
    }

    window.addEventListener("resize", fit);
    load();
  }

  window.TarmacGate = { setToken: setToken };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initList();
      initReader();
    });
  } else {
    initList();
    initReader();
  }
})();
