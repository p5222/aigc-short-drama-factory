import { providerProtocols, type ModelProvider, type ProviderConnection } from "@aifilm/shared";

export function initialProviderDraft(provider: ModelProvider) {
  return {
    name: provider.name, modality: provider.modality, enabled: provider.enabled,
    baseUrl: provider.baseUrl ?? "", iconUrl: provider.iconUrl ?? "", apiKey: "", resetKey: false,
    models: provider.models.join(", "), costHint: provider.costHint,
    routingMode: provider.routing?.mode ?? "auto",
    preferredModel: provider.routing?.preferredModel ?? provider.models[0] ?? "",
    connection: provider.connection
  };
}

export function ProviderConnectionFields({ modality, value, onChange }: {
  modality: string; value?: ProviderConnection; onChange: (value: ProviderConnection) => void;
}) {
  const protocols = providerProtocols.filter(item => item.modality === modality);
  return <div className="provider-connection-fields">
    <label><span>接口协议</span><select value={value?.protocol ?? ""} onChange={event => onChange({ protocol: event.target.value as ProviderConnection["protocol"] })}>
      <option value="" disabled>{protocols.length ? "请选择供应商使用的协议" : "尚无生产适配器"}</option>
      {protocols.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
    </select><small>按供应商文档选择；渠道名称可自定义。</small></label>
    {modality === "video" && value ? <label><span>视频分辨率</span><select value={value.resolution ?? "720p"} onChange={event => onChange({ ...value, resolution: event.target.value as ProviderConnection["resolution"] })}><option value="480p">480p</option><option value="720p">720p</option><option value="1080p">1080p</option></select><small>报价和实际生成使用同一分辨率；以模型支持范围为准。</small></label> : null}
    {modality === "tts" && value ? <>
      <label><span>默认音色 ID</span><input value={value.defaultVoice ?? ""} placeholder="Cherry" onChange={event => onChange({ ...value, defaultVoice: event.target.value || undefined })} /><small>角色指定音色时优先使用角色设置。</small></label>
      <label><span>语言</span><input value={value.language ?? ""} placeholder="Chinese" onChange={event => onChange({ ...value, language: event.target.value || undefined })} /></label>
    </> : null}
  </div>;
}
