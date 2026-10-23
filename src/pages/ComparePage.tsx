import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Download,
  FileCheck2,
  GitCompare,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  ScatterAndResidualCharts,
  SegmentBarAndSmallMultiples,
  TripleTrendAndErrorChart,
} from '../components/InteractiveCharts';
import {
  detectAutoSliceWindows,
  getLoopTypeLabel,
  getScenarioTypeLabel,
  identifyProcessModelSummary,
  inferLoopTypeFromTag,
} from '../core/engine';
import {
  AlignmentOptions,
  ComparisonRunResult,
  DatasetParsed,
  PairItem,
  POUDictionary,
  ScenarioType,
  ToleranceConfig,
} from '../core/types';

interface ComparePageProps {
  runResult: ComparisonRunResult;
  actualDataset: DatasetParsed;
  simDataset: DatasetParsed;
  pouDictionary: POUDictionary | null;
  pairs: PairItem[];
  onAddPair: (pair: PairItem) => void;
  onRemovePair: (id: string) => void;
  activePairId: string;
  onSelectPairId: (id: string) => void;
  alignmentOptions: AlignmentOptions;
  onUpdateAlignmentOptions: (next: AlignmentOptions) => void;
  onToggleReconstruct1Hz: (enabled: boolean) => void;
  tolerances: ToleranceConfig;
  onUpdateTolerances: (next: ToleranceConfig) => void;
  onBackToMapping: () => void;
  onGenerateReport: () => void;
}

