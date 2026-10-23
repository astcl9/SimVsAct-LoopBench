import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCanonicalNormalizedPreview,
  computeCascadeCoupledAnalysis,
  computeClosedLoopStepMetrics,
  computeCrossCorrelationCurve,
  computeSpectralPsdAnalysis,
  computeValveHysteresisMetrics,
  detectAutoSliceWindows,
  detectEncodingAndDecode,
  detectTableMorphology,
  estimateCrossCorrelationLag,
  executeColumnarSqlAggregation,
  identifyProcessModelSummary,
  inferLoopTypeFromTag,
  lttbDownsample,
  resolveMasterSlavePairBundles,
  runPairComparison,
} from './engine';
import { buildSamplePlatformBundle } from './sampleData';

test('B1 & B2: Wide table and Long table sample datasets parse with exact dimensions and tags', () => {
  const bundle = buildSamplePlatformBundle(true);

  // Verify actual history dataset (history_FC10901andTC11003_sec.csv)
  assert.equal(bundle.actualDataset.tableFormat, 'wide');
  assert.equal(bundle.actualDataset.totalRows, 757);
  assert.equal(bundle.actualDataset.totalCols, 8);
  assert.equal(bundle.actualDataset.encoding, 'GBK（无 BOM）');
  assert.deepEqual(bundle.actualDataset.detectedTags, ['FC10901', 'TC11003']);

  // Verify simulation dataset (三类整定切片规则模拟结果.csv)
  assert.equal(bundle.simDataset.tableFormat, 'long');
  assert.equal(bundle.simDataset.totalRows, 7200);
  assert.equal(bundle.simDataset.totalCols, 15);
  assert.equal(bundle.simDataset.encoding, 'UTF-8 with BOM');
  assert.equal(bundle.simDataset.detectedTags.includes('SIM_FIC_OPEN'), true);
  assert.equal(bundle.simDataset.detectedTags.includes('SIM_FIC_CLOSED'), true);
  assert.equal(bundle.simDataset.detectedTags.includes('SIM_FIC_NATURAL'), true);
});

test('B3: Duplicate minute timestamps (4 rows/min) and ~3-day gap are detected and reconstructed at 1Hz', () => {
  const bundle = buildSamplePlatformBundle(true);
  const act = bundle.actualDataset;

  assert.equal(act.hasDuplicateTimestamps, true);
  assert.equal(act.reconstruct1HzEnabled, true);
  assert.equal(act.gapsCount, 1);
  assert.equal(act.segments.length, 2);
  assert.equal(act.segments[0].rowCount, 400);
  assert.equal(act.segments[1].rowCount, 357);
  assert.equal(act.maxGapSeconds > 200000, true); // ~3 days in seconds

  // Reconstructed timestamps inside Segment 1 must be strictly unique at 1Hz
  const seg1Epochs = act.seriesMap['FC10901']
    .filter((p) => p.segmentId === 1)
    .map((p) => p.epochMs);
  const uniqueSeg1 = new Set(seg1Epochs);
  assert.equal(uniqueSeg1.size, 400);
});

test('B4: POU Configuration Dictionary deduplicates repeated headers, skips rows 2-3 comments, and extracts 18 loops', () => {
  const bundle = buildSamplePlatformBundle(true);
  const pou = bundle.pouDictionary;

  assert.equal(pou.totalLoops, 18);
  assert.equal(pou.rawTotalColumns, 3269);
  assert.equal(pou.dedupedColumns, 189);
  assert.deepEqual(pou.skippedCommentRows, [2, 3]);

  const fc = pou.loops['FC10901'];
  assert.ok(fc);
  assert.equal(fc.loopType, 'flow');
  assert.equal(fc.svl, 0);
  assert.equal(fc.svh, 300);
  assert.equal(fc.mvl, 0);
  assert.equal(fc.mvh, 100);

  const tc = pou.loops['TC11003'];
  assert.ok(tc);
  assert.equal(tc.loopType, 'temperature');
  assert.equal(tc.svl, 0);
  assert.equal(tc.svh, 100);
  assert.equal(tc.pidOpt, '微分先行');
});

