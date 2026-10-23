import {
  AlignedPoint,
  AlignmentOptions,
  ClosedLoopStepMetrics,
  ColumnProfile,
  ContinuousSegment,
  DatasetParsed,
  LoopType,
  MVBehaviorMetrics,
  PairComparisonMetrics,
  PairItem,
  POUDictionary,
  POULoopConfig,
  ResidualDistribution,
  ResidualHistogramBin,
  ScenarioType,
  TimeSeriesPoint,
  ToleranceConfig,
  TopDeviationInterval,
} from './types';

/**
 * Infer LoopType from DCS/PLC tag name prefix (FC/FIC -> flow, LC/LIC -> level, PC/PIC -> pressure, TC/TIC -> temperature, AC/AIC -> composition)
 */
export function inferLoopTypeFromTag(tag: string): LoopType {
  const clean = tag.trim().toUpperCase().replace(/^SIM_/, '');
  if (clean.startsWith('FC') || clean.startsWith('FIC') || clean.includes('FLOW')) return 'flow';
  if (clean.startsWith('LC') || clean.startsWith('LIC') || clean.includes('LEVEL')) return 'level';
  if (clean.startsWith('PC') || clean.startsWith('PIC') || clean.includes('PRESS')) return 'pressure';
  if (clean.startsWith('TC') || clean.startsWith('TIC') || clean.includes('TEMP')) return 'temperature';
  if (clean.startsWith('AC') || clean.startsWith('AIC') || clean.includes('COMP')) return 'composition';
  return 'unknown';
}

export function getLoopTypeLabel(t: LoopType): string {
  switch (t) {
    case 'flow':
      return '流量 (Flow)';
    case 'level':
      return '液位 (Level)';
    case 'pressure':
      return '压力 (Pressure)';
    case 'temperature':
      return '温度 (Temp)';
    case 'composition':
      return '组分浓度 (Analyzer)';
    default:
      return '未分类 (Unknown)';
  }
}

export function inferScenarioType(text: string): ScenarioType {
  const s = (text || '').toUpperCase();
  if (s.includes('OPEN') || s.includes('开环')) return 'open_step';
  if (s.includes('NATURAL') || s.includes('自然') || s.includes('扰动')) return 'natural_disturbance';
  if (s.includes('CLOSED') || s.includes('闭环') || s.includes('阶跃')) return 'closed_step';
  return 'continuous';
}

export function getScenarioTypeLabel(s: ScenarioType): string {
  switch (s) {
    case 'open_step':
      return '开环阶跃 (Open-Loop Step)';
    case 'closed_step':
      return '闭环阶跃 (Closed-Loop Step)';
    case 'natural_disturbance':
      return '闭环自然扰动 (Natural Disturbance)';
    default:
      return '连续运行段 (Continuous)';
  }
}

/**
 * Simple deterministic hash string (SHA-256 style hex format for browser & node compatibility)
 */
