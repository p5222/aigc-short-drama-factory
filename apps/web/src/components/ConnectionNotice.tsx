import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import "./connection-notice.css";

export function ConnectionNotice() {
  const [offline, setOffline] = useState(() => !navigator.onLine);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  if (!offline) return null;
  return <div className="connection-notice" role="status"><WifiOff size={18} aria-hidden="true" /><span>网络已断开。请保留当前页面；连接恢复后刷新核对任务结果，再继续操作。</span></div>;
}
