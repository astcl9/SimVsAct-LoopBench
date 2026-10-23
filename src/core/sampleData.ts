import { parseCsvTextToDataset, parsePouTableRows } from './engine';
import { DatasetParsed, PairItem, POUDictionary } from './types';

/**
 * Deterministic second-order underdamped step response generator for realistic PID loop physics
 */
function secondOrderStepResponse(
  t: number,
  tStep: number,
  y0: number,
  deltaY: number,
  wn: number,
  zeta: number
): number {
  if (t <= tStep) return y0;
  const tau = t - tStep;
  if (zeta < 1) {
    const wd = wn * Math.sqrt(1 - zeta * zeta);
    const phi = Math.acos(zeta);
    const env = Math.exp(-zeta * wn * tau) / Math.sqrt(1 - zeta * zeta);
    return y0 + deltaY * (1 - env * Math.sin(wd * tau + phi));
  }
  // Critically or overdamped
  return y0 + deltaY * (1 - (1 + wn * tau) * Math.exp(-wn * tau));
}

/**
 * Generate the authentic 21-row POU Configuration Dictionary (`normalized_pou_import.xlsx` Sheet: `PID`)
 * - Row 1: Header (with duplicate columns like PVHHPR repeated)
 * - Row 2-3: Chinese parameter annotations (SWPN 正/反作用, PID_OPT 标准/微分先行)
 * - Row 4-21: 18 loops (Flow 5, Level 5, Pressure 4, Temperature 2, Composition 1, + 1 = 18 rows)
 */
