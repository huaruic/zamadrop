import "dotenv/config";
import { app } from "./app.js";
import { config } from "./config.js";

app.listen(config.PORT, () => {
  console.log(`zamadrop-backend listening on :${config.PORT}`);
});
