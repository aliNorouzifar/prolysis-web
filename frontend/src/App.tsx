import {
  ActionIcon,
  AppShell,
  Badge,
  Center,
  Group,
  Loader,
  NavLink,
  ScrollArea,
  Text,
  Title,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { Suspense, lazy } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";

import { HomePage } from "./pages/Home";
import { WorkspacePage } from "./pages/Workspace";
import { LogComparePage } from "./pages/LogCompare";
import { LlmPage } from "./pages/Llm";
import { RuleEditorPage } from "./pages/RuleEditor";
import { DiscriminativePage } from "./pages/Discriminative";
import { ImbiPage } from "./pages/Imbi";
import { ImrPage } from "./pages/Imr";
import { ImfPage } from "./pages/Imf";
import { ComparePage } from "./pages/Compare";
import { ActivityPage } from "./pages/Activity";
import { HealthPage } from "./pages/Health";

import "./app.css";

// X-PVI carries the chart renderer — load it only when the page is opened.
const XpviPage = lazy(() =>
  import("./pages/Xpvi").then((m) => ({ default: m.XpviPage })),
);

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light");
  const next = computed === "dark" ? "light" : "dark";
  return (
    <Tooltip label={`Switch to ${next} mode`}>
      <ActionIcon
        variant="default"
        size="lg"
        radius="md"
        aria-label="toggle color scheme"
        onClick={() => setColorScheme(next)}
      >
        {computed === "dark" ? "☀" : "☾"}
      </ActionIcon>
    </Tooltip>
  );
}

interface NavItem {
  label: string;
  to: string;
  hint?: string;
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Overview",
    items: [
      { label: "Home", to: "/" },
      { label: "Workspace", to: "/workspace" },
    ],
  },
  {
    group: "Prepare inputs",
    items: [
      { label: "Log comparison", to: "/logs", hint: "L+ vs L−" },
      { label: "X-PVI", to: "/variants", hint: "L → L+/L−" },
      { label: "Rule editor", to: "/rules", hint: "manual → R" },
      { label: "LLM rule extraction", to: "/llm", hint: "text → R" },
      { label: "Discriminative rules", to: "/discriminative", hint: "L± → R" },
    ],
  },
  {
    group: "Discover",
    items: [
      { label: "IMbi", to: "/discovery/imbi", hint: "L+ + L−" },
      { label: "IMr", to: "/discovery/imr", hint: "L + R" },
      { label: "IMf (baseline)", to: "/discovery/imf", hint: "L" },
    ],
  },
  {
    group: "Evaluate",
    items: [{ label: "Compare models", to: "/compare" }],
  },
  {
    group: "System",
    items: [
      { label: "Activity log", to: "/activity" },
      { label: "Health", to: "/health" },
    ],
  },
];

export function App() {
  const location = useLocation();
  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 264, breakpoint: "sm" }} padding="lg">
      <AppShell.Header className="app-header">
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <div className="brand-mark">P</div>
            <Title order={4} style={{ letterSpacing: "-0.01em" }}>
              Prolysis
            </Title>
          </Group>
          <Group gap="sm">
            <Text size="sm" c="dimmed" visibleFrom="sm">
              Desirability-aware process discovery · RWTH Aachen (PADS)
            </Text>
            <ColorSchemeToggle />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <ScrollArea>
          {NAV.map((section) => (
            <div key={section.group}>
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" mt="sm" mb={4} px="xs">
                {section.group}
              </Text>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  component={Link}
                  to={item.to}
                  label={
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <span>{item.label}</span>
                      {item.hint && (
                        <Badge size="xs" variant="light" color="gray">
                          {item.hint}
                        </Badge>
                      )}
                    </Group>
                  }
                  active={location.pathname === item.to}
                  style={{ borderRadius: 8 }}
                />
              ))}
            </div>
          ))}
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/workspace" element={<WorkspacePage />} />
          <Route path="/logs" element={<LogComparePage />} />
          <Route
            path="/variants"
            element={
              <Suspense
                fallback={
                  <Center h="60vh">
                    <Loader />
                  </Center>
                }
              >
                <XpviPage />
              </Suspense>
            }
          />
          <Route path="/rules" element={<RuleEditorPage />} />
          <Route path="/llm" element={<LlmPage />} />
          <Route path="/discriminative" element={<DiscriminativePage />} />
          <Route path="/discovery/imbi" element={<ImbiPage />} />
          <Route path="/discovery/imr" element={<ImrPage />} />
          <Route path="/discovery/imf" element={<ImfPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/health" element={<HealthPage />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