export function generateSamplePouRows(): (string | number)[][] {
  const baseHeaders = [
    '位号名',
    '位号描述',
    'PB',
    'TI',
    'TD',
    'KD',
    'SVH',
    'SVL',
    'MVH',
    'MVL',
    'PVHH',
    'PVH',
    'PVL',
    'PVLL',
    'MODE',
    'SWPN',
    'PID_OPT',
    'UNIT',
    'PVHHPR',
    'PVHHPR', // Repeated column demonstration
    'PVHPR',
    'PVHPR',
  ];

  const commentRow1 = [
    '回路位号标识',
    '工艺控制点中文说明',
    '比例带(%)',
    '积分时间(s)',
    '微分时间(s)',
    '微分增益',
    '设定值上限',
    '设定值下限',
    '输出上限(%)',
    '输出下限(%)',
    '高高报限值',
    '高报限值',
    '低报限值',
    '低低报限值',
    '默认手自动模式',
    'SWPN: 正作用/反作用',
    'PID_OPT: 标准PID/微分先行',
    '工程单位',
    '高高报优先级(重复列)',
    '高高报优先级(重复列2)',
    '高报优先级',
    '高报优先级(重复列2)',
  ];

  const commentRow2 = [
    '主键唯一按首次出现取值',
    'DCS组态导出描述',
    '范围 1.0~1000.0',
    '范围 0.1~3600',
    '范围 0~600',
    '默认 1.0',
    '工程量上限',
    '工程量下限',
    '阀位上限',
    '阀位下限',
    '联锁高高限',
    '报警高限',
    '报警低限',
    '联锁低低限',
    'AUTO/MAN/CAS',
    '0=反作用,1=正作用',
    '0=标准PID,1=微分先行',
    '物理量纲',
    '忽略重复列',
    '忽略重复列',
    '忽略重复列',
    '忽略重复列',
  ];

  const loopRows: (string | number)[][] = [
    // 5 Flow loops (including FC10901 with 0-300 range)
    ['FC10901', '进料主管流量调节回路', 82.0, 18.0, 0.0, 1.0, 300, 0, 100, 0, 285, 260, 30, 15, 'AUTO', '反作用', '标准PID', 'm³/h', 3, 99, 2, 99],
    ['FC10902', '回流泵出口流量控制', 75.0, 15.0, 0.0, 1.0, 250, 0, 100, 0, 240, 220, 25, 10, 'AUTO', '反作用', '标准PID', 'm³/h', 3, 99, 2, 99],
    ['FC10903', '急冷氢支路流量控制', 90.0, 20.0, 0.0, 1.0, 180, 0, 100, 0, 170, 155, 20, 10, 'AUTO', '反作用', '标准PID', 'm³/h', 3, 99, 2, 99],
    ['FC10904', '塔顶循环水流量调节', 68.0, 16.0, 0.0, 1.0, 400, 0, 100, 0, 380, 350, 40, 20, 'AUTO', '反作用', '标准PID', 'm³/h', 3, 99, 2, 99],
    ['FC10905', '燃料气主管流量回路', 85.0, 22.0, 0.0, 1.0, 120, 0, 100, 0, 112, 105, 15, 8, 'AUTO', '反作用', '标准PID', 'Nm³/h', 3, 99, 2, 99],

    // 5 Level loops
    ['LC10101', '闪蒸罐液位控制回路', 120.0, 180.0, 0.0, 1.0, 100, 0, 100, 0, 90, 80, 20, 10, 'AUTO', '正作用', '标准PID', '%', 2, 99, 1, 99],
    ['LC10102', '分馏塔釜液位调节', 110.0, 210.0, 0.0, 1.0, 100, 0, 100, 0, 92, 82, 18, 8, 'AUTO', '正作用', '标准PID', '%', 2, 99, 1, 99],
    ['LC10103', '回流罐界位控制回路', 95.0, 150.0, 0.0, 1.0, 100, 0, 100, 0, 88, 78, 22, 12, 'AUTO', '正作用', '标准PID', '%', 2, 99, 1, 99],
    ['LC10104', '汽包液位三冲量主调', 80.0, 120.0, 5.0, 1.0, 100, 0, 100, 0, 85, 75, 25, 15, 'CAS', '反作用', '微分先行', '%', 3, 99, 2, 99],
    ['LC10105', '凝液收集罐液位控制', 130.0, 240.0, 0.0, 1.0, 100, 0, 100, 0, 90, 80, 20, 10, 'AUTO', '正作用', '标准PID', '%', 2, 99, 1, 99],

    // 4 Pressure loops
    ['PC10301', '反应器顶部压力控制', 55.0, 25.0, 2.0, 1.0, 500, 0, 100, 0, 475, 450, 80, 50, 'AUTO', '正作用', '标准PID', 'kPa', 3, 99, 2, 99],
    ['PC10302', '精馏塔顶压力调节回路', 60.0, 30.0, 0.0, 1.0, 350, 0, 100, 0, 330, 310, 60, 40, 'AUTO', '正作用', '标准PID', 'kPa', 3, 99, 2, 99],
    ['PC10303', '燃料气缓冲罐压力控制', 50.0, 20.0, 0.0, 1.0, 600, 0, 100, 0, 570, 540, 120, 90, 'AUTO', '反作用', '标准PID', 'kPa', 3, 99, 2, 99],
    ['PC10304', '中压蒸汽管网压力回路', 65.0, 28.0, 1.5, 1.0, 4200, 0, 100, 0, 4050, 3900, 3200, 3000, 'AUTO', '反作用', '标准PID', 'kPa', 3, 99, 2, 99],

    // 2 Temperature loops (including TC11003 with 0-100 range)
    ['TC11003', '加热炉出口温度主控制', 45.0, 65.0, 12.0, 1.2, 100, 0, 100, 0, 92, 85, 25, 15, 'AUTO', '反作用', '微分先行', '°C', 3, 99, 2, 99],
    ['TC11004', '精馏塔灵敏板温度调节', 52.0, 85.0, 15.0, 1.0, 200, 0, 100, 0, 185, 175, 65, 50, 'CAS', '反作用', '微分先行', '°C', 3, 99, 2, 99],

    // 1 Composition loop + 1 Hand/Auxiliary controller = 18 loops total (Rows 4..21: Flow 5, Level 5, Pressure 4, Temp 2, Comp 1)
    ['AC12001', '塔顶产品纯度在线分析控制', 140.0, 320.0, 30.0, 1.0, 100, 0, 100, 0, 99.5, 99.0, 92.0, 90.0, 'CAS', '反作用', '微分先行', 'mol%', 2, 99, 1, 99],
    ['HC13001', '反应器旁路手操辅助调节回路', 100.0, 60.0, 0.0, 1.0, 100, 0, 100, 0, 95, 85, 15, 5, 'MAN', '反作用', '标准PID', '%', 2, 99, 1, 99],
  ];

  return [baseHeaders, commentRow1, commentRow2, ...loopRows];
}

/**
 * Generate the authentic 757-row Wide Table Actual History CSV (`history_FC10901andTC11003_sec.csv`)
 * - 757 rows × 8 cols: 序号, 时间, FC10901.SV, FC10901.PV, FC10901.MV, TC11003.SV, TC11003.PV, TC11003.MV
 * - Pitfall 1: Minute-level timestamps repeated 4 rows per minute in raw string (`2026/9/17 8:00`) while `序号` is 1..757 at 1 Hz
 * - Pitfall 2: ~3-day data gap between row 400 (`2026-09-17 08:06:39`) and row 401 (`2026-09-20 08:00:40`)
 */
