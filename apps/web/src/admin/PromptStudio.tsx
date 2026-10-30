import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, FileText, History, RefreshCw, Search } from "lucide-react";
import type { ProductionPromptDefinition, ProductionPromptDetail, ProductionPromptDraft, ProductionPromptPreview, ProductionPromptSummary } from "@aifilm/shared";
import { api } from "../lib/api";
import { canLeaveAdminEditor } from "./adminDirtyState";
import { confirmAdminAction } from "./AdminConfirm";
import "./prompt-studio.css";

const stages: Record<string, string> = { analysis: "内容策划", strategy: "创作大纲", chapter: "章节正文", script: "剧本制作", entity: "实体提取", character: "角色资产", scene: "场景资产", storyboard: "分镜", video: "视频" };
const variableLabels: Record<string, string> = { intent: "标题 / 题材 / 参考", targetWords: "目标字数", chapterCount: "章节数量", styleProfile: "视觉风格", analysis: "分析结果", outline: "已确认大纲", previousHandoff: "前章交接", chapterGoal: "本章目标", characterState: "角色状态", content: "源文素材", episodes: "目标集数", ratio: "画幅", episodeNo: "当前集数", duration: "目标秒数" };
const samples: Record<string, string> = { intent: "雨夜书店的一封旧信", targetWords: "3000", chapterCount: "3", styleProfile: "暖色手绘；人物服装与场景一致", content: "林晚推开书店的门，把湿伞放在门边。她从书页里抽出一封信。\n林晚：这是谁留下的？\n店主摇头，望向窗外的雨。", episodes: "1", ratio: "9:16", episodeNo: "1", duration: "180", previousHandoff: "林晚留在书店，旧信尚未打开。", chapterGoal: "确认旧信来源；结尾保留信件内容的悬念。", characterState: "林晚：拿着未拆的信；店主：不知写信人。", outline: "林晚在雨夜书店发现一封旧信，通过信封地址寻找寄信人。", analysis: "以日常细节引入悬念，让人物选择推进剧情。" };
const draftOf = (definition: ProductionPromptDefinition): ProductionPromptDraft => ({ systemPrompt: definition.systemPrompt, userTemplate: definition.userTemplate });
const messageOf = (error: unknown) => error instanceof Error ? error.message : "请求失败，请重试";

