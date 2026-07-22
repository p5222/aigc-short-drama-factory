# 中转生图运行手册

## 已验证配置

- Base URL：`https://api.zmlmfling.com/v1`
- 模型：`gpt-image-2`
- UI 原型尺寸：`2048x1152`
- UI 原型质量：`medium`
- 输出格式：`png`
- 脚本：`E:\codex\01-home-active\skills\.system\imagegen\scripts\image_gen.py`
- 密钥变量：`OPENAI_API_KEY`，只在进程环境中设置，不写入仓库。
-地址变量：`OPENAI_BASE_URL`。

## 稳定调用方式

当前 Windows 网络出口在并发 TLS 连接时偶发 `UNEXPECTED_EOF_WHILE_READING`。采用以下固定策略：

1. 单任务串行生成，不并发请求三张图。
2. 每张图使用独立提示词文件和独立输出路径。
3. 单次超时至少 10 分钟；2K 图可能需要 3-7 分钟。
4. TLS/连接错误只重试当前图片，不重新生成已成功图片。
5. `GROUP_DELETED` 表示密钥所属分组失效，应切换到已确认的新密钥，不要反复重试旧密钥。
6. 日志出现 `Calling Image API` 后长时间无输出属于正常生成过程，不要中止。

## 命令模板

```powershell
$env:OPENAI_API_KEY = $env:ZML_IMAGE_KEY
$env:OPENAI_BASE_URL = "https://api.zmlmfling.com/v1"
python E:\codex\01-home-active\skills\.system\imagegen\scripts\image_gen.py generate `
  --model gpt-image-2 `
  --prompt-file <PROMPT_FILE> `
  --size 2048x1152 `
  --quality medium `
  --output-format png `
  --out <OUTPUT_FILE> `
  --force `
  --no-augment
```

## 验证

- 命令退出码为 0。
- 日志包含 `Generation completed` 与 `Wrote`。
- 使用本地图片查看工具确认文字层级、主操作、主题和布局没有明显错误。
