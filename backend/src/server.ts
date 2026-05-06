import "dotenv/config";
import { app } from "./app.js";
import { config } from "./config.js";
import { runIndexer } from "./indexer/worker.js";

app.listen(config.PORT, () => {
  console.log(`zamadrop-backend listening on :${config.PORT}`);
  // Start the chain indexer worker after the HTTP server is up so health
  // checks succeed before we touch the RPC.
  runIndexer();
});
