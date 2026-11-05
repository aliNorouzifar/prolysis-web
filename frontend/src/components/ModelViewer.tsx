import {
  ActionIcon,
  Card,
  Group,
  SegmentedControl,
  Slider,
  Text,
  Tooltip,
} from "@mantine/core";
import { useState } from "react";
import { BpmnCanvas } from "./BpmnViewer";

function download(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Discovered process model viewer: BPMN (bpmn-js, default — the readable business
 * notation) with the formal Petri net one toggle away. Fixed height so the page
 * layout never jumps.
 */
export function ModelViewer({
  svg,
  bpmnXml,
  title,
  height = "56vh",
}: {
  svg: string;
  bpmnXml?: string | null;
  title?: string;
  height?: string;
}) {
  const hasBpmn = !!bpmnXml;
  const [view, setView] = useState<"bpmn" | "petri">(hasBpmn ? "bpmn" : "petri");
  const [zoom, setZoom] = useState(100);
  const safeName = (title ?? "model").replace(/\W+/g, "_");

  return (
    <Card withBorder padding="xs">
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Text fw={600} size="sm" truncate>
          {title ?? "Process model"}
        </Text>
        <Group gap="xs" wrap="nowrap">
          {hasBpmn && (
            <SegmentedControl
              size="xs"
              value={view}
              onChange={(v) => setView(v as "bpmn" | "petri")}
              data={[
                { value: "bpmn", label: "BPMN" },
                { value: "petri", label: "Petri net" },
              ]}
            />
          )}
          {view === "petri" && (
            <Slider
              value={zoom}
              onChange={setZoom}
              min={25}
              max={300}
              step={5}
              label={(v) => `${v}%`}
              w={120}
              size="sm"
            />
          )}
          <Tooltip label={view === "bpmn" ? "Download .bpmn" : "Download SVG"}>
            <ActionIcon
              variant="light"
              aria-label="download model"
              onClick={() =>
                view === "bpmn" && bpmnXml
                  ? download(bpmnXml, "application/xml", `${safeName}.bpmn`)
                  : download(svg, "image/svg+xml", `${safeName}.svg`)
              }
            >
              ⤓
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {view === "bpmn" && bpmnXml ? (
        <BpmnCanvas xml={bpmnXml} height={height} />
      ) : (
        <div
          style={{
            overflow: "auto",
            height,
            background: "var(--mantine-color-body)",
            borderRadius: 8,
          }}
        >
          <div style={{ zoom: zoom / 100 }} dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      )}
    </Card>
  );
}
