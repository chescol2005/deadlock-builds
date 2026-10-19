// Inlined into the synergy audit page by synergyReport.ts. Browser-only, no
// dependencies. Reads the JSON embedded in #data and renders every section.
(function () {
  "use strict";

  var data = JSON.parse(document.getElementById("data").textContent);
  var POINTS = 25; // log odds -> approximate win-rate points near 50%
  var PAGE = 40;

  var VERDICTS = [
    ["supported", "Supported", "Clear effect in the rule's direction"],
    ["contradicted", "Contradicted", "Clear effect in the opposite direction"],
    ["no-effect", "No effect", "Measured precisely, about zero"],
    ["inconclusive", "Inconclusive", "Measured, but too noisy to call"],
    ["no-data", "No data", "Too few players bought both"],
  ];
  var REVIEW = {
    sound: "Reason checks out",
    "partly-wrong": "Reason partly wrong",
    wrong: "Reason wrong",
    opinion: "Opinion, not mechanics",
  };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "text") node.textContent = attrs[k];
        else if (k === "class") node.className = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c !== null && c !== undefined)
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }
  function fmtInt(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function signed(n, d) {
    return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(d);
  }
  function itemNode(id) {
    var it = data.items[id];
    return el("span", null, [
      el("span", { class: "dot d-" + (it ? it.cat : "none"), "aria-hidden": "true" }),
      it ? it.name : id,
    ]);
  }
  function itemName(id) {
    return data.items[id] ? data.items[id].name : id;
  }
  function liftCell(lift) {
    return el("td", {
      class: "n " + (lift > 0 ? "pos" : lift < 0 ? "neg" : ""),
      text: signed(lift, 3),
    });
  }
  function pointsCell(lift) {
    return el("td", { class: "n", text: signed(lift * POINTS, 1) });
  }

  // ── Header stats and legend ──────────────────────────────────────────────
  var stats = document.getElementById("stats");
  [
    [fmtInt(data.totals.pairs), "significant measured pairs"],
    [data.totals.heroesWithPairs + " of " + data.totals.heroes, "heroes with any"],
    [String(data.rules.length), "hand-authored rules"],
    [
      data.method.days + " days",
      data.method.minRankName ? data.method.minRankName + "+ matches" : "all ranks",
    ],
  ].forEach(function (s) {
    stats.appendChild(
      el("div", { class: "stat" }, [el("b", { text: s[0] }), el("span", { text: s[1] })]),
    );
  });
  var legend = document.getElementById("legend");
  VERDICTS.forEach(function (v) {
    legend.appendChild(
      el("span", null, [el("span", { class: "pill v-" + v[0], text: v[1] }), " " + v[2]]),
    );
  });

  // ── Rule cards ───────────────────────────────────────────────────────────
  var rulesHost = document.getElementById("rules");
  data.rules.forEach(function (rule) {
    var total = VERDICTS.reduce(function (s, v) {
      return s + rule.counts[v[0]];
    }, 0);
    var bar = el("div", {
      class: "bar",
      role: "img",
      "aria-label": "Verdicts across " + total + " heroes",
    });
    var counts = el("div", { class: "counts" });
    VERDICTS.forEach(function (v) {
      var c = rule.counts[v[0]];
      if (c > 0) {
        var seg = el("i", { class: v[0], title: v[1] + ": " + c });
        seg.style.width = (100 * c) / total + "%";
        bar.appendChild(seg);
      }
      counts.appendChild(
        el("span", null, [el("b", { text: String(c) }), " " + v[1].toLowerCase()]),
      );
    });

    var review = rule.review
      ? el("div", { class: "review" }, [
          el("span", { class: "pill r-" + rule.review.verdict, text: REVIEW[rule.review.verdict] }),
          el("span", { text: rule.review.note }),
        ])
      : null;

    var details = null;
    if (rule.heroes.length > 0) {
      var head = ["Hero", "Lift", "~pts", "se", "Both owned", "Verdict"];
      if (rule.kind === "synergy") head.push("Basket");
      var thead = el(
        "tr",
        null,
        head.map(function (h, i) {
          return el("th", { class: i > 0 && i < 5 ? "n" : "", text: h });
        }),
      );
      var rows = rule.heroes.map(function (h) {
        var verdict = VERDICTS.filter(function (v) {
          return v[0] === h.verdict;
        })[0];
        var cells = [
          el("td", { text: h.hero }),
          liftCell(h.lift),
          pointsCell(h.lift),
          el("td", { class: "n", text: h.se.toFixed(3) }),
          el("td", { class: "n", text: fmtInt(h.n) }),
          el("td", null, [el("span", { class: "pill v-" + h.verdict, text: verdict[1] })]),
        ];
        if (rule.kind === "synergy") {
          cells.push(
            el("td", {
              class: "small mut",
              text: h.basketUsesMeasurement ? "Uses measurement" : "Uses rule",
            }),
          );
        }
        return el("tr", null, cells);
      });
      details = el("details", null, [
        el("summary", { text: "Measured on " + rule.heroes.length + " heroes" }),
        el("div", { class: "tablewrap" }, [
          el("table", null, [el("thead", null, [thead]), el("tbody", null, rows)]),
        ]),
      ]);
    }

    rulesHost.appendChild(
      el("article", { class: "card" }, [
        el("div", { class: "card-top" }, [
          el("span", {
            class: "kind " + rule.kind,
            text: rule.kind === "synergy" ? "Synergy rule" : "Anti-synergy rule",
          }),
        ]),
        el("h3", { class: "items" }, [
          itemNode(rule.a),
          el("span", { class: "plus", text: "+" }),
          itemNode(rule.b),
        ]),
        el("p", { class: "reason", text: rule.reason }),
        review,
        bar,
        counts,
        details ||
          el("p", {
            class: "small mut",
            text: "Not bought together often enough on any hero to measure.",
          }),
      ]),
    );
  });

  // ── Hero explorer ────────────────────────────────────────────────────────
  var heroSel = document.getElementById("hero");
  var q = document.getElementById("q");
  var table = document.getElementById("pairs");
  var facts = document.getElementById("herofacts");
  var more = document.getElementById("more");
  var filters = {
    all: document.getElementById("f-all"),
    pos: document.getElementById("f-pos"),
    neg: document.getElementById("f-neg"),
  };
  var state = { hero: null, sign: "all", showAll: false };

  data.heroes.forEach(function (h) {
    heroSel.appendChild(el("option", { value: h.id, text: h.name + " (" + h.pairs.length + ")" }));
  });
  var start = data.heroes.slice().sort(function (a, b) {
    return b.pairs.length - a.pairs.length;
  })[0];
  try {
    var saved = localStorage.getItem("synergy-audit-hero");
    if (
      saved &&
      data.heroes.some(function (h) {
        return h.id === saved;
      })
    )
      start = { id: saved };
  } catch {
    /* storage unavailable: use the default */
  }
  heroSel.value = start.id;

  function renderHero() {
    var hero = data.heroes.filter(function (h) {
      return h.id === heroSel.value;
    })[0];
    var term = q.value.trim().toLowerCase();
    var rows = hero.pairs.filter(function (p) {
      if (state.sign === "pos" && p[2] <= 0) return false;
      if (state.sign === "neg" && p[2] >= 0) return false;
      if (!term) return true;
      return (
        itemName(p[0]).toLowerCase().indexOf(term) >= 0 ||
        itemName(p[1]).toLowerCase().indexOf(term) >= 0
      );
    });

    facts.textContent = "";
    [
      [fmtInt(hero.matches), "player-matches"],
      [fmtInt(hero.fitted), "pairs fitted"],
      [fmtInt(hero.kept), "significant"],
      [hero.tau.toFixed(3), "real spread (tau)"],
    ].forEach(function (f) {
      facts.appendChild(el("span", null, [el("b", { text: f[0] }), " " + f[1]]));
    });

    table.textContent = "";
    if (hero.pairs.length === 0) {
      table.appendChild(
        el("tbody", null, [
          el("tr", null, [
            el("td", {
              class: "mut",
              text: "No significant pairs for this hero at this rank and window. The basket's pair term is inactive for it.",
            }),
          ]),
        ]),
      );
      more.hidden = true;
      return;
    }
    var head = el(
      "tr",
      null,
      ["Item", "", "Item", "Lift", "~pts", "se", "Both owned"].map(function (h, i) {
        return el("th", { class: i > 2 ? "n" : "", text: h });
      }),
    );
    var shown = state.showAll ? rows : rows.slice(0, PAGE);
    var body = el(
      "tbody",
      null,
      shown.map(function (p) {
        return el("tr", null, [
          el("td", null, [itemNode(p[0])]),
          el("td", { class: "mut", text: "+" }),
          el("td", null, [itemNode(p[1])]),
          liftCell(p[2]),
          pointsCell(p[2]),
          el("td", { class: "n", text: p[3].toFixed(3) }),
          el("td", { class: "n", text: fmtInt(p[4]) }),
        ]);
      }),
    );
    if (rows.length === 0) {
      body.appendChild(
        el("tr", null, [
          el("td", { class: "mut", colspan: "7", text: "No pairs match this filter." }),
        ]),
      );
    }
    table.appendChild(el("thead", null, [head]));
    table.appendChild(body);
    more.hidden = rows.length <= PAGE || state.showAll;
    more.textContent = "Show all " + rows.length;
  }

  heroSel.addEventListener("change", function () {
    state.showAll = false;
    try {
      localStorage.setItem("synergy-audit-hero", heroSel.value);
    } catch {
      /* ignore */
    }
    renderHero();
  });
  q.addEventListener("input", function () {
    state.showAll = false;
    renderHero();
  });
  Object.keys(filters).forEach(function (k) {
    filters[k].addEventListener("click", function () {
      state.sign = k;
      state.showAll = false;
      Object.keys(filters).forEach(function (j) {
        filters[j].setAttribute("aria-pressed", j === k ? "true" : "false");
      });
      renderHero();
    });
  });
  more.addEventListener("click", function () {
    state.showAll = true;
    renderHero();
  });
  renderHero();

  // ── Items in the most pairs ──────────────────────────────────────────────
  var reach = document.getElementById("reach");
  reach.appendChild(
    el("thead", null, [
      el(
        "tr",
        null,
        ["Item", "Pairs", "Heroes", "Positive", "Mean lift"].map(function (h, i) {
          return el("th", { class: i > 0 ? "n" : "", text: h });
        }),
      ),
    ]),
  );
  reach.appendChild(
    el(
      "tbody",
      null,
      data.reach.map(function (r) {
        return el("tr", null, [
          el("td", null, [itemNode(r.id)]),
          el("td", { class: "n", text: String(r.pairs) }),
          el("td", { class: "n", text: String(r.heroes) }),
          el("td", { class: "n", text: Math.round((100 * r.positive) / r.pairs) + "%" }),
          liftCell(r.meanLift),
        ]);
      }),
    ),
  );

  // ── Method ───────────────────────────────────────────────────────────────
  var m = data.method;
  var method = document.getElementById("method");
  [
    [
      "Data. ",
      "Pre-aggregated pair and single-item win counts from the deadlock-api analytics endpoints, game mode " +
        m.gameMode +
        ", " +
        (m.minRankName
          ? "matches whose average badge is " + m.minRankName + " or above"
          : "all ranks") +
        ", " +
        data.window.from +
        " to " +
        data.window.to +
        ". The rank filter is the match average of both teams, not the player's own rank.",
    ],
    [
      "Owned means ever bought. ",
      "An item sold later, or a component later upgraded, still counts. Component and upgrade pairs are dropped.",
    ],
    [
      "Wealth. ",
      "Richer players own more items and win more, so every pair is measured within final-net-worth bands (" +
        m.netWorthBands.join(", ") +
        "+ souls) and pooled.",
    ],
    [
      "Thresholds. ",
      "A pair is significant when at least " +
        fmtInt(m.minPairMatches) +
        " players owned both, both items appear in at least " +
        m.minItemPairs +
        " fitted pairs, and |lift| / se is at least " +
        m.minAbsZ +
        ". A hand rule is overridden in the basket when its measurement has se at most " +
        m.ruleMaxSe +
        ".",
    ],
    [
      "What it cannot see. ",
      "The enemy team. Items bought against the same threat (anti-spirit defence with a gun build, say) look like a strong pair. Lift is correlation within wealth bands, not proof that the items combine.",
    ],
  ].forEach(function (p) {
    method.appendChild(el("p", null, [el("b", { text: p[0] }), p[1]]));
  });
})();
