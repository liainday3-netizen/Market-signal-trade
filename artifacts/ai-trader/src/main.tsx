import { createRoot } from "react-dom/client";
import App from "./App";
import { installAdminFetch } from "./lib/adminAuth";
import "./index.css";

installAdminFetch();

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err) => console.warn("SW registration failed", err));
  });
}
