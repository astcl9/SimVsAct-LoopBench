import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  Upload,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  detectEncodingAndDecode,
  getLoopTypeLabel,
  parseCsvTextToDataset,
  parsePouTableRows,
} from '../core/engine';
import { triggerFileDownload } from '../core/reportGenerator';
import {
  generateSampleActualCsvText,
  generateSamplePouRows,
  generateSampleSimCsvText,
} from '../core/sampleData';
import { DatasetParsed, POUDictionary } from '../core/types';

interface UploadPageProps {
  actualDataset: DatasetParsed;
  simDataset: DatasetParsed;
  pouDictionary: POUDictionary | null;
  reconstruct1Hz: boolean;
  onToggleReconstruct1Hz: (enabled: boolean) => void;
  onUpdateActualDataset: (ds: DatasetParsed) => void;
  onUpdateSimDataset: (ds: DatasetParsed) => void;
  onUpdatePouDictionary: (pou: POUDictionary | null) => void;
  onResetSampleBundle: () => void;
  onProceedToMapping: () => void;
}

export const UploadPage: React.FC<UploadPageProps> = ({
  actualDataset,
  simDataset,
  pouDictionary,
  reconstruct1Hz,
  onToggleReconstruct1Hz,
  onUpdateActualDataset,
  onUpdateSimDataset,
  onUpdatePouDictionary,
  onResetSampleBundle,
  onProceedToMapping,
}) => {
  const [activePreviewTab, setActivePreviewTab] = useState<'actual' | 'sim' | 'pou'>('actual');
  const [uploadStatusMsg, setUploadStatusMsg] = useState<string | null>(null);

  const actInputRef = useRef<HTMLInputElement | null>(null);
  const simInputRef = useRef<HTMLInputElement | null>(null);
  const pouInputRef = useRef<HTMLInputElement | null>(null);

  const handleCsvFileUpload = async (file: File, role: 'actual' | 'sim') => {
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const decoded = detectEncodingAndDecode(bytes);
      const parsed = parseCsvTextToDataset(
        decoded.text,
        file.name,
        role,
        {
          encoding: decoded.encoding,
          score: decoded.score,
          chineseHeaderRatio: decoded.chineseHeaderRatio,
        },
        reconstruct1Hz
      );
      if (role === 'actual') {
        onUpdateActualDataset(parsed);
      } else {
        onUpdateSimDataset(parsed);
      }
      setUploadStatusMsg(
        `已成功导入并识别 ${file.name}：编码 ${parsed.encoding}，形态 ${
          parsed.tableFormat === 'wide' ? '宽表' : '长表'
        }，共 ${parsed.totalRows} 行 × ${parsed.totalCols} 列`
      );
    } catch (err) {
      setUploadStatusMsg(`文件解析失败: ${(err as Error).message}`);
    }
  };

  const handlePouFileUpload = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0] || 'PID';
      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<(string | number)[]>(worksheet, { header: 1 });
      const parsedPou = parsePouTableRows(rows, file.name, firstSheetName);
      onUpdatePouDictionary(parsedPou);
      setUploadStatusMsg(
        `已成功解析组态字典 ${file.name} (Sheet: ${firstSheetName})：表头去重后 ${parsedPou.dedupedColumns} 列，匹配到 ${parsedPou.totalLoops} 个回路`
      );
    } catch (err) {
      setUploadStatusMsg(`组态字典解析失败: ${(err as Error).message}`);
    }
  };

  const handleDownloadSampleFile = (which: 'actual' | 'sim' | 'pou') => {
    if (which === 'actual') {
      const csv = generateSampleActualCsvText();
      triggerFileDownload('history_FC10901andTC11003_sec.csv', csv, 'text/csv;charset=utf-8');
    } else if (which === 'sim') {
      const csv = '\uFEFF' + generateSampleSimCsvText();
      triggerFileDownload('三类整定切片规则模拟结果.csv', csv, 'text/csv;charset=utf-8');
    } else {
      const rows = generateSamplePouRows();
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'PID');
      XLSX.writeFile(wb, 'normalized_pou_import.xlsx');
    }
  };

  const inspectedDataset = activePreviewTab === 'actual' ? actualDataset : simDataset;

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white border border-slate-200 rounded-lg p-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900 text-balance">
            01. 多源数据导入与编码/形态/时钟自动识别
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            支持宽表（<code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">TAG.PV/MV/SV</code>）与长表（
            <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">loop_tag</code> 行）混用，自动探测
            GBK / UTF-8-BOM 编码、修复分钟级重复时间戳、切分跨天断档，并关联 DCS/PLC 组态字典。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              onResetSampleBundle();
              setUploadStatusMsg('已重新加载全套 v0.2 标准工业样例数据集（实测 757行 + 仿真 7200行 + POU 18回路）');
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            重置内置样例数据
          </button>
          <button
            type="button"
            onClick={onProceedToMapping}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            下一步：信号与量程配置
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {uploadStatusMsg && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 text-white text-xs rounded-lg">
          <span>{uploadStatusMsg}</span>
          <button
            type="button"
            onClick={() => setUploadStatusMsg(null)}
            className="text-slate-300 hover:text-white ml-4 whitespace-nowrap"
          >
            关闭
          </button>
        </div>
      )}

      {/* 3 Upload & Recognition Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Card 1: Actual CSV */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-amber-600 shrink-0" />
                <h2 className="text-sm font-bold text-slate-900">实测历史数据 (Actual CSV)</h2>
              </div>
              <span className="text-xs font-mono text-emerald-700 font-semibold">● 已识别</span>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1.5 text-xs">
              <div className="font-mono font-semibold text-slate-900 truncate" title={actualDataset.filename}>
                {actualDataset.filename}
              </div>
              <div className="text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono tabular-nums">
                <span>编码: {actualDataset.encoding}</span>
                <span>·</span>
                <span>形态: {actualDataset.tableFormat === 'wide' ? '宽表 (TAG.SIG)' : '长表'}</span>
                <span>·</span>
                <span>
                  {actualDataset.totalRows} 行 × {actualDataset.totalCols} 列
                </span>
              </div>
              <div className="text-slate-500 font-mono text-[11px] tabular-nums">
                时间: {actualDataset.timeStart} → {actualDataset.timeEnd}
              </div>
              <div className="text-slate-700 pt-1">
                提取回路 ({actualDataset.detectedTags.length}):{' '}
                <span className="font-mono font-semibold">{actualDataset.detectedTags.join(' · ')}</span>
              </div>
            </div>

            {/* Two Hidden Pitfalls Detection & Remediation */}
            <div className="mt-3 space-y-2">
              {actualDataset.hasDuplicateTimestamps && (
                <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-amber-900 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                      检测到时间戳精度不足 (4行/分钟)
                    </span>
                    <span className="font-mono text-[11px] text-amber-800">
                      唯一值 {actualDataset.uniqueTimestampCount} &lt; {actualDataset.totalRows} 行
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-800 mt-1">
                    直接按时间戳对齐会把同分钟 4 个采样压成 1 点。已启用按 <code className="font-mono">序号</code>{' '}
                    列重建 1 Hz 采样时钟。
                  </p>
                  <label className="mt-2 inline-flex items-center gap-2 cursor-pointer select-none font-medium text-slate-900">
                    <input
                      type="checkbox"
                      checked={reconstruct1Hz}
                      onChange={(e) => onToggleReconstruct1Hz(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>按序号列重建 1 Hz 唯一采样时钟</span>
                  </label>
                </div>
              )}

              {actualDataset.gapsCount > 0 && (
                <div className="p-2.5 bg-slate-100 border border-slate-200 rounded text-xs">
                  <div className="flex items-center justify-between font-semibold text-slate-800">
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      检测到中间断档 ({actualDataset.gapsCount} 处 · 约{' '}
                      {(actualDataset.maxGapSeconds / 86400).toFixed(1)} 天缺口)
                    </span>
                    <span className="font-mono text-[11px]">{actualDataset.segments.length} 个连续段</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">
                    已自动切分为连续段（段#1: 400行 · 段#2: 357行），禁止跨断档插值造假，指标仅在实际连续有效段内计算。
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between gap-2">
            <input
              ref={actInputRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleCsvFileUpload(f, 'actual');
              }}
            />
            <button
              type="button"
              onClick={() => actInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              上传实测 CSV
            </button>
            <button
              type="button"
              onClick={() => handleDownloadSampleFile('actual')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              下载样例 CSV
            </button>
          </div>
        </div>

        {/* Card 2: Simulation CSV */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                <h2 className="text-sm font-bold text-slate-900">仿真结果数据 (Simulation CSV)</h2>
              </div>
              <span className="text-xs font-mono text-emerald-700 font-semibold">● 已识别</span>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1.5 text-xs">
              <div className="font-mono font-semibold text-slate-900 truncate" title={simDataset.filename}>
                {simDataset.filename}
              </div>
              <div className="text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono tabular-nums">
                <span>编码: {simDataset.encoding}</span>
                <span>·</span>
                <span>形态: {simDataset.tableFormat === 'long' ? '长表 (loop_tag 行)' : '宽表'}</span>
                <span>·</span>
                <span>
                  {simDataset.totalRows} 行 × {simDataset.totalCols} 列
                </span>
              </div>
              <div className="text-slate-500 font-mono text-[11px] tabular-nums">
                时间: 2026-08-20 08:00:00 → 10:39:59 (1 s 采样)
              </div>
              <div className="text-slate-700 pt-1">
                透视场景标签 ({simDataset.detectedTags.length}):{' '}
                <span className="font-mono font-semibold">{simDataset.detectedTags.join(' · ')}</span>
              </div>
            </div>

            <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded text-xs space-y-1.5">
              <div className="font-semibold text-slate-800">长表自动透视与附加切片信息</div>
              <p className="text-[11px] text-slate-600">
                识别到 <code className="font-mono">loop_tag</code> + <code className="font-mono">SV/PV/MV/MODE</code> +{' '}
                <code className="font-mono">模拟场景</code> + <code className="font-mono">判定切片类型</code>，已自动拆分为三类标准整定场景：
              </p>
              <div className="text-[11px] font-mono text-slate-700 space-y-0.5 pt-1">
                <div>1. SIM_FIC_OPEN · 开环 MV 阶跃测试 (1800 s)</div>
                <div>2. SIM_FIC_CLOSED · 闭环设定值阶跃 (1800 s)</div>
                <div>3. SIM_FIC_NATURAL · 闭环自然负荷扰动 (1800 s)</div>
                <div>4. SIM_TIC_CLOSED · 温度闭环阶跃响应 (1800 s)</div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between gap-2">
            <input
              ref={simInputRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleCsvFileUpload(f, 'sim');
              }}
            />
            <button
              type="button"
              onClick={() => simInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              上传仿真 CSV
            </button>
            <button
              type="button"
              onClick={() => handleDownloadSampleFile('sim')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              下载样例 CSV
            </button>
          </div>
        </div>

        {/* Card 3: POU Configuration Dictionary XLSX */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                <h2 className="text-sm font-bold text-slate-900">组态字典 (POU Config XLSX)</h2>
              </div>
              <span className="text-xs font-mono text-emerald-700 font-semibold">
                {pouDictionary ? '● 已联动 (18回路)' : '○ 可选'}
              </span>
            </div>

            {pouDictionary ? (
              <>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1.5 text-xs">
                  <div className="font-mono font-semibold text-slate-900 truncate">{pouDictionary.filename}</div>
                  <div className="text-slate-600 font-mono tabular-nums">
                    Sheet: {pouDictionary.sheetName} · 21 行 (第1行表头, 跳过第2–3行注释)
                  </div>
                  <div className="text-slate-600 font-mono text-[11px] tabular-nums">
                    重复列去重: {pouDictionary.rawTotalColumns} 列 → {pouDictionary.dedupedColumns} 唯一表头 (按首次出现)
                  </div>
                  <div className="text-slate-800 font-medium pt-1">
                    共解析 {pouDictionary.totalLoops} 个回路：流量 {pouDictionary.loopCountByType.flow} · 液位{' '}
                    {pouDictionary.loopCountByType.level} · 压力 {pouDictionary.loopCountByType.pressure} · 温度{' '}
                    {pouDictionary.loopCountByType.temperature} · 组分 {pouDictionary.loopCountByType.composition}
                  </div>
                </div>

                <div className="mt-3 p-3 bg-emerald-50/50 border border-emerald-200 rounded text-xs space-y-1.5">
                  <div className="font-semibold text-emerald-950 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    自动命中趋势 CSV 位号并带出量程与 PID 参数
                  </div>
                  <div className="font-mono text-[11px] text-slate-700 space-y-1 tabular-nums">
                    <div>
                      · <strong>FC10901</strong> → 流量回路 | PV/SV 量程 [0, 300] m³/h | MV [0, 100]% | PB=82, TI=18s
                    </div>
                    <div>
                      · <strong>TC11003</strong> → 温度回路 | PV/SV 量程 [0, 100] °C | MV [0, 100]% | PB=45, TI=65s,
                      TD=12s (微分先行)
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded text-xs text-slate-500">
                暂未加载组态字典。将退化为按列名猜测回路类型，并使用数据 min–max 归一化。
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between gap-2">
            <input
              ref={pouInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handlePouFileUpload(f);
              }}
            />
            <button
              type="button"
              onClick={() => pouInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              上传 POU 字典 (.xlsx)
            </button>
            <button
              type="button"
              onClick={() => handleDownloadSampleFile('pou')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              下载样例 XLSX
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Data Inspector: Preview 20 Rows, Column Profiles & Sampling Histogram */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 mb-4 border-b border-slate-200">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              数据预览、列结构诊断与采样间隔直方图
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              展示前 20 行原始数据、字段可转率/缺失率以及原始时间戳采样间隔分布
            </p>
          </div>

          {/* Interactive Dataset Selector Tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setActivePreviewTab('actual')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activePreviewTab === 'actual'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              实测历史 ({actualDataset.filename})
            </button>
            <button
              type="button"
              onClick={() => setActivePreviewTab('sim')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activePreviewTab === 'sim'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              仿真结果 ({simDataset.filename})
            </button>
            <button
              type="button"
              onClick={() => setActivePreviewTab('pou')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activePreviewTab === 'pou'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              POU 组态字典 (18 回路表)
            </button>
          </div>
        </div>

        {activePreviewTab === 'pou' && pouDictionary ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2.5 px-3">位号名 (TAG)</th>
                  <th className="py-2.5 px-3">回路描述</th>
                  <th className="py-2.5 px-3">回路类型</th>
                  <th className="py-2.5 px-3 text-right">量程 [SVL, SVH]</th>
                  <th className="py-2.5 px-3 text-right">PB (%)</th>
                  <th className="py-2.5 px-3 text-right">TI (s)</th>
                  <th className="py-2.5 px-3 text-right">TD (s)</th>
                  <th className="py-2.5 px-3">作用方向 / 算法</th>
                  <th className="py-2.5 px-3 text-right">报警限 (HH/H/L/LL)</th>
                  <th className="py-2.5 px-3">趋势 CSV 命中</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                {Object.values(pouDictionary.loops).map((loop) => {
                  const matchedInCsv = actualDataset.detectedTags.includes(loop.tag);
                  return (
                    <tr
                      key={loop.tag}
                      className={matchedInCsv ? 'bg-blue-50/40 hover:bg-blue-50/70' : 'hover:bg-slate-50'}
                    >
                      <td className="py-2 px-3 font-bold text-slate-900">{loop.tag}</td>
                      <td className="py-2 px-3 font-sans text-slate-700">{loop.description}</td>
                      <td className="py-2 px-3 font-sans text-slate-700">{getLoopTypeLabel(loop.loopType)}</td>
                      <td className="py-2 px-3 text-right">
                        [{loop.svl}, {loop.svh}] {loop.unit}
                      </td>
                      <td className="py-2 px-3 text-right">{loop.pb.toFixed(1)}</td>
                      <td className="py-2 px-3 text-right">{loop.ti.toFixed(1)}</td>
                      <td className="py-2 px-3 text-right">{loop.td.toFixed(1)}</td>
                      <td className="py-2 px-3 font-sans text-slate-600">
                        {loop.swpn} · {loop.pidOpt}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-500">
                        {loop.pvhh}/{loop.pvh}/{loop.pvl}/{loop.pvll}
                      </td>
                      <td className="py-2 px-3 font-sans">
                        {matchedInCsv ? (
                          <span className="text-emerald-700 font-semibold">● 已关联趋势列</span>
                        ) : (
                          <span className="text-slate-400">字典备用</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Sampling Interval Histogram & Column Summary */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-5 p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                <h4 className="text-xs font-bold text-slate-800 mb-2">
                  原始时间戳采样间隔直方图 ({inspectedDataset.filename})
                </h4>
                <div className="space-y-2">
                  {inspectedDataset.samplingIntervalHistogram.map((item, idx) => (
                    <div key={idx} className="text-xs">
                      <div className="flex justify-between font-mono tabular-nums text-slate-700 mb-1">
                        <span>{item.intervalLabel}</span>
                        <span>
                          {item.count} 行 ({item.percentage}%)
                        </span>
                      </div>
                      <div className="h-2 bg-slate-200 rounded overflow-hidden">
                        <div
                          style={{ width: `${Math.max(4, item.percentage)}%` }}
                          className="h-full bg-blue-600 rounded"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-7 p-3.5 bg-slate-50 border border-slate-200 rounded-lg overflow-x-auto">
                <h4 className="text-xs font-bold text-slate-800 mb-2">
                  字段类型探测与缺失率校验 (共 {inspectedDataset.columns.length} 列)
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono tabular-nums">
                  {inspectedDataset.columns.slice(0, 8).map((col) => (
                    <div key={col.name} className="p-2 bg-white border border-slate-200 rounded">
                      <div className="font-semibold text-slate-900 truncate" title={col.name}>
                        {col.name}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        类型: {col.inferredType} · 缺失 {(col.missingRate * 100).toFixed(1)}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* First 10 Rows Preview Table */}
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-mono">
                    {inspectedDataset.columns.map((c) => (
                      <th key={c.name} className="py-2 px-3 whitespace-nowrap">
                        {c.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                  {inspectedDataset.previewRows.slice(0, 10).map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-slate-50">
                      {inspectedDataset.columns.map((c) => (
                        <td key={c.name} className="py-1.5 px-3 whitespace-nowrap text-slate-700">
                          {String(row[c.name] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
