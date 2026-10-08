import type { BotTask } from "../../protocol/entities";

/** "claude-sonnet-5-5[1m]" -> "Sonnet". */
export function modelName(id: string): string {
  const family = /(opus|sonnet|haiku|fable)/i.exec(id)?.[1];
  return family === undefined ? id : family[0].toUpperCase() + family.slice(1).toLowerCase();
}

/** The chosen model, and once the task ran, the one it ran with. */
export function modelBadge(task: BotTask): { readonly label: string; readonly title: string } {
  const chosen = task.model === undefined ? "Auto" : modelName(task.model);
  if (task.ran_with === undefined) {
    return { label: chosen, title: `Model: ${chosen}` };
  }
  const used = modelName(task.ran_with);
  return {
    label: chosen === used ? used : `${chosen} → ${used}`,
    title: `Model: ${chosen}, ran with ${task.ran_with}`,
  };
}
