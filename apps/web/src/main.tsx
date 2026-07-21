import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./light-theme.css";
import "./project-workbench-overrides.css";
import "./workbench/styles/tokens.css";
import "./workbench/styles/shell.css";
import "./workbench/styles/components.css";
import "./workbench/styles/responsive.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
