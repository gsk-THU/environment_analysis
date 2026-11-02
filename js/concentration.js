/* ============================================================
 * MicroWatch-LDIR · Concentration calculator
 * ------------------------------------------------------------
 *   C_raw       = N_MP / V                (full sample analysed)
 *   C_raw(f)    = N_MP / (V · f)          (fraction f of filter analysed)
 *   C_corrected = max(0, N_s/f_s − N̄_b/f_b) / (V · R)
 *   R_ij        = C_i / C_j
 * Rule: missing volume → no particles/L; missing blank → no blank
 * correction; missing recovery → no recovery-corrected result.
 * ============================================================ */
window.MW = window.MW || {};

MW.Concentration = (function () {

  function toLiters(value, unit) {
    if (typeof value !== 'number' || !isFinite(value)) return null;
    return unit === 'mL' ? value / 1000 : value;
  }

  /** Validate a volume entry → { ok, liters, error } */
  function validateVolume(value, unit) {
    if (value === null || value === undefined || value === '') {
      return { ok: false, liters: null, error: 'empty', message: 'Enter the sampled water volume to calculate particles/L.' };
    }
    var n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
    if (!isFinite(n)) return { ok: false, liters: null, error: 'nan', message: 'Sample volume must be a number.' };
    if (n <= 0) return { ok: false, liters: null, error: 'nonpositive', message: 'Sample volume must be greater than 0.' };
    return { ok: true, liters: toLiters(n, unit), error: null, message: null, value: n, unit: unit };
  }

  function raw(n, liters, fraction) {
    if (typeof liters !== 'number' || liters <= 0) return null;
    var f = (typeof fraction === 'number' && fraction > 0 && fraction <= 1) ? fraction : 1;
    return n / (liters * f);
  }

  function corrected(opts) {
    // opts: ns, fs, nb, fb, liters, recovery
    if (typeof opts.liters !== 'number' || opts.liters <= 0) return null;
    if (typeof opts.recovery !== 'number' || opts.recovery <= 0 || opts.recovery > 1) return null;
    if (typeof opts.nb !== 'number') return null;
    var fs = (typeof opts.fs === 'number' && opts.fs > 0) ? opts.fs : 1;
    var fb = (typeof opts.fb === 'number' && opts.fb > 0) ? opts.fb : fs;
    var net = Math.max(0, opts.ns / fs - opts.nb / fb);
    return net / (opts.liters * opts.recovery);
  }

  /**
   * Full concentration result for one site.
   * stats   – output of MW.Analysis.siteStats
   * settings– global settings (analyzedFraction, blankCount, blankFraction, recovery)
   * volume  – { value, unit }
   */
  function compute(stats, settings, volume) {
    var v = validateVolume(volume ? volume.value : null, volume ? volume.unit : settings.volumeUnit);
    var res = {
      volume: v,
      liters: v.ok ? v.liters : null,
      count: stats.filtered,
      screeningCount: stats.screening,
      threshold: stats.threshold,
      minSize: stats.minSize,
      cRaw: null,
      cScreening: null,
      cBlankOnly: null,
      cCorrected: null,
      byPolymer: [],
      bySize: [],
      flags: [],
      assumptions: []
    };
    if (!v.ok) {
      res.flags.push({ id: 'R5', text: v.message });
      return res;
    }
    var f = (typeof settings.analyzedFraction === 'number' && settings.analyzedFraction > 0 && settings.analyzedFraction <= 1) ? settings.analyzedFraction : null;
    res.fraction = f;
    res.cRaw = raw(stats.filtered, v.liters, f);
    res.cScreening = raw(stats.screening, v.liters, f);

    if (f === null) {
      res.assumptions.push('Analysed fraction not confirmed – the concentration assumes the whole deposited sample was analysed (f = 1).');
    } else {
      res.assumptions.push('Concentration extrapolated from an analysed fraction f = ' + f + ' of the deposited sample.');
    }

    var hasBlank = typeof settings.blankCount === 'number' && settings.blankCount >= 0;
    var hasRecovery = typeof settings.recovery === 'number' && settings.recovery > 0 && settings.recovery <= 1;

    if (hasBlank) {
      var fs = f || 1;
      var fb = (typeof settings.blankFraction === 'number' && settings.blankFraction > 0) ? settings.blankFraction : fs;
      res.cBlankOnly = Math.max(0, stats.filtered / fs - settings.blankCount / fb) / v.liters;
    } else {
      res.flags.push({ id: 'blank', text: 'No blank data – result is NOT blank-corrected.' });
    }
    if (hasBlank && hasRecovery) {
      res.cCorrected = corrected({
        ns: stats.filtered, fs: f || 1, nb: settings.blankCount,
        fb: settings.blankFraction || f || 1, liters: v.liters, recovery: settings.recovery
      });
    } else if (!hasRecovery) {
      res.flags.push({ id: 'recovery', text: 'No recovery rate – result is NOT recovery-corrected.' });
    }

    // Per-polymer concentrations (quality-filtered)
    res.byPolymer = stats.compositionFiltered.map(function (c) {
      return { polymer: c.polymer, count: c.count, c: raw(c.count, v.liters, f) };
    });
    // Per-size-class concentrations (quality-filtered)
    var labels = MW.Analysis.binLabels(MW.SIZE_BINS, ' μm');
    stats.sizeHistFiltered.counts.forEach(function (n, i) {
      if (n > 0) res.bySize.push({ bin: labels[i], count: n, c: raw(n, v.liters, f) });
    });
    if (stats.sizeHistFiltered.under > 0) res.bySize.unshift({ bin: '<' + MW.SIZE_BINS[0] + ' μm', count: stats.sizeHistFiltered.under, c: raw(stats.sizeHistFiltered.under, v.liters, f) });
    if (stats.sizeHistFiltered.over > 0) res.bySize.push({ bin: '≥' + MW.SIZE_BINS[MW.SIZE_BINS.length - 1] + ' μm', count: stats.sizeHistFiltered.over, c: raw(stats.sizeHistFiltered.over, v.liters, f) });
    return res;
  }

  /** Pairwise ratios R_ij = C_i / C_j for sites with a valid concentration. */
  function ratios(concMap, sites) {
    var out = [];
    var valid = sites.filter(function (s) { return concMap[s] && typeof concMap[s].cRaw === 'number'; });
    for (var i = 0; i < valid.length; i++) {
      for (var j = 0; j < valid.length; j++) {
        if (i === j) continue;
        var ci = concMap[valid[i]].cRaw, cj = concMap[valid[j]].cRaw;
        out.push({ i: valid[i], j: valid[j], ci: ci, cj: cj, ratio: cj > 0 ? ci / cj : null });
      }
    }
    return out;
  }

  function fmt(x, digits) {
    if (typeof x !== 'number' || !isFinite(x)) return '—';
    return x.toFixed(digits === undefined ? 2 : digits);
  }
  function fmtVolume(v) {
    if (!v || !v.ok) return '—';
    var l = v.liters;
    var s = (Math.round(l * 1000) / 1000).toString();
    if (v.unit === 'mL') return v.value + ' mL (' + s + ' L)';
    return s + ' L';
  }

  return {
    toLiters: toLiters,
    validateVolume: validateVolume,
    raw: raw,
    corrected: corrected,
    compute: compute,
    ratios: ratios,
    fmt: fmt,
    fmtVolume: fmtVolume
  };
})();
