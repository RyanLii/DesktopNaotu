// Collect only what the packaged app needs into build/stage.
var fs = require("fs"), path = require("path");
var root = path.join(__dirname, ".."), out = path.join(root, "build", "stage");
function copy(a, b) {
  if (fs.statSync(a).isDirectory()) {
    fs.mkdirSync(b, { recursive: true });
    fs.readdirSync(a).forEach(function (f) { copy(path.join(a, f), path.join(b, f)); });
  } else fs.copyFileSync(a, b);
}
fs.mkdirSync(out, { recursive: true });
copy(path.join(root, "dist"), path.join(out, "dist"));
var p = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
delete p.dependencies.electron;
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({
  name: p.name, version: p.version, description: p.description, main: p.main,
  author: p.author, license: p.license, dependencies: p.dependencies
}, null, 2));
