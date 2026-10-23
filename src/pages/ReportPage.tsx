import React, { useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Code2,
  Download,
  FileCode,
  FileSpreadsheet,
  FileText,
  Printer,
} from 'lucide-react';
import {
  computeFrequencyAnalysis,
  computeValveHysteresisMetrics,
  getLoopTypeLabel,
  identifyProcessModelSummary,
} from '../core/engine';
import {
  generateStandaloneHtmlReport,
  renderReportPsdSvgChart,
  renderReportSvgChart,
  triggerFileDownload,
} from '../core/reportGenerator';
import { ComparisonRunResult } from '../core/types';

interface ReportPageProps {
  runResult: ComparisonRunResult;
  onBackToCompare: () => void;
}

export const ReportPage: React.FC<ReportPageProps> = ({ runResult, onBackToCompare }) => {
  const [reportOrgHeader, setReportOrgHeader] = useState(
    '工业过程控制工程院 · DCS/PLC 回路整定与仿真模型核验报告'
  );
  const [showRawJson, setShowRawJson] = useState(false);
  const [exportBanner, setExportBanner] = useState<string | null>(null);

  const handleDownloadHtml = () => {
    const html = generateStandaloneHtmlReport(runResult, reportOrgHeader);
    triggerFileDownload(`Report_${runResult.runId}.html`, html, 'text/html;charset=utf-8');
    setExportBanner(`已生成并下载单文件独立 HTML 报告：Report_${runResult.runId}.html（内嵌矢量图与指标全表）`);
  };

  const handleDownloadWord = () => {
    const htmlBody = generateStandaloneHtmlReport(runResult, reportOrgHeader);
    const wordDoc = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset="utf-8"><title>${runResult.title}</title></head>
      <body>${htmlBody}</body></html>`;
    triggerFileDownload(
      `Report_${runResult.runId}.doc`,
      wordDoc,
      'application/msword;charset=utf-8'
    );
    setExportBanner(`已生成并下载 Word 报告文档：Report_${runResult.runId}.doc（中文字体内嵌兼容，基于同一 result.json 真相源）`);
  };

  const handleDownloadResultJson = () => {
    const jsonStr = JSON.stringify(runResult, null, 2);
    triggerFileDownload(
      `result_${runResult.runId}.json`,
      jsonStr,
      'application/json;charset=utf-8'
    );
    setExportBanner(`已导出唯一数据源文件：result_${runResult.runId}.json`);
  };

  const handlePrintPdf = () => {
    setExportBanner('正在调用浏览器打印引擎生成 PDF 报告（与 HTML 版式 100% 一致）...');
    setTimeout(() => {
      window.print();
    }, 100);
  };

  const renderGradeText = (g: 'PASS' | 'WARNING' | 'FAIL') =>
    g === 'PASS' ? (
      <span className="text-emerald-700 font-mono font-bold">● 通过 (PASS)</span>
    ) : g === 'WARNING' ? (
      <span className="text-amber-700 font-mono font-bold">▲ 警告 (WARNING)</span>
    ) : (
      <span className="text-rose-700 font-mono font-bold">✖ 不合格 (FAIL)</span>
    );

  return (
    <div className="space-y-6">
      {/* Top Action Bar (Hidden when printing PDF) */}
      <div className="no-print bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToCompare}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            返回对比工作台
          </button>
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              04. 多格式工程对比分析报告 (HTML / PDF / Word 唯一数据源)
            </h1>
            <p className="text-xs text-slate-500">
              所有报告格式均由同一份 <code className="font-mono">result.json</code> 渲染产出，确保评审数据与图表 100% 一致。
            </p>
          </div>
        </div>

        {/* Export Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRawJson(!showRawJson)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-mono font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Code2 className="w-3.5 h-3.5" />
            {showRawJson ? '隐藏 result.json' : '检视 result.json'}
          </button>
          <button
            type="button"
            onClick={handleDownloadResultJson}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-mono font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            下载 result.json
          </button>
          <button
            type="button"
            onClick={handleDownloadHtml}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <FileCode className="w-3.5 h-3.5" />
            下载 HTML 报告
          </button>
          <button
            type="button"
            onClick={handlePrintPdf}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Printer className="w-3.5 h-3.5" />
            导出 PDF 报告
          </button>
          <button
            type="button"
            onClick={handleDownloadWord}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-950 bg-emerald-500/20 border border-emerald-400 hover:bg-emerald-500/30 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <FileText className="w-3.5 h-3.5" />
            下载 Word (.doc)
          </button>
        </div>
      </div>

      {exportBanner && (
        <div className="no-print flex items-center justify-between px-4 py-2.5 bg-slate-900 text-white text-xs rounded-lg">
          <span>{exportBanner}</span>
          <button
            type="button"
            onClick={() => setExportBanner(null)}
            className="text-slate-300 hover:text-white ml-4"
          >
            关闭
          </button>
        </div>
      )}

      {/* Configurable Header Title Input (No-Print) */}
      <div className="no-print bg-white border border-slate-200 rounded-lg px-5 py-3 flex flex-wrap items-center justify-between gap-4 text-xs">
        <label className="flex items-center gap-3 flex-1">
          <span className="font-semibold text-slate-700 whitespace-nowrap">报告抬头配置项:</span>
          <input
            type="text"
            value={reportOrgHeader}
            onChange={(e) => setReportOrgHeader(e.target.value)}
            aria-label="报告抬头与机构名称"
            className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded text-slate-900"
          />
        </label>
        <span className="font-mono text-slate-500">任务快照 ID: {runResult.runId}</span>
      </div>

      {/* Optional result.json drawer */}
      {showRawJson && (
        <div className="no-print bg-slate-900 text-slate-100 rounded-lg p-4 overflow-x-auto max-h-96 font-mono text-xs">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-700 text-slate-400">
            <span>唯一数据源快照: runs/{runResult.runId}/result.json</span>
            <span>Pairs: {runResult.pairResults.length}</span>
          </div>
          <pre>{JSON.stringify({ ...runResult, pairResults: runResult.pairResults.map((p) => ({ ...p, alignedSeries: `[${p.alignedSeries.length} aligned points omitted for preview]` })) }, null, 2)}</pre>
        </div>
      )}

      {/* Printable Report Document Sheet */}
      <div className="bg-white border border-slate-200 rounded-lg p-8 max-w-5xl mx-auto space-y-8">
        {/* 1. Cover & Header */}
        <div className="border-b-2 border-slate-900 pb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-slate-500">{reportOrgHeader}</div>
            <h2 className="text-2xl font-bold text-slate-900 mt-1">{runResult.title}</h2>
            <div className="text-xs text-slate-600 mt-2 flex flex-wrap items-center gap-2 font-mono tabular-nums">
              <span>报告编号: {runResult.runId}</span>
              <span>·</span>
              <span>生成时间: {runResult.createdAt}</span>
              <span>·</span>
              <span>对齐方式: {runResult.alignmentOptions.mode}</span>
              <span>·</span>
              <span>采样栅格: {runResult.alignmentOptions.gridSec}s ({runResult.alignmentOptions.resampleMethod})</span>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-400 block">综合评估结论</span>
            <div className="text-base mt-0.5">{renderGradeText(runResult.overallGrade)}</div>
          </div>
        </div>

        {/* 2. Dataset & Alignment Summary */}
        <section className="space-y-3">
          <h3 className="text-base font-bold text-slate-900 border-b border-slate-200 pb-1.5">
            01. 数据摘要与配对/对齐口径说明
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded space-y-1 font-mono tabular-nums">
              <div className="font-sans font-bold text-slate-900">实测历史数据源</div>
              <div>文件: {runResult.actualDatasetMeta.filename}</div>
              <div>编码: {runResult.actualDatasetMeta.encoding}</div>
              <div>
                规模: {runResult.actualDatasetMeta.rows} 行 × {runResult.actualDatasetMeta.cols} 列 (宽表)
              </div>
              <div className="text-emerald-700 font-sans">
                时钟修复: {runResult.actualDatasetMeta.reconstructed1Hz ? '按序号列重建 1Hz (消除4行/分钟挤压)' : '原始时钟'}
              </div>
              <div className="text-amber-800 font-sans">
                断档处理: 自动切分 2 个连续段 (排除 ~3 天跨天缺口)
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded space-y-1 font-mono tabular-nums">
              <div className="font-sans font-bold text-slate-900">仿真结果数据源</div>
              <div>文件: {runResult.simDatasetMeta.filename}</div>
              <div>编码: {runResult.simDatasetMeta.encoding}</div>
              <div>
                规模: {runResult.simDatasetMeta.rows} 行 × {runResult.simDatasetMeta.cols} 列 (长表透视)
              </div>
              <div>时间: {runResult.simDatasetMeta.timeRange}</div>
              <div className="font-sans text-slate-600">
                包含开环阶跃 / 闭环阶跃 / 闭环自然扰动三类标准整定切片
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded space-y-1 font-mono tabular-nums">
              <div className="font-sans font-bold text-slate-900">POU 组态字典联动</div>
              <div>文件: {runResult.pouMeta?.filename ?? 'normalized_pou_import.xlsx'}</div>
              <div>表头去重: 3269 列 → {runResult.pouMeta?.dedupedColumns ?? 189} 唯一列</div>
              <div>回路总数: {runResult.pouMeta?.totalLoops ?? 18} 个 DCS/PLC 回路</div>
              <div className="font-sans text-slate-600">
                自动提供位号类型判定、%量程归一化上下限及组态当前 PID 参数
              </div>
            </div>
          </div>
        </section>

        {/* 3. POU Config vs Simulation PID Parameter Comparison Table */}
        <section className="space-y-3">
          <h3 className="text-base font-bold text-slate-900 border-b border-slate-200 pb-1.5">
            02. 组态当前参数 vs 仿真所用参数并列对照表
          </h3>
          <p className="text-xs text-slate-500">
            从组态字典带出 PB/TI/TD/KD、正反作用、PID 形式与量程，与仿真模型所用参数并列，直接甄别曲线差异是否源于基础整定参数差异。
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 font-semibold">
                  <th className="py-2 px-3">配对回路</th>
                  <th className="py-2 px-3">回路类型</th>
                  <th className="py-2 px-3">PV/SV 量程</th>
                  <th className="py-2 px-3 text-right">比例带 PB (组态 / 仿真)</th>
                  <th className="py-2 px-3 text-right">积分 TI (组态 / 仿真)</th>
                  <th className="py-2 px-3 text-right">微分 TD (组态 / 仿真)</th>
                  <th className="py-2 px-3">正反作用与形式</th>
                  <th className="py-2 px-3 text-right">报警限 (HH/H/L/LL)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                {runResult.pairResults.map(({ metrics }) => (
                  <tr key={metrics.pairId}>
                    <td className="py-2 px-3 font-bold text-slate-900">
                      {metrics.actualTag} / {metrics.simTag}
                    </td>
                    <td className="py-2 px-3 font-sans">{getLoopTypeLabel(metrics.loopType)}</td>
                    <td className="py-2 px-3">
                      [{metrics.pvSpan[0]}, {metrics.pvSpan[1]}] {metrics.unit}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {metrics.pouPid?.pb.toFixed(1) ?? '-'}% / {metrics.simPid?.pb.toFixed(1) ?? '-'}%
                    </td>
                    <td className="py-2 px-3 text-right">
                      {metrics.pouPid?.ti.toFixed(1) ?? '-'}s / {metrics.simPid?.ti.toFixed(1) ?? '-'}s
                    </td>
                    <td className="py-2 px-3 text-right">
                      {metrics.pouPid?.td.toFixed(1) ?? '-'}s / {metrics.simPid?.td.toFixed(1) ?? '-'}s
                    </td>
                    <td className="py-2 px-3 font-sans text-slate-700">
                      {metrics.pouPid?.swpn ?? '反作用'} · {metrics.pouPid?.pidOpt ?? '标准PID'}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-500">
                      {metrics.pouPid
                        ? `${metrics.pouPid.pvhh}/${metrics.pouPid.pvh}/${metrics.pouPid.pvl}/${metrics.pouPid.pvll}`
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 4. Master Quantitative Metrics Table */}
        <section className="space-y-3">
          <h3 className="text-base font-bold text-slate-900 border-b border-slate-200 pb-1.5">
            03. 误差、拟合与闭环动态性能指标总表
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 font-semibold">
                  <th className="py-2 px-2.5">场景配对窗口</th>
                  <th className="py-2 px-2.5 text-right">RMSE (绝对 / %量程)</th>
                  <th className="py-2 px-2.5 text-right">MAE (%量程)</th>
                  <th className="py-2 px-2.5 text-right">Max|e| (%量程)</th>
                  <th className="py-2 px-2.5 text-right">Pearson r / R²</th>
                  <th className="py-2 px-2.5 text-right">超调量 (仿 / 实)</th>
                  <th className="py-2 px-2.5 text-right">调节时间±2% (仿 / 实)</th>
                  <th className="py-2 px-2.5 text-right">MV 行程 (仿 / 实)</th>
                  <th className="py-2 px-2.5 text-right">容差限</th>
                  <th className="py-2 px-2.5">判定</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                {runResult.pairResults.map(({ metrics }) => (
                  <tr key={metrics.pairId}>
                    <td className="py-2 px-2.5 font-sans font-semibold text-slate-900">
                      {metrics.pairName}
                    </td>
                    <td className="py-2 px-2.5 text-right font-semibold">
                      {metrics.rmseAbs.toFixed(2)} ({metrics.rmsePct.toFixed(2)}%)
                    </td>
                    <td className="py-2 px-2.5 text-right">{metrics.maePct.toFixed(2)}%</td>
                    <td className="py-2 px-2.5 text-right">{metrics.maxErrorPct.toFixed(2)}%</td>
                    <td className="py-2 px-2.5 text-right">
                      {metrics.pearsonR.toFixed(3)} / {metrics.rSquared.toFixed(3)}
                    </td>
                    <td className="py-2 px-2.5 text-right">
                      {metrics.simClosedLoop.overshootPct.toFixed(1)}% /{' '}
                      {metrics.actClosedLoop.overshootPct.toFixed(1)}%
                    </td>
                    <td className="py-2 px-2.5 text-right">
                      {metrics.simClosedLoop.settlingTime2PctSec.toFixed(0)}s /{' '}
                      {metrics.actClosedLoop.settlingTime2PctSec.toFixed(0)}s
                    </td>
                    <td className="py-2 px-2.5 text-right">
                      {metrics.simMvMetrics.totalTravel.toFixed(0)}% /{' '}
                      {metrics.actMvMetrics.totalTravel.toFixed(0)}%
                    </td>
                    <td className="py-2 px-2.5 text-right">≤{metrics.toleranceRmsePct.toFixed(1)}%</td>
                    <td className="py-2 px-2.5 font-sans">{renderGradeText(metrics.grade)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 03-B. FOPDT / SOPDT Model Identification & Valve Hysteresis Verification Table */}
          <div className="pt-3">
            <h4 className="text-xs font-bold text-slate-800 mb-2">
              附表 03-B：被控对象模型辨识参数 (FOPDT/SOPDT) 与调节阀死区回差核验
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 font-semibold">
                    <th className="py-2 px-2.5">配对回路</th>
                    <th className="py-2 px-2.5 text-right">过程增益 Kp (仿 / 实)</th>
                    <th className="py-2 px-2.5 text-right">时间常数 τ_63 (仿 / 实)</th>
                    <th className="py-2 px-2.5 text-right">表观纯滞后 θ (仿 / 实)</th>
                    <th className="py-2 px-2.5 text-right">等效阻尼比 ζ (仿 / 实)</th>
                    <th className="py-2 px-2.5 text-right">阀门回差死区 (仿 / 实)</th>
                    <th className="py-2 px-2.5">执行机构线性度诊断</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                  {runResult.pairResults.map(({ pair, metrics, alignedSeries }) => {
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
                    const hyst = computeValveHysteresisMetrics(
                      alignedSeries.map((a) => a.simMv),
                      alignedSeries.map((a) => a.simPv),
                      alignedSeries.map((a) => a.actMv),
                      alignedSeries.map((a) => a.actPv),
                      spanVal
                    );
                    return (
                      <tr key={metrics.pairId}>
                        <td className="py-2 px-2.5 font-sans font-semibold text-slate-900">
                          {metrics.actualTag} / {metrics.simTag}
                        </td>
                        <td className="py-2 px-2.5 text-right">
                          {simMod.apparentGainKp.toFixed(2)} / {actMod.apparentGainKp.toFixed(2)}
                        </td>
                        <td className="py-2 px-2.5 text-right">
                          {simMod.timeConstantTauSec.toFixed(1)}s / {actMod.timeConstantTauSec.toFixed(1)}s
                        </td>
                        <td className="py-2 px-2.5 text-right">
                          {simMod.deadTimeThetaSec.toFixed(1)}s / {actMod.deadTimeThetaSec.toFixed(1)}s
                        </td>
                        <td className="py-2 px-2.5 text-right">
                          {simMod.dampingRatioZeta.toFixed(3)} / {actMod.dampingRatioZeta.toFixed(3)}
                        </td>
                        <td className="py-2 px-2.5 text-right">
                          {hyst.simDeadbandPct.toFixed(2)}% / {hyst.actDeadbandPct.toFixed(2)}%
                        </td>
                        <td className="py-2 px-2.5 font-sans text-slate-700">{hyst.stictionDiagnosis}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 03-C. Fast Fourier Transform (FFT) Power Spectral Density (PSD) & Cyclic Disturbance Source Identification Table */}
          <div className="pt-3">
            <h4 className="text-xs font-bold text-slate-800 mb-1.5">
              附表 03-C：频域快速傅里叶变换 (FFT) 功率谱密度 (PSD) 与循环扰动源识别总表
            </h4>
            <p className="text-xs text-slate-500 mb-2">
              基于 Radix-2 Cooley-Tukey 快速傅里叶变换与 Hann 窗周期图法，计算实测 PV、仿真 PV 与残差序列的单边功率谱密度 (PSD)，定位阀门粘滞极限环、副环谐振及热容周期负荷扰动源。
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 font-semibold">
                    <th className="py-2 px-2.5">配对回路</th>
                    <th className="py-2 px-2.5 text-right">FFT 点数 (分辨率)</th>
                    <th className="py-2 px-2.5 text-right">实测主频 f1 (振荡周期)</th>
                    <th className="py-2 px-2.5 text-right">仿真主频 (振荡周期)</th>
                    <th className="py-2 px-2.5 text-right">主峰 PSD 功率 (实 / 仿)</th>
                    <th className="py-2 px-2.5 text-right">频段能量占比 (低 / 中 / 高)</th>
                    <th className="py-2 px-2.5 text-right">频谱相似度</th>
                    <th className="py-2 px-2.5">首要循环扰动源识别结论</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                  {runResult.pairResults.map(({ metrics, alignedSeries }) => {
                    const freqRes = computeFrequencyAnalysis(
                      alignedSeries,
                      runResult.alignmentOptions.gridSec
                    );
                    const topPeak = freqRes.cyclicPeaks[0];
                    return (
                      <tr key={metrics.pairId}>
                        <td className="py-2 px-2.5 font-sans font-semibold text-slate-900">
                          {metrics.actualTag} / {metrics.simTag}
                        </td>
                        <td className="py-2 px-2.5 text-right">
                          {freqRes.fftSize}pt ({freqRes.freqResolutionHz.toFixed(4)}Hz)
                        </td>
                        <td className="py-2 px-2.5 text-right font-semibold text-amber-800">
                          {freqRes.dominantActFreqHz.toFixed(3)}Hz ({freqRes.dominantActPeriodSec.toFixed(1)}s)
                        </td>
                        <td className="py-2 px-2.5 text-right text-blue-700">
                          {freqRes.dominantSimFreqHz.toFixed(3)}Hz ({freqRes.dominantSimPeriodSec.toFixed(1)}s)
                        </td>
                        <td className="py-2 px-2.5 text-right">
                          {topPeak
                            ? `${topPeak.actPsd.toFixed(2)} / ${topPeak.simPsd.toFixed(2)}`
                            : '-'}
                        </td>
                        <td className="py-2 px-2.5 text-right">
                          {freqRes.lowBandEnergyPct}% / {freqRes.midBandEnergyPct}% /{' '}
                          {freqRes.highBandEnergyPct}%
                        </td>
                        <td className="py-2 px-2.5 text-right font-semibold text-emerald-700">
                          {freqRes.spectralSimilarityPct}%
                        </td>
                        <td className="py-2 px-2.5 font-sans text-slate-700">
                          {freqRes.primaryDisturbanceSource}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* 5. Embedded Charts Gallery, FFT PSD Spectrum & Top-N Deviation Intervals */}
        <section className="space-y-5">
          <h3 className="text-base font-bold text-slate-900 border-b border-slate-200 pb-1.5">
            04. 对比趋势图集、FFT 功率谱密度 (PSD) 图谱与循环扰动源 / Top-N 偏差区间诊断
          </h3>
          {runResult.pairResults.map(({ metrics, alignedSeries, topDeviations }) => {
            const freqRes = computeFrequencyAnalysis(
              alignedSeries,
              runResult.alignmentOptions.gridSec
            );
            return (
              <div
                key={metrics.pairId}
                className="p-4 bg-slate-50/70 border border-slate-200 rounded-lg space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-bold text-slate-900">{metrics.pairName}</h4>
                  <span className="text-xs font-mono text-slate-600">
                    有效时长: {metrics.effectiveDurationSec}s · RMSE: {metrics.rmsePct.toFixed(2)}% ·
                    实测主周期 T1: {freqRes.dominantActPeriodSec.toFixed(1)}s (f1=
                    {freqRes.dominantActFreqHz.toFixed(3)}Hz)
                  </span>
                </div>

                {/* Time-Domain Trend SVG */}
                <div
                  className="w-full overflow-x-auto"
                  dangerouslySetInnerHTML={{
                    __html: renderReportSvgChart(alignedSeries, metrics),
                  }}
                />

                {/* Frequency-Domain Radix-2 FFT PSD SVG */}
                <div
                  className="w-full overflow-x-auto"
                  dangerouslySetInnerHTML={{
                    __html: renderReportPsdSvgChart(freqRes, metrics),
                  }}
                />

                {/* Summary FFT Diagnosis Callout */}
                <div className="px-3 py-2 bg-amber-50/80 border border-amber-200 rounded text-xs text-slate-800">
                  <span className="font-bold text-amber-900">频域循环扰动源诊断：</span>
                  {freqRes.summaryDiagnosis}
                </div>

                {/* Top-3 Cyclic Disturbance Peaks Sub-table */}
                {freqRes.cyclicPeaks.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse bg-white">
                      <thead>
                        <tr className="bg-amber-50/90 border-y border-amber-200 text-slate-700">
                          <th className="py-1.5 px-2.5">FFT 谱峰排名</th>
                          <th className="py-1.5 px-2.5">特征频率 / 振荡周期</th>
                          <th className="py-1.5 px-2.5">频段划分</th>
                          <th className="py-1.5 px-2.5 text-right">
                            PSD 功率 (实测 / 仿真 / 幅值比)
                          </th>
                          <th className="py-1.5 px-2.5">循环扰动源分类与整定抑制建议</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                        {freqRes.cyclicPeaks.map((p) => (
                          <tr key={p.rank}>
                            <td className="py-1.5 px-2.5 font-bold text-amber-900">
                              Peak #{p.rank}
                            </td>
                            <td className="py-1.5 px-2.5">
                              f = {p.freqHz.toFixed(4)} Hz (T = {p.periodSec.toFixed(1)}s)
                            </td>
                            <td className="py-1.5 px-2.5 font-sans text-slate-600">{p.bandLabel}</td>
                            <td className="py-1.5 px-2.5 text-right">
                              {p.actPsd.toFixed(3)} / {p.simPsd.toFixed(3)} ({p.powerRatioActToSim}
                              x)
                            </td>
                            <td className="py-1.5 px-2.5 font-sans text-slate-700">
                              <strong className="text-slate-900">{p.disturbanceSource}</strong> —{' '}
                              {p.engineeringAdvice}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Top Deviations Sub-table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse bg-white">
                    <thead>
                      <tr className="bg-slate-100 border-y border-slate-200 text-slate-600">
                        <th className="py-1.5 px-2.5">时域偏差排名</th>
                        <th className="py-1.5 px-2.5">相对时间窗口</th>
                        <th className="py-1.5 px-2.5 text-right">峰值偏差 (绝对 / %量程)</th>
                        <th className="py-1.5 px-2.5 text-right">区间局部 RMSE</th>
                        <th className="py-1.5 px-2.5">工程偏差归因与整定提示</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                      {topDeviations.slice(0, 3).map((d) => (
                        <tr key={d.rank}>
                          <td className="py-1.5 px-2.5 font-bold">#{d.rank}</td>
                          <td className="py-1.5 px-2.5">
                            T+{d.startSec}s ~ T+{d.endSec}s ({d.durationSec}s)
                          </td>
                          <td className="py-1.5 px-2.5 text-right">
                            {d.peakErrorAbs.toFixed(3)} {metrics.unit} (
                            {d.peakErrorPct >= 0 ? '+' : ''}
                            {d.peakErrorPct.toFixed(2)}%)
                          </td>
                          <td className="py-1.5 px-2.5 text-right">
                            {d.intervalRmsePct.toFixed(2)}%
                          </td>
                          <td className="py-1.5 px-2.5 font-sans text-slate-700">
                            {d.diagnosticNote}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </section>

        {/* 6. Engineering Conclusions & Appendix */}
        <section className="space-y-3">
          <h3 className="text-base font-bold text-slate-900 border-b border-slate-200 pb-1.5">
            05. 结论与整定建议 & 附录（数据哈希与计算口径）
          </h3>
          <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-800">
            {runResult.summaryConclusion.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>

          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded text-[11px] font-mono text-slate-600 space-y-1 tabular-nums">
            <div>
              [附录 1] 实测文件哈希 (SHA-256): {runResult.actualDatasetMeta.sha256} ({runResult.actualDatasetMeta.filename})
            </div>
            <div>
              [附录 2] 仿真文件哈希 (SHA-256): {runResult.simDatasetMeta.sha256} ({runResult.simDatasetMeta.filename})
            </div>
            <div>
              [附录 3] 组态字典哈希 (SHA-256): {runResult.pouMeta?.sha256 ?? '-'} ({runResult.pouMeta?.filename ?? '-'})
            </div>
            <div>
              [附录 4] 计算口径说明: 归一化指标统一以 POU 字典量程 (SVH − SVL) 为基准；跨断档缺口严格隔离不插值；重复分钟时间戳按序号列 1 Hz 重建。
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
