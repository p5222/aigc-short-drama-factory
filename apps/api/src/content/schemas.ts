import { z } from "zod";

const nonEmpty = z.string().trim().min(1);

export const storyAnalysisSchema = z.object({
  logline: nonEmpty,
  genre: nonEmpty,
  themes: z.array(nonEmpty).min(1),
  audience: nonEmpty,
  worldview: nonEmpty,
  coreConflict: nonEmpty,
  protagonistGoal: nonEmpty,
  stakes: nonEmpty,
  facts: z.array(z.object({ key: nonEmpty, value: nonEmpty })).min(1),
  risks: z.array(nonEmpty).default([])
});

export const storyOutlineSchema = z.object({
  title: nonEmpty,
  premise: nonEmpty,
  chapters: z.array(z.object({
    chapterNo: z.number().int().positive(),
    title: nonEmpty,
    objective: nonEmpty,
    conflict: nonEmpty,
    turn: nonEmpty,
    cliffhanger: nonEmpty
  })).min(1).superRefine((chapters, ctx) => {
    const numbers = new Set<number>();
    for (const [index, chapter] of chapters.entries()) {
      if (numbers.has(chapter.chapterNo)) {
        ctx.addIssue({ code: "custom", path: [index, "chapterNo"], message: "章节编号不能重复" });
      }
      numbers.add(chapter.chapterNo);
    }
  })
});

export const entityCatalogSchema = z.object({
  characters: z.array(z.object({ id: nonEmpty, name: nonEmpty, description: nonEmpty })),
  scenes: z.array(z.object({ id: nonEmpty, name: nonEmpty, description: nonEmpty })),
  props: z.array(z.object({ id: nonEmpty, name: nonEmpty, description: nonEmpty })).default([])
}).superRefine((catalog, ctx) => {
  const ids = new Set<string>();
  for (const [group, values] of Object.entries(catalog)) {
    for (const [index, value] of values.entries()) {
      if (ids.has(value.id)) {
        ctx.addIssue({ code: "custom", path: [group, index, "id"], message: "实体 ID 不能重复" });
      }
      ids.add(value.id);
    }
  }
});

export const contentStepSchema = z.enum(["source", "analysis", "strategy", "outline", "chapter", "script", "entity"]);
export const contentStepStatusSchema = z.enum(["draft", "running", "succeeded", "failed", "confirmed"]);
