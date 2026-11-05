import { useQuery } from "@apollo/client";
import { Select } from "@mantine/core";
import { ARTIFACTS, KIND_LABELS, type Artifact } from "../lib/artifacts";
import { sessionId } from "../lib/session";

/** Pick a workspace artifact of a given kind (e.g. the L+ input of IMbi).
 *  Pass `kinds` to accept several kinds (e.g. any event log). */
export function ArtifactSelect({
  kind,
  kinds,
  label,
  value,
  onChange,
  description,
}: {
  kind?: string;
  kinds?: string[];
  label: string;
  value: string | null;
  onChange: (id: string | null) => void;
  description?: string;
}) {
  const single = kinds ? undefined : kind;
  const { data } = useQuery<{ artifacts: Artifact[] }>(ARTIFACTS, {
    variables: { sessionId: sessionId(), kind: single ?? null },
    pollInterval: 4000,
  });
  let items = data?.artifacts ?? [];
  if (kinds) items = items.filter((a) => kinds.includes(a.kind));
  const what = single ? KIND_LABELS[single] ?? single : "log";
  return (
    <Select
      label={label}
      description={description}
      placeholder={
        items.length ? `Select a ${what}` : "No artifacts yet — upload or generate one"
      }
      data={items.map((a) => ({
        value: a.id,
        label: kinds ? `${a.name} · ${KIND_LABELS[a.kind] ?? a.kind}` : a.name,
      }))}
      value={value}
      onChange={onChange}
      searchable
      nothingFoundMessage="Nothing in the workspace"
    />
  );
}
