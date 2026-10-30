import { ArrowRight, Check } from "lucide-react";
import { useWorkbench } from "../WorkbenchContext";
import "./stage-guide.css";

export function StageGuide() {
  const { stageGuidance: guide, onStageChange, saveState } = useWorkbench();
  if (!guide) return null;
  return <section className="wb-stage-guide" aria-label="本阶段制作指引">
    <header><span>{guide.scope}</span><strong>{guide.title}</strong></header>
    <p>{guide.detail}</p>
    <div className="wb-stage-guide__bottom">
      <dl>{guide.checks.map(check => <div key={check.label} data-complete={check.complete}><dt>{check.complete ? <Check size={13} aria-hidden="true" /> : <i aria-hidden="true" />}{check.label}</dt><dd>{check.value}</dd></div>)}</dl>
      {guide.next && onStageChange ? <button className="wb-text-button" type="button" disabled={saveState === "saving"} onClick={() => onStageChange(guide.next!.stage)}>{guide.next.label}<ArrowRight size={14} aria-hidden="true" /></button> : null}
    </div>
  </section>;
}
