export type LoopType = 'flow' | 'level' | 'pressure' | 'temperature' | 'composition' | 'unknown';

export type ScenarioType = 'open_step' | 'closed_step' | 'natural_disturbance' | 'continuous';

export interface POULoopConfig {
  tag: string;
  description: string;
  loopType: LoopType;
  unit: string;
  pb: number;       // 比例带 (%)
  ti: number;       // 积分时间 (s)
  td: number;       // 微分时间 (s)
  kd: number;       // 微分增益
  svh: number;      // SV 量程上限
  svl: number;      // SV 量程下限
  mvh: number;      // MV 量程上限
  mvl: number;      // MV 量程下限
  pvhh: number;     // PV 高高报
  pvh: number;      // PV 高报
  pvl: number;      // PV 低报
  pvll: number;     // PV 低低报
  mode: string;     // 默认控制模式 (AUTO / MAN / CAS)
  swpn: '正作用' | '反作用';
  pidOpt: '标准PID' | '微分先行' | '不完全微分';
}

export interface POUDictionary {
  id: string;
  filename: string;
  sha256: string;
  sheetName: string;
  rawTotalColumns: number;
  dedupedColumns: number;
  repeatedColumnExample: string;
  skippedCommentRows: number[];
  totalLoops: number;
  loopCountByType: Record<LoopType, number>;
  loops: Record<string, POULoopConfig>;
}

export interface TimeSeriesPoint {
  seq: number;
  rawTimestamp: string;
  epochMs: number;
  relSec: number;
  sv: number;
  pv: number;
  mv: number;
  mode: string;
  scenario: string;
  scenarioType: ScenarioType;
  sliceRule: string;
  saturated: boolean;
  segmentId: number;
  simPb?: number;
  simTi?: number;
  simTd?: number;
}

export interface ContinuousSegment {
  segmentId: number;
  label: string;
  startIndex: number;
  endIndex: number;
  startTimeStr: string;
  endTimeStr: string;
  durationSec: number;
  rowCount: number;
  gapBeforeSec: number;
  scenarioType: ScenarioType;
  tag: string;
}

export interface ColumnProfile {
  name: string;
  inferredType: 'timestamp' | 'numeric' | 'categorical' | 'sequence';
  missingRate: number;
  parseableRate: number;
  sampleValues: string[];
}

export interface DatasetParsed {
  id: string;
  role: 'actual' | 'sim';
  filename: string;
  sha256: string;
  fileSizeBytes: number;
  encoding: 'UTF-8 with BOM' | 'UTF-8' | 'GB18030' | 'GBK（无 BOM）';
  encodingScore: number;
  chineseHeaderRatio: number;
  delimiter: ',' | ';' | '\t';
  tableFormat: 'wide' | 'long';
  totalRows: number;
  totalCols: number;
  timeStart: string;
  timeEnd: string;
  uniqueTimestampCount: number;
  hasDuplicateTimestamps: boolean;
  duplicateRatioPerTimestamp: number;
  reconstruct1HzEnabled: boolean;
  gapsCount: number;
  maxGapSeconds: number;
  segments: ContinuousSegment[];
  detectedTags: string[];
  detectedScenarios: string[];
  columns: ColumnProfile[];
  previewRows: Record<string, string | number>[];
  samplingIntervalHistogram: { intervalLabel: string; count: number; percentage: number }[];
  /** Keyed by tag (for wide table) or `${tag}::${scenario}` (for long table) */
  seriesMap: Record<string, TimeSeriesPoint[]>;
}

export interface LoopRoleOverride {
  tag: string;
  loopType: LoopType;
  description: string;
  unit: string;
  pvMin: number;
  pvMax: number;
  mvMin: number;
  mvMax: number;
  scaleFactor: number;
  matchedInPou: boolean;
  pouConfig?: POULoopConfig;
}

export interface FieldMappingConfig {
  datasetId: string;
  timeCol: string;
  seqCol: string;
  tagCol: string;
  svCol: string;
  pvCol: string;
  mvCol: string;
  modeCol: string;
  scenarioCol: string;
  qualityCol: string;
  loopOverrides: Record<string, LoopRoleOverride>;
}

export interface MappingTemplate {
  id: string;
  name: string;
  fingerprint: string;
  tableFormat: 'wide' | 'long';
  createdAt: string;
  mapping: Omit<FieldMappingConfig, 'datasetId' | 'loopOverrides'>;
}

export type CascadeRole = 'standalone' | 'master' | 'slave';

export interface PairItem {
  id: string;
  name: string;
  actualTag: string;
  actualSegmentId: number;
  simKey: string;
  simTag: string;
  scenarioName: string;
  scenarioType: ScenarioType;
  scenario?: ScenarioType;
  loopType: LoopType;
  pvSpan: [number, number];
  mvSpan: [number, number];
  unit: string;
  actualWindowStartSec?: number;
  actualWindowEndSec?: number;
  simWindowStartSec?: number;
  simWindowEndSec?: number;
  /** 主从串级回路角色：单回路 / 主调回路 (Master, 如 TC11003) / 副调回路 (Slave, 如 FC10901) */
  cascadeRole?: CascadeRole;
  /** 关联的主回路或副回路配对 ID (例如 pair_tc_closed <-> pair_fc_closed) */
  linkedPairId?: string;
  /** 串级拓扑中的主回路位号 (如 TC11003) */
  masterTag?: string;
  /** 串级拓扑中的副回路位号 (如 FC10901) */
  slaveTag?: string;
}

