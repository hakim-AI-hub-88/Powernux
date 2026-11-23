import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Titlebar from "./components/Titlebar";
import Sidebar, { type PageId } from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import ToolsManager from "./pages/ToolsManager";
import Settings from "./pages/Settings";
import About from "./pages/About";
import ToolDetails from "./pages/ToolDetails";
import "./styles.css";

export default function App() {
  const [page, setPage] = useState<PageId>("dashboard");
  const [maximized, setMaximized] = useState(false);
  const [toolId, setToolId] = useState<string | null>(null);

  const navigate = (p: PageId) => {
    setPage(p);
    setToolId(null);
  };

  // Fenêtre agrandie : pas de coins arrondis.
  useEffect(() => {
    const win = getCurrentWindow();
    const refresh = () => win.isMaximized().then(setMaximized);
    refresh();
    const unlisten = win.onResized(refresh);
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return (
    <div className={`app ${maximized ? "maximized" : ""}`}>
      <Sidebar current={page} onNavigate={navigate} />
      <div className="main">
        <Titlebar />
        <main className="content">
          {page === "dashboard" && <Dashboard onNavigate={navigate} />}
          {page === "tools" && !toolId && <ToolsManager onOpen={setToolId} />}
          {page === "tools" && toolId && <ToolDetails id={toolId} onBack={() => setToolId(null)} />}
          {page === "settings" && <Settings />}
          {page === "about" && <About />}
        </main>
      </div>
    </div>
  );
}
