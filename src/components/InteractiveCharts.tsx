import React, { useMemo, useRef, useState } from 'react';
import { Download, Maximize2, RotateCcw, Sliders } from 'lucide-react';
import {
  computeCascadeCoupledAnalysis,
  computeCrossCorrelationCurve,
  computeSpectralPsdAnalysis,
  computeValveHysteresisMetrics,
  getLoopTypeLabel,
  lttbDownsample,
  ResolvedMasterSlaveStack,
} from '../core/engine';
import {
  AlignedPoint,
  ComparisonRunResult,
  PairComparisonMetrics,
  PairItem,
  ResidualDistribution,
} from '../core/types';

interface TripleTrendProps {
  series: AlignedPoint[];
  metrics: PairComparisonMetrics;
  lttbEnabled: boolean;
  onToggleLttb: () => void;
}

export const TripleTrendAndErrorChart: React.FC<TripleTrendProps> = ({
  series,
  metrics,
  lttbEnabled,
  onToggleLttb,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showSv, setShowSv] = useState(true);
  const [showSimPv, setShowSimPv] = useState(true);
  const [showActPv, setShowActPv] = useState(true);
  const [showMv, setShowMv] = useState(true);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [zoomRange, setZoomRange] = useState<[number, number]>([0, 100]); // percentage of series
  const svgRef = useRef<SVGSVGElement | null>(null);

  const slicedSeries = useMemo(() => {
    if (series.length === 0) return [];
    const startIdx = Math.floor((zoomRange[0] / 100) * (series.length - 1));
    const endIdx = Math.max(startIdx + 2, Math.ceil((zoomRange[1] / 100) * series.length));
    const rawSlice = series.slice(startIdx, endIdx);
    return lttbEnabled && rawSlice.length > 360 ? lttbDownsample(rawSlice, 360) : rawSlice;
  }, [series, zoomRange, lttbEnabled]);

  // Identify step characteristic points for visual engineering annotations
  const stepMarkers = useMemo(() => {
    if (slicedSeries.length < 10) return null;
    const sv0 = slicedSeries[0].simSv;
    const svEnd = slicedSeries[slicedSeries.length - 1].simSv;
    const span = Math.max(1, metrics.pvSpan[1] - metrics.pvSpan[0]);
    let stepPt = slicedSeries[0];
    for (const p of slicedSeries) {
      if (Math.abs(p.simSv - sv0) > span * 0.01) {
        stepPt = p;
        break;
      }
    }
    let peakPt = stepPt;
    for (const p of slicedSeries) {
      if (p.t >= stepPt.t && p.actPv > peakPt.actPv) {
        peakPt = p;
      }
    }
    const tsSec = stepPt.t + metrics.actClosedLoop.settlingTime2PctSec;
    const band2Abs = Math.max(Math.abs(svEnd - sv0), span * 0.1) * 0.02;
    return {
      tStep: stepPt.t,
      tPeak: peakPt.t,
      peakPv: peakPt.actPv,
      tSettle2: tsSec <= slicedSeries[slicedSeries.length - 1].t ? tsSec : null,
      svFinal: svEnd,
      band2Upper: svEnd + band2Abs,
      band2Lower: svEnd - band2Abs,
    };
  }, [slicedSeries, metrics]);

  const windowStats = useMemo(() => {
    if (slicedSeries.length === 0) {
      return { rmsePct: 0, maxErrPct: 0, meanBiasAbs: 0, durationSec: 0 };
    }
    let sumSq = 0;
    let maxPct = 0;
    let sumBias = 0;
    for (const p of slicedSeries) {
      sumSq += p.errorPvPct * p.errorPvPct;
      if (Math.abs(p.errorPvPct) > maxPct) maxPct = Math.abs(p.errorPvPct);
      sumBias += p.errorPvAbs;
    }
    const dur = slicedSeries[slicedSeries.length - 1].t - slicedSeries[0].t;
    return {
      rmsePct: Math.sqrt(sumSq / slicedSeries.length),
      maxErrPct: maxPct,
      meanBiasAbs: sumBias / slicedSeries.length,
      durationSec: dur,
    };
  }, [slicedSeries]);

  const width = 880;
  const height = 520;
  const padL = 62;
  const padR = 26;

  // 3 stacked panels:
  // Panel 1: SV + PV (top: 24 -> 224, h=200)
  // Panel 2: MV (top: 256 -> 366, h=110)
  // Panel 3: Error PV % with ±Tolerance Band (top: 398 -> 488, h=90)
  const plotW = width - padL - padR;

  const minT = slicedSeries[0]?.t ?? 0;
  const maxT = Math.max(minT + 1, slicedSeries[slicedSeries.length - 1]?.t ?? 100);

  const pvVals = slicedSeries.flatMap((p) => [p.simSv, p.simPv, p.actPv]);
  const rawPvMin = pvVals.length ? Math.min(...pvVals) : 0;
  const rawPvMax = pvVals.length ? Math.max(...pvVals) : 100;
  const rawPvRange = Math.max(10, rawPvMax - rawPvMin);
  const pvMin = rawPvMin - rawPvRange * 0.08;
  const pvMax = rawPvMax + rawPvRange * 0.22;
  const pvSpan = Math.max(1e-3, pvMax - pvMin);

  const mvVals = slicedSeries.flatMap((p) => [p.simMv, p.actMv]);
  const rawMvMin = mvVals.length ? Math.min(...mvVals) : 0;
  const rawMvMax = mvVals.length ? Math.max(...mvVals) : 100;
  const rawMvRange = Math.max(10, rawMvMax - rawMvMin);
  const mvMin = Math.max(0, rawMvMin - rawMvRange * 0.1);
  const mvMax = Math.min(115, rawMvMax + rawMvRange * 0.28);
  const mvSpan = Math.max(1e-3, mvMax - mvMin);

  const errVals = slicedSeries.map((p) => Math.abs(p.errorPvPct));
  const errBound = Math.max(metrics.toleranceRmsePct * 1.8, ...(errVals.length ? errVals : [3]), 2.5);

  const toX = (t: number) => padL + ((t - minT) / (maxT - minT)) * plotW;
  const toYPv = (v: number) => 24 + (1 - (v - pvMin) / pvSpan) * 200;
  const toYMv = (v: number) => 256 + (1 - (v - mvMin) / mvSpan) * 110;
  const toYErr = (pct: number) => 398 + (1 - (pct + errBound) / (2 * errBound)) * 90;

  const buildPolyline = (fnY: (p: AlignedPoint) => number) =>
    slicedSeries.map((p) => `${toX(p.t).toFixed(1)},${fnY(p).toFixed(1)}`).join(' ');

  const hoveredPoint =
    hoverIdx !== null && slicedSeries[hoverIdx] ? slicedSeries[hoverIdx] : slicedSeries[slicedSeries.length - 1];

  const handleExportSvg = () => {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${metrics.actualTag}_${metrics.simTag}_triple_trend.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const tolTopY = toYErr(metrics.toleranceRmsePct);
  const tolBotY = toYErr(-metrics.toleranceRmsePct);
  const zeroErrY = toYErr(0);

  return (
    <div className="border border-slate-200 bg-white rounded-lg p-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-slate-200">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            三联趋势与同步偏差曲线 (SV / PV / MV / Error %量程)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            实线 = 仿真模型 ({metrics.simTag}) · 虚线 = 实测历史 ({metrics.actualTag}) · 容差带 ±
            {metrics.toleranceRmsePct.toFixed(1)}% 量程
          </p>
        </div>

        {/* Series Visibility & Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowSv(!showSv)}
            className={`px-2 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
              showSv
                ? 'bg-slate-100 text-slate-800 border-slate-300'
                : 'bg-white text-slate-400 border-slate-200'
            }`}
          >
            设定值 SV
          </button>
          <button
            type="button"
            onClick={() => setShowSimPv(!showSimPv)}
            className={`px-2 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
              showSimPv
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-white text-slate-400 border-slate-200'
            }`}
          >
            仿真 PV(实)
          </button>
          <button
            type="button"
            onClick={() => setShowActPv(!showActPv)}
            className={`px-2 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
              showActPv
                ? 'bg-amber-50 text-amber-800 border-amber-200'
                : 'bg-white text-slate-400 border-slate-200'
            }`}
          >
            实测 PV(虚)
          </button>
          <button
            type="button"
            onClick={() => setShowAnnotations(!showAnnotations)}
            className={`px-2 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
              showAnnotations
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-white text-slate-400 border-slate-200'
            }`}
          >
            特征点(Tp/Ts/±2%)
          </button>
          <button
            type="button"
            onClick={onToggleLttb}
            className={`px-2 py-1 text-xs font-mono rounded border transition-colors whitespace-nowrap shrink-0 ${
              lttbEnabled
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
            title="LTTB 降采样渲染优化"
          >
            LTTB:{lttbEnabled ? 'ON' : 'OFF'}({slicedSeries.length})
          </button>
          <button
            type="button"
            onClick={handleExportSvg}
            aria-label="导出趋势图 SVG"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            SVG
          </button>
        </div>
      </div>

      {/* Live Crosshair Readout Bar */}
      {hoveredPoint && (
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 px-3 py-2 mb-3 bg-slate-50 border border-slate-200 rounded text-xs font-mono tabular-nums">
          <div>
            <span className="text-slate-400 block text-[10px]">采样时刻</span>
            <span className="font-semibold text-slate-900">
              T+{hoveredPoint.t}s ({hoveredPoint.timestampLabel})
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px]">设定值 SV (仿/实)</span>
            <span className="text-slate-800">
              {hoveredPoint.simSv.toFixed(2)} / {hoveredPoint.actSv.toFixed(2)} {metrics.unit}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px]">仿真 PV (实线)</span>
            <span className="text-blue-600 font-semibold">
              {hoveredPoint.simPv.toFixed(3)} {metrics.unit}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px]">实测 PV (虚线)</span>
            <span className="text-amber-600 font-semibold">
              {hoveredPoint.actPv.toFixed(3)} {metrics.unit}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px]">输出 MV (仿/实)</span>
            <span className="text-cyan-700">
              {hoveredPoint.simMv.toFixed(1)}% / {hoveredPoint.actMv.toFixed(1)}%
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px]">瞬时偏差 (实−仿)</span>
            <span
              className={`font-semibold ${
                hoveredPoint.inTolerance ? 'text-emerald-600' : 'text-rose-600'
              }`}
            >
              {hoveredPoint.errorPvAbs >= 0 ? '+' : ''}
              {hoveredPoint.errorPvAbs.toFixed(3)} ({hoveredPoint.errorPvPct >= 0 ? '+' : ''}
              {hoveredPoint.errorPvPct.toFixed(2)}%)
            </span>
          </div>
        </div>
      )}

      {/* Interactive SVG Canvas */}
      <div className="relative overflow-x-auto">
        <svg
          ref={svgRef}
          data-testid="triple-trend-svg"
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto select-none cursor-crosshair"
          onMouseMove={(e) => {
            if (slicedSeries.length === 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = ((e.clientX - rect.left) / rect.width) * width - padL;
            const ratio = Math.max(0, Math.min(1, relX / plotW));
            const idx = Math.round(ratio * (slicedSeries.length - 1));
            setHoverIdx(idx);
          }}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Panel 1: SV + PV */}
          <rect x={padL} y={24} width={plotW} height={200} fill="#F8FAFC" stroke="#E2E8F0" />
          {[0.25, 0.5, 0.75].map((r) => (
            <line
              key={r}
              x1={padL}
              y1={24 + 200 * r}
              x2={padL + plotW}
              y2={24 + 200 * r}
              stroke="#E2E8F0"
              strokeDasharray="3,3"
            />
          ))}

          {/* Characteristic Annotations on Panel 1: ±2% Settling Band, T_step, Tp, Ts */}
          {showAnnotations && stepMarkers && (
            <g>
              {/* ±2% steady-state band */}
              <rect
                x={padL}
                y={Math.max(24, toYPv(stepMarkers.band2Upper))}
                width={plotW}
                height={Math.max(2, toYPv(stepMarkers.band2Lower) - toYPv(stepMarkers.band2Upper))}
                fill="#10B981"
                fillOpacity="0.09"
              />
              {stepMarkers.tStep > minT && (
                <g>
                  <line
                    x1={toX(stepMarkers.tStep)}
                    y1={24}
                    x2={toX(stepMarkers.tStep)}
                    y2={224}
                    stroke="#64748B"
                    strokeWidth="1"
                    strokeDasharray="3,3"
                  />
                  <text
                    x={toX(stepMarkers.tStep) + 4}
                    y={216}
                    fontSize="9.5"
                    fontFamily="monospace"
                    fill="#475569"
                  >
                    T_step={stepMarkers.tStep}s
                  </text>
                </g>
              )}
              {stepMarkers.tPeak > stepMarkers.tStep && (
                <g>
                  <line
                    x1={toX(stepMarkers.tPeak)}
                    y1={toYPv(stepMarkers.peakPv)}
                    x2={toX(stepMarkers.tPeak)}
                    y2={224}
                    stroke="#D97706"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                  <circle cx={toX(stepMarkers.tPeak)} cy={toYPv(stepMarkers.peakPv)} r={3.5} fill="#D97706" />
                  <text
                    x={toX(stepMarkers.tPeak) + 5}
                    y={toYPv(stepMarkers.peakPv) + 3}
                    fontSize="9.5"
                    fontFamily="monospace"
                    fontWeight="600"
                    fill="#B45309"
                  >
                    Mp={metrics.actClosedLoop.overshootPct.toFixed(1)}% (Tp={metrics.actClosedLoop.peakTimeSec}s)
                  </text>
                </g>
              )}
              {stepMarkers.tSettle2 && (
                <g>
                  <line
                    x1={toX(stepMarkers.tSettle2)}
                    y1={46}
                    x2={toX(stepMarkers.tSettle2)}
                    y2={224}
                    stroke="#059669"
                    strokeWidth="1"
                    strokeDasharray="4,3"
                  />
                  <text
                    x={toX(stepMarkers.tSettle2) + 4}
                    y={58}
                    fontSize="9.5"
                    fontFamily="monospace"
                    fontWeight="600"
                    fill="#047857"
                  >
                    Ts(±2%)={metrics.actClosedLoop.settlingTime2PctSec}s
                  </text>
                </g>
              )}
            </g>
          )}

          <text x={padL + 8} y={40} fontSize="11" fontWeight="600" fill="#334155">
            [1] 过程变量 PV & 设定值 SV ({metrics.unit}) — 量程 [{metrics.pvSpan[0]}, {metrics.pvSpan[1]}]
          </text>
          <text x={padL - 8} y={34} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
            {pvMax.toFixed(1)}
          </text>
          <text x={padL - 8} y={124} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
            {((pvMax + pvMin) / 2).toFixed(1)}
          </text>
          <text x={padL - 8} y={220} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
            {pvMin.toFixed(1)}
          </text>

          {showSv && slicedSeries.length > 1 && (
            <polyline
              fill="none"
              stroke="#64748B"
              strokeWidth="1.5"
              strokeDasharray="2,2"
              points={buildPolyline((p) => toYPv(p.simSv))}
            />
          )}
          {showSimPv && slicedSeries.length > 1 && (
            <polyline
              fill="none"
              stroke="#2563EB"
              strokeWidth="2.2"
              points={buildPolyline((p) => toYPv(p.simPv))}
            />
          )}
          {showActPv && slicedSeries.length > 1 && (
            <polyline
              fill="none"
              stroke="#D97706"
              strokeWidth="2"
              strokeDasharray="6,4"
              points={buildPolyline((p) => toYPv(p.actPv))}
            />
          )}

          {/* Panel 2: MV Output */}
          <rect x={padL} y={256} width={plotW} height={110} fill="#F8FAFC" stroke="#E2E8F0" />
          <line
            x1={padL}
            y1={256 + 55}
            x2={padL + plotW}
            y2={256 + 55}
            stroke="#E2E8F0"
            strokeDasharray="3,3"
          />
          <text x={padL + 8} y={272} fontSize="11" fontWeight="600" fill="#334155">
            [2] 控制阀位输出 MV (%) — 仿真 MV(实线) vs 实测 MV(虚线)
          </text>
          <text x={padL - 8} y={266} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
            {mvMax.toFixed(0)}%
          </text>
          <text x={padL - 8} y={314} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
            {((mvMax + mvMin) / 2).toFixed(0)}%
          </text>
          <text x={padL - 8} y={364} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
            {mvMin.toFixed(0)}%
          </text>

          {showMv && slicedSeries.length > 1 && (
            <>
              <polyline
                fill="none"
                stroke="#0284C7"
                strokeWidth="1.8"
                points={buildPolyline((p) => toYMv(p.simMv))}
              />
              <polyline
                fill="none"
                stroke="#EA580C"
                strokeWidth="1.8"
                strokeDasharray="5,4"
                points={buildPolyline((p) => toYMv(p.actMv))}
              />
            </>
          )}

          {/* Panel 3: Deviation Curve (Act - Sim % Span) with ±Tolerance Band */}
          <rect x={padL} y={398} width={plotW} height={90} fill="#F8FAFC" stroke="#E2E8F0" />
          {/* Tolerance Band */}
          <rect
            x={padL}
            y={Math.max(398, tolTopY)}
            width={plotW}
            height={Math.max(2, Math.min(488, tolBotY) - Math.max(398, tolTopY))}
            fill="#16A34A"
            fillOpacity="0.08"
          />
          <line
            x1={padL}
            y1={tolTopY}
            x2={padL + plotW}
            y2={tolTopY}
            stroke="#16A34A"
            strokeWidth="1"
            strokeDasharray="4,3"
          />
          <line
            x1={padL}
            y1={tolBotY}
            x2={padL + plotW}
            y2={tolBotY}
            stroke="#16A34A"
            strokeWidth="1"
            strokeDasharray="4,3"
          />
          <line x1={padL} y1={zeroErrY} x2={padL + plotW} y2={zeroErrY} stroke="#94A3B8" strokeWidth="1" />

          <text x={padL + 8} y={413} fontSize="11" fontWeight="600" fill="#334155">
            [3] 归一化偏差曲线 (实测 − 仿真, %量程) — 绿色带为 ±{metrics.toleranceRmsePct.toFixed(1)}% 容差限
          </text>
          <text x={padL - 8} y={408} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
            +{errBound.toFixed(1)}%
          </text>
          <text x={padL - 8} y={zeroErrY + 3} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
            0.0%
          </text>
          <text x={padL - 8} y={486} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
            -{errBound.toFixed(1)}%
          </text>

          {slicedSeries.length > 1 && (
            <polyline
              fill="none"
              stroke="#DC2626"
              strokeWidth="1.7"
              points={buildPolyline((p) => toYErr(p.errorPvPct))}
            />
          )}

          {/* X Axis Time Ticks */}
          {[0, 0.25, 0.5, 0.75, 1].map((r) => {
            const x = padL + plotW * r;
            const tVal = Math.round(minT + (maxT - minT) * r);
            return (
              <g key={r}>
                <line x1={x} y1={488} x2={x} y2={493} stroke="#64748B" />
                <text
                  x={x}
                  y={508}
                  textAnchor={r === 0 ? 'start' : r === 1 ? 'end' : 'middle'}
                  fontSize="10"
                  fontFamily="monospace"
                  fill="#475569"
                >
                  T+{tVal}s
                </text>
              </g>
            );
          })}

          {/* Synchronized Crosshair Vertical Line */}
          {hoveredPoint && (
            <g>
              <line
                x1={toX(hoveredPoint.t)}
                y1={24}
                x2={toX(hoveredPoint.t)}
                y2={488}
                stroke="#0F172A"
                strokeWidth="1"
                strokeDasharray="2,2"
              />
              <circle cx={toX(hoveredPoint.t)} cy={toYPv(hoveredPoint.simPv)} r={4} fill="#2563EB" />
              <circle cx={toX(hoveredPoint.t)} cy={toYPv(hoveredPoint.actPv)} r={4} fill="#D97706" />
              <circle cx={toX(hoveredPoint.t)} cy={toYErr(hoveredPoint.errorPvPct)} r={3.5} fill="#DC2626" />
            </g>
          )}
        </svg>
      </div>

      {/* Interactive Window Brush / Range Selector & Window Stats */}
      <div className="mt-3 pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-3">
          <span className="font-medium text-slate-700 flex items-center gap-1">
            <Sliders className="w-3.5 h-3.5 text-slate-500" />
            框选区间统计:
          </span>
          <label className="flex items-center gap-1.5 text-slate-600">
            起点:
            <input
              type="range"
              min={0}
              max={Math.max(0, zoomRange[1] - 10)}
              value={zoomRange[0]}
              onChange={(e) => setZoomRange([Number(e.target.value), zoomRange[1]])}
              aria-label="窗口起点百分比"
              className="w-24 accent-blue-600"
            />
          </label>
          <label className="flex items-center gap-1.5 text-slate-600">
            终点:
            <input
              type="range"
              min={Math.min(100, zoomRange[0] + 10)}
              max={100}
              value={zoomRange[1]}
              onChange={(e) => setZoomRange([zoomRange[0], Number(e.target.value)])}
              aria-label="窗口终点百分比"
              className="w-24 accent-blue-600"
            />
          </label>
          <button
            type="button"
            onClick={() => setZoomRange([0, 100])}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-600 bg-slate-100 rounded hover:bg-slate-200 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3 h-3" />
            重置全窗
          </button>
        </div>

        <div className="flex items-center gap-4 font-mono tabular-nums text-slate-600">
          <span>
            区间时长: <strong className="text-slate-900">{windowStats.durationSec}s</strong>
          </span>
          <span>·</span>
          <span>
            区间 RMSE: <strong className="text-slate-900">{windowStats.rmsePct.toFixed(2)}%</strong>
          </span>
          <span>·</span>
          <span>
            最大偏差: <strong className="text-slate-900">{windowStats.maxErrPct.toFixed(2)}%</strong>
          </span>
          <span>·</span>
          <span>
            平均偏置: <strong className="text-slate-900">{windowStats.meanBiasAbs.toFixed(3)} {metrics.unit}</strong>
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * Charts 3, 4, 5, 6: PV Scatter Plot (y=x) + Residual Distribution Histogram + MV-PV Valve Hysteresis Phase Plot + Cross-Correlation Lag Spectrum R_xy(tau)
 */
