// app.js — the Token Launch Radar page.
//
// Renders the board from window.RADAR (written by main.ts), sorts and
// filters it, and opens a detail view per protocol. The farm steps are
// expanded here from the same templates main.ts used for board.json, so
// the page and the board always show the same plan.
//
// Row layout in RADAR.data:
//   [rank, slug, name, catIdx, chain, chainCount, tvl, chg, age, implied, watch]
// The page reads its initial state from the URL hash, so a state can be
// screenshotted as a real page: #detail=<slug> opens a protocol,
// #cat=<category> filters to a category, #q=<text> searches.

(function () {
  "use strict";
  var R = window.RADAR;
  if (!R || !R.data) {
    document.getElementById("rows").innerHTML =
      '<tr><td colspan="8">No board data loaded.</td></tr>';
    return;
  }

  var rows = R.data.map(function (r) {
    return {
      rank: r[0], slug: r[1], name: r[2], catIdx: r[3], chain: r[4],
      chainCount: r[5], tvl: r[6], chg: r[7], age: r[8],
      implied: r[9], watch: r[10] === 1,
    };
  });
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  var $ = function (id) { return document.getElementById(id); };
  var qEl = $("q"), catEl = $("cat"), chainEl = $("chain"),
      watchEl = $("watch"), sortEl = $("sort"),
      rowsEl = $("rows"), countEl = $("count"), emptyEl = $("empty"),
      detailEl = $("detailBackdrop"), detailBody = $("detailBody");

  function money(n) {
    if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + Math.round(n);
  }
  function pct(c) {
    if (c === null || c === undefined) return "—";
    return (c >= 0 ? "+" : "") + c.toFixed(1) + "%";
  }
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function growthFactor(c) {
    if (c === null || c === undefined || !isFinite(c)) return 1;
    return 1 + 0.5 * (clamp(c, -30, 60) / 100);
  }
  function ageFactor(days) {
    if (days === null || days === undefined) return 1;
    return 1 + 0.12 * (1 - Math.exp(-days / 730));
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ---- header meta -------------------------------------------------------
  var watchCount = rows.filter(function (r) { return r.watch; }).length;
  $("meta").innerHTML =
    "<b>" + rows.length + "</b> launch candidates<br>" +
    "<b>" + watchCount + "</b> on the watchlist &middot; <b>" + (R.excluded || 0) + "</b> wrapped / staked / bridged products left out<br>snapshot " + esc(R.asOf) +
    " &middot; floor <b>" + money(R.floor) + "</b> TVL";

  // ---- filter controls ---------------------------------------------------
  R.cats.forEach(function (c) {
    var o = document.createElement("option");
    o.value = c; o.textContent = c; catEl.appendChild(o);
  });
  var chains = [];
  rows.forEach(function (r) { if (chains.indexOf(r.chain) === -1) chains.push(r.chain); });
  chains.sort().forEach(function (c) {
    var o = document.createElement("option");
    o.value = c; o.textContent = c; chainEl.appendChild(o);
  });

  // ---- farm steps --------------------------------------------------------
  function fill(t, name, chain, gas) {
    return t.split("{name}").join(name).split("{chain}").join(chain).split("{gas}").join(gas);
  }
  function farmSteps(r) {
    var fam = R.famByCat[r.catIdx] || "trade";
    var gas = R.gas[r.chain] || "$0.50";
    var core = R.templates.core[fam] || R.templates.core.trade;
    var deep = R.templates.deepen[fam] || R.templates.deepen.trade;
    return [
      fill(R.templates.setup, r.name, r.chain, gas),
      fill(core, r.name, r.chain, gas),
      fill(deep, r.name, r.chain, gas),
      fill(R.templates.maintain, r.name, r.chain, gas),
      fill(R.templates.track, r.name, r.chain, gas),
    ];
  }

  // ---- detail view -------------------------------------------------------
  function openDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    var cat = R.cats[r.catIdx];
    var bench = R.bench[cat] || [R.globalMedian, 0];
    var g = growthFactor(r.chg);
    var a = ageFactor(r.age);
    var benchNote = bench[1] >= 5
      ? "median of " + bench[1] + " token-bearing " + cat + " protocols"
      : "cross-category median (fewer than five " + cat + " comparables)";
    var chainLabel = r.chain + (r.chainCount > 1 ? " + " + (r.chainCount - 1) + " more" : "");
    var steps = farmSteps(r).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
    detailBody.innerHTML =
      "<h2>" + esc(r.name) + '<span class="slug">' + esc(r.slug) + "</span>" +
      (r.watch ? '<span class="tag">WATCHLIST</span>' : "") + "</h2>" +
      '<div class="facts">' +
      "<span>Rank <b>#" + r.rank + "</b></span>" +
      "<span>Category <b>" + esc(cat) + "</b></span>" +
      "<span>Chain <b>" + esc(chainLabel) + "</b></span>" +
      "<span>TVL <b>" + money(r.tvl) + "</b></span>" +
      "<span>7d <b class=\"" + (r.chg === null ? "" : r.chg >= 0 ? "up" : "down") + "\">" + pct(r.chg) + "</b></span>" +
      "<span>Listed <b>" + (r.age === null ? "unknown" : r.age + " days ago") + "</b></span>" +
      '<span>Implied value <b class="value">' + money(r.implied) + "</b></span>" +
      "</div>" +
      "<h3>How the value is worked out</h3>" +
      '<p class="formula">Implied value = TVL <b>' + money(r.tvl) + "</b> &times; benchmark <b>" +
      bench[0].toFixed(3) + "</b> (" + esc(benchNote) + ") &times; growth <b>" + g.toFixed(3) +
      "</b> &times; age <b>" + a.toFixed(3) + "</b> = <b>" + money(r.implied) + "</b></p>" +
      "<h3>How to farm it</h3>" +
      '<ol class="steps">' + steps + "</ol>";
    detailEl.hidden = false;
    rowsEl.querySelectorAll("tr").forEach(function (tr) {
      tr.classList.toggle("selected", tr.dataset.slug === slug);
    });
    if (location.hash !== "#detail=" + slug) history.replaceState(null, "", "#detail=" + slug);
  }
  function closeDetail() {
    detailEl.hidden = true;
    rowsEl.querySelectorAll("tr").forEach(function (tr) { tr.classList.remove("selected"); });
    if (location.hash.indexOf("#detail=") === 0) history.replaceState(null, "", location.pathname + location.search);
  }
  $("closeDetail").addEventListener("click", closeDetail);
  detailEl.addEventListener("click", function (e) { if (e.target === detailEl) closeDetail(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDetail(); });

  // ---- board -------------------------------------------------------------
  function filtered() {
    var q = qEl.value.trim().toLowerCase();
    var cat = catEl.value, chain = chainEl.value, watchOnly = watchEl.checked;
    return rows.filter(function (r) {
      if (watchOnly && !r.watch) return false;
      if (cat && R.cats[r.catIdx] !== cat) return false;
      if (chain && r.chain !== chain) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function sorted(list) {
    var key = sortEl.value;
    var out = list.slice();
    if (key === "value") out.sort(function (a, b) { return a.rank - b.rank; });
    else if (key === "tvl") out.sort(function (a, b) { return b.tvl - a.tvl; });
    else if (key === "growth") out.sort(function (a, b) { return (b.chg === null ? -1e9 : b.chg) - (a.chg === null ? -1e9 : a.chg); });
    else if (key === "age") out.sort(function (a, b) { return (b.age === null ? -1 : b.age) - (a.age === null ? -1 : a.age); });
    else if (key === "name") out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }
  function render() {
    var list = sorted(filtered());
    countEl.textContent = list.length + " of " + rows.length + " shown";
    emptyEl.hidden = list.length !== 0;
    var html = "";
    list.forEach(function (r) {
      var cat = R.cats[r.catIdx];
      var chgCls = r.chg === null ? "" : r.chg >= 0 ? "up" : "down";
      html += '<tr data-slug="' + esc(r.slug) + '"' + (r.rank <= 3 ? ' class="top3"' : "") + ">" +
        '<td class="num"><span class="rank">' + r.rank + "</span></td>" +
        '<td><span class="name">' + esc(r.name) + '</span><span class="slug">' + esc(r.slug) + "</span>" +
        (r.watch ? '<span class="tag">WATCHLIST</span>' : "") + "</td>" +
        "<td>" + esc(cat) + "</td>" +
        "<td>" + esc(r.chain) + (r.chainCount > 1 ? " +" + (r.chainCount - 1) : "") + "</td>" +
        '<td class="num">' + money(r.tvl) + "</td>" +
        '<td class="num ' + chgCls + '">' + pct(r.chg) + "</td>" +
        '<td class="num">' + (r.age === null ? "—" : r.age + "d") + "</td>" +
        '<td class="num value">' + money(r.implied) + "</td></tr>";
    });
    rowsEl.innerHTML = html;
  }
  rowsEl.addEventListener("click", function (e) {
    var tr = e.target.closest("tr");
    if (tr && tr.dataset.slug) openDetail(tr.dataset.slug);
  });
  [qEl, catEl, chainEl, watchEl, sortEl].forEach(function (el) {
    el.addEventListener("input", render);
    el.addEventListener("change", render);
  });

  // ---- initial state from the hash ---------------------------------------
  (function init() {
    var h = location.hash.replace(/^#/, "");
    if (!h) { render(); return; }
    h.split("&").forEach(function (part) {
      var kv = part.split("=");
      var k = decodeURIComponent(kv[0] || ""), v = decodeURIComponent(kv[1] || "");
      if (k === "cat" && R.cats.indexOf(v) !== -1) catEl.value = v;
      if (k === "q") qEl.value = v;
      if (k === "chain") chainEl.value = v;
      if (k === "watch" && v === "1") watchEl.checked = true;
    });
    render();
    var m = h.match(/detail=([^&]+)/);
    if (m) openDetail(decodeURIComponent(m[1]));
  })();
})();
