import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { AppUpdate } from "./components/app-update";
import { router } from "./router";
import "./reference.css";
import "./globals.css";

createRoot(document.getElementById("root")!).render(<><RouterProvider router={router} /><AppUpdate /></>);
