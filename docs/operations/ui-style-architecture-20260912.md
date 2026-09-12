# 前后台 UI 样式与组件架构审查 · 2026-09-12

审查基线：`83d8f95d`，以当前 `apps/web/src` 源码为准。仅做源码、CSS AST 和组件调用审查；未打开浏览器、未改业务代码、未运行后端测试。下列级联冲突可由规则直接确认，实际视觉验收仍需在浏览器中检查。旧文档 `docs/theme-audit-20260722.md` 的方向可沿用，但其中“design-system 未全局引入”等描述已过时。

## 结论与边界

当前已有可复用的基础：双主题 token、后台表格与抽屉、焦点/滚动锁、路由错误恢复、已验证的请求与草稿保护。视觉不一致主要来自多代全局样式叠加、平行调色板和未被消费的原语层。首轮应统一基础层和明确的冲突，再让页面迁移；不需要重写前后端，也不应同时重排所有 CSS。

本次全量解析 23 份 CSS：源文件合计 **867,812 字节**，共 **3,539 处 `!important`**。`styles.css` 为 **27,563 行、621,169 字节、4,244 个规则、3,252 处 `!important`**。这些是源码指标，不等同于网络压缩体积；不能把重复 selector 直接当作可删除死代码，其中包含媒体查询与主题分支。

## 现有加载与级联结构

`apps/web/src/main.tsx` 的顺序如下：

| 顺序 | 当前文件 | 实际责任与风险 |
| --- | --- | --- |
| 1 | `admin/admin.css`、`admin-enhancements.css`、`CineHome.css`、`PublicShowcase.css`、`scripts-page.css`、`deliveryExportQuote.css`、`ProjectStudioV4.css`、`content/content.css` | 页面 CSS 先加载，目的是保留 lazy JS 拆分前的稳定级联。它们仍会被后面的全局样式覆盖。 |
| 2 | `App` 的静态依赖 | `WorkbenchPage` 引入公告 CSS，`StaticPages → SupportTicketPanel` 引入工单 CSS；入口不显式列出这两份依赖。 |
| 3 | `styles.css → light-theme.css → project-workbench-overrides.css` | 多代基础、页面、后台、登录和项目制作样式；大量高优先级覆盖。 |
| 4 | `workbench/styles/{tokens,shell,components,stages,responsive}.css` | 当前制作台的有效基础，布局/双主题/响应式相对集中。 |
| 5 | `design-system/{semantic-tokens,components}.css → creation-workspace.css → theme-contract.css → creator-shell.css` | 语义别名与补丁；“后加载”并不保证覆盖旧 `!important`。`theme-contract.css` 注释称最后加载，实际后面还有 `creator-shell.css`。 |

页面内同时保留同路径 CSS import 不代表 Vite 会重复下载同一模块；问题在于所有页面规则共享作用域与级联，而不是 import 行数。UI 迁移期间保持入口顺序和 CSS eager 策略，避免把按路由加载 CSS 的顺序变化混入视觉改造。

## 已确认的不一致来源

### 1. 最终主题规则无法覆盖旧暗色主按钮

- `styles.css:25342`：`:root:not([data-theme="light"]) .primary-button` 为紫蓝渐变背景，带 `!important`。
- `theme-contract.css:76` 附近：`.app-shell .primary-button` 使用统一青绿色 token，同样带 `!important`。
- 前者 specificity 为 `(0,3,0)`，后者为 `(0,2,0)`。同为 important 时，旧规则胜出，不能靠后导入解决。
- 浅色也存在平行来源：`light-theme.css` 的 `:root[data-theme="light"] .app-shell .primary-button` 使用 `--light-accent:#009b8f`；基础 token 的浅色 `--accent` 为 `#087f75`。不是同一颜色的不同命名。

最小落点：根代理定唯一按钮/主题合约，逐条删除或收窄已确认抢占的旧声明，再验证两种主题。不要再追加一层更高优先级的全局 `!important`。

### 2. 当前制作台任务/评测抽屉使用不存在的主题变量