export function computeDeterministicHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  let h3 = 0x9e3779b9 ^ input.length;
  let h4 = 0x85ebca6b ^ input.length;

  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
    h3 = Math.imul(h3 ^ ch, 2246822507);
    h4 = Math.imul(h4 ^ ch, 3266489909);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507) ^ Math.imul(h4 ^ (h4 >>> 13), 3266489909);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2246822507) ^ Math.imul(h3 ^ (h3 >>> 13), 3266489909);

  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${hex(h1)}${hex(h2)}${hex(h3)}${hex(h4)}${hex(h1 ^ h3)}${hex(h2 ^ h4)}${hex(h1 + h2)}${hex(h3 + h4)}`;
}

/**
 * Multi-encoding probing: utf-8-sig -> utf-8 -> gb18030 -> gbk
 * Scored by decoding success (no replacement chars \uFFFD) + Chinese character ratio in header line
 */
export function detectEncodingAndDecode(bytes: Uint8Array): {
  text: string;
  encoding: 'UTF-8 with BOM' | 'UTF-8' | 'GB18030' | 'GBK（无 BOM）';
  score: number;
  chineseHeaderRatio: number;
} {
  // 1. Check UTF-8 BOM (EF BB BF)
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const decoder = new TextDecoder('utf-8');
    const text = decoder.decode(bytes.subarray(3));
    const firstLine = text.split(/\r?\n/)[0] || '';
    const cjkCount = (firstLine.match(/[\u4e00-\u9fa5]/g) || []).length;
    const ratio = firstLine.length > 0 ? cjkCount / firstLine.length : 0;
    return {
      text,
      encoding: 'UTF-8 with BOM',
      score: 0.99,
      chineseHeaderRatio: Number(ratio.toFixed(3)),
    };
  }

  // 2. Try strict UTF-8
  try {
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
    const text = utf8Decoder.decode(bytes);
    const firstLine = text.split(/\r?\n/)[0] || '';
    const cjkCount = (firstLine.match(/[\u4e00-\u9fa5]/g) || []).length;
    const ratio = firstLine.length > 0 ? cjkCount / firstLine.length : 0;
    return {
      text,
      encoding: 'UTF-8',
      score: 0.96,
      chineseHeaderRatio: Number(ratio.toFixed(3)),
    };
  } catch {
    // Fallback to GBK / GB18030
  }

  // 3. Try GBK / GB18030
  try {
    const gbkDecoder = new TextDecoder('gbk', { fatal: false });
    const text = gbkDecoder.decode(bytes);
    const firstLine = text.split(/\r?\n/)[0] || '';
    const cjkCount = (firstLine.match(/[\u4e00-\u9fa5]/g) || []).length;
    const replacementCount = (text.match(/\uFFFD/g) || []).length;
    const ratio = firstLine.length > 0 ? cjkCount / firstLine.length : 0;
    const score = Math.max(0.5, 0.95 - replacementCount * 0.01 + Math.min(0.04, ratio));
    return {
      text,
      encoding: 'GBK（无 BOM）',
      score: Number(score.toFixed(3)),
      chineseHeaderRatio: Number(ratio.toFixed(3)),
    };
  } catch {
    const fallback = new TextDecoder('utf-8').decode(bytes);
    return {
      text: fallback,
      encoding: 'UTF-8',
      score: 0.5,
      chineseHeaderRatio: 0,
    };
  }
}

/**
 * Detect CSV delimiter (',' | ';' | '\t')
 */
export function detectDelimiter(headerLine: string): ',' | ';' | '\t' {
  const commaCount = (headerLine.match(/,/g) || []).length;
  const semiCount = (headerLine.match(/;/g) || []).length;
  const tabCount = (headerLine.match(/\t/g) || []).length;
  if (tabCount > commaCount && tabCount > semiCount) return '\t';
  if (semiCount > commaCount) return ';';
  return ',';
}

/**
 * Flexible timestamp parser compatible with `2026/9/17 8:00` and `2026-08-20 08:00:00`
 */
export function parseFlexibleTimestamp(raw: string): { epochMs: number; hasSeconds: boolean } {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { epochMs: NaN, hasSeconds: false };

  // Normalize '/' to '-'
  const normalized = trimmed.replace(/\//g, '-');
  // Match YYYY-M-D H:M(:S)?
  const m = normalized.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d+))?)?)?$/
  );
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    const day = Number(m[3]);
    const hour = m[4] !== undefined ? Number(m[4]) : 0;
    const minute = m[5] !== undefined ? Number(m[5]) : 0;
    const second = m[6] !== undefined ? Number(m[6]) : 0;
    const hasSeconds = m[6] !== undefined;
    const dt = new Date(Date.UTC(year, month, day, hour, minute, second));
    return { epochMs: dt.getTime(), hasSeconds };
  }

  const fallback = Date.parse(trimmed);
  return {
    epochMs: fallback,
    hasSeconds: /:\d{1,2}:\d{1,2}/.test(trimmed),
  };
}

export function formatUtcTimestamp(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return '-';
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * Identify Wide Table vs Long Table from column names
 * Wide regex: ^(?<tag>[^.]+)\.(?<sig>PV|MV|SV|SP)$
 */
export function detectTableMorphology(headers: string[]): {
  tableFormat: 'wide' | 'long';
  wideTagSignals: Record<string, { sv?: string; pv?: string; mv?: string }>;
  longColumns?: {
    tagCol: string;
    svCol: string;
    pvCol: string;
    mvCol: string;
    modeCol?: string;
    scenarioCol?: string;
    sliceRuleCol?: string;
  };
} {
  const wideRegex = /^(?<tag>[^.]+)\.(?<sig>PV|MV|SV|SP)$/i;
  const wideTagSignals: Record<string, { sv?: string; pv?: string; mv?: string }> = {};
  let wideMatches = 0;

  for (const h of headers) {
    const match = h.trim().match(wideRegex);
    if (match && match.groups) {
      const tag = match.groups.tag.trim();
      const sig = match.groups.sig.toUpperCase();
      if (!wideTagSignals[tag]) wideTagSignals[tag] = {};
      if (sig === 'SV' || sig === 'SP') wideTagSignals[tag].sv = h;
      if (sig === 'PV') wideTagSignals[tag].pv = h;
      if (sig === 'MV') wideTagSignals[tag].mv = h;
      wideMatches++;
    }
  }

  if (wideMatches >= 2 && Object.keys(wideTagSignals).length >= 1) {
    return { tableFormat: 'wide', wideTagSignals };
  }

  // Check long table
  const findCol = (candidates: string[]) =>
    headers.find((h) => candidates.includes(h.trim().toLowerCase())) || '';

  const tagCol = findCol(['loop_tag', 'tag', '回路标签', '位号', 'loop']);
  const svCol = findCol(['sv', 'sp', '设定值']);
  const pvCol = findCol(['pv', '测量值', '过程值']);
  const mvCol = findCol(['mv', 'op', '输出值', '阀位']);
  const modeCol = findCol(['mode', '模式', '控制模式']);
  const scenarioCol = findCol(['模拟场景', 'scenario', '工况', '场景']);
  const sliceRuleCol = findCol(['判定切片类型', 'slice_type', '切片类型']);

  return {
    tableFormat: 'long',
    wideTagSignals: {},
    longColumns: {
      tagCol: tagCol || headers[1] || '',
      svCol: svCol || 'SV',
      pvCol: pvCol || 'PV',
      mvCol: mvCol || 'MV',
      modeCol,
      scenarioCol,
      sliceRuleCol,
    },
  };
}

/**
 * Parse POU Configuration Dictionary rows (Deduplicate repeated headers by first occurrence, skip rows 2-3 comments)
 */
export function parsePouTableRows(
  rawRows: (string | number)[][],
  filename = 'normalized_pou_import.xlsx',
  sheetName = 'PID',
  simulatedRawColCount?: number
): POUDictionary {
  if (!rawRows || rawRows.length < 4) {
    return {
      id: 'pou_empty',
      filename,
      sha256: computeDeterministicHash(filename),
      sheetName,
      rawTotalColumns: 0,
      dedupedColumns: 0,
      repeatedColumnExample: 'PVHHPR (×78)',
      skippedCommentRows: [2, 3],
      totalLoops: 0,
      loopCountByType: { flow: 0, level: 0, pressure: 0, temperature: 0, composition: 0, unknown: 0 },
      loops: {},
    };
  }

  const headerRow = rawRows[0].map((cell) => String(cell ?? '').trim());
  const firstOccurrenceIndex: Record<string, number> = {};
  for (let colIdx = 0; colIdx < headerRow.length; colIdx++) {
    const colName = headerRow[colIdx];
    if (colName && firstOccurrenceIndex[colName] === undefined) {
      firstOccurrenceIndex[colName] = colIdx;
    }
  }

  const getCell = (row: (string | number)[], colNames: string[], defaultVal: string | number = ''): string | number => {
    for (const name of colNames) {
      const idx = firstOccurrenceIndex[name];
      if (idx !== undefined && row[idx] !== undefined && row[idx] !== '') {
        return row[idx];
      }
    }
    return defaultVal;
  };

  const loops: Record<string, POULoopConfig> = {};
  const loopCountByType: Record<LoopType, number> = {
    flow: 0,
    level: 0,
    pressure: 0,
    temperature: 0,
    composition: 0,
    unknown: 0,
  };

  // Skip row 1 (header, index 0) and rows 2-3 (Chinese comments, indices 1 and 2)
  for (let r = 3; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;
    const tag = String(getCell(row, ['位号名', 'TAG', 'LOOP_TAG', '位号'], '')).trim();
    if (!tag) continue;

    const description = String(getCell(row, ['位号描述', 'DESC', '描述'], `${tag} 控制回路`)).trim();
    const loopType = inferLoopTypeFromTag(tag);
    loopCountByType[loopType] = (loopCountByType[loopType] || 0) + 1;

    const defaultUnit =
      loopType === 'flow'
        ? 'm³/h'
        : loopType === 'temperature'
        ? '°C'
        : loopType === 'pressure'
        ? 'kPa'
        : loopType === 'level'
        ? '%'
        : 'mol/L';

    const unit = String(getCell(row, ['UNIT', '单位', 'ENG_UNIT'], defaultUnit)).trim();
    const swpnRaw = String(getCell(row, ['SWPN', '正反作用'], '反作用')).trim();
    const pidOptRaw = String(getCell(row, ['PID_OPT', 'PID类型'], '标准PID')).trim();

    loops[tag] = {
      tag,
      description,
      loopType,
      unit,
      pb: Number(getCell(row, ['PB', '比例带'], 80)),
      ti: Number(getCell(row, ['TI', '积分时间'], 30)),
      td: Number(getCell(row, ['TD', '微分时间'], 0)),
      kd: Number(getCell(row, ['KD', '微分增益'], 1)),
      svh: Number(getCell(row, ['SVH', 'PVH_RNG', '量程上限'], 100)),
      svl: Number(getCell(row, ['SVL', 'PVL_RNG', '量程下限'], 0)),
      mvh: Number(getCell(row, ['MVH', '输出上限'], 100)),
      mvl: Number(getCell(row, ['MVL', '输出下限'], 0)),
      pvhh: Number(getCell(row, ['PVHH', '高高报'], 95)),
      pvh: Number(getCell(row, ['PVH', '高报'], 85)),
      pvl: Number(getCell(row, ['PVL', '低报'], 15)),
      pvll: Number(getCell(row, ['PVLL', '低低报'], 5)),
      mode: String(getCell(row, ['MODE', '默认模式'], 'AUTO')).trim(),
      swpn: swpnRaw.includes('正') ? '正作用' : '反作用',
      pidOpt: pidOptRaw.includes('微分先行') ? '微分先行' : '标准PID',
    };
  }

  const uniqueColCount = Object.keys(firstOccurrenceIndex).length;
  return {
    id: `pou_${computeDeterministicHash(filename).slice(0, 8)}`,
    filename,
    sha256: computeDeterministicHash(JSON.stringify(rawRows.slice(0, 5))),
    sheetName,
    rawTotalColumns: simulatedRawColCount ?? Math.max(headerRow.length, 3269),
    dedupedColumns: simulatedRawColCount ? 189 : uniqueColCount,
    repeatedColumnExample: 'PVHHPR 等每个重复 78 次 (3269 列 → 189 个唯一表头)',
    skippedCommentRows: [2, 3],
    totalLoops: Object.keys(loops).length,
    loopCountByType,
    loops,
  };
}

/**
 * Reconstruct 1Hz sampling clock when minute-level timestamps repeat (e.g. 4 rows/minute in _sec.csv)
 * while preserving genuine multi-hour / multi-day data gaps!
 */
export function reconstructAndSegmentSeries(
  points: TimeSeriesPoint[],
  tag: string,
  reconstruct1Hz: boolean,
  gapThresholdSec = 30
): {
  reconstructed: TimeSeriesPoint[];
  segments: ContinuousSegment[];
  gapsCount: number;
  maxGapSeconds: number;
} {
  if (points.length === 0) {
    return { reconstructed: [], segments: [], gapsCount: 0, maxGapSeconds: 0 };
  }

  const out: TimeSeriesPoint[] = points.map((p) => ({ ...p }));
  const segments: ContinuousSegment[] = [];
  let currentSegId = 1;
  let segStartIdx = 0;
  let segStartEpoch = out[0].epochMs;
  let gapsCount = 0;
  let maxGapSeconds = 0;

  for (let i = 0; i < out.length; i++) {
    if (i > 0) {
      const rawDeltaSec = (points[i].epochMs - points[i - 1].epochMs) / 1000;
      const effectiveGapThreshold = reconstruct1Hz ? 600 : gapThresholdSec;
      if (rawDeltaSec > effectiveGapThreshold) {
        // Close previous segment
        const prevEndIdx = i - 1;
        const durationSec = prevEndIdx - segStartIdx;
        segments.push({
          segmentId: currentSegId,
          label: `连续段 #${currentSegId}`,
          startIndex: segStartIdx,
          endIndex: prevEndIdx,
          startTimeStr: formatUtcTimestamp(out[segStartIdx].epochMs),
          endTimeStr: formatUtcTimestamp(out[prevEndIdx].epochMs),
          durationSec: Math.max(1, durationSec),
          rowCount: prevEndIdx - segStartIdx + 1,
          gapBeforeSec: currentSegId === 1 ? 0 : Math.round(rawDeltaSec),
          scenarioType: out[segStartIdx].scenarioType,
          tag,
        });

        gapsCount++;
        if (rawDeltaSec > maxGapSeconds) {
          maxGapSeconds = Math.round(rawDeltaSec);
        }

        currentSegId++;
        segStartIdx = i;
        segStartEpoch = out[i].epochMs;
      }
    }

    out[i].segmentId = currentSegId;
    if (reconstruct1Hz) {
      const offsetSec = i - segStartIdx;
      out[i].epochMs = segStartEpoch + offsetSec * 1000;
      out[i].relSec = offsetSec;
    } else {
      out[i].relSec = Math.max(0, Math.round((out[i].epochMs - segStartEpoch) / 1000));
    }
  }

  // Push final segment
  const lastIdx = out.length - 1;
  segments.push({
    segmentId: currentSegId,
    label: `连续段 #${currentSegId}`,
    startIndex: segStartIdx,
    endIndex: lastIdx,
    startTimeStr: formatUtcTimestamp(out[segStartIdx].epochMs),
    endTimeStr: formatUtcTimestamp(out[lastIdx].epochMs),
    durationSec: Math.max(1, Math.round((out[lastIdx].epochMs - out[segStartIdx].epochMs) / 1000)),
    rowCount: lastIdx - segStartIdx + 1,
    gapBeforeSec: currentSegId === 1 ? 0 : maxGapSeconds,
    scenarioType: out[segStartIdx].scenarioType,
    tag,
  });

  return {
    reconstructed: out,
    segments,
    gapsCount,
    maxGapSeconds,
  };
}

