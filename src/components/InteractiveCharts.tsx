import React, { useMemo, useRef, useState } from 'react';
import { Download, Maximize2, RotateCcw, Sliders } from 'lucide-react';
import {
  computeCrossCorrelationCurve,
  computeValveHysteresisMetrics,
  getLoopTypeLabel,
  lttbDownsample,
} from '../core/engine';
import {
  AlignedPoint,
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
