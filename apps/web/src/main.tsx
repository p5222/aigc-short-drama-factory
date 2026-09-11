import React from "react";
import { createRoot } from "react-dom/client";
// Keep the existing page CSS cascade eager while route JavaScript is split.
import "./admin/admin.css";
import "./admin/admin-enhancements.css";
import "./pages/CineHome.css";
import "./pages/PublicShowcase.css";
import "./pages/scripts-page.css";
import "./workbench/stages/deliveryExportQuote.css";
import "./pages/ProjectStudioV4.css";
import "./content/content.css";
import { App } from "./App";
import "./styles.css";
import "./light-theme.css";
import "./project-workbench-overrides.css";
import "./workbench/styles/tokens.css";
import "./workbench/styles/shell.css";
import "./workbench/styles/components.css";
import "./workbench/styles/stages.css";
import "./workbench/styles/responsive.css";
import "./design-system/semantic-tokens.css";
import "./design-system/components.css";
import "./creation-workspace.css";
import "./theme-contract.css";
import "./components/creator-shell.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