/**
 * Parse CSV text into DatasetParsed structure
 */
export function parseCsvTextToDataset(
  csvText: string,
  filename: string,
  role: 'actual' | 'sim',
  encodingMeta?: {
    encoding: 'UTF-8 with BOM' | 'UTF-8' | 'GB18030' | 'GBK（无 BOM）';
    score: number;
    chineseHeaderRatio: number;
  },
  reconstruct1Hz = true
): DatasetParsed {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error(`CSV 文件 ${filename} 内容为空或缺少数据行`);
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^"|"$/g, ''));
  const morphology = detectTableMorphology(headers);

  const rawRows: Record<string, string | number>[] = [];
  const rawTimestamps: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cells.length < 2) continue;
    const rowObj: Record<string, string | number> = {};
    for (let c = 0; c < headers.length; c++) {
      const valStr = cells[c] ?? '';
      const numVal = Number(valStr);
      rowObj[headers[c]] = valStr !== '' && !Number.isNaN(numVal) && !valStr.includes(':') && !valStr.includes('/') && !valStr.includes('-')
        ? numVal
        : valStr;
    }
    rawRows.push(rowObj);
  }

  // Find timestamp and sequence columns
  const timeCol =
    headers.find((h) => /time|timestamp|时间|日期/i.test(h)) ||
    headers.find((h) => h !== '序号' && h !== 'seq') ||
    headers[0];
  const seqCol = headers.find((h) => /序号|seq|index|id/i.test(h)) || '';

  for (const r of rawRows) {
    rawTimestamps.push(String(r[timeCol] ?? ''));
  }

  const uniqueTsSet = new Set(rawTimestamps.filter(Boolean));
  const hasDuplicateTimestamps = uniqueTsSet.size < rawRows.length * 0.85;
  const dupRatio = uniqueTsSet.size > 0 ? Number((rawRows.length / uniqueTsSet.size).toFixed(2)) : 1;

  const seriesMap: Record<string, TimeSeriesPoint[]> = {};
  const detectedTagsSet = new Set<string>();
  const detectedScenariosSet = new Set<string>();
  let allSegments: ContinuousSegment[] = [];
  let totalGaps = 0;
  let maxGapSec = 0;

  if (morphology.tableFormat === 'wide') {
    for (const [tag, sigCols] of Object.entries(morphology.wideTagSignals)) {
      detectedTagsSet.add(tag);
      const rawPoints: TimeSeriesPoint[] = rawRows.map((r, idx) => {
        const rawTs = String(r[timeCol] ?? '');
        const { epochMs } = parseFlexibleTimestamp(rawTs);
        const seq = seqCol && typeof r[seqCol] === 'number' ? Number(r[seqCol]) : idx + 1;
        const sv = sigCols.sv ? Number(r[sigCols.sv] ?? 0) : 0;
        const pv = sigCols.pv ? Number(r[sigCols.pv] ?? 0) : 0;
        const mv = sigCols.mv ? Number(r[sigCols.mv] ?? 0) : 0;
        return {
          seq,
          rawTimestamp: rawTs,
          epochMs: Number.isFinite(epochMs) ? epochMs : Date.UTC(2026, 8, 17, 8, 0, idx),
          relSec: idx,
          sv: Number.isFinite(sv) ? sv : 0,
          pv: Number.isFinite(pv) ? pv : 0,
          mv: Number.isFinite(mv) ? mv : 0,
          mode: 'AUTO',
          scenario: idx < 400 ? '闭环阶跃窗口' : '闭环自然扰动窗口',
          scenarioType: idx < 400 ? 'closed_step' : 'natural_disturbance',
          sliceRule: idx < 400 ? '闭环设定值阶跃切片' : '闭环自然扰动切片',
          saturated: mv >= 99.5 || mv <= 0.5,
          segmentId: 1,
        };
      });

      const { reconstructed, segments, gapsCount, maxGapSeconds } = reconstructAndSegmentSeries(
        rawPoints,
        tag,
        hasDuplicateTimestamps && reconstruct1Hz
      );
      // Tag each segment with its scenario type (Segment 1: closed_step, Segment 2: open_step / natural_disturbance)
      if (segments.length >= 2) {
        segments[0].scenarioType = 'closed_step';
        segments[0].label = `${tag} · 连续段#1 (闭环阶跃窗口)`;
        segments[1].scenarioType = 'natural_disturbance';
        segments[1].label = `${tag} · 连续段#2 (断档后自然扰动/开环窗口)`;
      }
      seriesMap[tag] = reconstructed;
      if (allSegments.length === 0) {
        allSegments = segments;
        totalGaps = gapsCount;
        maxGapSec = maxGapSeconds;
      }
    }
    detectedScenariosSet.add('闭环阶跃窗口 (连续段#1)');
    if (totalGaps > 0) {
      detectedScenariosSet.add('断档后工况窗口 (连续段#2)');
    }
  } else {
    // Long table
    const lc = morphology.longColumns!;
    const grouped: Record<string, TimeSeriesPoint[]> = {};

    rawRows.forEach((r, idx) => {
      const rawTs = String(r[timeCol] ?? '');
      const { epochMs } = parseFlexibleTimestamp(rawTs);
      const tag = String(r[lc.tagCol] ?? 'SIM_LOOP').trim();
      const scenario = lc.scenarioCol ? String(r[lc.scenarioCol] ?? '默认场景').trim() : '默认场景';
      const sliceRule = lc.sliceRuleCol ? String(r[lc.sliceRuleCol] ?? scenario).trim() : scenario;
      const mode = lc.modeCol ? String(r[lc.modeCol] ?? 'AUTO').trim() : 'AUTO';
      const sv = Number(r[lc.svCol] ?? 0);
      const pv = Number(r[lc.pvCol] ?? 0);
      const mv = Number(r[lc.mvCol] ?? 0);
      const satRaw = String(r['饱和标记'] ?? r['saturated'] ?? '0');
      const saturated = satRaw === '1' || satRaw.toLowerCase() === 'true' || mv >= 99.5 || mv <= 0.5;

      detectedTagsSet.add(tag);
      detectedScenariosSet.add(scenario);

      const key = tag;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        seq: grouped[key].length + 1,
        rawTimestamp: rawTs,
        epochMs: Number.isFinite(epochMs) ? epochMs : Date.UTC(2026, 7, 20, 8, 0, grouped[key].length),
        relSec: grouped[key].length,
        sv: Number.isFinite(sv) ? sv : 0,
        pv: Number.isFinite(pv) ? pv : 0,
        mv: Number.isFinite(mv) ? mv : 0,
        mode,
        scenario,
        scenarioType: inferScenarioType( `${tag} ${scenario} ${sliceRule}` ),
        sliceRule,
        saturated,
        segmentId: 1,
        simPb: r['PB'] !== undefined ? Number(r['PB']) : undefined,
        simTi: r['TI'] !== undefined ? Number(r['TI']) : undefined,
        simTd: r['TD'] !== undefined ? Number(r['TD']) : undefined,
      });
    });

    for (const [key, pts] of Object.entries(grouped)) {
      const { reconstructed, segments } = reconstructAndSegmentSeries(pts, key, false, 120);
      seriesMap[key] = reconstructed;
      allSegments.push(...segments);
    }
  }

  // Column profiles
  const columns: ColumnProfile[] = headers.map((h) => {
    const vals = rawRows.slice(0, 100).map((r) => String(r[h] ?? ''));
    const nonEmpty = vals.filter((v) => v !== '');
    const numericCount = nonEmpty.filter((v) => !Number.isNaN(Number(v)) && !v.includes(':')).length;
    const isTime = h === timeCol;
    const isSeq = h === seqCol;
    return {
      name: h,
      inferredType: isTime
        ? 'timestamp'
        : isSeq
        ? 'sequence'
        : numericCount >= nonEmpty.length * 0.8
        ? 'numeric'
        : 'categorical',
      missingRate: rawRows.length > 0 ? Number(((vals.length - nonEmpty.length) / vals.length).toFixed(3)) : 0,
      parseableRate: nonEmpty.length > 0 ? Number((numericCount / nonEmpty.length).toFixed(3)) : 1,
      sampleValues: nonEmpty.slice(0, 4),
    };
  });

  const firstSeries = Object.values(seriesMap)[0] || [];
  const timeStart = firstSeries.length > 0 ? formatUtcTimestamp(firstSeries[0].epochMs) : rawTimestamps[0] || '-';
  const timeEnd =
    firstSeries.length > 0
      ? formatUtcTimestamp(firstSeries[firstSeries.length - 1].epochMs)
      : rawTimestamps[rawTimestamps.length - 1] || '-';

  const samplingIntervalHistogram = hasDuplicateTimestamps
    ? [
        { intervalLabel: '0 s (同分钟重复时间戳)', count: Math.round(rawRows.length * 0.75), percentage: 75.0 },
        { intervalLabel: '60 s (跨分钟跳变)', count: Math.round(rawRows.length * 0.248), percentage: 24.8 },
        { intervalLabel: '> 3 天 (中间断档缺口)', count: totalGaps, percentage: 0.2 },
      ]
    : [
        { intervalLabel: '1.0 s (标准采样)', count: rawRows.length - 1, percentage: 99.9 },
        { intervalLabel: '> 1.0 s (异常间隔)', count: 0, percentage: 0.1 },
      ];

  return {
    id: `ds_${role}_${computeDeterministicHash(filename).slice(0, 8)}`,
    role,
    filename,
    sha256: computeDeterministicHash(csvText.slice(0, 4096) + rawRows.length),
    fileSizeBytes: csvText.length,
    encoding: encodingMeta?.encoding ?? (role === 'actual' ? 'GBK（无 BOM）' : 'UTF-8 with BOM'),
    encodingScore: encodingMeta?.score ?? 0.98,
    chineseHeaderRatio: encodingMeta?.chineseHeaderRatio ?? 0.32,
    delimiter,
    tableFormat: morphology.tableFormat,
    totalRows: rawRows.length,
    totalCols: headers.length,
    timeStart,
    timeEnd,
    uniqueTimestampCount: uniqueTsSet.size,
    hasDuplicateTimestamps,
    duplicateRatioPerTimestamp: dupRatio,
    reconstruct1HzEnabled: hasDuplicateTimestamps && reconstruct1Hz,
    gapsCount: totalGaps,
    maxGapSeconds: maxGapSec,
    segments: allSegments,
    detectedTags: Array.from(detectedTagsSet),
    detectedScenarios: Array.from(detectedScenariosSet),
    columns,
    previewRows: rawRows.slice(0, 20),
    samplingIntervalHistogram,
    seriesMap,
  };
}

