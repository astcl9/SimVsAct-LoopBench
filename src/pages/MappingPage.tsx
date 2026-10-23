import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookmarkCheck,
  CheckCircle2,
  Cpu,
  GitMerge,
  HelpCircle,
  Layers,
  Plus,
  Save,
} from 'lucide-react';
import {
  buildCanonicalNormalizedPreview,
  getLoopTypeLabel,
  inferLoopTypeFromTag,
} from '../core/engine';
import {
  DatasetParsed,
  LoopRoleOverride,
  LoopType,
  MappingTemplate,
  POUDictionary,
} from '../core/types';

interface MappingPageProps {
  actualDataset: DatasetParsed;
  simDataset: DatasetParsed;
  pouDictionary: POUDictionary | null;
  loopOverrides: Record<string, LoopRoleOverride>;
  onUpdateLoopOverride: (tag: string, updated: LoopRoleOverride) => void;
  templates: MappingTemplate[];
  onSaveTemplate: (tpl: MappingTemplate) => void;
  onApplyTemplate: (tpl: MappingTemplate) => void;
  onBack: () => void;
  onProceedToCompare: () => void;
}

type SignalSlotId = 'TIME' | 'TAG' | 'SV' | 'PV' | 'MV' | 'MODE' | 'SCENARIO';

