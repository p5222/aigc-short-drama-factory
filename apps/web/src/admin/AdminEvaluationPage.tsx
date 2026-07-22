import type { ExperimentRun, PromptVersion } from "@aifilm/shared";
import { AdminTablePage } from "./AdminTablePage";

const statusLabels: Record<string, string> = { active: "已启用", draft: "草稿", archived: "已归档", running: "运行中", completed: "已完成", failed: "失败" };
const purposeLabels: Record<string, string> = { generation: "生成", evaluation: "评分" };

export function AdminEvaluationPage({ prompts, experiments, selectedPromptId, onSelectPrompt, onCreatePrompt, onCreateExperiment }: { prompts: PromptVersion[]; experiments: ExperimentRun[]; selectedPromptId?: string; onSelectPrompt: (id: string) => void; onCreatePrompt?: () => void; onCreateExperiment?: () => void; }) {
  const active = prompts.find((item) => item.id === selectedPromptId) ?? prompts[0];
  return (
    <div className="adm-evaluation">
      <section className="adm-prompt-rail">
        <header><div><h2>Prompt 版本</h2><p>先用真实样本验证，再启用候选版本。</p></div>{onCreatePrompt ? <button className="adm-primary-btn" type="button" onClick={onCreatePrompt}>新建版本</button> : null}</header>
        <div className="adm-prompt-list">
          {prompts.map((prompt) => <button type="button" key={prompt.id} className={prompt.id === active?.id ? "is-active" : ""} onClick={() => onSelectPrompt(prompt.id)}><strong>{prompt.name}</strong><span>{prompt.version} · {prompt.stage}</span><em data-status={prompt.status}>{statusLabels[prompt.status] ?? prompt.status}</em></button>)}
          {!prompts.length ? <div className="adm-table-state">暂无 Prompt 版本</div> : null}
        </div>
      </section>
      <section className="adm-prompt-detail">
        {active ? <><header><div><h2>{active.name}</h2><p>{active.key} · {active.version}</p></div><span className="adm-status" data-status={active.status}>{statusLabels[active.status] ?? active.status}</span></header><dl><div><dt>用途</dt><dd>{purposeLabels[active.purpose] ?? active.purpose}</dd></div><div><dt>阶段</dt><dd>{active.stage}</dd></div><div><dt>说明</dt><dd>{active.notes || "未提供"}</dd></div></dl><pre>{active.content}</pre></> : <div className="adm-table-state">选择一个版本查看完整提示词</div>}
      </section>
      <AdminTablePage
        title="实验运行"
        summary="比较不同样本、模型与 Prompt 版本的评分、通过率和结论。"
        actions={onCreateExperiment ? <button className="adm-primary-btn" type="button" onClick={onCreateExperiment}>新建实验</button> : null}
        columns={[
          { key: "name", label: "实验", render: (row) => <strong>{row.name}</strong> },
          { key: "type", label: "类型", render: (row) => row.experimentType === "model" ? "模型" : row.experimentType === "prompt" ? "提示词" : "组合" },
          { key: "stage", label: "阶段", render: (row) => row.stage },
          { key: "score", label: "分数变化", render: (row) => `${row.metrics.baselineScore} → ${row.metrics.candidateScore}` },
          { key: "status", label: "结论", render: (row) => <span className="adm-status" data-status={row.winner}>{row.winner === "candidate" ? "候选更优" : row.winner === "baseline" ? "基线更优" : "持平"}</span> },
          { key: "hypothesis", label: "实验假设", render: (row) => row.hypothesis || "未提供" }
        ]}
        rows={experiments}
        rowKey={(row) => row.id}
        emptyText="暂无实验运行"
      />
    </div>
  );
}
