# 剧本分场工作台对标调研记录

日期：2026-07-07

## 调研范围

目标是学习成熟产品如何把“剧本”变成可拍摄、可生成、可排期、可分镜的生产数据。范围聚焦剧本分场、脚本拆解、角色/场景/道具元素标注、故事板与镜头表承接。

参考产品与公开来源：

- StudioBinder Script Breakdown：https://www.studiobinder.com/script-breakdown-software/
- Celtx Script Breakdown：https://www.celtx.com/features/script-breakdown/
- Boords AI Storyboard Generator：https://boords.com/ai-storyboard-generator
- LTX Studio：https://ltx.studio/
- Adobe Firefly Storyboard：https://www.adobe.com/products/firefly/features/storyboard.html

## 对标结论

成熟剧本分场页不是普通“剧本文本预览”，而是生产数据入口。它通常会把剧本拆成场次、元素、镜头、角色、地点和风险检查，再交给后续拍摄/故事板/视频环节。

StudioBinder 和 Celtx 代表传统影视生产流：先按场次拆解剧本，再标注 cast、props、location、wardrobe 等生产元素，最后连接 shooting schedule、call sheet、shot list。可借鉴的是“左侧场次列表 + 中间剧本拆解 + 右侧生产元素/检查器”。

Boords 和 Adobe Firefly Storyboard 代表故事板生产流：从脚本生成故事板、镜头/画面说明、可预览的视觉序列。可借鉴的是“剧本不是终点，分场页要明确下一步会变成镜头和故事板”。

LTX Studio 代表 AI 视频生产流：故事、角色、场景、镜头和视频生成需要连续上下文。可借鉴的是“角色/场景不能到分镜阶段再临时补，要在剧本分场页就作为候选资产浮出来”。

## 落到本项目的设计原则

1. 剧本页必须有场次导航，而不只是剧本文本。
2. 每个场次要显示地点、时间、预计时长、镜头数、状态和风险。
3. 中间编辑区要把剧情梗概、场景描述、人物出场、动作调度、台词旁白和钩子分开。
4. 右侧检查器要显示角色候选、场景候选、长台词/缺角色/场次过长风险。
5. “生成分镜表”按钮要放在预检之后，让用户知道当前剧本是否足够进入分镜。
6. 如果已经生成分镜表，重建要明确提示会覆盖分镜、分镜图和视频草稿。

## 已实施到前台的变化

- `剧本分场` 页改为三栏 cockpit。
- 左栏新增“剧集与场次”导航和筛选：全部、未确认、有风险、可拆镜。
- 中栏新增剧本编辑区：剧情梗概、当前场次、人物出场、动作/调度、情绪/钩子、台词/旁白、生产元素标注。
- 右栏新增预检与生成：剧本可读、场次清晰、角色已抽取、台词可拆镜。
- 已有分镜时，从 `StoryboardShot` 聚合真实场次；未生成分镜时，从 `ScriptDraft.content` 推导场次候选。
- `重建分镜表` 增加二次确认，避免覆盖已有分镜图和视频草稿。
