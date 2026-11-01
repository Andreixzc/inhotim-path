// Plans routes off the main thread, so the page stays responsive on slow phones.
// Messages in: {type: "park", park} once, then {type: "plan", id, request}.
// Messages out: {id, plan} or {id, error: {code, message}}.

import { Park } from "./plan.js";

let park = null;

self.addEventListener("message", ({ data }) => {
  if (data.type === "park") {
    park = new Park(data.park);
  } else if (data.type === "plan") {
    try {
      self.postMessage({ id: data.id, plan: park.plan(data.request) });
    } catch (error) {
      const code = error.code ?? "error";
      self.postMessage({ id: data.id, error: { code, message: String(error.message) } });
    }
  }
});
