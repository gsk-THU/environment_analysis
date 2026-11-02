/* ============================================================
 * MicroWatch-LDIR · Report export
 * ------------------------------------------------------------
 * CSV data reports + standalone HTML analysis report + browser
 * print (Save as PDF). Everything is generated locally.
 * ============================================================ */
window.MW = window.MW || {};

MW.Report = (function () {

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function fmt(x, d) { return (typeof x === 'number' && isFinite(x)) ? x.toFixed(d === undefined ? 2 : d) : ''; }
  function pct(x, d) { return (typeof x === 'number' && isFinite(x)) ? (x * 100).toFixed(d === undefined ? 1 : d) + '%' : ''; }
  function download(filename, content, mime) {
    var blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
  }

  function paramString(settings, siteKey) {
    var minSize = MW.Analysis.effectiveMinSize(settings);
    return {
      hqi: settings.hqiThreshold.toFixed(2),
      minSize: minSize !== null ? minSize + ' μm' : 'No limit',
      fraction: (typeof settings.analyzedFraction === 'number') ? settings.analyzedFraction : 'not confirmed (assumed 1)',
      blank: (typeof settings.blankCount === 'number') ? settings.blankCount : 'not provided',
      recovery: (typeof settings.recovery === 'number') ? settings.recovery : 'not provided'
    };
  }

  /* ---------------- CSV reports ---------------- */

  function buildSummaryCSV(state) {
    var rows = [];
    rows.push(['MicroWatch-LDIR Analysis Summary']);
    rows.push(['Generated', new Date().toISOString().slice(0, 19).replace('T', ' ')]);
    rows.push(['Data sources', state.files.map(function (f) { return f.name; }).join(' + ')]);
    var p = paramString(state.settings);
    rows.push([]);
    rows.push(['Analysis parameters']);
    rows.push(['HQI threshold', p.hqi]);
    rows.push(['Minimum particle size', p.minSize]);
    rows.push(['Analyzed fraction', p.fraction]);
    rows.push(['Blank count (mean)', p.blank]);
    rows.push(['Recovery rate', p.recovery]);
    rows.push([]);
    rows.push(['Site indicators']);
    var head = ['Site', 'Total particles', 'Screening target count', 'Quality-filtered count (HQI≥' + p.hqi + ')',
      'Retention %', 'Target ratio %', 'Median diameter (filtered, μm)', 'Mean diameter (filtered, μm)',
      'Polymer richness (filtered)', 'Mean HQI', 'Records HQI≥0.75 %', 'Records HQI≥0.85 count',
      'Key-field completeness %', 'Review-category count'];
    rows.push(head);
    state.sites.forEach(function (s) {
      if (state.activeSites.indexOf(s) < 0) return;
      var st = state.stats[s];
      rows.push([s, st.total, st.screening, st.filtered, pct(st.retention), pct(st.targetRatio),
        fmt(st.medianDiamFiltered), fmt(st.meanDiamFiltered), st.richness, fmt(st.hqiMean, 3),
        pct(st.hqiGe75Ratio), st.hqiGe85, pct(st.completeness.rate), st.reviewCount]);
    });
    rows.push([]);
    rows.push(['Concentration results (uncorrected unless stated otherwise)']);
    rows.push(['Site', 'Filtered particles', 'Sample volume', 'C_raw (particles/L)', 'Screening C (particles/L)', 'Blank-corrected C', 'Blank+recovery corrected C']);
    state.sites.forEach(function (s) {
      if (state.activeSites.indexOf(s) < 0) return;
      var c = state.conc[s];
      if (!c) return;
      rows.push([s, c.count, MW.Concentration.fmtVolume(c.volume), fmt(c.cRaw), fmt(c.cScreening), fmt(c.cBlankOnly), fmt(c.cCorrected)]);
    });
    rows.push([]);
    rows.push(['Polymer composition (quality-filtered)']);
    rows.push(['Site', 'Polymer', 'Particles', 'Concentration (particles/L, if volume known)']);
    state.sites.forEach(function (s) {
      if (state.activeSites.indexOf(s) < 0) return;
      var st = state.stats[s], c = state.conc[s];
      st.compositionFiltered.forEach(function (comp) {
        var cc = (c && typeof c.cRaw === 'number') ? fmt(c.cRaw * comp.count / Math.max(1, st.filtered)) : '';
        rows.push([s, comp.polymer, comp.count, cc]);
      });
    });
    rows.push([]);
    rows.push(['HQI threshold sensitivity (target particles, current size limit)']);
    rows.push(['Site'].concat(MW.HQI_THRESHOLD_OPTIONS.map(function (t) { return '≥' + t.toFixed(2); })));
    state.sites.forEach(function (s) {
      if (state.activeSites.indexOf(s) < 0) return;
      var st = state.stats[s];
      rows.push([s].concat(MW.HQI_THRESHOLD_OPTIONS.map(function (t) { return st.sweep[t.toFixed(2)]; })));
    });
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n');
  }

  function buildRecordsCSV(state) {
    var head = ['Site', 'Id', 'Identification', 'Category', 'Diameter (μm)', 'Length (μm)', 'Width (μm)', 'Area (μm²)',
      'HQI (Quality)', 'Is Valid', 'Included by current filter', 'Exclusion reason', 'QC flags', 'Source file', 'Source row'];
    var rows = [head];
    state.records.forEach(function (r) {
      if (state.activeSites.indexOf(r.site) < 0) return;
      var st = state.stats[r.site];
      var included = MW.Analysis.passesFilter(r, st.threshold, st.minSize);
      rows.push([
        r.site, r.id, r.canonical || r.identification, MW.CATEGORY_LABELS[r.category] ? MW.CATEGORY_LABELS[r.category].short : r.category,
        fmt(r.diameter), fmt(r.length), fmt(r.width), fmt(r.area),
        fmt(r.quality, 3), r.isValid === null ? '' : (r.isValid ? 'TRUE' : 'FALSE'),
        included ? 'YES' : 'NO',
        included ? '' : MW.Analysis.exclusionReason(r, st.threshold, st.minSize),
        (r.flags || []).join('|'),
        r.source, r.row
      ]);
    });
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n');
  }

  /* ---------------- HTML report ---------------- */

  /** Build the complete standalone HTML report (with charts embedded as PNG). */
  function buildHTMLReport(state) {
    var p = paramString(state.settings);
    var now = new Date();
    var sites = state.activeSites;
    var agg = state.aggregate;

    var chartImgs = {};
    try { chartImgs.targets = MW.Charts.renderOffscreen(900, 430, MW.Charts.configComparisonTargets(sites, state.stats)); } catch (e) { }
    try { chartImgs.composition = MW.Charts.renderOffscreen(900, 430, MW.Charts.configComparisonComposition(sites, state.stats)); } catch (e) { }
    try { chartImgs.size = MW.Charts.renderOffscreen(900, 430, MW.Charts.configComparisonSize(sites, state.stats)); } catch (e) { }
    var hasConc = sites.some(function (s) { return state.conc[s] && typeof state.conc[s].cRaw === 'number'; });
    if (hasConc) { try { chartImgs.conc = MW.Charts.renderOffscreen(900, 430, MW.Charts.configComparisonConcentration(sites, state.conc)); } catch (e) { } }

    function img(key, caption) {
      if (!chartImgs[key]) return '';
      return '<figure><img src="' + chartImgs[key] + '" alt="' + esc(caption) + '"/><figcaption>' + esc(caption) + '</figcaption></figure>';
    }

    var siteRows = sites.map(function (s) {
      var st = state.stats[s];
      return '<tr><td>' + esc(s) + '</td><td>' + st.total.toLocaleString() + '</td><td>' + st.screening.toLocaleString() + '</td><td>' + st.filtered.toLocaleString() + '</td><td>' +
        pct(st.retention) + '</td><td>' + pct(st.targetRatio) + '</td><td>' + fmt(st.medianDiamFiltered) + '</td><td>' + st.richness + '</td><td>' + fmt(st.hqiMean, 3) + '</td><td>' + pct(st.completeness.rate, 0) + '</td></tr>';
    }).join('');

    var concRows = sites.map(function (s) {
      var c = state.conc[s];
      if (!c) return '';
      return '<tr><td>' + esc(s) + '</td><td>' + c.count + '</td><td>' + esc(MW.Concentration.fmtVolume(c.volume)) + '</td><td>' + fmt(c.cRaw) + '</td><td>' + fmt(c.cScreening) + '</td><td>' + fmt(c.cCorrected) + '</td></tr>';
    }).join('');

    var compRows = [];
    sites.forEach(function (s) {
      state.stats[s].compositionFiltered.forEach(function (c2) {
        compRows.push('<tr><td>' + esc(s) + '</td><td>' + esc(c2.polymer) + '</td><td>' + c2.count + '</td></tr>');
      });
    });

    var qcBlocks = sites.map(function (s) {
      var st = state.stats[s];
      var qc = state.qc[s] || { rules: [] };
      var triggered = qc.rules.filter(function (r) { return r.triggered; });
      var li = triggered.map(function (r) { return '<li><b>' + r.id + '</b> — ' + esc(r.message) + ' <span class="muted">(' + esc(r.detail) + ')</span></li>'; }).join('');
      var conc = state.conc[s];
      return '<div class="qc-site"><h4>' + esc(s) + '</h4><p>' + esc(MW.QC.siteSummary(s, st, state.settings, conc)) + '</p>' +
        (triggered.length ? '<ul>' + li + '</ul>' : '<p class="muted">No quality rules triggered.</p>') + '</div>';
    }).join('');

    var compSummary = MW.QC.comparisonSummary(sites, state.stats, state.conc, state.settings, state.sizeRange)
      .map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('');

    var volKnown = sites.some(function (s) { return state.conc[s] && typeof state.conc[s].cRaw === 'number'; });

    return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"/><title>MicroWatch-LDIR Analysis Report</title><style>' + REPORT_CSS + '</style></head><body>' +
      '<div class="page">' +
      '<header><div class="brand"><span class="logo">◍</span> MicroWatch-LDIR</div><h1>LDIR Microplastic Monitoring Analysis Report</h1>' +
      '<p class="sub">Offline LDIR Microplastic Data Analysis and Quality Control · generated ' + now.toISOString().slice(0, 19).replace('T', ' ') + ' (local time, browser-side)</p></header>' +
      '<section><h2>1. Data source &amp; parameters</h2>' +
      '<table><tr><th>Item</th><th>Value</th></tr>' +
      '<tr><td>Data files</td><td>' + esc(state.files.map(function (f) { return f.name; }).join('; ')) + '</td></tr>' +
      '<tr><td>Sites analysed</td><td>' + esc(sites.join(', ')) + '</td></tr>' +
      '<tr><td>Total particle records</td><td>' + agg.total.toLocaleString() + '</td></tr>' +
      '<tr><td>HQI threshold</td><td>≥ ' + p.hqi + '</td></tr>' +
      '<tr><td>Minimum particle size</td><td>' + esc(p.minSize) + '</td></tr>' +
      '<tr><td>Analyzed fraction (f)</td><td>' + esc(p.fraction) + '</td></tr>' +
      '<tr><td>Blank count / recovery</td><td>' + esc(p.blank) + ' / ' + esc(p.recovery) + '</td></tr>' +
      '</table></section>' +
      '<section><h2>2. Site indicators</h2><table><tr><th>Site</th><th>Total</th><th>Screening targets</th><th>Filtered (HQI≥' + p.hqi + ')</th><th>Retention</th><th>Target ratio</th><th>Median diam. (μm)</th><th>Richness</th><th>Mean HQI</th><th>Completeness</th></tr>' + siteRows + '</table>' +
      '<p class="note">Screening count = target polymer identifications without an HQI threshold; filtered count applies the HQI threshold and size limit above. The two must not be mixed.</p></section>' +
      '<section><h2>3. Charts</h2>' + img('targets', 'Target polymer counts: screening vs quality-filtered') + img('composition', 'Polymer composition by site (quality-filtered)') + img('size', 'Particle size distribution by site') +
      (chartImgs.conc ? img('conc', 'Microplastic concentration across sites (particles/L, uncorrected)') : '') + '</section>' +
      (volKnown ? '<section><h2>4. Microplastic concentration</h2><table><tr><th>Site</th><th>Filtered particles</th><th>Sample volume</th><th>C_raw (particles/L)</th><th>Screening C (particles/L)</th><th>Blank+recovery corrected</th></tr>' + concRows + '</table>' +
      '<p class="note">Concentrations are candidate LDIR counts divided by the entered volume' + (typeof state.settings.analyzedFraction === 'number' ? ' and the analysed fraction f = ' + state.settings.analyzedFraction : ' (assuming the whole sample was analysed)') + '. They are not blank- or recovery-corrected unless stated, and are not confirmed by manual review of each particle.</p></section>' : '') +
      '<section><h2>5. Polymer composition detail</h2><table><tr><th>Site</th><th>Polymer</th><th>Filtered particles</th></tr>' + compRows + '</table></section>' +
      '<section><h2>6. Quality assessment (local rule engine R1–R6)</h2>' + qcBlocks + '</section>' +
      '<section><h2>7. Comparison &amp; conclusions</h2>' + compSummary + '</section>' +
      '<footer><p>Generated fully offline by MicroWatch-LDIR · rule-based decision support (no machine learning, no external APIs). Particle numbers are LDIR candidate identifications filtered by the stated rules, not manually confirmed microplastic counts.</p></footer>' +
      '</div></body></html>';
  }

  var REPORT_CSS = [
    'body{font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#22313F;margin:0;background:#EEF3F8}',
    '.page{max-width:900px;margin:24px auto;background:#fff;padding:48px 56px;box-shadow:0 2px 14px rgba(13,43,74,.12)}',
    'h1{font-size:24px;margin:8px 0 4px;color:#0D2B4A}h2{font-size:17px;color:#1565C0;border-bottom:2px solid #E3EEF9;padding-bottom:6px;margin-top:28px}h4{margin:14px 0 4px}',
    '.brand{color:#1565C0;font-weight:700}.sub{color:#64748B;font-size:12px;margin-top:2px}',
    'table{border-collapse:collapse;width:100%;font-size:12.5px;margin:10px 0}th,td{border:1px solid #D7E3F0;padding:6px 9px;text-align:left}th{background:#EAF2FB;color:#0D2B4A}',
    'tr:nth-child(even) td{background:#F7FAFD}',
    'figure{margin:14px 0;text-align:center}figure img{max-width:100%;border:1px solid #E3EEF9;border-radius:6px}figcaption{font-size:12px;color:#64748B;margin-top:6px}',
    '.qc-site{margin-bottom:14px;padding:10px 14px;background:#F4F8FC;border-left:4px solid #1565C0;border-radius:4px}',
    'ul{margin:6px 0;padding-left:20px}li{margin:3px 0;font-size:13px}',
    '.muted{color:#8595A6}.note{font-size:12px;color:#5A6B7E;background:#F4F8FC;padding:8px 12px;border-radius:4px}',
    'footer{margin-top:28px;font-size:11px;color:#8595A6;border-top:1px solid #E3EEF9;padding-top:12px}',
    '@media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;padding:24px 8mm}}'
  ].join('\n');

  return {
    buildSummaryCSV: buildSummaryCSV,
    buildRecordsCSV: buildRecordsCSV,
    buildHTMLReport: buildHTMLReport,
    download: download,
    REPORT_CSS: REPORT_CSS
  };
})();