test('C5 & C6: Self-comparison yields RMSE = 0, Pearson r = 1, R2 = 1, and identical overshoot (< 1e-6)', () => {
  const bundle = buildSamplePlatformBundle(true);
  const pair = bundle.defaultPairs[0];
  const actPts = bundle.actualDataset.seriesMap[pair.actualTag];
  const simPts = bundle.simDataset.seriesMap[pair.simKey];

  const selfRes = runPairComparison(
    pair,
    actPts,
    simPts,
    {
      mode: 'self_compare',
      gridSec: 1,
      resampleMethod: 'linear',
      relativeTime: true,
      reconstructClock1Hz: true,
      excludeGaps: true,
      minSegmentSec: 30,
      autoLagEstimate: true,
      manualLagSec: 0,
    },
    {
      flowPressureRmsePct: 2.0,
      tempLevelRmsePct: 5.0,
      compositionRmsePct: 3.0,
      overshootWarningPct: 15.0,
    },
    bundle.pouDictionary.loops[pair.actualTag]
  );

  assert.ok(Math.abs(selfRes.metrics.rmseAbs) < 1e-6);
  assert.ok(Math.abs(selfRes.metrics.rmsePct) < 1e-6);
  assert.ok(Math.abs(selfRes.metrics.maeAbs) < 1e-6);
  assert.ok(Math.abs(selfRes.metrics.maxAbsError) < 1e-6);
  assert.ok(Math.abs(selfRes.metrics.pearsonR - 1.0) < 1e-6);
  assert.ok(Math.abs(selfRes.metrics.rSquared - 1.0) < 1e-6);
  assert.ok(
    Math.abs(selfRes.metrics.simClosedLoop.overshootPct - selfRes.metrics.actClosedLoop.overshootPct) < 1e-6
  );
  assert.equal(selfRes.metrics.grade, 'PASS');
});

test('C4 & C6: Closed-loop step response metrics and cross-correlation lag estimation work accurately', () => {
  const tSec = Array.from({ length: 100 }, (_, i) => i);
  const sv = tSec.map((t) => (t < 10 ? 50 : 100));
  // Known step response with 10% overshoot (peaks at 105 at t=25, settles to 100)
  const pv = tSec.map((t) => {
    if (t < 10) return 50;
    if (t === 25) return 105;
    if (t < 25) return 50 + ((t - 10) / 15) * 55;
    if (t < 40) return 105 - ((t - 25) / 15) * 5;
    return 100;
  });

  const cl = computeClosedLoopStepMetrics(tSec, sv, pv, 100);
  assert.ok(Math.abs(cl.overshootPct - 10.0) < 1e-4);
  assert.equal(cl.peakTimeSec, 15);
  assert.ok(cl.steadyStateErrorAbs < 1e-6);

  // Shifted signal lag detection
  const shiftedPv = tSec.map((_, i) => pv[Math.max(0, i - 4)]);
  const lagRes = estimateCrossCorrelationLag(shiftedPv, pv, 15);
  assert.equal(lagRes.bestLagSteps, 4);
  assert.ok(lagRes.maxCorrelation > 0.95);

  // Morphology regex test
  const morph = detectTableMorphology(['序号', '时间', 'FC10901.PV', 'FC10901.MV', 'FC10901.SV']);
  assert.equal(morph.tableFormat, 'wide');
  assert.equal(inferLoopTypeFromTag('FC10901'), 'flow');
  assert.equal(inferLoopTypeFromTag('TC11003'), 'temperature');

  // UTF-8 BOM detection test
  const bomBytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x74, 0x69, 0x6d, 0x65]);
  const enc = detectEncodingAndDecode(bomBytes);
  assert.equal(enc.encoding, 'UTF-8 with BOM');
});

test('B5 & C5: Field Role Mapping canonical normalized stream and FOPDT/SOPDT process model identification', () => {
  const bundle = buildSamplePlatformBundle(true);
  const actCanonical = buildCanonicalNormalizedPreview(bundle.actualDataset, bundle.pouDictionary, 3);
  const simCanonical = buildCanonicalNormalizedPreview(bundle.simDataset, bundle.pouDictionary, 2);

  assert.equal(actCanonical.length, 6);
  assert.equal(actCanonical[0].sourceFormat, '宽表拆解 (Wide→Canonical)');
  assert.equal(actCanonical[0].tag, 'FC10901');
  assert.equal(actCanonical[0].unit, 'm³/h');
  assert.ok(actCanonical[0].pvNormPct >= 45 && actCanonical[0].pvNormPct <= 75);

  assert.equal(simCanonical.length, 8);
  assert.equal(simCanonical[0].sourceFormat, '长表透视 (Long→Canonical)');

  const fcSeries = bundle.simDataset.seriesMap['SIM_FIC_CLOSED'];
  const mod = identifyProcessModelSummary(
    fcSeries.map((p) => p.relSec),
    fcSeries.map((p) => p.sv),
    fcSeries.map((p) => p.pv),
    fcSeries.map((p) => p.mv),
    12.6,
    300
  );
  assert.ok(mod.apparentGainKp > 0.5);
  assert.ok(mod.timeConstantTauSec > 5);
  assert.ok(mod.dampingRatioZeta > 0.4 && mod.dampingRatioZeta < 0.7);

  // Test Cross-Correlation Spectrum Curve, Valve Hysteresis, and 3 Slice Rules Detector
  const slices = detectAutoSliceWindows(bundle.actualDataset, bundle.pouDictionary);
  assert.equal(slices.length, 4);
  assert.ok(slices[0].ruleName.includes('闭环设定值阶跃切片'));

  const xCorr = computeCrossCorrelationCurve(
    fcSeries.map((p) => p.pv),
    fcSeries.map((p) => p.pv),
    10
  );
  assert.equal(xCorr.length, 21);
  const zeroLag = xCorr.find((pt) => pt.lagSec === 0);
  assert.ok(zeroLag && Math.abs(zeroLag.correlation - 1.0) < 1e-6);

  const hyst = computeValveHysteresisMetrics(
    fcSeries.map((p) => p.mv),
    fcSeries.map((p) => p.pv),
    fcSeries.map((p) => p.mv),
    fcSeries.map((p) => p.pv),
    300
  );
  assert.ok(hyst.reversalCountAct >= 0);
  assert.ok(typeof hyst.stictionDiagnosis === 'string');
});

