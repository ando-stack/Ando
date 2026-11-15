import type { Fact, ResearchResult } from "../core/types.ts";
import { isStale } from "./factbank.ts";

/** Normalize page text and quotes so curly quotes, dashes and whitespace don't break matching. */
export function normalizeText(s: string): string {
  return s
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

export function htmlToText(html: string): string {
  return normalizeText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

/** A quote may contain "..." elisions; every fragment must appear on the page. */
export function quoteFound(pageText: string, quote: string): boolean {
  const frags = quote
    .split(/\.\.\.|…/)
    .map((f) => normalizeText(f).replace(/^[\s.,;:-]+|[\s.,;:-]+$/g, ""))
    .filter((f) => f.length >= 6);
  return frags.length > 0 && frags.every((f) => pageText.includes(f));
}

const pageCache = new Map<string, Promise<{ status: number; text: string } | null>>();

export async function fetchPage(url: string, timeoutMs = 20000): Promise<{ status: number; text: string } | null> {
  if (!pageCache.has(url)) {
    pageCache.set(
      url,
      (async () => {
        try {
          const res = await fetch(url, {
            signal: AbortSignal.timeout(timeoutMs),
            headers: { "user-agent": "Mozilla/5.0 (compatible; ShortsFactoryFactCheck/1.0)", accept: "text/html" },
            redirect: "follow",
          });
          const body = await res.text();
          return { status: res.status, text: htmlToText(body) };
        } catch {
          return null;
        }
      })(),
    );
  }
  return pageCache.get(url)!;
}

/**
 * Fact-check every claim used by a project.
 * - CONFIRMED_FACT: re-fetch each primary source; the stored quote must still be on the page.
 * - THEORY / SPECULATION / AI_CONCEPT: no source needed, but the narration must carry its hedge.
 * - Time-sensitive facts past their recheck date are flagged "stale" and block production.
 */
export async function factCheck(facts: Fact[], opts: { online?: boolean } = {}): Promise<ResearchResult> {
  const online = opts.online ?? process.env.FACTORY_OFFLINE !== "1";
  const result: ResearchResult = { checkedAt: new Date().toISOString(), online, facts: [], notes: [] };

  for (const f of facts) {
    const entry: ResearchResult["facts"][number] = { id: f.id, claim: f.claim, label: f.label, verdict: "verified", sources: [] };
    if (isStale(f)) {
      entry.verdict = "stale";
      entry.notes = `Time-sensitive fact past its recheck date (${f.recheckAfter}). Update data/fact-bank.json from the source.`;
    }
    if (f.label !== "CONFIRMED_FACT") {
      entry.notes = `${f.label}: narration hedged with "${f.hedge ?? "n/a"}". Not presented as fact.`;
      result.facts.push(entry);
      continue;
    }
    let anyVerified = false;
    let anyReachable = false;
    for (const s of f.sources) {
      if (!online) {
        entry.sources.push({ ...s });
        continue;
      }
      const page = await fetchPage(s.url);
      const reachable = Boolean(page && page.status >= 200 && page.status < 400);
      anyReachable ||= reachable;
      const found = reachable && s.quote ? quoteFound(page!.text, s.quote) : false;
      if (found) anyVerified = true;
      entry.sources.push({
        ...s,
        reachable,
        httpStatus: page?.status,
        retrievedAt: reachable ? new Date().toISOString().slice(0, 10) : s.retrievedAt,
      });
    }
    if (entry.verdict !== "stale") {
      if (!online) {
        entry.verdict = "source-unreachable";
        entry.notes = `Offline: relying on fact-bank verification dated ${f.sources[0]?.retrievedAt}.`;
      } else if (anyVerified) {
        entry.verdict = "verified";
        entry.notes = "Quote found on primary source today.";
      } else if (anyReachable) {
        entry.verdict = "unsupported";
        entry.notes = "Source reachable but the quoted text is no longer on the page. Re-check the claim before publishing.";
      } else {
        entry.verdict = "source-unreachable";
        entry.notes = `Source could not be fetched; relying on fact-bank verification dated ${f.sources[0]?.retrievedAt}.`;
      }
    }
    result.facts.push(entry);
  }

  // Always record the game's current official status, so scripts never assume a date.
  if (online) {
    const home = await fetchPage("https://www.rockstargames.com/VI");
    if (home) {
      const m = home.text.match(/coming (\w+ \d{1,2}, \d{4})/);
      const out = /out now|available now/.test(home.text);
      result.notes.push(
        out
          ? "Rockstar's official page says GTA VI is OUT NOW."
          : m
            ? `Rockstar's official page says: coming ${m[1]} (checked ${result.checkedAt.slice(0, 10)}).`
            : "Could not read the release status from Rockstar's page.",
      );
    } else result.notes.push("Rockstar's official page could not be reached for a release-status check.");
  }
  return result;
}

/** Errors that must stop production. Unreachable-but-previously-verified sources are warnings. */
export function blockingProblems(r: ResearchResult): string[] {
  return r.facts
    .filter((f) => f.verdict === "stale" || f.verdict === "unsupported")
    .map((f) => `${f.id}: ${f.verdict} — ${f.notes ?? ""}`);
}