export function PromptStudio() {
  const [items, setItems] = useState<ProductionPromptSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [keyword, setKeyword] = useState("");
  const [scope, setScope] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  async function load() {
    setLoading(true); setError("");
    try {
      const result = await api.productionPrompts();
      if (!mounted.current) return;
      setItems(result); setSelected(current => current || result.find(item => item.runtimeScope)?.key || result[0]?.key || "");
    } catch (error) { if (mounted.current) setError(messageOf(error)); }
    finally { if (mounted.current) setLoading(false); }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
  const visible = items.filter(item => (scope === "all" || Boolean(item.runtimeScope) === (scope === "connected")) && `${item.name} ${item.key} ${stages[item.stage]}`.toLowerCase().includes(keyword.toLowerCase()));
  return <div className="prompt-studio">
    <div className="prompt-studio-overview">
      <div><strong>{items.filter(item => item.runtimeScope).length}</strong><span>接入生成环节</span></div>
      <div><strong>{items.filter(item => item.activeVersionId).length}</strong><span>使用自定义版本</span></div>
      <div><strong>{items.filter(item => !item.runtimeScope).length}</strong><span>设计参考模板</span></div>
      <p>先预览结构，再保存版本。发布后仅影响新开始的生成，历史产物保留原版本。</p>
    </div>
    {error ? <div className="prompt-notice error" role="alert">{error}<button type="button" className="admin-text-btn" disabled={loading} onClick={() => void load()}>重新读取目录</button></div> : null}
    {loading && !items.length ? <p role="status">正在读取提示词目录…</p> : null}
    <div className="prompt-studio-layout">
      <aside className="prompt-studio-rail" aria-label="生成提示词目录">
        <label className="prompt-search"><Search size={16} /><input aria-label="搜索生成提示词" placeholder="搜索名称或阶段" value={keyword} onChange={event => setKeyword(event.target.value)} /></label>
        <select aria-label="提示词接入状态" value={scope} onChange={event => setScope(event.target.value)}><option value="all">全部模板 · {items.length}</option><option value="connected">已接入生成</option><option value="reference">设计参考</option></select>
        <div className="prompt-studio-catalog">
          {visible.map(item => <button key={item.key} type="button" aria-pressed={selected === item.key} onClick={() => { if (item.key === selected || canLeaveAdminEditor()) setSelected(item.key); }}>
            <small>{stages[item.stage]}<span className={item.runtimeScope ? "connected" : ""}>{item.runtimeScope ? "已接入" : "参考"}</span></small>
            <strong>{item.name}</strong><span>{item.activeVersionId ? `自定义 · ${item.activeVersion.split("+").at(-1)}` : `内置 ${item.builtinVersion}`}</span>
          </button>)}
          {!loading && !visible.length ? <p className="prompt-empty">没有匹配模板。可调整关键词或接入状态。</p> : null}
        </div>
      </aside>
      {selected ? <PromptDetailLoader key={selected} promptKey={selected} onSummary={next => setItems(current => current.map(item => item.key === next.key ? next : item))} /> : null}
    </div>
  </div>;
}

function PromptDetailLoader({ promptKey, onSummary }: { promptKey: string; onSummary: (item: ProductionPromptSummary) => void }) {
  const [detail, setDetail] = useState<ProductionPromptDetail>();
  const [error, setError] = useState("");
  const alive = useRef(true);
  async function load() {
    const next = await api.productionPrompt(promptKey);
    if (alive.current) { setDetail(next); onSummary(next); setError(""); }
    return next;
  }
  useEffect(() => { alive.current = true; void load().catch(error => { if (alive.current) setError(messageOf(error)); }); return () => { alive.current = false; }; }, [promptKey]);
  return detail ? <PromptEditor detail={detail} reload={load} /> : <div className="prompt-studio-editor">
    {error ? <div role="alert" className="prompt-notice error">{error}<button className="admin-text-btn" onClick={() => void load().catch(error => setError(messageOf(error)))}>重试读取模板</button></div> : <p role="status">正在读取模板…</p>}
  </div>;
}

function PromptEditor({ detail, reload }: { detail: ProductionPromptDetail; reload: () => Promise<ProductionPromptDetail> }) {
  const [base, setBase] = useState(detail.effective);
  const [draft, setDraft] = useState(() => draftOf(detail.effective));
  const [selectedId, setSelectedId] = useState<string | null>(detail.activeVersionId);
  const [notes, setNotes] = useState("");
  const [tab, setTab] = useState("editor");
  const [variables, setVariables] = useState(() => Object.fromEntries(detail.builtin.variables.map(key => [key, samples[key] ?? `请填写${key}示例`])));
  const [preview, setPreview] = useState<ProductionPromptPreview>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const attempt = useRef<{ signature: string; id: string } | undefined>(undefined);
  const dirty = draft.systemPrompt !== base.systemPrompt || draft.userTemplate !== base.userTemplate || notes !== "";
  const connected = Boolean(detail.runtimeScope);
  const isActive = selectedId === detail.activeVersionId;
  function pick(definition: ProductionPromptDefinition, id: string | null) {
    if (dirty && !canLeaveAdminEditor()) return;
    setBase(definition); setDraft(draftOf(definition)); setSelectedId(id); setNotes(""); setPreview(undefined); setNotice(""); setError("");
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  }
  async function save() {
    const signature = JSON.stringify({ draft, notes });
    if (attempt.current?.signature !== signature) attempt.current = { signature, id: crypto.randomUUID() };
    const saved = await api.saveProductionPrompt(detail.key, { ...draft, notes, expectedRevision: detail.revision, requestId: attempt.current.id });
    // A saved version is durable even if the following refresh fails.
    setNotes(""); setBase({ ...base, ...draft, version: `${detail.builtinVersion}+custom.${saved.number}` }); setSelectedId(saved.id);
    setNotice(`版本 ${saved.number} 已保存，尚未发布。请核对后发布到生成环节。`);
    const next = await reload();
    const version = next.versions.find(item => item.id === saved.id);
    if (version) { setBase(version.definition); setDraft(draftOf(version.definition)); }
    setNotice(`版本 ${saved.number} 已保存，尚未发布。请核对后发布到生成环节。`);
  }
  async function activate() {
    if (!await confirmAdminAction(`将“${detail.name}”切换为${selectedId ? base.version : "内置版本"}。${detail.runtimeScope}的新生成将使用此版本，正在运行的任务与历史产物不变。`, { title: selectedId ? "发布生成提示词" : "恢复内置提示词", confirmLabel: selectedId ? "发布版本" : "恢复内置" })) return;
    await api.activateProductionPrompt(detail.key, selectedId, detail.revision);
    await reload(); setNotice("生效版本已更新，后续新生成将使用此版本。");
  }
  return <article className="prompt-studio-editor" aria-busy={busy} data-admin-dirty={dirty || undefined}>
    <header className="prompt-studio-head">
      <div><span className="prompt-eyebrow">{stages[detail.stage]} / {connected ? "生产模板" : "设计参考"}</span><h2>{detail.name}</h2><p>{detail.runtimeScope ?? "此模板尚未接入实际生成，当前仅供设计与结构预览。"}</p></div>
      <button className="admin-secondary-btn compact" type="button" disabled={busy} onClick={() => void run(async () => { await reload(); setNotice("已刷新生效状态，编辑内容保留。"); })}><RefreshCw size={14} />刷新版本</button>
    </header>
    <div className="prompt-live-status"><Check size={16} /><span>{connected ? "当前生效" : "参考版本"} <strong>{detail.activeVersion}</strong></span><span>{dirty ? "有未保存修改" : isActive ? "正在查看当前版本" : "正在查看候选版本"}</span></div>
    {detail.compatibilityError ? <div role="alert" className="prompt-notice error">{detail.compatibilityError}</div> : null}
    {error ? <div role="alert" className="prompt-notice error">{error}</div> : null}
    {notice ? <div role="status" className="prompt-notice">{notice}</div> : null}
    <div className="admin-section-tabs prompt-editor-tabs" aria-label="模板工作区">
      <button aria-pressed={tab === "editor"} onClick={() => setTab("editor")}><FileText size={14} />指令与契约</button>
      <button aria-pressed={tab === "preview"} onClick={() => setTab("preview")}>变量预览</button>
      <button aria-pressed={tab === "versions"} onClick={() => setTab("versions")}><History size={14} />版本记录</button>
    </div>
    {tab === "editor" ? <div className="prompt-edit-body">
      <label><span>系统指令 <small>{draft.systemPrompt.length} 字符</small></span><textarea disabled={busy} readOnly={!connected} rows={9} value={draft.systemPrompt} onChange={event => { setDraft({ ...draft, systemPrompt: event.target.value }); setPreview(undefined); }} /></label>
      <label><span>用户模板 <small>保留所有必需变量</small></span><textarea disabled={busy} readOnly={!connected} rows={5} value={draft.userTemplate} onChange={event => { setDraft({ ...draft, userTemplate: event.target.value }); setPreview(undefined); }} /></label>
      <div className="prompt-variable-chips" aria-label="必需变量">{detail.builtin.variables.map(key => <code key={key}>{`{{${key}}}`}</code>)}</div>
      <details className="prompt-contract"><summary>输出契约与质量规则 <span>{Object.keys(detail.builtin.outputSchema).length} 个字段</span></summary>
        <p>这些约束随应用发布，保存自定义指令时继续保留，供生成解析器使用。</p>
        <dl>{Object.entries(detail.builtin.outputSchema).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>
        <strong>必须满足</strong><ul>{detail.builtin.validationRules.map(rule => <li key={rule}>{rule}</li>)}</ul>
        <strong>避免出现</strong><ul>{detail.builtin.negativeRules.map(rule => <li key={rule}>{rule}</li>)}</ul>
      </details>
    </div> : null}
    {tab === "preview" ? <div className="prompt-preview-body">
      <p>填入样例检查变量替换与完整指令。此预览不调用模型、不扣积分；不代表生成质量已验收。</p>
      <div className="prompt-sample-grid">{detail.builtin.variables.map(key => <label key={key}><span>{variableLabels[key] ?? key}</span><textarea rows={2} disabled={busy} value={variables[key]} onChange={event => { setVariables({ ...variables, [key]: event.target.value }); setPreview(undefined); }} /></label>)}</div>
      <button className="admin-secondary-btn" disabled={busy} onClick={() => void run(async () => setPreview(await api.previewProductionPrompt(detail.key, draft, variables)))}>检查并预览</button>
      {preview ? <div className="prompt-rendered" aria-label="渲染预览"><strong>完整指令 · {preview.characters.toLocaleString()} 字符</strong><h3>系统指令</h3><pre>{preview.systemPrompt}</pre><h3>用户输入</h3><pre>{preview.userPrompt}</pre></div> : null}
    </div> : null}
    {tab === "versions" ? <div className="prompt-version-body">
      <p>已保存版本不可覆盖。编辑后保存为新版本；选取历史版本可重新发布。展示最近 50 个版本，并保留当前生效版本，共 {detail.totalVersions} 个自定义版本。</p>
      <div className="prompt-version-row"><div><strong>内置 {detail.builtinVersion}</strong><span>{!detail.activeVersionId ? "当前生效" : "随应用提供的基线"}</span></div><button className="admin-text-btn" disabled={busy} onClick={() => pick(detail.builtin, null)}>查看内置</button></div>
      {detail.versions.map(version => <div className="prompt-version-row" key={version.id}><div><strong>自定义版本 {version.number} {detail.activeVersionId === version.id ? "· 当前生效" : ""}</strong><span>{version.notes}</span><small>{new Date(version.createdAt).toLocaleString("zh-CN")}</small></div><button className="admin-text-btn" disabled={busy} onClick={() => pick(version.definition, version.id)}>查看版本 {version.number}</button></div>)}
      {!detail.totalVersions ? <p className="prompt-empty">还没有自定义版本，可从内置指令开始编辑。</p> : null}
    </div> : null}
    {connected ? <footer className="prompt-save-bar">
      <label><span>修改说明</span><input disabled={busy} maxLength={800} placeholder="说明改动目的，保存后用于版本追溯" value={notes} onChange={event => setNotes(event.target.value)} /></label>
      <div><span>{selectedId ? `候选：${base.version}` : `候选：内置 ${detail.builtinVersion}`}</span><div className="prompt-save-actions">
        <button className="admin-secondary-btn" disabled={busy || !notes.trim()} onClick={() => void run(save)}>保存新版本</button>
        <button className="admin-primary-btn" disabled={busy || dirty || isActive} onClick={() => void run(activate)}><ArrowUpRight size={15} />{selectedId ? "发布此版本" : "恢复内置"}</button>
      </div></div>
    </footer> : <p className="prompt-reference-note">设计参考可以预览。正式接入生成前不提供发布操作。</p>}
  </article>;
}
