// Copies the browser libraries into public/vendor so public/ can be hosted as a static site (GitHub Pages).
import fs from 'fs';
const files = {
  'node_modules/three/build/three.module.js': 'three.module.js',
  'node_modules/three/build/three.core.js': 'three.core.js',
  'node_modules/peerjs/dist/peerjs.min.js': 'peerjs.min.js',
};
fs.mkdirSync('public/vendor', { recursive: true });
for (const [from, to] of Object.entries(files)) fs.copyFileSync(from, 'public/vendor/' + to);
console.log('public/ is ready to host as a static site');