`pages/ProjectStudioV4.css:169` 的 `.wb-drawer`、`.wb-task-row`、`.wb-evaluation-row`、`.wb-text-button` 使用 `--wb-surface/--wb-text/--wb-border/--wb-panel/--wb-muted/--wb-accent`。全项目 CSS 与 TS/TSX 中无这些变量的定义，因此持续采用白底、深字、蓝按钮的 fallback；没有对应暗色覆盖。

最小落点：这段抽屉样式迁到 `workbench/styles/components.css`，接入已有 `--ds-*` 或当前基础 token；保留 `TaskDrawer/EvaluationDrawer` 的行为和内容。不能把这些 fallback 当作暗色设计。

### 3. 无 fallback 的无效边框变量

`workbench/styles/stages.css:150` 的 `.wb-content-edit-button/.wb-content-save-button` 使用 `border:1px solid var(--border-strong)`；实际定义为 `--border-2` 或 `--ds-border-strong`，没有 `--border-strong`。该声明在计算时无效。可直接修正引用，无需新调色板。

`content/content.css` 还引用 `--text-primary/--page-bg/--surface-primary/--text-tertiary` 等未定义变量，大多有硬编码 fallback；不能批量称为无效 CSS，但意味着控件可能不跟随主题。迁移时逐个匹配实际页面；例如作品打开遮罩使用未定义 `--surface-base` 的白色 fallback。

### 4. 主题源与页面容器割裂

目前同时存在基础 `--surface-*/--text-*/--accent`、`--ds-*`、`--ui-*`、`--light-*`、`--adm-*`、`--content-*`、`--cw-*`、`--support-*` 等。`--ds-*` 和 `--ui-*` 已正确别名到基础 token，可保留兼容；其余不少是独立配色。

- `.app-shell` 的主题补丁不覆盖独立 `.wb-shell` 和 `.adm-shell`。
- `admin.css` 与 `admin-enhancements.css` 都定义 `--adm-*`，后台外壳与旧 `.admin-*` 组件又有硬编码值。
- `supportTickets.css` 使用独立绿色与 14px 面板圆角；基础面板合约为 6/8px、青绿色。
- 公共首页/视频预览的媒体暗底属于明确的展示需求，可以保留局部 `data-appearance`，不应强行套成表单面板。

最小落点：根保留 `workbench/styles/tokens.css` 作为唯一基础颜色源，`semantic-tokens.css` 提供控件语义，其他前缀按域建立兼容别名后逐步删除独立颜色。不要一次替换所有变量名。

### 5. 原语 CSS 已存在，但未形成使用中的组件合约

`design-system/components.css` 定义 `.ds-button/.ds-field/.ds-status/.ds-dialog`，当前 TSX 没有这些类的消费点，也没有统一 React Button/Field/Notice。实际仍使用：

- `.primary-button/.ghost-button`：基础最小高度 42px，部分页面覆盖渐变和大圆角。
- `.admin-primary-btn/.admin-icon-btn`：旧后台基础高度 42px、12px 圆角、字重 900、投影。
- `.adm-primary-btn/.adm-icon-btn`：新后台 36px。
- `.wb-icon-button`：制作台 40px；另外有工作台阶段按钮。
- `.support-panel button`：44px、8px 圆角、独立配色。

大小可因密度不同而变化，但现在变化没有显式 size/variant 契约。仅在文件末尾新增 `.ds-button` 无法解决使用问题。

### 6. 表格、状态与空态存在两套甚至多套表达

`AdminTablePage` 已支持 loading/error/empty/分页和键盘行操作，`AdminMasterDetail` 已支持 busy、焦点、返回焦点与滚动锁，适合作为后台基线。与此同时 `AdminPage.tsx` 内仍有局部 `AdminToolbar/StatusChip/EmptyHint/TableFooter` 与手写表格。

- `TableFooter` 固定显示第 1 页和不可用翻页，并始终写“1 至 min(total,20)”；调用处如公告实际渲染全部 `rows`。这会制造假分页感，应显示真实总数，只有实际分页才显示分页控件。
- `StatusChip` 仅用 active 布尔映射启用/停用视觉；调用者可传“待开始/已过期”等不同语义，颜色仍只有两种。
- `AdminTablePage` 刷新时隐藏已有 rows；可以为它增加“首次加载/后台刷新”的明确状态，保留已显示数据并标记 busy，但不能把请求失败显示成空数据。
- 前台 `.empty-state`、`.wb-empty-state`、后台 `.admin-empty-hint`、工单 `.support-empty` 分别决定留白与提示方式，缺少统一标题、解释和可执行下一步。