export const ComparePage: React.FC<ComparePageProps> = ({
  runResult,
  actualDataset,
  simDataset,
  pouDictionary,
  pairs,
  onAddPair,
  onRemovePair,
  activePairId,
  onSelectPairId,
  alignmentOptions,
  onUpdateAlignmentOptions,
  onToggleReconstruct1Hz,
  tolerances,
  onUpdateTolerances,
  onBackToMapping,
  onGenerateReport,
}) => {
  const [lttbEnabled, setLttbEnabled] = useState(true);
  const [showPairingBuilder, setShowPairingBuilder] = useState(false);
  const [newActTag, setNewActTag] = useState<string>(actualDataset.detectedTags[0] || 'FC10901');
  const [newActSegId, setNewActSegId] = useState<number>(1);
  const [newSimKey, setNewSimKey] = useState<string>(simDataset.detectedTags[0] || 'SIM_FIC_CLOSED');

  const currentPairBundle =
    runResult.pairResults.find((p) => p.pair.id === activePairId) || runResult.pairResults[0];

  const detectedSlices = useMemo(
    () => detectAutoSliceWindows(actualDataset, pouDictionary),
    [actualDataset, pouDictionary]
  );

  if (!currentPairBundle) {
    return <div className="p-8 text-center text-slate-500">暂无配对回路数据</div>;
  }

  const { pair, metrics, alignedSeries, residualDist, topDeviations } = currentPairBundle;

  const handleExportAlignedCsv = () => {
    const header = [
      'rel_sec',
      'timestamp',
      'sim_SV',
      'act_SV',
      'sim_PV',
      'act_PV',
      'error_PV',
      'error_PV_pct_span',
      'sim_MV',
      'act_MV',
      'error_MV',
      'sim_MODE',
      'act_MODE',
    ].join(',');
    const rows = alignedSeries.map((pt) =>
      [
        pt.t,
        pt.timestampLabel,
        pt.simSv.toFixed(4),
        pt.actSv.toFixed(4),
        pt.simPv.toFixed(4),
        pt.actPv.toFixed(4),
        pt.errorPv.toFixed(4),
        pt.errorPvPct.toFixed(4),
        pt.simMv.toFixed(4),
        pt.actMv.toFixed(4),
        pt.errorMv.toFixed(4),
        pt.simMode,
        pt.actMode,
      ].join(',')
    );
    const csvContent = '\uFEFF' + [header, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aligned_${pair.actualTag}_vs_${pair.simTag}_${alignmentOptions.resampleMethod}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateCustomPair = () => {
    const pouMatch = pouDictionary?.loops[newActTag];
    const loopType = pouMatch ? pouMatch.loopType : inferLoopTypeFromTag(newActTag);
    const scenario: ScenarioType = newSimKey.includes('OPEN')
      ? 'open_step'
      : newSimKey.includes('NATURAL')
      ? 'natural_disturbance'
      : 'closed_step';
    const segPoints = (actualDataset.seriesMap[newActTag] || []).filter(
      (p) => p.segmentId === newActSegId
    );
    const durationSec = Math.min(350, Math.max(60, segPoints.length - 10));
    const created: PairItem = {
      id: `pair_custom_${Date.now().toString(36)}`,
      name: `${newActTag} (段#${newActSegId}) ↔ ${newSimKey}`,
      loopType,
      scenario,
      actualTag: newActTag,
      actualSegmentId: newActSegId,
      actualWindowStartSec: 0,
      actualWindowEndSec: durationSec,
      simKey: newSimKey,
      simTag: newSimKey,
      simWindowStartSec: 0,
      simWindowEndSec: durationSec,
      pvSpan: pouMatch ? [pouMatch.svl, pouMatch.svh] : loopType === 'flow' ? [0, 300] : [0, 100],
      mvSpan: pouMatch ? [pouMatch.mvl, pouMatch.mvh] : [0, 100],
      unit: pouMatch ? pouMatch.unit : loopType === 'temperature' ? '°C' : 'm³/h',
    };
    onAddPair(created);
    onSelectPairId(created.id);
  };

  const renderGradeBadge = (grade: 'PASS' | 'WARNING' | 'FAIL') => {
    if (grade === 'PASS') {
      return <span className="text-emerald-700 font-mono font-bold">● 通过 (PASS)</span>;
    }
    if (grade === 'WARNING') {
      return <span className="text-amber-700 font-mono font-bold">▲ 警告 (WARNING)</span>;
    }
    return <span className="text-rose-700 font-mono font-bold">✖ 不合格 (FAIL)</span>;
  };

  return (
    <div className="space-y-5">
      {/* Top Workbench Header & Alignment Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 text-balance">
              03. 回路配对、时间轴对齐与多维可视化对比工作台
            </h1>
            <p className="text-sm text-slate-600 mt-0.5">
              当前检视：<strong className="font-mono text-slate-900">{pair.name}</strong> ·{' '}
              {getLoopTypeLabel(pair.loopType)} · 量程 [{pair.pvSpan[0]}, {pair.pvSpan[1]}] {pair.unit} · 有效参与计算{' '}
              <span className="font-mono font-semibold">{metrics.effectiveDurationSec}s ({metrics.effectivePoints}点)</span>
              {alignmentOptions.excludeGaps ? ' (已剔除 ~3天 跨天断档)' : ' (未隔离断档)'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPairingBuilder(!showPairingBuilder)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                showPairingBuilder
                  ? 'bg-blue-50 text-blue-700 border-blue-300'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <GitCompare className="w-3.5 h-3.5" />
              配对矩阵与三类切片规则 ({pairs.length}组)
            </button>
            <button
              type="button"
              onClick={handleExportAlignedCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              导出对齐明细 CSV
            </button>
            <button
              type="button"
              onClick={onBackToMapping}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              返回信号与量程配置
            </button>
            <button
              type="button"
              onClick={onGenerateReport}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <FileCheck2 className="w-3.5 h-3.5" />
              生成分析报告 (HTML / PDF / Word)
            </button>
          </div>
        </div>

        {/* Collapsible Pairing Builder & 3 Slice Rules Detector */}
        {showPairingBuilder && (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-4 text-xs">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Left 7 cols: Auto-detected 3 Slice Rules from Actual History */}
              <div className="lg:col-span-7 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                    实测历史「三类整定切片规则」自动扫描结果 (开环阶跃 / 闭环阶跃 / 自然扰动)
                  </span>
                  <span className="font-mono text-slate-500">共识别 {detectedSlices.length} 个特征片段</span>
                </div>
                <div className="overflow-x-auto bg-white border border-slate-200 rounded">
                  <table className="w-full text-left border-collapse font-mono tabular-nums text-[11px]">
                    <thead>
                      <tr className="bg-slate-100 text-slate-600 border-b border-slate-200">
                        <th className="py-1.5 px-2 font-sans">实测位号 / 连续段</th>
                        <th className="py-1.5 px-2 font-sans">判定切片规则</th>
                        <th className="py-1.5 px-2">起止时间窗</th>
                        <th className="py-1.5 px-2 font-sans">触发依据 (ΔSV / ΔMV / σ_PV)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detectedSlices.map((sl) => (
                        <tr key={sl.windowId} className="hover:bg-slate-50">
                          <td className="py-1.5 px-2 font-semibold text-slate-900">
                            {sl.tag} · 段#{sl.segmentId}
                          </td>
                          <td className="py-1.5 px-2 font-sans text-blue-700 font-semibold">
                            {sl.ruleName}
                          </td>
                          <td className="py-1.5 px-2 text-slate-600">
                            {sl.durationSec}s (推荐↔{sl.recommendedSimTag})
                          </td>
                          <td className="py-1.5 px-2 font-sans text-slate-600">{sl.ruleConditionFormula}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Right 5 cols: Custom Pair Creator & Active Pairs List */}
              <div className="lg:col-span-5 space-y-2.5">
                <span className="font-bold text-slate-900 block">
                  新增自定义「实测连续段 ↔ 仿真场景」配对组
                </span>
                <div className="grid grid-cols-3 gap-2 bg-white p-2.5 border border-slate-200 rounded">
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">实测位号</label>
                    <select
                      value={newActTag}
                      onChange={(e) => setNewActTag(e.target.value)}
                      className="w-full px-1.5 py-1 bg-slate-50 border border-slate-300 rounded font-mono text-xs"
                    >
                      {actualDataset.detectedTags.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">实测连续段</label>
                    <select
                      value={newActSegId}
                      onChange={(e) => setNewActSegId(Number(e.target.value))}
                      className="w-full px-1.5 py-1 bg-slate-50 border border-slate-300 rounded font-mono text-xs"
                    >
                      {actualDataset.segments.map((seg) => (
                        <option key={seg.segmentId} value={seg.segmentId}>
                          段#{seg.segmentId} ({seg.rowCount}点)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">仿真场景标签</label>
                    <select
                      value={newSimKey}
                      onChange={(e) => setNewSimKey(e.target.value)}
                      className="w-full px-1.5 py-1 bg-slate-50 border border-slate-300 rounded font-mono text-xs"
                    >
                      {simDataset.detectedTags.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3 flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={handleCreateCustomPair}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      添加配对并立即对齐计算
                    </button>
                  </div>
                </div>

                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {pairs.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between px-2.5 py-1 bg-white border border-slate-200 rounded font-mono text-[11px]"
                    >
                      <span className="truncate">
                        {p.name} · <span className="font-sans text-slate-500">{getScenarioTypeLabel(p.scenario)}</span>
                      </span>
                      {pairs.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onRemovePair(p.id)}
                          className="text-slate-400 hover:text-rose-600 ml-2"
                          title="删除该配对"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Pairing Mode & Alignment Controls Grid */}
        <div className="pt-3 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
          {/* Control 1: Active Pair Selector */}
          <div className="lg:col-span-2">
            <label className="block font-medium text-slate-700 mb-1">选择配对回路与场景窗口</label>
            <select
              value={activePairId}
              onChange={(e) => onSelectPairId(e.target.value)}
              aria-label="选择配对回路与场景窗口"
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded font-mono text-slate-900"
            >
              {runResult.pairResults.map((pr) => (
                <option key={pr.pair.id} value={pr.pair.id}>
                  {pr.pair.name} (RMSE: {pr.metrics.rmsePct.toFixed(2)}%)
                </option>
              ))}
            </select>
          </div>

          {/* Control 2: Pairing & Alignment Mode */}
          <div>
            <label className="block font-medium text-slate-700 mb-1">配对与时间对齐模式</label>
            <select
              value={alignmentOptions.mode}
              onChange={(e) =>
                onUpdateAlignmentOptions({
                  ...alignmentOptions,
                  mode: e.target.value as AlignmentOptions['mode'],
                  relativeTime: e.target.value !== 'same_source_time',
                })
              }
              aria-label="配对与时间对齐模式"
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded text-slate-900 font-medium"
            >
              <option value="scenario_window">场景↔片段配对 (相对时间 t=0)</option>
              <option value="same_source_time">同源时序对齐 (绝对时间+互相关)</option>
              <option value="self_compare">同一文件自比校验 (验证 RMSE=0)</option>
            </select>
          </div>

          {/* Control 3: Resample Method & Grid */}
          <div>
            <label className="block font-medium text-slate-700 mb-1">公共栅格与重采样方式</label>
            <div className="flex items-center gap-1.5">
              <select
                value={alignmentOptions.resampleMethod}
                onChange={(e) =>
                  onUpdateAlignmentOptions({
                    ...alignmentOptions,
                    resampleMethod: e.target.value as AlignmentOptions['resampleMethod'],
                  })
                }
                aria-label="重采样插值方式"
                className="flex-1 px-2 py-1.5 bg-slate-50 border border-slate-300 rounded text-slate-900"
              >
                <option value="linear">线性插值 (默认)</option>
                <option value="zoh">前值保持 (ZOH阶跃)</option>
                <option value="nearest">最近邻 (Nearest)</option>
              </select>
              <select
                value={alignmentOptions.gridSec}
                onChange={(e) =>
                  onUpdateAlignmentOptions({
                    ...alignmentOptions,
                    gridSec: Number(e.target.value),
                  })
                }
                aria-label="公共采样栅格秒数"
                className="w-16 px-1.5 py-1.5 bg-slate-50 border border-slate-300 rounded font-mono text-slate-900"
              >
                <option value={1}>1s</option>
                <option value={2}>2s</option>
                <option value={5}>5s</option>
              </select>
            </div>
          </div>

          {/* Control 4: Time Lag Fine-Tuning */}
          <div>
            <label className="block font-medium text-slate-700 mb-1">
              时延偏移微调 (互相关估 {metrics.estimatedLagSec}s)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={-15}
                max={15}
                step={1}
                value={alignmentOptions.manualLagSec}
                onChange={(e) =>
                  onUpdateAlignmentOptions({
                    ...alignmentOptions,
                    manualLagSec: Number(e.target.value),
                  })
                }
                aria-label="时延偏移手动微调秒数"
                className="flex-1 accent-blue-600"
              />
              <span className="font-mono tabular-nums w-12 text-right font-semibold text-slate-800">
                {alignmentOptions.manualLagSec >= 0 ? `+${alignmentOptions.manualLagSec}` : alignmentOptions.manualLagSec}s
              </span>
            </div>
          </div>

          {/* Control 5: Loop Type Tolerance & Data Pitfall Switches */}
          <div>
            <label className="block font-medium text-slate-700 mb-1">
              容差阈值 (流量 ≤{tolerances.flowPressureRmsePct}% / 温度 ≤{tolerances.tempLevelRmsePct}%)
            </label>
            <div className="flex items-center gap-1.5 font-mono">
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="20"
                value={
                  pair.loopType === 'flow' || pair.loopType === 'pressure'
                    ? tolerances.flowPressureRmsePct
                    : tolerances.tempLevelRmsePct
                }
                onChange={(e) => {
                  const val = Math.max(0.5, Number(e.target.value) || 2.0);
                  if (pair.loopType === 'flow' || pair.loopType === 'pressure') {
                    onUpdateTolerances({ ...tolerances, flowPressureRmsePct: val });
                  } else {
                    onUpdateTolerances({ ...tolerances, tempLevelRmsePct: val });
                  }
                }}
                aria-label="当前回路类型RMSE容差百分比"
                className="w-20 px-2 py-1.5 bg-slate-50 border border-slate-300 rounded text-right text-slate-900"
              />
              <span className="text-slate-500">% 量程</span>
            </div>
          </div>
        </div>

        {/* Data Governance Pitfall Protection Bar */}
        <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={alignmentOptions.reconstructClock1Hz}
                onChange={(e) => onToggleReconstruct1Hz(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                启用「序号」列 1Hz 采样时钟重建{' '}
                <span className="text-slate-400">(解决 _sec.csv 每分钟4行重复时间戳压点问题)</span>
              </span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={alignmentOptions.excludeGaps}
                onChange={(e) =>
                  onUpdateAlignmentOptions({
                    ...alignmentOptions,
                    excludeGaps: e.target.checked,
                  })
                }
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                跨断档自动切段隔离计算{' '}
                <span className="text-slate-400">(剔除中间 ~3.0 天历史缺口，防止跨段虚假插值)</span>
              </span>
            </label>
          </div>
          <span className="font-mono text-[11px] text-slate-500">
            对齐网格 Δt = {alignmentOptions.gridSec}s · 插值 = {alignmentOptions.resampleMethod.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Main Split Console: Left/Center Charts (8 cols) + Right Quantitative Metrics Inspector (4 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left 8 Columns: 8 Interactive Visualization Charts */}
        <div className="xl:col-span-8 space-y-5">
          {/* Chart 1 & 2: Triple Trend (SV/PV/MV) + Deviation Band */}
          <TripleTrendAndErrorChart
            series={alignedSeries}
            metrics={metrics}
            lttbEnabled={lttbEnabled}
            onToggleLttb={() => setLttbEnabled(!lttbEnabled)}
          />

          {/* Chart 3, 4, 5, 6: PV Scatter (y=x) + Residual Histogram + MV-PV Valve Hysteresis + Cross-Correlation Lag Spectrum */}
          <ScatterAndResidualCharts
            series={alignedSeries}
            metrics={metrics}
            residualDist={residualDist}
            onApplyLagSec={(lagSec) =>
              onUpdateAlignmentOptions({
                ...alignmentOptions,
                manualLagSec: lagSec,
              })
            }
          />

          {/* Chart 5 & 6: Segment Metrics Bar Chart + Multi-Loop Small Multiples */}
          <SegmentBarAndSmallMultiples
            allPairResults={runResult.pairResults}
            activePairId={activePairId}
            onSelectPair={onSelectPairId}
          />
        </div>

        {/* Right 4 Columns: Quantitative Metrics & POU PID Diff Card */}
        <div className="xl:col-span-4 space-y-4">
          {/* Card A: Overall Evaluation & Error Metrics */}
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200">
              <div>
                <span className="text-xs text-slate-500 block">当前窗口综合评估</span>
                <h2 className="text-sm font-bold text-slate-900">{pair.actualTag} ↔ {pair.simTag}</h2>
              </div>
              <div className="text-sm">{renderGradeBadge(metrics.grade)}</div>
            </div>

            {/* Key KPI Strip */}
            <div className="grid grid-cols-2 gap-2.5 mb-3 font-mono tabular-nums">
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                <span className="text-[10px] text-slate-400 block">归一化 RMSE (% 量程)</span>
                <span className="text-xl font-bold text-slate-900">{metrics.rmsePct.toFixed(3)}%</span>
                <span className="text-[11px] text-slate-500 block mt-0.5">
                  绝对量: {metrics.rmseAbs.toFixed(3)} {metrics.unit} (容差 ≤{metrics.toleranceRmsePct}%)
                </span>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                <span className="text-[10px] text-slate-400 block">归一化 MAE (% 量程)</span>
                <span className="text-xl font-bold text-slate-900">{metrics.maePct.toFixed(3)}%</span>
                <span className="text-[11px] text-slate-500 block mt-0.5">
                  绝对量: {metrics.maeAbs.toFixed(3)} {metrics.unit}
                </span>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                <span className="text-[10px] text-slate-400 block">最大绝对误差 Max|e|</span>
                <span className="text-base font-bold text-slate-900">
                  {metrics.maxAbsError.toFixed(3)} {metrics.unit}
                </span>
                <span className="text-[11px] text-slate-500 block">({metrics.maxErrorPct.toFixed(2)}% 量程)</span>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                <span className="text-[10px] text-slate-400 block">平均系统偏置 Bias</span>
                <span className="text-base font-bold text-slate-900">
                  {metrics.biasAbs >= 0 ? '+' : ''}
                  {metrics.biasAbs.toFixed(3)} {metrics.unit}
                </span>
                <span className="text-[11px] text-slate-500 block">
                  ({metrics.biasPct >= 0 ? '+' : ''}
                  {metrics.biasPct.toFixed(2)}% 量程)
                </span>
              </div>
            </div>

            {/* Fit & Correlation Metrics */}
            <div className="pt-2 border-t border-slate-100 text-xs space-y-1.5 font-mono tabular-nums">
              <div className="flex justify-between">
                <span className="font-sans text-slate-600">Pearson 相关系数 r</span>
                <span className="font-semibold text-slate-900">{metrics.pearsonR.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-slate-600">拟合决定系数 R²</span>
                <span className="font-semibold text-slate-900">{metrics.rSquared.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-slate-600">最大互相关滞后估计</span>
                <span className="font-semibold text-blue-700">
                  {metrics.estimatedLagSec} s (r_max = {metrics.maxCrossCorr.toFixed(3)})
                </span>
              </div>
            </div>
          </div>

          {/* Card B: Closed-Loop Step Response Metrics Table (Sim vs Actual) */}
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <h3 className="text-xs font-bold text-slate-900 pb-2 mb-2 border-b border-slate-200">
              闭环动态性能指标对比 (仿真 vs 实测)
            </h3>
            <table className="w-full text-xs border-collapse font-mono tabular-nums">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200 text-left">
                  <th className="py-1.5 font-sans">闭环指标</th>
                  <th className="py-1.5 text-right">仿真模型</th>
                  <th className="py-1.5 text-right">实测历史</th>
                  <th className="py-1.5 text-right">差值 Δ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-1.5 font-sans text-slate-700">超调量 Overshoot</td>
                  <td className="py-1.5 text-right text-blue-700">{metrics.simClosedLoop.overshootPct.toFixed(2)}%</td>
                  <td className="py-1.5 text-right text-amber-700">{metrics.actClosedLoop.overshootPct.toFixed(2)}%</td>
                  <td className="py-1.5 text-right">
                    {(metrics.actClosedLoop.overshootPct - metrics.simClosedLoop.overshootPct).toFixed(2)}%
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 font-sans text-slate-700">上升时间 (10–90%)</td>
                  <td className="py-1.5 text-right">{metrics.simClosedLoop.riseTime10to90Sec.toFixed(1)}s</td>
                  <td className="py-1.5 text-right">{metrics.actClosedLoop.riseTime10to90Sec.toFixed(1)}s</td>
                  <td className="py-1.5 text-right">
                    {(metrics.actClosedLoop.riseTime10to90Sec - metrics.simClosedLoop.riseTime10to90Sec).toFixed(1)}s
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 font-sans text-slate-700">峰值时间 Peak Time</td>
                  <td className="py-1.5 text-right">{metrics.simClosedLoop.peakTimeSec.toFixed(1)}s</td>
                  <td className="py-1.5 text-right">{metrics.actClosedLoop.peakTimeSec.toFixed(1)}s</td>
                  <td className="py-1.5 text-right">
                    {(metrics.actClosedLoop.peakTimeSec - metrics.simClosedLoop.peakTimeSec).toFixed(1)}s
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 font-sans text-slate-700">调节时间 (±2% 误差带)</td>
                  <td className="py-1.5 text-right">{metrics.simClosedLoop.settlingTime2PctSec.toFixed(1)}s</td>
                  <td className="py-1.5 text-right">{metrics.actClosedLoop.settlingTime2PctSec.toFixed(1)}s</td>
                  <td className="py-1.5 text-right">
                    {(metrics.actClosedLoop.settlingTime2PctSec - metrics.simClosedLoop.settlingTime2PctSec).toFixed(1)}s
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 font-sans text-slate-700">调节时间 (±5% 误差带)</td>
                  <td className="py-1.5 text-right">{metrics.simClosedLoop.settlingTime5PctSec.toFixed(1)}s</td>
                  <td className="py-1.5 text-right">{metrics.actClosedLoop.settlingTime5PctSec.toFixed(1)}s</td>
                  <td className="py-1.5 text-right">
                    {(metrics.actClosedLoop.settlingTime5PctSec - metrics.simClosedLoop.settlingTime5PctSec).toFixed(1)}s
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 font-sans text-slate-700">稳态误差 (% 量程)</td>
                  <td className="py-1.5 text-right">{metrics.simClosedLoop.steadyStateErrorPct.toFixed(2)}%</td>
                  <td className="py-1.5 text-right">{metrics.actClosedLoop.steadyStateErrorPct.toFixed(2)}%</td>
                  <td className="py-1.5 text-right">
                    {(metrics.actClosedLoop.steadyStateErrorPct - metrics.simClosedLoop.steadyStateErrorPct).toFixed(2)}%
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 font-sans text-slate-700">振荡次数 Oscillations</td>
                  <td className="py-1.5 text-right">{metrics.simClosedLoop.oscillationCount} 次</td>
                  <td className="py-1.5 text-right">{metrics.actClosedLoop.oscillationCount} 次</td>
                  <td className="py-1.5 text-right">
                    {metrics.actClosedLoop.oscillationCount - metrics.simClosedLoop.oscillationCount}
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 font-sans text-slate-700">积分绝对误差 IAE</td>
                  <td className="py-1.5 text-right">{metrics.simClosedLoop.iae.toFixed(1)}</td>
                  <td className="py-1.5 text-right">{metrics.actClosedLoop.iae.toFixed(1)}</td>
                  <td className="py-1.5 text-right">
                    {(metrics.actClosedLoop.iae - metrics.simClosedLoop.iae).toFixed(1)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 font-sans text-slate-700">积分平方误差 ISE</td>
                  <td className="py-1.5 text-right">{metrics.simClosedLoop.ise.toFixed(1)}</td>
                  <td className="py-1.5 text-right">{metrics.actClosedLoop.ise.toFixed(1)}</td>
                  <td className="py-1.5 text-right">
                    {(metrics.actClosedLoop.ise - metrics.simClosedLoop.ise).toFixed(1)}
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 font-sans text-slate-700">时间乘绝对误差 ITAE</td>
                  <td className="py-1.5 text-right">{metrics.simClosedLoop.itae.toFixed(0)}</td>
                  <td className="py-1.5 text-right">{metrics.actClosedLoop.itae.toFixed(0)}</td>
                  <td className="py-1.5 text-right">
                    {(metrics.actClosedLoop.itae - metrics.simClosedLoop.itae).toFixed(0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Card C: Process Transfer Function Identification (FOPDT / SOPDT Model Parameters) */}
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <h3 className="text-xs font-bold text-slate-900 pb-2 mb-2 border-b border-slate-200">
              对象模型辨识核验 (FOPDT / SOPDT 等效参数)
            </h3>
            {(() => {
              const tArr = alignedSeries.map((a) => a.t);
              const spanVal = Math.max(1, pair.pvSpan[1] - pair.pvSpan[0]);
              const simMod = identifyProcessModelSummary(
                tArr,
                alignedSeries.map((a) => a.simSv),
                alignedSeries.map((a) => a.simPv),
                alignedSeries.map((a) => a.simMv),
                metrics.simClosedLoop.overshootPct,
                spanVal
              );
              const actMod = identifyProcessModelSummary(
                tArr,
                alignedSeries.map((a) => a.actSv),
                alignedSeries.map((a) => a.actPv),
                alignedSeries.map((a) => a.actMv),
                metrics.actClosedLoop.overshootPct,
                spanVal
              );
              return (
                <div className="space-y-1.5 text-xs font-mono tabular-nums">
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-600">表观过程增益 Kp (%PV/%MV)</span>
                    <span>
                      {simMod.apparentGainKp.toFixed(2)} vs {actMod.apparentGainKp.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-600">等效时间常数 τ_63 (仿 / 实)</span>
                    <span>
                      {simMod.timeConstantTauSec.toFixed(1)}s vs {actMod.timeConstantTauSec.toFixed(1)}s
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-600">表观纯滞后 θ (仿 / 实)</span>
                    <span>
                      {simMod.deadTimeThetaSec.toFixed(1)}s vs {actMod.deadTimeThetaSec.toFixed(1)}s
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-600">二阶等效阻尼比 ζ (仿 / 实)</span>
                    <span className="text-blue-700 font-semibold">
                      {simMod.dampingRatioZeta.toFixed(3)} vs {actMod.dampingRatioZeta.toFixed(3)}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Card D: Manipulated Variable (MV) & Actuator Behavior */}
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <h3 className="text-xs font-bold text-slate-900 pb-2 mb-2 border-b border-slate-200">
              操作量 MV 执行机构行为评价
            </h3>
            <div className="space-y-1.5 text-xs font-mono tabular-nums">
              <div className="flex justify-between">
                <span className="font-sans text-slate-600">MV 饱和时间占比 (仿 / 实)</span>
                <span>
                  {metrics.simMvMetrics.saturationTimePct.toFixed(1)}% /{' '}
                  {metrics.actMvMetrics.saturationTimePct.toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-slate-600">MV 累计行程 Σ|ΔMV| (仿 / 实)</span>
                <span>
                  {metrics.simMvMetrics.totalTravel.toFixed(1)}% / {metrics.actMvMetrics.totalTravel.toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-slate-600">MV 变化率峰值 (仿 / 实)</span>
                <span>
                  {metrics.simMvMetrics.peakRatePerSec.toFixed(2)}%/s /{' '}
                  {metrics.actMvMetrics.peakRatePerSec.toFixed(2)}%/s
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-slate-600">手/自动模式一致性</span>
                <span className="font-semibold text-emerald-700">{metrics.modeConsistencyPct.toFixed(1)}%</span>
              </div>
            </div>
          </div>

          {/* Card E: POU Config vs Simulation PID Parameters & Attribution */}
          {metrics.pouPid && (
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <h3 className="text-xs font-bold text-slate-900 pb-2 mb-2 border-b border-slate-200">
                组态当前参数 vs 仿真所用参数及偏差归因 ({pair.actualTag})
              </h3>
              <div className="grid grid-cols-3 gap-2 text-center font-mono tabular-nums text-xs mb-2">
                <div className="p-2 bg-slate-50 border border-slate-200 rounded">
                  <span className="block text-[10px] text-slate-400">比例带 PB (%)</span>
                  <span className="font-bold text-slate-900">
                    {metrics.pouPid.pb} vs {metrics.simPid?.pb}
                  </span>
                </div>
                <div className="p-2 bg-slate-50 border border-slate-200 rounded">
                  <span className="block text-[10px] text-slate-400">积分时间 TI (s)</span>
                  <span className="font-bold text-slate-900">
                    {metrics.pouPid.ti} vs {metrics.simPid?.ti}
                  </span>
                </div>
                <div className="p-2 bg-slate-50 border border-slate-200 rounded">
                  <span className="block text-[10px] text-slate-400">微分时间 TD (s)</span>
                  <span className="font-bold text-slate-900">
                    {metrics.pouPid.td} vs {metrics.simPid?.td}
                  </span>
                </div>
              </div>
              <div className="text-[11px] text-slate-600 space-y-1">
                <div>
                  控制结构：<span className="font-semibold text-slate-800">{metrics.pouPid.swpn}</span> ·{' '}
                  <span className="font-semibold text-slate-800">{metrics.pouPid.pidOpt}</span>
                </div>
                <div className="font-mono">
                  报警限值：HH={metrics.pouPid.pvhh} / H={metrics.pouPid.pvh} / L={metrics.pouPid.pvl} / LL=
                  {metrics.pouPid.pvll} {metrics.unit}
                </div>
                {(() => {
                  const actHighCount = alignedSeries.filter((p) => p.actPv >= metrics.pouPid!.pvh).length;
                  const simHighCount = alignedSeries.filter((p) => p.simPv >= metrics.pouPid!.pvh).length;
                  const actLowCount = alignedSeries.filter((p) => p.actPv <= metrics.pouPid!.pvl).length;
                  const simLowCount = alignedSeries.filter((p) => p.simPv <= metrics.pouPid!.pvl).length;
                  return (
                    <div className="font-mono text-[11px] text-slate-600">
                      报警越限对比：越 H/HH 限 (仿 {simHighCount}s / 实 {actHighCount}s) · 越 L/LL 限 (仿 {simLowCount}s / 实{' '}
                      {actLowCount}s)
                    </div>
                  );
                })()}
                {metrics.simPid && (
                  <div className="pt-1.5 mt-1.5 border-t border-slate-100 text-slate-700 leading-relaxed">
                    <span className="font-semibold text-slate-900">PID 参数差异归因：</span>
                    组态 PB ({metrics.pouPid.pb}%) 相较仿真 PB ({metrics.simPid.pb}%) 偏大{' '}
                    <span className="font-mono font-semibold">
                      {(metrics.pouPid.pb - metrics.simPid.pb).toFixed(1)}%
                    </span>
                    （等效比例增益 Kc 偏小{' '}
                    <span className="font-mono font-semibold">
                      {(((100 / metrics.simPid.pb - 100 / metrics.pouPid.pb) / (100 / metrics.simPid.pb)) * 100).toFixed(1)}%
                    </span>
                    ），且 TI 偏长{' '}
                    <span className="font-mono font-semibold">
                      {(metrics.pouPid.ti - metrics.simPid.ti).toFixed(1)}s
                    </span>
                    ，直接解释了实测超调量比仿真低{' '}
                    <span className="font-mono font-semibold">
                      {Math.abs(metrics.simClosedLoop.overshootPct - metrics.actClosedLoop.overshootPct).toFixed(2)}%
                    </span>{' '}
                    而调节时间延长{' '}
                    <span className="font-mono font-semibold">
                      {Math.abs(metrics.actClosedLoop.settlingTime2PctSec - metrics.simClosedLoop.settlingTime2PctSec).toFixed(1)}s
                    </span>
                    。
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Card F: Top-3 Deviation Intervals & Diagnostic Attribution */}
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <h3 className="text-xs font-bold text-slate-900 pb-2 mb-2 border-b border-slate-200">
              Top-3 峰值偏差区间定位与工况诊断
            </h3>
            <div className="space-y-2 text-xs">
              {topDeviations.slice(0, 3).map((dev) => (
                <div key={dev.rank} className="p-2.5 bg-slate-50 border border-slate-200 rounded space-y-1">
                  <div className="flex items-center justify-between font-mono tabular-nums">
                    <span className="font-bold text-slate-900">
                      #{dev.rank} · T+{dev.startSec}s ~ T+{dev.endSec}s
                    </span>
                    <span className="text-rose-700 font-semibold">
                      峰值 {dev.peakErrorPct >= 0 ? '+' : ''}
                      {dev.peakErrorPct.toFixed(2)}% ({dev.peakErrorAbs.toFixed(2)} {metrics.unit})
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600 leading-snug">{dev.diagnosticNote}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
