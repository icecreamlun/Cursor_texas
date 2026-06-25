import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import TableView from "./TableView";
import PlayView from "./PlayView";
import "./styles.css";

function App() {
  const [route, setRoute] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route.startsWith("#/play") ? <PlayView /> : <TableView />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
