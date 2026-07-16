// Mobile nav toggle
document.addEventListener("DOMContentLoaded", function () {
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      nav.classList.toggle("open");
    });
  }

  // Render medicines if table exists
  var tbody = document.getElementById("medBody");
  if (tbody) renderMedicines();

  // Duplicate marquee items for a seamless infinite scroll loop
  var track = document.getElementById("logoTrack");
  if (track) {
    Array.from(track.children).forEach(function (el) {
      track.appendChild(el.cloneNode(true));
    });
  }

  // Form handlers
  var orderForm = document.getElementById("orderForm");
  if (orderForm) orderForm.addEventListener("submit", handleOrder);

  var contactForm = document.getElementById("contactForm");
  if (contactForm) contactForm.addEventListener("submit", handleContact);

  var enquiryForm = document.getElementById("enquiryForm");
  if (enquiryForm) enquiryForm.addEventListener("submit", handleEnquiry);
});

var MEDICINES = [
  { name: "Amlodipine Tablet", generic: "Amlodipine 5 mg", cat: "Cardiac", pack: "Strip 10", ja: 2.5, mkt: 28.0 },
  { name: "Metformin Tablet", generic: "Metformin 500 mg", cat: "Anti-Diabetic", pack: "Strip 10", ja: 3.0, mkt: 35.0 },
  { name: "Atorvastatin Tablet", generic: "Atorvastatin 10 mg", cat: "Cardiac", pack: "Strip 10", ja: 4.5, mkt: 64.0 },
  { name: "Pantoprazole Tablet", generic: "Pantoprazole 40 mg", cat: "Gastro", pack: "Strip 10", ja: 3.8, mkt: 55.0 },
  { name: "Azithromycin Tablet", generic: "Azithromycin 500 mg", cat: "Antibiotic", pack: "Strip 3", ja: 12.0, mkt: 95.0 },
  { name: "Cetrizine Tablet", generic: "Levocetirizine 5 mg", cat: "Allergy", pack: "Strip 10", ja: 2.2, mkt: 22.0 },
  { name: "Paracetamol Tablet", generic: "Paracetamol 500 mg", cat: "Analgesic", pack: "Strip 10", ja: 1.5, mkt: 18.0 },
  { name: "Amoxycillin Capsule", generic: "Amoxycillin 500 mg", cat: "Antibiotic", pack: "Strip 10", ja: 9.0, mkt: 85.0 },
  { name: "Diclofenac Gel", generic: "Diclofenac 1%", cat: "Topical", pack: "Tube 30 g", ja: 18.0, mkt: 110.0 },
  { name: "Ondansetron Tablet", generic: "Ondansetron 4 mg", cat: "Gastro", pack: "Strip 10", ja: 6.0, mkt: 72.0 },
  { name: "Telmisartan Tablet", generic: "Telmisartan 40 mg", cat: "Cardiac", pack: "Strip 10", ja: 5.5, mkt: 78.0 },
  { name: "Omeprazole Capsule", generic: "Omeprazole 20 mg", cat: "Gastro", pack: "Strip 10", ja: 4.0, mkt: 60.0 }
];

function savingsPct(ja, mkt) {
  return Math.round(((mkt - ja) / mkt) * 100);
}

function renderMedicines(filterCat, query) {
  var tbody = document.getElementById("medBody");
  if (!tbody) return;
  var html = "";
  MEDICINES.forEach(function (m) {
    if (filterCat && filterCat !== "All" && m.cat !== filterCat) return;
    if (query) {
      var q = query.toLowerCase();
      if (m.name.toLowerCase().indexOf(q) === -1 && m.generic.toLowerCase().indexOf(q) === -1) return;
    }
    html +=
      "<tr>" +
      "<td><strong>" + m.name + "</strong><br><small style='color:#5c6b66'>" + m.generic + "</small></td>" +
      "<td>" + m.cat + "</td>" +
      "<td>" + m.pack + "</td>" +
      "<td>₹ " + m.ja.toFixed(2) + "</td>" +
      "<td>₹ " + m.mkt.toFixed(2) + "</td>" +
      "<td class='savings'>" + savingsPct(m.ja, m.mkt) + "%</td>" +
      "</tr>";
  });
  if (!html) html = "<tr><td colspan='6' style='text-align:center;color:#5c6b66'>No medicines match your search.</td></tr>";
  tbody.innerHTML = html;
}

