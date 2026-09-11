import { Component, Suspense, type ReactNode } from "react";
import { requestRoutePageReload, RoutePageLoadError } from "../lib/routePageLoader";

interface RoutePageBoundaryProps {
  children: ReactNode;
  /** Only route identity; never task polling, timestamps or refreshed workflow data. */
  routeId: string;
  onBack: () => void;
  backLabel?: string;
}

interface RoutePageBoundaryState { error: Error | null; routeId: string }

export class RoutePageBoundary extends Component<RoutePageBoundaryProps, RoutePageBoundaryState> {
  state: RoutePageBoundaryState = { error: null, routeId: this.props.routeId };

  static getDerivedStateFromProps(props: RoutePageBoundaryProps, state: RoutePageBoundaryState) {
    return props.routeId === state.routeId ? null : { error: null, routeId: props.routeId };
  }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error("页面无法显示") };
  }

  render() {
    const { children, onBack, backLabel = "返回作品" } = this.props;
    if (this.state.error) return <div className="page-stack"><section className="panel centered-panel" role="alert">
      <h1>{this.state.error instanceof RoutePageLoadError ? "页面暂时无法加载" : "页面暂时无法显示"}</h1>
      <p>请检查网络连接，或重新加载页面以获取最新版本。已保存的内容仍会保留。</p>
      <p>重新加载会关闭当前页面，尚未保存的输入可能丢失。</p>
      <div className="inline-actions">
        <button type="button" className="primary-button" onClick={() => requestRoutePageReload()}>重新加载页面</button>
        <button type="button" className="ghost-button" onClick={onBack}>{backLabel}</button>
      </div>
    </section></div>;
    return <Suspense fallback={<div className="page-stack"><section className="panel centered-panel" aria-busy="true">
      <p role="status" aria-live="polite">正在打开页面…</p>
      <button type="button" className="ghost-button" onClick={onBack}>{backLabel}</button>
    </section></div>}>{children}</Suspense>;
  }
}
