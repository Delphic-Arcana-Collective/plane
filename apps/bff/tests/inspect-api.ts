import { MemoryCacheBackend } from "../src/cache/store.js";
import { createServer } from "../src/server.js";
import { createTestEnv } from "./test-utils.js";
import { createNavigationStressSnapshot } from "./fixtures/navigation-stress-snapshot.js";

const env = createTestEnv({ CACHE_INITIAL_FETCH: false });
const cache = new MemoryCacheBackend();
await cache.reset();
await cache.applySnapshot(createNavigationStressSnapshot(), env);
const app = createServer(env, cache);

const projects = await app.request("/api/workspaces/delphic/projects/");
const projectsBody = await projects.json();
const issues = await app.request(
  "/api/workspaces/delphic/projects/project-nav-beta/issues/?layout=list&group_by=state&per_page=100"
);
const issuesBody = await issues.json();

console.log(JSON.stringify({ projects: projectsBody, issueSample: issuesBody }, null, 2));
