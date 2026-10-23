import {
  computeValveHysteresisMetrics,
  getLoopTypeLabel,
  identifyProcessModelSummary,
} from './engine';
import { AlignedPoint, ComparisonRunResult, PairComparisonMetrics } from './types';

/**
 * Render an inline SVG string of the Triple Trend (SV / PV / MV) + Error chart for standalone HTML / Word reports
 */
export function renderReportSvgChart(series: AlignedPoint[], metrics: PairComparisonMetrics): string {
  const width = 820;
  const height = 260;
  const padL = 54;
  const padR = 24;
  const padT = 24;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  if (series.length < 2) {
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"></svg>`;
  }

  const maxT = Math.max(1, series[series.length - 1].t);
  const allVals = series.flatMap((p) => [p.simSv, p.simPv, p.actPv]);
  const minY = Math.min(...allVals) - 5;
  const maxY = Math.max(...allVals) + 5;
  const spanY = Math.max(1, maxY - minY);

  const toX = (t: number) => (padL + (t / maxT) * plotW).toFixed(1);
  const toY = (v: number) => (padT + (1 - (v - minY) / spanY) * plotH).toFixed(1);

  const simSvPts = series.map((p) => `${toX(p.t)},${toY(p.simSv)}`).join(' ');
  const simPvPts = series.map((p) => `${toX(p.t)},${toY(p.simPv)}`).join(' ');
  const actPvPts = series.map((p) => `${toX(p.t)},${toY(p.actPv)}`).join(' ');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:6px;font-family:monospace;">
    <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1"/>
    <line x1="${padL}" y1="${padT + plotH * 0.25}" x2="${padL + plotW}" y2="${padT + plotH * 0.25}" stroke="#e2e8f0" stroke-dasharray="3,3"/>
    <line x1="${padL}" y1="${padT + plotH * 0.5}" x2="${padL + plotW}" y2="${padT + plotH * 0.5}" stroke="#e2e8f0" stroke-dasharray="3,3"/>
    <line x1="${padL}" y1="${padT + plotH * 0.75}" x2="${padL + plotW}" y2="${padT + plotH * 0.75}" stroke="#e2e8f0" stroke-dasharray="3,3"/>
    <polyline fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="2,2" points="${simSvPts}"/>
    <polyline fill="none" stroke="#2563eb" stroke-width="2.2" points="${simPvPts}"/>
    <polyline fill="none" stroke="#d97706" stroke-width="2" stroke-dasharray="6,4" points="${actPvPts}"/>
    <text x="${padL - 6}" y="${padT + 10}" text-anchor="end" font-size="10" fill="#475569">${maxY.toFixed(1)}</text>
    <text x="${padL - 6}" y="${padT + plotH / 2}" text-anchor="end" font-size="10" fill="#475569">${((minY + maxY) / 2).toFixed(1)}</text>
    <text x="${padL - 6}" y="${padT + plotH}" text-anchor="end" font-size="10" fill="#475569">${minY.toFixed(1)}</text>
    <text x="${padL}" y="${height - 10}" font-size="10" fill="#475569">t = 0s</text>
    <text x="${padL + plotW / 2}" y="${height - 10}" text-anchor="middle" font-size="10" fill="#475569">相对时间 T+${Math.round(maxT / 2)}s (${metrics.unit})</text>
    <text x="${padL + plotW}" y="${height - 10}" text-anchor="end" font-size="10" fill="#475569">T+${maxT}s</text>
    <text x="${padL + 10}" y="${padT + 16}" font-size="11" font-weight="bold" fill="#0f172a">${metrics.pairName} — 蓝色实线: 仿真PV | 橙色虚线: 实测PV | 灰虚线: 设定值SV</text>
  </svg>`;
}

/**
 * Generate a complete, self-contained single-file HTML report (Jinja2 template equivalent)
 * Uses `result` (result.json structure) as the single source of truth.
 */
export function generateStandaloneHtmlReport(
  result: ComparisonRunResult,
  reportHeaderOrg = '工业控制工程技术中心 · 控制回路整定与模型验证实验室'
): string {
  const gradeBadge = (g: 'PASS' | 'WARNING' | 'FAIL') =>
    g === 'PASS'
      ? '<span style="color:#15803d;font-weight:700;">● 通过 (PASS)</span>'
      : g === 'WARNING'
      ? '<span style="color:#b45309;font-weight:700;">▲ 警告 (WARNING)</span>'
      : '<span style="color:#b91c1c;font-weight:700;">✖ 不合格 (FAIL)</span>';

  const pidRowsHtml = result.pairResults
    .map(({ metrics }) => {
      const p = metrics.pouPid;
      const s = metrics.simPid;
      return `<tr>
        <td><strong>${metrics.actualTag}</strong> ↔ ${metrics.simTag}</td>
        <td>${getLoopTypeLabel(metrics.loopType)}</td>
        <td style="font-family:monospace;">[${metrics.pvSpan[0]}, ${metrics.pvSpan[1]}] ${metrics.unit}</td>
        <td style="font-family:monospace;">${p ? p.pb.toFixed(1) : '-'} / ${s ? s.pb.toFixed(1) : '-'}</td>
        <td style="font-family:monospace;">${p ? p.ti.toFixed(1) : '-'} / ${s ? s.ti.toFixed(1) : '-'}</td>
        <td style="font-family:monospace;">${p ? p.td.toFixed(1) : '-'} / ${s ? s.td.toFixed(1) : '-'}</td>
        <td>${p ? p.swpn : '反作用'} · ${p ? p.pidOpt : '标准PID'}</td>
        <td style="font-family:monospace;">HH:${p?.pvhh ?? '-'} / H:${p?.pvh ?? '-'} / L:${p?.pvl ?? '-'} / LL:${p?.pvll ?? '-'}</td>
      </tr>`;
    })
    .join('\n');

  const metricsRowsHtml = result.pairResults
    .map(({ metrics }) => {
      return `<tr>
        <td><strong>${metrics.pairName}</strong></td>
        <td style="font-family:monospace;">${metrics.rmseAbs.toFixed(3)} ${metrics.unit} (${metrics.rmsePct.toFixed(2)}%)</td>
        <td style="font-family:monospace;">${metrics.maeAbs.toFixed(3)} (${metrics.maePct.toFixed(2)}%)</td>
        <td style="font-family:monospace;">${metrics.maxAbsError.toFixed(3)} (${metrics.maxErrorPct.toFixed(2)}%)</td>
        <td style="font-family:monospace;">${metrics.biasAbs >= 0 ? '+' : ''}${metrics.biasAbs.toFixed(3)}</td>
        <td style="font-family:monospace;">${metrics.pearsonR.toFixed(4)} / ${metrics.rSquared.toFixed(4)}</td>
        <td style="font-family:monospace;">${metrics.simClosedLoop.overshootPct.toFixed(1)}% vs ${metrics.actClosedLoop.overshootPct.toFixed(1)}%</td>
        <td style="font-family:monospace;">${metrics.simClosedLoop.settlingTime2PctSec.toFixed(0)}s vs ${metrics.actClosedLoop.settlingTime2PctSec.toFixed(0)}s</td>
        <td style="font-family:monospace;">≤ ${metrics.toleranceRmsePct.toFixed(1)}%</td>
        <td>${gradeBadge(metrics.grade)}</td>
      </tr>`;
    })
    .join('\n');

  const modelIdRowsHtml = result.pairResults
    .map(({ pair, metrics, alignedSeries }) => {
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
      return `<tr>
        <td><strong>${metrics.actualTag}</strong> ↔ ${metrics.simTag}</td>
        <td style="font-family:monospace;">${simMod.apparentGainKp.toFixed(2)} / ${actMod.apparentGainKp.toFixed(2)}</td>
        <td style="font-family:monospace;">${simMod.timeConstantTauSec.toFixed(1)}s / ${actMod.timeConstantTauSec.toFixed(1)}s</td>
        <td style="font-family:monospace;">${simMod.deadTimeThetaSec.toFixed(1)}s / ${actMod.deadTimeThetaSec.toFixed(1)}s</td>
        <td style="font-family:monospace;">${simMod.dampingRatioZeta.toFixed(3)} / ${actMod.dampingRatioZeta.toFixed(3)}</td>
        <td style="font-family:monospace;">${hyst.simDeadbandPct.toFixed(2)}% / ${hyst.actDeadbandPct.toFixed(2)}%</td>
        <td>${hyst.stictionDiagnosis}</td>
      </tr>`;
    })
    .join('\n');

  const chartsHtml = result.pairResults
    .map(({ metrics, alignedSeries, topDeviations }) => {
      const svg = renderReportSvgChart(alignedSeries, metrics);
      const devRows = topDeviations
        .map(
          (d) => `<tr>
          <td style="font-family:monospace;">#${d.rank}</td>
          <td style="font-family:monospace;">T+${d.startSec}s ~ T+${d.endSec}s (${d.durationSec}s)</td>
          <td style="font-family:monospace;">${d.peakErrorAbs.toFixed(3)} ${metrics.unit} (${d.peakErrorPct >= 0 ? '+' : ''}${d.peakErrorPct.toFixed(2)}%)</td>
          <td style="font-family:monospace;">${d.intervalRmsePct.toFixed(2)}%</td>
          <td>${d.diagnosticNote}</td>
        </tr>`
        )
        .join('\n');

      return `<div style="margin-bottom:28px;page-break-inside:avoid;">
        <h3 style="margin:0 0 8px 0;font-size:15px;color:#0f172a;">${metrics.pairName} — 趋势对比与 Top 偏差区间</h3>
        ${svg}
        <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px;">
          <thead>
            <tr style="background:#f1f5f9;text-align:left;">
              <th style="padding:6px 8px;border:1px solid #cbd5e1;">排名</th>
              <th style="padding:6px 8px;border:1px solid #cbd5e1;">时间窗口</th>
              <th style="padding:6px 8px;border:1px solid #cbd5e1;">峰值偏差 (%量程)</th>
              <th style="padding:6px 8px;border:1px solid #cbd5e1;">区间 RMSE</th>
              <th style="padding:6px 8px;border:1px solid #cbd5e1;">工程诊断归因</th>
            </tr>
          </thead>
          <tbody>${devRows}</tbody>
        </table>
      </div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${result.title} — 仿真 vs 实测对比分析报告</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; color: #0f172a; background: #ffffff; margin: 0; padding: 32px; line-height: 1.55; }
    .container { max-width: 980px; margin: 0 auto; }
    h1 { font-size: 24px; margin: 4px 0 8px 0; }
    h2 { font-size: 17px; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; margin-top: 28px; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12.5px; }
    th, td { border: 1px solid #cbd5e1; padding: 7px 10px; text-align: left; }
    th { background: #f8fafc; font-weight: 600; color: #334155; }
    .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0; }
    .meta-box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px; background: #f8fafc; font-size: 12.5px; }
  </style>
</head>
<body>
  <div class="container">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:14px;">
      <div>
        <div style="font-size:12px;color:#475569;font-weight:600;">${reportHeaderOrg}</div>
        <h1>${result.title}</h1>
        <div style="font-size:12.5px;color:#475569;">任务编号: <code>${result.runId}</code> · 生成时间: <code>${result.createdAt}</code> · 综合结论: ${gradeBadge(result.overallGrade)}</div>
      </div>
    </div>

    <h2>01. 数据源摘要与编码/形态识别</h2>
    <div class="meta-grid">
      <div class="meta-box">
        <strong>实测历史 CSV</strong><br/>
        文件: <code>${result.actualDatasetMeta.filename}</code><br/>
        编码: <code>${result.actualDatasetMeta.encoding}</code> · 形态: <code>${result.actualDatasetMeta.tableFormat === 'wide' ? '宽表 (TAG.PV/MV/SV)' : '长表'}</code><br/>
        规模: <code>${result.actualDatasetMeta.rows} 行 × ${result.actualDatasetMeta.cols} 列</code><br/>
        时钟重建: <code>${result.actualDatasetMeta.reconstructed1Hz ? '已按序号重建 1Hz (修复 4行/分钟)' : '原始时间戳'}</code><br/>
        断档切分: <code>排除 ${result.actualDatasetMeta.gapsExcluded} 处跨天断档 (~3天缺口)</code>
      </div>
      <div class="meta-box">
        <strong>仿真结果 CSV</strong><br/>
        文件: <code>${result.simDatasetMeta.filename}</code><br/>
        编码: <code>${result.simDatasetMeta.encoding}</code> · 形态: <code>${result.simDatasetMeta.tableFormat === 'long' ? '长表 (loop_tag 行)' : '宽表'}</code><br/>
        规模: <code>${result.simDatasetMeta.rows} 行 × ${result.simDatasetMeta.cols} 列</code><br/>
        时间范围: <code>${result.simDatasetMeta.timeRange}</code>
      </div>
      <div class="meta-box">
        <strong>POU 组态字典 (XLSX)</strong><br/>
        文件: <code>${result.pouMeta?.filename ?? '未加载'}</code><br/>
        表头去重: <code>3269 列 → ${result.pouMeta?.dedupedColumns ?? 189} 唯一列 (首次出现)</code><br/>
        注释跳过: <code>跳过第 2–3 行参数中文注释</code><br/>
        匹配回路: <code>${result.pouMeta?.totalLoops ?? 18} 个工业控制回路</code>
      </div>
    </div>

    <h2>02. 组态当前参数 vs 仿真所用参数对照表 (POU PID Dictionary)</h2>
    <table>
      <thead>
        <tr>
          <th>配对回路 (实测 ↔ 仿真)</th>
          <th>回路类型</th>
          <th>PV/SV 量程</th>
          <th>PB 比例带 (组态/仿真)</th>
          <th>TI 积分时间 (组态/仿真)</th>
          <th>TD 微分时间 (组态/仿真)</th>
          <th>正反作用与形式</th>
          <th>报警限 (HH/H/L/LL)</th>
        </tr>
      </thead>
      <tbody>${pidRowsHtml}</tbody>
    </table>

    <h2>03. 定量误差与闭环动态性能指标总表</h2>
    <table>
      <thead>
        <tr>
          <th>配对场景窗口</th>
          <th>RMSE (绝对 / %量程)</th>
          <th>MAE (绝对 / %量程)</th>
          <th>最大绝对误差</th>
          <th>平均偏差 Bias</th>
          <th>Pearson r / R²</th>
          <th>超调量 (仿 / 实)</th>
          <th>调节时间±2% (仿 / 实)</th>
          <th>容差阈值</th>
          <th>判定结果</th>
        </tr>
      </thead>
      <tbody>${metricsRowsHtml}</tbody>
    </table>

    <h2>03-B. 被控对象模型辨识参数 (FOPDT/SOPDT) 与调节阀死区回差核验</h2>
    <table>
      <thead>
        <tr>
          <th>配对回路</th>
          <th>过程增益 Kp (仿/实)</th>
          <th>时间常数 τ_63 (仿/实)</th>
          <th>纯滞后 θ (仿/实)</th>
          <th>阻尼比 ζ (仿/实)</th>
          <th>阀门死区回差 (仿/实)</th>
          <th>执行机构线性度诊断</th>
        </tr>
      </thead>
      <tbody>${modelIdRowsHtml}</tbody>
    </table>

    <h2>04. 三联趋势对比图与 Top-N 偏差区间归因</h2>
    ${chartsHtml}

    <h2>05. 工程结论与整定/建模建议</h2>
    <ul>
      ${result.summaryConclusion.map((c) => `<li style="margin-bottom:6px;font-size:13.5px;">${c}</li>`).join('\n')}
    </ul>

    <h2>06. 附录：可追溯性元数据与计算口径 (result.json)</h2>
    <p style="font-size:12px;color:#475569;">
      实测 SHA-256: <code>${result.actualDatasetMeta.sha256}</code><br/>
      仿真 SHA-256: <code>${result.simDatasetMeta.sha256}</code><br/>
      对齐参数: <code>模式=${result.alignmentOptions.mode}, 栅格=${result.alignmentOptions.gridSec}s, 重采样=${result.alignmentOptions.resampleMethod}, 1Hz序号重建=${result.alignmentOptions.reconstructClock1Hz}, 跨断档不插值=${result.alignmentOptions.excludeGaps}</code><br/>
      平台规范版本: <code>SimVsAct LoopBench v0.2 (2026-10-23 标准口径)</code>
    </p>
  </div>
</body>
</html>`;
}

/**
 * Trigger browser file download for HTML, Word (.doc/.docx MHTML), or JSON (`result.json`)
 */
export function triggerFileDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
