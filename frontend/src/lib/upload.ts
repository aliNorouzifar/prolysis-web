// Multipart upload via the BFF proxy (same-origin /api/upload).
export interface UploadResult {
  session_id: string;
  artifact_id: string;
  kind: string;
  num_traces: number;
  num_events: number;
  num_variants: number;
  activities: string[];
}

export interface CsvMapping {
  case_column?: string;
  activity_column?: string;
  timestamp_column?: string;
}

export async function uploadLog(
  file: File,
  sessionId: string,
  kind: string,
  csv?: CsvMapping,
): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("session_id", sessionId);
  form.append("kind", kind);
  if (csv?.case_column) form.append("case_column", csv.case_column);
  if (csv?.activity_column) form.append("activity_column", csv.activity_column);
  if (csv?.timestamp_column) form.append("timestamp_column", csv.timestamp_column);

  const res = await fetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) {
    let detail = `upload failed (${res.status})`;
    try {
      const j = (await res.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* keep default */
    }
    throw new Error(detail);
  }
  return (await res.json()) as UploadResult;
}
