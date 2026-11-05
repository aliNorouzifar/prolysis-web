import { useEffect, useRef } from "react";
import { ActionIcon, Stack, Tooltip, useComputedColorScheme } from "@mantine/core";
import NavigatedViewer from "bpmn-js/lib/NavigatedViewer";

import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";

// Below this zoom, gateway markers and labels stop being readable. Rather than
// squeezing wide models to fit, we start at a readable zoom aligned to the model
// start and let the user pan/zoom (mouse wheel + buttons).
const MIN_READABLE_ZOOM = 0.55;

interface CanvasApi {
  zoom(): number;
  zoom(level: number | string, center?: { x: number; y: number } | string): void;
  viewbox(): { inner: { x: number; y: number; width: number; height: number } };
  viewbox(box: { x: number; y: number; width: number; height: number }): void;
}

/** Interactive BPMN diagram (pan + scroll-zoom + buttons) rendered by bpmn-js.
 *  Colors follow the active color scheme; the initial zoom never drops below a
 *  readable level. */
export function BpmnCanvas({ xml, height }: { xml: string; height: string | number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<CanvasApi | null>(null);
  const scheme = useComputedColorScheme("light");

  useEffect(() => {
    if (!containerRef.current) return;
    const dark = scheme === "dark";
    const viewer = new NavigatedViewer({
      container: containerRef.current,
      bpmnRenderer: {
        defaultFillColor: dark ? "#25262b" : "#ffffff",
        defaultStrokeColor: dark ? "#c9cacd" : "#343a40",
        defaultLabelColor: dark ? "#c9cacd" : "#343a40",
      },
    } as ConstructorParameters<typeof NavigatedViewer>[0]);
    let cancelled = false;
    viewer
      .importXML(xml)
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const canvas = viewer.get("canvas") as unknown as CanvasApi;
        canvasRef.current = canvas;
        canvas.zoom("fit-viewport");
        if (canvas.zoom() < MIN_READABLE_ZOOM) {
          const inner = canvas.viewbox().inner;
          const vw = containerRef.current.clientWidth / MIN_READABLE_ZOOM;
          const vh = containerRef.current.clientHeight / MIN_READABLE_ZOOM;
          canvas.viewbox({
            x: inner.x - 16,
            y: inner.y + inner.height / 2 - vh / 2,
            width: vw,
            height: vh,
          });
        }
      })
      .catch((err: unknown) => console.error("BPMN import failed", err));
    return () => {
      cancelled = true;
      canvasRef.current = null;
      viewer.destroy();
    };
  }, [xml, scheme]);

  const zoomBy = (f: number) => {
    const c = canvasRef.current;
    if (c) c.zoom(c.zoom() * f);
  };
  const fit = () => canvasRef.current?.zoom("fit-viewport");

  return (
    <div style={{ position: "relative", height, width: "100%" }}>
      <div
        ref={containerRef}
        style={{
          height: "100%",
          width: "100%",
          background: "var(--mantine-color-body)",
          borderRadius: 8,
        }}
      />
      <Stack gap={4} style={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}>
        <Tooltip label="Zoom in" position="left">
          <ActionIcon variant="default" size="sm" onClick={() => zoomBy(1.25)} aria-label="zoom in">
            +
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Zoom out" position="left">
          <ActionIcon variant="default" size="sm" onClick={() => zoomBy(0.8)} aria-label="zoom out">
            −
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Fit whole model" position="left">
          <ActionIcon variant="default" size="sm" onClick={fit} aria-label="fit model">
            ⤢
          </ActionIcon>
        </Tooltip>
      </Stack>
    </div>
  );
}
