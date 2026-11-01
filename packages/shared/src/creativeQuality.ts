import type { CreatorBrief } from "./creatorAgent.js";

// Editorial estimates, not measured speech or provider billing.
export function estimateSpeechSeconds(text: string) {
  const clean = text.replace(/（[^）]*）|\([^)]*\)|【[^】]*】/g, "");
  const cjk = (clean.match(/[\u3400-\u9fff]/g) ?? []).length;
  const words = (clean.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length;
  const pauses = (clean.match(/[，。！？；,.!?;…]/g) ?? []).length;
  return Math.round((cjk / 4 + words / 2.5 + pauses * 0.18) * 10) / 10;
}

export const creativeBriefFields = [
  { key: "protagonistGoal", label: "主角与具体目标", question: "谁必须在什么时候，完成什么事？", example: "夜班店员要在关门前，把最后一份饭送到老人手里。" },
  { key: "obstacle", label: "阻碍与代价", question: "什么挡住了主角？失败会失去什么？", example: "老人今晚没来；饭凉了就无法兑现每天的约定。" },
  { key: "ending", label: "结尾的可见变化", question: "最后一个画面，如何回应开头？", example: "店员把饭放到门边，猫从暗处走进灯光。" },
  { key: "productionLimits", label: "制作边界", question: "有哪些人数、地点、动作或声音限制？", example: "一个店内场景，两个人；避免追逐，用动作表达情绪。" },
  { key: "avoid", label: "不想出现的处理", question: "哪些套路、语气或画面不适合这部作品？", example: "不要煽情旁白、突然新增人物或没有铺垫的反转。" }
] as const;

export function briefQuestions(brief: CreatorBrief) {
  return creativeBriefFields.filter(field => !brief[field.key]?.trim()).map(field => field.question);
}

export function appendRevisionFeedback(current: string, recipe: string): string | null {
  if (current.includes(recipe)) return current;
  const combined = [current.trim(), recipe.trim()].filter(Boolean).join("\n\n");
  return combined.length <= 2000 ? combined : null;
}

export const scriptRevisionRecipes = [
  { label: "补足因果", text: "只修订因果薄弱的场次：让观众先看见主角据以行动的线索，再看见选择和后果。信件或提示信息写清具体内容。保留人物关系、已锁定事实和原结局。" },
  { label: "压缩时长", text: "按目标时长精简重复解释和无效动作。对白按每秒约4个汉字加停顿估算，动作另留时间；保留关键台词、线索和情绪落点，更新节拍时长。" },
  { label: "对白更自然", text: "只调整允许改写的对白：区分每个角色的说话习惯，用回应、停顿和言外之意表达关系，删去对彼此都已知信息的解释。忠实改编时保留原台词，以表演和节奏调整。" },
  { label: "改善开头结尾", text: "让第一场出现一个具体的未解决问题，结尾用人物行动回应它。反转必须有前文线索；保留原结局含义，不添加临时秘密或新人物解决冲突。" }
] as const;

export interface StoryDesign {
  goal: string;
  obstacle: string;
  choice: string;
  payoff: string;
  beats: Array<{ seconds: number; action: string; evidence: string; spokenText: string }>;
}