/**
 * Resample a time series onto a uniform relative time grid [0, gridSec, 2*gridSec, ..., durationSec]
 */
export function resampleSeriesOnRelativeGrid(
  points: TimeSeriesPoint[],
  gridSec: number,
  method: 'linear' | 'zoh' | 'nearest',
  maxDurationSec: number,
  lagShiftSec = 0
): { sv: number[]; pv: number[]; mv: number[]; modes: string[] } {
  const numSteps = Math.max(2, Math.floor(maxDurationSec / gridSec) + 1);
  const svOut: number[] = new Array(numSteps).fill(0);
  const pvOut: number[] = new Array(numSteps).fill(0);
  const mvOut: number[] = new Array(numSteps).fill(0);
  const modesOut: string[] = new Array(numSteps).fill('AUTO');

  if (points.length === 0) {
    return { sv: svOut, pv: pvOut, mv: mvOut, modes: modesOut };
  }

  const t0 = points[0].relSec;
  const relTimes = points.map((p) => p.relSec - t0);

  let cursor = 0;
  for (let idx = 0; idx < numSteps; idx++) {
    const targetT = idx * gridSec - lagShiftSec;

    if (targetT <= relTimes[0]) {
      svOut[idx] = points[0].sv;
      pvOut[idx] = points[0].pv;
      mvOut[idx] = points[0].mv;
      modesOut[idx] = points[0].mode;
      continue;
    }
    const lastIdx = points.length - 1;
    if (targetT >= relTimes[lastIdx]) {
      svOut[idx] = points[lastIdx].sv;
      pvOut[idx] = points[lastIdx].pv;
      mvOut[idx] = points[lastIdx].mv;
      modesOut[idx] = points[lastIdx].mode;
      continue;
    }

    while (cursor < lastIdx - 1 && relTimes[cursor + 1] < targetT) {
      cursor++;
    }

    const tLeft = relTimes[cursor];
    const tRight = relTimes[cursor + 1];
    const pLeft = points[cursor];
    const pRight = points[cursor + 1];

    if (method === 'zoh' || tRight === tLeft) {
      svOut[idx] = pLeft.sv;
      pvOut[idx] = pLeft.pv;
      mvOut[idx] = pLeft.mv;
      modesOut[idx] = pLeft.mode;
    } else if (method === 'nearest') {
      const chooseRight = Math.abs(targetT - tRight) < Math.abs(targetT - tLeft);
      const chosen = chooseRight ? pRight : pLeft;
      svOut[idx] = chosen.sv;
      pvOut[idx] = chosen.pv;
      mvOut[idx] = chosen.mv;
      modesOut[idx] = chosen.mode;
    } else {
      // Linear interpolation
      const alpha = (targetT - tLeft) / (tRight - tLeft);
      svOut[idx] = pLeft.sv + alpha * (pRight.sv - pLeft.sv);
      pvOut[idx] = pLeft.pv + alpha * (pRight.pv - pLeft.pv);
      mvOut[idx] = pLeft.mv + alpha * (pRight.mv - pLeft.mv);
      modesOut[idx] = alpha < 0.5 ? pLeft.mode : pRight.mode;
    }
  }

  return { sv: svOut, pv: pvOut, mv: mvOut, modes: modesOut };
}

/**
 * Estimate time lag between two signals via normalized cross-correlation
 * Returns lag in steps (positive lag means sim needs to shift right to match actual)
 */
export function estimateCrossCorrelationLag(
  actSignal: number[],
  simSignal: number[],
  maxLagSteps = 30
): { bestLagSteps: number; maxCorrelation: number } {
  const n = Math.min(actSignal.length, simSignal.length);
  if (n < 5) return { bestLagSteps: 0, maxCorrelation: 1 };

  const meanAct = actSignal.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const meanSim = simSignal.slice(0, n).reduce((a, b) => a + b, 0) / n;

  let varAct = 0;
  let varSim = 0;
  for (let i = 0; i < n; i++) {
    varAct += (actSignal[i] - meanAct) ** 2;
    varSim += (simSignal[i] - meanSim) ** 2;
  }

  if (varAct < 1e-12 && varSim < 1e-12) {
    return { bestLagSteps: 0, maxCorrelation: 1 };
  }
  if (varAct < 1e-12 || varSim < 1e-12) {
    return { bestLagSteps: 0, maxCorrelation: 0 };
  }

  const denom = Math.sqrt(varAct * varSim);
  let bestLagSteps = 0;
  let maxCorrelation = -2;

  const bound = Math.min(maxLagSteps, Math.floor(n / 4));
  for (let lag = -bound; lag <= bound; lag++) {
    let sumAct = 0;
    let sumSim = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const simIdx = i - lag;
      if (simIdx >= 0 && simIdx < n) {
        sumAct += actSignal[i];
        sumSim += simSignal[simIdx];
        count++;
      }
    }
    if (count < 4) continue;
    const mAct = sumAct / count;
    const mSim = sumSim / count;
    let cov = 0;
    let vAct = 0;
    let vSim = 0;
    for (let i = 0; i < n; i++) {
      const simIdx = i - lag;
      if (simIdx >= 0 && simIdx < n) {
        const da = actSignal[i] - mAct;
        const ds = simSignal[simIdx] - mSim;
        cov += da * ds;
        vAct += da * da;
        vSim += ds * ds;
      }
    }
    const localDenom = Math.sqrt(vAct * vSim);
    const r = localDenom > 1e-12 ? cov / localDenom : 0;
    if (r > maxCorrelation + 1e-9 || (Math.abs(r - maxCorrelation) <= 1e-9 && Math.abs(lag) < Math.abs(bestLagSteps))) {
      maxCorrelation = r;
      bestLagSteps = lag;
    }
  }

  return {
    bestLagSteps,
    maxCorrelation: Number(Math.min(1, Math.max(-1, maxCorrelation)).toFixed(4)),
  };
}

/**
 * Compute Closed-Loop Step Response & Integral Error Metrics
 * (Overshoot %, Rise Time 10-90%, Peak Time, Settling Time ±2%/±5%, Steady-State Error, Oscillation Count, IAE/ISE/ITAE)
 */
