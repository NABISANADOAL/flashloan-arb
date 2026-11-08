import { runBot } from "./bot";

runBot().catch((err) => {
  console.error(err);
  process.exit(1);
});
