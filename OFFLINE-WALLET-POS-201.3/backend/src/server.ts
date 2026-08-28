import dotenv from "dotenv";
dotenv.config();

import { app } from "./app";
import { initTables } from "./domain/setup/init_tables";

const PORT = 3002;

const start = async () => {
  await initTables();
  app.listen(PORT, '0.0.0.0', () => {
    console.log("Server running on port", PORT);
  });
};

start();