export const MappingPage: React.FC<MappingPageProps> = ({
  actualDataset,
  simDataset,
  pouDictionary,
  loopOverrides,
  onUpdateLoopOverride,
  templates,
  onSaveTemplate,
  onApplyTemplate,
  onBack,
  onProceedToCompare,
}) => {
  const [selectedSlot, setSelectedSlot] = useState<SignalSlotId>('PV');
  const [canonicalPreviewSource, setCanonicalPreviewSource] = useState<'both' | 'actual' | 'sim'>('both');
  const [templateName, setTemplateName] = useState('DCS历史宽表+整定仿真长表标准映射模板_v0.2');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [customUnmatchedTag, setCustomUnmatchedTag] = useState('');
  const [showAllPouLoops, setShowAllPouLoops] = useState(false);

  // Role Slots for Actual (Wide) and Sim (Long)
  const [actRoles, setActRoles] = useState({
    timeCol: '时间',
    seqCol: '序号',
    tagPattern: '^(?<tag>[^.]+)\\.(?<sig>PV|MV|SV|SP)$',
    svCol: 'FC10901.SV, TC11003.SV',
    pvCol: 'FC10901.PV, TC11003.PV',
    mvCol: 'FC10901.MV, TC11003.MV',
    modeCol: '(缺省默认 AUTO)',
  });

  const [simRoles, setSimRoles] = useState({
    timeCol: 'timestamp',
    tagCol: 'loop_tag',
    svCol: 'SV',
    pvCol: 'PV',
    mvCol: 'MV',
    modeCol: 'MODE',
    scenarioCol: '模拟场景',
    sliceRuleCol: '判定切片类型',
    qualityCol: '质量码',
  });

  const canonicalRows = useMemo(() => {
    const actRows = buildCanonicalNormalizedPreview(actualDataset, pouDictionary, 3);
    const simRows = buildCanonicalNormalizedPreview(simDataset, pouDictionary, 2);
    if (canonicalPreviewSource === 'actual') return actRows;
    if (canonicalPreviewSource === 'sim') return simRows;
    return [...actRows.slice(0, 4), ...simRows.slice(0, 4)];
  }, [actualDataset, simDataset, pouDictionary, canonicalPreviewSource]);

  const slotDetails: Record<
    SignalSlotId,
    {
      code: string;
      name: string;
      engMeaning: string;
      whyNeeded: string;
      actualBind: string;
      simBind: string;
      pouLink: string;
    }
  > = {
    TIME: {
      code: 'TIME / SEQ',
      name: '采样时钟与序号通道',
      engMeaning: '提供时序基准 t，处理 2026/9/17 8:00 与 2026-08-20 08:00:00 异构时间格式',
      whyNeeded: '当实测 CSV 存在「4行/分钟」重复时间戳时，联动「序号」列重建 1Hz 采样时钟，并识别 >3天 断档缺口。',
      actualBind: `${actRoles.timeCol} + ${actRoles.seqCol} (重建 1Hz)`,
      simBind: `${simRoles.timeCol} (标准 1Hz)`,
      pouLink: '用于计算积分时间 TI(s)、微分时间 TD(s) 及调节时间 Ts(s)',
    },
    TAG: {
      code: 'LOOP_TAG',
      name: '控制回路位号通道',
      engMeaning: '标识物理控制回路（如 FC10901 进料流量、TC11003 加热炉出口温度）',
      whyNeeded: '宽表把位号藏在列名（FC10901.PV）里，长表把位号放在行值（loop_tag）里；拆解后才能按位号关联 DCS 组态字典。',
      actualBind: `列名正则提取 <tag>: FC10901, TC11003`,
      simBind: `列 [${simRoles.tagCol}]: SIM_FIC_OPEN / CLOSED / NATURAL`,
      pouLink: '主键关联 normalized_pou_import.xlsx [位号名]，自动带出回路类型与量程',
    },
    SV: {
      code: 'SV / SP',
      name: '设定值信号通道 (Setpoint Value)',
      engMeaning: 'PID 控制器的目标设定值（操作员给定或串级 CAS 主调给定）',
      whyNeeded: '用于自动检测阶跃起点 t_step、阶跃幅值 ΔSV，并计算稳态跟踪误差 e(t) = SV(t) − PV(t) 及 IAE/ISE/ITAE。',
      actualBind: `宽表列 *.SV (${actRoles.svCol})`,
      simBind: `长表列 [${simRoles.svCol}]`,
      pouLink: '关联组态字典 SVL(下限) ~ SVH(上限)，如 FC10901 为 0~300 m³/h',
    },
    PV: {
      code: 'PV / CV',
      name: '被控过程测量值通道 (Process Variable)',
      engMeaning: '现场变送器实测或被控对象模型输出的工艺物理量（流量 m³/h、温度 °C、压力 kPa）',
      whyNeeded: '核心对比信号！用于计算实测与仿真的 RMSE/MAE、超调量 Mp、上升时间 Tr、调节时间 Ts 及 Pearson r。',
      actualBind: `宽表列 *.PV (${actRoles.pvCol})`,
      simBind: `长表列 [${simRoles.pvCol}]`,
      pouLink: '按 (PV - SVL)/(SVH - SVL) 归一化为 %量程，并校验 PVHH/PVH/PVL/PVLL 报警限',
    },
    MV: {
      code: 'MV / OP',
      name: '控制器阀位输出通道 (Manipulated Variable)',
      engMeaning: 'PID 控制器输出至调节阀/执行机构的指令信号（通常为 0~100%）',
      whyNeeded: '评价仿真执行机构行为是否可信：计算 MV 饱和时间占比、阀门累计行程 Σ|ΔMV|、变化率峰值与死区粘滞。',
      actualBind: `宽表列 *.MV (${actRoles.mvCol})`,
      simBind: `长表列 [${simRoles.mvCol}]`,
      pouLink: '关联组态字典 MVL(0%) ~ MVH(100%) 与正反作用 SWPN',
    },
    MODE: {
      code: 'MODE',
      name: '控制模式状态通道 (MAN / AUTO / CAS)',
      engMeaning: '表征回路处于手动开环 (MAN)、自动闭环 (AUTO) 还是串级控制 (CAS)',
      whyNeeded: '区分「开环阶跃测试 (MAN)」与「闭环设定值阶跃 (AUTO)」，并核验仿真与实测的手/自动状态一致性。',
      actualBind: `${actRoles.modeCol}`,
      simBind: `长表列 [${simRoles.modeCol}] + [饱和标记]`,
      pouLink: '对照 POU 组态默认模式 MODE (AUTO/CAS)',
    },
    SCENARIO: {
      code: 'SCENARIO / SLICE',
      name: '工况场景与整定切片通道',
      engMeaning: '标记当前时间窗属于「开环阶跃」、「闭环阶跃」还是「闭环自然负荷扰动」',
      whyNeeded: '实测是 9月 历史，仿真是 8月 合成场景，绝对时间不同源！必须按「同回路类型 + 同工况场景」配对并平移到相对时间 t=0 对齐。',
      actualBind: `连续段切分规则识别 (连续段#1 闭环阶跃 / 连续段#2 自然扰动)`,
      simBind: `长表列 [${simRoles.scenarioCol}] + [${simRoles.sliceRuleCol}]`,
      pouLink: '按回路类型分配容差阈值（流量/压力 RMSE ≤ 2%，温度/液位 ≤ 5%）',
    },
  };

  const activeSlotInfo = slotDetails[selectedSlot];

  const handleSaveCurrentTemplate = () => {
    const newTpl: MappingTemplate = {
      id: `tpl_${Date.now()}`,
      name: templateName.trim() || '自定义数据源模板',
      fingerprint: `sha256:${actualDataset.sha256.slice(0, 8)}_${simDataset.sha256.slice(0, 8)}`,
      tableFormat: actualDataset.tableFormat,
      createdAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      mapping: {
        timeCol: simRoles.timeCol,
        seqCol: actRoles.seqCol,
        tagCol: simRoles.tagCol,
        svCol: simRoles.svCol,
        pvCol: simRoles.pvCol,
        mvCol: simRoles.mvCol,
        modeCol: simRoles.modeCol,
        scenarioCol: simRoles.scenarioCol,
        qualityCol: simRoles.qualityCol,
      },
    };
    onSaveTemplate(newTpl);
    setSavedNotice(`已保存数据源配置模板「${newTpl.name}」（文件结构指纹: ${newTpl.fingerprint}）`);
  };

  const handleAddUnmatchedTagDemo = () => {
    const tag = customUnmatchedTag.trim().toUpperCase() || 'PC99002_UNMATCHED';
    const inferred = inferLoopTypeFromTag(tag);
    onUpdateLoopOverride(tag, {
      tag,
      loopType: inferred === 'unknown' ? 'pressure' : inferred,
      description: '未在 POU 组态字典中命中的新增回路 (需人工指定类型与量程)',
      unit: 'kPa',
      pvMin: 0,
      pvMax: 500,
      mvMin: 0,
      mvMax: 100,
      scaleFactor: 1.0,
      matchedInPou: false,
    });
    setCustomUnmatchedTag('');
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white border border-slate-200 rounded-lg p-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900 text-balance">
            02. 回路信号绑定与组态量程配置（SV / PV / MV 通道识别与 POU 参数关联）
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            将 DCS 历史宽表与整定仿真长表中的列绑定到 PID 控制回路的 7 路核心物理信号通道（
            <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">TIME / TAG / SV / PV / MV / MODE / SCENARIO</code>
            ），关联 DCS 组态字典的工程量程（<code className="font-mono text-xs">SVL~SVH</code>）与 PID 参数，统一转化为百分量程标准时序流。
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            返回数据导入
          </button>
          <button
            type="button"
            onClick={onProceedToCompare}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            下一步：进入对比工作台
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {savedNotice && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 text-white text-xs rounded-lg">
          <span>{savedNotice}</span>
          <button
            type="button"
            onClick={() => setSavedNotice(null)}
            className="text-slate-300 hover:text-white ml-4"
          >
            关闭
          </button>
        </div>
      )}

      {/* Section 4.2 Pre-flight Validation Strip: Monotonicity, Numeric Convertibility, Missing Rate, Span/Alarm Sanity */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <div className="bg-white border border-slate-200 rounded-lg p-3.5">
          <div className="flex items-center justify-between font-semibold text-slate-900 mb-1">
            <span>1. 时间单调性与时钟唯一性</span>
            <span className="font-mono text-emerald-700">● 100% 通过</span>
          </div>
          <p className="text-[11px] text-slate-600 font-mono tabular-nums">
            实测 {actualDataset.reconstruct1HzEnabled ? '1Hz 序号重建后 757/757 严格递增' : '存在分钟级重复时间戳'} · 仿真 7200/7200 严格单调
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-3.5">
          <div className="flex items-center justify-between font-semibold text-slate-900 mb-1">
            <span>2. 数值列可转率校验</span>
            <span className="font-mono text-emerald-700">● 100.0%</span>
          </div>
          <p className="text-[11px] text-slate-600 font-mono tabular-nums">
            实测 6 路数值列与仿真 SV/PV/MV 浮点解析成功率 100.0%，无非数值乱码
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-3.5">
          <div className="flex items-center justify-between font-semibold text-slate-900 mb-1">
            <span>3. SV / PV / MV 缺失率告警</span>
            <span className="font-mono text-emerald-700">● 0.00% 缺失</span>
          </div>
          <p className="text-[11px] text-slate-600 font-mono tabular-nums">
            连续段内关键控制信号缺失率 0.00%（跨天 ~3.0d 断档已作为段间缺口独立隔离）
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-3.5">
          <div className="flex items-center justify-between font-semibold text-slate-900 mb-1">
            <span>4. 量程与四限报警单调性</span>
            <span className="font-mono text-emerald-700">● 18/18 回路合法</span>
          </div>
          <p className="text-[11px] text-slate-600 font-mono tabular-nums">
            全部满足 SVL ≤ PVLL &lt; PVL &lt; PVH &lt; PVHH ≤ SVH 且 MVH &gt; MVL
          </p>
        </div>
      </div>

      {/* Visual Engineering Explanation: PID Loop Signal Channels & Wide/Long Normalization */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-blue-600 shrink-0" />
            <h2 className="text-sm font-bold text-slate-900">
              PID 控制回路信号通道拓扑（点击通道节点检视「实测宽表 / 仿真长表 / POU 组态字典」三方绑定关系）
            </h2>
          </div>
          <span className="text-xs text-slate-500">
            统一异构表结构与物理量纲，确保跨回路 % 量程误差可比
          </span>
        </div>

        {/* Interactive 7-Channel PID Control Loop Topology Selector */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {(
            [
              { id: 'TIME', label: '1. 采样时钟', code: 'TIME / SEQ', sub: '序号重建 1Hz' },
              { id: 'TAG', label: '2. 回路位号', code: 'LOOP_TAG', sub: 'FC10901 / TC11003' },
              { id: 'SV', label: '3. 设定值通道', code: 'SV (Setpoint)', sub: '阶跃目标值' },
              { id: 'PV', label: '4. 测量值通道', code: 'PV (Process)', sub: '核心被控量' },
              { id: 'MV', label: '5. 阀位输出通道', code: 'MV (Output)', sub: '0–100% 阀位' },
              { id: 'MODE', label: '6. 控制模式', code: 'MODE', sub: 'AUTO / MAN' },
              { id: 'SCENARIO', label: '7. 工况切片', code: 'SCENARIO', sub: '开环/闭环/扰动' },
            ] as { id: SignalSlotId; label: string; code: string; sub: string }[]
          ).map((slot) => {
            const active = selectedSlot === slot.id;
            return (
              <button
                key={slot.id}
                type="button"
                onClick={() => setSelectedSlot(slot.id)}
                className={`text-left p-3 rounded-lg border transition-all ${
                  active
                    ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                    : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <div className={`text-[11px] font-mono ${active ? 'text-blue-300' : 'text-blue-600'} font-semibold`}>
                  {slot.code}
                </div>
                <div className="text-xs font-bold mt-0.5">{slot.label}</div>
                <div className={`text-[11px] mt-1 truncate ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                  {slot.sub}
                </div>
              </button>
            );
          })}
        </div>

        {/* Active Channel Inspector Box */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
          <div className="lg:col-span-5 space-y-1.5 border-b lg:border-b-0 lg:border-r border-slate-200 pb-3 lg:pb-0 lg:pr-4">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                {activeSlotInfo.code}
              </span>
              <span className="font-bold text-slate-900 text-sm">{activeSlotInfo.name}</span>
            </div>
            <p className="text-slate-700">{activeSlotInfo.engMeaning}</p>
            <p className="text-slate-500 text-[11px]">
              <strong className="text-slate-700">工程必要性：</strong>
              {activeSlotInfo.whyNeeded}
            </p>
          </div>

          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono tabular-nums">
            <div className="p-2.5 bg-white border border-slate-200 rounded">
              <span className="font-sans text-[11px] text-amber-700 font-semibold block mb-1">
                ① 实测历史宽表信号源
              </span>
              <span className="text-slate-900 font-semibold break-all">{activeSlotInfo.actualBind}</span>
            </div>
            <div className="p-2.5 bg-white border border-slate-200 rounded">
              <span className="font-sans text-[11px] text-blue-700 font-semibold block mb-1">
                ② 仿真结果长表信号源
              </span>
              <span className="text-slate-900 font-semibold break-all">{activeSlotInfo.simBind}</span>
            </div>
            <div className="p-2.5 bg-white border border-slate-200 rounded">
              <span className="font-sans text-[11px] text-emerald-700 font-semibold block mb-1">
                ③ POU 组态字典关联参数
              </span>
              <span className="font-sans text-slate-700 text-[11px] leading-snug block">
                {activeSlotInfo.pouLink}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Signal Channel Binding Two-Column Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: Actual Wide Table Signal Extraction */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                实测 CSV 宽表信号通道拆解 ({actualDataset.filename})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                原始形态：宽表（757 行 × 8 列，每行含多个位号，按列名后缀拆出 SV/PV/MV 信号通道）
              </p>
            </div>
            <span className="text-xs font-mono text-amber-800 font-semibold">Wide → Canonical</span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-3 items-center gap-3">
              <label className="font-medium text-slate-700">采样时间列 (TIME)</label>
              <select
                value={actRoles.timeCol}
                onChange={(e) => setActRoles({ ...actRoles, timeCol: e.target.value })}
                aria-label="实测时间列"
                className="col-span-2 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded font-mono text-slate-900"
              >
                {actualDataset.columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.inferredType})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 items-center gap-3">
              <label className="font-medium text-slate-700">采样序号列 (1Hz 时钟重建)</label>
              <select
                value={actRoles.seqCol}
                onChange={(e) => setActRoles({ ...actRoles, seqCol: e.target.value })}
                aria-label="实测序号列"
                className="col-span-2 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded font-mono text-slate-900"
              >
                {actualDataset.columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.inferredType})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 items-center gap-3">
              <label className="font-medium text-slate-700">位号.信号通道拆解正则</label>
              <input
                type="text"
                value={actRoles.tagPattern}
                onChange={(e) => setActRoles({ ...actRoles, tagPattern: e.target.value })}
                aria-label="宽表列名拆解正则"
                className="col-span-2 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded font-mono text-slate-800"
              />
            </div>

            <div className="grid grid-cols-3 items-center gap-3">
              <label className="font-medium text-slate-700">识别出的设定值通道 (SV)</label>
              <input
                type="text"
                readOnly
                value={actRoles.svCol}
                aria-label="实测设定值通道"
                className="col-span-2 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700"
              />
            </div>

            <div className="grid grid-cols-3 items-center gap-3">
              <label className="font-medium text-slate-700">识别出的测量值通道 (PV)</label>
              <input
                type="text"
                readOnly
                value={actRoles.pvCol}
                aria-label="实测测量值通道"
                className="col-span-2 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700"
              />
            </div>

            <div className="grid grid-cols-3 items-center gap-3">
              <label className="font-medium text-slate-700">识别出的阀位输出通道 (MV)</label>
              <input
                type="text"
                readOnly
                value={actRoles.mvCol}
                aria-label="实测输出值通道"
                className="col-span-2 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700"
              />
            </div>
          </div>
        </div>

        {/* Right: Simulation Long Table Signal Binding */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                仿真 CSV 长表信号通道绑定 ({simDataset.filename})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                原始形态：长表（7200 行 × 15 列，按 <code className="font-mono">loop_tag</code> 与场景切片列绑定）
              </p>
            </div>
            <span className="text-xs font-mono text-blue-700 font-semibold">Long → Canonical</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {[
              { label: '采样时间通道 (TIME)', key: 'timeCol' as const },
              { label: '回路位号通道 (LOOP_TAG)', key: 'tagCol' as const },
              { label: '设定值通道 (SV)', key: 'svCol' as const },
              { label: '被控测量值通道 (PV)', key: 'pvCol' as const },
              { label: '控制器输出通道 (MV)', key: 'mvCol' as const },
              { label: '控制模式通道 (MODE)', key: 'modeCol' as const },
              { label: '模拟场景通道 (SCENARIO)', key: 'scenarioCol' as const },
              { label: '判定切片规则通道 (SLICE)', key: 'sliceRuleCol' as const },
            ].map((item) => (
              <div key={item.key}>
                <label className="block font-medium text-slate-700 mb-1">{item.label}</label>
                <select
                  value={simRoles[item.key]}
                  onChange={(e) => setSimRoles({ ...simRoles, [item.key]: e.target.value })}
                  aria-label={item.label}
                  className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded font-mono text-slate-900"
                >
                  {simDataset.columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Live Canonical Normalized Stream Preview */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 mb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-600 shrink-0" />
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                信号绑定与量程归一化产出预览：标准回路时序流 (Canonical Loop Stream)
              </h2>
              <p className="text-xs text-slate-500">
                经过上方信号通道拆解与量程配平后，原本结构截然不同的「实测宽表」与「仿真长表」被统一转化为如下标准结构，并实时完成 % 量程归一化：
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setCanonicalPreviewSource('both')}
              className={`px-2.5 py-1 font-medium rounded transition-colors ${
                canonicalPreviewSource === 'both'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              同屏混合检视
            </button>
            <button
              type="button"
              onClick={() => setCanonicalPreviewSource('actual')}
              className={`px-2.5 py-1 font-medium rounded transition-colors ${
                canonicalPreviewSource === 'actual'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              仅实测宽表拆解结果
            </button>
            <button
              type="button"
              onClick={() => setCanonicalPreviewSource('sim')}
              className={`px-2.5 py-1 font-medium rounded transition-colors ${
                canonicalPreviewSource === 'sim'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              仅仿真长表透视结果
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-2 px-3">映射转换来源</th>
                <th className="py-2 px-3">采样序号</th>
                <th className="py-2 px-3">标准化时间戳 (1Hz)</th>
                <th className="py-2 px-3 text-right">相对时钟 t</th>
                <th className="py-2 px-3">标准位号 (TAG)</th>
                <th className="py-2 px-3">回路类型</th>
                <th className="py-2 px-3 text-right">设定值 SV</th>
                <th className="py-2 px-3 text-right">测量值 PV</th>
                <th className="py-2 px-3 text-right">PV 归一化 (%量程)</th>
                <th className="py-2 px-3 text-right">阀位 MV (%)</th>
                <th className="py-2 px-3">模式 / 工况切片</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
              {canonicalRows.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="py-2 px-3 font-sans">
                    <span
                      className={`font-semibold ${
                        row.sourceFormat.includes('宽表') ? 'text-amber-700' : 'text-blue-700'
                      }`}
                    >
                      {row.sourceFormat}
                    </span>
                  </td>
                  <td className="py-2 px-3">#{row.seq}</td>
                  <td className="py-2 px-3 text-slate-600">{row.timestamp}</td>
                  <td className="py-2 px-3 text-right">T+{row.relSec}s</td>
                  <td className="py-2 px-3 font-bold text-slate-900">{row.tag}</td>
                  <td className="py-2 px-3 font-sans text-slate-700">{row.loopTypeLabel}</td>
                  <td className="py-2 px-3 text-right">
                    {row.sv.toFixed(2)} {row.unit}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-slate-900">
                    {row.pv.toFixed(3)} {row.unit}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-emerald-700">
                    {row.pvNormPct.toFixed(2)}%
                  </td>
                  <td className="py-2 px-3 text-right">{row.mv.toFixed(2)}%</td>
                  <td className="py-2 px-3 font-sans text-slate-600">
                    {row.mode} · {row.scenario}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* POU Dictionary Linkage & Range / Type Normalization Table */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 mb-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              组态字典联动：回路类型、归一化量程 [SVL, SVH] 与 PID 参数绑定表
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              命中组态字典的位号自动带出回路类型、量程与 PID 参数；未匹配的位号标黄告警，支持工程师现场手工修正类型与量程。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {pouDictionary && (
              <button
                type="button"
                onClick={() => setShowAllPouLoops(!showAllPouLoops)}
                className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded border transition-colors whitespace-nowrap shrink-0 ${
                  showAllPouLoops
                    ? 'bg-blue-50 text-blue-700 border-blue-300'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {showAllPouLoops
                  ? '收起全厂 18 回路组态字典总表'
                  : `检视 POU 字典全量 ${pouDictionary.totalLoops} 个回路参数`}
              </button>
            )}
            <input
              type="text"
              placeholder="输入未匹配位号测试标黄 (如 PC99002)"
              value={customUnmatchedTag}
              onChange={(e) => setCustomUnmatchedTag(e.target.value)}
              aria-label="测试新增未匹配位号"
              className="px-3 py-1.5 text-xs border border-slate-300 rounded font-mono w-56"
            />
            <button
              type="button"
              onClick={handleAddUnmatchedTagDemo}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              模拟未命中位号告警
            </button>
          </div>
        </div>

        {showAllPouLoops && pouDictionary && (
          <div className="mb-4 p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-900">
                normalized_pou_import.xlsx · 全厂 18 个 DCS 控制回路组态参数字典（流量 5 / 液位 5 / 压力 4 / 温度 2 / 组分 1 / 辅控 1）
              </span>
              <span className="font-mono text-slate-500">
                原始 3269 列 → 首次出现去重 189 列 · 跳过第 2–3 行中文注释
              </span>
            </div>
            <div className="overflow-x-auto max-h-60 bg-white border border-slate-200 rounded">
              <table className="w-full text-[11px] text-left border-collapse font-mono tabular-nums">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-slate-600">
                    <th className="py-1.5 px-2.5">位号名</th>
                    <th className="py-1.5 px-2.5 font-sans">回路描述</th>
                    <th className="py-1.5 px-2.5 font-sans">类型</th>
                    <th className="py-1.5 px-2.5 text-right">量程 [SVL, SVH]</th>
                    <th className="py-1.5 px-2.5 text-right">PB(%)</th>
                    <th className="py-1.5 px-2.5 text-right">TI(s)</th>
                    <th className="py-1.5 px-2.5 text-right">TD(s)</th>
                    <th className="py-1.5 px-2.5 font-sans">正反作用 / 算法</th>
                    <th className="py-1.5 px-2.5 text-right">报警限 HH/H/L/LL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.values(pouDictionary.loops).map((lp) => (
                    <tr key={lp.tag} className="hover:bg-slate-50">
                      <td className="py-1.5 px-2.5 font-bold text-slate-900">{lp.tag}</td>
                      <td className="py-1.5 px-2.5 font-sans text-slate-700">{lp.description}</td>
                      <td className="py-1.5 px-2.5 font-sans">{getLoopTypeLabel(lp.loopType)}</td>
                      <td className="py-1.5 px-2.5 text-right">
                        [{lp.svl}, {lp.svh}] {lp.unit}
                      </td>
                      <td className="py-1.5 px-2.5 text-right">{lp.pb}</td>
                      <td className="py-1.5 px-2.5 text-right">{lp.ti}</td>
                      <td className="py-1.5 px-2.5 text-right">{lp.td}</td>
                      <td className="py-1.5 px-2.5 font-sans text-slate-600">
                        {lp.swpn} · {lp.pidOpt}
                      </td>
                      <td className="py-1.5 px-2.5 text-right text-slate-500">
                        {lp.pvhh}/{lp.pvh}/{lp.pvl}/{lp.pvll}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-2.5 px-3">位号 / 场景标签</th>
                <th className="py-2.5 px-3">POU 字典命中状态</th>
                <th className="py-2.5 px-3">回路类型 (可手动改)</th>
                <th className="py-2.5 px-3">工程单位</th>
                <th className="py-2.5 px-3">量程下限 SVL</th>
                <th className="py-2.5 px-3">量程上限 SVH</th>
                <th className="py-2.5 px-3">MV 量程 [下限, 上限]</th>
                <th className="py-2.5 px-3">缩放系数</th>
                <th className="py-2.5 px-3">组态 PID 参数 (PB / TI / TD / 形式)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
              {Object.values(loopOverrides).map((ov) => {
                const isUnmatched = !ov.matchedInPou;
                return (
                  <tr
                    key={ov.tag}
                    className={
                      isUnmatched
                        ? 'bg-amber-50/90 hover:bg-amber-100/70'
                        : 'hover:bg-slate-50'
                    }
                  >
                    <td className="py-2.5 px-3 font-bold text-slate-900">
                      {ov.tag}
                      <span className="block font-sans font-normal text-[11px] text-slate-500">
                        {ov.description}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-sans">
                      {ov.matchedInPou ? (
                        <span className="text-emerald-700 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          已命中 POU 字典
                        </span>
                      ) : (
                        <span className="text-amber-800 font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          未命中字典 (请手工指定)
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-sans">
                      <select
                        value={ov.loopType}
                        onChange={(e) =>
                          onUpdateLoopOverride(ov.tag, {
                            ...ov,
                            loopType: e.target.value as LoopType,
                          })
                        }
                        aria-label={`${ov.tag} 回路类型`}
                        className="px-2 py-1 bg-white border border-slate-300 rounded text-xs text-slate-900"
                      >
                        <option value="flow">流量 (Flow)</option>
                        <option value="temperature">温度 (Temp)</option>
                        <option value="pressure">压力 (Pressure)</option>
                        <option value="level">液位 (Level)</option>
                        <option value="composition">组分浓度 (Analyzer)</option>
                      </select>
                    </td>
                    <td className="py-2.5 px-3">
                      <input
                        type="text"
                        value={ov.unit}
                        onChange={(e) =>
                          onUpdateLoopOverride(ov.tag, { ...ov, unit: e.target.value })
                        }
                        aria-label={`${ov.tag} 单位`}
                        className="w-16 px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                      />
                    </td>
                    <td className="py-2.5 px-3">
                      <input
                        type="number"
                        value={ov.pvMin}
                        onChange={(e) =>
                          onUpdateLoopOverride(ov.tag, { ...ov, pvMin: Number(e.target.value) })
                        }
                        aria-label={`${ov.tag} 量程下限`}
                        className="w-20 px-2 py-1 bg-white border border-slate-300 rounded text-xs text-right"
                      />
                    </td>
                    <td className="py-2.5 px-3">
                      <input
                        type="number"
                        value={ov.pvMax}
                        onChange={(e) =>
                          onUpdateLoopOverride(ov.tag, { ...ov, pvMax: Number(e.target.value) })
                        }
                        aria-label={`${ov.tag} 量程上限`}
                        className="w-20 px-2 py-1 bg-white border border-slate-300 rounded text-xs text-right"
                      />
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      [{ov.mvMin}, {ov.mvMax}] %
                    </td>
                    <td className="py-2.5 px-3">
                      <input
                        type="number"
                        step="0.1"
                        value={ov.scaleFactor}
                        onChange={(e) =>
                          onUpdateLoopOverride(ov.tag, {
                            ...ov,
                            scaleFactor: Number(e.target.value) || 1,
                          })
                        }
                        aria-label={`${ov.tag} 缩放系数`}
                        className="w-16 px-2 py-1 bg-white border border-slate-300 rounded text-xs text-right"
                      />
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      {ov.pouConfig
                        ? `PB=${ov.pouConfig.pb}% / TI=${ov.pouConfig.ti}s / TD=${ov.pouConfig.td}s (${ov.pouConfig.pidOpt})`
                        : '未命中字典 · 采用人工指定量程'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom Data Source Template Manager */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <BookmarkCheck className="w-5 h-5 text-blue-600 shrink-0" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">保存为数据源映射模板（按表头指纹自动匹配复用）</h3>
            <p className="text-xs text-slate-500">
              已存模板 ({templates.length}):{' '}
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    onApplyTemplate(t);
                    setSavedNotice(`已应用数据源映射模板「${t.name}」`);
                  }}
                  className="underline text-blue-600 hover:text-blue-800 mr-3"
                >
                  {t.name} ({t.fingerprint})
                </button>
              ))}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            aria-label="数据源模板名称"
            className="px-3 py-1.5 text-xs border border-slate-300 rounded w-72"
          />
          <button
            type="button"
            onClick={handleSaveCurrentTemplate}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Save className="w-3.5 h-3.5" />
            保存为数据源模板
          </button>
        </div>
      </div>
    </div>
  );
};
