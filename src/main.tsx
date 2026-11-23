import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsProvider } from "./state/settings";
import { ToolsProvider } from "./state/tools";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SettingsProvider>
      <ToolsProvider>
        <App />
      </ToolsProvider>
    </SettingsProvider>
  </React.StrictMode>,
);
