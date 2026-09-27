import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { isAndroidDevice, syncNarrowViewportClass } from "./lib/viewport";

document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

if (isAndroidDevice()) {
  document.documentElement.classList.add("is-android");
}
syncNarrowViewportClass();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
