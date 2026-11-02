/* ============================================================
 * MicroWatch-LDIR · Polymer classification rules
 * ------------------------------------------------------------
 * Three material groups used throughout the application:
 *   target    – synthetic polymers counted as candidate microplastics
 *   review    – materials with contested definitions; need manual confirmation
 *   nonTarget – natural / mineral materials, never counted as microplastics
 *
 * IMPORTANT: "Natural Polyamide" is a natural material and must NEVER be
 * merged with "PA" (synthetic polyamide). Alias matching below checks the
 * full phrase before any substring/alias rule is applied.
 * ============================================================ */
window.MW = window.MW || {};

MW.POLYMER_CATEGORIES = {
  target: [
    'PA', 'PTFE', 'PVC', 'PP', 'PET', 'PE', 'HDPE', 'PU', 'EVA', 'PMMA',
    'Polyacetal', 'Polysulfone', 'Polyvinyl alcohol', 'Polyacrylamide'
  ],
  review: [
    'Rubber', 'Silicone', 'Acrylates', 'Alkyd Varnish', 'Polyether', 'Cellulose Acetate'
  ],
  nonTarget: [
    'Natural Polyamide', 'Cellulosic', 'Chitin', 'Silica'
  ]
};

MW.CATEGORY_LABELS = {
  target:    { en: 'Target synthetic polymer', zh: '目标合成聚合物', short: 'Target' },
  review:    { en: 'Pending manual review',    zh: '待人工确认',     short: 'Review' },
  nonTarget: { en: 'Non-target material',      zh: '非目标材料',     short: 'Non-target' },
  unknown:   { en: 'Unclassified',             zh: '未分类',         short: 'Unknown' }
};

/* Full-phrase aliases (lower-case) → canonical name. Checked first. */
MW.POLYMER_FULL_ALIASES = {
  'natural polyamide': 'Natural Polyamide',
  'polyamide (natural)': 'Natural Polyamide',
  'natural pa': 'Natural Polyamide',
  'cellulose acetate': 'Cellulose Acetate',
  'alkyd varnish': 'Alkyd Varnish',
  'polyvinyl alcohol': 'Polyvinyl alcohol',
  'pva': 'Polyvinyl alcohol',
  'pvoh': 'Polyvinyl alcohol',
  'polyacrylamide': 'Polyacrylamide',
  'pam': 'Polyacrylamide',
  'polyacetal': 'Polyacetal',
  'polyoxymethylene': 'Polyacetal',
  'pom': 'Polyacetal',
  'polysulfone': 'Polysulfone',
  'psu': 'Polysulfone',
  'polyamide': 'PA',
  'polyamide (pa)': 'PA',
  'nylon': 'PA',
  'pa': 'PA',
  'polytetrafluoroethylene': 'PTFE',
  'ptfe': 'PTFE',
  'polyvinyl chloride': 'PVC',
  'polyvinylchloride': 'PVC',
  'pvc': 'PVC',
  'polypropylene': 'PP',
  'pp': 'PP',
  'polyethylene terephthalate': 'PET',
  'polyester': 'PET',
  'pet': 'PET',
  'high density polyethylene': 'HDPE',
  'high-density polyethylene': 'HDPE',
  'hdpe': 'HDPE',
  'polyethylene': 'PE',
  'pe': 'PE',
  'ldpe': 'PE',
  'polyurethane': 'PU',
  'pu': 'PU',
  'ethylene vinyl acetate': 'EVA',
  'ethylene-vinyl acetate': 'EVA',
  'eva': 'EVA',
  'polymethyl methacrylate': 'PMMA',
  'poly(methyl methacrylate)': 'PMMA',
  'acrylic': 'PMMA',
  'pmma': 'PMMA',
  'rubber': 'Rubber',
  'silicone': 'Silicone',
  'acrylates': 'Acrylates',
  'acrylate': 'Acrylates',
  'polyether': 'Polyether',
  'cellulosic': 'Cellulosic',
  'cellulose': 'Cellulosic',
  'chitin': 'Chitin',
  'silica': 'Silica',
  'quartz': 'Silica'
};

/**
 * Map a raw Identification string to a canonical material name.
 * Unknown strings are returned trimmed but otherwise unchanged.
 */
MW.canonicalMaterial = function (raw) {
  if (raw === null || raw === undefined) return '';
  var s = String(raw).trim();
  if (!s) return '';
  var key = s.toLowerCase().replace(/\s+/g, ' ');
  if (MW.POLYMER_FULL_ALIASES.hasOwnProperty(key)) return MW.POLYMER_FULL_ALIASES[key];
  // Exact canonical name match (case-insensitive)
  var all = [].concat(MW.POLYMER_CATEGORIES.target, MW.POLYMER_CATEGORIES.review, MW.POLYMER_CATEGORIES.nonTarget);
  for (var i = 0; i < all.length; i++) {
    if (all[i].toLowerCase() === key) return all[i];
  }
  return s;
};

/**
 * Default category for a canonical material name (before user overrides).
 */
MW.defaultCategory = function (canonical) {
  if (MW.POLYMER_CATEGORIES.target.indexOf(canonical) >= 0) return 'target';
  if (MW.POLYMER_CATEGORIES.review.indexOf(canonical) >= 0) return 'review';
  if (MW.POLYMER_CATEGORIES.nonTarget.indexOf(canonical) >= 0) return 'nonTarget';
  return 'unknown';
};

/**
 * Resolve the effective category, honouring user overrides made in the UI.
 * overrides: { canonicalName: 'target' | 'review' | 'nonTarget' }
 */
MW.classifyMaterial = function (raw, overrides) {
  var canonical = MW.canonicalMaterial(raw);
  var category = MW.defaultCategory(canonical);
  if (overrides && overrides.hasOwnProperty(canonical)) category = overrides[canonical];
  return { canonical: canonical, category: category };
};

/* Display order for composition charts (target polymers first). */
MW.POLYMER_ORDER = [].concat(MW.POLYMER_CATEGORIES.target, MW.POLYMER_CATEGORIES.review, MW.POLYMER_CATEGORIES.nonTarget);
