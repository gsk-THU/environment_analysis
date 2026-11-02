/* ============================================================
 * MicroWatch-LDIR · Excel reader
 * ------------------------------------------------------------
 * Reads LDIR export workbooks with the locally bundled SheetJS
 * library (vendor/xlsx.full.min.js). Nothing leaves the browser.
 * ============================================================ */
window.MW = window.MW || {};

MW.ExcelReader = (function () {

  /* Candidate header names (lower-case, non-alphanumerics stripped) */
  var FIELD_CANDIDATES = {
    site:           ['site', 'samplesite', 'sitename', 'location', 'sample', 'station'],
    id:             ['id', 'particleid', 'particle', 'index', 'no', 'number'],
    diameter:       ['diameter', 'diameterm', 'diameterum', 'size', 'particlesize', 'equivalentdiameter', 'feretdiameter'],
    area:           ['area', 'aream2', 'areaum2', 'particlearea'],
    length:         ['length', 'lengthm', 'lengthum', 'majoraxis', 'maxferet', 'feretmax'],
    width:          ['width', 'widthm', 'widthum', 'minoraxis', 'minferet', 'feretmin'],
    identification: ['identification', 'identity', 'material', 'polymer', 'polymertype', 'libraryhit', 'name', 'substance'],
    quality:        ['quality', 'hqi', 'hitqualityindex', 'matchquality', 'score', 'hitquality'],
    isValid:        ['isvalid', 'valid', 'validity', 'validflag']
  };

  function normKey(h) {
    return String(h === null || h === undefined ? '' : h).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /** Normalise raw site labels: "Site 3", "site3", "SITE_3" → "Site3". */
  function normalizeSiteName(raw) {
    if (raw === null || raw === undefined) return '';
    var s = String(raw).trim();
    var m = s.match(/site\s*[_\-]?\s*0*(\d+)/i);
    if (m) return 'Site' + parseInt(m[1], 10);
    return s;
  }

  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).replace(/,/g, '').trim();
    if (!s) return null;
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  function toBool(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    var s = String(v).trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'valid', 'ok'].indexOf(s) >= 0) return true;
    if (['false', 'no', 'n', '0', 'invalid'].indexOf(s) >= 0) return false;
    return null;
  }

  /** Build a header → column-index map using the candidate lists. */
  function mapColumns(headers) {
    var keys = headers.map(normKey);
    var map = {};
    Object.keys(FIELD_CANDIDATES).forEach(function (field) {
      var cands = FIELD_CANDIDATES[field];
      var idx = -1;
      // exact candidate match first
      for (var c = 0; c < cands.length && idx < 0; c++) {
        idx = keys.indexOf(cands[c]);
      }
      // then prefix match (e.g. "diameterμm" → diameter)
      for (var k = 0; k < keys.length && idx < 0; k++) {
        for (var c2 = 0; c2 < cands.length; c2++) {
          if (keys[k] && keys[k].indexOf(cands[c2]) === 0 && cands[c2].length >= 4) { idx = k; break; }
        }
      }
      map[field] = idx;
    });
    // "id" must not accidentally capture "Is Valid" or "Identification"
    if (map.id >= 0 && (map.id === map.isValid || map.id === map.identification)) map.id = -1;
    return map;
  }

  /**
   * Convert a header array + array-of-row-arrays into normalised records.
   * Shared by the XLSX path and the demo-data path.
   */
  function rowsToRecords(headers, rows, fileName) {
    var map = mapColumns(headers);
    var warnings = [];
    var missing = ['site', 'identification', 'quality'].filter(function (f) { return map[f] < 0; });
    if (missing.length) {
      warnings.push('Missing required column(s): ' + missing.join(', ') + ' in ' + fileName);
    }
    var records = [];
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (!row || row.every(function (c) { return c === null || c === undefined || c === ''; })) continue;
      var get = function (f) { return map[f] >= 0 ? row[map[f]] : undefined; };
      var siteRaw = get('site');
      var rec = {
        source: fileName,
        row: r + 2,                                   // 1-based Excel row incl. header
        siteRaw: siteRaw === undefined ? '' : String(siteRaw),
        site: normalizeSiteName(siteRaw),
        id: get('id') !== undefined && get('id') !== null ? String(get('id')) : String(r + 1),
        diameter: toNum(get('diameter')),
        area: toNum(get('area')),
        length: toNum(get('length')),
        width: toNum(get('width')),
        identification: get('identification') === undefined || get('identification') === null ? '' : String(get('identification')).trim(),
        quality: toNum(get('quality')),
        isValid: toBool(get('isValid'))
      };
      if (!rec.site) rec.site = 'Unknown';
      records.push(rec);
    }
    return { records: records, columns: map, headers: headers, warnings: warnings, fileName: fileName };
  }

  /** Pick the "Particles" sheet when present, otherwise the first sheet. */
  function pickSheet(workbook) {
    var names = workbook.SheetNames || [];
    for (var i = 0; i < names.length; i++) {
      if (/particle/i.test(names[i])) return names[i];
    }
    return names[0];
  }

  /** Find the header row: first row containing a "site"-like and an "identification"-like cell. */
  function findHeaderRow(aoa) {
    var limit = Math.min(aoa.length, 30);
    for (var i = 0; i < limit; i++) {
      var keys = (aoa[i] || []).map(normKey);
      var hasSite = keys.some(function (k) { return FIELD_CANDIDATES.site.indexOf(k) >= 0; });
      var hasIdent = keys.some(function (k) { return FIELD_CANDIDATES.identification.indexOf(k) >= 0; });
      var hasQuality = keys.some(function (k) { return FIELD_CANDIDATES.quality.indexOf(k) >= 0; });
      if ((hasSite && hasIdent) || (hasIdent && hasQuality)) return i;
    }
    return 0;
  }

  /** Parse an ArrayBuffer of an .xlsx file. Requires the global XLSX (SheetJS). */
  function parseWorkbook(arrayBuffer, fileName) {
    if (typeof XLSX === 'undefined') throw new Error('SheetJS (vendor/xlsx.full.min.js) is not loaded.');
    var wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: false });
    var sheetName = pickSheet(wb);
    if (!sheetName) throw new Error('Workbook contains no worksheets: ' + fileName);
    var ws = wb.Sheets[sheetName];
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    var h = findHeaderRow(aoa);
    var headers = (aoa[h] || []).map(function (c) { return c === null || c === undefined ? '' : String(c); });
    var rows = aoa.slice(h + 1);
    var out = rowsToRecords(headers, rows, fileName);
    out.sheetName = sheetName;
    out.fileName = fileName;
    return out;
  }
  /** Read a File object → Promise<parsed>. */
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read file ' + file.name)); };
      reader.onload = function (e) {
        try { resolve(parseWorkbook(e.target.result, file.name)); }
        catch (err) { reject(err); }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /** Summarise detected sites in a parsed result. */
  function summarizeSites(records) {
    var map = {};
    records.forEach(function (r) {
      if (!map[r.site]) map[r.site] = { site: r.site, rawNames: {}, count: 0 };
      map[r.site].count++;
      map[r.site].rawNames[r.siteRaw] = (map[r.site].rawNames[r.siteRaw] || 0) + 1;
    });
    return Object.keys(map).sort(siteSort).map(function (k) {
      var s = map[k];
      s.rawList = Object.keys(s.rawNames);
      return s;
    });
  }

  /** Natural sort for site names: Site1 < Site2 < Site10. */
  function siteSort(a, b) {
    var ma = String(a).match(/(\d+)/), mb = String(b).match(/(\d+)/);
    if (ma && mb) return parseInt(ma[1], 10) - parseInt(mb[1], 10);
    return String(a).localeCompare(String(b));
  }

  return {
    normalizeSiteName: normalizeSiteName,
    rowsToRecords: rowsToRecords,
    parseWorkbook: parseWorkbook,
    readFile: readFile,
    summarizeSites: summarizeSites,
    siteSort: siteSort,
    toNum: toNum,
    toBool: toBool
  };
})();
