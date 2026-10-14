// Reproducible public OCR assets. No screenshot or user data is read by this script.
import { mkdir, readFile, writeFile, copyFile, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const target = path.join(root, 'public', 'ocr', 'xhh');
const require = createRequire(import.meta.url);
const models = ['PP-OCRv6_tiny_det', 'PP-OCRv6_small_rec'];
const exists = async file => { try { return (await stat(file)).size; } catch { return 0; } };

function tar(files) {
  const blocks = [];
  for (const { name, bytes } of files) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'ascii');
    for (const [offset, size, value] of [[100, 8, 0o644], [108, 8, 0], [116, 8, 0], [124, 12, bytes.length], [136, 12, 0]]) header.write(value.toString(8).padStart(size - 1, '0') + '\0', offset, size, 'ascii');
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263);
    const checksum = header.reduce((sum, n) => sum + n, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

await mkdir(path.join(target, 'wasm'), { recursive: true });
await copyFile(path.join(path.dirname(require.resolve('@techstark/opencv-js')), '..', 'LICENSE'), path.join(target, 'APACHE-2.0.txt'));
const sdkVersion = JSON.parse(await readFile(path.join(path.dirname(fileURLToPath(import.meta.resolve('@paddleocr/paddleocr-js'))), '..', 'package.json'), 'utf8')).version;
const ortDist = path.dirname(require.resolve('onnxruntime-web'));
for (const name of await readdir(ortDist)) {
  // Browser verification confirms this SDK uses the JSEP WASM pair. Avoid shipping
  // unused Asyncify/JSPI binaries (each adds tens of megabytes).
  if (/^ort-wasm-simd-threaded\.jsep\.(wasm|mjs)$/u.test(name)) await copyFile(path.join(ortDist, name), path.join(target, 'wasm', name));
}
const shim = fileURLToPath(new URL('./emptyNodeShim.mjs', import.meta.url));
await build({ stdin: { contents: 'export { PaddleOCR } from "@paddleocr/paddleocr-js"; import cvModule from "@techstark/opencv-js"; export async function imageDataToMat(imageData) { const cv = cvModule instanceof Promise ? await cvModule : cvModule; return cv.matFromArray(imageData.height, imageData.width, cv.CV_8UC4, imageData.data); }', resolveDir: root, sourcefile: 'paddleocr-entry.mjs' },
  outfile: path.join(target, 'paddleocr.mjs'), bundle: true, format: 'esm', platform: 'browser', minify: true, logLevel: 'warning',
  alias: Object.fromEntries(['fs', 'path', 'crypto', 'node:fs', 'node:path', 'node:crypto'].map(name => [name, shim])) });
for (const model of models) {
  const file = path.join(target, `${model}_onnx_infer.tar`);
  if (await exists(file) > 1024) { console.log(`已存在模型：${model}`); continue; }
  console.log(`下载公开模型：${model}`);
  const files = [];
  for (const name of ['inference.onnx', 'inference.yml']) {
    const url = `https://huggingface.co/PaddlePaddle/${model}_onnx/resolve/main/${name}?download=true`;
    const response = await fetch(url, { signal: AbortSignal.timeout(240000) });
    if (!response.ok) throw new Error(`${model}/${name}: HTTP ${response.status}`);
    files.push({ name, bytes: Buffer.from(await response.arrayBuffer()) });
  }
  const bytes = tar(files);
  await writeFile(file, bytes);
  console.log(`已准备 ${model}：${(bytes.length / 1048576).toFixed(1)} MB`);
}
const wasmFiles = (await readdir(path.join(target, 'wasm'))).filter(name => name.endsWith('.wasm'));
if (!wasmFiles.length) throw new Error('安装的 onnxruntime-web 中没有真实 WASM 文件');
for (const name of wasmFiles) {
  const bytes = await readFile(path.join(target, 'wasm', name));
  if (bytes.readUInt32LE(0) !== 0x6d736100) throw new Error(`WASM 魔数错误：${name}`);
}
const resourceFiles = ['paddleocr.mjs', ...models.map(model => `${model}_onnx_infer.tar`), ...wasmFiles.map(name => `wasm/${name}`), 'wasm/ort-wasm-simd-threaded.jsep.mjs'];
const resources = [];
for (const file of resourceFiles) resources.push({ file, bytes: (await stat(path.join(target, file))).size });
await writeFile(path.join(target, 'manifest.json'), JSON.stringify({ sdkVersion, models, wasmFiles, resources }, null, 2));
console.log(`OCR 同源资源已准备：public/ocr/xhh（SDK ${sdkVersion}，${wasmFiles.length} 个真实 WASM 文件，总计 ${(resources.reduce((sum, asset) => sum + asset.bytes, 0) / 1048576).toFixed(1)} MB）`);