test('V1.1/V2 Capabilities: PSD Frequency Spectrum, Master-Slave Cascade Coupling, and 1M-Row DuckDB Columnar Slice', () => {
  const bundle = buildSamplePlatformBundle(true);
  const alignOpts = {
    mode: 'scenario_window' as const,
    gridSec: 1,
    resampleMethod: 'linear' as const,
    relativeTime: true,
    reconstructClock1Hz: true,
    excludeGaps: true,
    minSegmentSec: 30,
    autoLagEstimate: true,
    manualLagSec: 0,
  };
  const tols = {
    flowPressureRmsePct: 2.0,
    tempLevelRmsePct: 5.0,
    compositionRmsePct: 3.0,
    overshootWarningPct: 15.0,
  };

  const pairResults = bundle.defaultPairs.map((pair) => {
    const actPts = bundle.actualDataset.seriesMap[pair.actualTag];
    const simPts = bundle.simDataset.seriesMap[pair.simKey];
    const res = runPairComparison(
      pair,
      actPts,
      simPts,
      alignOpts,
      tols,
      bundle.pouDictionary.loops[pair.actualTag]
    );
    return { pair, ...res };
  });

  // 1. Test PSD / FFT Frequency-Domain & Robustness Analysis
  const psd = computeSpectralPsdAnalysis(pairResults[0].alignedSeries, 1, 12.6);
  assert.equal(psd.bins.length, 36);
  assert.ok(psd.dominantFreqHz > 0);
  assert.ok(psd.dominantPeriodSec > 0);
  assert.ok(Math.abs(psd.lowFreqEnergyPct + psd.midFreqEnergyPct + psd.highFreqEnergyPct - 100) < 0.2);
  assert.ok(psd.gainMarginDb > 0 && psd.phaseMarginDeg > 20);

  // 2. Test Master-Slave Cascade Loop (TC11003 -> FC10901) Coupled Analysis
  const cascade = computeCascadeCoupledAnalysis(pairResults);
  assert.equal(cascade.masterTag, 'TC11003');
  assert.equal(cascade.slaveTag, 'FC10901');
  assert.ok(cascade.tauRatio > 1.0);
  assert.ok(Math.abs(cascade.slaveLagContributionPct + cascade.masterModelContributionPct - 100) < 0.2);
  assert.ok(cascade.syncedSeries.length > 100);

  // 3. Test 1,000,000-Row Columnar Pre-Aggregation & LTTB Streaming Slice
  const duck = executeColumnarSqlAggregation({
    totalRows: 1_000_000,
    bucketSec: 10,
    targetLttbPoints: 240,
    tagFilter: 'FC10901',
  });
  assert.equal(duck.scannedRows, 1_000_000);
  assert.equal(duck.lttbPointsCount, 240);
  assert.ok(duck.returnedBuckets >= 120);
  assert.ok(duck.throughputRowsPerSec > 10_000);

  // 4. Test PairItem Master-Slave Association & Vertically Stacked Synchronized Resolution
  const resolvedFromSlave = resolveMasterSlavePairBundles(pairResults, 'pair_fc_closed');
  assert.ok(resolvedFromSlave);
  assert.equal(resolvedFromSlave.isDirectLinked, true);
  assert.equal(resolvedFromSlave.masterBundle.pair.id, 'pair_tc_closed');
  assert.equal(resolvedFromSlave.masterBundle.pair.cascadeRole, 'master');
  assert.equal(resolvedFromSlave.slaveBundle.pair.id, 'pair_fc_closed');
  assert.equal(resolvedFromSlave.slaveBundle.pair.cascadeRole, 'slave');
  assert.equal(resolvedFromSlave.stackedSeries.length, 400);
});




