import type { ReactNode } from "react";

interface MetricCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  tone?: "default" | "success" | "danger" | "purple";
}

export function MetricCard({ label, value, hint, icon, tone = "default" }: MetricCardProps) {
  return (
    <section className={`metric-card ${tone}`}>
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </section>
  );
}

