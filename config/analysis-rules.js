/* ============================================================
 * MicroWatch-LDIR · Analysis rules & defaults
 * ------------------------------------------------------------
 * All thresholds, bin edges and expert rules used by the local
 * rule engine. No model training, no external calls.
 * ============================================================ */
window.MW = window.MW || {};

/* HQI (Hit Quality Index) reference bands published by the instrument vendor:
 *   0.65–0.75 low · 0.75–0.85 medium · ≥0.85 high spectral match quality */
MW.HQI_BANDS = {
  low:    { min: 0.65, max: 0.75, label: 'Low (0.65–0.75)' },
  medium: { min: 0.75, max: 0.85, label: 'Medium (0.75–0.85)' },
  high:   { min: 0.85, max: 1.01, label: 'High (≥0.85)' }
};

MW.HQI_THRESHOLD_OPTIONS = [0.65, 0.70, 0.75, 0.80, 0.85];
MW.HIGH_HQI_LEVEL = 0.85;      // used for P_high indicator
MW.COMMON_SIZE_RANGE_MIN = 20; // μm – common lower size limit across sites

MW.DEFAULT_SETTINGS = {
  hqiThreshold: 0.75,
  minSize: null,            // μm, null = no limit
  commonSizeRange: false,   // when true, minSize is forced to COMMON_SIZE_RANGE_MIN
  volumeUnit: 'L',
  analyzedFraction: null,   // f – fraction of filter area analysed (null = unconfirmed)
  blankCount: null,         // mean target particles in procedural blanks
  blankFraction: null,      // f_b for blanks (defaults to analyzedFraction)
  recovery: null            // method recovery as a fraction, e.g. 0.85
};

/* Histogram edges */
MW.SIZE_BINS = [10, 20, 30, 40, 50, 75, 100, 150, 200, 500];           // μm
MW.HQI_BINS  = [0.40, 0.50, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 1.001];

/* Required fields for the completeness check */
MW.REQUIRED_FIELDS = ['site', 'id', 'diameter', 'area', 'identification', 'quality', 'isValid'];

/* Expert rules (rule-based decision support, NOT machine learning) */
MW.ANALYSIS_RULES = [
  {
    id: 'R1', scope: 'record', level: 'high',
    condition: 'HQI < 0.65',
    message: 'Low spectral match quality – prioritise re-examination of these identifications.',
    zh: '光谱匹配质量较低，建议优先复核'
  },
  {
    id: 'R2', scope: 'record', level: 'medium',
    condition: '0.65 ≤ HQI < 0.75',
    message: 'Low-to-moderate match quality – use these results with caution.',
    zh: '低匹配质量，结果需谨慎使用'
  },
  {
    id: 'R3', scope: 'record', level: 'medium',
    condition: 'Particle size deviates strongly from the site distribution (Tukey 1.5×IQR rule)',
    message: 'Check anomalous particle sizes.',
    zh: '颗粒尺寸显著偏离本组分布，建议检查异常粒径'
  },
  {
    id: 'R4', scope: 'record', level: 'medium',
    condition: 'Material belongs to the manual-review category',
    message: 'Polymer classification needs manual confirmation.',
    zh: '材料属于待复核类别，聚合物归类需要人工确认'
  },
  {
    id: 'R5', scope: 'site', level: 'info',
    condition: 'Sample volume not provided',
    message: 'particles/L cannot be calculated without the sampled water volume.',
    zh: '缺少采样体积，无法计算 particles/L'
  },
  {
    id: 'R6', scope: 'dataset', level: 'medium',
    condition: 'Detected particle size ranges differ between sites',
    message: 'Apply a common size range (≥20 μm) before comparing sites.',
    zh: '不同Site的检测粒径范围不同，建议采用统一粒径范围比较'
  }
];

/* Threshold (μm) above which a difference in minimum detected size between
 * sites is considered a different detection range (triggers R6). */
MW.SIZE_RANGE_DIFF_THRESHOLD = 5;