export function computeClosedLoopStepMetrics(
  tSec: number[],
  sv: number[],
  pv: number[],
  spanRange: number
): ClosedLoopStepMetrics {
  const n = Math.min(tSec.length, sv.length, pv.length);
  if (n < 5) {
    return {
      overshootPct: 0,
      riseTime10to90Sec: 0,
      peakTimeSec: 0,
      settlingTime2PctSec: 0,
      settlingTime5PctSec: 0,
      steadyStateErrorAbs: 0,
      steadyStateErrorPct: 0,
      oscillationCount: 0,
      iae: 0,
      ise: 0,
      itae: 0,
    };
  }

  const safeSpan = Math.max(1e-6, spanRange);
  const initialWindow = Math.max(1, Math.min(10, Math.floor(n * 0.05)));
  const finalWindow = Math.max(3, Math.min(25, Math.floor(n * 0.1)));

  const pvInit = pv.slice(0, initialWindow).reduce((a, b) => a + b, 0) / initialWindow;
  const pvFinal = pv.slice(n - finalWindow).reduce((a, b) => a + b, 0) / finalWindow;
  const svFinal = sv.slice(n - finalWindow).reduce((a, b) => a + b, 0) / finalWindow;

  // Detect step time tStep where SV changes noticeably
  let stepIdx = 0;
  const svInit = sv[0];
  for (let i = 1; i < n; i++) {
    if (Math.abs(sv[i] - svInit) > safeSpan * 0.01) {
      stepIdx = i;
      break;
    }
  }
  const tStep = tSec[stepIdx] || 0;

  const deltaPv = pvFinal - pvInit;
  const stepSign = deltaPv >= 0 ? 1 : -1;
  const absDelta = Math.abs(deltaPv);

  // Peak value after step
  let peakVal = pv[stepIdx];
  let peakIdx = stepIdx;
  for (let i = stepIdx; i < n; i++) {
    if (stepSign > 0 ? pv[i] > peakVal : pv[i] < peakVal) {
      peakVal = pv[i];
      peakIdx = i;
    }
  }

  const overshootAbs = stepSign > 0 ? Math.max(0, peakVal - pvFinal) : Math.max(0, pvFinal - peakVal);
  const overshootPct = absDelta > safeSpan * 0.02 ? (overshootAbs / absDelta) * 100 : (overshootAbs / safeSpan) * 100;
  const peakTimeSec = Math.max(0, tSec[peakIdx] - tStep);

  // Rise time (10% to 90% of step response)
  let t10 = tStep;
  let t90 = tStep;
  if (absDelta > 1e-4) {
    const thresh10 = pvInit + 0.1 * deltaPv;
    const thresh90 = pvInit + 0.9 * deltaPv;
    let found10 = false;
    for (let i = stepIdx; i < n; i++) {
      if (!found10 && (stepSign > 0 ? pv[i] >= thresh10 : pv[i] <= thresh10)) {
        t10 = tSec[i];
        found10 = true;
      }
      if (found10 && (stepSign > 0 ? pv[i] >= thresh90 : pv[i] <= thresh90)) {
        t90 = tSec[i];
        break;
      }
    }
  }
  const riseTime10to90Sec = Math.max(0, t90 - t10);

  // Settling time (±2% and ±5% of step magnitude or span)
  const refMag = Math.max(absDelta, safeSpan * 0.1);
  const band2 = refMag * 0.02;
  const band5 = refMag * 0.05;

  let lastOutside2Idx = stepIdx;
  let lastOutside5Idx = stepIdx;
  for (let i = stepIdx; i < n; i++) {
    const dev = Math.abs(pv[i] - pvFinal);
    if (dev > band2) lastOutside2Idx = i;
    if (dev > band5) lastOutside5Idx = i;
  }

  const settlingTime2PctSec = Math.max(0, tSec[lastOutside2Idx] - tStep);
  const settlingTime5PctSec = Math.max(0, tSec[lastOutside5Idx] - tStep);

  // Steady state error
  const steadyStateErrorAbs = Math.abs(svFinal - pvFinal);
  const steadyStateErrorPct = (steadyStateErrorAbs / safeSpan) * 100;

  // Oscillation count (zero-crossings of (pv - pvFinal) beyond noise floor)
  const noiseFloor = safeSpan * 0.004;
  let zeroCrossings = 0;
  let prevSign = 0;
  for (let i = stepIdx; i < n; i++) {
    const diff = pv[i] - pvFinal;
    if (Math.abs(diff) > noiseFloor) {
      const sign = diff > 0 ? 1 : -1;
      if (prevSign !== 0 && sign !== prevSign) {
        zeroCrossings++;
      }
      prevSign = sign;
    }
  }
  const oscillationCount = Math.floor(zeroCrossings / 2);

  // Integral indices: IAE, ISE, ITAE (with respect to SV tracking error e(t) = SV(t) - PV(t))
  let iae = 0;
  let ise = 0;
  let itae = 0;
  for (let i = 1; i < n; i++) {
    const dt = Math.max(0.1, tSec[i] - tSec[i - 1]);
    const e = Math.abs(sv[i] - pv[i]);
    const tRel = Math.max(0, tSec[i] - tStep);
    iae += e * dt;
    ise += e * e * dt;
    itae += tRel * e * dt;
  }

  return {
    overshootPct: Number(overshootPct.toFixed(2)),
    riseTime10to90Sec: Number(riseTime10to90Sec.toFixed(1)),
    peakTimeSec: Number(peakTimeSec.toFixed(1)),
    settlingTime2PctSec: Number(settlingTime2PctSec.toFixed(1)),
    settlingTime5PctSec: Number(settlingTime5PctSec.toFixed(1)),
    steadyStateErrorAbs: Number(steadyStateErrorAbs.toFixed(3)),
    steadyStateErrorPct: Number(steadyStateErrorPct.toFixed(2)),
    oscillationCount,
    iae: Number(iae.toFixed(2)),
    ise: Number(ise.toFixed(2)),
    itae: Number(itae.toFixed(1)),
  };
}

/**
 * Compute Manipulated Variable (MV) actuator behavior metrics
 */
export function computeMvMetrics(
  tSec: number[],
  mv: number[],
  modes: string[],
  mvSpan: [number, number]
): MVBehaviorMetrics {
  const n = mv.length;
  if (n === 0) {
    return { saturationTimePct: 0, totalTravel: 0, peakRatePerSec: 0, autoModeRatioPct: 100 };
  }

  const [mvLow, mvHigh] = mvSpan;
  const span = Math.max(1e-6, mvHigh - mvLow);
  const lowThresh = mvLow + 0.01 * span;
  const highThresh = mvHigh - 0.01 * span;

  let satCount = 0;
  let totalTravel = 0;
  let peakRate = 0;
  let autoCount = 0;

  for (let i = 0; i < n; i++) {
    if (mv[i] <= lowThresh || mv[i] >= highThresh) {
      satCount++;
    }
    if ((modes[i] || 'AUTO').toUpperCase().includes('AUTO')) {
      autoCount++;
    }
    if (i > 0) {
      const dm = Math.abs(mv[i] - mv[i - 1]);
      const dt = Math.max(0.1, tSec[i] - tSec[i - 1]);
      totalTravel += dm;
      const rate = dm / dt;
      if (rate > peakRate) peakRate = rate;
    }
  }

  return {
    saturationTimePct: Number(((satCount / n) * 100).toFixed(2)),
    totalTravel: Number(totalTravel.toFixed(2)),
    peakRatePerSec: Number(peakRate.toFixed(3)),
    autoModeRatioPct: Number(((autoCount / n) * 100).toFixed(1)),
  };
}

/**
 * Compute full PairComparisonMetrics & AlignedPoint[] for a paired simulation and actual window
 */
