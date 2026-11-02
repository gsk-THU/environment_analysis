/* ============================================================
 * MicroWatch-LDIR · Site analysis
 * ------------------------------------------------------------
 * Pure functions that turn particle records into per-site
 * statistics. Filtering parameters are kept separate from the
 * raw records: changing a threshold never mutates the data.
 * ============================================================ */
window.MW = window.MW || {};

MW.Analysis = (function () {

  /* ---------- small numeric helpers ---------- */
  function sortedNums(arr) {
    return arr.filter(function (v) { return typeof v === 'number' && isFinite(v); }).sort(function (a, b) { return a - b; });
  }
  function median(arr) {
    var s = sortedNums(arr);
    var n = s.length;
    if (!n) return null;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function mean(arr) {
    var s = sortedNums(arr);
    if (!s.length) return null;
    var t = 0;
    for (var i = 0; i < s.length; i++) t += s[i];
    return t / s.length;
  }
  function quantile(sorted, q) {
    if (!sorted.length) return null;
    var pos = (sorted.length - 1) * q;
    var lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function min(arr) { var s = sortedNums(arr); return s.length ? s[0] : null; }
  function max(arr) { var s = sortedNums(arr); return s.length ? s[s.length - 1] : null; }

  /** Histogram counts for bin edges [e0,e1,...,en] → n bins, plus under/over counts. */
  function histogram(values, edges) {
    var counts = new Array(edges.length - 1).fill(0);
    var under = 0, over = 0;
    values.forEach(function (v) {
      if (typeof v !== 'number' || !isFinite(v)) return;
      if (v < edges[0]) { under++; return; }
      if (v >= edges[edges.length - 1]) { over++; return; }
      for (var i = 0; i < edges.length - 1; i++) {
        if (v >= edges[i] && v < edges[i + 1]) { counts[i]++; return; }
      }
    });
    return { counts: counts, under: under, over: over, edges: edges };
  }
  function fmtEdge(v) {
    if (v >= 10) return String(v);
    if (v > 1 && v < 1.01) return '1.00';
    return v.toFixed(2);
  }
  function binLabels(edges, unit) {
    var out = [];
    for (var i = 0; i < edges.length - 1; i++) {
      out.push(fmtEdge(edges[i]) + '–' + fmtEdge(edges[i + 1]) + (unit || ''));
    }
    return out;
  }

  /* ---------- classification ---------- */

  /** Attach canonical material + category to every record (non-destructive copy of fields). */
  function enrich(records, overrides) {
    records.forEach(function (r) {
      var c = MW.classifyMaterial(r.identification, overrides);
      r.canonical = c.canonical;
      r.category = c.category;
    });
    return records;
  }

  function isValidRecord(r) { return r.isValid !== false; }

  /** Target polymer & valid record, regardless of HQI (Screening Count). */
  function isScreeningTarget(r) { return r.category === 'target' && isValidRecord(r); }

  /** Resolve the effective minimum size from settings. */
  function effectiveMinSize(settings) {
    if (settings.commonSizeRange) return MW.COMMON_SIZE_RANGE_MIN;
    return (typeof settings.minSize === 'number' && isFinite(settings.minSize)) ? settings.minSize : null;
  }

  /** Indicator I_i: target, valid, HQI ≥ t and (optionally) diameter ≥ minSize. */
  function passesFilter(r, threshold, minSize) {
    if (!isScreeningTarget(r)) return false;
    if (typeof r.quality !== 'number' || r.quality < threshold) return false;
    if (minSize !== null && minSize !== undefined) {
      if (typeof r.diameter !== 'number' || r.diameter < minSize) return false;
    }
    return true;
  }

  /** Why a record is excluded from the quality-filtered set (for the detail table). */
  function exclusionReason(r, threshold, minSize) {
    if (r.isValid === false) return 'Invalid record';
    if (r.category === 'review') return 'Pending manual review';
    if (r.category === 'nonTarget') return 'Non-target material';
    if (r.category === 'unknown') return 'Unclassified material';
    if (typeof r.quality !== 'number') return 'HQI missing';
    if (r.quality < threshold) return 'HQI < ' + threshold.toFixed(2);
    if (minSize !== null && minSize !== undefined && (typeof r.diameter !== 'number' || r.diameter < minSize)) return 'Diameter < ' + minSize + ' μm';
    return '';
  }

  /* ---------- composition helpers ---------- */
  function composition(records) {
    var map = {};
    records.forEach(function (r) { map[r.canonical] = (map[r.canonical] || 0) + 1; });
    return map;
  }
  function orderedComposition(map) {
    var keys = Object.keys(map);
    keys.sort(function (a, b) {
      var ia = MW.POLYMER_ORDER.indexOf(a), ib = MW.POLYMER_ORDER.indexOf(b);
      if (ia < 0) ia = 999; if (ib < 0) ib = 999;
      if (ia !== ib) return ia - ib;
      return map[b] - map[a];
    });
    return keys.map(function (k) { return { polymer: k, count: map[k] }; });
  }

  /* ---------- completeness ---------- */
  function fieldPresent(r, f) {
    var v = r[f];
    return !(v === null || v === undefined || v === '');
  }
  function completeness(records) {
    var complete = 0;
    records.forEach(function (r) {
      var ok = MW.REQUIRED_FIELDS.every(function (f) { return fieldPresent(r, f); });
      if (ok) complete++;
    });
    var validFlagged = records.filter(function (r) { return r.isValid !== null; }).length;
    return {
      complete: complete,
      total: records.length,
      rate: records.length ? complete / records.length : null,
      validFlagRate: records.length ? validFlagged / records.length : null
    };
  }

  /* ---------- outliers (Tukey) ---------- */
  function outlierBounds(values) {
    var s = sortedNums(values);
    if (s.length < 4) return null;
    var q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), iqr = q3 - q1;
    return { lo: q1 - 1.5 * iqr, hi: q3 + 1.5 * iqr, q1: q1, q3: q3 };
  }

  /* ---------- the main per-site statistics ---------- */
  function siteStats(records, settings) {
    var t = settings.hqiThreshold;
    var minSize = effectiveMinSize(settings);

    var valid = records.filter(isValidRecord);
    var screening = records.filter(isScreeningTarget);
    var filtered = records.filter(function (r) { return passesFilter(r, t, minSize); });
    var review = records.filter(function (r) { return r.category === 'review'; });
    var nonTarget = records.filter(function (r) { return r.category === 'nonTarget'; });
    var unknown = records.filter(function (r) { return r.category === 'unknown'; });

    var allHqi = records.map(function (r) { return r.quality; });
    var allDiam = records.map(function (r) { return r.diameter; });
    var filteredDiam = filtered.map(function (r) { return r.diameter; });
    var screeningDiam = screening.map(function (r) { return r.diameter; });

    var hqiGe75 = records.filter(function (r) { return typeof r.quality === 'number' && r.quality >= 0.75; }).length;
    var hqiGe85 = records.filter(function (r) { return typeof r.quality === 'number' && r.quality >= MW.HIGH_HQI_LEVEL; }).length;

    // Threshold sensitivity sweep (uses the same size limit as the current view)
    var sweep = {};
    MW.HQI_THRESHOLD_OPTIONS.forEach(function (th) {
      sweep[th.toFixed(2)] = records.filter(function (r) { return passesFilter(r, th, minSize); }).length;
    });
    // Sweep without any size limit (used for the comparison page toggle text)
    var sweepNoSize = {};
    MW.HQI_THRESHOLD_OPTIONS.forEach(function (th) {
      sweepNoSize[th.toFixed(2)] = records.filter(function (r) { return passesFilter(r, th, null); }).length;
    });

    var compFiltered = composition(filtered);
    var compScreening = composition(screening);

    var aspect = records.map(function (r) {
      return (typeof r.length === 'number' && typeof r.width === 'number' && r.width > 0) ? r.length / r.width : null;
    });

    return {
      total: records.length,
      validCount: valid.length,
      screening: screening.length,
      filtered: filtered.length,
      retention: screening.length ? filtered.length / screening.length : null,
      targetRatio: records.length ? screening.length / records.length : null,
      filteredRatio: records.length ? filtered.length / records.length : null,
      reviewCount: review.length,
      nonTargetCount: nonTarget.length,
      unknownCount: unknown.length,
      medianDiamFiltered: median(filteredDiam),
      meanDiamFiltered: mean(filteredDiam),
      medianDiamScreening: median(screeningDiam),
      meanDiamScreening: mean(screeningDiam),
      minDiam: min(allDiam),
      maxDiam: max(allDiam),
      medianDiamAll: median(allDiam),
      hqiMean: mean(allHqi),
      hqiMedian: median(allHqi),
      hqiGe75: hqiGe75,
      hqiGe75Ratio: records.length ? hqiGe75 / records.length : null,
      hqiGe85: hqiGe85,
      highHqiRatio: records.length ? hqiGe85 / records.length : null,
      richness: Object.keys(compFiltered).length,
      richnessScreening: Object.keys(compScreening).length,
      compositionFiltered: orderedComposition(compFiltered),
      compositionScreening: orderedComposition(compScreening),
      sizeHistAll: histogram(allDiam, MW.SIZE_BINS),
      sizeHistFiltered: histogram(filteredDiam, MW.SIZE_BINS),
      sizeHistScreening: histogram(screeningDiam, MW.SIZE_BINS),
      hqiHistAll: histogram(allHqi, MW.HQI_BINS),
      hqiHistTargets: histogram(screening.map(function (r) { return r.quality; }), MW.HQI_BINS),
      completeness: completeness(records),
      sweep: sweep,
      sweepNoSize: sweepNoSize,
      outlierBounds: outlierBounds(allDiam),
      hasMorphology: aspect.some(function (a) { return a !== null; }),
      hasArea: records.some(function (r) { return typeof r.area === 'number'; }),
      threshold: t,
      minSize: minSize,
      filteredRecords: filtered,
      screeningRecords: screening
    };
  }

  /** Aggregate stats over several sites (for the dashboard cards). */
  function aggregate(statsMap, sites) {
    var agg = { total: 0, screening: 0, filtered: 0, sites: 0 };
    sites.forEach(function (s) {
      var st = statsMap[s];
      if (!st) return;
      agg.total += st.total;
      agg.screening += st.screening;
      agg.filtered += st.filtered;
      agg.sites++;
    });
    return agg;
  }

  /** Detect differing detection size ranges across sites (rule R6). */
  function sizeRangeDiffers(statsMap, sites) {
    var mins = sites.map(function (s) { return statsMap[s] ? statsMap[s].minDiam : null; })
      .filter(function (v) { return typeof v === 'number'; });
    if (mins.length < 2) return { differs: false, mins: mins };
    var lo = Math.min.apply(null, mins), hi = Math.max.apply(null, mins);
    return { differs: (hi - lo) >= MW.SIZE_RANGE_DIFF_THRESHOLD, minLow: lo, minHigh: hi, mins: mins };
  }

  return {
    median: median, mean: mean, min: min, max: max, quantile: quantile,
    histogram: histogram, binLabels: binLabels,
    enrich: enrich,
    isScreeningTarget: isScreeningTarget,
    passesFilter: passesFilter,
    exclusionReason: exclusionReason,
    effectiveMinSize: effectiveMinSize,
    composition: composition,
    orderedComposition: orderedComposition,
    completeness: completeness,
    outlierBounds: outlierBounds,
    siteStats: siteStats,
    aggregate: aggregate,
    sizeRangeDiffers: sizeRangeDiffers
  };
})();
