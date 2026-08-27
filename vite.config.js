import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Optional HTTPS for on-device (phone) testing: set SEP11_HTTPS=1 before
// starting Vite. Normal development/build behavior is unchanged.
const httpsForDeviceTesting = process.env.SEP11_HTTPS === "1";

let plugins = [react()];
if (httpsForDeviceTesting) {
  const basicSsl = (await import("@vitejs/plugin-basic-ssl")).default;
  plugins.push(basicSsl());
}

export default defineConfig({
  plugins,
  server: httpsForDeviceTesting ? { host: true, https: {} } : {},
});
