console.log("process.type:", process.type);
console.log("process.versions.electron:", process.versions.electron);
console.log("process.versions.chrome:", process.versions.chrome);
console.log("ELECTRON_RUN_AS_NODE:", process.env.ELECTRON_RUN_AS_NODE);
const e = require("electron");
console.log("typeof electron:", typeof e);
if (typeof e !== "string" && e.app) e.app.quit();
else process.exit(0);
