import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
const App = lazy(() => import("./App"));
const BloggerForm = lazy(() => import("./TelegramBloggerForm"));
const Screen = new URLSearchParams(window.location.search).get("miniapp") === "blogger" ? BloggerForm : App;
import "./index.css";
createRoot(document.getElementById("root")).render(<StrictMode><Suspense fallback={<p style={{padding:24}}>Загрузка…</p>}><Screen /></Suspense></StrictMode>);
