#!/usr/bin/env node

// Taken from https://www.davd.io/nodejs-interactive-shell-with-hot-reload/ 
// and adjusted to do hot reloading of ShopifyStockTransformation.js in dist folder when it changes
// To use run ./shell.js from one terminal and then run npm run build from another terminal after editing the ts file

const repl = require("repl")
const gaze = require("gaze")

function invalidateCache(file) {
    delete require.cache[require.resolve(file)]
}

function reloadModule(ctx, key, file) {
    invalidateCache(file)
    ctx[key] = require(file)
}

function reloadModules(ctx, moduleList) {
    Object.keys(moduleList).forEach(module => {
        reloadModule(ctx, module, modules[module])
    })
}

function watchForChanges() {
    gaze("dist/*.js", { mode: "poll" }, (err, watcher) => {
        watcher.on("all", (event, filepath) => {
            console.log("Reloading due to change in", filepath)

            reloadModules(ctx, modules)
        });
    });
}

const modules = {
    shopifyStock: "./dist/ShopifyTransform",
};

const ctx = repl.start({
    input: process.stdin,
    output: process.stdout
}).context;

watchForChanges();
reloadModules(ctx, modules);