这些是原语落点，不需要增加新的业务功能。

### 7. 弹窗已有行为保护，视觉统一不能覆盖这些保护

`useAdminDialog` 和 `adminDialogScroll` 已包含焦点约束、Escape、busy 关闭限制、恢复焦点及滚动锁。其他域还有原生 `dialog`、制作台 drawer、发布/图片预览弹窗、登录弹窗。它们不能只靠 `.ds-dialog` 类替换后宣称统一完成。

最小落点：先统一 Dialog/Drawer 的 surface、宽度、header/body/footer、滚动和 z-index token，再用薄适配器收敛行为。迁移保留现有 focus/close/busy/未保存输入确认；关闭与重新打开不能通过轮询 key 重挂载。已经有效的原生 dialog 无需为了外观强制改成 div。

### 8. 文档与样式分层之间已有偏差

旧主题审查写明 semantic layer 尚未全局引入，而现在已由 main 引入。`styles.css` 中 `.login-copy` 出现 18 次、`.director-studio-layout` 15 次，说明累积了多轮改版；这些计数不等于死代码证据。删除必须以实际路由/组件引用与浏览器验收为依据，不能直接按名字像旧版就清除。

## 最小可扩展改造

### 第一批：根代理统一基础，不改业务流程

1. 固定基础 token、语义 token、按钮/表单/面板尺寸和状态颜色；沿用现有青绿色、双主题、中性表面，避免增加第三种品牌方案。
2. 修正上述主按钮优先级、抽屉 token、无效 border 三处确定冲突。每处删除对应旧声明，而非新增兜底高权重规则。
3. 建立少量实际被页面使用的 React 原语，可放 `components/ui/`：

| 原语 | 最小契约 |
| --- | --- |
| Button/IconButton | `variant`（primary/secondary/ghost/danger）、`size`、pending、disabled；默认 type=button，图标按钮必须有可读标签；pending 不替代业务层同步防重复守卫。 |
| Field | 自动关联 label、control id、hint、error；支持 aria-invalid/aria-describedby；不引入新的表单状态库。 |
| StatusBadge | 显式 label 与 tone（neutral/info/success/warning/danger），不把所有非成功都映射为失败或停用。 |
| Notice | 区分 status 与 alert，提供恢复动作；提交成功但刷新失败保持现有文案语义，禁止变成“提交失败，请再提交”。 |
| EmptyState | 标题、原因/说明、可选动作；loading、权限失败、网络失败与真正空数据分开。 |
| Dialog/Drawer 视觉壳 | 标题、描述、body、footer、busy；复用现有经过验证的焦点/滚动锁，先做适配而非重写所有弹窗。 |

4. `AdminTablePage/AdminMasterDetail` 保留接口、优先消费共同 token/控件；不再为新后台子页复制一套表格样式。基础层完成后冻结接口，再给页面并行接入。

尺寸建议：桌面密集工具条可用 36/40px 显式 compact，普通表单/主操作 40/44px，触屏交互至少 44px；通过组件 size 和媒体策略表达，而不是在各页硬写不同高度。

### 第二批：页面迁移必须同时清除对应遗留覆盖

每个页面包完成：使用统一原语与 token → 本地 CSS 只保留布局/媒体几何 → 标记需要从 styles/light-theme 移除的确切 selector → 由根统一清理 → 两主题/状态/响应式验收。只换 JSX、不清理旧高优先级规则，不算完成。

新规则以拥有该页面的根类为作用域，不写裸 `.panel`、`.project-card`、`button` 等跨域覆盖。避免给全项目一次性加 `@layer legacy`：CSS 层会改变普通与 important 声明的优先顺序，未经迁移不能整体包裹旧文件。样式拆文件不以体积变小为唯一目标；保持 lazy JS 的既有收益。

## 文件所有权与并行边界

