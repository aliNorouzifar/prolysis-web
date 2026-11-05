import { Group, SegmentedControl, useComputedColorScheme } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { HeatmapChart, LineChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { parseFigure, type ChartSpec, type MatrixSpec, type SignalSpec } from "../lib/figure";

echarts.use([
  LineChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  DataZoomComponent,
  MarkLineComponent,
  SVGRenderer,
]);

const FONT =
  "'Inter Variable', Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

// Fallback ramps only — figures normally carry their own (thesis-consistent)
// colorscale, which takes precedence. Both fallbacks pass the palette validator.
const SEQ_FALLBACK = {
  light: ["#f4f6ff", "#c7d2fe", "#91a7ff", "#5c7cfa", "#3b5bdb", "#2b3f9e"],
  dark: ["#1e2130", "#2b3a67", "#3f5bb5", "#748ffc", "#a5b7ff", "#dbe4ff"],
};
const DIV_FALLBACK = {
  light: ["#c2410c", "#f97316", "#f1f3f5", "#5c7cfa", "#3b5bdb"],
  dark: ["#f76707", "#b45309", "#2a2c33", "#5c7cfa", "#a5b7ff"],
};

function ink(dark: boolean) {
  return {
    text: dark ? "#c1c2c5" : "#495057",
    muted: dark ? "#8d8f96" : "#868e96",
    grid: dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)",
    axis: dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.14)",
    surface: dark ? "#1a1b1e" : "#ffffff",
    tooltipBg: dark ? "#25262b" : "#ffffff",
    tooltipBorder: dark ? "#373a40" : "#dee2e6",
  };
}

const tooltipStyle = (c: ReturnType<typeof ink>) => ({
  backgroundColor: c.tooltipBg,
  borderColor: c.tooltipBorder,
  borderWidth: 1,
  padding: [8, 12] as [number, number],
  textStyle: { color: c.text, fontFamily: FONT, fontSize: 12 },
  extraCssText: "border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);",
});

function rampOf(spec: { ramp?: string[]; diverging?: boolean }, dark: boolean): string[] {
  if (spec.ramp?.length) return spec.ramp; // the thesis palette carried by the figure
  return spec.diverging
    ? (dark ? DIV_FALLBACK.dark : DIV_FALLBACK.light)
    : (dark ? SEQ_FALLBACK.dark : SEQ_FALLBACK.light);
}

/** Signal as a 1-row heatmap strip — the visualization technique of the thesis figures. */
function stripOption(spec: SignalSpec, dark: boolean): echarts.EChartsCoreOption {
  const c = ink(dark);
  const data: [number, number, number][] = [];
  spec.values.forEach((v, i) => {
    if (v != null) data.push([i, 0, v]);
  });
  return {
    animationDuration: 500,
    grid: { left: 86, right: 76, top: 24, bottom: spec.xTitle ? 64 : 46 },
    xAxis: {
      type: "category",
      data: spec.labels,
      name: spec.xTitle,
      nameLocation: "middle",
      nameGap: 40,
      nameTextStyle: { color: c.muted, fontFamily: FONT },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: c.muted, fontFamily: FONT, fontSize: 10, rotate: 35, hideOverlap: true },
    },
    yAxis: {
      type: "category",
      data: [spec.rowLabel ?? ""],
      name: spec.yTitle,
      nameLocation: "middle",
      nameGap: 56,
      nameTextStyle: { color: c.muted, fontFamily: FONT },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: c.muted, fontFamily: FONT, fontSize: 11 },
    },
    tooltip: {
      ...tooltipStyle(c),
      formatter: (p: { data: [number, number, number] }) =>
        `${spec.labels[p.data[0]]}<br/>EMD · <b>${p.data[2].toFixed(3)}</b>`,
    },
    visualMap: {
      min: spec.min,
      max: spec.max,
      orient: "vertical",
      right: 4,
      top: "center",
      itemHeight: 120,
      itemWidth: 12,
      inRange: { color: rampOf(spec, dark) },
      textStyle: { color: c.muted, fontFamily: FONT, fontSize: 10 },
      formatter: (v: number) => v.toFixed(2),
    },
    series: [
      {
        type: "heatmap",
        data,
        itemStyle: { borderColor: c.surface, borderWidth: 2, borderRadius: 4 },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.3)" } },
      },
    ],
  };
}

/** Alternate line view of the same signal (dark end of the thesis ramp as line color). */
function lineOption(spec: SignalSpec, dark: boolean): echarts.EChartsCoreOption {
  const c = ink(dark);
  const ramp = rampOf(spec, dark);
  const accent = ramp[ramp.length - 1];
  return {
    animationDuration: 600,
    grid: { left: 52, right: 18, top: 18, bottom: spec.xTitle ? 58 : 40 },
    xAxis: {
      type: "category",
      data: spec.labels,
      name: spec.xTitle,
      nameLocation: "middle",
      nameGap: 34,
      nameTextStyle: { color: c.muted, fontFamily: FONT },
      axisLine: { lineStyle: { color: c.axis } },
      axisTick: { show: false },
      axisLabel: {
        color: c.muted, fontFamily: FONT, fontSize: 11, hideOverlap: true,
        formatter: (v: string) => (v.length > 9 ? v.split(" ")[0] : v),
      },
    },
    yAxis: {
      type: "value",
      name: "EMD",
      nameTextStyle: { color: c.muted, fontFamily: FONT },
      splitLine: { lineStyle: { color: c.grid } },
      axisLabel: { color: c.muted, fontFamily: FONT, fontSize: 11 },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: c.axis, type: "dashed" } },
      ...tooltipStyle(c),
      valueFormatter: (v: unknown) => (typeof v === "number" ? v.toFixed(3) : "—"),
    },
    dataZoom: [{ type: "inside" }],
    series: [
      {
        type: "line",
        data: spec.values,
        name: "change signal",
        smooth: 0.25,
        symbol: "circle",
        symbolSize: 7,
        showSymbol: false,
        lineStyle: { width: 2.5, color: accent, cap: "round" },
        itemStyle: { color: accent, borderColor: c.surface, borderWidth: 2 },
        emphasis: { scale: 1.4 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: accent + (dark ? "66" : "4d") },
            { offset: 1, color: accent + "00" },
          ]),
        },
        connectNulls: false,
      },
    ],
  };
}

