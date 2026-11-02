/* ============================================================
 * MicroWatch-LDIR · Charts (locally bundled Chart.js v4)
 * ------------------------------------------------------------
 * Chart builders are split into two layers:
 *   configX(...)  – pure functions returning a Chart.js config
 *   renderX(id,…) – render (or replace) the chart on a canvas
 * This allows the Report Center to re-render the same charts
 * off-screen at a fixed pixel size and export them as PNG.
 * ============================================================ */
window.MW = window.MW || {};

MW.Charts = (function () {
  var registry = {};

  var SITE_COLORS = {
    Site1: '#1565C0',
    Site2: '#00897B',
    Site3: '#F59E0B',
    Site4: '#8E44AD'
  };
  function siteColor(site) { return SITE_COLORS[site] || '#607D8B'; }
  function siteColorRGBA(site, alpha) {
    var hex = siteColor(site);
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (alpha === undefined ? 0.75 : alpha) + ')';
  }

  var FONT = "-apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  var TEXT = '#334E68';
  var GRID = 'rgba(13, 71, 120, 0.10)';

  function axisTitle(text) {
    return { display: true, text: text, color: TEXT, font: { family: FONT, size: 11 } };
  }
  function baseOptions(extra) {
    var o = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: { labels: { color: TEXT, font: { family: FONT, size: 12 } } },
        valueLabels: { display: false },
        tooltip: {
          titleFont: { family: FONT },
          bodyFont: { family: FONT },
          footerFont: { family: FONT },
          backgroundColor: 'rgba(13, 43, 74, 0.95)',
          padding: 10
        }
      },
      scales: {
        x: { ticks: { color: TEXT, font: { family: FONT, size: 11 }, precision: 0 }, grid: { color: GRID } },
        y: { ticks: { color: TEXT, font: { family: FONT, size: 11 }, precision: 0 }, grid: { color: GRID }, beginAtZero: true, grace: '10%' }
      }
    };
    return deepMerge(o, extra || {});
  }
  function deepMerge(a, b) {
    var out = Array.isArray(a) ? a.slice() : Object.assign({}, a);
    if (!b) return out;
    Object.keys(b).forEach(function (k) {
      var bv = b[k];
      if (bv && typeof bv === 'object' && !Array.isArray(bv) && a && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) {
        out[k] = deepMerge(a[k], bv);
      } else {
        out[k] = bv;
      }
    });
    return out;
  }

  /* ---------- data labels plugin (values on top of bars) ----------
   * NOTE: Chart.js v4 treats function-valued plugin options as "scriptable"
   * and auto-invokes them, so the format is passed as a string key. */
  var valueLabels = {
    id: 'valueLabels',
    afterDatasetsDraw: function (chart) {
      var opts = chart.options.plugins.valueLabels;
      if (!opts || !opts.display) return;
      var ctx = chart.ctx;
      var horizontal = chart.options.indexAxis === 'y';
      ctx.save();
      ctx.font = '600 11px ' + FONT;
      ctx.fillStyle = opts.color || '#0D2B4A';
      ctx.textAlign = horizontal ? 'left' : 'center';
      ctx.textBaseline = horizontal ? 'middle' : 'bottom';
      chart.data.datasets.forEach(function (ds, di) {
        if (opts.datasetIndex !== undefined && opts.datasetIndex !== null && di !== opts.datasetIndex) return;
        var meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        meta.data.forEach(function (el, i) {
          var v = ds.data[i];
          if (typeof v !== 'number' || !isFinite(v) || v === 0) return;
          var txt = opts.format === 'fixed2' ? v.toFixed(2) : (opts.format === 'fixed1' ? v.toFixed(1) : String(v));
          if (horizontal) ctx.fillText(txt, el.x + 6, el.y);
          else ctx.fillText(txt, el.x, el.y - 4);
        });
      });
      ctx.restore();
    }
  };
  if (typeof Chart !== 'undefined' && Chart.register) { try { Chart.register(valueLabels); } catch (e) { /* ignore */ } }

  /* ---------- render helpers ---------- */
  function render(canvasId, config) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    if (registry[canvasId]) { try { registry[canvasId].destroy(); } catch (e) { /* ignore */ } }
    if (typeof Chart === 'undefined') return null;
    // clear any empty-state overlay left by showEmpty()
    canvas.style.display = '';
    var ph = canvas.parentElement ? canvas.parentElement.querySelector('.chart-empty') : null;
    if (ph) ph.parentElement.removeChild(ph);
    config.options = config.options || {};
    config.options.responsive = true;
    config.options.maintainAspectRatio = false;
    registry[canvasId] = new Chart(canvas.getContext('2d'), config);
    return registry[canvasId];
  }
  /** Replace a chart with an empty-state message (canvas is kept for later renders). */
  function showEmpty(canvasId, msg) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (registry[canvasId]) { try { registry[canvasId].destroy(); } catch (e) { /* ignore */ } delete registry[canvasId]; }
    canvas.style.display = 'none';
    var parent = canvas.parentElement;
    var ph = parent.querySelector('.chart-empty');
    if (!ph) { ph = document.createElement('div'); ph.className = 'chart-empty'; parent.appendChild(ph); }
    ph.textContent = msg || 'No data';
  }
  function destroyAll() {
    Object.keys(registry).forEach(function (k) {
      if (registry[k]) { try { registry[k].destroy(); } catch (e) { /* ignore */ } }
      delete registry[k];
    });
  }
  function toImage(canvasId) {
    var ch = registry[canvasId];
    if (!ch) return null;
    try { return ch.toBase64Image('image/png', 1.0); } catch (e) { return null; }
  }
  /** Render a config on an off-screen canvas → PNG data URL (for the HTML report). */
  function renderOffscreen(width, height, config) {
    if (typeof Chart === 'undefined') return null;
    var canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.style.position = 'fixed';
    canvas.style.left = '-10000px';
    canvas.style.top = '0';
    document.body.appendChild(canvas);
    var cfg = JSON.parse(JSON.stringify(config));      // deep copy
    cfg.options.responsive = false;
    cfg.options.maintainAspectRatio = false;
    cfg.options.animation = false;
    if (cfg.options.plugins && cfg.options.plugins.valueLabels) cfg.options.plugins.valueLabels = Object.assign({}, cfg.options.plugins.valueLabels);
    // function-valued options (tooltip callbacks) can't survive JSON: rebuild from source
    restoreFns(cfg, config);
    var chart = new Chart(canvas.getContext('2d'), cfg);
    var url = canvas.toDataURL('image/png', 1.0);
    chart.destroy();
    document.body.removeChild(canvas);
    return url;
  }
  function restoreFns(dst, src) {
    Object.keys(src).forEach(function (k) {
      if (typeof src[k] === 'function') dst[k] = src[k];
      else if (src[k] && typeof src[k] === 'object' && dst[k] && typeof dst[k] === 'object') restoreFns(dst[k], src[k]);
    });
  }

  var POLYMER_BLUES = ['#1565C0', '#00897B', '#F59E0B', '#8E44AD', '#E4572E', '#2F9BF4', '#7CB518', '#9E9E9E', '#6D4C41', '#EC407A', '#26C6DA', '#5C6BC0', '#FFA726', '#66BB6A'];
  function polymerPalette(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(POLYMER_BLUES[i % POLYMER_BLUES.length]);
    return out;
  }

  /* =================================================================
   * Config builders (pure)
   * ================================================================= */

  function configPolymerComposition(composition) {
    var labels = composition.map(function (c) { return c.polymer; });
    return {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Quality-filtered target particles',
          data: composition.map(function (c) { return c.count; }),
          backgroundColor: polymerPalette(labels.length).map(function (c) { return c + 'CC'; }),
          borderRadius: 4
        }]
      },
      options: baseOptions({
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          valueLabels: { display: true },
          tooltip: { callbacks: { label: function (ctx) { return ctx.parsed.x + ' particles'; } } }
        },
        scales: { x: { title: axisTitle('Particle count'), grace: '15%', beginAtZero: true } }
      })
    };
  }

  function configSizeDistribution(hist, filteredHist) {
    var edges = hist.edges;
    var labels = MW.Analysis.binLabels(edges, ' μm');
    var allData = hist.counts.slice();
    var filtData = filteredHist.counts.slice();
    if (hist.under) { labels.unshift('<' + edges[0] + ' μm'); allData.unshift(hist.under); filtData.unshift(filteredHist.under || 0); }
    if (hist.over) { labels.push('≥' + edges[edges.length - 1] + ' μm'); allData.push(hist.over); filtData.push(filteredHist.over || 0); }
    return {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'All particles', data: allData, backgroundColor: 'rgba(21, 101, 192, 0.35)', borderRadius: 3 },
          { label: 'Quality-filtered targets', data: filtData, backgroundColor: 'rgba(0, 137, 123, 0.85)', borderRadius: 3 }
        ]
      },
      options: baseOptions({
        plugins: { legend: { position: 'top' }, valueLabels: { display: false } },
        scales: { y: { title: axisTitle('Particles') }, x: { title: axisTitle('Diameter class') } }
      })
    };
  }

  function configHqiDistribution(hist, threshold) {
    var colors = hist.counts.map(function (_, i) {
      var hi = hist.edges[i + 1];
      if (hi <= 0.65) return 'rgba(229, 57, 53, 0.75)';
      if (hi <= 0.75) return 'rgba(245, 158, 11, 0.8)';
      if (hi <= 0.85) return 'rgba(21, 101, 192, 0.75)';
      return 'rgba(0, 137, 123, 0.85)';
    });
    return {
      type: 'bar',
      data: { labels: MW.Analysis.binLabels(hist.edges, ''), datasets: [{ label: 'All particles', data: hist.counts.slice(), backgroundColor: colors, borderRadius: 3 }] },
      options: baseOptions({
        plugins: {
          legend: { display: false },
          valueLabels: { display: true },
          tooltip: { footer: function (items) { return 'Current HQI threshold: ≥ ' + threshold.toFixed(2); } }
        },
        scales: { y: { title: axisTitle('Particles') }, x: { title: axisTitle('HQI (spectral match quality)') } }
      })
    };
  }

  function configMorphology(records, maxPoints) {
    var points = [];
    records.forEach(function (r) {
      if (typeof r.length === 'number' && typeof r.width === 'number' && r.width > 0 && typeof r.diameter === 'number') {
        points.push({ x: Math.round(r.diameter * 10) / 10, y: Math.round((r.length / r.width) * 100) / 100, cat: r.category });
      }
    });
    if (!points.length) return null;
    if (points.length > (maxPoints || 800)) points = points.slice(0, maxPoints);
    var groups = { target: [], review: [], nonTarget: [], unknown: [] };
    points.forEach(function (p) { (groups[p.cat] || groups.unknown).push(p); });
    var catColor = { target: 'rgba(21, 101, 192, 0.6)', review: 'rgba(245, 158, 11, 0.75)', nonTarget: 'rgba(120, 132, 148, 0.45)', unknown: 'rgba(190, 190, 190, 0.5)' };
    var datasets = Object.keys(groups).filter(function (k) { return groups[k].length; }).map(function (k) {
      return {
        label: MW.CATEGORY_LABELS[k] ? MW.CATEGORY_LABELS[k].short : k,
        data: groups[k],
        backgroundColor: catColor[k],
        pointRadius: 3.5,
        pointHoverRadius: 5
      };
    });
    return {
      type: 'scatter',
      data: { datasets: datasets },
      options: baseOptions({
        plugins: {
          legend: { position: 'top' },
          tooltip: { callbacks: { label: function (ctx) { return 'd=' + ctx.parsed.x.toFixed(1) + ' μm, L/W=' + ctx.parsed.y.toFixed(2); } } }
        },
        scales: {
          x: { type: 'linear', title: axisTitle('Diameter (μm)') },
          y: { title: axisTitle('Aspect ratio (length / width)'), ticks: { precision: 1 }, grace: '5%' }
        }
      })
    };
  }

  function configComparisonTargets(sites, statsMap) {
    var t = statsMap[sites[0]] ? statsMap[sites[0]].threshold.toFixed(2) : '';
    return {
      type: 'bar',
      data: {
        labels: sites,
        datasets: [
          { label: 'Screening count (no HQI filter)', data: sites.map(function (s) { return statsMap[s].screening; }), backgroundColor: 'rgba(21, 101, 192, 0.45)', borderRadius: 4 },
          { label: 'Quality-filtered count (HQI ≥ ' + t + ')', data: sites.map(function (s) { return statsMap[s].filtered; }), backgroundColor: 'rgba(0, 137, 123, 0.9)', borderRadius: 4 }
        ]
      },
      options: baseOptions({
        plugins: {
          valueLabels: { display: true, datasetIndex: 1 },
          legend: { position: 'top' },
          tooltip: { callbacks: { footer: function (items) { var st = statsMap[items[0].label]; return st && st.retention !== null ? 'Retention after HQI filter: ' + (st.retention * 100).toFixed(1) + '%' : ''; } } }
        },
        scales: { y: { title: axisTitle('Target particles') } }
      })
    };
  }

  function configComparisonComposition(sites, statsMap, topN) {
    var totals = {};
    sites.forEach(function (s) {
      statsMap[s].compositionFiltered.forEach(function (c) { totals[c.polymer] = (totals[c.polymer] || 0) + c.count; });
    });
    var keys = Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; });
    var N = topN || 10;
    var top = keys.slice(0, N);
    if (keys.length > N) top.push('Other');
    var datasets = sites.map(function (s) {
      var map = {};
      statsMap[s].compositionFiltered.forEach(function (c) { map[c.polymer] = c.count; });
      var data = top.map(function (k) {
        if (k !== 'Other') return map[k] || 0;
        return keys.slice(N).reduce(function (acc, k2) { return acc + (map[k2] || 0); }, 0);
      });
      return { label: s, data: data, backgroundColor: siteColorRGBA(s, 0.85), borderRadius: 2 };
    });
    return {
      type: 'bar',
      data: { labels: top, datasets: datasets },
      options: baseOptions({
        plugins: { legend: { position: 'top' }, valueLabels: { display: false } },
        scales: { x: { stacked: true, title: axisTitle('Polymer type') }, y: { stacked: true, title: axisTitle('Quality-filtered particles') } }
      })
    };
  }

  function configComparisonSize(sites, statsMap) {
    var edges = MW.SIZE_BINS;
    var labels = MW.Analysis.binLabels(edges, ' μm');
    var under = sites.some(function (s) { return statsMap[s].sizeHistAll.under; });
    var over = sites.some(function (s) { return statsMap[s].sizeHistAll.over; });
    if (under) labels.unshift('<' + edges[0] + ' μm');
    if (over) labels.push('≥' + edges[edges.length - 1] + ' μm');
    var L = labels.length;
    var datasets = sites.map(function (s) {
      var h = statsMap[s].sizeHistAll;
      var data = h.counts.slice();
      if (under) data.unshift(h.under);
      if (over) data.push(h.over);
      while (data.length < L) data.push(0);
      return { label: s, data: data, backgroundColor: siteColorRGBA(s, 0.6), borderColor: siteColor(s), borderWidth: 1, borderRadius: 2 };
    });
    return {
      type: 'bar',
      data: { labels: labels, datasets: datasets },
      options: baseOptions({
        plugins: { legend: { position: 'top' }, valueLabels: { display: false } },
        scales: { y: { title: axisTitle('All particles') }, x: { title: axisTitle('Diameter class') } }
      })
    };
  }

  function configComparisonConcentration(sites, concMap) {
    var valid = sites.filter(function (s) { return concMap[s] && typeof concMap[s].cRaw === 'number'; });
    var data = valid.map(function (s) { return Math.round(concMap[s].cRaw * 100) / 100; });
    return {
      type: 'bar',
      data: {
        labels: valid,
        datasets: [{
          label: 'Microplastic concentration (particles/L)',
          data: data,
          backgroundColor: valid.map(function (s) { return siteColorRGBA(s, 0.85); }),
          borderRadius: 5
        }]
      },
      options: baseOptions({
        plugins: {
          legend: { display: false },
          valueLabels: { display: true, format: 'fixed2' },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var s = valid[ctx.dataIndex], c = concMap[s];
                return ['Concentration: ' + c.cRaw.toFixed(2) + ' particles/L',
                  'Filtered particles: ' + c.count + ' (HQI ≥ ' + c.threshold.toFixed(2) + (c.minSize !== null ? ', ≥ ' + c.minSize + ' μm' : '') + ')',
                  'Sample volume: ' + MW.Concentration.fmtVolume(c.volume)];
              }
            }
          }
        },
        scales: { y: { title: axisTitle('particles/L (uncorrected)'), ticks: { precision: 2 }, grace: '15%' } }
      })
    };
  }

  function configThresholdSensitivity(sites, statsMap) {
    var labels = MW.HQI_THRESHOLD_OPTIONS.map(function (t) { return '≥ ' + t.toFixed(2); });
    var datasets = sites.map(function (s) {
      return {
        label: s,
        data: MW.HQI_THRESHOLD_OPTIONS.map(function (t) { return statsMap[s].sweepNoSize[t.toFixed(2)]; }),
        borderColor: siteColor(s),
        backgroundColor: siteColorRGBA(s, 0.12),
        tension: 0.25,
        fill: false,
        pointRadius: 4
      };
    });
    return {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: baseOptions({
        plugins: {
          legend: { position: 'top' },
          tooltip: { callbacks: { footer: function (items) { var st = statsMap[items[0].dataset.label]; return st ? 'Screening count (no HQI): ' + st.screening : ''; } } }
        },
        scales: { y: { title: axisTitle('Target particles retained') }, x: { title: axisTitle('HQI threshold') } }
      })
    };
  }

  /* =================================================================
   * Render wrappers
   * ================================================================= */
  function polymerComposition(id, composition) { return render(id, configPolymerComposition(composition)); }
  function sizeDistribution(id, hist, filteredHist) { return render(id, configSizeDistribution(hist, filteredHist)); }
  function hqiDistribution(id, hist, threshold) { return render(id, configHqiDistribution(hist, threshold)); }
  function morphology(id, records, maxPoints) { var c = configMorphology(records, maxPoints); return c ? render(id, c) : null; }
  function comparisonTargets(id, sites, statsMap) { return render(id, configComparisonTargets(sites, statsMap)); }
  function comparisonComposition(id, sites, statsMap, topN) { return render(id, configComparisonComposition(sites, statsMap, topN)); }
  function comparisonSize(id, sites, statsMap) { return render(id, configComparisonSize(sites, statsMap)); }
  function comparisonConcentration(id, sites, concMap) { return render(id, configComparisonConcentration(sites, concMap)); }
  function thresholdSensitivity(id, sites, statsMap) { return render(id, configThresholdSensitivity(sites, statsMap)); }

  return {
    SITE_COLORS: SITE_COLORS,
    siteColor: siteColor,
    siteColorRGBA: siteColorRGBA,
    render: render,
    showEmpty: showEmpty,
    destroyAll: destroyAll,
    toImage: toImage,
    renderOffscreen: renderOffscreen,
    valueLabelsPlugin: valueLabels,
    configPolymerComposition: configPolymerComposition,
    configSizeDistribution: configSizeDistribution,
    configHqiDistribution: configHqiDistribution,
    configMorphology: configMorphology,
    configComparisonTargets: configComparisonTargets,
    configComparisonComposition: configComparisonComposition,
    configComparisonSize: configComparisonSize,
    configComparisonConcentration: configComparisonConcentration,
    configThresholdSensitivity: configThresholdSensitivity,
    polymerComposition: polymerComposition,
    sizeDistribution: sizeDistribution,
    hqiDistribution: hqiDistribution,
    morphology: morphology,
    comparisonTargets: comparisonTargets,
    comparisonComposition: comparisonComposition,
    comparisonSize: comparisonSize,
    comparisonConcentration: comparisonConcentration,
    thresholdSensitivity: thresholdSensitivity
  };
})();
