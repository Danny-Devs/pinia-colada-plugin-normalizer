// The app-side worker file for sqliteEngine (bring-your-own-worker pattern):
// the app's bundler resolves @sqlite.org/sqlite-wasm and its .wasm asset here.
import { runSqliteWorker } from "pinia-colada-plugin-normalizer/sqlite-worker";

runSqliteWorker();
