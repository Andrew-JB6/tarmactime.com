// After `wrangler deploy`, replace YOUR-SUBDOMAIN with your workers.dev subdomain.
var SIGNUP_ENDPOINT = "https://tarmactime-signup.tarmactime.workers.dev/";

(function () {
  var form = document.getElementById("join-form");
  var status = document.getElementById("join-status");
  var section = document.getElementById("join");
  var button = form.querySelector("button[type='submit']");
  var emailInput = document.getElementById("email");
  var nameInput = document.getElementById("first-name");
  var companyInput = document.getElementById("company");
  var defaultLabel = button.textContent;
  var sending = false;

  function showStatus(message, kind) {
    status.hidden = false;
    status.textContent = message;
    status.classList.toggle("is-error", kind === "error");
    status.setAttribute("role", kind === "error" ? "alert" : "status");
  }

  function emailLooksValid(value) {
    var email = value.trim().toLowerCase();
    if (email.length < 3 || email.length > 254 || email.indexOf("..") !== -1) {
      return false;
    }
    return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
      email
    );
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (sending) return;

    var email = emailInput.value;
    emailInput.setAttribute("aria-invalid", "false");

    if (!emailLooksValid(email)) {
      emailInput.setAttribute("aria-invalid", "true");
      showStatus("Check the email address and try again.", "error");
      emailInput.focus();
      return;
    }

    sending = true;
    button.disabled = true;
    button.textContent = "Joining";
    status.hidden = true;

    fetch(SIGNUP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        first_name: nameInput.value,
        company: companyInput.value,
      }),
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("request failed");
        }
        return response.json().catch(function () {
          return {};
        });
      })
      .then(function (data) {
        if (data && data.token && window.TarmacGate) {
          window.TarmacGate.setToken(data.token);
        }
        section.classList.add("is-done");
        showStatus("You're on the list.", "success");
        status.focus();
      })
      .catch(function () {
        sending = false;
        button.disabled = false;
        button.textContent = defaultLabel;
        showStatus("Something went wrong. Please try again.", "error");
        status.focus();
      });
  });
})();
