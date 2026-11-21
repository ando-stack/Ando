import { STATUS_LABEL } from "@/lib/format";
import type { MatchStatus } from "@/lib/types";
import { Badge } from "./ui";

export function MatchStatusBadge({ status }: { status: MatchStatus }) {
  const tone = status === "completed" ? "brand" : status === "failed" || status === "incompatible" ? "danger" : status === "processing" || status === "queued" ? "warn" : "neutral";
  return <Badge tone={tone}>{STATUS_LABEL[status] || status}</Badge>;
}
