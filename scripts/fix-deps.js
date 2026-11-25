// gulp 3 pulls in graceful-fs < 4, which crashes on Node >= 12.
// Remove the nested old copies so they resolve to the top-level graceful-fs 4.
var fs = require("fs"), path = require("path");
var del;
try { del = require("del"); } catch (e) { process.exit(0); } // production install
var root = path.join(__dirname, "..", "node_modules");
fs.readdirSync(root).forEach(function (name) {
  var dir = path.join(root, name, "node_modules", "graceful-fs");
  var pkg = path.join(dir, "package.json");
  if (!fs.existsSync(pkg)) return;
  if (parseInt(JSON.parse(fs.readFileSync(pkg, "utf8")).version, 10) < 4) {
    del.sync([dir.replace(/\\/g, "/")], { force: true });
    console.log("removed old graceful-fs from " + name);
  }
});