| 负责方/任务包 | 拥有文件 | 约束 |
| --- | --- | --- |
| 根代理统一 | `main.tsx`、`App.tsx`、`styles.css`、`light-theme.css`、`theme-contract.css`、`design-system/*`、新增 `components/ui/*`、`package.json` | 入口/全局级联/原语接口/共享测试命令只由一个负责人改；统一处理各页面提交的旧 selector 删除清单。 |
| 根或指定唯一制作台基础负责人 | `workbench/styles/tokens.css`、`components.css`、`shell.css`、`responsive.css`、`project-workbench-overrides.css`、`creation-workspace.css` | 与页面阶段 CSS 分开；修 `.wb-drawer` 前协调 `ProjectStudioV4.css` 所有权。 |
| 外壳与概览包 | `components/Shell.tsx`、`creator-shell.css`、`WorkbenchPage.tsx`、`workbench-announcements.css` | 公告顺序/时间过滤仍使用服务端；不要在视觉重构中改变拉取机制。 |
| 作品/队列/积分包，可再分三个负责人 | `ScriptsPage.tsx`+`scripts-page.css`；`TaskCenterPage.tsx`+新局部 CSS；`CreditsPage.tsx`+新局部 CSS | 每个页面只改自己的文件，不同时修改 styles.css。保留当前/历史产物语义、任务取消/重试和账务状态。 |
| 个人中心/设置/帮助包 | `StaticPages.tsx`+新局部 CSS | 同一个 TSX 文件集中拥有；工单目录另有负责人时只协调 props，不重复改组件。 |
| 支持工单包 | `support/SupportTicketPanel.tsx`、`supportTickets.css` | 可以独立采用原语；保留幂等快照、claim revision、409 输入保留与角色隔离。 |
| 后台包，单一整合负责人 | `AdminPage.tsx`、`admin/AdminShell.tsx`、`AdminTablePage.tsx`、`AdminMasterDetail.tsx`、`admin.css`、`admin-enhancements.css` | AdminPage 很大，不建议多代理同时“按模块随意改”。先抽取专用子模块，再按新文件分工；保留 action runner、busy 与 scoped notice。 |
| 内容创作包 | `ContentCreatorPage.tsx`、`content/*` | 大型 content.css 属单一负责人；不改根基础 token、App 路由、草稿/请求身份。 |
| 制作台阶段包 | `workbench/stages/*`、对应局部 CSS/模型 | `stages.css` 仍是共享文件，应由单一负责人整合或先按阶段抽出；项目页面和弹窗交给同一个协调负责人。 |
| 公共首页/认证/展示包 | `LoginPage.tsx`、`CineHome.css`、`PublicShowcase.tsx`、`PublicShowcase.css` | 保留验证码/鉴权与公开预览能力；媒体展示暗底可独立于操作面板主题。 |

## 完成判据

- 浏览器检查 375/768/1440px、浅/深两主题；从概览进入制作台/后台再返回，样式不能因路由访问顺序变化。
- 主按钮、字段、表格、空态、错误提示、抽屉/弹窗分别覆盖默认、hover、focus、disabled、pending、失败恢复和长文本。
- 后台刷新不清除编辑内容；公告跨排期不卸载正在编辑的行；工单旧响应不清除新草稿；制作台轮询不重置草稿或误标来源为 current。
- 表格只展示真实分页；等待/过期/已完成/历史产物保留文字提示，颜色不是唯一信息。
- 改动对应的前端模型测试、typecheck、build 和浏览器证据即可；本轮不重跑无关后端测试。CSS AST 检查可验证新增未定义 token/高权重全局规则，不能替代视觉验收。
- 不把通过构建或统一颜色等同于“全部商用质量验收完成”；本报告负责视觉基础和可协作架构，不替代真实付费样片、支付与第二设备闭环验收。


## 2026-09-12 生产与内容页面实施和验收边界

本段记录未提交工作区的实施及待验收项目，不将源码检查或单元测试称为浏览器通过。根任务负责真实 IAB 操作；生产子任务已按指定调用 `cua.getTab('9', {browser:'1'})`，结果为 `Tab not found`。随后只读库存显示该子任务只有 Chrome extension，未出现 IAB 的 9/15 标签。子任务没有重置 CUA、改视口、新建标签或操作其他页面。因此根任务指定的桌面 1422×986、手机 375×812 交互结论必须由根任务实际截图和操作补入。