function matrixOption(spec: MatrixSpec, dark: boolean): echarts.EChartsCoreOption {
  const c = ink(dark);
  const data: [number, number, number][] = [];
  spec.values.forEach((row, r) =>
    row.forEach((v, col) => {
      if (v != null) data.push([col, r, v]);
    }),
  );
  const small = !spec.dense;

  return {
    animationDuration: 500,
    grid: {
      left: small ? 90 : 230,
      right: 76,
      top: 12,
      bottom: spec.xTitle ? 56 : 40,
    },
    xAxis: {
      type: "category",
      data: spec.xLabels,
      name: spec.xTitle,
      nameLocation: "middle",
      nameGap: 32,
      nameTextStyle: { color: c.muted, fontFamily: FONT },
      axisLine: { show: false },
      axisTick: { show: false },
      splitArea: { show: false },
      axisLabel: {
        color: c.muted, fontFamily: FONT, fontSize: 11, hideOverlap: true,
        // Segment labels only where the figure declares them; a small matrix labels every column.
        ...(spec.xTicks ? { interval: (i: number) => spec.xTicks!.includes(i) } : small ? { interval: 0 } : {}),
      },
    },
    yAxis: {
      type: "category",
      data: spec.yLabels,
      inverse: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: c.muted, fontFamily: FONT, fontSize: small ? 11 : 10,
        formatter: (v: string) => (v.length > 34 ? v.slice(0, 33) + "…" : v),
      },
    },
    tooltip: {
      ...tooltipStyle(c),
      formatter: (p: { data: [number, number, number] }) => {
        const [x, y, v] = p.data;
        return `<b>${spec.yLabels[y]}</b><br/>${spec.xLabels[x]} · <b>${v.toFixed(3)}</b>`;
      },
    },
    visualMap: {
      min: spec.min,
      max: spec.max,
      calculable: false,
      orient: "vertical",
      right: 4,
      top: "center",
      itemHeight: 130,
      itemWidth: 12,
      inRange: { color: rampOf(spec, dark) },
      textStyle: { color: c.muted, fontFamily: FONT, fontSize: 10 },
      formatter: (v: number) => v.toFixed(1),
    },
    series: [
      {
        type: "heatmap",
        data,
        itemStyle: {
          borderColor: c.surface,
          borderWidth: small ? 4 : 1,
          borderRadius: small ? 8 : 2,
        },
        label: small
          ? {
              show: true,
              fontFamily: FONT,
              fontSize: 12,
              fontWeight: 600,
              formatter: (p: { data: [number, number, number] }) => p.data[2].toFixed(2),
              color: c.text,
              textBorderColor: c.surface,
              textBorderWidth: 3,
            }
          : { show: false },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.3)" } },
        markLine: spec.hLines.length || spec.vLines.length
          ? {
              silent: true,
              symbol: "none",
              label: { show: false },
              lineStyle: { color: c.text, type: "dashed", width: 1.5, opacity: 0.6 },
              data: [
                ...spec.hLines.map((y) => ({ yAxis: y })),
                // Change points: the segment boundaries of the PVI step.
                ...spec.vLines.map((x) => ({
                  xAxis: x,
                  lineStyle: { color: "#e03131", type: "dashed" as const, width: 2, opacity: 1 },
                })),
              ],
            }
          : undefined,
      },
    ],
  };
}

/**
 * Chart renderer for backend figures. Visualization techniques and color palettes
 * follow the THESIS figures (matrices as heatmaps on the figure's own colorscale;
 * the EMD signal as a heatmap strip) with modern interactivity on top; the signal
 * additionally offers a line view.
 */
export function Chart({ fig, height = 420 }: { fig: unknown; height?: number }) {
  const scheme = useComputedColorScheme("light");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [signalView, setSignalView] = useState<"strip" | "line">("strip");
  const spec: ChartSpec = parseFigure(fig);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, { renderer: "svg" }); // vector when printed
    const dark = scheme === "dark";
    if (spec.kind === "signal") {
      chart.setOption(signalView === "strip" ? stripOption(spec, dark) : lineOption(spec, dark));
    } else if (spec.kind === "matrix") {
      chart.setOption(matrixOption(spec, dark));
    }
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fig, scheme, signalView]);

  const isSignal = spec.kind === "signal";
  const chartHeight = isSignal && signalView === "strip" ? Math.min(height, 200) : height;

  return (
    <div>
      {isSignal && (
        <Group justify="flex-end" mb={4}>
          <SegmentedControl
            size="xs"
            value={signalView}
            onChange={(v) => setSignalView(v as "strip" | "line")}
            data={[
              { value: "strip", label: "Heatmap (thesis)" },
              { value: "line", label: "Line" },
            ]}
          />
        </Group>
      )}
      <div ref={containerRef} style={{ width: "100%", height: chartHeight }} />
    </div>
  );
}