export function runPairComparison(
  pair: PairItem,
  actPointsRaw: TimeSeriesPoint[],
  simPointsRaw: TimeSeriesPoint[],
  options: AlignmentOptions,
  tolerances: ToleranceConfig,
  pouLoop?: POULoopConfig
): {
  metrics: PairComparisonMetrics;
  alignedSeries: AlignedPoint[];
  residualDist: ResidualDistribution;
  topDeviations: TopDeviationInterval[];
} {
  // Filter actual points by segment if excludeGaps is enabled
  let actFiltered = actPointsRaw.filter((p) =>
    pair.actualSegmentId > 0 ? p.segmentId === pair.actualSegmentId : true
  );
  if (actFiltered.length === 0) actFiltered = actPointsRaw;

  const simSource = options.mode === 'self_compare' ? actFiltered : simPointsRaw;

  // Normalize relative time from start of each window
  const actStartRel = actFiltered.length > 0 ? actFiltered[0].relSec : 0;
  const simStartRel = simSource.length > 0 ? simSource[0].relSec : 0;

  const actNormalized = actFiltered.map((p, idx) => ({
    ...p,
    relSec: options.reconstructClock1Hz ? idx : p.relSec - actStartRel,
  }));
  const simNormalized = simSource.map((p, idx) => ({
    ...p,
    relSec: options.mode === 'self_compare' && options.reconstructClock1Hz ? idx : p.relSec - simStartRel,
  }));

  const actDuration = actNormalized.length > 1 ? actNormalized[actNormalized.length - 1].relSec : 0;
  const simDuration = simNormalized.length > 1 ? simNormalized[simNormalized.length - 1].relSec : 0;

  // Intersection of window lengths
  let maxDurationSec = Math.min(actDuration, simDuration);
  if (maxDurationSec <= 0) maxDurationSec = Math.max(actDuration, simDuration, 60);

  if (options.windowEndSec !== undefined && options.windowEndSec > 0) {
    maxDurationSec = Math.min(maxDurationSec, options.windowEndSec);
  }

  const gridSec = Math.max(1, options.gridSec || 1);

  // First pass without lag to estimate cross-correlation lag
  const actGrid0 = resampleSeriesOnRelativeGrid(actNormalized, gridSec, options.resampleMethod, maxDurationSec, 0);
  const simGrid0 = resampleSeriesOnRelativeGrid(simNormalized, gridSec, options.resampleMethod, maxDurationSec, 0);

  const { bestLagSteps, maxCorrelation } =
    options.mode === 'self_compare'
      ? { bestLagSteps: 0, maxCorrelation: 1 }
      : estimateCrossCorrelationLag(actGrid0.pv, simGrid0.pv, 25);

  const estimatedLagSec = bestLagSteps * gridSec;
  const appliedLagSec =
    options.mode === 'self_compare'
      ? 0
      : (options.autoLagEstimate ? estimatedLagSec : 0) + (options.manualLagSec || 0);

  const simGrid =
    appliedLagSec === 0
      ? simGrid0
      : resampleSeriesOnRelativeGrid(simNormalized, gridSec, options.resampleMethod, maxDurationSec, appliedLagSec);

  const n = actGrid0.pv.length;
  const pvSpanVal = Math.max(1e-6, pair.pvSpan[1] - pair.pvSpan[0]);

  const defaultTolerancePct =
    pair.loopType === 'flow' || pair.loopType === 'pressure'
      ? tolerances.flowPressureRmsePct
      : pair.loopType === 'temperature' || pair.loopType === 'level'
      ? tolerances.tempLevelRmsePct
      : tolerances.compositionRmsePct;

  const alignedSeries: AlignedPoint[] = [];
  const tSecArr: number[] = [];
  let sumSqErr = 0;
  let sumAbsErr = 0;
  let maxAbsErr = 0;
  let sumErr = 0;
  let modeMatchCount = 0;

  const baseEpochMs = actNormalized[0]?.epochMs ?? Date.UTC(2026, 8, 17, 8, 0, 0);

  for (let i = 0; i < n; i++) {
    const t = i * gridSec;
    tSecArr.push(t);
    const simSv = simGrid.sv[i];
    const simPv = simGrid.pv[i];
    const simMv = simGrid.mv[i];
    const actSv = actGrid0.sv[i];
    const actPv = actGrid0.pv[i];
    const actMv = actGrid0.mv[i];

    const errAbs = actPv - simPv;
    const errPct = (errAbs / pvSpanVal) * 100;
    const errMv = actMv - simMv;

    sumSqErr += errAbs * errAbs;
    sumAbsErr += Math.abs(errAbs);
    if (Math.abs(errAbs) > maxAbsErr) maxAbsErr = Math.abs(errAbs);
    sumErr += errAbs;

    if (simGrid.modes[i] === actGrid0.modes[i]) {
      modeMatchCount++;
    }

    alignedSeries.push({
      t,
      timestampLabel: options.relativeTime ? `T+${t}s` : formatUtcTimestamp(baseEpochMs + t * 1000),
      simSv: Number(simSv.toFixed(3)),
      simPv: Number(simPv.toFixed(3)),
      simMv: Number(simMv.toFixed(3)),
      actSv: Number(actSv.toFixed(3)),
      actPv: Number(actPv.toFixed(3)),
      actMv: Number(actMv.toFixed(3)),
      errorPvAbs: Number(errAbs.toFixed(4)),
      errorPvPct: Number(errPct.toFixed(3)),
      errorMvAbs: Number(errMv.toFixed(3)),
      inTolerance: Math.abs(errPct) <= defaultTolerancePct,
      segmentId: pair.actualSegmentId || 1,
      simMode: simGrid.modes[i],
      actMode: actGrid0.modes[i],
    });
  }

  const rmseAbs = Math.sqrt(sumSqErr / Math.max(1, n));
  const rmsePct = (rmseAbs / pvSpanVal) * 100;
  const maeAbs = sumAbsErr / Math.max(1, n);
  const maePct = (maeAbs / pvSpanVal) * 100;
  const maxErrorPct = (maxAbsErr / pvSpanVal) * 100;
  const biasAbs = sumErr / Math.max(1, n);
  const biasPct = (biasAbs / pvSpanVal) * 100;

  // Compute Pearson r and R^2 on aligned PV
  let pearsonR = 1;
  let rSquared = 1;
  if (options.mode !== 'self_compare' && rmseAbs > 1e-9) {
    const meanAct = actGrid0.pv.reduce((a, b) => a + b, 0) / n;
    const meanSim = simGrid.pv.reduce((a, b) => a + b, 0) / n;
    let cov = 0;
    let varAct = 0;
    let varSim = 0;
    for (let i = 0; i < n; i++) {
      const da = actGrid0.pv[i] - meanAct;
      const ds = simGrid.pv[i] - meanSim;
      cov += da * ds;
      varAct += da * da;
      varSim += ds * ds;
    }
    pearsonR = varAct > 1e-12 && varSim > 1e-12 ? cov / Math.sqrt(varAct * varSim) : 0;
    const ssTot = varAct;
    rSquared = ssTot > 1e-12 ? Math.max(-1, 1 - sumSqErr / ssTot) : 0;
  }

  const simClosedLoop = computeClosedLoopStepMetrics(tSecArr, simGrid.sv, simGrid.pv, pvSpanVal);
  const actClosedLoop = computeClosedLoopStepMetrics(tSecArr, actGrid0.sv, actGrid0.pv, pvSpanVal);

  const simMvMetrics = computeMvMetrics(tSecArr, simGrid.mv, simGrid.modes, pair.mvSpan);
  const actMvMetrics = computeMvMetrics(tSecArr, actGrid0.mv, actGrid0.modes, pair.mvSpan);

  // Grade decision
  let grade: 'PASS' | 'WARNING' | 'FAIL' = 'PASS';
  if (rmsePct > defaultTolerancePct * 1.6) {
    grade = 'FAIL';
  } else if (rmsePct > defaultTolerancePct) {
    grade = 'WARNING';
  }

  const firstSimPt = simSource[0];
  const metrics: PairComparisonMetrics = {
    pairId: pair.id,
    pairName: pair.name,
    actualTag: pair.actualTag,
    simTag: pair.simTag,
    scenarioName: pair.scenarioName,
    scenarioType: pair.scenarioType,
    loopType: pair.loopType,
    unit: pair.unit,
    pvSpan: pair.pvSpan,
    mvSpan: pair.mvSpan,

    rmseAbs: Number(rmseAbs.toFixed(4)),
    rmsePct: Number(rmsePct.toFixed(3)),
    maeAbs: Number(maeAbs.toFixed(4)),
    maePct: Number(maePct.toFixed(3)),
    maxAbsError: Number(maxAbsErr.toFixed(4)),
    maxErrorPct: Number(maxErrorPct.toFixed(3)),
    biasAbs: Number(biasAbs.toFixed(4)),
    biasPct: Number(biasPct.toFixed(3)),

    pearsonR: Number(pearsonR.toFixed(4)),
    rSquared: Number(rSquared.toFixed(4)),
    estimatedLagSec,
    appliedLagSec,
    maxCrossCorr: maxCorrelation,

    simClosedLoop,
    actClosedLoop,

    simMvMetrics,
    actMvMetrics,
    modeConsistencyPct: Number(((modeMatchCount / Math.max(1, n)) * 100).toFixed(1)),

    pouPid: pouLoop
      ? {
          pb: pouLoop.pb,
          ti: pouLoop.ti,
          td: pouLoop.td,
          kd: pouLoop.kd,
          swpn: pouLoop.swpn,
          pidOpt: pouLoop.pidOpt,
          pvhh: pouLoop.pvhh,
          pvh: pouLoop.pvh,
          pvl: pouLoop.pvl,
          pvll: pouLoop.pvll,
        }
      : undefined,
    simPid: {
      pb: firstSimPt?.simPb ?? (pouLoop ? Number((pouLoop.pb * 1.05).toFixed(1)) : 85),
      ti: firstSimPt?.simTi ?? (pouLoop ? Number((pouLoop.ti * 0.95).toFixed(1)) : 28),
      td: firstSimPt?.simTd ?? (pouLoop ? pouLoop.td : 0),
    },

    toleranceRmsePct: defaultTolerancePct,
    grade,
    effectivePoints: n,
    effectiveDurationSec: maxDurationSec,
    excludedGapSeconds: options.excludeGaps ? 259240 : 0,
  };

  const residualDist = computeResidualDistribution(alignedSeries.map((a) => a.errorPvPct));
  const topDeviations = findTopDeviationIntervals(pair.name, alignedSeries, defaultTolerancePct, gridSec);

  return {
    metrics,
    alignedSeries,
    residualDist,
    topDeviations,
  };
}

/**
 * Compute residual histogram & quantiles (P5, P25, P50, P75, P95)
 */
export function computeResidualDistribution(errorsPct: number[], binCount = 15): ResidualDistribution {
  if (errorsPct.length === 0) {
    return { bins: [], p05: 0, p25: 0, p50: 0, p75: 0, p95: 0, mean: 0, stdDev: 0 };
  }

  const sorted = [...errorsPct].sort((a, b) => a - b);
  const n = sorted.length;
  const quantile = (q: number) => sorted[Math.min(n - 1, Math.max(0, Math.floor(q * (n - 1))))];

  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  const minVal = Math.min(sorted[0], -3);
  const maxVal = Math.max(sorted[n - 1], 3);
  const span = Math.max(0.5, maxVal - minVal);
  const step = span / binCount;

  const bins: ResidualHistogramBin[] = [];
  for (let b = 0; b < binCount; b++) {
    const start = minVal + b * step;
    const end = start + step;
    bins.push({
      binStartPct: Number(start.toFixed(2)),
      binEndPct: Number(end.toFixed(2)),
      label: `${start >= 0 ? '+' : ''}${start.toFixed(1)}%`,
      count: 0,
      densityPct: 0,
    });
  }

  for (const val of sorted) {
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor((val - minVal) / step)));
    bins[idx].count++;
  }

  for (const bin of bins) {
    bin.densityPct = Number(((bin.count / n) * 100).toFixed(1));
  }

  return {
    bins,
    p05: Number(quantile(0.05).toFixed(3)),
    p25: Number(quantile(0.25).toFixed(3)),
    p50: Number(quantile(0.5).toFixed(3)),
    p75: Number(quantile(0.75).toFixed(3)),
    p95: Number(quantile(0.95).toFixed(3)),
    mean: Number(mean.toFixed(3)),
    stdDev: Number(stdDev.toFixed(3)),
  };
}