### 已实施的具体界面变化

- 制作台正在处理、成功、失败提示从旧注释布局迁到实际 header 下；错误提供重新核对入口。任务/评测使用共享 Dialog，主题颜色来自 `--ds-*`。
- 内容页大纲状态上移，切换章节保留已编辑的大纲；正文切章/阶段/返回受草稿确认保护，提交中不可离开或再次编辑。素材读取有独立 loading/error；保存已成功、列表刷新失败时明确说明无需再次保存。
- 根 App 用账号和 contentId 作为内容页 key。组件内部切项目从对应缓存建立素材 baseline，避免程序性清空被误识别为用户修改。新版本与其他项目不继承旧大纲。
- 内容页在手机保留五阶段导航，提供真实章节选择；参数/版本/交接区排列在正文下方，不再直接隐藏全部侧栏功能。
- 成片移除永久禁用的剪切/删除/撤销/重做入口和生成的假波形，只标记实际配音可用状态；保留生成报价、历史来源和导出范围逻辑。
- 成片队列的勾选框、预览按钮、失败展开按钮分别为兄弟节点，不再把 input/button 放进 `role=button` 容器。
- `18-delivery-after.png`（80064 bytes，根任务原 1422×986 截图）已被子任务实际查看，确认两秒短片使空轨文字压成窄竖列。修复后由 ResizeObserver 读取实际 viewport，`deliveryTimelineCanvas` 设置明确宽度下限，独立 64px 轨道标题列；clip 保持按时长比例，空状态不再使用片段总宽。该原截图是问题证据，不能作为修复后通过证据，需根任务复拍。
- 成片自有侧栏补接已有 `useResponsiveDrawer`：Inspector 在 ≤1199px 成为抽屉，队列在 ≤979px 成为抽屉；980–1199px 保留队列+画布，断点与顶栏入口一致。Tab、Esc、还焦点与背景遮罩均需实际复测。

### 根任务的无付费 UI 验收顺序

仅使用已有 `ui_fixture_20260912_two_episodes` 本地样本。它由 FFmpeg/本机语音制作、两集各两镜每镜一秒，明确不是 AI 生成质量样片。不要点任何生成、重新生成、确认报价并导出、永久删除。

