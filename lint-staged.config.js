const oxBatchSize = 40;

export default {
  "*.{js,jsx,ts,tsx,mjs,cjs}": (filenames) => {
    const commands = [];
    for (let i = 0; i < filenames.length; i += oxBatchSize) {
      const batch = filenames
        .slice(i, i + oxBatchSize)
        .map((f) => `"${f}"`)
        .join(" ");
      commands.push(`oxlint --type-aware --fix --deny-warnings ${batch}`);
      commands.push(`oxfmt --write ${batch}`);
    }
    return commands;
  },
  "*.{json,jsonc,css,md,html,yml,toml}": (filenames) => {
    const commands = [];
    for (let i = 0; i < filenames.length; i += oxBatchSize) {
      const batch = filenames
        .slice(i, i + oxBatchSize)
        .map((f) => `"${f}"`)
        .join(" ");
      commands.push(`oxfmt --write ${batch}`);
    }
    return commands;
  },
};