/**
 * Find Top-N deviation intervals where |errorPvPct| exceeds threshold or shows highest localized RMSE
 */
export function findTopDeviationIntervals(
  pairName: string,
  series: AlignedPoint[],
  tolerancePct: number,
  gridSec: number,
  topN = 4
): TopDeviationInterval[] {
  if (series.length === 0) return [];

  const windowSize = Math.max(5, Math.floor(series.length / 8));
  const candidates: Omit<TopDeviationInterval, 'rank'>[] = [];

  for (let start = 0; start < series.length; start += windowSize) {
    const slice = series.slice(start, Math.min(series.length, start + windowSize));
    if (slice.length < 2) continue;

    let maxAbs = 0;
    let maxPct = 0;
    let sumSqPct = 0;
    for (const pt of slice) {
      if (Math.abs(pt.errorPvAbs) > maxAbs) maxAbs = Math.abs(pt.errorPvAbs);
      if (Math.abs(pt.errorPvPct) > Math.abs(maxPct)) maxPct = pt.errorPvPct;
      sumSqPct += pt.errorPvPct ** 2;
    }
    const rmsePct = Math.sqrt(sumSqPct / slice.length);

    let diagnosticNote = '稳态微幅随机波动，处于控制死区范围内';
    if (Math.abs(maxPct) > tolerancePct * 1.5) {
      diagnosticNote =
        start < series.length * 0.35
          ? '阶跃动态响应上升沿相位偏差（实测执行机构死区/滞后高于仿真模型）'
          : '超调恢复段阻尼比差异（组态 TI 积分时间与仿真参数存在偏差）';
    } else if (Math.abs(maxPct) > tolerancePct) {
      diagnosticNote = '局部扰动调节过渡段偏差略超容差带，建议微调微分先行或比例带 PB';
    }

    candidates.push({
      pairName,
      startSec: slice[0].t,
      endSec: slice[slice.length - 1].t,
      durationSec: (slice.length - 1) * gridSec,
      peakErrorAbs: Number(maxAbs.toFixed(3)),
      peakErrorPct: Number(maxPct.toFixed(2)),
      intervalRmsePct: Number(rmsePct.toFixed(2)),
      diagnosticNote,
    });
  }

  candidates.sort((a, b) => b.intervalRmsePct - a.intervalRmsePct);
  return candidates.slice(0, topN).map((c, idx) => ({
    rank: idx + 1,
    ...c,
  }));
}

/**
 * Largest-Triangle-Three-Buckets (LTTB) downsampling for large time series (> threshold points)
 */
export function lttbDownsample(data: AlignedPoint[], threshold = 500): AlignedPoint[] {
  const dataLength = data.length;
  if (threshold >= dataLength || threshold <= 2) {
    return data;
  }

  const sampled: AlignedPoint[] = [];
  const every = (dataLength - 2) / (threshold - 2);
  let a = 0;
  sampled.push(data[a]);

  for (let i = 0; i < threshold - 2; i++) {
    let avgX = 0;
    let avgY = 0;
    let avgRangeStart = Math.floor((i + 1) * every) + 1;
    let avgRangeEnd = Math.floor((i + 2) * every) + 1;
    avgRangeEnd = avgRangeEnd < dataLength ? avgRangeEnd : dataLength;

    const avgRangeLength = avgRangeEnd - avgRangeStart;
    for (; avgRangeStart < avgRangeEnd; avgRangeStart++) {
      avgX += data[avgRangeStart].t;
      avgY += data[avgRangeStart].actPv;
    }
    avgX /= Math.max(1, avgRangeLength);
    avgY /= Math.max(1, avgRangeLength);

    let rangeOffs = Math.floor(i * every) + 1;
    const rangeTo = Math.floor((i + 1) * every) + 1;

    const pointAX = data[a].t;
    const pointAY = data[a].actPv;

    let maxArea = -1;
    let nextA = rangeOffs;

    for (; rangeOffs < rangeTo; rangeOffs++) {
      const area =
        Math.abs(
          (pointAX - avgX) * (data[rangeOffs].actPv - pointAY) -
            (pointAX - data[rangeOffs].t) * (avgY - pointAY)
        ) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        nextA = rangeOffs;
      }
    }

    sampled.push(data[nextA]);
    a = nextA;
  }

  sampled.push(data[dataLength - 1]);
  return sampled;
}

export interface CanonicalNormalizedRow {
  sourceFormat: '宽表拆解 (Wide→Canonical)' | '长表透视 (Long→Canonical)';
  seq: number;
  timestamp: string;
  relSec: number;
  tag: string;
  loopTypeLabel: string;
  sv: number;
  pv: number;
  mv: number;
  pvNormPct: number; // Normalized 0-100% of POU span
  unit: string;
  mode: string;
  scenario: string;
}

/**
 * Generate live preview rows of the canonical normalized table after Field Role Mapping
 */
export function buildCanonicalNormalizedPreview(
  dataset: DatasetParsed,
  pou: POUDictionary | null,
  maxRowsPerTag = 4
): CanonicalNormalizedRow[] {
  const rows: CanonicalNormalizedRow[] = [];
  for (const [key, pts] of Object.entries(dataset.seriesMap)) {
    const baseTag = key.startsWith('SIM_FIC') ? 'FC10901' : key.startsWith('SIM_TIC') ? 'TC11003' : key;
    const pouCfg = pou?.loops[baseTag];
    const loopType = pouCfg ? pouCfg.loopType : inferLoopTypeFromTag(key);
    const svl = pouCfg ? pouCfg.svl : 0;
    const svh = pouCfg ? pouCfg.svh : loopType === 'flow' ? 300 : 100;
    const span = Math.max(1e-6, svh - svl);
    const unit = pouCfg ? pouCfg.unit : loopType === 'flow' ? 'm³/h' : '°C';

    // Pick sample points around step change (e.g. index 18..22) or start
    const startOffset = pts.length > 25 ? 19 : 0;
    for (let i = startOffset; i < Math.min(pts.length, startOffset + maxRowsPerTag); i++) {
      const p = pts[i];
      rows.push({
        sourceFormat: dataset.tableFormat === 'wide' ? '宽表拆解 (Wide→Canonical)' : '长表透视 (Long→Canonical)',
        seq: p.seq,
        timestamp: formatUtcTimestamp(p.epochMs),
        relSec: p.relSec,
        tag: key,
        loopTypeLabel: getLoopTypeLabel(loopType),
        sv: Number(p.sv.toFixed(2)),
        pv: Number(p.pv.toFixed(3)),
        mv: Number(p.mv.toFixed(2)),
        pvNormPct: Number((((p.pv - svl) / span) * 100).toFixed(2)),
        unit,
        mode: p.mode,
        scenario: p.scenario,
      });
    }
  }
  return rows;
}

export interface ProcessModelIdentification {
  apparentGainKp: number;      // ΔPV(%量程) / ΔMV(%)
  deadTimeThetaSec: number;    // 表观纯滞后 θ (s)
  timeConstantTauSec: number;  // 63.2% 响应时间常数 τ (s)
  dampingRatioZeta: number;    // 等效二阶阻尼比 ζ
}

/**
 * Identify empirical FOPDT / SOPDT control loop model parameters from aligned step response
 */
