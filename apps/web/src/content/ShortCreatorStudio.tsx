import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ClipboardList, RefreshCw, Save, Sparkles } from "lucide-react";
import type { ContentProjectSummary, CreatorAgentState, CreatorBrief, CreatorQuote, CreatorScriptDetails, ModelPrice, ModelProvider, StoryFact } from "@aifilm/shared";
import { creatorApi } from "../lib/creatorApi";
import { contentApi } from "../lib/contentApi";
import { BEFORE_CREATOR_NAVIGATION } from "../lib/creatorNavigation";
import { ModelRoutePicker } from "../components/ModelRoutePicker";
import { buildModelCatalog, defaultModelRoute } from "../components/modelCatalog";
import { StatePanel } from "../design-system/ui";
import type { ShortEntry } from "./CreatorWelcome";
import "./short-creator.css";

const initialBrief: CreatorBrief = { format: "short", intent: "", material: "idea", durationSeconds: 30, audience: "喜欢短故事的观众", emotion: "温暖与惊喜", mustKeep: "", fidelity: "faithful" };
const sample = "深夜便利店里，店员为一位每天买两份饭的老人多留一双筷子。直到某天老人只买了一份，店员才发现，另一份一直是留给流浪猫的。结尾让猫第一次走进灯光里。";
const styles = [{ key: "anime_jp", name: "日系动漫", category: "动漫 · 2D", summary: "清晰线条，赛璐珞上色" }, { key: "donghua_3d", name: "3D 国漫", category: "国漫 · 3D", summary: "东方美学，柔和光影" }, { key: "cinematic_real", name: "电影写实", category: "写实 · 影视", summary: "自然光影，电影叙事" }];
const statusNames: Record<string, string> = { pending: "计划已保存", running: "正在创作", awaiting_review: "等待作者审阅", needs_repair: "需要修订", completed: "作者已确认", failed: "已停止", unknown: "结果待核对", canceled: "已结束", draft: "待审阅", confirmed: "作者已确认", stale: "依据已变化", succeeded: "已完成" };
const message = (error: unknown) => error instanceof Error ? error.message : "操作未完成，请重新读取状态后核对。";
function readDraft<T>(key: string): T | null {
  try { return JSON.parse(sessionStorage.getItem(key) || "null") as T | null; } catch { return null; }
}
function writeDraft(key: string, value: unknown) { try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Navigation guards remain active without storage. */ } }
const sameBrief = (a: CreatorBrief, b: CreatorBrief | null) => Boolean(b && Object.keys(a).every(key => a[key as keyof CreatorBrief] === b[key as keyof CreatorBrief]));
type Draft = { brief: CreatorBrief; title: string; source: string; route: { providerId: string; model: string }; style: string; requestId: string };
type Edit = { scriptId: string; content: string; note: string; details?: CreatorScriptDetails };