export const ScatterAndResidualCharts: React.FC<{
  series: AlignedPoint[];
  metrics: PairComparisonMetrics;
  residualDist: ResidualDistribution;
  onApplyLagSec?: (lagSec: number) => void;
}> = ({ series, metrics, residualDist, onApplyLagSec }) => {
  const scatterSample = useMemo(() => {
    if (series.length <= 240) return series;
    const step = Math.ceil(series.length / 240);
    return series.filter((_, idx) => idx % step === 0);
  }, [series]);

  const crossCorrCurve = useMemo(
    () =>
      computeCrossCorrelationCurve(
        series.map((s) => s.actPv),
        series.map((s) => s.simPv),
        18,
        1
      ),
    [series]
  );

  const valveMetrics = useMemo(() => computeValveHysteresisMetrics(series), [series]);

  const allPv = scatterSample.flatMap((p) => [p.simPv, p.actPv]);
  const minVal = allPv.length ? Math.min(...allPv) - 2 : 0;
  const maxVal = allPv.length ? Math.max(...allPv) + 2 : 100;
  const span = Math.max(1e-3, maxVal - minVal);

  const allMv = scatterSample.flatMap((p) => [p.simMv, p.actMv]);
  const minMv = allMv.length ? Math.min(...allMv) - 2 : 0;
  const maxMv = allMv.length ? Math.max(...allMv) + 2 : 100;
  const spanMv = Math.max(1e-3, maxMv - minMv);

  const size = 240;
  const pad = 34;
  const plot = size - pad * 2;

  const toX = (v: number) => pad + ((v - minVal) / span) * plot;
  const toY = (v: number) => pad + (1 - (v - minVal) / span) * plot;

  const toXMv = (mv: number) => pad + ((mv - minMv) / spanMv) * plot;
  const toYPvPhase = (pv: number) => pad + (1 - (pv - minVal) / span) * plot;

  const simPhasePts = scatterSample
    .map((p) => `${toXMv(p.simMv).toFixed(1)},${toYPvPhase(p.simPv).toFixed(1)}`)
    .join(' ');
  const actPhasePts = scatterSample
    .map((p) => `${toXMv(p.actMv).toFixed(1)},${toYPvPhase(p.actPv).toFixed(1)}`)
    .join(' ');

  const maxBinDensity = Math.max(1, ...residualDist.bins.map((b) => b.densityPct));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* PV Scatter Plot (Actual vs Sim + y = x) */}
        <div className="border border-slate-200 bg-white rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h4 className="text-sm font-semibold text-slate-900">
                PV 散点贴合图 (实测 vs 仿真 + y = x 参考线)
              </h4>
              <p className="text-xs text-slate-500">
                检验全量程线性度与稳态增益一致性 · Pearson r = {metrics.pearsonR.toFixed(4)} · R² ={' '}
                {metrics.rSquared.toFixed(4)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <svg
              data-testid="pv-scatter-svg"
              viewBox={`0 0 ${size} ${size}`}
              className="w-56 h-56 shrink-0 border border-slate-100 rounded bg-slate-50"
            >
              <rect x={pad} y={pad} width={plot} height={plot} fill="#FFFFFF" stroke="#E2E8F0" />
              <line
                x1={pad}
                y1={pad + plot}
                x2={pad + plot}
                y2={pad}
                stroke="#0F172A"
                strokeWidth="1.5"
                strokeDasharray="4,3"
              />
              {scatterSample.map((pt, i) => (
                <circle
                  key={i}
                  cx={toX(pt.simPv)}
                  cy={toY(pt.actPv)}
                  r={2.5}
                  fill={pt.inTolerance ? '#2563EB' : '#DC2626'}
                  fillOpacity={0.7}
                />
              ))}
              <text x={size / 2} y={size - 8} textAnchor="middle" fontSize="10" fontFamily="monospace" fill="#475569">
                仿真 PV ({metrics.unit})
              </text>
              <text
                x={12}
                y={size / 2}
                textAnchor="middle"
                fontSize="10"
                fontFamily="monospace"
                fill="#475569"
                transform={`rotate(-90 12 ${size / 2})`}
              >
                实测 PV ({metrics.unit})
              </text>
            </svg>

            <div className="space-y-2 text-xs font-mono tabular-nums flex-1">
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                <div className="text-slate-400 text-[10px]">相关系数 Pearson r</div>
                <div className="text-base font-bold text-slate-900">{metrics.pearsonR.toFixed(4)}</div>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                <div className="text-slate-400 text-[10px]">决定系数 R²</div>
                <div className="text-base font-bold text-slate-900">{metrics.rSquared.toFixed(4)}</div>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                <div className="text-slate-400 text-[10px]">互相关估计滞后 Δt</div>
                <div className="text-sm font-semibold text-blue-700">
                  {metrics.estimatedLagSec} s (MaxCorr: {metrics.maxCrossCorr.toFixed(3)})
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Residual Distribution Histogram + Quantiles */}
        <div className="border border-slate-200 bg-white rounded-lg p-4">
          <div className="mb-2">
            <h4 className="text-sm font-semibold text-slate-900">残差分布直方图与分位数 (% 量程)</h4>
            <p className="text-xs text-slate-500">
              识别系统性偏置 (Bias = {residualDist.mean >= 0 ? '+' : ''}
              {residualDist.mean.toFixed(2)}%) vs 随机测量噪声 (σ = {residualDist.stdDev.toFixed(2)}%)
            </p>
          </div>

          <div className="h-40 flex items-end gap-1 pt-4 pb-2 px-2 bg-slate-50 border border-slate-200 rounded">
            {residualDist.bins.map((b, idx) => {
              const hPct = Math.max(3, (b.densityPct / maxBinDensity) * 100);
              const inTol = Math.abs((b.binStartPct + b.binEndPct) / 2) <= metrics.toleranceRmsePct;
              return (
                <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end group">
                  <div className="text-[9px] font-mono text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    {b.densityPct}%
                  </div>
                  <div
                    style={{ height: `${hPct}%` }}
                    className={`w-full rounded-t transition-all ${
                      inTol ? 'bg-blue-600/80 hover:bg-blue-700' : 'bg-amber-500/85 hover:bg-amber-600'
                    }`}
                    title={`${b.label}: ${b.count} 点 (${b.densityPct}%)`}
                  />
                  <span className="text-[9px] font-mono text-slate-500 mt-1 truncate max-w-full">
                    {idx % 2 === 0 ? b.label : ''}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-5 gap-2 mt-3 text-center font-mono tabular-nums text-xs">
            <div className="p-1.5 bg-slate-50 border border-slate-200 rounded">
              <span className="block text-[10px] text-slate-400">P05</span>
              <span className="font-semibold text-slate-800">{residualDist.p05.toFixed(2)}%</span>
            </div>
            <div className="p-1.5 bg-slate-50 border border-slate-200 rounded">
              <span className="block text-[10px] text-slate-400">P25</span>
              <span className="font-semibold text-slate-800">{residualDist.p25.toFixed(2)}%</span>
            </div>
            <div className="p-1.5 bg-blue-50 border border-blue-200 rounded">
              <span className="block text-[10px] text-blue-600">P50 (中位数)</span>
              <span className="font-bold text-blue-900">{residualDist.p50.toFixed(2)}%</span>
            </div>
            <div className="p-1.5 bg-slate-50 border border-slate-200 rounded">
              <span className="block text-[10px] text-slate-400">P75</span>
              <span className="font-semibold text-slate-800">{residualDist.p75.toFixed(2)}%</span>
            </div>
            <div className="p-1.5 bg-slate-50 border border-slate-200 rounded">
              <span className="block text-[10px] text-slate-400">P95</span>
              <span className="font-semibold text-slate-800">{residualDist.p95.toFixed(2)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Second Row of Diagnostic Charts: MV-PV Valve Hysteresis Loop + Cross-Correlation Lag Spectrum R_xy(tau) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* MV-PV Phase Plane Valve Hysteresis Plot */}
        <div className="border border-slate-200 bg-white rounded-lg p-4">
          <div className="mb-2">
            <h4 className="text-sm font-semibold text-slate-900">
              MV–PV 阀门特性相平面轨迹图 (执行机构死区/粘滞回差诊断)
            </h4>
            <p className="text-xs text-slate-500">{valveMetrics.stictionDiagnosis}</p>
          </div>
          <div className="flex items-center gap-4">
            <svg
              viewBox={`0 0 ${size} ${size}`}
              className="w-56 h-56 shrink-0 border border-slate-100 rounded bg-slate-50"
            >
              <rect x={pad} y={pad} width={plot} height={plot} fill="#FFFFFF" stroke="#E2E8F0" />
              <polyline fill="none" stroke="#2563EB" strokeWidth="1.8" points={simPhasePts} />
              <polyline
                fill="none"
                stroke="#D97706"
                strokeWidth="1.6"
                strokeDasharray="4,3"
                points={actPhasePts}
              />
              <text x={size / 2} y={size - 8} textAnchor="middle" fontSize="10" fontFamily="monospace" fill="#475569">
                控制器输出 MV (%)
              </text>
              <text
                x={12}
                y={size / 2}
                textAnchor="middle"
                fontSize="10"
                fontFamily="monospace"
                fill="#475569"
                transform={`rotate(-90 12 ${size / 2})`}
              >
                过程响应 PV ({metrics.unit})
              </text>
            </svg>

            <div className="space-y-2 text-xs font-mono tabular-nums flex-1">
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                <div className="text-slate-400 text-[10px]">实测表观阀门死区回差</div>
                <div className="text-base font-bold text-amber-700">{valveMetrics.actDeadbandPct.toFixed(2)}% MV</div>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                <div className="text-slate-400 text-[10px]">仿真模型设定死区</div>
                <div className="text-base font-bold text-blue-700">{valveMetrics.simDeadbandPct.toFixed(2)}% MV</div>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded">
                <div className="text-slate-400 text-[10px]">实测阀位换向次数</div>
                <div className="text-sm font-semibold text-slate-900">{valveMetrics.reversalCountAct} 次换向</div>
              </div>
            </div>
          </div>
        </div>

        {/* Cross-Correlation Lag Spectrum R_xy(tau) */}
        <div className="border border-slate-200 bg-white rounded-lg p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">
                  互相关时延谱曲线 R_xy(τ) (点击任意滞后柱一键应用时延补偿)
                </h4>
                <p className="text-xs text-slate-500">
                  自动搜寻实测与仿真序列最大互相关峰值滞后 τ* = {metrics.estimatedLagSec}s (R_max ={' '}
                  {metrics.maxCrossCorr.toFixed(4)})
                </p>
              </div>
            </div>

            <div className="h-40 flex items-end gap-0.5 pt-4 pb-2 px-2 bg-slate-50 border border-slate-200 rounded">
              {crossCorrCurve.map((pt) => {
                const normH = Math.max(6, Math.round(((pt.correlation + 1) / 2) * 100));
                const isPeak = pt.lagSec === metrics.estimatedLagSec;
                const isApplied = pt.lagSec === metrics.appliedLagSec;
                return (
                  <button
                    key={pt.lagSec}
                    type="button"
                    onClick={() => onApplyLagSec && onApplyLagSec(pt.lagSec)}
                    className="flex-1 flex flex-col items-center h-full justify-end group"
                    title={`滞后 τ = ${pt.lagSec}s: R = ${pt.correlation.toFixed(4)} (点击应用)`}
                  >
                    <div
                      style={{ height: `${normH}%` }}
                      className={`w-full rounded-t transition-all ${
                        isPeak
                          ? 'bg-emerald-600'
                          : isApplied
                          ? 'bg-blue-600'
                          : 'bg-slate-400/70 hover:bg-blue-500'
                      }`}
                    />
                    <span className="text-[8.5px] font-mono text-slate-500 mt-1">
                      {pt.lagSec % 5 === 0 ? `${pt.lagSec}s` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded px-3 py-2">
            <span>
              峰值滞后: <strong className="text-emerald-700">τ* = {metrics.estimatedLagSec}s</strong>
            </span>
            <span>
              当前生效偏移: <strong className="text-blue-700">Δt = {metrics.appliedLagSec}s</strong>
            </span>
            {onApplyLagSec && (
              <button
                type="button"
                onClick={() => onApplyLagSec(metrics.estimatedLagSec)}
                className="font-sans px-2.5 py-1 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded whitespace-nowrap shrink-0"
              >
                对齐至峰值滞后 ({metrics.estimatedLagSec}s)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Chart 5 & 6: Segment Metrics Bar Chart + Multi-Loop Small Multiples Overview
 */
export const SegmentBarAndSmallMultiples: React.FC<{
  allPairResults: {
    pair: PairItem;
    metrics: PairComparisonMetrics;
    alignedSeries: AlignedPoint[];
  }[];
  activePairId: string;
  onSelectPair: (pairId: string) => void;
}> = ({ allPairResults, activePairId, onSelectPair }) => {
  const maxRmse = Math.max(5, ...allPairResults.map((r) => r.metrics.rmsePct * 1.2));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Segment / Scenario Bar Chart (5 cols) */}
      <div className="lg:col-span-5 border border-slate-200 bg-white rounded-lg p-4">
        <h4 className="text-sm font-semibold text-slate-900">分段指标条形图 (各场景 RMSE %量程 & 超调量对比)</h4>
        <p className="text-xs text-slate-500 mb-3">
          点击任意场景条形可切换主趋势图检视对应工况窗口
        </p>

        <div className="space-y-3">
          {allPairResults.map(({ pair, metrics }) => {
            const rmseWidth = Math.min(100, (metrics.rmsePct / maxRmse) * 100);
            const tolWidth = Math.min(100, (metrics.toleranceRmsePct / maxRmse) * 100);
            const isSelected = pair.id === activePairId;

            return (
              <button
                key={pair.id}
                type="button"
                onClick={() => onSelectPair(pair.id)}
                className={`w-full text-left p-2.5 rounded border transition-colors ${
                  isSelected
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 text-slate-900 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-medium truncate max-w-[240px]">{pair.name}</span>
                  <span className="font-mono tabular-nums shrink-0">
                    RMSE: <strong>{metrics.rmsePct.toFixed(2)}%</strong> (容差 ≤{metrics.toleranceRmsePct}%)
                  </span>
                </div>

                {/* Progress bar with tolerance marker */}
                <div className="relative h-2.5 bg-slate-200 rounded overflow-hidden">
                  <div
                    style={{ width: `${rmseWidth}%` }}
                    className={`h-full rounded ${
                      metrics.grade === 'PASS'
                        ? 'bg-emerald-500'
                        : metrics.grade === 'WARNING'
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                    }`}
                  />
                  <div
                    style={{ left: `${tolWidth}%` }}
                    className="absolute top-0 bottom-0 w-0.5 bg-slate-950"
                    title={`容差阈值 ${metrics.toleranceRmsePct}%`}
                  />
                </div>

                <div
                  className={`flex items-center justify-between text-[11px] font-mono tabular-nums mt-1.5 ${
                    isSelected ? 'text-slate-300' : 'text-slate-500'
                  }`}
                >
                  <span>
                    超调(仿/实): {metrics.simClosedLoop.overshootPct.toFixed(1)}% /{' '}
                    {metrics.actClosedLoop.overshootPct.toFixed(1)}%
                  </span>
                  <span>r = {metrics.pearsonR.toFixed(3)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Multi-Loop Overview Small Multiples (7 cols) */}
      <div className="lg:col-span-7 border border-slate-200 bg-white rounded-lg p-4">
        <h4 className="text-sm font-semibold text-slate-900">多回路总览 (Small Multiples — 一屏检视全部配对回路)</h4>
        <p className="text-xs text-slate-500 mb-3">
          蓝实线: 仿真 PV · 橙虚线: 实测 PV · 灰虚线: 设定值 SV
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {allPairResults.map(({ pair, metrics, alignedSeries }) => {
            const sample = alignedSeries.length > 80 ? lttbDownsample(alignedSeries, 80) : alignedSeries;
            const w = 260;
            const h = 92;
            const vals = sample.flatMap((p) => [p.simSv, p.simPv, p.actPv]);
            const minV = vals.length ? Math.min(...vals) - 2 : 0;
            const maxV = vals.length ? Math.max(...vals) + 2 : 100;
            const spanV = Math.max(1, maxV - minV);
            const maxT = Math.max(1, sample[sample.length - 1]?.t ?? 1);

            const ptsSim = sample
              .map((p) => `${((p.t / maxT) * w).toFixed(1)},${((1 - (p.simPv - minV) / spanV) * h).toFixed(1)}`)
              .join(' ');
            const ptsAct = sample
              .map((p) => `${((p.t / maxT) * w).toFixed(1)},${((1 - (p.actPv - minV) / spanV) * h).toFixed(1)}`)
              .join(' ');
            const ptsSv = sample
              .map((p) => `${((p.t / maxT) * w).toFixed(1)},${((1 - (p.simSv - minV) / spanV) * h).toFixed(1)}`)
              .join(' ');

            const isSelected = pair.id === activePairId;

            return (
              <button
                key={pair.id}
                type="button"
                onClick={() => onSelectPair(pair.id)}
                className={`text-left p-3 rounded border transition-all ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50/30 ring-1 ring-blue-600'
                    : 'border-slate-200 bg-slate-50/60 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold text-slate-900 truncate">
                    {metrics.actualTag} ↔ {metrics.simTag}
                  </span>
                  <span
                    className={`text-[11px] font-mono font-semibold shrink-0 ${
                      metrics.grade === 'PASS'
                        ? 'text-emerald-600'
                        : metrics.grade === 'WARNING'
                        ? 'text-amber-600'
                        : 'text-rose-600'
                    }`}
                  >
                    {metrics.grade === 'PASS' ? '● 通过' : metrics.grade === 'WARNING' ? '▲ 警告' : '✖ 不合格'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mb-2 flex items-center gap-1.5">
                  <span>{getLoopTypeLabel(metrics.loopType)}</span>
                  <span>·</span>
                  <span className="font-mono">RMSE {metrics.rmsePct.toFixed(2)}%</span>
                  <span>·</span>
                  <span className="font-mono">[{metrics.pvSpan[0]}–{metrics.pvSpan[1]} {metrics.unit}]</span>
                </div>
                <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20 bg-white border border-slate-200 rounded p-1">
                  <polyline fill="none" stroke="#94A3B8" strokeWidth="1" strokeDasharray="2,2" points={ptsSv} />
                  <polyline fill="none" stroke="#2563EB" strokeWidth="1.8" points={ptsSim} />
                  <polyline fill="none" stroke="#D97706" strokeWidth="1.6" strokeDasharray="4,3" points={ptsAct} />
                </svg>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

interface FrequencyAndCascadeProps {
  series: AlignedPoint[];
  metrics: PairComparisonMetrics;
  gridSec: number;
  allPairResults: ComparisonRunResult['pairResults'];
}

export const FrequencyDomainAndCascadeCharts: React.FC<FrequencyAndCascadeProps> = ({
  series,
  metrics,
  gridSec,
  allPairResults,
}) => {
  const psd = useMemo(
    () => computeSpectralPsdAnalysis(series, gridSec, metrics.actClosedLoop.overshootPct),
    [series, gridSec, metrics.actClosedLoop.overshootPct]
  );

  const cascade = useMemo(
    () => computeCascadeCoupledAnalysis(allPairResults),
    [allPairResults]
  );

  // PSD SVG geometry
  const psdW = 480;
  const psdH = 210;
  const pPadL = 44;
  const pPadR = 16;
  const pPadT = 22;
  const pPadB = 34;
  const pPlotW = psdW - pPadL - pPadR;
  const pPlotH = psdH - pPadT - pPadB;

  const maxErrPsd = Math.max(1e-4, ...psd.bins.map((b) => Math.max(b.errPsd, b.actPsd * 0.2)));
  const maxFreq = Math.max(0.05, psd.bins[psd.bins.length - 1]?.freqHz || 0.25);
  const minFreq = psd.bins[0]?.freqHz || 0.004;
  const freqSpan = Math.max(1e-4, maxFreq - minFreq);

  const toPsdX = (f: number) => pPadL + ((f - minFreq) / freqSpan) * pPlotW;
  const toPsdY = (val: number) => pPadT + (1 - Math.min(1, val / maxErrPsd)) * pPlotH;

  const errPsdPoints = psd.bins.map((b) => `${toPsdX(b.freqHz).toFixed(1)},${toPsdY(b.errPsd).toFixed(1)}`).join(' ');
  const errAreaPoints =
    psd.bins.length > 1
      ? `${toPsdX(psd.bins[0].freqHz).toFixed(1)},${(pPadT + pPlotH).toFixed(1)} ${errPsdPoints} ${toPsdX(
          psd.bins[psd.bins.length - 1].freqHz
        ).toFixed(1)},${(pPadT + pPlotH).toFixed(1)}`
      : '';

  const peakX = toPsdX(psd.dominantFreqHz);
  const peakY = toPsdY(psd.dominantPeakPower);

  // Cascade Dual-Layer SVG geometry
  const casSample = useMemo(
    () =>
      cascade.syncedSeries.length > 140
        ? cascade.syncedSeries.filter((_, i) => i % Math.ceil(cascade.syncedSeries.length / 140) === 0)
        : cascade.syncedSeries,
    [cascade.syncedSeries]
  );

  const casW = 480;
  const casH = 225;
  const cPadL = 44;
  const cPadR = 16;
  const topPlotY = 18;
  const topPlotH = 78;
  const botPlotY = 118;
  const botPlotH = 78;
  const cPlotW = casW - cPadL - cPadR;

  const maxCasT = Math.max(1, casSample[casSample.length - 1]?.t || 1);
  const toCasX = (t: number) => cPadL + (t / maxCasT) * cPlotW;

  const tcVals = casSample.flatMap((p) => [p.tcSv, p.tcSimPv, p.tcActPv]);
  const tcMin = tcVals.length ? Math.min(...tcVals) - 1.5 : 50;
  const tcMax = tcVals.length ? Math.max(...tcVals) + 1.5 : 90;
  const tcSpan = Math.max(1, tcMax - tcMin);
  const toTopY = (v: number) => topPlotY + (1 - (v - tcMin) / tcSpan) * topPlotH;

  const fcVals = casSample.flatMap((p) => [p.fcSv, p.fcSimPv, p.fcActPv]);
  const fcMin = fcVals.length ? Math.min(...fcVals) - 4 : 100;
  const fcMax = fcVals.length ? Math.max(...fcVals) + 4 : 240;
  const fcSpan = Math.max(1, fcMax - fcMin);
  const toBotY = (v: number) => botPlotY + (1 - (v - fcMin) / fcSpan) * botPlotH;

  const tcSimLine = casSample.map((p) => `${toCasX(p.t).toFixed(1)},${toTopY(p.tcSimPv).toFixed(1)}`).join(' ');
  const tcActLine = casSample.map((p) => `${toCasX(p.t).toFixed(1)},${toTopY(p.tcActPv).toFixed(1)}`).join(' ');
  const tcSvLine = casSample.map((p) => `${toCasX(p.t).toFixed(1)},${toTopY(p.tcSv).toFixed(1)}`).join(' ');

  const fcSimLine = casSample.map((p) => `${toCasX(p.t).toFixed(1)},${toBotY(p.fcSimPv).toFixed(1)}`).join(' ');
  const fcActLine = casSample.map((p) => `${toCasX(p.t).toFixed(1)},${toBotY(p.fcActPv).toFixed(1)}`).join(' ');
  const fcSvLine = casSample.map((p) => `${toCasX(p.t).toFixed(1)},${toBotY(p.fcSv).toFixed(1)}`).join(' ');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Left Card: Closed-Loop Frequency-Domain PSD & Robustness Analysis */}
      <div className="border border-slate-200 bg-white rounded-lg p-4 space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">
            闭环频域功率谱密度 (PSD / FFT) 与鲁棒稳定裕度分析
          </h4>
          <p className="text-xs text-slate-500">
            识别残差序列主振荡周期 T_osc 与精馏塔/加热炉周期性外部扰动源 ({metrics.actualTag})
          </p>
        </div>

        <svg
          data-testid="psd-spectrum-svg"
          viewBox={`0 0 ${psdW} ${psdH}`}
          className="w-full h-48 bg-slate-50 border border-slate-200 rounded"
        >
          <rect x={pPadL} y={pPadT} width={pPlotW} height={pPlotH} fill="#FFFFFF" stroke="#E2E8F0" />
          {/* Frequency Band Shaded Zones: Low (<0.02Hz), Mid (0.02-0.12Hz), High (>0.12Hz) */}
          <rect
            x={pPadL}
            y={pPadT}
            width={Math.max(0, toPsdX(0.02) - pPadL)}
            height={pPlotH}
            fill="#F1F5F9"
            fillOpacity={0.7}
          />
          <rect
            x={toPsdX(0.02)}
            y={pPadT}
            width={Math.max(0, toPsdX(0.12) - toPsdX(0.02))}
            height={pPlotH}
            fill="#EFF6FF"
            fillOpacity={0.55}
          />

          {errAreaPoints && <polygon points={errAreaPoints} fill="#DBEAFE" fillOpacity={0.65} />}
          {errPsdPoints && <polyline fill="none" stroke="#2563EB" strokeWidth="2" points={errPsdPoints} />}

          {/* Dominant Peak Annotation */}
          {psd.bins.length > 1 && (
            <g>
              <line
                x1={peakX}
                y1={pPadT}
                x2={peakX}
                y2={pPadT + pPlotH}
                stroke="#D97706"
                strokeWidth="1.2"
                strokeDasharray="3,2"
              />
              <circle cx={peakX} cy={peakY} r={4} fill="#D97706" stroke="#FFFFFF" strokeWidth="1.2" />
              <text
                x={Math.min(psdW - 145, peakX + 8)}
                y={Math.max(pPadT + 15, peakY + 4)}
                fontSize="10"
                fontFamily="monospace"
                fontWeight="bold"
                fill="#B45309"
              >
                f_peak={psd.dominantFreqHz.toFixed(3)}Hz (T≈{psd.dominantPeriodSec}s)
              </text>
            </g>
          )}

          {/* Axis Labels above plot box */}
          <text x={pPadL + 2} y={pPadT - 5} fontSize="9.5" fontFamily="monospace" fill="#475569">
            低频漂移(&lt;0.02Hz)
          </text>
          <text x={toPsdX(0.032)} y={pPadT - 5} fontSize="9.5" fontFamily="monospace" fill="#1D4ED8">
            中频控制谐振带 (0.02–0.12Hz)
          </text>
          <text x={toPsdX(0.135)} y={pPadT - 5} fontSize="9.5" fontFamily="monospace" fill="#64748B">
            高频噪声带 (&gt;0.12Hz)
          </text>

          <text x={pPadL} y={psdH - 10} fontSize="10" fontFamily="monospace" fill="#64748B">
            {minFreq.toFixed(3)} Hz
          </text>
          <text x={pPadL + pPlotW / 2} y={psdH - 10} textAnchor="middle" fontSize="10" fontFamily="monospace" fill="#475569">
            频率 f (Hz) · Hann 窗离散傅里叶功率谱密度
          </text>
          <text x={pPadL + pPlotW} y={psdH - 10} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
            {maxFreq.toFixed(2)} Hz
          </text>
        </svg>

        {/* Robustness & Band Energy Strip */}
        <div className="grid grid-cols-4 gap-2 text-center font-mono tabular-nums text-xs">
          <div className="p-2 bg-slate-50 border border-slate-200 rounded">
            <span className="text-[10px] text-slate-400 block">主振荡周期 T_osc</span>
            <span className="font-bold text-amber-700">{psd.dominantPeriodSec}s</span>
          </div>
          <div className="p-2 bg-slate-50 border border-slate-200 rounded">
            <span className="text-[10px] text-slate-400 block">等效幅值/相角裕度</span>
            <span className="font-bold text-slate-900">
              {psd.gainMarginDb}dB / {psd.phaseMarginDeg}°
            </span>
          </div>
          <div className="p-2 bg-slate-50 border border-slate-200 rounded">
            <span className="text-[10px] text-slate-400 block">鲁棒灵敏度峰值 Ms</span>
            <span className="font-bold text-blue-700">{psd.sensitivityPeakMs}</span>
          </div>
          <div className="p-2 bg-slate-50 border border-slate-200 rounded">
            <span className="text-[10px] text-slate-400 block">频段能量 (低/中/高)</span>
            <span className="font-semibold text-slate-800 text-[11px]">
              {psd.lowFreqEnergyPct}/{psd.midFreqEnergyPct}/{psd.highFreqEnergyPct}%
            </span>
          </div>
        </div>

        <p className="text-[11px] text-slate-600 leading-relaxed bg-slate-50 p-2.5 border border-slate-200 rounded">
          <strong className="text-slate-900">频域诊断结论：</strong>
          {psd.diagnosis}
        </p>
      </div>

      {/* Right Card: Cascade Loop (Master TC11003 + Slave FC10901) Coupled Analysis */}
      <div className="border border-slate-200 bg-white rounded-lg p-4 space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">
            串级回路（主调 {cascade.masterTag} → 副调 {cascade.slaveTag}）双层联立耦合分析
          </h4>
          <p className="text-xs text-slate-500">
            同步锁定主环温度与副环流量时间轴，定量剥离「副环跟随滞后」与「主环热容模型失配」
          </p>
        </div>

        <svg
          data-testid="cascade-coupled-svg"
          viewBox={`0 0 ${casW} ${casH}`}
          className="w-full h-48 bg-slate-50 border border-slate-200 rounded"
        >
          {/* Upper Track: Master Loop TC11003 */}
          <text x={cPadL} y={topPlotY - 4} fontSize="10" fontFamily="monospace" fontWeight="bold" fill="#0F172A">
            [主环 Master] {cascade.masterTag} 温度 (°C) · τ1={cascade.tauMasterSec}s
          </text>
          <rect x={cPadL} y={topPlotY} width={cPlotW} height={topPlotH} fill="#FFFFFF" stroke="#E2E8F0" />
          <polyline fill="none" stroke="#94A3B8" strokeWidth="1.2" strokeDasharray="2,2" points={tcSvLine} />
          <polyline fill="none" stroke="#2563EB" strokeWidth="1.8" points={tcSimLine} />
          <polyline fill="none" stroke="#D97706" strokeWidth="1.6" strokeDasharray="5,3" points={tcActLine} />

          {/* Lower Track: Slave Loop FC10901 */}
          <text x={cPadL} y={botPlotY - 4} fontSize="10" fontFamily="monospace" fontWeight="bold" fill="#0F172A">
            [副环 Slave] {cascade.slaveTag} 流量 (m³/h) · τ2={cascade.tauSlaveSec}s · 跨环滞后 Δt={cascade.crossLoopLagSec}s
          </text>
          <rect x={cPadL} y={botPlotY} width={cPlotW} height={botPlotH} fill="#FFFFFF" stroke="#E2E8F0" />
          <polyline fill="none" stroke="#94A3B8" strokeWidth="1.2" strokeDasharray="2,2" points={fcSvLine} />
          <polyline fill="none" stroke="#2563EB" strokeWidth="1.8" points={fcSimLine} />
          <polyline fill="none" stroke="#D97706" strokeWidth="1.6" strokeDasharray="5,3" points={fcActLine} />

          {/* Common Time Axis */}
          <text x={cPadL} y={casH - 8} fontSize="10" fontFamily="monospace" fill="#64748B">
            T+0s
          </text>
          <text x={cPadL + cPlotW / 2} y={casH - 8} textAnchor="middle" fontSize="10" fontFamily="monospace" fill="#475569">
            主副环同步时间轴 (蓝实线: 仿真 | 橙虚线: 实测)
          </text>
          <text x={cPadL + cPlotW} y={casH - 8} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
            T+{maxCasT}s
          </text>
        </svg>

        {/* Cascade Metrics Strip */}
        <div className="grid grid-cols-4 gap-2 text-center font-mono tabular-nums text-xs">
          <div className="p-2 bg-slate-50 border border-slate-200 rounded">
            <span className="text-[10px] text-slate-400 block">时间常数比 R_τ (τ₁/τ₂)</span>
            <span className="font-bold text-slate-900">{cascade.tauRatio} : 1</span>
          </div>
          <div className="p-2 bg-slate-50 border border-slate-200 rounded">
            <span className="text-[10px] text-slate-400 block">主→副跨环滞后</span>
            <span className="font-bold text-blue-700">
              {cascade.crossLoopLagSec}s (r={cascade.crossLoopCorr})
            </span>
          </div>
          <div className="p-2 bg-slate-50 border border-slate-200 rounded">
            <span className="text-[10px] text-slate-400 block">副环流量滞后贡献</span>
            <span className="font-bold text-amber-700">{cascade.slaveLagContributionPct}%</span>
          </div>
          <div className="p-2 bg-slate-50 border border-slate-200 rounded">
            <span className="text-[10px] text-slate-400 block">主环温度模型失配</span>
            <span className="font-bold text-blue-700">{cascade.masterModelContributionPct}%</span>
          </div>
        </div>

        <p className="text-[11px] text-slate-600 leading-relaxed bg-slate-50 p-2.5 border border-slate-200 rounded">
          <strong className="text-slate-900">串级耦合溯源：</strong>
          {cascade.diagnosis}
        </p>
      </div>
    </div>
  );
};

interface MasterSlaveStackedTrendProps {
  resolvedStack: ResolvedMasterSlaveStack;
}

/**
 * Vertically Stacked Synchronized Trend View for Master Loop (TC) & Slave Loop (FC)
 */
export const MasterSlaveStackedTrendChart: React.FC<MasterSlaveStackedTrendProps> = ({
  resolvedStack,
}) => {
  const { masterBundle, slaveBundle, stackedSeries, cascadeAnalysis, isDirectLinked } = resolvedStack;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showSv, setShowSv] = useState(true);
  const [showSimPv, setShowSimPv] = useState(true);
  const [showActPv, setShowActPv] = useState(true);
  const [showMvTrack, setShowMvTrack] = useState(true);
  const [zoomRange, setZoomRange] = useState<[number, number]>([0, 100]);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const slicedStack = useMemo(() => {
    if (stackedSeries.length === 0) return [];
    const sIdx = Math.floor((zoomRange[0] / 100) * (stackedSeries.length - 1));
    const eIdx = Math.max(sIdx + 2, Math.ceil((zoomRange[1] / 100) * stackedSeries.length));
    return stackedSeries.slice(sIdx, eIdx);
  }, [stackedSeries, zoomRange]);

  const width = 880;
  const height = 660;
  const padL = 62;
  const padR = 26;
  const plotW = width - padL - padR;

  const minT = slicedStack[0]?.t ?? 0;
  const maxT = Math.max(minT + 1, slicedStack[slicedStack.length - 1]?.t ?? 100);
  const toX = (t: number) => padL + ((t - minT) / (maxT - minT)) * plotW;

  // Upper Deck (Master Loop TC):
  // Track 1A: Master PV & SV (y: 28 -> 188, h=160)
  // Track 1B: Master MV (%) & Error % (y: 212 -> 288, h=76)
  const mPvVals = slicedStack.flatMap((p) => [p.master.simSv, p.master.simPv, p.master.actPv]);
  const mPvMinRaw = mPvVals.length ? Math.min(...mPvVals) : 50;
  const mPvMaxRaw = mPvVals.length ? Math.max(...mPvVals) : 90;
  const mPvRange = Math.max(5, mPvMaxRaw - mPvMinRaw);
  const mPvMin = mPvMinRaw - mPvRange * 0.1;
  const mPvMax = mPvMaxRaw + mPvRange * 0.2;
  const toMasterPvY = (v: number) => 28 + (1 - (v - mPvMin) / Math.max(1e-3, mPvMax - mPvMin)) * 160;

  const mMvVals = slicedStack.flatMap((p) => [p.master.simMv, p.master.actMv]);
  const mMvMin = Math.max(0, (mMvVals.length ? Math.min(...mMvVals) : 0) - 6);
  const mMvMax = Math.min(105, (mMvVals.length ? Math.max(...mMvVals) : 100) + 10);
  const toMasterMvY = (v: number) => 212 + (1 - (v - mMvMin) / Math.max(1e-3, mMvMax - mMvMin)) * 76;

  // Lower Deck (Slave Loop FC):
  // Track 2A: Slave PV & SV (y: 364 -> 524, h=160)
  // Track 2B: Slave MV (%) & Error % (y: 548 -> 624, h=76)
  const sPvVals = slicedStack.flatMap((p) => [p.slave.simSv, p.slave.simPv, p.slave.actPv]);
  const sPvMinRaw = sPvVals.length ? Math.min(...sPvVals) : 120;
  const sPvMaxRaw = sPvVals.length ? Math.max(...sPvVals) : 240;
  const sPvRange = Math.max(10, sPvMaxRaw - sPvMinRaw);
  const sPvMin = sPvMinRaw - sPvRange * 0.1;
  const sPvMax = sPvMaxRaw + sPvRange * 0.2;
  const toSlavePvY = (v: number) => 364 + (1 - (v - sPvMin) / Math.max(1e-3, sPvMax - sPvMin)) * 160;

  const sMvVals = slicedStack.flatMap((p) => [p.slave.simMv, p.slave.actMv]);
  const sMvMin = Math.max(0, (sMvVals.length ? Math.min(...sMvVals) : 0) - 6);
  const sMvMax = Math.min(105, (sMvVals.length ? Math.max(...sMvVals) : 100) + 10);
  const toSlaveMvY = (v: number) => 548 + (1 - (v - sMvMin) / Math.max(1e-3, sMvMax - sMvMin)) * 76;

  const buildStackLine = (fnY: (pt: typeof slicedStack[number]) => number) =>
    slicedStack.map((pt) => `${toX(pt.t).toFixed(1)},${fnY(pt).toFixed(1)}`).join(' ');

  const hovered =
    hoverIdx !== null && slicedStack[hoverIdx]
      ? slicedStack[hoverIdx]
      : slicedStack[slicedStack.length - 1];

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || slicedStack.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const clampedX = Math.max(padL, Math.min(width - padR, relX));
    const ratio = (clampedX - padL) / plotW;
    const idx = Math.min(
      slicedStack.length - 1,
      Math.max(0, Math.round(ratio * (slicedStack.length - 1)))
    );
    setHoverIdx(idx);
  };

  const handleExportStackedSvg = () => {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cascade_stacked_${masterBundle.pair.actualTag}_${slaveBundle.pair.actualTag}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div
      data-testid="master-slave-stacked-container"
      className="border border-slate-200 bg-white rounded-lg p-4 space-y-3"
    >
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900">
              主副回路垂直叠放同步趋势视图 (Master {masterBundle.pair.actualTag} / Slave {slaveBundle.pair.actualTag})
            </h3>
            <span
              className={`px-2 py-0.5 text-[11px] font-mono font-semibold rounded border ${
                isDirectLinked
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-slate-100 text-slate-700 border-slate-300'
              }`}
            >
              {isDirectLinked ? 'CAS 主从拓扑已关联' : '自定义双环联立'} · R_τ={cascadeAnalysis.tauRatio}:1 · Δt={cascadeAnalysis.crossLoopLagSec}s
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            上层主回路 ({masterBundle.pair.name}) 与下层副回路 ({slaveBundle.pair.name}) 共享公共时间轴与同步十字游标
          </p>
        </div>

        {/* Visibility Toggles & Export */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowSv(!showSv)}
            className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
              showSv
                ? 'bg-slate-100 text-slate-800 border-slate-300'
                : 'bg-white text-slate-400 border-slate-200'
            }`}
          >
            设定值 SV
          </button>
          <button
            type="button"
            onClick={() => setShowSimPv(!showSimPv)}
            className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
              showSimPv
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-white text-slate-400 border-slate-200'
            }`}
          >
            仿真 PV(实)
          </button>
          <button
            type="button"
            onClick={() => setShowActPv(!showActPv)}
            className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
              showActPv
                ? 'bg-amber-50 text-amber-800 border-amber-200'
                : 'bg-white text-slate-400 border-slate-200'
            }`}
          >
            实测 PV(虚)
          </button>
          <button
            type="button"
            onClick={() => setShowMvTrack(!showMvTrack)}
            className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
              showMvTrack
                ? 'bg-cyan-50 text-cyan-800 border-cyan-200'
                : 'bg-white text-slate-400 border-slate-200'
            }`}
          >
            主/副阀位 MV 轨
          </button>
          <button
            type="button"
            onClick={handleExportStackedSvg}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50"
          >
            <Download className="w-3.5 h-3.5" />
            叠放 SVG
          </button>
        </div>
      </div>

      {/* Synchronized Master-Slave Dual-Row Crosshair Readout Bar */}
      {hovered && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono tabular-nums">
          <div className="lg:col-span-2 flex flex-col justify-center border-b lg:border-b-0 lg:border-r border-slate-200 pb-1.5 lg:pb-0 lg:pr-2">
            <span className="text-[10px] text-slate-400">同步采样时刻</span>
            <span className="font-bold text-slate-900">T+{hovered.t}s</span>
            <span className="text-[10px] text-slate-500 truncate">{hovered.timestampLabel}</span>
          </div>

          {/* Master Loop Readout */}
          <div className="lg:col-span-5 grid grid-cols-3 gap-2 border-b lg:border-b-0 lg:border-r border-slate-200 pb-1.5 lg:pb-0 lg:pr-2">
            <div>
              <span className="text-[10px] text-slate-400 block">
                [主环] {masterBundle.pair.actualTag} PV(仿/实)
              </span>
              <span className="text-blue-700 font-semibold">{hovered.master.simPv.toFixed(2)}</span>
              {' / '}
              <span className="text-amber-700 font-semibold">{hovered.master.actPv.toFixed(2)}</span>{' '}
              {masterBundle.pair.unit}
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block">[主环] SV / 主调MV</span>
              <span className="text-slate-800">
                {hovered.master.actSv.toFixed(1)} / {hovered.master.actMv.toFixed(1)}%
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block">[主环] 瞬时误差</span>
              <span
                className={`font-semibold ${
                  hovered.master.inTolerance ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {hovered.master.errorPvPct >= 0 ? '+' : ''}
                {hovered.master.errorPvPct.toFixed(2)}%
              </span>
            </div>
          </div>

          {/* Slave Loop Readout */}
          <div className="lg:col-span-5 grid grid-cols-3 gap-2">
            <div>
              <span className="text-[10px] text-slate-400 block">
                [副环] {slaveBundle.pair.actualTag} PV(仿/实)
              </span>
              <span className="text-blue-700 font-semibold">{hovered.slave.simPv.toFixed(2)}</span>
              {' / '}
              <span className="text-amber-700 font-semibold">{hovered.slave.actPv.toFixed(2)}</span>{' '}
              {slaveBundle.pair.unit}
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block">[副环] 外给定SV / 阀位MV</span>
              <span className="text-slate-800">
                {hovered.slave.actSv.toFixed(1)} / {hovered.slave.actMv.toFixed(1)}%
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block">[副环] 瞬时误差</span>
              <span
                className={`font-semibold ${
                  hovered.slave.inTolerance ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {hovered.slave.errorPvPct >= 0 ? '+' : ''}
                {hovered.slave.errorPvPct.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Vertically Stacked Synchronized SVG Canvas */}
      <div className="relative overflow-x-auto">
        <svg
          ref={svgRef}
          data-testid="master-slave-stacked-svg"
          viewBox={`0 0 ${width} ${height}`}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
          className="w-full h-auto select-none cursor-crosshair bg-slate-50/40 border border-slate-200 rounded"
        >
          {/* ================= UPPER DECK: MASTER LOOP (TC) ================= */}
          <text x={padL} y={18} fontSize="11" fontWeight="bold" fill="#0F172A">
            [上层 · 主回路 Master Loop] {masterBundle.pair.actualTag} ↔ {masterBundle.pair.simTag} ({masterBundle.pair.unit}) — 归一化 RMSE={masterBundle.metrics.rmsePct.toFixed(2)}% · τ1={cascadeAnalysis.tauMasterSec}s
          </text>

          {/* Track 1A: Master PV & SV */}
          <rect x={padL} y={28} width={plotW} height={160} fill="#FFFFFF" stroke="#CBD5E1" />
          {[0.25, 0.5, 0.75].map((r) => (
            <line
              key={`m-grid-${r}`}
              x1={padL}
              y1={28 + r * 160}
              x2={width - padR}
              y2={28 + r * 160}
              stroke="#F1F5F9"
              strokeWidth="1"
            />
          ))}
          <text x={padL - 6} y={38} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
            {mPvMax.toFixed(1)}
          </text>
          <text x={padL - 6} y={108} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
            {((mPvMax + mPvMin) / 2).toFixed(1)}
          </text>
          <text x={padL - 6} y={184} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
            {mPvMin.toFixed(1)}
          </text>

          {showSv && (
            <polyline
              fill="none"
              stroke="#64748B"
              strokeWidth="1.4"
              strokeDasharray="3,3"
              points={buildStackLine((pt) => toMasterPvY(pt.master.simSv))}
            />
          )}
          {showSimPv && (
            <polyline
              fill="none"
              stroke="#2563EB"
              strokeWidth="2.2"
              points={buildStackLine((pt) => toMasterPvY(pt.master.simPv))}
            />
          )}
          {showActPv && (
            <polyline
              fill="none"
              stroke="#D97706"
              strokeWidth="2"
              strokeDasharray="6,3"
              points={buildStackLine((pt) => toMasterPvY(pt.master.actPv))}
            />
          )}
          <text x={padL + 8} y={44} fontSize="10" fontWeight="bold" fill="#334155">
            [1A] 主调温度 PV & 设定值 SV ({masterBundle.pair.unit}) — 蓝实线: 仿真 | 橙虚线: 实测 | 灰点线: SV
          </text>

          {/* Track 1B: Master MV (%) */}
          {showMvTrack && (
            <g>
              <rect x={padL} y={212} width={plotW} height={76} fill="#FFFFFF" stroke="#CBD5E1" />
              <line
                x1={padL}
                y1={212 + 38}
                x2={width - padR}
                y2={212 + 38}
                stroke="#F1F5F9"
                strokeWidth="1"
              />
              <text x={padL - 6} y={222} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
                {mMvMax.toFixed(0)}%
              </text>
              <text x={padL - 6} y={284} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
                {mMvMin.toFixed(0)}%
              </text>
              <polyline
                fill="none"
                stroke="#0284C7"
                strokeWidth="1.8"
                points={buildStackLine((pt) => toMasterMvY(pt.master.simMv))}
              />
              <polyline
                fill="none"
                stroke="#EA580C"
                strokeWidth="1.6"
                strokeDasharray="5,3"
                points={buildStackLine((pt) => toMasterMvY(pt.master.actMv))}
              />
              <text x={padL + 8} y={226} fontSize="10" fontWeight="bold" fill="#334155">
                [1B] 主回路控制输出 {masterBundle.pair.actualTag}.MV (%) — 作为副回路外给定信号源
              </text>
            </g>
          )}

          {/* ================= CASCADE COUPLING SIGNAL BUS ================= */}
          <rect
            x={padL}
            y={304}
            width={plotW}
            height={32}
            rx={4}
            fill="#EFF6FF"
            stroke="#BFDBFE"
          />
          <text
            x={padL + plotW / 2}
            y={324}
            textAnchor="middle"
            fontSize="10.5"
            fontFamily="monospace"
            fontWeight="bold"
            fill="#1D4ED8"
          >
            ▼ 串级耦合信号传递：主调 {masterBundle.pair.actualTag}.MV ──[跨环传递滞后 Δt={cascadeAnalysis.crossLoopLagSec}s · 互相关 r={cascadeAnalysis.crossLoopCorr} · 副环滞后贡献 {cascadeAnalysis.slaveLagContributionPct}%]──▶ 副调 {slaveBundle.pair.actualTag}.SV ▼
          </text>

          {/* ================= LOWER DECK: SLAVE LOOP (FC) ================= */}
          <text x={padL} y={355} fontSize="11" fontWeight="bold" fill="#0F172A">
            [下层 · 副回路 Slave Loop] {slaveBundle.pair.actualTag} ↔ {slaveBundle.pair.simTag} ({slaveBundle.pair.unit}) — 归一化 RMSE={slaveBundle.metrics.rmsePct.toFixed(2)}% · τ2={cascadeAnalysis.tauSlaveSec}s
          </text>

          {/* Track 2A: Slave PV & SV */}
          <rect x={padL} y={364} width={plotW} height={160} fill="#FFFFFF" stroke="#CBD5E1" />
          {[0.25, 0.5, 0.75].map((r) => (
            <line
              key={`s-grid-${r}`}
              x1={padL}
              y1={364 + r * 160}
              x2={width - padR}
              y2={364 + r * 160}
              stroke="#F1F5F9"
              strokeWidth="1"
            />
          ))}
          <text x={padL - 6} y={374} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
            {sPvMax.toFixed(1)}
          </text>
          <text x={padL - 6} y={444} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
            {((sPvMax + sPvMin) / 2).toFixed(1)}
          </text>
          <text x={padL - 6} y={520} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
            {sPvMin.toFixed(1)}
          </text>

          {showSv && (
            <polyline
              fill="none"
              stroke="#64748B"
              strokeWidth="1.4"
              strokeDasharray="3,3"
              points={buildStackLine((pt) => toSlavePvY(pt.slave.simSv))}
            />
          )}
          {showSimPv && (
            <polyline
              fill="none"
              stroke="#2563EB"
              strokeWidth="2.2"
              points={buildStackLine((pt) => toSlavePvY(pt.slave.simPv))}
            />
          )}
          {showActPv && (
            <polyline
              fill="none"
              stroke="#D97706"
              strokeWidth="2"
              strokeDasharray="6,3"
              points={buildStackLine((pt) => toSlavePvY(pt.slave.actPv))}
            />
          )}
          <text x={padL + 8} y={380} fontSize="10" fontWeight="bold" fill="#334155">
            [2A] 副调流量 PV & 外给定 SV ({slaveBundle.pair.unit}) — 蓝实线: 仿真 | 橙虚线: 实测 | 灰点线: SV
          </text>

          {/* Track 2B: Slave MV (%) */}
          {showMvTrack && (
            <g>
              <rect x={padL} y={548} width={plotW} height={76} fill="#FFFFFF" stroke="#CBD5E1" />
              <line
                x1={padL}
                y1={548 + 38}
                x2={width - padR}
                y2={548 + 38}
                stroke="#F1F5F9"
                strokeWidth="1"
              />
              <text x={padL - 6} y={558} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
                {sMvMax.toFixed(0)}%
              </text>
              <text x={padL - 6} y={620} textAnchor="end" fontSize="10" fontFamily="monospace" fill="#64748B">
                {sMvMin.toFixed(0)}%
              </text>
              <polyline
                fill="none"
                stroke="#0284C7"
                strokeWidth="1.8"
                points={buildStackLine((pt) => toSlaveMvY(pt.slave.simMv))}
              />
              <polyline
                fill="none"
                stroke="#EA580C"
                strokeWidth="1.6"
                strokeDasharray="5,3"
                points={buildStackLine((pt) => toSlaveMvY(pt.slave.actMv))}
              />
              <text x={padL + 8} y={562} fontSize="10" fontWeight="bold" fill="#334155">
                [2B] 副回路调节阀位输出 {slaveBundle.pair.actualTag}.MV (%) — 实线: 仿真阀位 | 虚线: 实测阀位
              </text>
            </g>
          )}

          {/* Shared Bottom Time Axis */}
          {[0, 0.25, 0.5, 0.75, 1].map((r) => {
            const tVal = Math.round(minT + r * (maxT - minT));
            const xPos = padL + r * plotW;
            return (
              <text
                key={`t-tick-${r}`}
                x={xPos}
                y={height - 10}
                textAnchor={r === 0 ? 'start' : r === 1 ? 'end' : 'middle'}
                fontSize="10"
                fontFamily="monospace"
                fill="#475569"
              >
                T+{tVal}s
              </text>
            );
          })}

          {/* Continuous Synchronized Vertical Crosshair Across Both Stacked Loops */}
          {hovered && (
            <g>
              <line
                x1={toX(hovered.t)}
                y1={28}
                x2={toX(hovered.t)}
                y2={624}
                stroke="#0F172A"
                strokeWidth="1.2"
                strokeDasharray="3,3"
              />
              {/* Master Dots */}
              {showSimPv && (
                <circle
                  cx={toX(hovered.t)}
                  cy={toMasterPvY(hovered.master.simPv)}
                  r={4}
                  fill="#2563EB"
                  stroke="#FFFFFF"
                  strokeWidth="1.5"
                />
              )}
              {showActPv && (
                <circle
                  cx={toX(hovered.t)}
                  cy={toMasterPvY(hovered.master.actPv)}
                  r={4}
                  fill="#D97706"
                  stroke="#FFFFFF"
                  strokeWidth="1.5"
                />
              )}
              {/* Slave Dots */}
              {showSimPv && (
                <circle
                  cx={toX(hovered.t)}
                  cy={toSlavePvY(hovered.slave.simPv)}
                  r={4}
                  fill="#2563EB"
                  stroke="#FFFFFF"
                  strokeWidth="1.5"
                />
              )}
              {showActPv && (
                <circle
                  cx={toX(hovered.t)}
                  cy={toSlavePvY(hovered.slave.actPv)}
                  r={4}
                  fill="#D97706"
                  stroke="#FFFFFF"
                  strokeWidth="1.5"
                />
              )}
            </g>
          )}
        </svg>
      </div>

      {/* Synchronized Time Window Zoom & Quick Presets */}
      <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-600">主副环同步时间窗缩放：</span>
          <button
            type="button"
            onClick={() => setZoomRange([0, 100])}
            className={`px-2 py-1 rounded border font-mono ${
              zoomRange[0] === 0 && zoomRange[1] === 100
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            全窗口 (T+0~{stackedSeries[stackedSeries.length - 1]?.t ?? 399}s)
          </button>
          <button
            type="button"
            onClick={() => setZoomRange([0, 45])}
            className={`px-2 py-1 rounded border font-mono ${
              zoomRange[0] === 0 && zoomRange[1] === 45
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            聚焦阶跃耦合瞬态段 (0%–45%)
          </button>
          <button
            type="button"
            onClick={() => setZoomRange([45, 100])}
            className={`px-2 py-1 rounded border font-mono ${
              zoomRange[0] === 45 && zoomRange[1] === 100
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            聚焦稳态保持段 (45%–100%)
          </button>
        </div>

        <div className="flex items-center gap-2 font-mono text-slate-600">
          <span>起点 {zoomRange[0]}%</span>
          <input
            type="range"
            min={0}
            max={80}
            step={5}
            value={zoomRange[0]}
            onChange={(e) => {
              const v = Number(e.target.value);
              setZoomRange([v, Math.max(v + 20, zoomRange[1])]);
            }}
            aria-label="主副环同步窗口起点百分比"
            className="w-24 accent-blue-600"
          />
          <span>终点 {zoomRange[1]}%</span>
          <input
            type="range"
            min={20}
            max={100}
            step={5}
            value={zoomRange[1]}
            onChange={(e) => {
              const v = Number(e.target.value);
              setZoomRange([Math.min(zoomRange[0], v - 20), v]);
            }}
            aria-label="主副环同步窗口终点百分比"
            className="w-24 accent-blue-600"
          />
        </div>
      </div>
    </div>
  );
};


