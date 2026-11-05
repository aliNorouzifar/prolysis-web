import { createTheme, rem } from "@mantine/core";

export const theme = createTheme({
  primaryColor: "indigo",
  primaryShade: { light: 6, dark: 4 },
  fontFamily:
    "'Inter Variable', Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
  fontFamilyMonospace:
    "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  defaultRadius: "md",
  headings: {
    fontWeight: "650",
    sizes: {
      h1: { fontSize: rem(34), lineHeight: "1.15" },
      h2: { fontSize: rem(26), lineHeight: "1.2" },
    },
  },
  components: {
    Card: {
      defaultProps: { radius: "lg" },
    },
    Button: {
      defaultProps: { radius: "md" },
    },
    Badge: {
      defaultProps: { radius: "sm" },
    },
    Tooltip: {
      defaultProps: { withArrow: true },
    },
  },
});
