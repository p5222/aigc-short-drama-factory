import { BookOpen, Film, MessageSquare, Settings } from "lucide-react";
import { useState } from "react";
import type { ModelTestResult } from "@aifilm/shared";
import { api } from "../lib/api";

export function StudioPage() {
  return (
    <SimplePage
      title="剪辑中心"
      desc="管理视频片段、配音、字幕、封面和 FFmpeg 合成导出。第一版先保留完整入口。"
      items={["片段时间线", "配音字幕", "封面设置", "MP4 导出"]}
      icon={<Film size={28} />}
    />
  );
}

export function ProfilePage() {
  return (
    <SimplePage
      title="我的"
      desc="用户资料、默认模型、作品统计和安全设置。"
      items={["账户资料", "默认画幅", "默认模型", "安全设置"]}
      icon={<Settings size={28} />}
    />
  );
}

export function SettingsPage() {
  const [result, setResult] = useState<ModelTestResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function testModel() {
    setLoading(true);
    try {
      setResult(await api.modelTest());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-title">
        <h1>设置</h1>
        <p>平台配置、模型测试、本地 Docker 演示模式和 ComfyUI 高级模式。</p>
      </div>
      <section className="panel centered-panel">
        <Settings size={32} />
        <div className="admin-grid">
          {["DeepSeek V4 Pro", "通义万相适配器", "ComfyUI base_url", "任务并发"].map((item) => (
            <button key={item}>{item}</button>
          ))}
        </div>
        <button className="primary-button" onClick={testModel} disabled={loading}>
          {loading ? "检测中..." : "测试文本生成模型"}
        </button>
        {result ? (
          <div className="model-result">
            <strong>
              {result.provider} / {result.model}
            </strong>
            <span>{result.mode}</span>
            <p>{result.message}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function HelpPage() {
  return (
    <div className="page-stack">
      <div className="page-title row-title">
        <div>
          <h1>帮助中心</h1>
          <p>常见问题、教程、客服和工单。</p>
        </div>
        <div className="inline-actions">
          <button className="ghost-button">
            <MessageSquare size={18} />
            在线客服
          </button>
          <button className="primary-button">提交工单</button>
        </div>
      </div>
      <div className="help-grid">
        <HelpCard title="10 分钟入门" desc="从零生成第一集" icon={<Film size={30} />} />
        <HelpCard title="详细文档" desc="解释每个模块" icon={<BookOpen size={30} />} />
        <HelpCard title="创作社群" desc="交流案例和经验" icon={<MessageSquare size={30} />} />
      </div>
      <section className="panel">
        <h2>常见问题</h2>
        {[
          "我第一次使用，应该先输入小说还是一句话脑洞？",
          "生成出来的角色长相不稳定，应该怎么处理？",
          "图生视频模型成本高，MVP 阶段如何演示？",
          "积分扣费、冻结和退款分别代表什么？",
          "后续上线商业化需要部署哪些服务？"
        ].map((item) => (
          <div className="faq-row" key={item}>
            {item}
          </div>
        ))}
      </section>
    </div>
  );
}

function SimplePage({ title, desc, items, icon }: { title: string; desc: string; items: string[]; icon: React.ReactNode }) {
  return (
    <div className="page-stack">
      <div className="page-title">
        <h1>{title}</h1>
        <p>{desc}</p>
      </div>
      <section className="panel centered-panel">
        {icon}
        <div className="admin-grid">
          {items.map((item) => (
            <button key={item}>{item}</button>
          ))}
        </div>
      </section>
    </div>
  );
}

function HelpCard({ title, desc, icon }: { title: string; desc: string; icon: React.ReactNode }) {
  return (
    <article className="help-card">
      {icon}
      <strong>{title}</strong>
      <span>{desc}</span>
    </article>
  );
}
