import React from "react";
import ReactDOM from "react-dom/client";
import { ApolloProvider } from "@apollo/client";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { BrowserRouter } from "react-router-dom";

import "@fontsource-variable/inter";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

import { apollo } from "./apollo";
import { theme } from "./theme";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ApolloProvider client={apollo}>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <Notifications position="top-right" />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </MantineProvider>
    </ApolloProvider>
  </React.StrictMode>,
);
