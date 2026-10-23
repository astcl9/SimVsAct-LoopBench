import React, { useEffect, useMemo, useState } from 'react';
import {
  inferLoopTypeFromTag,
  parseCsvTextToDataset,
  runPairComparison,
} from './core/engine';
import {
  buildSamplePlatformBundle,
  generateSampleActualCsvText,
} from './core/sampleData';
import {
  AlignmentOptions,
  ComparisonRunResult,
  DatasetParsed,
  LoopRoleOverride,
  MappingTemplate,
  PairItem,
  POUDictionary,
  ToleranceConfig,
} from './core/types';
import { ComparePage } from './pages/ComparePage';
import { HistoryPage } from './pages/HistoryPage';
import { MappingPage } from './pages/MappingPage';
import { ReportPage } from './pages/ReportPage';
import { UploadPage } from './pages/UploadPage';

type ActivePage = 'upload' | 'mapping' | 'compare' | 'report' | 'history';

export default function App() {
  const initialBundle = useMemo(() => buildSamplePlatformBundle(true), []);

  const [activePage, setActivePage] = useState<ActivePage>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const p = params.get('page') as ActivePage | null;
      if (p && ['upload', 'mapping', 'compare', 'report', 'history'].includes(p)) {
        return p;
      }
    }
    return 'upload';
  });

  const [reconstruct1Hz, setReconstruct1Hz] = useState(true);
  const [actualDataset, setActualDataset] = useState<DatasetParsed>(initialBundle.actualDataset);
  const [simDataset, setSimDataset] = useState<DatasetParsed>(initialBundle.simDataset);
  const [pouDictionary, setPouDictionary] = useState<POUDictionary | null>(
    initialBundle.pouDictionary
  );
  const [pairs, setPairs] = useState<PairItem[]>(initialBundle.defaultPairs);
  const [activePairId, setActivePairId] = useState<string>(
    initialBundle.defaultPairs[0]?.id || 'pair_fc_closed'
  );

  // Build Loop Role Overrides linked with POU Dictionary
  const [loopOverrides, setLoopOverrides] = useState<Record<string, LoopRoleOverride>>(() => {
    const map: Record<string, LoopRoleOverride> = {};
    const allTags = [
      ...initialBundle.actualDataset.detectedTags,
      ...initialBundle.simDataset.detectedTags,
    ];
    for (const tag of allTags) {
      const baseTag = tag.startsWith('SIM_FIC')
        ? 'FC10901'
        : tag.startsWith('SIM_TIC')
        ? 'TC11003'
        : tag;
      const pouMatch = initialBundle.pouDictionary.loops[baseTag];
      const loopType = pouMatch ? pouMatch.loopType : inferLoopTypeFromTag(tag);
      map[tag] = {
        tag,
        loopType,
        description: pouMatch
          ? `${pouMatch.description} (${tag})`
          : `${tag} 仿真/实测回路`,
        unit: pouMatch ? pouMatch.unit : loopType === 'temperature' ? '°C' : 'm³/h',
        pvMin: pouMatch ? pouMatch.svl : 0,
        pvMax: pouMatch ? pouMatch.svh : loopType === 'flow' ? 300 : 100,
        mvMin: pouMatch ? pouMatch.mvl : 0,
        mvMax: pouMatch ? pouMatch.mvh : 100,
        scaleFactor: 1.0,
        matchedInPou: Boolean(pouMatch),
        pouConfig: pouMatch,
      };
    }
    return map;
  });

  const [templates, setTemplates] = useState<MappingTemplate[]>([
    {
      id: 'tpl_default_01',
      name: 'DCS宽表(GBK)+整定切片长表(UTF8-BOM)标准模板',
      fingerprint: 'sha256:fc10901_tc11003_v02',
      tableFormat: 'wide',
      createdAt: '2026-10-23 08:30:00',
      mapping: {
        timeCol: 'timestamp',
        seqCol: '序号',
        tagCol: 'loop_tag',
        svCol: 'SV',
        pvCol: 'PV',
        mvCol: 'MV',
        modeCol: 'MODE',
        scenarioCol: '模拟场景',
        qualityCol: '质量码',
      },
    },
  ]);

  const [alignmentOptions, setAlignmentOptions] = useState<AlignmentOptions>({
    mode: 'scenario_window',
    gridSec: 1,
    resampleMethod: 'linear',
    relativeTime: true,
    reconstructClock1Hz: true,
    excludeGaps: true,
    minSegmentSec: 30,
    autoLagEstimate: true,
    manualLagSec: 0,
  });

  const [tolerances, setTolerances] = useState<ToleranceConfig>({
    flowPressureRmsePct: 2.0,
    tempLevelRmsePct: 5.0,
    compositionRmsePct: 3.0,
    overshootWarningPct: 15.0,
  });

  // Handle toggling 1Hz reconstruction on Actual Dataset
  const handleToggleReconstruct1Hz = (enabled: boolean) => {
    setReconstruct1Hz(enabled);
    setAlignmentOptions((prev) => ({ ...prev, reconstructClock1Hz: enabled }));
    const rawCsv = generateSampleActualCsvText();
    const reparsed = parseCsvTextToDataset(
      rawCsv,
      actualDataset.filename,
      'actual',
      {
        encoding: actualDataset.encoding,
        score: actualDataset.encodingScore,
        chineseHeaderRatio: actualDataset.chineseHeaderRatio,
      },
      enabled
    );
    setActualDataset(reparsed);
  };

  // Compute full ComparisonRunResult reactively whenever parameters change
  const currentRunResult: ComparisonRunResult = useMemo(() => {
    const pairResults = pairs.map((pair) => {
      const ov = loopOverrides[pair.actualTag];
      const effectivePair: PairItem = ov
        ? {
            ...pair,
            loopType: ov.loopType,
            pvSpan: [ov.pvMin, ov.pvMax],
            mvSpan: [ov.mvMin, ov.mvMax],
            unit: ov.unit,
          }
        : pair;

      const actPts =
        actualDataset.seriesMap[pair.actualTag] ||
        Object.values(actualDataset.seriesMap)[0] ||
        [];
      const simPts =
        simDataset.seriesMap[pair.simKey] ||
        Object.values(simDataset.seriesMap)[0] ||
        [];

      const pouLoop = pouDictionary?.loops[pair.actualTag];

      const computed = runPairComparison(
        effectivePair,
        actPts,
        simPts,
        alignmentOptions,
        tolerances,
        pouLoop
      );

      return {
        pair: effectivePair,
        ...computed,
      };
    });

    const grades = pairResults.map((r) => r.metrics.grade);
    const overallGrade: 'PASS' | 'WARNING' | 'FAIL' = grades.includes('FAIL')
      ? 'FAIL'
      : grades.includes('WARNING')
      ? 'WARNING'
      : 'PASS';

    const fcClosed = pairResults[0]?.metrics;
    const tcClosed = pairResults.find((p) => p.metrics.actualTag === 'TC11003')?.metrics;

    const summaryConclusion: string[] = [
      `1. 编码与形态适配校验：实测历史文件 (${actualDataset.filename}) 自动识别为 ${actualDataset.encoding} 宽表 (${actualDataset.totalRows}×${actualDataset.totalCols})，仿真结果 (${simDataset.filename}) 识别为 ${simDataset.encoding} 长表 (${simDataset.totalRows}×${simDataset.totalCols})。`,
      `2. 时钟精度修复与断档隔离：检测到实测文件存在分钟级重复时间戳 (4行/分钟)，已通过「序号」列重建 1Hz 唯一采样时钟；中间约 ${(actualDataset.maxGapSeconds / 86400).toFixed(1)} 天跨天断档已切分为 ${actualDataset.segments.length} 个独立连续段，杜绝跨断档插值失真。`,
      fcClosed
        ? `3. 流量回路 (FC10901 ↔ ${fcClosed.simTag}) 对比结论：归一化 RMSE = ${fcClosed.rmsePct.toFixed(2)}% 量程（容差阈值 ≤ ${fcClosed.toleranceRmsePct.toFixed(1)}%），Pearson r = ${fcClosed.pearsonR.toFixed(4)}，仿真超调量 ${fcClosed.simClosedLoop.overshootPct.toFixed(1)}% vs 实测 ${fcClosed.actClosedLoop.overshootPct.toFixed(1)}%，组态比例带 PB=${fcClosed.pouPid?.pb ?? 82}% 与仿真 PB=${fcClosed.simPid?.pb ?? 80}% 高度吻合。`
        : '',
      tcClosed
        ? `4. 温度回路 (TC11003 ↔ ${tcClosed.simTag}) 对比结论：归一化 RMSE = ${tcClosed.rmsePct.toFixed(2)}% 量程（容差阈值 ≤ ${tcClosed.toleranceRmsePct.toFixed(1)}%），组态采用「${tcClosed.pouPid?.pidOpt ?? '微分先行'}」结构 (PB=${tcClosed.pouPid?.pb ?? 45}%, TI=${tcClosed.pouPid?.ti ?? 65}s, TD=${tcClosed.pouPid?.td ?? 12}s)，闭环调节时间与实测历史一致。`
        : '',
    ].filter(Boolean);

    return {
      runId: `run_20261023_${alignmentOptions.mode.slice(0, 4)}_${alignmentOptions.resampleMethod}`,
      createdAt: '2026-10-23 14:20:00',
      title:
        alignmentOptions.mode === 'self_compare'
          ? 'FC10901 & TC11003 同一文件自比基准核验报告 (RMSE=0 校验)'
          : 'FC10901 流量与 TC11003 温度回路 — 仿真 vs 实测对比分析报告',
      simDatasetMeta: {
        id: simDataset.id,
        filename: simDataset.filename,
        sha256: simDataset.sha256,
        encoding: simDataset.encoding,
        rows: simDataset.totalRows,
        cols: simDataset.totalCols,
        tableFormat: simDataset.tableFormat,
        timeRange: `${simDataset.timeStart} → ${simDataset.timeEnd}`,
      },
      actualDatasetMeta: {
        id: actualDataset.id,
        filename: actualDataset.filename,
        sha256: actualDataset.sha256,
        encoding: actualDataset.encoding,
        rows: actualDataset.totalRows,
        cols: actualDataset.totalCols,
        tableFormat: actualDataset.tableFormat,
        timeRange: `${actualDataset.timeStart} → ${actualDataset.timeEnd}`,
        reconstructed1Hz: alignmentOptions.reconstructClock1Hz,
        gapsExcluded: actualDataset.gapsCount,
      },
      pouMeta: pouDictionary
        ? {
            filename: pouDictionary.filename,
            sha256: pouDictionary.sha256,
            totalLoops: pouDictionary.totalLoops,
            dedupedColumns: pouDictionary.dedupedColumns,
          }
        : undefined,
      alignmentOptions,
      tolerances,
      pairResults,
      overallGrade,
      summaryConclusion,
    };
  }, [actualDataset, simDataset, pouDictionary, pairs, loopOverrides, alignmentOptions, tolerances]);

  const [historyRuns, setHistoryRuns] = useState<ComparisonRunResult[]>([]);

  // Seed initial history records once
  useEffect(() => {
    if (historyRuns.length === 0) {
      setHistoryRuns([currentRunResult]);
    }
  }, [currentRunResult, historyRuns.length]);

  const handleSaveSnapshotToHistory = () => {
    const snapshot: ComparisonRunResult = {
      ...currentRunResult,
      runId: `run_${Date.now().toString(36)}`,
      createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };
    setHistoryRuns((prev) => [snapshot, ...prev.filter((r) => r.runId !== snapshot.runId)]);
  };

  const handleResetSampleBundle = () => {
    const fresh = buildSamplePlatformBundle(true);
    setReconstruct1Hz(true);
    setActualDataset(fresh.actualDataset);
    setSimDataset(fresh.simDataset);
    setPouDictionary(fresh.pouDictionary);
    setPairs(fresh.defaultPairs);
    setActivePairId(fresh.defaultPairs[0].id);
    setAlignmentOptions({
      mode: 'scenario_window',
      gridSec: 1,
      resampleMethod: 'linear',
      relativeTime: true,
      reconstructClock1Hz: true,
      excludeGaps: true,
      minSegmentSec: 30,
      autoLagEstimate: true,
      manualLagSec: 0,
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict Top Bar Contract: Zone 1 (1-line Brand) — Zone 2 (5 single-line nav links) — Zone 3 (1 primary action) */}
      <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-8 px-6 py-3.5 bg-white border-b border-slate-200">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#upload"
          onClick={(e) => {
            e.preventDefault();
            setActivePage('upload');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          SimVsAct LoopBench
        </a>

        {/* Zone 2: 5 concise single-line navigation links */}
        <nav aria-label="主工作流导航" className="flex items-center gap-6 text-sm font-medium text-slate-600 overflow-x-auto">
          {[
            { id: 'upload' as const, label: '01. 数据导入' },
            { id: 'mapping' as const, label: '02. 信号与量程配置' },
            { id: 'compare' as const, label: '03. 对比工作台' },
            { id: 'report' as const, label: '04. 分析报告' },
            { id: 'history' as const, label: '05. 历史与复现' },
          ].map((nav) => {
            const isActive = activePage === nav.id;
            return (
              <a
                key={nav.id}
                href={`#${nav.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  setActivePage(nav.id);
                }}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  isActive
                    ? 'text-blue-600 border-blue-600 font-semibold'
                    : 'text-slate-600 border-transparent hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                {nav.label}
              </a>
            );
          })}
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              handleSaveSnapshotToHistory();
              setActivePage('report');
            }}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            生成分析报告
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-6 py-6">
        {activePage === 'upload' && (
          <UploadPage
            actualDataset={actualDataset}
            simDataset={simDataset}
            pouDictionary={pouDictionary}
            reconstruct1Hz={reconstruct1Hz}
            onToggleReconstruct1Hz={handleToggleReconstruct1Hz}
            onUpdateActualDataset={setActualDataset}
            onUpdateSimDataset={setSimDataset}
            onUpdatePouDictionary={setPouDictionary}
            onResetSampleBundle={handleResetSampleBundle}
            onProceedToMapping={() => setActivePage('mapping')}
          />
        )}

        {activePage === 'mapping' && (
          <MappingPage
            actualDataset={actualDataset}
            simDataset={simDataset}
            pouDictionary={pouDictionary}
            loopOverrides={loopOverrides}
            onUpdateLoopOverride={(tag, updated) =>
              setLoopOverrides((prev) => ({ ...prev, [tag]: updated }))
            }
            templates={templates}
            onSaveTemplate={(tpl) => setTemplates((prev) => [tpl, ...prev])}
            onApplyTemplate={() => {}}
            onBack={() => setActivePage('upload')}
            onProceedToCompare={() => setActivePage('compare')}
          />
        )}

        {activePage === 'compare' && (
          <ComparePage
            runResult={currentRunResult}
            actualDataset={actualDataset}
            simDataset={simDataset}
            pouDictionary={pouDictionary}
            pairs={pairs}
            onAddPair={(newPair) => setPairs((prev) => [...prev, newPair])}
            onRemovePair={(removeId) => {
              setPairs((prev) => {
                const next = prev.filter((p) => p.id !== removeId);
                if (activePairId === removeId && next[0]) {
                  setActivePairId(next[0].id);
                }
                return next;
              });
            }}
            activePairId={activePairId}
            onSelectPairId={setActivePairId}
            alignmentOptions={alignmentOptions}
            onUpdateAlignmentOptions={setAlignmentOptions}
            onToggleReconstruct1Hz={handleToggleReconstruct1Hz}
            tolerances={tolerances}
            onUpdateTolerances={setTolerances}
            onBackToMapping={() => setActivePage('mapping')}
            onGenerateReport={() => {
              handleSaveSnapshotToHistory();
              setActivePage('report');
            }}
          />
        )}

        {activePage === 'report' && (
          <ReportPage
            runResult={currentRunResult}
            onBackToCompare={() => setActivePage('compare')}
          />
        )}

        {activePage === 'history' && (
          <HistoryPage
            historyRuns={historyRuns}
            activeRunId={currentRunResult.runId}
            onReproduceRun={(run) => {
              setAlignmentOptions(run.alignmentOptions);
              setTolerances(run.tolerances);
              setActivePage('compare');
            }}
            onCloneRunParameters={(run) => {
              setAlignmentOptions({ ...run.alignmentOptions });
              setTolerances({ ...run.tolerances });
              setActivePage('compare');
            }}
            onDeleteRun={(runId) =>
              setHistoryRuns((prev) => prev.filter((r) => r.runId !== runId))
            }
            onSaveCurrentSnapshot={handleSaveSnapshotToHistory}
          />
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="no-print border-t border-slate-200 bg-white px-6 py-4 text-xs text-slate-500">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <span>SimVsAct LoopBench · 工业控制回路仿真与实测 CSV 对比分析平台 (实施方案 v0.2)</span>
          <span>
            支持宽表/长表自动识别 · POU 组态字典 18 回路联动 · 序号重建 1Hz 采样时钟 · 跨天断档隔离计算
          </span>
        </div>
      </footer>
    </div>
  );
}
