import {
  Button,
  Card,
  FileButton,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useState } from "react";
import { KIND_LABELS } from "../lib/artifacts";
import { sessionId } from "../lib/session";
import { uploadLog } from "../lib/upload";

/** Upload an XES or CSV event log into the workspace under a chosen kind. */
export function UploadCard({ onUploaded }: { onUploaded?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<string>("event_log");
  const [busy, setBusy] = useState(false);
  const isCsv = !!file && file.name.toLowerCase().endsWith(".csv");
  const [caseCol, setCaseCol] = useState("");
  const [actCol, setActCol] = useState("");
  const [tsCol, setTsCol] = useState("");

  const doUpload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await uploadLog(
        file,
        sessionId(),
        kind,
        isCsv
          ? { case_column: caseCol || undefined, activity_column: actCol || undefined, timestamp_column: tsCol || undefined }
          : undefined,
      );
      notifications.show({
        title: "Log stored",
        message: `${file.name}: ${res.num_traces} traces, ${res.num_events} events, ${res.num_variants} variants`,
        color: "teal",
      });
      setFile(null);
      onUploaded?.();
    } catch (e) {
      notifications.show({ title: "Upload failed", message: String(e), color: "red" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card withBorder>
      <Title order={5} mb="xs">
        Upload an event log
      </Title>
      <Stack gap="xs">
        <Group>
          <FileButton onChange={setFile} accept=".xes,.csv,.xes.gz,.gz">
            {(props) => (
              <Button variant="light" {...props}>
                Choose file (XES / CSV)
              </Button>
            )}
          </FileButton>
          <Text size="sm" c={file ? undefined : "dimmed"}>
            {file ? file.name : "No file selected"}
          </Text>
        </Group>
        <Select
          label="Store as"
          data={["event_log", "desirable_log", "undesirable_log"].map((k) => ({
            value: k,
            label: KIND_LABELS[k],
          }))}
          value={kind}
          onChange={(v) => setKind(v ?? "event_log")}
        />
        {isCsv && (
          <Group grow>
            <TextInput label="Case column" placeholder="auto-detect" value={caseCol} onChange={(e) => setCaseCol(e.currentTarget.value)} />
            <TextInput label="Activity column" placeholder="auto-detect" value={actCol} onChange={(e) => setActCol(e.currentTarget.value)} />
            <TextInput label="Timestamp column" placeholder="auto-detect" value={tsCol} onChange={(e) => setTsCol(e.currentTarget.value)} />
          </Group>
        )}
        <Button onClick={doUpload} disabled={!file} loading={busy}>
          Upload to workspace
        </Button>
      </Stack>
    </Card>
  );
}