| 页面/阶段 | 可安全执行的操作 | 必须检查的状态与预期 | 证据 |
| --- | --- | --- | --- |
| 制作台·内容 | 切第2集/第2场；在台词或旁白加临时字；点其他阶段并在原生确认中取消；再用取消编辑回到基线 | 草稿标记；取消导航后文本保留；取消编辑后不再阻止返回；阅读区换集正确 | 桌面 `15-production-after.png`，手机另存 production/ |
| 制作台·素材 | 切角色/场景；打开当前图预览并关闭；开检查器；不上传/生成 | 空角色、无图/已有图语义；当前版本标题；失败提示不能仅在隐藏侧栏；长名称不遮生成入口 | `16-assets-after.png` |
| 制作台·分镜 | 在宫格/列表/单镜视图间切换；查看第2集；编辑提示并取消；仅查看已有视频 | 默认/选中镜头明确；dirty 切镜头确认；未生成与失败不混用；小屏检查器能开关，表单 label 可读 | `17-shots-after.png` |
| 制作台·成片 | 播放/暂停已有1秒片；切第2集；独立勾选镜头；键盘Enter预览；时间线拖拽再刷新恢复；缩放/适配；展开历史 | 勾选不同时切预览；点击预览不改勾选；视频/配音/字幕三标签独立；短片空轨文案横向可读；切集不混用旧导出；历史与当前分区明确 | 复拍 `18-delivery-after.png`，375另存 production/ |
| 任务/评测抽屉 | 打开任务；Tab到底再Tab；Shift+Tab；Esc；重新打开后点击关闭；评测同样 | 不能Tab到背景；Esc关闭；焦点回到对应入口或更多按钮；无记录显示空态；没有伪任务 | `19-task-drawer-after.png`，键盘结果文字记录 |
| 375成片队列/参数 | 顶栏打开对象列表/检查器；Tab/Shift+Tab；Esc；通过背景遮罩关闭 | 仅一个侧栏；角色为dialog；焦点从关闭按钮开始，循环后回原入口；关闭后可继续播放；无横向整页滚动 | production/ 手机详情截图 |
| 内容创作·初始 | 从作品页“写新故事”进入；切意图类型；输入临时想法；返回时取消原生确认，再取消修改 | 五步可见，未完成步骤禁用有解释；创建字段提交前可以编辑；不能点开始结构拆解（收费） | 桌面/375，初始与dirty各一张 |
| 内容创作·导入素材 | 从已有内容项目的“创作素材”进入；编辑标题和正文；返回创作进度时取消；再明确放弃 | 未保存提示；继续生成禁用并提示先保存；切项目后不能带入其他项目素材；初始详情请求期间显示读取态 | 桌面/375，表单与确认后保留 |
| 内容创作·结构拆解 | 用本地已保存样本查看分析各维度、来源说明；不点击生成大纲 | 已读内容与未完成状态分开；真实来源不足时不宣称核验；手机阅读和侧栏可达 | 若无样本，仅标缺少该阶段浏览器证据 |
| 内容创作·大纲 | 编辑第1章目标→选择第2章→返回第1章；切“结构拆解”并取消原生确认 | 第1章修改保留；五步/章节选择可键盘使用；确认大纲并生成按钮不要点击 | 同上 |
| 内容创作·正文 | 编辑第1章；选择第2章时取消原生确认；取消编辑后切第2章 | 不出现旧 editingChapter 导致新章所有按钮消失；修改取消/保存失败保留逻辑可见；不点击批量生成/重生成 | 同上 |
| 内容创作·交接 | 查看已有剧本，切已有剧集；只读核对参数/版本/下一步 | 五阶段入口与手机版交接在正文下方；未保存时生成/交接禁用；没有剧本就显示待生成，不能假装就绪 | 同上；不以点击生成制造后续状态 |

错误与busy覆盖：优先记录已有任务失败、既有空素材、刷新失败提示和正在请求时的按钮禁用。没有自然失败/在途样本的状态应标为“仅源码/模型回归，未在浏览器触发”，不要为截图启动收费任务，也不要注入浏览器状态。

### 后续内容阶段的本地 fixture 方案（初始只读建议，后续执行见下节）

仓库已存在 `apps/api/src/content/productionSync.test.ts` 的真实数据库构造方式：校验 URL host 为 localhost/127.0.0.1 且库名为独立 audit 前缀，直接创建 ContentProject、ScriptVersion、EntityCatalog，验证交接与零账务变化。没有找到覆盖五阶段的可重复浏览器内容 fixture runner。`apps/api/src/seed/testData.ts` 是旧演示种子，包含 mock 任务和积分，不应直接导入当前验收库。

根任务若补样本，应沿现有本机 QA 隔离方式，用一次 Prisma 事务创建 `ui_content_fixture_20260912_*` 前缀项目，名称与正文显式写“本机界面验收样本 · 非 AI 生成”；绑定当前本地验收账号；先校验数据库为 `manjiao_review_20260912`，拒绝其他库。只向以下内容表写样本，不运行 generation service、不创建 GenerationTask/ExportJob/冻结账目、不改模型渠道：

1. `ContentProject`：`mode=adaptation`/`same_genre`，选择不同 activeStep 和非 running 状态；每种阶段单独项目，避免模拟忙碌而永远无法结束。
2. `SourceDocument`：两个明确测试章节；用于素材导入/保存表单。
3. `StoryAnalysis`：version1、confirmed；`result` 包含 intent、intentType、targetWords、chapterCount、batchSize、dimensions、evidence（明确本地人工样本，无假引用）。
4. `StoryOutline`：两个 chapterNo 连续的章节，含 title/objective/conflict/cliffhanger；大纲编辑样本 status=draft，正文/交接样本 status=confirmed。
5. `StoryChapter`：每章至少20字人工样本文本，version1；用于正文编辑与取消。不要把字符量较短的fixture声明为真实长篇生成效果。
6. 交接样本增加 `ScriptVersion`、`EntityCatalog`；若需分集下拉，再按 schema 建 `ProductionEpisode`/`EpisodeScriptVersion` 并设置 activeScriptVersion。可参照 productionSync.test 里的字段约束，但不能把测试函数整体运行到当前库（它自己只接受 audit 库并清理其fixture）。