export function generateSampleActualCsvText(): string {
  const header = '序号,时间,FC10901.SV,FC10901.PV,FC10901.MV,TC11003.SV,TC11003.PV,TC11003.MV';
  const rows: string[] = [header];

  // Segment 1: 400 rows (i = 0..399) -> Closed-loop step response
  for (let i = 0; i < 400; i++) {
    const seq = i + 1;
    // Pitfall 1: every 4 rows share the same minute timestamp string `2026/9/17 8:XX`
    const minuteIdx = Math.floor(i / 4);
    const hh = 8 + Math.floor(minuteIdx / 60);
    const mm = minuteIdx % 60;
    const rawTimeStr = `2026/9/17 ${hh}:${String(mm).padStart(2, '0')}`;

    // FC10901 (0-300 m3/h): Step at t=20s from 150 to 210
    const fcSv = i < 20 ? 150.0 : 210.0;
    const fcPvIdeal = secondOrderStepResponse(i, 20, 150.0, 60.0, 0.085, 0.52);
    // Add slight deterministic measurement dynamics & minor noise within ±2% band
    const fcNoise = Math.sin(i * 0.37) * 0.42 + Math.cos(i * 0.91) * 0.18;
    const fcPv = fcPvIdeal + (i >= 20 ? 1.15 * Math.exp(-(i - 20) / 70) * Math.sin((i - 20) * 0.11) : 0) + fcNoise;
    const fcErr = fcSv - fcPv;
    const fcMv = Math.min(100, Math.max(0, 50 + (fcSv - 150) * 0.36 + fcErr * 0.42));

    // TC11003 (0-100 °C): Step at t=30s from 60 to 75
    const tcSv = i < 30 ? 60.0 : 75.0;
    const tcPvIdeal = secondOrderStepResponse(i, 30, 60.0, 15.0, 0.042, 0.64);
    const tcNoise = Math.sin(i * 0.23) * 0.12 + Math.cos(i * 0.67) * 0.08;
    const tcPv = tcPvIdeal - (i >= 30 ? 0.55 * Math.exp(-(i - 30) / 90) : 0) + tcNoise;
    const tcErr = tcSv - tcPv;
    const tcMv = Math.min(100, Math.max(0, 58 + (tcSv - 60) * 0.95 + tcErr * 0.55));

    rows.push(
      `${seq},${rawTimeStr},${fcSv.toFixed(2)},${fcPv.toFixed(3)},${fcMv.toFixed(2)},${tcSv.toFixed(2)},${tcPv.toFixed(3)},${tcMv.toFixed(2)}`
    );
  }

  // Segment 2: 357 rows (i = 0..356, seq = 401..757) -> After ~3 days gap (2026-09-20 08:00:40 -> 08:06:36)
  // Natural disturbance & open-loop step behavior
  for (let j = 0; j < 357; j++) {
    const seq = 401 + j;
    const minuteIdx = Math.floor(j / 4);
    const hh = 8 + Math.floor(minuteIdx / 60);
    const mm = minuteIdx % 60;
    const rawTimeStr = `2026/9/20 ${hh}:${String(mm).padStart(2, '0')}`;

    // FC10901 natural load disturbance rejection around SV = 180
    const fcSv = 180.0;
    const distPulse =
      j >= 25 ? 24.0 * Math.exp(-(j - 25) / 55) * Math.sin((j - 25) * 0.09) : 0;
    const fcNoise = Math.sin(j * 0.43) * 0.45;
    const fcPv = 180.0 + distPulse + fcNoise;
    const fcMv = Math.min(100, Math.max(0, 60.0 - distPulse * 0.52 + Math.cos(j * 0.31) * 0.3));

    // TC11003 natural disturbance around SV = 72
    const tcSv = 72.0;
    const tcDist = j >= 30 ? 6.5 * Math.exp(-(j - 30) / 75) * Math.sin((j - 30) * 0.06) : 0;
    const tcPv = 72.0 + tcDist + Math.sin(j * 0.29) * 0.16;
    const tcMv = Math.min(100, Math.max(0, 68.0 - tcDist * 0.85));

    rows.push(
      `${seq},${rawTimeStr},${fcSv.toFixed(2)},${fcPv.toFixed(3)},${fcMv.toFixed(2)},${tcSv.toFixed(2)},${tcPv.toFixed(3)},${tcMv.toFixed(2)}`
    );
  }

  return rows.join('\n');
}

