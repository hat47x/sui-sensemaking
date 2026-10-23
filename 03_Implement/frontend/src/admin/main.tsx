import React from "react";
import ReactDOM from "react-dom/client";

import { EpistemicAdminConsole } from "./EpistemicAdminConsole";
import { ModelAllowlistAdminConsole } from "./ModelAllowlistAdminConsole";

const root = document.getElementById("admin-root");
if (!root) {
  throw new Error("Missing #admin-root");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ModelAllowlistAdminConsole />
    <EpistemicAdminConsole />
  </React.StrictMode>,
);
