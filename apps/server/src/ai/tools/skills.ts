import { readFile } from "node:fs/promises";
import type { ToolDef } from "./index.js";
import {
  getSkill,
  getSkillByName,
  listSkills,
} from "../../db/repos/skills.js";

export function makeSkillsTools(): ToolDef[] {
  const list: ToolDef = {
    declaration: {
      name: "list_skills",
      description:
        "List available reusable AI skill scripts (markdown SKILL.md prompts). " +
        "Returns trimmed records (id, name, description) for enabled skills only. " +
        "Call `load_skill(name)` to fetch the full skill content when one matches the user's request.",
      parameters: { type: "object", properties: {} },
    },
    handler: async () => {
      const all = await listSkills();
      return {
        ok: true,
        skills: all
          .filter((s) => s.enabled)
          .map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
          })),
      };
    },
  };

  const load: ToolDef = {
    declaration: {
      name: "load_skill",
      description:
        "Load and follow a skill's instructions. Pass either `id` (preferred) or `name`. " +
        "Returns the full skill content as `instructions` — read and follow it carefully in your next turn.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Skill id from list_skills." },
          name: { type: "string", description: "Skill name (e.g. 'grail-explorer')." },
        },
      },
    },
    handler: async (args) => {
      const a = args as { id?: unknown; name?: unknown };
      const id = typeof a.id === "string" && a.id.trim() !== "" ? a.id.trim() : null;
      const name = typeof a.name === "string" && a.name.trim() !== "" ? a.name.trim() : null;
      if (!id && !name) return { ok: false, error: "provide id or name" };
      const skill = id ? await getSkill(id) : await getSkillByName(name!);
      if (!skill) return { ok: false, error: "skill not found" };
      let content = skill.content;
      if (skill.path) {
        try {
          content = await readFile(skill.path, "utf8");
        } catch (err) {
          return {
            ok: false,
            error: `path not readable: ${skill.path} (${err instanceof Error ? err.message : String(err)})`,
          };
        }
      }
      return {
        ok: true,
        name: skill.name,
        instructions: `Read and follow this skill carefully:\n\n${content}`,
      };
    },
  };

  return [list, load];
}