/**
 * Generate the authentic 7200-row × 15-col Long Table Simulation CSV (`三类整定切片规则模拟结果.csv`)
 * - 7200 rows × 15 cols
 * - UTF-8 with BOM
 * - Time: 2026-08-20 08:00:00 -> 10:39:59, 1s sampling
 * - Scenarios: SIM_FIC_CLOSED (闭环阶跃), SIM_FIC_OPEN (开环阶跃), SIM_FIC_NATURAL (闭环自然扰动), plus SIM_TIC_CLOSED (温度闭环阶跃)
 */
export function generateSampleSimCsvText(): string {
  const header =
    'timestamp,loop_tag,SV,PV,MV,MODE,模拟场景,判定切片类型,切片起止标记,饱和标记,PB,TI,TD,噪声水平,质量码';
  const rows: string[] = [header];

  const baseEpoch = Date.UTC(2026, 7, 20, 8, 0, 0); // 2026-08-20 08:00:00
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmtTs = (secOffset: number) => {
    const d = new Date(baseEpoch + secOffset * 1000);
    return `2026-08-20 ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  };

  // We generate 7200 rows total across 4 loop_tag scenarios (1800 rows each = 7200 rows)
  // 1. SIM_FIC_CLOSED (Flow Closed-Loop Step, 1800 rows)
  for (let i = 0; i < 1800; i++) {
    const ts = fmtTs(i);
    const sv = i < 20 ? 150.0 : 210.0;
    const pv = secondOrderStepResponse(i, 20, 150.0, 60.0, 0.088, 0.55);
    const err = sv - pv;
    const mv = Math.min(100, Math.max(0, 50 + (sv - 150) * 0.36 + err * 0.44));
    const sliceFlag = i === 20 ? 'START' : i === 380 ? 'END' : 'IN_WINDOW';
    const satFlag = mv >= 99.5 || mv <= 0.5 ? 1 : 0;
    rows.push(
      `${ts},SIM_FIC_CLOSED,${sv.toFixed(2)},${pv.toFixed(3)},${mv.toFixed(2)},AUTO,闭环设定值阶跃,闭环阶跃切片,${sliceFlag},${satFlag},80.0,19.0,0.0,0.002,GOOD`
    );
  }

  // 2. SIM_FIC_OPEN (Flow Open-Loop Step, 1800 rows)
  for (let i = 0; i < 1800; i++) {
    const ts = fmtTs(1800 + i);
    const sv = i < 20 ? 150.0 : 210.0;
    const mv = i < 20 ? 50.0 : 71.6;
    const pv = secondOrderStepResponse(i, 20, 150.0, 60.0, 0.072, 0.78);
    const sliceFlag = i === 20 ? 'START' : i === 380 ? 'END' : 'IN_WINDOW';
    rows.push(
      `${ts},SIM_FIC_OPEN,${sv.toFixed(2)},${pv.toFixed(3)},${mv.toFixed(2)},MAN,开环MV阶跃测试,开环阶跃切片,${sliceFlag},0,82.0,18.0,0.0,0.001,GOOD`
    );
  }

  // 3. SIM_FIC_NATURAL (Flow Closed-Loop Natural Disturbance, 1800 rows)
  for (let i = 0; i < 1800; i++) {
    const ts = fmtTs(3600 + i);
    const sv = 180.0;
    const dist = i >= 25 ? 22.5 * Math.exp(-(i - 25) / 52) * Math.sin((i - 25) * 0.09) : 0;
    const pv = 180.0 + dist;
    const mv = Math.min(100, Math.max(0, 60.0 - dist * 0.5));
    const sliceFlag = i === 25 ? 'START' : i === 340 ? 'END' : 'IN_WINDOW';
    rows.push(
      `${ts},SIM_FIC_NATURAL,${sv.toFixed(2)},${pv.toFixed(3)},${mv.toFixed(2)},AUTO,闭环自然负荷扰动,闭环自然扰动切片,${sliceFlag},0,80.0,19.0,0.0,0.002,GOOD`
    );
  }

  // 4. SIM_TIC_CLOSED (Temperature Closed-Loop Step matching TC11003, 1800 rows)
  for (let i = 0; i < 1800; i++) {
    const ts = fmtTs(5400 + i);
    const sv = i < 30 ? 60.0 : 75.0;
    const pv = secondOrderStepResponse(i, 30, 60.0, 15.0, 0.044, 0.68);
    const err = sv - pv;
    const mv = Math.min(100, Math.max(0, 58 + (sv - 60) * 0.95 + err * 0.52));
    const sliceFlag = i === 30 ? 'START' : i === 390 ? 'END' : 'IN_WINDOW';
    rows.push(
      `${ts},SIM_TIC_CLOSED,${sv.toFixed(2)},${pv.toFixed(3)},${mv.toFixed(2)},AUTO,温度闭环阶跃响应,闭环阶跃切片,${sliceFlag},0,48.0,62.0,12.0,0.001,GOOD`
    );
  }

  return rows.join('\n');
}

/**
 * Build complete default sample bundle (Actual Dataset + Sim Dataset + POU Dictionary + Default Pairings)
 */
export function buildSamplePlatformBundle(reconstruct1Hz = true): {
  actualDataset: DatasetParsed;
  simDataset: DatasetParsed;
  pouDictionary: POUDictionary;
  defaultPairs: PairItem[];
} {
  const actualCsv = generateSampleActualCsvText();
  const simCsv = generateSampleSimCsvText();
  const pouRows = generateSamplePouRows();

  const actualDataset = parseCsvTextToDataset(
    actualCsv,
    'history_FC10901andTC11003_sec.csv',
    'actual',
    {
      encoding: 'GBK（无 BOM）',
      score: 0.985,
      chineseHeaderRatio: 0.25,
    },
    reconstruct1Hz
  );

  const simDataset = parseCsvTextToDataset(
    simCsv,
    '三类整定切片规则模拟结果.csv',
    'sim',
    {
      encoding: 'UTF-8 with BOM',
      score: 0.998,
      chineseHeaderRatio: 0.42,
    },
    false
  );

  const pouDictionary = parsePouTableRows(pouRows, 'normalized_pou_import.xlsx', 'PID', 3269);

  const defaultPairs: PairItem[] = [
    {
      id: 'pair_fc_closed',
      name: 'FC10901 (连续段#1) ↔ SIM_FIC_CLOSED (闭环阶跃)',
      actualTag: 'FC10901',
      actualSegmentId: 1,
      simKey: 'SIM_FIC_CLOSED',
      simTag: 'SIM_FIC_CLOSED',
      scenarioName: '闭环设定值阶跃 (Closed-Loop Step)',
      scenarioType: 'closed_step',
      scenario: 'closed_step',
      loopType: 'flow',
      pvSpan: [0, 300],
      mvSpan: [0, 100],
      unit: 'm³/h',
      cascadeRole: 'slave',
      linkedPairId: 'pair_tc_closed',
      masterTag: 'TC11003',
      slaveTag: 'FC10901',
    },
    {
      id: 'pair_fc_natural',
      name: 'FC10901 (连续段#2) ↔ SIM_FIC_NATURAL (闭环自然扰动)',
      actualTag: 'FC10901',
      actualSegmentId: 2,
      simKey: 'SIM_FIC_NATURAL',
      simTag: 'SIM_FIC_NATURAL',
      scenarioName: '闭环自然负荷扰动 (Natural Disturbance)',
      scenarioType: 'natural_disturbance',
      scenario: 'natural_disturbance',
      loopType: 'flow',
      pvSpan: [0, 300],
      mvSpan: [0, 100],
      unit: 'm³/h',
      cascadeRole: 'slave',
      linkedPairId: 'pair_tc_closed',
      masterTag: 'TC11003',
      slaveTag: 'FC10901',
    },
    {
      id: 'pair_fc_open',
      name: 'FC10901 (连续段#1) ↔ SIM_FIC_OPEN (开环阶跃对照)',
      actualTag: 'FC10901',
      actualSegmentId: 1,
      simKey: 'SIM_FIC_OPEN',
      simTag: 'SIM_FIC_OPEN',
      scenarioName: '开环MV阶跃测试 (Open-Loop Step)',
      scenarioType: 'open_step',
      scenario: 'open_step',
      loopType: 'flow',
      pvSpan: [0, 300],
      mvSpan: [0, 100],
      unit: 'm³/h',
      cascadeRole: 'standalone',
    },
    {
      id: 'pair_tc_closed',
      name: 'TC11003 (连续段#1) ↔ SIM_TIC_CLOSED (温度闭环阶跃)',
      actualTag: 'TC11003',
      actualSegmentId: 1,
      simKey: 'SIM_TIC_CLOSED',
      simTag: 'SIM_TIC_CLOSED',
      scenarioName: '温度闭环阶跃响应 (Closed-Loop Step)',
      scenarioType: 'closed_step',
      scenario: 'closed_step',
      loopType: 'temperature',
      pvSpan: [0, 100],
      mvSpan: [0, 100],
      unit: '°C',
      cascadeRole: 'master',
      linkedPairId: 'pair_fc_closed',
      masterTag: 'TC11003',
      slaveTag: 'FC10901',
    },
  ];

  return {
    actualDataset,
    simDataset,
    pouDictionary,
    defaultPairs,
  };
}
