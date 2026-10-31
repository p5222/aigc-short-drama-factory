import { useEffect, useState } from "react";
import type { CreatorAgentState, StoryFact } from "@aifilm/shared";
import { creatorApi } from "../lib/creatorApi";
import { Dialog } from "../design-system/ui";
import { FactEditor } from "./ShortCreatorStudio";

export function StoryMemoryDialog({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved: () => void }) {
  const [state, setState] = useState<CreatorAgentState | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<StoryFact | null>(null);
  useEffect(() => {
    let active = true;
    void creatorApi.state(projectId).then(value => { if (active) setState(value); }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [projectId]);
  const canLeave = () => !busy && (!dirty || window.confirm("设定尚未保存，确认放弃修改？"));
  return <Dialog open title="故事设定与人物知情范围" description="候选设定需要作者确认。来源变更后会标记失效，锁定设定保留为作者约束。" onClose={() => { if (canLeave()) onClose(); }}>
    <div className="short-studio story-memory-dialog">
      {error ? <p role="alert">{error}</p> : null}
      {state ? <><label>选择设定<select value={selected?.id ?? ""} disabled={busy} onChange={event => { if (canLeave()) { setSelected(state.facts.find(f => f.id === event.target.value) ?? null); setDirty(false); } }}><option value="">添加新设定</option>{state.facts.map(fact => <option value={fact.id} key={fact.id}>{fact.subject} · {fact.predicate} · {{ candidate: "待确认", confirmed: "已确认", locked: "锁定", stale: "失效", rejected: "拒绝", superseded: "旧版" }[fact.status]}</option>)}</select></label>
        {selected ? <p className="creator-caption">来源 {selected.sourceType} · v{selected.sourceVersion}<br />{selected.value}</p> : null}
        <FactEditor key={selected?.id ?? "new"} fact={selected ?? undefined} disabled={busy} onDirty={() => setDirty(true)} onSave={async input => {
          setBusy(true); setError("");
          try { await creatorApi.fact(projectId, input, selected?.id); setDirty(false); setSelected(null); onSaved(); setState(await creatorApi.state(projectId)); }
          catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败，请保留草稿重试"); }
          finally { setBusy(false); }
        }} />
      </> : <p>正在读取故事设定…</p>}
    </div>
  </Dialog>;
}