function initFilters() {
  var cat = document.getElementById("catFilter");
  var search = document.getElementById("searchBox");
  if (cat) {
    var cats = ["All"].concat(MEDICINES.map(function (m) { return m.cat; }).filter(function (v, i, a) { return a.indexOf(v) === i; }));
    cats.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c; o.textContent = c;
      cat.appendChild(o);
    });
    cat.addEventListener("change", function () {
      renderMedicines(cat.value, search ? search.value : "");
    });
  }
  if (search) {
    search.addEventListener("input", function () {
      renderMedicines(cat ? cat.value : "All", search.value);
    });
  }
}

// hook filters after DOM ready
document.addEventListener("DOMContentLoaded", initFilters);

function collect(form) {
  var fd = new FormData(form);
  var o = {};
  fd.forEach(function (v, k) { o[k] = v; });
  return o;
}

function submitToBackend(form, payload) {
  var msg = form.querySelector(".msg");
  var required = form.querySelectorAll("[required]");
  var ok = true;
  required.forEach(function (f) { if (!f.value.trim()) ok = false; });
  if (!ok) {
    msg.className = "msg err";
    msg.style.display = "block";
    msg.textContent = "Please fill all required fields marked with *.";
    return;
  }
  var btn = form.querySelector("button[type=submit]");
  var btnLabel = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Submitting…"; }
  fetch("/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (res) {
      if (res.ok && res.j.ok) {
        msg.className = "msg ok";
        msg.style.display = "block";
        msg.textContent = res.j.message || "Thank you! Your request has been recorded.";
        form.reset();
      } else {
        msg.className = "msg err";
        msg.style.display = "block";
        msg.textContent = (res.j && res.j.message) || "Submission failed. Please try again.";
      }
    })
    .catch(function () {
      msg.className = "msg err";
      msg.style.display = "block";
      msg.textContent = "Network error. Is the server running? Please try again.";
    })
    .finally(function () {
      if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
    });
}

function handleOrder(e) {
  e.preventDefault();
  var d = collect(e.target);
  submitToBackend(e.target, {
    type: "order",
    name: d.person,
    phone: d.phone,
    email: d.email,
    organization: d.org,
    orderType: d.type,
    kendraCode: d.code,
    city: d.city,
    state: d.state,
    details: d.details
  });
}

function handleContact(e) {
  e.preventDefault();
  var d = collect(e.target);
  submitToBackend(e.target, {
    type: "contact",
    name: d.name,
    phone: d.phone,
    email: d.email,
    subject: d.subject,
    details: d.message
  });
}

function handleEnquiry(e) {
  e.preventDefault();
  var d = collect(e.target);
  var form = e.target;
  var msg = form.querySelector(".msg");
  var required = form.querySelectorAll("[required]");
  var ok = true;
  required.forEach(function (f) { if (!f.value.trim()) ok = false; });
  if (!ok) {
    msg.className = "msg err";
    msg.style.display = "block";
    msg.textContent = "Please fill all required fields marked with *.";
    return;
  }
  var btn = form.querySelector("button[type=submit]");
  var btnLabel = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Submitting…"; }
  fetch("/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "enquiry",
      name: d.name,
      phone: d.contact,
      organization: d.location,
      kendraCode: d.storeCode,
      details: d.question
    })
  })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (res) {
      if (res.ok && res.j.ok) {
        window.location.href = "thankyou.html";
      } else {
        msg.className = "msg err";
        msg.style.display = "block";
        msg.textContent = (res.j && res.j.message) || "Submission failed. Please try again.";
        if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
      }
    })
    .catch(function () {
      msg.className = "msg err";
      msg.style.display = "block";
      msg.textContent = "Network error. Is the server running? Please try again.";
      if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
    });
}
