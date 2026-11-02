/* ============================================================
 * MicroWatch-LDIR · Quality control & local rule engine
 * ------------------------------------------------------------
 * Rule-based decision support (R1–R6). Produces per-record flags,
 * per-site rule summaries and template-generated narrative text.
 * No language model, no network: every sentence is assembled from
 * computed numbers and fixed templates.
 * ============================================================ */
window.MW = window.MW || {};

MW.QC = (function () {

  function ruleById(id) {
    for (var i = 0; i < MW.ANALYSIS_RULES.length; i++) if (MW.ANALYSIS_RULES[i].id === id) return MW.ANALYSIS_RULES[i];
    return null;
  }

  /** Per-record flags: returns array of rule ids for one record. */
  function recordFlags(r, bounds) {
    var flags = [];
    if (typeof r.quality === 'number') {
      if (r.quality < 0.65) flags.push('R1');
      else if (r.quality < 0.75) flags.push('R2');
    }
    if (bounds && typeof r.diameter === 'number' && (r.diameter < bounds.lo || r.diameter > bounds.hi)) flags.push('R3');
    if (r.category === 'review') flags.push('R4');
    return flags;
  }

  /** Attach .flags to each record of a site and count rule hits. */
  function evaluateRecords(records, stats) {
    var counts = { R1: 0, R2: 0, R3: 0, R4: 0 };
    var targetCounts = { R1: 0, R2: 0, R3: 0, R4: 0 };
    records.forEach(function (r) {
      r.flags = recordFlags(r, stats.outlierBounds);
      r.flags.forEach(function (f) {
        counts[f]++;
        if (r.category === 'target') targetCounts[f]++;
      });
    });
    return { counts: counts, targetCounts: targetCounts };
  }

  /**
   * Site-level rule evaluation.
   * returns [{ id, level, condition, message, zh, triggered, count, detail }]
   */
  function evaluateSite(site, records, stats, settings, volume, datasetInfo) {
    var rc = evaluateRecords(records, stats);
    var out = [];
    ['R1', 'R2', 'R3', 'R4'].forEach(function (id) {
      var rule = ruleById(id);
      var n = rc.counts[id];
      var detail = '';
      if (id === 'R1' || id === 'R2') detail = n + ' records (' + rc.targetCounts[id] + ' target polymer identifications)';
      else if (id === 'R3') detail = n + ' records outside ' + (stats.outlierBounds ? (fmt(Math.max(0, stats.outlierBounds.lo), 1) + '–' + fmt(stats.outlierBounds.hi, 1) + ' μm') : 'n/a');
      else if (id === 'R4') detail = n + ' records in the manual-review category';
      out.push(extend(rule, { triggered: n > 0, count: n, detail: detail }));
    });
    var r5 = ruleById('R5');
    var vol = MW.Concentration.validateVolume(volume ? volume.value : null, volume ? volume.unit : 'L');
    out.push(extend(r5, { triggered: !vol.ok, count: vol.ok ? 0 : 1, detail: vol.ok ? 'Volume provided: ' + MW.Concentration.fmtVolume(vol) : 'No valid volume for ' + site }));
    var r6 = ruleById('R6');
    var diff = datasetInfo && datasetInfo.sizeRange;
    out.push(extend(r6, {
      triggered: !!(diff && diff.differs),
      count: diff && diff.differs ? 1 : 0,
      detail: diff && typeof diff.minLow === 'number' ? ('Minimum detected diameters range from ' + fmt(diff.minLow, 1) + ' to ' + fmt(diff.minHigh, 1) + ' μm across sites') : 'Single site or identical ranges'
    }));
    return { rules: out, recordCounts: rc.counts, targetCounts: rc.targetCounts };
  }

  function extend(a, b) { var o = {}; Object.keys(a).forEach(function (k) { o[k] = a[k]; }); Object.keys(b).forEach(function (k) { o[k] = b[k]; }); return o; }
  function fmt(x, d) { return (typeof x === 'number' && isFinite(x)) ? x.toFixed(d === undefined ? 2 : d) : '—'; }
  function pct(x, d) { return (typeof x === 'number' && isFinite(x)) ? (x * 100).toFixed(d === undefined ? 1 : d) + '%' : '—'; }

  /* ---------- narrative generation (templates only) ---------- */

  function sensitivityLabel(retention) {
    if (retention === null) return 'not assessable';
    if (retention < 0.25) return 'highly sensitive';
    if (retention < 0.60) return 'moderately sensitive';
    return 'relatively robust';
  }

  function hqiQualityLabel(meanHqi) {
    if (meanHqi === null) return 'unknown';
    if (meanHqi >= 0.85) return 'high';
    if (meanHqi >= 0.75) return 'medium';
    return 'low';
  }

  /** The per-site assessment paragraph (English, as in the design brief). */
  function siteSummary(site, stats, settings, conc) {
    var t = stats.threshold.toFixed(2);
    var parts = [];
    parts.push(site + ' contains ' + stats.total.toLocaleString() + ' particle records, including ' +
      stats.screening.toLocaleString() + ' preliminary target polymer identifications' +
      (stats.reviewCount ? ' and ' + stats.reviewCount + ' records in the manual-review category' : '') + '.');
    var sizeClause = stats.minSize !== null ? ' and a minimum particle size of ' + stats.minSize + ' μm' : '';
    parts.push('After applying an HQI threshold of ' + t + sizeClause + ', ' + stats.filtered.toLocaleString() +
      ' target particle' + (stats.filtered === 1 ? '' : 's') + ' remain' + (stats.filtered === 1 ? 's' : '') +
      (stats.retention !== null ? ' (retention ' + pct(stats.retention) + ')' : '') + '.');
    var sens = sensitivityLabel(stats.retention);
    if (sens === 'highly sensitive') {
      parts.push('The results are highly sensitive to spectral matching quality, indicating a need for further verification of low-HQI identifications.');
    } else if (sens === 'moderately sensitive') {
      parts.push('The results show moderate sensitivity to spectral matching quality; low-HQI identifications should be reviewed before interpretation.');
    } else if (sens === 'relatively robust') {
      parts.push('The target polymer count is relatively robust to the HQI threshold, suggesting generally reliable spectral matches.');
    }
    parts.push('The mean HQI of all records is ' + fmt(stats.hqiMean, 3) + ' (' + hqiQualityLabel(stats.hqiMean) + ' match quality); ' +
      pct(stats.hqiGe75Ratio) + ' of records reach HQI ≥ 0.75 and ' + stats.hqiGe85 + ' records reach HQI ≥ 0.85.');
    if (stats.filtered > 0) {
      parts.push('Quality-filtered target particles have a median diameter of ' + fmt(stats.medianDiamFiltered, 2) + ' μm (mean ' + fmt(stats.meanDiamFiltered, 2) + ' μm) across ' + stats.richness + ' polymer type' + (stats.richness === 1 ? '' : 's') +
        (stats.compositionFiltered.length ? ', dominated by ' + stats.compositionFiltered.slice(0, 3).map(function (c) { return c.polymer + ' (' + c.count + ')'; }).join(', ') : '') + '.');
    }
    if (stats.completeness.rate !== null) {
      parts.push('Key fields are ' + pct(stats.completeness.rate, 1) + ' complete and ' + pct(stats.completeness.validFlagRate, 1) + ' of records carry a validity flag.');
    }
    if (conc && typeof conc.cRaw === 'number') {
      parts.push('With a sample volume of ' + MW.Concentration.fmtVolume(conc.volume) + ', the uncorrected microplastic concentration is ' + fmt(conc.cRaw, 2) + ' particles/L (' + fmt(conc.cScreening, 2) + ' particles/L before HQI filtering). This value is not blank- or recovery-corrected unless stated otherwise.');
    } else {
      parts.push('No sample volume has been entered, so particles/L is not reported for this site.');
    }
    return parts.join(' ');
  }

  /** Concentration sentence for a single site (highlight box). */
  function concentrationSentence(site, conc) {
    if (!conc || typeof conc.cRaw !== 'number') return 'Enter a sample volume to calculate the microplastic concentration for ' + site + '.';
    return 'The calculated microplastic concentration is ' + fmt(conc.cRaw, 2) + ' particles/L, based on ' + conc.count +
      ' quality-filtered target particle' + (conc.count === 1 ? '' : 's') + ' (HQI ≥ ' + conc.threshold.toFixed(2) +
      (conc.minSize !== null ? ', ≥ ' + conc.minSize + ' μm' : '') + ') in a ' + MW.Concentration.fmtVolume(conc.volume) + ' water sample.';
  }

  /** Multi-site comparison narrative. */
  function comparisonSummary(sites, statsMap, concMap, settings, sizeRange) {
    var lines = [];
    if (sites.length < 2) return lines;
    var t = settings.hqiThreshold.toFixed(2);
    var minSize = MW.Analysis.effectiveMinSize(settings);
    var byFiltered = sites.slice().sort(function (a, b) { return statsMap[b].filtered - statsMap[a].filtered; });
    lines.push('Under HQI ≥ ' + t + (minSize !== null ? ' and particle size ≥ ' + minSize + ' μm' : '') + ', quality-filtered target particle counts are ' +
      sites.map(function (s) { return s + ': ' + statsMap[s].filtered; }).join(', ') + ' (highest at ' + byFiltered[0] + ').');
    var sensitive = sites.filter(function (s) { return statsMap[s].retention !== null && statsMap[s].retention < 0.25; });
    if (sensitive.length) {
      lines.push(sensitive.join(' and ') + ' retain' + (sensitive.length === 1 ? 's' : '') + ' less than 25% of preliminary target identifications after HQI filtering, so their polymer identifications are strongly threshold-dependent and should be re-examined rather than taken as confirmed microplastics.');
    }
    if (sizeRange && sizeRange.differs) {
      lines.push('Minimum detected particle sizes differ between sites (' + fmt(sizeRange.minLow, 1) + '–' + fmt(sizeRange.minHigh, 1) + ' μm); raw counts are therefore not directly comparable' + (settings.commonSizeRange ? ' – a common size range of ≥ ' + MW.COMMON_SIZE_RANGE_MIN + ' μm is currently applied.' : ' – apply the common size range (≥ ' + MW.COMMON_SIZE_RANGE_MIN + ' μm) before comparing.'));
    }
    var withC = sites.filter(function (s) { return concMap[s] && typeof concMap[s].cRaw === 'number'; });
    if (withC.length >= 2) {
      var sorted = withC.slice().sort(function (a, b) { return concMap[b].cRaw - concMap[a].cRaw; });
      var hi = sorted[0], lo = sorted[sorted.length - 1];
      var ratio = concMap[lo].cRaw > 0 ? concMap[hi].cRaw / concMap[lo].cRaw : null;
      if (ratio !== null) {
        lines.push('Under the selected screening criteria, ' + hi + ' exhibited a microplastic particle concentration ' + fmt(ratio, 1) + ' times that of ' + lo +
          ' (' + fmt(concMap[hi].cRaw, 2) + ' vs ' + fmt(concMap[lo].cRaw, 2) + ' particles/L). Concentrations are uncorrected for blanks and recovery and were computed with a uniform HQI threshold and size limit.');
      }
    } else if (withC.length < sites.length) {
      lines.push('Sample volumes are missing for ' + sites.filter(function (s) { return withC.indexOf(s) < 0; }).join(', ') + '; concentration comparison requires a valid volume for each site. Particle counts alone must not be used to rank pollution levels when sampled volumes differ.');
    }
    lines.push('No pollution grade (e.g. light/moderate/heavy) is assigned: there is no unified concentration classification standard applicable to these data, so only quantitative comparison is reported.');
    return lines;
  }

  return {
    recordFlags: recordFlags,
    evaluateRecords: evaluateRecords,
    evaluateSite: evaluateSite,
    siteSummary: siteSummary,
    concentrationSentence: concentrationSentence,
    comparisonSummary: comparisonSummary,
    sensitivityLabel: sensitivityLabel,
    hqiQualityLabel: hqiQualityLabel
  };
})();
