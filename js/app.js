/* ============================================================
 * MicroWatch-LDIR · application
 * ------------------------------------------------------------
 * Single-page app: state management, routing and rendering for
 * the five functional pages. Everything runs locally.
 * ============================================================ */
(function () {
  'use strict';

  /* ================= state ================= */
  var state = {
    files: [],            // { name, records, headers, sheetName, warnings }
    records: [],
    sites: [],            // every detected site
    included: {},         // site -> boolean
    activeSites: [],
    settings: JSON.parse(JSON.stringify(MW.DEFAULT_SETTINGS)),
    volumes: {},          // site -> { value: string|number|null, unit: 'L'|'mL' }
    overrides: {},        // canonical material -> category
    stats: {}, conc: {}, qc: {},
    aggregate: null,
    sizeRange: null,
    selectedSite: null,
    page: 'import',
    table: { page: 0, ident: '', category: '', hqiMin: null, dMin: null, dMax: null, excludedOnly: false },
    volTimer: null
  };

  var PAGE_META = {
    import:     { title: 'Data Import',         sub: 'Import LDIR Excel exports · 导入LDIR检测结果' },
    site:       { title: 'Site Analysis',       sub: 'Particle counts, composition, size & concentration · 单点分析' },
    comparison: { title: 'Site Comparison',     sub: 'Compare results across sampling sites · 多点对比' },
    quality:    { title: 'Quality Assessment',  sub: 'HQI quality, outlier screening & interpretation · 质量评价' },
    report:     { title: 'Report Center',       sub: 'Generate and export monitoring reports · 报告导出' }
  };

  /* ================= helpers ================= */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt(x, d) { return (typeof x === 'number' && isFinite(x)) ? x.toFixed(d === undefined ? 2 : d) : '—'; }
  function pct(x, d) { return (typeof x === 'number' && isFinite(x)) ? (x * 100).toFixed(d === undefined ? 1 : d) + '%' : '—'; }
  function fmtInt(n) { return (typeof n === 'number' && isFinite(n)) ? n.toLocaleString('en-US') : '—'; }
  function catChip(cat) {
    var label = MW.CATEGORY_LABELS[cat] ? MW.CATEGORY_LABELS[cat].short : esc(cat);
    return '<span class="chip chip-' + esc(cat) + '">' + label + '</span>';
  }
  function siteOptions(selected) {
    return state.activeSites.map(function (s) {
      return '<option value="' + esc(s) + '"' + (s === selected ? ' selected' : '') + '>' + esc(s) + '</option>';
    }).join('');
  }
  function debounceVolume() {
    clearTimeout(state.volTimer);
    state.volTimer = setTimeout(function () { recomputeAll(); renderCurrent(); }, 250);
  }

  /* ================= data intake ================= */
  function addParsed(parsed) {
    var existing = state.files.find(function (f) { return f.name === parsed.fileName; });
    if (existing) {
      state.files.splice(state.files.indexOf(existing), 1);
    }
    state.files.push({
      name: parsed.fileName,
      records: parsed.records,
      headers: parsed.headers,
      sheetName: parsed.sheetName,
      warnings: parsed.warnings || []
    });
  }

  function recomputeAll() {
    state.records = [];
    state.files.forEach(function (f) { state.records = state.records.concat(f.records); });

    // detected sites (all files merged)
    var seen = {};
    state.sites = [];
    state.records.forEach(function (r) {
      if (!seen[r.site]) { seen[r.site] = true; state.sites.push(r.site); }
    });
    state.sites.sort(MW.ExcelReader.siteSort);
    state.sites.forEach(function (s) { if (state.included[s] === undefined) state.included[s] = true; });

    MW.Analysis.enrich(state.records, state.overrides);

    state.stats = {};
    state.sites.forEach(function (s) {
      var recs = state.records.filter(function (r) { return r.site === s; });
      state.stats[s] = MW.Analysis.siteStats(recs, state.settings);
      MW.QC.evaluateRecords(recs, state.stats[s]);
    });

    state.activeSites = state.sites.filter(function (s) { return state.included[s]; });
    state.aggregate = MW.Analysis.aggregate(state.stats, state.activeSites);
    state.sizeRange = MW.Analysis.sizeRangeDiffers(state.stats, state.activeSites);

    state.conc = {};
    state.qc = {};
    state.activeSites.forEach(function (s) {
      var vol = state.volumes[s] || { value: null, unit: state.settings.volumeUnit };
      state.conc[s] = MW.Concentration.compute(state.stats[s], state.settings, vol);
      var recs = state.records.filter(function (r) { return r.site === s; });
      state.qc[s] = MW.QC.evaluateSite(s, recs, state.stats[s], state.settings, vol, { sizeRange: state.sizeRange });
    });

    if (state.selectedSite === null || state.activeSites.indexOf(state.selectedSite) < 0) {
      state.selectedSite = state.activeSites.length ? state.activeSites[0] : null;
    }
  }

  function loadDemoFiles(indexes) {
    indexes.forEach(function (i) {
      var f = MW.DEMO_DATA.files[i];
      var parsed = MW.ExcelReader.rowsToRecords(f.headers, f.rows, f.name);
      parsed.sheetName = f.sheet;
      parsed.fileName = f.name;
      addParsed(parsed);
    });
    recomputeAll();
    renderCurrent();
  }

  function clearAll() {
    state.files = [];
    state.records = [];
    state.sites = [];
    state.included = {};
    state.volumes = {};
    state.overrides = {};
    state.selectedSite = null;
    state.table = { page: 0, ident: '', category: '', hqiMin: null, dMin: null, dMax: null, excludedOnly: false };
    recomputeAll();
    renderCurrent();
  }

  /* ================= routing ================= */
  function go(page) {
    state.page = page;
    var nodes = document.querySelectorAll('.nav-item');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('active', nodes[i].getAttribute('data-page') === page);
    }
    var sections = document.querySelectorAll('.page');
    for (var j = 0; j < sections.length; j++) {
      sections[j].classList.toggle('active', sections[j].id === 'page-' + page);
    }
    $('page-title').textContent = PAGE_META[page].title;
    $('page-subtitle').textContent = PAGE_META[page].sub;
    renderCurrent();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function renderCurrent() {
    renderTopStatus();
    if (state.page === 'import') renderImport();
    else if (state.page === 'site') renderSite();
    else if (state.page === 'comparison') renderComparison();
    else if (state.page === 'quality') renderQuality();
    else if (state.page === 'report') renderReport();
  }

  /* ================= topbar status ================= */
  function renderTopStatus() {
    var el = $('topbar-status');
    if (!state.activeSites.length) {
      el.innerHTML = '<span class="status-chip warn">No data imported · 未导入数据</span>';
      return;
    }
    el.innerHTML =
      '<span class="status-chip">' + esc(state.activeSites.join(' · ')) + '</span>' +
      '<span class="status-chip">' + fmtInt(state.aggregate.total) + ' records</span>' +
      '<span class="status-chip">HQI ≥ ' + state.settings.hqiThreshold.toFixed(2) + '</span>' +
      (state.settings.commonSizeRange ? '<span class="status-chip warn">Size ≥ 20 μm</span>' : '');
  }

  /* ================= page: import ================= */
  function renderImport() {
    var has = state.activeSites.length > 0;
    $('kpi-total').textContent = has ? fmtInt(state.aggregate.total) : '—';
    $('kpi-target').textContent = has ? fmtInt(state.aggregate.screening) : '—';
    $('kpi-sites').textContent = has ? state.activeSites.length : '—';
    $('kpi-qc').textContent = has ? fmtInt(state.aggregate.filtered) : '—';
    $('kpi-qc-note').textContent = 'HQI≥' + state.settings.hqiThreshold.toFixed(2) + '的目标颗粒';

    // files list
    var fl = $('files-list');
    fl.innerHTML = state.files.map(function (f) {
      return '<div class="file-chip"><span class="fname">📄 ' + esc(f.name) + '</span>' +
        '<span class="fmeta">sheet: ' + esc(f.sheetName || '—') + ' · ' + fmtInt(f.records.length) + ' records</span></div>';
    }).join('');

    // warnings
    var warns = [];
    state.files.forEach(function (f) { (f.warnings || []).forEach(function (w) { warns.push(w); }); });
    $('import-warnings').innerHTML = warns.map(function (w) {
      return '<div class="conc-flag" style="margin-top:8px">⚠ ' + esc(w) + '</div>';
    }).join('');

    // site detection table
    var sd = $('site-detect');
    if (!state.sites.length) {
      sd.innerHTML = '';
    } else {
      sd.innerHTML = '<h3 class="mt">Detected Sites <small>· 数据识别结果</small></h3>' +
        '<div class="table-wrap"><table><thead><tr><th>Site</th><th>Original name(s)</th><th class="num">Records</th><th>Status</th><th>Include</th></tr></thead><tbody>' +
        state.sites.map(function (s) {
          var raws = [];
          state.records.forEach(function (r) { if (r.site === s && raws.indexOf(r.siteRaw) < 0) raws.push(r.siteRaw); });
          var st = state.stats[s];
          return '<tr><td><b>' + esc(s) + '</b></td><td>' + raws.map(esc).join(', ') + '</td>' +
            '<td class="num">' + fmtInt(st.total) + '</td>' +
            '<td>' + (state.included[s] ? '<span class="chip chip-ok">Imported</span>' : '<span class="chip chip-excluded">Excluded</span>') + '</td>' +
            '<td><input type="checkbox" class="site-include" data-site="' + esc(s) + '"' + (state.included[s] ? ' checked' : '') + '></td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p class="muted small">取消勾选可将某个Site移出分析（如仅分析Site1）。取消勾选某Site不会删除其原始数据。</p>';
      sd.querySelectorAll('.site-include').forEach(function (box) {
        box.addEventListener('change', function () {
          state.included[box.getAttribute('data-site')] = box.checked;
          recomputeAll();
          renderCurrent();
        });
      });
    }

    // overrides list
    var box = $('overrides-box');
    var list = $('overrides-list');
    var distinct = {};
    state.records.forEach(function (r) {
      if (!distinct[r.canonical]) distinct[r.canonical] = { category: MW.defaultCategory(r.canonical), count: 0 };
      distinct[r.canonical].count++;
    });
    var keys = Object.keys(distinct).sort();
    if (!keys.length) { list.innerHTML = '<p class="muted small">导入数据后可在此调整材料归类。</p>'; }
    else {
      list.innerHTML = keys.map(function (k) {
        var cur = state.overrides[k] || distinct[k].category;
        return '<div class="ov-row"><span class="ov-name">' + esc(k) + ' <span class="muted small">(' + distinct[k].count + ')</span> ' + catChip(state.overrides[k] || distinct[k].category) + '</span>' +
          '<select class="ov-select" data-mat="' + esc(k) + '">' +
          ['target', 'review', 'nonTarget'].map(function (c) {
            return '<option value="' + c + '"' + (cur === c ? ' selected' : '') + '>' + MW.CATEGORY_LABELS[c].short + '</option>';
          }).join('') + '</select></div>';
      }).join('');
      list.querySelectorAll('.ov-select').forEach(function (sel) {
        sel.addEventListener('change', function () {
          var mat = sel.getAttribute('data-mat');
          var def = distinct[mat] ? distinct[mat].category : 'unknown';
          if (sel.value === def) delete state.overrides[mat];
          else state.overrides[mat] = sel.value;
          recomputeAll();
          renderCurrent();
        });
      });
    }
    $('override-count').textContent = Object.keys(state.overrides).length + ' override' + (Object.keys(state.overrides).length === 1 ? '' : 's');
  }

  /* ================= page: site analysis ================= */
  function renderSite() {
    var emptyEl = $('site-empty');
    var content = $('site-content');
    if (!state.activeSites.length) {
      content.style.display = 'none';
      emptyEl.innerHTML = emptyHTML();
      return;
    }
    content.style.display = '';
    emptyEl.innerHTML = '';

    var sel = $('site-select');
    sel.innerHTML = siteOptions(state.selectedSite);
    state.selectedSite = sel.value;

    var site = state.selectedSite;
    var st = state.stats[site];
    var conc = state.conc[site];

    $('site-select-note').textContent = '当前分析仅使用该Site的数据 · This page analyses the selected site independently.';
    $('conc-site').value = site;
    $('conc-hqi').value = 'HQI ≥ ' + st.threshold.toFixed(2);
    $('conc-minsize').value = st.minSize !== null ? '≥ ' + st.minSize + ' μm' : 'No limit 不限制';

    // volume inputs mirror state
    var vol = state.volumes[site] || { value: '', unit: state.settings.volumeUnit };
    var volInput = $('conc-volume');
    if (document.activeElement !== volInput) volInput.value = vol.value === null || vol.value === undefined ? '' : vol.value;
    $('conc-unit').value = vol.unit || 'L';

    // KPI cards
    $('site-kpis').innerHTML =
      kpiCard('icon-blue', '◍', fmtInt(st.total), 'Total Particles', '总颗粒数') +
      kpiCard('icon-teal', '◈', fmtInt(st.screening), 'Target Polymers (screening)', '目标聚合物（不筛HQI）') +
      kpiCard('icon-amber', '✓', fmtInt(st.filtered), 'HQI≥' + st.threshold.toFixed(2) + (st.minSize !== null ? ' & ≥' + st.minSize + 'μm' : ''), '质量筛选后目标颗粒') +
      kpiCard('icon-purple', '↔', st.filtered ? fmt(st.medianDiamFiltered) + ' μm' : '—', 'Median Diameter', '筛选后中位粒径');

    renderConcSection(site, st, conc);
    renderSiteCharts(st);
    renderRecordsTable(site, st);
  }

  function kpiCard(iconClass, icon, value, label, zh) {
    return '<div class="kpi card"><div class="kpi-icon ' + iconClass + '">' + icon + '</div>' +
      '<div class="kpi-value">' + value + '</div><div class="kpi-label">' + label + '</div>' +
      '<div class="kpi-zh">' + zh + '</div></div>';
  }

  function renderConcSection(site, st, conc) {
    var hl = $('conc-highlight');
    var fl = $('conc-flags');
    var v = conc.volume;
    if (!v.ok) {
      hl.innerHTML = '<div class="conc-placeholder"><b>Enter a sample volume to calculate particles/L</b><br>' +
        esc(v.message) + '<br><small class="muted">未输入体积时仍显示颗粒数量与其他分析结果。示例：假设水样体积为 2 L，当前 ' +
        st.filtered + ' 个筛选后目标颗粒对应 ' + fmt(st.filtered / 2) + ' particles/L（仅为演示输入，非实际采样体积）。</small></div>';
    } else {
      hl.innerHTML = '<div class="conc-highlight' + (conc.fraction === null ? '' : ' alt') + '">' +
        '<div class="ch-label">Microplastic Concentration · 微塑料颗粒浓度</div>' +
        '<div class="ch-value">' + MW.Concentration.fmt(conc.cRaw) + ' particles/L</div>' +
        '<div class="ch-based">Based on HQI ≥ ' + conc.threshold.toFixed(2) +
        (conc.minSize !== null ? ' and size ≥ ' + conc.minSize + ' μm' : '') +
        ' · ' + MW.Concentration.fmtVolume(v) + '</div>' +
        '<div class="ch-desc">' + esc(MW.QC.concentrationSentence(site, conc)) + '</div>' +
        (typeof conc.cScreening === 'number' ? '<div class="ch-desc">Before HQI filtering (screening count ' + conc.screeningCount + '): ' + MW.Concentration.fmt(conc.cScreening) + ' particles/L</div>' : '') +
        '</div>';
    }
    var flags = [];
    (conc.flags || []).forEach(function (f) { flags.push('<div class="conc-flag">⚠ ' + esc(f.text) + '</div>'); });
    (conc.assumptions || []).forEach(function (a) { flags.push('<div class="conc-flag assume">ℹ ' + esc(a) + '</div>'); });
    if (typeof conc.cBlankOnly === 'number') flags.push('<div class="conc-flag assume">Blank-corrected concentration: ' + MW.Concentration.fmt(conc.cBlankOnly) + ' particles/L</div>');
    if (typeof conc.cCorrected === 'number') flags.push('<div class="conc-flag assume">Blank + recovery corrected concentration: <b>' + MW.Concentration.fmt(conc.cCorrected) + '</b> particles/L (R = ' + state.settings.recovery + ')</div>');
    fl.innerHTML = flags.join('');

    // per-polymer & per-size tables
    var tables = $('conc-tables');
    if (!v.ok) { tables.innerHTML = ''; return; }
    var polyRows = conc.byPolymer.map(function (p) {
      return '<tr><td><b>' + esc(p.polymer) + '</b></td><td class="num">' + p.count + '</td><td class="num">' + MW.Concentration.fmt(p.c) + '</td></tr>';
    }).join('');
    var sizeRows = conc.bySize.map(function (p) {
      return '<tr><td>' + esc(p.bin) + '</td><td class="num">' + p.count + '</td><td class="num">' + MW.Concentration.fmt(p.c) + '</td></tr>';
    }).join('');
    tables.innerHTML =
      '<div><h5>Concentration by polymer · 不同聚合物颗粒浓度 (particles/L)</h5><div class="table-wrap"><table><thead><tr><th>Polymer</th><th class="num">Particles</th><th class="num">Concentration</th></tr></thead><tbody>' + polyRows + '</tbody></table></div></div>' +
      '<div><h5>Concentration by size class · 不同粒径范围颗粒浓度 (particles/L)</h5><div class="table-wrap"><table><thead><tr><th>Size class</th><th class="num">Particles</th><th class="num">Concentration</th></tr></thead><tbody>' + sizeRows + '</tbody></table></div></div>';
  }

  function renderSiteCharts(st) {
    requestAnimationFrame(function () {
      if (st.compositionFiltered.length) MW.Charts.polymerComposition('chart-comp', st.compositionFiltered);
      else chartEmpty('chart-comp');
      MW.Charts.sizeDistribution('chart-size', st.sizeHistAll, st.sizeHistFiltered);
      MW.Charts.hqiDistribution('chart-hqi', st.hqiHistAll, st.threshold);
      if (st.hasMorphology) MW.Charts.morphology('chart-morph', state.records.filter(function (r) { return r.site === state.selectedSite; }));
      else chartEmpty('chart-morph', 'No length/width fields in this dataset · 数据中无长宽字段');
    });
  }

  function chartEmpty(canvasId, msg) {
    MW.Charts.showEmpty(canvasId, msg || 'No data');
  }

  /* ---------- records detail table ---------- */
  function siteRecords(site) {
    return state.records.filter(function (r) { return r.site === site; });
  }

  function filteredTableRows(site, st) {
    var t = state.table;
    var rows = siteRecords(site).filter(function (r) {
      if (t.ident && r.canonical !== t.ident) return false;
      if (t.category && r.category !== t.category) return false;
      if (t.hqiMin !== null && (r.quality === null || r.quality < t.hqiMin)) return false;
      if (t.dMin !== null && (r.diameter === null || r.diameter < t.dMin)) return false;
      if (t.dMax !== null && (r.diameter === null || r.diameter > t.dMax)) return false;
      var included = MW.Analysis.passesFilter(r, st.threshold, st.minSize);
      if (t.excludedOnly && included) return false;
      return true;
    });
    return rows;
  }

  function renderRecordsTable(site, st) {
    // identification filter options
    var sel = $('tf-ident');
    var distinct = {};
    siteRecords(site).forEach(function (r) { distinct[r.canonical] = true; });
    var cur = state.table.ident;
    sel.innerHTML = '<option value="">All</option>' + Object.keys(distinct).sort().map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === cur ? ' selected' : '') + '>' + esc(k) + '</option>';
    }).join('');

    var rows = filteredTableRows(site, st);
    var pageSize = 25;
    var pages = Math.max(1, Math.ceil(rows.length / pageSize));
    if (state.table.page >= pages) state.table.page = pages - 1;
    var start = state.table.page * pageSize;
    var slice = rows.slice(start, start + pageSize);

    var html = '<div class="table-scroll"><table><thead><tr>' +
      '<th>Id</th><th>Identification</th><th>Category</th><th class="num">Diameter (μm)</th><th class="num">Length (μm)</th><th class="num">Width (μm)</th>' +
      '<th class="num">HQI</th><th>Valid</th><th>QC flags</th><th>Status (HQI≥' + st.threshold.toFixed(2) + (st.minSize !== null ? ', ≥' + st.minSize + 'μm' : '') + ')</th></tr></thead><tbody>';
    if (!slice.length) html += '<tr><td colspan="10" style="text-align:center;color:#7d8fa3">No matching records</td></tr>';
    slice.forEach(function (r) {
      var included = MW.Analysis.passesFilter(r, st.threshold, st.minSize);
      var reason = included ? '' : MW.Analysis.exclusionReason(r, st.threshold, st.minSize);
      html += '<tr><td>' + esc(r.id) + '</td><td><b>' + esc(r.canonical || r.identification) + '</b></td><td>' + catChip(r.category) + '</td>' +
        '<td class="num">' + fmt(r.diameter) + '</td><td class="num">' + fmt(r.length) + '</td><td class="num">' + fmt(r.width) + '</td>' +
        '<td class="num">' + fmt(r.quality, 3) + '</td><td>' + (r.isValid === false ? '✗' : '✓') + '</td>' +
        '<td>' + (r.flags && r.flags.length ? r.flags.map(function (f) { return '<span class="chip chip-flag">' + f + '</span>'; }).join('') : '—') + '</td>' +
        '<td>' + (included ? '<span class="chip chip-ok">Included</span>' : '<span class="chip chip-excluded" title="' + esc(reason) + '">' + esc(reason) + '</span>') + '</td></tr>';
    });
    html += '</tbody></table></div>';
    $('records-table').innerHTML = html;

    $('records-pager').innerHTML =
      '<span>' + fmtInt(rows.length) + ' records (site total ' + fmtInt(st.total) + ') · page ' + (state.table.page + 1) + '/' + pages + '</span>' +
      '<span class="tf-spacer"></span>' +
      '<button class="btn btn-ghost btn-sm" id="pg-prev"' + (state.table.page === 0 ? ' disabled' : '') + '>‹ Prev</button>' +
      '<button class="btn btn-ghost btn-sm" id="pg-next"' + (state.table.page >= pages - 1 ? ' disabled' : '') + '>Next ›</button>';
    $('pg-prev').addEventListener('click', function () { state.table.page--; renderRecordsTable(state.selectedSite, state.stats[state.selectedSite]); });
    $('pg-next').addEventListener('click', function () { state.table.page++; renderRecordsTable(state.selectedSite, state.stats[state.selectedSite]); });
  }

  /* ================= page: comparison ================= */
  function renderComparison() {
    var emptyEl = $('cmp-empty');
    var content = $('cmp-content');
    if (state.activeSites.length < 2) {
      content.style.display = 'none';
      emptyEl.innerHTML = state.activeSites.length === 1
        ? '<div class="card empty-state"><div class="es-icon">▦</div><b>Only one site imported</b><br>导入两个及以上Site后即可进行多点对比（也可以只分析单个Site）。</div>'
        : emptyHTML();
      return;
    }
    content.style.display = '';
    emptyEl.innerHTML = '';

    var sites = state.activeSites;
    var t = state.settings.hqiThreshold.toFixed(2);
    var minSize = MW.Analysis.effectiveMinSize(state.settings);
    $('cmp-note').textContent = 'Uniform criteria: HQI ≥ ' + t + (minSize !== null ? ', size ≥ ' + minSize + ' μm' : ', no size limit') +
      ' · ' + sites.length + ' sites · ' + fmtInt(state.aggregate.total) + ' records — 统一筛选标准后再比较';

    $('btn-common-size').textContent = state.settings.commonSizeRange
      ? '✓ Common size range ≥ 20 μm applied (click to remove)'
      : 'Apply Common Size Range: ≥ 20 μm';

    requestAnimationFrame(function () {
      MW.Charts.comparisonTargets('chart-cmp-targets', sites, state.stats);
      MW.Charts.comparisonComposition('chart-cmp-comp', sites, state.stats);
      MW.Charts.comparisonSize('chart-cmp-size', sites, state.stats);
      if (sites.some(function (s) { return typeof state.conc[s].cRaw === 'number'; })) {
        MW.Charts.comparisonConcentration('chart-cmp-conc', sites, state.conc);
      } else {
        chartEmpty('chart-cmp-conc', 'Enter sample volumes below to compute concentrations · 输入水样体积后生成浓度对比图');
      }
    });

    // indicator table
    var head = '<tr><th>Indicator 指标</th>' + sites.map(function (s) { return '<th>' + esc(s) + '</th>'; }).join('') + '</tr>';
    var rows = [
      ['Total particles 总颗粒数', function (s) { return fmtInt(state.stats[s].total); }],
      ['Screening target count 初筛目标数', function (s) { return fmtInt(state.stats[s].screening); }],
      ['Quality-filtered count 质量筛选后', function (s) { return '<b>' + fmtInt(state.stats[s].filtered) + '</b>'; }],
      ['HQI retention 保留率', function (s) { return pct(state.stats[s].retention); }],
      ['Target ratio 目标比例', function (s) { return pct(state.stats[s].targetRatio); }],
      ['Median diameter (filtered) 中位粒径', function (s) { return fmt(state.stats[s].medianDiamFiltered) + ' μm'; }],
      ['Polymer richness 聚合物丰富度', function (s) { return state.stats[s].richness; }],
      ['Mean HQI 平均HQI', function (s) { return fmt(state.stats[s].hqiMean, 3); }],
      ['Records HQI≥0.85', function (s) { return fmtInt(state.stats[s].hqiGe85) + ' (' + pct(state.stats[s].highHqiRatio, 1) + ')'; }],
      ['Review-category records 待复核', function (s) { return fmtInt(state.stats[s].reviewCount); }],
      ['Key-field completeness 完整率', function (s) { return pct(state.stats[s].completeness.rate, 0); }]
    ];
    $('cmp-indicator-table').innerHTML = '<table>' + head + '<tbody>' + rows.map(function (r) {
      return '<tr><td>' + r[0] + '</td>' + sites.map(function (s) { return '<td>' + r[1](s) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table>';

    renderCmpVolumes(sites);

    // concentration result table (next to the chart)
    var ct = sites.map(function (s) {
      var c = state.conc[s];
      var has = typeof c.cRaw === 'number';
      return '<tr><td><b>' + esc(s) + '</b></td><td class="num">' + c.count + '</td><td>' + (has ? esc(MW.Concentration.fmtVolume(c.volume)) : '<span class="muted">—</span>') +
        '</td><td class="num">' + (has ? '<b>' + MW.Concentration.fmt(c.cRaw) + '</b>' : '—') + '</td><td class="num">' + (has ? MW.Concentration.fmt(c.cScreening) : '—') + '</td></tr>';
    }).join('');
    $('cmp-conc-table').innerHTML = '<h5>Concentration results · 浓度结果表 (particles/L)</h5>' +
      '<table><thead><tr><th>Site</th><th class="num">Filtered particles</th><th>Sample volume</th><th class="num">C (HQI-filtered)</th><th class="num">C (screening)</th></tr></thead><tbody>' + ct + '</tbody></table>' +
      '<p class="muted small">C = 筛选后颗粒数 ÷ 水样体积（L）；未经空白与回收率校正，不设置污染等级。</p>';

    renderCmpRatio(sites);
  }

  function renderCmpVolumes(sites) {
    var el = $('cmp-volumes');
    el.innerHTML = sites.map(function (s) {
      var vol = state.volumes[s] || { value: '', unit: state.settings.volumeUnit };
      var c = state.conc[s];
      var res = (c && typeof c.cRaw === 'number')
        ? 'Concentration: <b>' + MW.Concentration.fmt(c.cRaw) + '</b> particles/L (' + c.count + ' particles)'
        : '<span class="muted">enter volume → particles/L</span>';
      return '<div class="vol-cell"><div class="vol-site"><span class="vol-dot" style="background:' + MW.Charts.siteColor(s) + '"></span>' + esc(s) + '</div>' +
        '<input type="number" class="cmp-vol" data-site="' + esc(s) + '" min="0" step="any" placeholder="Sample volume 水样体积" value="' + esc(vol.value === null || vol.value === undefined ? '' : vol.value) + '">' +
        '<select class="cmp-vol-unit" data-site="' + esc(s) + '"><option value="L"' + (vol.unit !== 'mL' ? ' selected' : '') + '>L</option><option value="mL"' + (vol.unit === 'mL' ? ' selected' : '') + '>mL</option></select>' +
        '<div class="vol-result">' + res + '</div></div>';
    }).join('');
    el.querySelectorAll('.cmp-vol').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var s = inp.getAttribute('data-site');
        state.volumes[s] = state.volumes[s] || { value: null, unit: state.settings.volumeUnit };
        state.volumes[s].value = inp.value === '' ? null : parseFloat(inp.value);
        debounceVolume();
      });
    });
    el.querySelectorAll('.cmp-vol-unit').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var s = sel.getAttribute('data-site');
        state.volumes[s] = state.volumes[s] || { value: null, unit: state.settings.volumeUnit };
        state.volumes[s].unit = sel.value;
        debounceVolume();
      });
    });
  }

  function renderCmpRatio(sites) {
    var el = $('cmp-ratio');
    var ratios = MW.Concentration.ratios(state.conc, sites);
    var withC = sites.filter(function (s) { return typeof state.conc[s].cRaw === 'number'; });
    var html = '';
    if (withC.length >= 2) {
      var chips = ratios.filter(function (r) { return r.ratio !== null; }).map(function (r) {
        return '<span class="ratio-chip">R<sub>' + esc(r.i) + ',' + esc(r.j) + '</sub> = ' + MW.Concentration.fmt(r.ci) + ' / ' + MW.Concentration.fmt(r.cj) + ' = <b>' + MW.Concentration.fmt(r.ratio, 1) + '×</b></span>';
      }).join('');
      html += '<div class="ratio-box"><h4>Concentration ratios · 浓度比值 R<sub>ij</sub> = C<sub>i</sub>/C<sub>j</sub></h4><div class="ratio-list">' + chips + '</div></div>';
    }
    var lines = MW.QC.comparisonSummary(sites, state.stats, state.conc, state.settings, state.sizeRange);
    if (lines.length) {
      html += '<div class="ratio-box">' + lines.map(function (l) { return '<p class="muted small" style="margin:6px 0">' + esc(l) + '</p>'; }).join('') + '</div>';
    }
    el.innerHTML = html;
  }

  /* ================= page: quality ================= */
  function renderQuality() {
    var emptyEl = $('qa-empty');
    var content = $('qa-content');
    if (!state.activeSites.length) {
      content.style.display = 'none';
      emptyEl.innerHTML = emptyHTML();
      return;
    }
    content.style.display = '';
    emptyEl.innerHTML = '';
    var sites = state.activeSites;

    // rule matrix
    var rules = MW.ANALYSIS_RULES;
    var matrix = '<table><thead><tr><th>Rule</th><th>Condition 判断条件</th>' +
      sites.map(function (s) { return '<th>' + esc(s) + '</th>'; }).join('') + '<th>Meaning 提示内容</th></tr></thead><tbody>';
    rules.forEach(function (rule) {
      matrix += '<tr><td><b>' + rule.id + '</b></td><td style="white-space:normal">' + esc(rule.condition) + '</td>';
      sites.forEach(function (s) {
        var qr = (state.qc[s].rules || []).find(function (r) { return r.id === rule.id; });
        var triggered = qr && qr.triggered;
        matrix += '<td class="num">' + (triggered ? '<span class="rule-triggered">' + (qr.count || '⚠') + '</span>' : '<span class="rule-clear">—</span>') + '</td>';
      });
      matrix += '<td style="white-space:normal">' + esc(rule.zh) + ' / ' + esc(rule.message) + '</td></tr>';
    });
    matrix += '</tbody></table>';
    $('qa-rule-matrix').innerHTML = matrix;

    // sweep table + chart
    requestAnimationFrame(function () {
      MW.Charts.thresholdSensitivity('chart-qa-sweep', sites, state.stats);
    });
    var sweep = '<table><thead><tr><th>HQI threshold</th>' +
      MW.HQI_THRESHOLD_OPTIONS.map(function (t) { return '<th class="num">≥ ' + t.toFixed(2) + '</th>'; }).join('') +
      '<th class="num">Screening (no HQI)</th></tr></thead><tbody>';
    sites.forEach(function (s) {
      var st = state.stats[s];
      sweep += '<tr><td><b>' + esc(s) + '</b></td>' + MW.HQI_THRESHOLD_OPTIONS.map(function (t) {
        var v = st.sweepNoSize[t.toFixed(2)];
        var cur = Math.abs(t - state.settings.hqiThreshold) < 1e-9;
        return '<td class="num"' + (cur ? ' style="background:#E3F0FC;font-weight:800"' : '') + '>' + fmtInt(v) + '</td>';
      }).join('') + '<td class="num">' + fmtInt(st.screening) + '</td></tr>';
    });
    sweep += '</tbody></table>';
    $('qa-sweep-table').innerHTML = sweep;

    // retention analysis
    var ret = sites.map(function (s) {
      var st = state.stats[s];
      return '<tr><td>' + esc(s) + '</td><td class="num">' + fmtInt(st.screening) + '</td><td class="num">' + fmtInt(st.filtered) + '</td><td class="num">' + pct(st.retention) + '</td><td>' + esc(MW.QC.sensitivityLabel(st.retention)) + '</td></tr>';
    }).join('');
    $('qa-retention').innerHTML = '<h4>Retention at current threshold (HQI ≥ ' + state.settings.hqiThreshold.toFixed(2) + ') · 当前阈值下的目标颗粒保留率</h4>' +
      '<div class="table-wrap"><table><thead><tr><th>Site</th><th class="num">Screening</th><th class="num">Filtered</th><th class="num">Retention</th><th>Interpretation</th></tr></thead><tbody>' + ret + '</tbody></table></div>' +
      '<p class="muted small">保留率低说明该Site的聚合物鉴定结果对光谱匹配质量阈值高度敏感，应重点复核低HQI记录，而不是直接认定这些颗粒不是微塑料。</p>';

    // per-site assessments
    $('qa-summaries').innerHTML = sites.map(function (s) {
      var triggered = (state.qc[s].rules || []).filter(function (r) { return r.triggered; });
      return '<div class="qa-summary"><h4>' + esc(s) + '</h4>' + esc(MW.QC.siteSummary(s, state.stats[s], state.settings, state.conc[s])) +
        (triggered.length ? '<ul>' + triggered.map(function (r) {
          return '<li><b>' + r.id + '</b> — ' + esc(r.message) + ' <span class="muted">(' + esc(r.detail) + ')</span></li>';
        }).join('') + '</ul>' : '<ul><li class="rule-clear">No record-level rules triggered for this site.</li></ul>') + '</div>';
    }).join('');

    // completeness table
    var comp = '<table><thead><tr><th>Indicator</th>' + sites.map(function (s) { return '<th>' + esc(s) + '</th>'; }).join('') + '</tr></thead><tbody>';
    [
      ['Key-field completeness 关键字段完整率', function (s) { return pct(state.stats[s].completeness.rate, 1); }],
      ['Valid-flag rate 记录有效标记率', function (s) { return pct(state.stats[s].completeness.validFlagRate, 1); }],
      ['All records HQI≥0.75 全部颗粒HQI≥0.75比例', function (s) { return pct(state.stats[s].hqiGe75Ratio, 1); }],
      ['All records HQI≥0.85 (P_high) 高质量光谱比例', function (s) { return state.stats[s].hqiGe85 + ' (' + pct(state.stats[s].highHqiRatio, 1) + ')'; }],
      ['Mean HQI 平均HQI', function (s) { return fmt(state.stats[s].hqiMean, 3); }],
      ['Median HQI', function (s) { return fmt(state.stats[s].hqiMedian, 3); }],
      ['Detected size range 检测粒径范围', function (s) { var st = state.stats[s]; return fmt(st.minDiam, 1) + '–' + fmt(st.maxDiam, 1) + ' μm'; }],
      ['R3 size outliers 异常粒径记录', function (s) { var qr = (state.qc[s].rules || []).find(function (r) { return r.id === 'R3'; }); return qr ? qr.count : '—'; }]
    ].forEach(function (row) {
      comp += '<tr><td>' + row[0] + '</td>' + sites.map(function (s) { return '<td class="num">' + row[1](s) + '</td>'; }).join('') + '</tr>';
    });
    comp += '</tbody></table>';
    $('qa-completeness').innerHTML = comp;

    // concentration quality notes
    var notes = [];
    var withV = sites.filter(function (s) { return typeof state.conc[s].cRaw === 'number'; });
    if (withV.length) {
      notes.push('Concentrations reported for ' + withV.join(', ') + ' are uncorrected for blanks and recovery (blank count / recovery rate were not provided).');
    }
    if (typeof state.settings.analyzedFraction !== 'number') {
      notes.push('The analysed fraction (f) of the filter has not been confirmed; concentration calculations assume the whole deposited sample was analysed.');
    } else {
      notes.push('Concentrations use an analysed fraction f = ' + state.settings.analyzedFraction + '.');
    }
    if (state.sizeRange && state.sizeRange.differs) {
      notes.push('Rule R6: minimum detected diameters differ between sites (' + fmt(state.sizeRange.minLow, 1) + '–' + fmt(state.sizeRange.minHigh, 1) + ' μm) — apply the common size range before comparing.');
    }
    notes.push('The platform reports candidate LDIR identifications filtered by the stated rules; it does not confirm polymer identity particle-by-particle, and no machine-learning performance metrics (precision / recall / F1) are applicable.');
    $('qa-conc-notes').innerHTML = notes.map(function (n) { return '<div class="conc-flag assume" style="margin-bottom:6px">ℹ ' + esc(n) + '</div>'; }).join('');
  }

  /* ================= page: report ================= */
  function renderReport() {
    var emptyEl = $('rep-empty');
    var content = $('rep-content');
    if (!state.activeSites.length) {
      content.style.display = 'none';
      emptyEl.innerHTML = emptyHTML();
      return;
    }
    content.style.display = '';
    emptyEl.innerHTML = '';

    var sites = state.activeSites;
    var p = { hqi: state.settings.hqiThreshold.toFixed(2) };
    var minSize = MW.Analysis.effectiveMinSize(state.settings);

    var siteRows = sites.map(function (s) {
      var st = state.stats[s];
      return '<tr><td>' + esc(s) + '</td><td>' + fmtInt(st.total) + '</td><td>' + fmtInt(st.screening) + '</td><td><b>' + fmtInt(st.filtered) + '</b></td><td>' + pct(st.retention) + '</td><td>' + pct(st.targetRatio) + '</td><td>' + fmt(st.medianDiamFiltered) + '</td><td>' + st.richness + '</td><td>' + fmt(st.hqiMean, 3) + '</td><td>' + pct(st.completeness.rate, 0) + '</td></tr>';
    }).join('');

    var concRows = sites.map(function (s) {
      var c = state.conc[s];
      return '<tr><td>' + esc(s) + '</td><td>' + c.count + '</td><td>' + esc(MW.Concentration.fmtVolume(c.volume)) + '</td><td><b>' + MW.Concentration.fmt(c.cRaw) + '</b></td><td>' + MW.Concentration.fmt(c.cScreening) + '</td><td>' + MW.Concentration.fmt(c.cCorrected) + '</td></tr>';
    }).join('');

    var compRows = sites.map(function (s) {
      return state.stats[s].compositionFiltered.slice(0, 8).map(function (c) {
        return '<tr><td>' + esc(s) + '</td><td>' + esc(c.polymer) + '</td><td class="num">' + c.count + '</td></tr>';
      }).join('');
    }).join('');

    var qcHtml = sites.map(function (s) {
      var triggered = (state.qc[s].rules || []).filter(function (r) { return r.triggered; });
      return '<h4>' + esc(s) + '</h4><p>' + esc(MW.QC.siteSummary(s, state.stats[s], state.settings, state.conc[s])) + '</p>' +
        (triggered.length ? '<ul>' + triggered.map(function (r) { return '<li><b>' + r.id + '</b> — ' + esc(r.zh) + ' (' + esc(r.detail) + ')</li>'; }).join('') + '</ul>' : '');
    }).join('');

    var conclusions = MW.QC.comparisonSummary(sites, state.stats, state.conc, state.settings, state.sizeRange).map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('');

    $('report-preview').innerHTML =
      '<h1 class="rep-title">LDIR Microplastic Monitoring Analysis Report</h1>' +
      '<div class="rep-sub">MicroWatch-LDIR · Offline LDIR Microplastic Data Analysis and Quality Control · generated ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '</div>' +
      '<h2>1 · Data source &amp; analysis parameters 数据来源与参数</h2>' +
      '<table><tbody>' +
      '<tr><th>Data files</th><td>' + esc(state.files.map(function (f) { return f.name; }).join('; ')) + '</td></tr>' +
      '<tr><th>Sites analysed</th><td>' + esc(sites.join(', ')) + ' (' + fmtInt(state.aggregate.total) + ' records)</td></tr>' +
      '<tr><th>HQI threshold</th><td>≥ ' + p.hqi + '</td></tr>' +
      '<tr><th>Minimum particle size</th><td>' + (minSize !== null ? '≥ ' + minSize + ' μm' : 'No limit 不限制') + '</td></tr>' +
      '<tr><th>Analyzed fraction (f)</th><td>' + (typeof state.settings.analyzedFraction === 'number' ? state.settings.analyzedFraction : 'not confirmed 未确认（按全样品分析处理）') + '</td></tr>' +
      '<tr><th>Blank / recovery</th><td>' + (typeof state.settings.blankCount === 'number' ? state.settings.blankCount : 'not provided') + ' / ' + (typeof state.settings.recovery === 'number' ? state.settings.recovery : 'not provided') + '</td></tr>' +
      '</tbody></table>' +
      '<h2>2 · Site indicators 站点指标</h2>' +
      '<table><thead><tr><th>Site</th><th>Total</th><th>Screening</th><th>Filtered</th><th>Retention</th><th>Target ratio</th><th>Median μm</th><th>Richness</th><th>Mean HQI</th><th>Complete</th></tr></thead><tbody>' + siteRows + '</tbody></table>' +
      '<p class="note">Screening count = target polymer identifications without HQI threshold; Filtered = after applying HQI ≥ ' + p.hqi + (minSize !== null ? ' and size ≥ ' + minSize + ' μm' : '') + '. The two must not be mixed.</p>' +
      (sites.some(function (s) { return typeof state.conc[s].cRaw === 'number'; })
        ? '<h2>3 · Microplastic concentration 微塑料浓度</h2><table><thead><tr><th>Site</th><th>Filtered particles</th><th>Sample volume</th><th>C (particles/L)</th><th>Screening C</th><th>Corrected C</th></tr></thead><tbody>' + concRows + '</tbody></table>' +
          '<p class="note">Concentrations are uncorrected for blanks and recovery unless stated, and are not confirmed by manual particle review.</p>'
        : '<h2>3 · Microplastic concentration 微塑料浓度</h2><p class="note">No sample volume entered — particles/L is not reported. 输入水样体积后自动计算浓度。</p>') +
      '<h2>4 · Polymer composition (top polymers) 聚合物组成</h2>' +
      '<table><thead><tr><th>Site</th><th>Polymer</th><th>Filtered particles</th></tr></thead><tbody>' + compRows + '</tbody></table>' +
      '<h2>5 · Quality assessment 质量评价（规则引擎 R1–R6）</h2>' + qcHtml +
      '<h2>6 · Comparison &amp; conclusions 对比与结论</h2>' + conclusions +
      '<p class="note">This report was produced fully offline by rule-based decision support (no machine learning, no external APIs). Particle numbers are LDIR candidate identifications filtered by the stated rules, not manually confirmed microplastic counts.</p>';
  }

  function emptyHTML() {
    return '<div class="card empty-state"><div class="es-icon">◍</div>' +
      '<b>No data imported yet · 尚未导入数据</b><br>' +
      'Go to <b>Data Import</b> to upload an Excel file or load the demo dataset.<br>' +
      '<button class="btn btn-primary" id="btn-empty-import">Go to Data Import · 去导入数据</button>' +
      '<button class="btn btn-ghost" id="btn-empty-demo">Load demo data</button></div>';
  }

  function wireEmptyButtons() {
    document.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'btn-empty-import') go('import');
      if (e.target && e.target.id === 'btn-empty-demo') { loadDemoFiles([0, 1]); go('site'); }
    });
  }

  /* ================= wiring ================= */
  function wire() {
    // nav
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () { go(btn.getAttribute('data-page')); });
    });

    // dropzone & file input
    var dz = $('dropzone');
    var fi = $('file-input');
    dz.addEventListener('click', function () { fi.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') fi.click(); });
    fi.addEventListener('change', function () {
      var files = Array.from(fi.files || []);
      handleFiles(files);
      fi.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('dragover'); });
    });
    dz.addEventListener('drop', function (e) {
      var files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      handleFiles(files);
    });

    // demo buttons
    $('btn-demo-12').addEventListener('click', function () { loadDemoFiles([0]); });
    $('btn-demo-34').addEventListener('click', function () { loadDemoFiles([1]); });
    $('btn-demo-all').addEventListener('click', function () { loadDemoFiles([0, 1]); });
    $('btn-clear').addEventListener('click', function () {
      if (state.files.length && !window.confirm('Clear all imported data? 清除全部已导入数据？')) return;
      clearAll();
    });

    // global filters
    $('hqi-slider').addEventListener('input', function () {
      state.settings.hqiThreshold = parseFloat(this.value);
      $('hqi-out').textContent = state.settings.hqiThreshold.toFixed(2);
      recomputeAll();
      renderCurrent();
    });
    $('minsize-input').addEventListener('input', function () {
      var v = this.value === '' ? null : parseFloat(this.value);
      state.settings.minSize = (v !== null && isFinite(v) && v > 0) ? v : null;
      recomputeAll();
      renderCurrent();
    });
    $('common-size-toggle').addEventListener('change', function () {
      state.settings.commonSizeRange = this.checked;
      recomputeAll();
      renderCurrent();
    });

    // analysis settings
    $('set-unit').addEventListener('change', function () {
      state.settings.volumeUnit = this.value;
      recomputeAll();
      renderCurrent();
    });
    [['set-fraction', 'analyzedFraction'], ['set-blank', 'blankCount'], ['set-blank-fraction', 'blankFraction'], ['set-recovery', 'recovery']]
      .forEach(function (pair) {
        $(pair[0]).addEventListener('input', function () {
          var v = this.value === '' ? null : parseFloat(this.value);
          state.settings[pair[1]] = (v !== null && isFinite(v)) ? v : null;
          recomputeAll();
          renderCurrent();
        });
      });

    // site analysis controls
    $('site-select').addEventListener('change', function () {
      state.selectedSite = this.value;
      state.table.page = 0;
      renderSite();
    });
    $('conc-volume').addEventListener('input', function () {
      var s = state.selectedSite;
      state.volumes[s] = state.volumes[s] || { value: null, unit: state.settings.volumeUnit };
      state.volumes[s].value = this.value === '' ? null : parseFloat(this.value);
      debounceVolume();
    });
    $('conc-unit').addEventListener('change', function () {
      var s = state.selectedSite;
      state.volumes[s] = state.volumes[s] || { value: null, unit: state.settings.volumeUnit };
      state.volumes[s].unit = this.value;
      debounceVolume();
    });

    // records table filters
    var tf = [['tf-ident', 'ident', 'value'], ['tf-category', 'category', 'value'], ['tf-hqi', 'hqiMin', 'num'], ['tf-dmin', 'dMin', 'num'], ['tf-dmax', 'dMax', 'num']];
    tf.forEach(function (pair) {
      $(pair[0]).addEventListener('change', function () {
        var v = pair[2] === 'num' ? (this.value === '' ? null : parseFloat(this.value)) : this.value;
        state.table[pair[1]] = (v !== null && typeof v === 'number' && !isFinite(v)) ? null : v;
        state.table.page = 0;
        renderRecordsTable(state.selectedSite, state.stats[state.selectedSite]);
      });
      $(pair[0]).addEventListener('input', function () {
        if (pair[2] !== 'num') return;
        var v = this.value === '' ? null : parseFloat(this.value);
        state.table[pair[1]] = (v !== null && isFinite(v)) ? v : null;
        state.table.page = 0;
        renderRecordsTable(state.selectedSite, state.stats[state.selectedSite]);
      });
    });
    $('tf-excluded').addEventListener('change', function () {
      state.table.excludedOnly = this.checked;
      state.table.page = 0;
      renderRecordsTable(state.selectedSite, state.stats[state.selectedSite]);
    });
    $('tf-reset').addEventListener('click', function () {
      state.table = { page: 0, ident: '', category: '', hqiMin: null, dMin: null, dMax: null, excludedOnly: false };
      $('tf-ident').value = ''; $('tf-category').value = ''; $('tf-hqi').value = '';
      $('tf-dmin').value = ''; $('tf-dmax').value = ''; $('tf-excluded').checked = false;
      renderRecordsTable(state.selectedSite, state.stats[state.selectedSite]);
    });

    // comparison
    $('btn-common-size').addEventListener('click', function () {
      state.settings.commonSizeRange = !state.settings.commonSizeRange;
      $('common-size-toggle').checked = state.settings.commonSizeRange;
      recomputeAll();
      renderCurrent();
    });

    // report exports
    $('btn-csv-summary').addEventListener('click', function () {
      MW.Report.download('MicroWatch-LDIR_summary.csv', MW.Report.buildSummaryCSV(state), 'text/csv');
    });
    $('btn-csv-records').addEventListener('click', function () {
      MW.Report.download('MicroWatch-LDIR_records.csv', MW.Report.buildRecordsCSV(state), 'text/csv');
    });
    $('btn-html-report').addEventListener('click', function () {
      MW.Report.download('MicroWatch-LDIR_report.html', MW.Report.buildHTMLReport(state), 'text/html');
    });
    $('btn-print').addEventListener('click', function () { window.print(); });

    wireEmptyButtons();
  }

  function handleFiles(files) {
    if (!files.length) return;
    var xlsx = files.filter(function (f) { return /\.xlsx$/i.test(f.name); });
    if (!xlsx.length) {
      $('import-warnings').innerHTML = '<div class="conc-flag">⚠ Unsupported file type — please upload .xlsx files.</div>';
      return;
    }
    Promise.all(xlsx.map(function (f) { return MW.ExcelReader.readFile(f); })).then(function (results) {
      results.forEach(addParsed);
      recomputeAll();
      renderCurrent();
    }).catch(function (err) {
      $('import-warnings').innerHTML = '<div class="conc-flag">⚠ ' + esc(err.message || String(err)) + '</div>';
    });
  }

  /* ================= init ================= */
  function init() {
    wire();
    recomputeAll();
    go('import');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