保存后通过正常内容项目列表/API读取样本再操作页面，验证前后 CreditTransaction/GenerationTask 对该样本均为0。此方案仅覆盖页面和交互，不覆盖模型质量、外部供应商、真实支付或生产发布。

### 已执行的隔离界面样本

根任务随后明确授权创建本地样本。临时脚本 `tmp/seed-ui-content-states-20260912.mjs` 已执行成功（工具输出 chunk `8af50c`，exit0）。脚本在连接前校验协议、127.0.0.1、5432、数据库 `manjiao_review_20260912` 和 public schema，并通过数据库查询再次核对实际库名/schema/端口。单一 Serializable 事务只 upsert `UI_FIXTURE_20260912` 前缀记录，归已有 `user_admin`；不创建用户、不导入应用服务、不调用供应商或 Redis。该脚本留在临时目录，不纳入生产发布。

| 可在作品/任务列表点击的标题 | ID | 用途与限制 |
| --- | --- | --- |
| UI_FIXTURE_20260912 · 全流程内容样本 · 非生成任务 | `UI_FIXTURE_20260912_CONTENT_FULL` | 2章、2集、已确认大纲、汇总剧本、2人物/1场景/1道具；可从交接回看全部五阶段、切第2章/第2集、编辑后取消 |
| UI_FIXTURE_20260912 · 待确认大纲样本 · 非生成任务 | `UI_FIXTURE_20260912_CONTENT_DRAFT` | 导入模式、已有小说素材和待确认大纲；用于大纲/素材草稿、导航取消，不点击确认并生成 |
| UI_FIXTURE_20260912 · 界面状态样本 · 非生成任务 · 失败提示 | `UI_FIXTURE_20260912_TASK_FAILED` | 仅数据库 failed 展示记录，无请求快照、0积分、无媒体；不是实际生成失败 |
| UI_FIXTURE_20260912 · 界面状态样本 · 非生成任务 · 完成提示 | `UI_FIXTURE_20260912_TASK_SUCCEEDED` | 仅数据库 succeeded 展示记录，无请求快照、0积分、无媒体；不是实际生成完成 |

已检查 `queue/creationDispatch.ts`：后台恢复循环会查询 pending/running、type=text、jobId=creation-* 并补入 Redis。因此没有建立 pending/running 样本。两条终态记录的 jobId 使用 `content:UI_FIXTURE_20260912_...`，生产 `mapTask` 据此禁用通用重试/取消；它们没有可被恢复调度的 requestPayload。固定内容的 provider/model 为不可调用的 fixture 标识。

本次新增18行、更新0行：ContentProject/SourceDocument/StoryAnalysis/StoryOutline/StoryChapter/ProductionEpisode/EpisodeScriptVersion 各2，ScriptVersion/EntityCatalog 各1，GenerationTask 2。事务内核对 CreditAccount、CreditTransaction、RechargeOrder、已有 Project 与 Asset 前后相同。既有双集制作样本没有修改。可以只读、切换、输入草稿并取消；不要点击任何生成、确认大纲并生成或进入漫剧创作。样本固定文本只支持界面验收，不代表平台 AI 产出、成片质量或真实任务闭环。

### 本轮已运行的定向检查

- 首轮内容/来源/草稿/报价组合 51/51：content/model.test.ts、workbench/stages/contentDraftModel.test.ts、deliveryModel.test.ts、deliveryQuoteModel.test.ts、pages/workbenchPageModel.test.ts。
- 短时间线修复后 deliveryModel + deliveryQuoteModel 30/30（新增2项尺寸回归）。新增总计6项前端模型回归：内容4、时间线2。
- Web typecheck已通过，包括最后成片侧栏接线（session94622，exit0）。没有运行无关后端套件，没有构建或重启服务。
- 自有CSS主题令牌与布局修复已落盘；1422×986/375×812的最终视觉、Tab/Esc/还焦点、原生dirty取消仍须根任务浏览器证据确认。