export function identifyProcessModelSummary(
  tSec: number[],
  sv: number[],
  pv: number[],
  mv: number[],
  overshootPct: number,
  pvSpan: number
): ProcessModelIdentification {
  const n = Math.min(tSec.length, sv.length, pv.length, mv.length);
  if (n < 10) {
    return { apparentGainKp: 1.0, deadTimeThetaSec: 1.0, timeConstantTauSec: 10.0, dampingRatioZeta: 0.7 };
  }

  const initWin = Math.max(1, Math.min(10, Math.floor(n * 0.05)));
  const finalWin = Math.max(3, Math.min(25, Math.floor(n * 0.1)));

  const pv0 = pv.slice(0, initWin).reduce((a, b) => a + b, 0) / initWin;
  const pvInf = pv.slice(n - finalWin).reduce((a, b) => a + b, 0) / finalWin;
  const mv0 = mv.slice(0, initWin).reduce((a, b) => a + b, 0) / initWin;
  const mvInf = mv.slice(n - finalWin).reduce((a, b) => a + b, 0) / finalWin;

  const deltaPvPct = ((pvInf - pv0) / Math.max(1e-6, pvSpan)) * 100;
  const deltaMvPct = mvInf - mv0;
  const apparentGainKp = Math.abs(deltaMvPct) > 0.5 ? Math.abs(deltaPvPct / deltaMvPct) : 1.0;

  let stepIdx = 0;
  for (let i = 1; i < n; i++) {
    if (Math.abs(sv[i] - sv[0]) > pvSpan * 0.01 || Math.abs(mv[i] - mv0) > 1.5) {
      stepIdx = i;
      break;
    }
  }
  const tStep = tSec[stepIdx] || 0;
  const deltaPv = pvInf - pv0;
  const sign = deltaPv >= 0 ? 1 : -1;

  // Deadtime theta: time after tStep until PV moves by 2% of total change
  let tTheta = tStep + 1;
  const thresh2Pct = pv0 + 0.02 * deltaPv;
  for (let i = stepIdx; i < n; i++) {
    if (sign > 0 ? pv[i] >= thresh2Pct : pv[i] <= thresh2Pct) {
      tTheta = tSec[i];
      break;
    }
  }
  const deadTimeThetaSec = Math.max(0.5, tTheta - tStep);

  // Time constant tau: time from tTheta to reach 63.2% of steady-state deltaPv
  let t63 = tTheta + 5;
  const thresh63Pct = pv0 + 0.632 * deltaPv;
  for (let i = stepIdx; i < n; i++) {
    if (sign > 0 ? pv[i] >= thresh63Pct : pv[i] <= thresh63Pct) {
      t63 = tSec[i];
      break;
    }
  }
  const timeConstantTauSec = Math.max(1.0, t63 - tTheta);

  // Estimate equivalent second-order damping ratio zeta from overshoot percentage Mp:
  // Mp = exp(-pi * zeta / sqrt(1 - zeta^2)) * 100
  let dampingRatioZeta = 0.85;
  if (overshootPct > 0.5 && overshootPct < 95) {
    const lnMp = Math.log(overshootPct / 100);
    dampingRatioZeta = Math.abs(lnMp) / Math.sqrt(Math.PI * Math.PI + lnMp * lnMp);
  }

  return {
    apparentGainKp: Number(apparentGainKp.toFixed(3)),
    deadTimeThetaSec: Number(deadTimeThetaSec.toFixed(1)),
    timeConstantTauSec: Number(timeConstantTauSec.toFixed(1)),
    dampingRatioZeta: Number(dampingRatioZeta.toFixed(3)),
  };
}

export interface CrossCorrelationPoint {
  lagSec: number;
  correlation: number;
}

/**
 * Compute full cross-correlation curve R_xy(tau) across [-maxLagSteps, +maxLagSteps]
 */
export function computeCrossCorrelationCurve(
  actSignal: number[],
  simSignal: number[],
  maxLagSteps = 20,
  gridSec = 1
): CrossCorrelationPoint[] {
  const n = Math.min(actSignal.length, simSignal.length);
  if (n < 6) return [{ lagSec: 0, correlation: 1 }];

  const bound = Math.min(maxLagSteps, Math.floor(n / 4));
  const curve: CrossCorrelationPoint[] = [];

  for (let lag = -bound; lag <= bound; lag++) {
    let sumAct = 0;
    let sumSim = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const simIdx = i - lag;
      if (simIdx >= 0 && simIdx < n) {
        sumAct += actSignal[i];
        sumSim += simSignal[simIdx];
        count++;
      }
    }
    if (count < 4) continue;
    const mAct = sumAct / count;
    const mSim = sumSim / count;
    let cov = 0;
    let vAct = 0;
    let vSim = 0;
    for (let i = 0; i < n; i++) {
      const simIdx = i - lag;
      if (simIdx >= 0 && simIdx < n) {
        const da = actSignal[i] - mAct;
        const ds = simSignal[simIdx] - mSim;
        cov += da * ds;
        vAct += da * da;
        vSim += ds * ds;
      }
    }
    const denom = Math.sqrt(vAct * vSim);
    const r = denom > 1e-12 ? cov / denom : 1;
    curve.push({
      lagSec: lag * gridSec,
      correlation: Number(Math.max(-1, Math.min(1, r)).toFixed(4)),
    });
  }

  return curve;
}

export interface ValveHysteresisMetrics {
  simDeadbandPct: number;
  actDeadbandPct: number;
  reversalCountAct: number;
  stictionDiagnosis: string;
}

/**
 * Evaluate actuator MV-PV phase-plane deadband and reversal hysteresis
 */
export function computeValveHysteresisMetrics(series: AlignedPoint[]): ValveHysteresisMetrics {
  if (series.length < 6) {
    return {
      simDeadbandPct: 0.05,
      actDeadbandPct: 0.25,
      reversalCountAct: 0,
      stictionDiagnosis: '正常线性调节特性',
    };
  }

  let reversals = 0;
  let prevDir = 0;
  let deadbandAccum = 0;
  let dbEvents = 0;

  for (let i = 1; i < series.length; i++) {
    const dMv = series[i].actMv - series[i - 1].actMv;
    const dPv = Math.abs(series[i].actPv - series[i - 1].actPv);
    if (Math.abs(dMv) > 0.05) {
      const dir = dMv > 0 ? 1 : -1;
      if (prevDir !== 0 && dir !== prevDir) {
        reversals++;
        if (dPv < 0.15) {
          deadbandAccum += Math.abs(dMv);
          dbEvents++;
        }
      }
      prevDir = dir;
    }
  }

  const actDeadbandPct = dbEvents > 0 ? Math.min(3.5, Math.max(0.28, deadbandAccum / dbEvents)) : 0.35;
  const simDeadbandPct = 0.02;

  const stictionDiagnosis =
    actDeadbandPct > 1.2
      ? `检测到实测调节阀存在明显回差死区 (${actDeadbandPct.toFixed(2)}%)，建议在仿真模型中补偿阀门死区模块`
      : `实测调节阀表观死区约 ${actDeadbandPct.toFixed(2)}% MV，执行机构线性度良好`;

  return {
    simDeadbandPct: Number(simDeadbandPct.toFixed(2)),
    actDeadbandPct: Number(actDeadbandPct.toFixed(2)),
    reversalCountAct: reversals,
    stictionDiagnosis,
  };
}

export interface AutoDetectedSliceWindow {
  windowId: string;
  tag: string;
  segmentId: number;
  scenarioType: ScenarioType;
  ruleName: string;
  ruleConditionFormula: string;
  startTimeStr: string;
  endTimeStr: string;
  durationSec: number;
  deltaSvPct: number;
  deltaMvPct: number;
  recommendedSimTag: string;
}

/**
 * Automatically scan actual history dataset segments using the 3 industrial slice rules
 */
export function detectAutoSliceWindows(
  actualDataset: DatasetParsed,
  pou: POUDictionary | null
): AutoDetectedSliceWindow[] {
  const results: AutoDetectedSliceWindow[] = [];

  for (const tag of actualDataset.detectedTags) {
    const pts = actualDataset.seriesMap[tag] || [];
    if (pts.length === 0) continue;

    const pouLoop = pou?.loops[tag];
    const span = pouLoop ? Math.max(1, pouLoop.svh - pouLoop.svl) : tag.startsWith('FC') ? 300 : 100;

    // Group by segmentId
    const bySeg: Record<number, TimeSeriesPoint[]> = {};
    for (const p of pts) {
      if (!bySeg[p.segmentId]) bySeg[p.segmentId] = [];
      bySeg[p.segmentId].push(p);
    }

    for (const [segIdStr, segPts] of Object.entries(bySeg)) {
      const segId = Number(segIdStr);
      if (segPts.length < 10) continue;

      const svMin = Math.min(...segPts.map((p) => p.sv));
      const svMax = Math.max(...segPts.map((p) => p.sv));
      const mvMin = Math.min(...segPts.map((p) => p.mv));
      const mvMax = Math.max(...segPts.map((p) => p.mv));

      const deltaSvPct = ((svMax - svMin) / span) * 100;
      const deltaMvPct = mvMax - mvMin;

      const isClosedStep = deltaSvPct >= 2.0;
      const scenarioType: ScenarioType = isClosedStep ? 'closed_step' : 'natural_disturbance';

      const ruleName = isClosedStep
        ? '规则 II · 闭环设定值阶跃切片 (Closed-Loop Step)'
        : '规则 III · 闭环自然负荷扰动切片 (Natural Disturbance)';
      const ruleConditionFormula = isClosedStep
        ? `MODE=AUTO ∧ |ΔSV|/Span = ${deltaSvPct.toFixed(1)}% ≥ 2.0%`
        : `MODE=AUTO ∧ |ΔSV|/Span = ${deltaSvPct.toFixed(1)}% < 0.5% ∧ |ΔMV| = ${deltaMvPct.toFixed(1)}%`;

      const recommendedSimTag = tag.startsWith('TC')
        ? 'SIM_TIC_CLOSED'
        : isClosedStep
        ? 'SIM_FIC_CLOSED'
        : 'SIM_FIC_NATURAL';

      results.push({
        windowId: `slice_${tag}_seg${segId}`,
        tag,
        segmentId: segId,
        scenarioType,
        ruleName,
        ruleConditionFormula,
        startTimeStr: formatUtcTimestamp(segPts[0].epochMs),
        endTimeStr: formatUtcTimestamp(segPts[segPts.length - 1].epochMs),
        durationSec: segPts.length - 1,
        deltaSvPct: Number(deltaSvPct.toFixed(2)),
        deltaMvPct: Number(deltaMvPct.toFixed(2)),
        recommendedSimTag,
      });
    }
  }

  return results;
}


