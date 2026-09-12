import { Component, Suspense, type ReactNode } from "react";
import { requestRoutePageReload, RoutePageLoadError } from "../lib/routePageLoader";
import { StatePanel } from "../design-system/ui";

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
    if (this.state.error) return <div className="page-stack"><StatePanel kind="error" title={this.state.error instanceof RoutePageLoadError ? "页面暂时无法加载" : "页面暂时无法显示"} description={<>请检查网络后重试。已保存内容仍会保留；重新加载会关闭当前页面，尚未保存的输入可能丢失。</>} action={<>
        <button type="button" className="primary-button" onClick={() => requestRoutePageReload()}>重新加载页面</button>
        <button type="button" className="ghost-button" onClick={onBack}>{backLabel}</button>
      </>} /></div>;
    return <Suspense fallback={<div className="page-stack"><StatePanel kind="loading" title="正在打开页面…" description="正在载入所需的工作区。" action={<button type="button" className="ghost-button" onClick={onBack}>{backLabel}</button>} /></div>}>{children}</Suspense>;
  }
}