export interface AlignmentOptions {
  mode: 'scenario_window' | 'same_source_time' | 'self_compare';
  gridSec: number;
  resampleMethod: 'linear' | 'zoh' | 'nearest';
  relativeTime: boolean;
  reconstructClock1Hz: boolean;
  excludeGaps: boolean;
  minSegmentSec: number;
  autoLagEstimate: boolean;
  manualLagSec: number;
  windowStartSec?: number;
  windowEndSec?: number;
}

export interface ToleranceConfig {
  flowPressureRmsePct: number;
  tempLevelRmsePct: number;
  compositionRmsePct: number;
  overshootWarningPct: number;
}

export interface AlignedPoint {
  t: number; // relative seconds from window start
  timestampLabel: string;
  simSv: number;
  simPv: number;
  simMv: number;
  actSv: number;
  actPv: number;
  actMv: number;
  errorPvAbs: number; // actPv - simPv
  errorPvPct: number; // (actPv - simPv) / span * 100
  errorMvAbs: number; // actMv - simMv
  inTolerance: boolean;
  segmentId: number;
  simMode: string;
  actMode: string;
}

export interface ClosedLoopStepMetrics {
  overshootPct: number;
  riseTime10to90Sec: number;
  peakTimeSec: number;
  settlingTime2PctSec: number;
  settlingTime5PctSec: number;
  steadyStateErrorAbs: number;
  steadyStateErrorPct: number;
  oscillationCount: number;
  iae: number;
  ise: number;
  itae: number;
}

export interface MVBehaviorMetrics {
  saturationTimePct: number;
  totalTravel: number;
  peakRatePerSec: number;
  autoModeRatioPct: number;
}

export interface PairComparisonMetrics {
  pairId: string;
  pairName: string;
  actualTag: string;
  simTag: string;
  scenarioName: string;
  scenarioType: ScenarioType;
  loopType: LoopType;
  unit: string;
  pvSpan: [number, number];
  mvSpan: [number, number];

  // Error Metrics
  rmseAbs: number;
  rmsePct: number;
  maeAbs: number;
  maePct: number;
  maxAbsError: number;
  maxErrorPct: number;
  biasAbs: number;
  biasPct: number;

  // Fit & Lag Metrics
  pearsonR: number;
  rSquared: number;
  estimatedLagSec: number;
  appliedLagSec: number;
  maxCrossCorr: number;

  // Closed-Loop Step Metrics (Sim vs Actual)
  simClosedLoop: ClosedLoopStepMetrics;
  actClosedLoop: ClosedLoopStepMetrics;

  // MV Metrics (Sim vs Actual)
  simMvMetrics: MVBehaviorMetrics;
  actMvMetrics: MVBehaviorMetrics;
  modeConsistencyPct: number;

  // PID Parameters Comparison (Config vs Sim)
  pouPid?: {
    pb: number;
    ti: number;
    td: number;
    kd: number;
    swpn: string;
    pidOpt: string;
    pvhh: number;
    pvh: number;
    pvl: number;
    pvll: number;
  };
  simPid?: {
    pb: number;
    ti: number;
    td: number;
  };

  // Evaluation
  toleranceRmsePct: number;
  grade: 'PASS' | 'WARNING' | 'FAIL';
  effectivePoints: number;
  effectiveDurationSec: number;
  excludedGapSeconds: number;
}

export interface TopDeviationInterval {
  rank: number;
  pairName: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  peakErrorAbs: number;
  peakErrorPct: number;
  intervalRmsePct: number;
  diagnosticNote: string;
}

export interface ResidualHistogramBin {
  binStartPct: number;
  binEndPct: number;
  label: string;
  count: number;
  densityPct: number;
}

export interface ResidualDistribution {
  bins: ResidualHistogramBin[];
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  mean: number;
  stdDev: number;
}

export interface ComparisonRunResult {
  runId: string;
  createdAt: string;
  title: string;
  simDatasetMeta: {
    id: string;
    filename: string;
    sha256: string;
    encoding: string;
    rows: number;
    cols: number;
    tableFormat: string;
    timeRange: string;
  };
  actualDatasetMeta: {
    id: string;
    filename: string;
    sha256: string;
    encoding: string;
    rows: number;
    cols: number;
    tableFormat: string;
    timeRange: string;
    reconstructed1Hz: boolean;
    gapsExcluded: number;
  };
  pouMeta?: {
    filename: string;
    sha256: string;
    totalLoops: number;
    dedupedColumns: number;
  };
  alignmentOptions: AlignmentOptions;
  tolerances: ToleranceConfig;
  pairResults: {
    pair: PairItem;
    metrics: PairComparisonMetrics;
    alignedSeries: AlignedPoint[];
    residualDist: ResidualDistribution;
    topDeviations: TopDeviationInterval[];
  }[];
  overallGrade: 'PASS' | 'WARNING' | 'FAIL';
  summaryConclusion: string[];
}
