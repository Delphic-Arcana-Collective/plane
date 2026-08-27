import { loadEnv } from "./env.js";
import { startServer } from "./server.js";

const env = loadEnv();
startServer(env);
