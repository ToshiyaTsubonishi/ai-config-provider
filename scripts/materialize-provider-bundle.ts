import { parseArgs } from "node:util";

import { materializeProviderBundle } from "../src/bundle.js";

const { values } = parseArgs({
  options: {
    "ai-config-dir": {
      type: "string",
      default: "../ai-config",
    },
    "output-dir": {
      type: "string",
      default: "provider-bundle",
    },
    clean: {
      type: "boolean",
      default: true,
    },
  },
});

const result = await materializeProviderBundle({
  aiConfigDir: values["ai-config-dir"],
  outputDir: values["output-dir"],
  clean: values.clean,
});

console.log(JSON.stringify(result, null, 2));
