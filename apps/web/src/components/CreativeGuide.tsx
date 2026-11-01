import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import "./creative-guide.css";

const guides = {
  short: {
    title: "怎样把想法说清楚", input: "说清谁要做什么、为什么困难、结尾有什么变化。已有故事请粘贴原文，再写必须保留的细节。",
    example: "拍一条30秒的温暖短片。主角想在关门前送出最后一份饭，但老人没有来。结尾用猫走进灯光回应开头。只用一个场景，不要解释性旁白。",
    destination: "把自己的故事写在「故事与创作意图」，可展开下方问题补充边界。",
    checks: "先看人物选择是否有依据，再读出对白计时。修订时写清要改哪一处、希望什么变化、哪些内容要保留。"
  },
  content: {
    title: "让剧本能够被拍出来", input: "先核对场次、人物行动、原句对白与旁白。每场要有一个局面变化，推动决定的纸条或消息要写明内容。",
    example: "画面：店员看见门边的一只空碗。\n动作：店员将最后一份饭放在碗旁。\n对白：店员：今天也给你留着。",
    destination: "选择场次后，在「编辑镜头」中修改画面、动作与声音，保存后再建立镜头结构。",
    checks: "检查关键线索是否可见、角色为何行动、对白是否超时；新建或重建镜头前确认内容。"
  },
  assets: {
    title: "建立稳定的角色与场景", input: "角色固定脸型、发型、年龄感、服装和识别点；场景固定空间布局、门窗位置、主光方向。临时表情和动作留给分镜。",
    example: "角色识别点：短卷发，圆脸，深绿围裙，左胸一枚银色别针。\n场景：便利店入口在画面左侧，收银台在右后方，暖光来自顶灯。",
    destination: "核对角色资料与定稿图；用「角色参考」补充已有素材。场景图重点核对布局，物件参考重点核对形状与材质。",
    checks: "比较不同视角的脸、衣服与识别点。先确认一套角色定稿，再生成首帧，减少后续返工。"
  },
  shots: {
    title: "首帧写状态，视频写变化", input: "每镜安排一个主要动作和一种运镜。先确认人物站位、视线和光线，再描述动作如何开始与结束。",
    example: "图片提示词：店员站在收银台后，双手托着饭盒，尚未递出；画面右侧是打开的店门。\n视频提示词：店员缓慢把饭盒放到门边，手离开后停住。固定机位，保持面容和衣着。",
    destination: "在镜头编辑区分别填写「图片提示词」「视频提示词」与时长，保存后生成。对白按「角色名：台词」逐行填写，旁白单独填写。",
    checks: "先看首帧身份与空间，再看动作、手部和停点。动作过多就缩减本镜动作；镜头衔接以实际画面核对。"
  },
  delivery: {
    title: "交付前，连起来看一次", input: "先选择本集镜头和视频版本，调整顺序与裁切，保存剪辑，再生成配音、字幕与成片。",
    example: "配音检查：同一角色保持同一音色，台词与旁白逐句对照。\n画面检查：视线与动作接得上，道具位置不跳变，结尾留出停顿。",
    destination: "对白或旁白有误时，返回分镜编辑并保存；过长台词可缩短或延长镜头，再重新报价。配音按先对白、后旁白排列，需要交错时请拆镜。",
    checks: "分别检查静音画面、纯声音与完整成片。字幕只来自实际台词；环境声、音乐与唇形不因导出成功而自动完成。"
  },
  intent: {
    title: "给长篇一个明确的承诺", input: "标题之外，补充题材、主角欲望、核心冲突、观众期待与结尾方向。参考作品用于讨论结构与节奏。",
    example: "悬疑成长故事：一名修表师要找回父亲失踪当天的记忆。每次修复旧表会暴露一条可验证线索，也让他失去一段亲身记忆。结尾让他主动选择保留真相。",
    destination: "在创作意图中填写标题或题材方向；已有原文可通过素材入口保存，后续以保存的材料为依据。",
    checks: "确认故事的主冲突能持续推进，结尾能兑现开头；未知作品情节与未经核实的市场判断需单独核对。"
  },
  analysis: {
    title: "审阅分析时，看依据", input: "区分原作品中确实发生的事、对结构的理解、用于新作的建议。",
    example: "参考的是“观众先知道危险，角色后知道”的信息节奏。新故事使用不同人物、事件和场景，并在前三章埋下危险的证据。",
    destination: "对照已保存意图审阅结构拆解；方向不合适时先调整输入，再生成后续大纲。",
    checks: "检查是否编造作品情节、书名或来源；参考结论应能落实为本作的冲突和人物选择。"
  },
  outline: {
    title: "每一章，都接住上一章的后果", input: "逐章明确目标、阻碍、人物选择、局面变化与结尾问题，安排伏笔在哪章出现、在哪章回收。",
    example: "第3章目标：拿到维修记录。阻碍：店主要求交换旧表。选择：主角交出父亲遗物。后果：发现记录被改过，下一章必须找到修改者。",
    destination: "在大纲编辑中修改章节目标、冲突与结尾钩子；核对后确认大纲，再生成正文。",
    checks: "避免章节只重复升级同一冲突。每章解决一部分问题，新问题来自人物选择的后果。"
  },
  chapter: {
    title: "把大纲里的事件写成正在发生的事", input: "依据当前章目标与已发生的前文，保持人物声音、物品状态、故事时间和知情范围。",
    example: "让主角在对话和动作中发现记录被改过。读者先看见不同颜色的墨迹，再看见主角决定追查。删掉对读者已知信息的重复解释。",
    destination: "在章节正文中直接修改具体段落并保存；稳定事实可在「故事设定与知情范围」中确认或锁定。",
    checks: "检查秘密是否被提前说破、物品是否无故出现、下一章计划是否被误写成已发生事实。"
  },
  handoff: {
    title: "把已认可的正文交给制作", input: "先保存正文，选择制作剧集，核对分集边界、人物、地点和可朗读对白。",
    example: "保留原文决定与关键台词。将内心判断转成原文已有的可见线索；没有依据的信息留待作者补充。每句对白单独一行。",
    destination: "核对分集剧本及角色、场景清单，选择对应剧集进入制作。修改已交接内容后，检查新旧制作版本。",
    checks: "确认没有删掉关键因果、提前使用下集事件或把场次标题提取成人名，再投入媒体生成。"
  }
} as const;

export type CreativeGuideStage = keyof typeof guides;
export function CreativeGuide({ stage }: { stage: CreativeGuideStage }) {
  const [notice, setNotice] = useState("");
  useEffect(() => setNotice(""), [stage]);
  const guide = guides[stage];
  return <details className="creative-guide">
    <summary><span>创作方法</span><strong>{guide.title}</strong></summary>
    <div className="creative-guide-body">
      <p>{guide.input}</p>
      <blockquote>{guide.example}</blockquote>
      <p>{guide.destination}</p>
      <p><strong>审阅时看什么</strong>{guide.checks}</p>
      <button type="button" onClick={() => { void navigator.clipboard.writeText(guide.example).then(() => setNotice("示例已复制，请替换成你的故事细节。")).catch(() => setNotice("暂时无法复制，可直接选中上方示例文字。")); }}><Copy size={14} aria-hidden="true" />复制示例</button>
      {notice ? <span className="creative-guide-notice" role="status">{notice}</span> : null}
    </div>
  </details>;
}
