import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import "./theme.css";
import "./app.css";
import { Shell } from "./Shell.tsx";
import { Fleet } from "./pages/Fleet.tsx";
import { InstanceDetail } from "./pages/InstanceDetail.tsx";
import { CostAnalytics } from "./pages/CostAnalytics.tsx";
import { Alerts } from "./pages/Alerts.tsx";
import { Admin } from "./pages/Admin.tsx";

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: "/", element: <Navigate to="/fleet" replace /> },
      { path: "/fleet", element: <Fleet /> },
      { path: "/instances/:id", element: <InstanceDetail /> },
      { path: "/cost", element: <CostAnalytics /> },
      { path: "/alerts", element: <Alerts /> },
      { path: "/admin", element: <Admin /> },
    ],
  },
]);

// dark default
if (localStorage.getItem("bf-theme") === "light") {
  document.documentElement.setAttribute("data-theme", "light");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
