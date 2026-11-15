import { CATEGORIES, LABEL_TEXT, type Idea, type Metadata, type ResearchResult, type ScenePlan, type Script } from "../core/types.ts";
import { factById } from "../content/factbank.ts";

const CATEGORY_TAG: Record<string, string> = {
  secrets: "#GTA6Secrets",
  facts: "#Leonida",
  theories: "#GTA6Theory",
  comparisons: "#GTA5",
  mysteries: "#GTA6Theory",
  "ai-concepts": "#GTA6Concept",
  news: "#GTA6News",
  characters: "#Leonida",
};

const titleCase = (s: string) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…");

/** Build honest, specific titles from the actual content (no "you won't believe", no fake urgency). */
function titles(idea: Idea, script: Script): string[] {
  const out = new Set<string>([idea.title]);
  const mains = script.segments.filter((s) => s.role === "main");
  const firstFact = mains[0]?.factIds[0] ? factById(mains[0].factIds[0]) : undefined;
  const names = [...new Set(mains.flatMap((m) => m.factIds.map((id) => factById(id)?.keywords[0]).filter(Boolean) as string[]))]
    .map((k) => titleCase(k))
    .slice(0, 3);
  if (idea.format === "listicle" && names.length >= 2) out.add(`GTA 6: What Rockstar Revealed About ${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`);
  if (firstFact) {
    const key = firstFact.emphasis[0];
    if (key) out.add(`GTA 6's ${titleCase(firstFact.keywords[0])} Detail Most Fans Missed (${titleCase(key)})`);
  }
  if (idea.format === "theory") out.add(`GTA 6 Theory: ${clip(idea.angle.split("→")[1]?.split(":")[1]?.trim() ?? idea.title, 60)}`);
  out.add(`${idea.title.replace(/GTA 6/, "GTA VI")} | Official Details Only`);
  out.add(`Hidden GTA 6 Details From Rockstar's Official Bios`);
  return [...out].map((t) => clip(t, 90)).slice(0, 3);
}

export function buildMetadata(idea: Idea, script: Script, research: ResearchResult, plan: ScenePlan): Metadata {
  const usedIds = [...new Set(script.segments.flatMap((s) => s.factIds))];
  const facts = usedIds.map((id) => factById(id)).filter(Boolean);
  const labels = [...new Set(script.segments.map((s) => s.label).filter((l) => l !== "NONE"))];
  const verified = new Map(research.facts.map((f) => [f.id, f]));

  const sources: Metadata["sources"] = [];
  for (const id of usedIds) {
    const r = verified.get(id);
    for (const s of r?.sources ?? []) if (!sources.some((x) => x.url === s.url)) sources.push({ url: s.url, title: s.title, retrievedAt: s.retrievedAt });
  }

  const aiAssets = plan.scenes.some((s) => s.asset.aiGenerated) || labels.includes("AI_CONCEPT");
  const aiDisclosure: Metadata["aiDisclosure"] = {
    recommended: true,
    youtubeAlteredContentToggle: aiAssets,
    reason: aiAssets
      ? "The video contains AI-generated visuals of game concepts that could be mistaken for real footage. Turn on YouTube's 'Altered or synthetic content' setting."
      : "Narration uses a synthetic (text-to-speech) voice and visuals are original stylized motion graphics, not realistic footage. YouTube's altered-content toggle is not required for this, but a short note in the description is good practice.",
    descriptionLine: aiAssets
      ? "Contains AI-generated concept visuals. Not real gameplay."
      : "Narrated with an AI voice. Visuals are original motion graphics, not gameplay footage.",
  };

  const hook = script.segments.find((s) => s.role === "hook")?.text ?? idea.hook;
  const payoff = script.segments.find((s) => s.role === "payoff")?.text ?? "";
  const question = payoff.match(/[^.!?]*\?/)?.[0]?.trim() ?? "Which detail did you already know?";
  const bullets = facts.map((f) => `• ${f!.claim} [${LABEL_TEXT[f!.label]}]`).join("\n");
  const hashtags = ["#GTA6", "#GTAVI", CATEGORY_TAG[idea.category] ?? "#Rockstar"];
  const releaseNote = research.notes.find((n) => /official page/i.test(n));

  const description = [
    `${hook} Everything here comes from Rockstar's own pages, and anything that isn't confirmed is clearly labelled.`,
    "",
    bullets,
    "",
    releaseNote ? `Status check: ${releaseNote}` : "",
    "Sources:",
    ...sources.map((s) => `${s.title} — ${s.url} (checked ${s.retrievedAt.slice(0, 10)})`),
    "",
    aiDisclosure.descriptionLine,
    "Not affiliated with or endorsed by Rockstar Games or Take-Two Interactive. Grand Theft Auto is a trademark of Take-Two Interactive.",
    "",
    hashtags.join(" "),
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");

  return {
    titles: titles(idea, script),
    description,
    hashtags,
    pinnedComment: `${question} Sources for every claim are in the description. 👇`,
    category: CATEGORIES.find((c) => c.id === idea.category)?.name ?? idea.category,
    youtubeCategoryId: 20,
    sources,
    aiDisclosure,
    labelsUsed: labels.map((l) => LABEL_TEXT[l as keyof typeof LABEL_TEXT]),
  };
}