export function ShortCreatorStudio({ userId, project, entry, providers, modelPrices, onBack, onSelect, onEnterProduction, onReload }: {
  userId: string; project?: ContentProjectSummary; entry: ShortEntry; providers: ModelProvider[]; modelPrices: ModelPrice[];
  onBack?: () => void; onSelect: (id: string) => void; onEnterProduction: (id: string) => void | Promise<void>; onReload: () => Promise<void>;
}) {
  const draftKey = `manjiao:short:${userId}:${project?.id ?? entry}`;
  const [form, setForm] = useState<Draft>(() => readDraft<Draft>(draftKey) ?? {
    brief: project?.brief ?? { ...initialBrief, material: entry === "story" ? "story" : "idea", intent: entry === "sample" ? sample : "" },
    title: project?.title ?? (entry === "sample" ? "灯光里的第二份晚饭" : ""), source: "", requestId: crypto.randomUUID(),
    route: project ? { providerId: project.textProvider, model: project.textModel } : defaultModelRoute(providers, "text", modelPrices),
    style: project?.styleProfile.key ?? styles[0].key
  });
  const [state, setState] = useState<CreatorAgentState | null>(null);
  const [editor, setEditor] = useState<Edit | null>(() => project ? readDraft<Edit>(`${draftKey}:script`) : null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [maxCalls, setMaxCalls] = useState(1);
  const [feedback, setFeedback] = useState(() => readDraft<string>(`${draftKey}:feedback`) ?? "");
  const [savedRoute, setSavedRoute] = useState(form.route);
  const [quote, setQuote] = useState<CreatorQuote | null>(null);
  const [compareId, setCompareId] = useState("");
  const [supplierChecked, setSupplierChecked] = useState(false);
  const [nextTitle, setNextTitle] = useState("");
  const [nextIntent, setNextIntent] = useState("");
  const [factOpen, setFactOpen] = useState(false);
  const [briefExpanded, setBriefExpanded] = useState(true);
  const [dirtyFacts, setDirtyFacts] = useState<Set<string>>(() => new Set());
  const alive = useRef(true);
  const inFlight = useRef(false);
  const allowNavigation = useRef(false);
  const latest = state?.scripts[0];
  const currentContent = editor?.content ?? latest?.content ?? "";
  const scriptDirty = Boolean(editor && (editor.scriptId !== latest?.id || editor.content !== latest.content || editor.note || editor.details && JSON.stringify(editor.details) !== JSON.stringify(latest?.details)));
  const briefDirty = project ? Boolean(state && !sameBrief(form.brief, state.brief)) : Boolean(form.title || form.brief.intent || form.source);
  const routeDirty = Boolean(project && (form.route.providerId !== savedRoute.providerId || form.route.model !== savedRoute.model));
  const guard = useRef({ dirty: false, busy: false });
  guard.current = { dirty: briefDirty || scriptDirty || routeDirty || dirtyFacts.size > 0 || Boolean(feedback || nextTitle || nextIntent), busy: Boolean(busy) };
  const activeRun = state?.runs.find(run => ["pending", "running", "unknown"].includes(run.status));
  const modelReady = buildModelCatalog(providers, modelPrices).some(item => item.provider.id === form.route.providerId && item.model === form.route.model && item.selectable);
  const canReview = Boolean(latest && latest.status !== "stale" && (!editor || editor.scriptId === latest.id) && !briefDirty);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!project) return;
    let active = true;
    void creatorApi.state(project.id).then(value => { if (active) setState(value); }).catch(reason => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, [project?.id]);
  useEffect(() => { writeDraft(draftKey, form); }, [draftKey, form]);
  useEffect(() => { writeDraft(`${draftKey}:script`, editor); }, [draftKey, editor]);
  useEffect(() => { writeDraft(`${draftKey}:feedback`, feedback || null); }, [draftKey, feedback]);
  useEffect(() => { if (project) setSavedRoute({ providerId: project.textProvider, model: project.textModel }); }, [project?.textProvider, project?.textModel]);
  useEffect(() => {
    const navigation = (event: Event) => {
      if (allowNavigation.current) return;
      if (guard.current.busy && busy !== "generate") { event.preventDefault(); setNotice("正在保存，请稍候再离开。"); return; }
      if (guard.current.dirty && !window.confirm("当前有未保存内容。草稿会尽可能保留在此浏览器标签页，确认离开？")) event.preventDefault();
    };
    const unload = (event: BeforeUnloadEvent) => { if (guard.current.dirty || guard.current.busy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener(BEFORE_CREATOR_NAVIGATION, navigation);
    window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener(BEFORE_CREATOR_NAVIGATION, navigation); window.removeEventListener("beforeunload", unload); };
  }, [busy]);
  useEffect(() => {
    if (!project || !activeRun || activeRun.status !== "running") return;
    let active = true;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void creatorApi.state(project.id).then(value => { if (active) setState(value); }).catch(() => undefined);
    }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [project?.id, activeRun?.id, activeRun?.status]);
  useEffect(() => { if (project && latest) void creatorApi.event(project.id, "creator_script_viewed").catch(() => undefined); }, [project?.id, latest?.id]);
  useEffect(() => { if (latest) setBriefExpanded(false); }, [latest?.id]);

  function change(update: Partial<Draft>) { setForm(value => ({ ...value, ...update, requestId: crypto.randomUUID() })); setQuote(null); }
  function changeBrief(update: Partial<CreatorBrief>) { change({ brief: { ...form.brief, ...update } }); }
  function factDirty(id: string, dirty = true) { setDirtyFacts(previous => { const value = new Set(previous); if (dirty) value.add(id); else value.delete(id); return value; }); }
  async function saveFactDraft(input: Parameters<typeof creatorApi.fact>[1], fact?: StoryFact) {
    await act("fact", async () => {
      await creatorApi.fact(project!.id, input, fact?.id);
      writeDraft(`${draftKey}:fact:${fact?.id ?? "new"}`, null);
      factDirty(fact?.id ?? "new", false);
      await refresh();
      if (!fact && alive.current) setFactOpen(false);
    });
  }
  async function act(label: string, fn: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(label); setError(""); setNotice("");
    try { await fn(); } catch (reason) { if (alive.current) setError(message(reason)); }
    finally { inFlight.current = false; if (alive.current) setBusy(""); }
  }
  async function refresh() {
    if (!project) return;
    const value = await creatorApi.state(project.id);
    if (alive.current) { setState(value); setQuote(null); }
  }
  async function reloadList() { try { await onReload(); } catch { if (alive.current) setNotice("作品已保存，列表统计稍后刷新。"); } }
  async function create() {
    const style = styles.find(value => value.key === form.style) ?? styles[0];
    const result = await creatorApi.create({ requestId: form.requestId, title: form.title, brief: form.brief, source: form.source, textProvider: form.route.providerId, textModel: form.route.model, styleProfile: { ...style, characterRules: [], sceneRules: [], lightingRules: [], cameraRules: [], materialRules: [], negativeRules: [] } });
    writeDraft(draftKey, null);
    await reloadList();
    if (alive.current) { allowNavigation.current = true; onSelect(result.id); }
  }
  const runInput = { maxCalls, feedback, ...(latest ? { baseScriptId: latest.id } : {}) };
  async function generate() {
    if (!project || !quote || !state || routeDirty || dirtyFacts.size) return;
    const key = `${draftKey}:plan`;
    const payload = { ...runInput, expectedRevision: quote.inputRevision, maximumCredits: quote.maximumCredits };
    const saved = readDraft<{ fingerprint: string; requestId: string }>(key);
    const fingerprint = JSON.stringify(payload);
    const requestId = saved?.fingerprint === fingerprint ? saved.requestId : crypto.randomUUID();
    writeDraft(key, { fingerprint, requestId });
    const plan = await creatorApi.plan(project.id, { ...payload, requestId });
    await refresh();
    // The plan is already durable. A response interruption can be recovered from its saved state.
    const value = await creatorApi.execute(project.id, plan.id);
    if (alive.current) { setState(value); setQuote(null); setEditor(null); }
    await reloadList();
  }
  async function review(approve: boolean) {
    if (!project || !state || !latest) return;
    const value = await creatorApi.review(project.id, { expectedScriptId: editor?.scriptId ?? latest.id, expectedRevision: state.revision, content: currentContent, approve, note: editor?.note ?? "", details: editor?.details ?? latest.details });
    if (alive.current) { setState(value); setEditor(null); setQuote(null); setNotice(approve ? "剧本已确认，可以进入制作。" : "修改已保存为新版本。"); }
    await reloadList();
  }
  if (project && !state) return <main className="short-studio"><StatePanel kind={error ? "error" : "loading"} title={error ? "短片暂时无法读取" : "正在打开短片"} description={error || "读取剧本、执行计划与故事设定。"} action={error ? <button className="ghost-button" onClick={() => void act("refresh", refresh)}>重新读取</button> : undefined} /></main>;
  const selectedVersion = state?.scripts.find(script => script.id === compareId) ?? state?.scripts[1];
  const stepIndex = !project ? 0 : state?.nextAction === "production" ? 3 : latest ? 2 : 1;
  return <main className="short-studio">
    <header className="short-header"><button type="button" className="ghost-button" onClick={onBack}><ArrowLeft size={16} />作品列表</button><div><span className="section-kicker">SHORT STORY / 短片创作</span><h1>{project?.title ?? "一个故事，一条短片。"}</h1></div>{project ? <button type="button" className="ghost-button" disabled={Boolean(busy)} onClick={() => void act("refresh", refresh)}><RefreshCw size={16} />刷新状态</button> : null}</header>
    <ol className="short-steps" aria-label="短片创作进度">{["写下故事", "核对计划", "审阅剧本", "进入制作"].map((text, index) => <li key={text} aria-current={stepIndex === index ? "step" : undefined}><span>{index < stepIndex ? <Check size={14} /> : `0${index + 1}`}</span>{text}</li>)}</ol>
    {error ? <div className="short-alert" role="alert">{error}<button className="ghost-button" type="button" disabled={Boolean(busy)} onClick={() => void act("refresh", refresh)}>核对最新状态</button></div> : null}
    {notice ? <p className="short-notice" role="status">{notice}</p> : null}
    <div className="short-layout">
      <div className="short-main">
        <section className="short-paper short-brief">
          {latest ? <button type="button" className="short-brief-toggle" aria-expanded={briefExpanded} onClick={() => setBriefExpanded(value => !value)}><span><strong>已保存的创作意图</strong><small>{form.brief.durationSeconds} 秒 · {form.brief.audience}</small></span><span>{briefExpanded ? "收起" : "查看 / 修改"}</span></button> : null}
          <div hidden={Boolean(latest) && !briefExpanded}>
          <div className="short-section-heading"><span className="section-kicker">01 / 创作意图</span><h2>{project ? "这个故事，想让谁看见？" : "先说说你想拍什么"}</h2><p>主角想要什么、遇到了什么阻碍、结尾留下什么感受。</p></div>
          <form onSubmit={event => { event.preventDefault(); void act("save", project && state ? async () => { const value = await creatorApi.brief(project.id, form.brief, state.revision); if (alive.current) { setState(value); setQuote(null); setNotice("创作意图已更新，旧剧本需要重新修订。"); } await reloadList(); } : create); }}>
            <fieldset disabled={Boolean(busy) || Boolean(activeRun)}>
              {!project ? <label>作品标题<input required maxLength={160} value={form.title} onChange={event => change({ title: event.target.value })} placeholder="给这个故事起个名字" /></label> : null}
              <div className="short-form-row"><label>我的素材<select disabled={Boolean(project)} value={form.brief.material} onChange={event => changeBrief({ material: event.target.value as CreatorBrief["material"] })}><option value="idea">一句灵感</option><option value="story">已有故事</option><option value="script">已有剧本</option></select></label><label>目标时长<select value={form.brief.durationSeconds} onChange={event => changeBrief({ durationSeconds: Number(event.target.value) as 30 | 60 })}><option value={30}>30 秒 · 一个瞬间</option><option value={60}>60 秒 · 一个小故事</option></select></label></div>
              <label>故事与创作意图<textarea required minLength={2} maxLength={3000} rows={5} value={form.brief.intent} onChange={event => changeBrief({ intent: event.target.value })} placeholder="例如：一个总是迟到的邮差，今天必须在日落前送出最后一封信…" /></label>
              {!project && form.brief.material !== "idea" ? <label>粘贴已有{form.brief.material === "script" ? "剧本" : "故事"}<textarea required minLength={20} maxLength={12000} rows={8} value={form.source} onChange={event => change({ source: event.target.value })} /></label> : null}
              <div className="short-form-row"><label>主要观众<input maxLength={200} value={form.brief.audience} onChange={event => changeBrief({ audience: event.target.value })} /></label><label>想留下的情绪<input maxLength={200} value={form.brief.emotion} onChange={event => changeBrief({ emotion: event.target.value })} /></label></div>
              <details className="short-details"><summary>必须保留的细节与改编尺度</summary><label>必须保留<textarea rows={3} maxLength={2000} value={form.brief.mustKeep} onChange={event => changeBrief({ mustKeep: event.target.value })} placeholder="人物关系、关键台词、结局…" /></label><label>改编尺度<select value={form.brief.fidelity} onChange={event => changeBrief({ fidelity: event.target.value as CreatorBrief["fidelity"] })}><option value="faithful">忠于原意</option><option value="inspired">允许围绕意图再创作</option></select></label></details>
              {!project ? <><label>画面风格<select value={form.style} onChange={event => change({ style: event.target.value })}>{styles.map(style => <option value={style.key} key={style.key}>{style.name}</option>)}</select></label><ModelRoutePicker label="剧本模型" modality="text" providers={providers} modelPrices={modelPrices} value={form.route} onChange={(providerId, model) => change({ route: { providerId, model } })} /></> : null}
              <div className="short-actions"><span className="creator-caption">{project ? briefDirty ? "意图尚未保存，修改后需要重新审阅剧本" : "创作意图已保存" : "保存意图不调用模型、不消耗生成积分"}</span><button type="submit" className="primary-button" disabled={project ? !briefDirty : !modelReady}><Save size={16} />{project ? "保存意图" : "保存并查看创作计划"}</button></div>
            </fieldset>
          </form>
          </div>
        </section>
        {latest ? <section className="short-paper">
          <div className="short-section-heading"><span className="section-kicker">03 / 剧本审阅 · V{latest.version}</span><h2>故事的最后决定，交给你。</h2><p>{statusNames[latest.status] ?? latest.status} · 可以直接改写，也可以填写修订方向。</p></div>
          {editor && editor.scriptId !== latest.id ? <p className="short-alert">服务器已有新版本。本地草稿已保留，请先复制需要的内容，再载入最新版本。<button type="button" className="ghost-button" onClick={() => { if (window.confirm("载入最新剧本会替换当前本地草稿，确认继续？")) setEditor(null); }}>载入最新版本</button></p> : null}
          <label>短片剧本<textarea aria-label="短片剧本" className="short-script" rows={18} maxLength={14000} value={currentContent} disabled={Boolean(busy) || Boolean(activeRun)} onChange={event => setEditor({ ...editor, scriptId: editor?.scriptId ?? latest.id, content: event.target.value, note: editor?.note ?? "" })} /></label>
          {latest.details ? <details className="short-details"><summary>核对角色、场景与剧本估时</summary><p className="creator-caption">改写正文后，请同步修改这里的制作清单。确认后的清单会用于准备角色和场景。</p><ScriptDetailsEditor value={editor?.details ?? latest.details} disabled={Boolean(busy) || Boolean(activeRun)} onChange={details => setEditor({ scriptId: editor?.scriptId ?? latest.id, content: currentContent, note: editor?.note ?? "", details })} /></details> : null}
          <div className="short-checks" aria-label="剧本检查结果">{latest.findings.map((finding, index) => <p key={`${finding.code}:${index}`} data-blocking={finding.severity === "blocking"}><strong>{finding.layer === "structure" ? "结构" : finding.layer === "continuity" ? "连续性" : "作者审阅"}</strong>{finding.message}</p>)}</div>
          <label>本次修改或接受的理由（可选）<textarea disabled={Boolean(busy) || Boolean(activeRun)} rows={2} maxLength={2000} value={editor?.note ?? ""} onChange={event => setEditor({ ...editor, scriptId: editor?.scriptId ?? latest.id, content: currentContent, note: event.target.value })} /></label>
          <div className="short-actions"><button type="button" className="ghost-button" disabled={Boolean(busy) || Boolean(activeRun) || !canReview || !scriptDirty} onClick={() => void act("save", () => review(false))}><Save size={16} />保存修改版本</button><button type="button" className="primary-button" disabled={Boolean(busy) || Boolean(activeRun) || !canReview || latest.status === "confirmed" && !scriptDirty || latest.findings.some(f => f.severity === "blocking")} onClick={() => void act("review", () => review(true))}><Check size={16} />确认原意与人物关系</button></div>
          {latest.status === "confirmed" && !scriptDirty && !briefDirty ? <div className="short-handoff"><div><strong>剧本已确认，开始把故事变成画面。</strong><p>准备角色与分镜，查看动态预览后选择要制作的视频镜头。已交接短片有改动时，会新建制作版本并保留旧版。</p></div><button type="button" className="primary-button" disabled={Boolean(busy) || dirtyFacts.size > 0 || routeDirty} onClick={() => void act("handoff", async () => { const result = await contentApi.syncProduction(project!.id); if (alive.current) { allowNavigation.current = true; await onEnterProduction(result.productionProjectId); } })}>进入制作<ArrowRight size={16} /></button></div> : null}
          {state && state.scripts.length > 1 ? <details className="short-details"><summary>对照历史版本与作者反馈</summary><label>比较版本<select value={selectedVersion?.id ?? ""} onChange={event => setCompareId(event.target.value)}>{state.scripts.filter(script => script.id !== latest.id).map(script => <option key={script.id} value={script.id}>V{script.version} · {statusNames[script.status] ?? script.status}</option>)}</select></label><div className="short-comparison"><article><h3>V{selectedVersion?.version}</h3><pre>{selectedVersion?.content}</pre><p>{selectedVersion?.authorReview?.note || "尚无作者反馈"}</p></article><article><h3>当前 V{latest.version}</h3><pre>{latest.content}</pre><p>{latest.authorReview?.note || "尚无作者反馈"}</p></article></div><p className="creator-caption">版本对照保留实际文本与反馈；是否更好由作者判断。</p></details> : null}
        </section> : null}
      </div>
      <aside className="short-side">
        <section className="short-paper">
          <div className="short-section-heading"><span className="section-kicker">02 / 创作计划</span><h2>每一步，都有边界。</h2></div>
          <ol className="short-plan"><li><span>01</span><div><strong>编写短剧本</strong><p>读取意图、素材与已确认设定</p></div></li><li><span>02</span><div><strong>检查并提示</strong><p>结构、估时与锁定设定冲突</p></div></li><li><span>03</span><div><strong>等待你确认</strong><p>通过规则检查后仍需作者审阅</p></div></li></ol>
          {project ? <>
            <details className="short-details"><summary>剧本模型与渠道</summary><ModelRoutePicker label="修订剧本模型" modality="text" providers={providers} modelPrices={modelPrices} value={form.route} disabled={Boolean(busy) || Boolean(activeRun) || scriptDirty || briefDirty} onChange={(providerId, model) => change({ route: { providerId, model } })} /><button type="button" className="ghost-button" disabled={Boolean(busy) || Boolean(activeRun) || !modelReady || !routeDirty || scriptDirty || briefDirty} onClick={() => void act("route", async () => { await contentApi.updateModelRoute(project.id, { textProvider: form.route.providerId, textModel: form.route.model }); if (alive.current) setSavedRoute(form.route); await refresh(); await reloadList(); if (alive.current) setNotice("模型已保存，请重新核对报价。"); })}>保存模型选择</button><p className="creator-caption">模型变更需重新报价，不自动切换到其他付费模型。</p></details>
            <label>修订方向{latest ? "" : "（可选）"}<textarea maxLength={2000} rows={3} value={feedback} disabled={Boolean(busy) || Boolean(activeRun)} placeholder="例如：保留结尾，让主角的选择更清楚" onChange={event => { setFeedback(event.target.value); setQuote(null); }} /></label>
            <label>自动修复额度<select value={maxCalls} disabled={Boolean(busy) || Boolean(activeRun)} onChange={event => { setMaxCalls(Number(event.target.value)); setQuote(null); }}><option value={1}>只生成一次，我来审阅</option><option value={2}>检查未通过时，最多再修复一次</option></select></label>
            {quote ? <div className="short-quote" aria-live="polite"><span>本次积分上限</span><strong>{quote.maximumCredits.toLocaleString()}<small>积分</small></strong><p>最多 {quote.maxCalls} 次模型调用，每次上限 {quote.perCallCredits}。实际消耗按结算记录显示。</p><p className="creator-caption">模型：{quote.model}</p><button type="button" className="primary-button" disabled={Boolean(busy) || Boolean(activeRun) || briefDirty || scriptDirty || routeDirty || dirtyFacts.size > 0} onClick={() => void act("generate", generate)}><Sparkles size={16} />确认上限并{latest ? "修订" : "生成"}</button><details className="short-details"><summary>本次使用的资料</summary><p>输入保守估算 {quote.context.estimatedInputTokens.toLocaleString()} tokens；与供应商实际用量分开记录。</p>{quote.context.sources.map(source => <p key={source.id}>{source.label} · {source.required ? "必需" : "可选"} · {source.included ? "已纳入" : "未纳入"}</p>)}</details></div> : <button type="button" className="primary-button" disabled={Boolean(busy) || Boolean(activeRun) || briefDirty || scriptDirty || routeDirty || dirtyFacts.size > 0} onClick={() => void act("quote", async () => { const value = await creatorApi.quote(project.id, runInput); if (alive.current) setQuote(value); })}>核对{latest ? "修订" : "生成"}报价<ArrowRight size={16} /></button>}
            {(briefDirty || scriptDirty || routeDirty || dirtyFacts.size > 0) ? <p className="creator-caption">先保存当前剧本、意图、模型或设定修改，再核对报价。</p> : null}
          </> : <p className="creator-caption">保存左侧故事后，可查看模型与积分上限。</p>}
          {busy ? <p role="status" className="short-notice">{busy === "generate" ? "正在创作；计划和步骤已保存，离开后可回来查看。" : "正在处理，请稍候…"}</p> : null}
        </section>
        {activeRun ? <section className="short-paper"><h2>{statusNames[activeRun.status]}</h2><p>{activeRun.error || "执行记录已保存在这部作品中。"}</p>
          {activeRun.status === "pending" || activeRun.status === "running" ? <div className="short-actions"><button type="button" className="ghost-button" disabled={Boolean(busy)} onClick={() => void act("generate", async () => { const value = await creatorApi.execute(project!.id, activeRun.id); if (alive.current) setState(value); })}>{activeRun.status === "pending" ? "继续已保存计划" : "检查中断并恢复"}</button><button type="button" className="ghost-button" disabled={activeRun.cancelRequested} onClick={() => { void creatorApi.cancel(project!.id, activeRun.id).then(value => { if (alive.current) setState(value); }).catch(reason => { if (alive.current) setError(message(reason)); }); }}>{activeRun.cancelRequested ? "已请求停止" : "停止后续调用"}</button></div> : <><p className="creator-caption">先在任务中心及供应商账单核对结果。结束计划不表示供应商没有产生费用。</p><label className="short-checkbox"><input type="checkbox" checked={supplierChecked} onChange={event => setSupplierChecked(event.target.checked)} />我已核对供应商结果与费用</label><button className="ghost-button" type="button" disabled={!supplierChecked || Boolean(busy)} onClick={() => void act("acknowledge", async () => { const value = await creatorApi.acknowledge(project!.id, activeRun.id); if (alive.current) setState(value); })}>结束待核对计划</button></>}
        </section> : null}
        {state ? <section className="short-paper"><div className="short-section-heading"><span className="section-kicker">故事记忆</span><h2>让人物记得发生过什么。</h2><p>候选设定由你确认。锁定后，生成不得自动覆盖。</p></div>
          {state.facts.length ? state.facts.map(fact => <details className="short-details" key={fact.id}><summary>{fact.subject} · {fact.predicate}<span className="short-fact-status">{({ candidate: "待确认", confirmed: "已确认", locked: "已锁定", stale: "来源已变更", rejected: "已拒绝", superseded: "已有新版" })[fact.status]}</span></summary><p>{fact.value}</p><p className="creator-caption">故事时间 {fact.validFrom}–{fact.validTo ?? "以后"} · 知情者：{fact.knownBy.join("、") || "未限定"}<br />来源：{fact.sourceType} · 版本 {fact.sourceVersion}</p><FactEditor key={`${fact.id}:${fact.revision}`} fact={fact} draftKey={`${draftKey}:fact:${fact.id}`} onDirty={() => factDirty(fact.id)} disabled={Boolean(busy) || Boolean(activeRun)} onSave={input => saveFactDraft(input, fact)} /></details>) : <p className="creator-caption">生成后会提取候选设定，你也可以先写下不可改变的事实。</p>}
          <button className="ghost-button" type="button" disabled={Boolean(busy) || Boolean(activeRun)} onClick={() => { if (factOpen && dirtyFacts.has("new") && !window.confirm("新设定尚未保存，确认放弃？")) return; if (factOpen) writeDraft(`${draftKey}:fact:new`, null); factDirty("new", false); setFactOpen(value => !value); }}><ClipboardList size={16} />{factOpen ? "收起新设定" : "添加故事设定"}</button>
          {factOpen ? <FactEditor draftKey={`${draftKey}:fact:new`} onDirty={() => factDirty("new")} disabled={Boolean(busy) || Boolean(activeRun)} onSave={input => saveFactDraft(input)} /> : null}
        </section> : null}
        {state?.runs.length ? <section className="short-paper"><h2>执行与消耗记录</h2>{state.runs.map(run => <details className="short-details" key={run.id} open={run.id === state.runs[0].id}><summary>{statusNames[run.status]} · 上限 {run.maximumCredits} 积分</summary><p className="creator-caption">{new Date(run.createdAt).toLocaleString("zh-CN")} · {run.skillVersion}</p>{run.feedback ? <p>修订反馈：{run.feedback}</p> : null}{run.error ? <p>{run.error}</p> : null}{run.steps.map(step => <div className="short-run-step" key={step.id}><strong>第 {step.sequence} 步 · {step.status === "completed" ? "调用已完成" : statusNames[step.status] ?? step.status}</strong><p>{step.credits === null ? "积分待结算" : `${step.credits} 积分`} · {step.usage ? `实际输入 ${step.usage.inputTokens} / 输出 ${step.usage.outputTokens} tokens（缓存 ${step.usage.cachedInputTokens}）` : "供应商未返回完整用量"}</p>{step.error ? <p>{step.error}</p> : null}{step.findings.filter(f => f.severity === "blocking").map((finding, index) => <p key={index}>{finding.message}</p>)}</div>)}</details>)}</section> : null}
        {state?.nextAction === "production" ? <section className="short-paper"><h2>让故事继续</h2><p>下一集沿用风格与稳定设定。临时状态需要重新确认；合格角色素材会在制作交接时复用。</p><form onSubmit={event => { event.preventDefault(); void act("continue", async () => { const key = `${draftKey}:continue`; const fingerprint = JSON.stringify({ nextTitle, nextIntent }); const saved = readDraft<{ fingerprint: string; requestId: string }>(key); const requestId = saved?.fingerprint === fingerprint ? saved.requestId : crypto.randomUUID(); writeDraft(key, { fingerprint, requestId }); const result = await creatorApi.continue(project!.id, { requestId, title: nextTitle, intent: nextIntent }); await reloadList(); if (alive.current) { allowNavigation.current = true; onSelect(result.id); } }); }}><fieldset disabled={Boolean(busy) || Boolean(activeRun) || scriptDirty || briefDirty}><label>下一集标题<input required maxLength={160} value={nextTitle} onChange={event => setNextTitle(event.target.value)} /></label><label>下一集发生什么<textarea required minLength={2} maxLength={3000} rows={3} value={nextIntent} onChange={event => setNextIntent(event.target.value)} /></label><button className="ghost-button" type="submit">创建下一集<ArrowRight size={16} /></button></fieldset></form></section> : null}
      </aside>
    </div>
  </main>;
}

type FactDraft = { subject: string; predicate: string; value: string; from: number; to: string; knownBy: string; status: "candidate" | "confirmed" | "locked" | "rejected"; expectedRevision?: number };
function ScriptDetailsEditor({ value, disabled, onChange }: { value: CreatorScriptDetails; disabled: boolean; onChange: (value: CreatorScriptDetails) => void }) {
  return <fieldset disabled={disabled}>
    <label>剧本估时（秒）<input type="number" min={5} max={120} value={value.estimatedSeconds} onChange={event => onChange({ ...value, estimatedSeconds: Number(event.target.value) })} /></label>
    <h3>角色清单</h3>
    {value.characters.map((character, index) => <div className="short-fact-form" key={index}>
      {([["name", "姓名"], ["identity", "身份"], ["appearance", "外貌"], ["costume", "服装"], ["personality", "性格"]] as const).map(([field, label]) => <label key={field}>角色 {index + 1} · {label}<input maxLength={field === "name" ? 120 : 800} value={character[field]} onChange={event => onChange({ ...value, characters: value.characters.map((item, position) => position === index ? { ...item, [field]: event.target.value } : item) })} /></label>)}
      <button type="button" className="ghost-button" disabled={value.characters.length <= 1} onClick={() => onChange({ ...value, characters: value.characters.filter((_, position) => position !== index) })}>移除角色 {index + 1}</button>
    </div>)}
    <button type="button" className="ghost-button" disabled={value.characters.length >= 5} onClick={() => onChange({ ...value, characters: [...value.characters, { name: "", identity: "", appearance: "", costume: "", personality: "" }] })}>添加角色</button>
    <h3>场景清单</h3>
    {value.scenes.map((scene, index) => <div className="short-fact-form" key={index}>
      <label>场景 {index + 1} · 地点<input maxLength={120} value={scene.location} onChange={event => onChange({ ...value, scenes: value.scenes.map((item, position) => position === index ? { ...item, location: event.target.value } : item) })} /></label>
      <label>场景 {index + 1} · 描述<textarea maxLength={1200} value={scene.description} onChange={event => onChange({ ...value, scenes: value.scenes.map((item, position) => position === index ? { ...item, description: event.target.value } : item) })} /></label>
      <label>场景 {index + 1} · 出场人物<input value={scene.characters.join("、")} onChange={event => onChange({ ...value, scenes: value.scenes.map((item, position) => position === index ? { ...item, characters: event.target.value.split(/[、，,]/).map(name => name.trim()) } : item) })} /></label>
      <button type="button" className="ghost-button" disabled={value.scenes.length <= 1} onClick={() => onChange({ ...value, scenes: value.scenes.filter((_, position) => position !== index) })}>移除场景 {index + 1}</button>
    </div>)}
    <button type="button" className="ghost-button" disabled={value.scenes.length >= 6} onClick={() => onChange({ ...value, scenes: [...value.scenes, { location: "", description: "", characters: [] }] })}>添加场景</button>
    <h3>道具清单</h3>
    {value.props.map((prop, index) => <div className="short-fact-form" key={index}>
      <label>道具 {index + 1} · 名称<input maxLength={120} value={prop.name} onChange={event => onChange({ ...value, props: value.props.map((item, position) => position === index ? { ...item, name: event.target.value } : item) })} /></label>
      <label>道具 {index + 1} · 描述<input maxLength={800} value={prop.description} onChange={event => onChange({ ...value, props: value.props.map((item, position) => position === index ? { ...item, description: event.target.value } : item) })} /></label>
      <button type="button" className="ghost-button" onClick={() => onChange({ ...value, props: value.props.filter((_, position) => position !== index) })}>移除道具 {index + 1}</button>
    </div>)}
    <button type="button" className="ghost-button" disabled={value.props.length >= 12} onClick={() => onChange({ ...value, props: [...value.props, { name: "", description: "" }] })}>添加道具</button>
  </fieldset>;
}
export function FactEditor({ fact, disabled, onSave, onDirty, draftKey }: { fact?: StoryFact; disabled: boolean; draftKey?: string; onDirty?: () => void; onSave: (value: Parameters<typeof creatorApi.fact>[1]) => Promise<void> }) {
  const [restored] = useState(() => draftKey ? readDraft<FactDraft>(draftKey) : null);
  const [subject, setSubject] = useState(restored?.subject ?? fact?.subject ?? "");
  const [predicate, setPredicate] = useState(restored?.predicate ?? fact?.predicate ?? "");
  const [value, setValue] = useState(restored?.value ?? fact?.value ?? "");
  const [from, setFrom] = useState(restored?.from ?? fact?.validFrom ?? 1);
  const [to, setTo] = useState(restored?.to ?? fact?.validTo?.toString() ?? "");
  const [knownBy, setKnownBy] = useState(restored?.knownBy ?? fact?.knownBy.join("、") ?? "");
  const [status, setStatus] = useState<FactDraft["status"]>(restored?.status ?? (fact && ["candidate", "confirmed", "locked", "rejected"].includes(fact.status) ? fact.status as "candidate" : "candidate"));
  const expectedRevision = restored?.expectedRevision ?? fact?.revision;
  const edited = useRef(Boolean(restored));
  useEffect(() => { if (restored) onDirty?.(); }, []);
  useEffect(() => { if (draftKey && edited.current) writeDraft(draftKey, { subject, predicate, value, from, to, knownBy, status, expectedRevision }); }, [draftKey, subject, predicate, value, from, to, knownBy, status, expectedRevision]);
  return <form className="short-fact-form" onChange={() => { edited.current = true; onDirty?.(); }} onSubmit={event => { event.preventDefault(); void onSave({ subject, predicate, value, validFrom: from, validTo: to ? Number(to) : null, knownBy: knownBy.split(/[、,，]/).map(name => name.trim()).filter(Boolean), status, ...(fact ? { expectedRevision } : {}) }); }}><fieldset disabled={disabled}>
    {restored && fact && expectedRevision !== fact.revision ? <p role="alert">此设定已有新版本，本地草稿仍保留。请复制修改内容，再与最新设定核对。</p> : null}
    <div className="short-form-row"><label>人物 / 对象<input required maxLength={120} value={subject} onChange={event => setSubject(event.target.value)} /></label><label>属性 / 事件<input required maxLength={120} value={predicate} onChange={event => setPredicate(event.target.value)} placeholder="身份、姓名、受伤…" /></label></div>
    <label>事实内容<textarea required maxLength={1500} rows={3} value={value} onChange={event => setValue(event.target.value)} /></label>
    <div className="short-form-row"><label>开始时间点<input type="number" min={1} max={100000} required value={from} onChange={event => setFrom(Number(event.target.value))} /></label><label>结束时间点<input type="number" min={from} max={100000} value={to} onChange={event => setTo(event.target.value)} placeholder="留空表示持续" /></label></div>
    <label>知情人物<input value={knownBy} onChange={event => setKnownBy(event.target.value)} placeholder="用顿号分隔，留空表示未限定" /></label>
    <label>作者状态<select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="candidate">待确认</option><option value="confirmed">确认</option><option value="locked">确认并锁定</option><option value="rejected">拒绝采用</option></select></label>
    <p className="creator-caption">时间点按故事内顺序编号，闪回保留发生时的范围。修改已确认设定后，剧本需要重新修订。</p>
    <button className="ghost-button" type="submit"><Save size={14} />保存设定版本</button>
  </fieldset></form>;
}
