import React, { useState } from 'react';
import {
  Copy,
  Download,
  GitCompare,
  History,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  generateStandaloneHtmlReport,
  triggerFileDownload,
} from '../core/reportGenerator';
import { ComparisonRunResult } from '../core/types';

interface HistoryPageProps {
  historyRuns: ComparisonRunResult[];
  activeRunId: string;
  onReproduceRun: (run: ComparisonRunResult) => void;
  onCloneRunParameters: (run: ComparisonRunResult) => void;
  onDeleteRun: (runId: string) => void;
  onSaveCurrentSnapshot: () => void;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({
  historyRuns,
  activeRunId,
  onReproduceRun,
  onCloneRunParameters,
  onDeleteRun,
  onSaveCurrentSnapshot,
}) => {
  const [diffRunIdA, setDiffRunIdA] = useState<string>(historyRuns[0]?.runId || '');
  const [diffRunIdB, setDiffRunIdB] = useState<string>(historyRuns[1]?.runId || historyRuns[0]?.runId || '');

  const runA = historyRuns.find((r) => r.runId === diffRunIdA) || historyRuns[0];
  const runB = historyRuns.find((r) => r.runId === diffRunIdB) || historyRuns[historyRuns.length - 1];

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 text-balance">
            05. 历史比较记录与参数复现归档 (Reproducibility Ledger)
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            每次比较完整记录输入文件 SHA-256 哈希、编码、信号与量程配置、配对/对齐参数及{' '}
            <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">result.json</code>{' '}
            快照；支持一键复现重跑、改参数重算与跨快照 A/B 指标差值对比。
          </p>
        </div>
        <button
          type="button"
          onClick={onSaveCurrentSnapshot}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          保存当前配置为新快照
        </button>
      </div>

      {/* Snapshot A/B Diff Comparison Card */}
      {historyRuns.length >= 1 && runA && runB && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-blue-600 shrink-0" />
              <h2 className="text-sm font-bold text-slate-900">
                历史快照 A/B 灵敏度与指标差值对比 (评价不同对齐方式 / 1Hz 重建开关对 RMSE 的影响)
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              <span className="font-sans text-slate-500">基准快照 A:</span>
              <select
                value={runA.runId}
                onChange={(e) => setDiffRunIdA(e.target.value)}
                aria-label="基准快照 A"
                className="px-2 py-1 bg-slate-50 border border-slate-300 rounded text-slate-900"
              >
                {historyRuns.map((r) => (
                  <option key={r.runId} value={r.runId}>
                    {r.runId} ({r.alignmentOptions.resampleMethod} / 1Hz:{r.alignmentOptions.reconstructClock1Hz ? 'ON' : 'OFF'})
                  </option>
                ))}
              </select>
              <span className="font-sans text-slate-500">对比快照 B:</span>
              <select
                value={runB.runId}
                onChange={(e) => setDiffRunIdB(e.target.value)}
                aria-label="对比快照 B"
                className="px-2 py-1 bg-slate-50 border border-slate-300 rounded text-slate-900"
              >
                {historyRuns.map((r) => (
                  <option key={r.runId} value={r.runId}>
                    {r.runId} ({r.alignmentOptions.resampleMethod} / 1Hz:{r.alignmentOptions.reconstructClock1Hz ? 'ON' : 'OFF'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse font-mono tabular-nums">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="py-2 px-3 font-sans">配对回路</th>
                  <th className="py-2 px-3 text-right">快照 A RMSE (%量程)</th>
                  <th className="py-2 px-3 text-right">快照 B RMSE (%量程)</th>
                  <th className="py-2 px-3 text-right">差值 ΔRMSE (B − A)</th>
                  <th className="py-2 px-3 text-right">快照 A Pearson r</th>
                  <th className="py-2 px-3 text-right">快照 B Pearson r</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runA.pairResults.map((prA, idx) => {
                  const prB =
                    runB.pairResults.find((p) => p.pair.id === prA.pair.id) ||
                    runB.pairResults[idx] ||
                    prA;
                  const dRmse = prB.metrics.rmsePct - prA.metrics.rmsePct;
                  return (
                    <tr key={prA.pair.id} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-sans font-semibold text-slate-900">{prA.pair.name}</td>
                      <td className="py-2 px-3 text-right">{prA.metrics.rmsePct.toFixed(3)}%</td>
                      <td className="py-2 px-3 text-right">{prB.metrics.rmsePct.toFixed(3)}%</td>
                      <td
                        className={`py-2 px-3 text-right font-semibold ${
                          Math.abs(dRmse) < 1e-4
                            ? 'text-slate-500'
                            : dRmse < 0
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {dRmse >= 0 ? '+' : ''}
                        {dRmse.toFixed(3)}%
                      </td>
                      <td className="py-2 px-3 text-right">{prA.metrics.pearsonR.toFixed(4)}</td>
                      <td className="py-2 px-3 text-right">{prB.metrics.pearsonR.toFixed(4)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {historyRuns.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center space-y-3">
          <History className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-900">暂无历史比较记录</h3>
          <p className="text-xs text-slate-500">点击右上角「保存当前配置为新快照」或在对比工作台生成报告即可归档</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-3 px-4">任务编号 / 创建时间</th>
                  <th className="py-3 px-4">数据集与文件 SHA-256 指纹</th>
                  <th className="py-3 px-4">配对与对齐参数</th>
                  <th className="py-3 px-4 text-right">核心指标摘要 (FC10901 / TC11003)</th>
                  <th className="py-3 px-4">综合判定</th>
                  <th className="py-3 px-4 text-right">复现与操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                {historyRuns.map((run) => {
                  const isCurrent = run.runId === activeRunId;
                  const firstMetric = run.pairResults[0]?.metrics;
                  const lastMetric = run.pairResults[run.pairResults.length - 1]?.metrics;

                  return (
                    <tr
                      key={run.runId}
                      className={isCurrent ? 'bg-blue-50/40' : 'hover:bg-slate-50'}
                    >
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{run.runId}</div>
                        <div className="text-[11px] text-slate-500">{run.createdAt}</div>
                        <div className="font-sans text-xs text-slate-700 mt-0.5">{run.title}</div>
                      </td>

                      <td className="py-3 px-4 space-y-0.5 text-[11px]">
                        <div className="text-slate-800">
                          实测: {run.actualDatasetMeta.filename} ({run.actualDatasetMeta.sha256.slice(0, 10)}…)
                        </div>
                        <div className="text-slate-600">
                          仿真: {run.simDatasetMeta.filename} ({run.simDatasetMeta.sha256.slice(0, 10)}…)
                        </div>
                        <div className="text-slate-500">
                          POU: {run.pouMeta?.filename ?? '未加载'} ({run.pouMeta?.totalLoops ?? 0}回路)
                        </div>
                      </td>

                      <td className="py-3 px-4 space-y-0.5 text-[11px] font-sans text-slate-700">
                        <div>
                          模式:{' '}
                          <span className="font-mono font-semibold">
                            {run.alignmentOptions.mode}
                          </span>
                        </div>
                        <div>
                          栅格: <span className="font-mono">{run.alignmentOptions.gridSec}s</span> · 重采样:{' '}
                          <span className="font-mono">{run.alignmentOptions.resampleMethod}</span>
                        </div>
                        <div>
                          1Hz时钟重建: <span className="font-mono">{run.alignmentOptions.reconstructClock1Hz ? '开启' : '关闭'}</span> · 断档隔离:{' '}
                          <span className="font-mono">{run.alignmentOptions.excludeGaps ? '开启' : '关闭'}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right space-y-0.5">
                        {firstMetric && (
                          <div>
                            {firstMetric.actualTag}: RMSE <strong>{firstMetric.rmsePct.toFixed(2)}%</strong> (r=
                            {firstMetric.pearsonR.toFixed(3)})
                          </div>
                        )}
                        {lastMetric && lastMetric.pairId !== firstMetric?.pairId && (
                          <div className="text-slate-600">
                            {lastMetric.actualTag}: RMSE <strong>{lastMetric.rmsePct.toFixed(2)}%</strong> (r=
                            {lastMetric.pearsonR.toFixed(3)})
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 font-sans">
                        {run.overallGrade === 'PASS' ? (
                          <span className="text-emerald-700 font-bold">● 通过</span>
                        ) : run.overallGrade === 'WARNING' ? (
                          <span className="text-amber-700 font-bold">▲ 警告</span>
                        ) : (
                          <span className="text-rose-700 font-bold">✖ 不合格</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right font-sans">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onReproduceRun(run)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded whitespace-nowrap shrink-0"
                          >
                            <Play className="w-3 h-3" />
                            重跑检视
                          </button>
                          <button
                            type="button"
                            onClick={() => onCloneRunParameters(run)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded whitespace-nowrap shrink-0"
                          >
                            <Copy className="w-3 h-3" />
                            复制参数
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const html = generateStandaloneHtmlReport(run);
                              triggerFileDownload(`Report_${run.runId}.html`, html, 'text/html;charset=utf-8');
                            }}
                            aria-label={`下载 ${run.runId} HTML 报告`}
                            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded whitespace-nowrap shrink-0"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteRun(run.runId)}
                            aria-label={`删除记录 ${run.runId}`}
                            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-rose-600 bg-white border border-slate-200 hover:bg-rose-50 rounded whitespace-nowrap shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
