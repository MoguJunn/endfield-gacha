# 小黑盒截图导入

`WorkbenchScreenshotImport` 自带 `WorkbenchDialog`。父组件按需加载即可；仅点击“开始识别”后创建 Worker 和加载 OCR 引擎、公开中文模型。原图留在浏览器，本模块不会调用保存 API。

```jsx
<WorkbenchScreenshotImport
  scope={scope}
  pools={pools}
  entities={entities}
  selectedPoolId={selectedPoolId}
  existingHistory={history}
  existingEntries={draft.entries}
  onApply={({ entries, warnings }) => { /* 追加待审草稿，由工作台继续确认 */ }}
  onClose={close}
/>
```

`onApply` 返回 `kind: 'pool-ledger'`、`source: 'xhh'`、`reviewState: 'unreviewed'`，`values` 包含 `drawMethod: 'normal'`、`coverageMode: 'pool'`、用户已确认的可选总数和 `acquisitions`。每件高星为一行、数量为 1；免费、赠送、情报书通过该行的 `drawMethod` 区分。日期证据保留 `day` 精度，没有年份的短日期保持未知。四星推算交给主模型，本模块不产生 `inferredRecords`、精确序列号或记录删除操作。

普通横条 `N抽` 默认为未知语义，必须选“出货间隔”或“池内位置”。间隔允许大于本池总抽数（跨池保底继承）；池内普通抽序不能超过池普通抽总数。免费区的数字代表该获得方式内的位置，免费十连不会并入普通总数。新版武器 `第N十连` 与方格角标保留批次、展开单件数量，无法从角标推断准确抽序；低星方格需在校对中取消勾选。

池名及实体候选来自传入的真实目录（含 `aliases` / `nameAliases`），没有 demo 固定池名单。头像比较参考 V2 的 RGB、边缘与色彩直方图描述子，仅提供前三候选；卡池、数量与每条身份均需用户确认，未知身份必须补齐或排除。摘要不会默认标成完整覆盖。

实体类型直接调用项目现有 `resolvePoolCapabilities(pool).entityType`；附加武器重构池依靠 `reconstruction_weapon_v1` profile 选择武器，角色重构和辉光庆典沿用项目既有能力定义。未分类附加池不会猜成角色池，需选择规则已明确的目录卡池。

## 同源资源

从应用根目录执行 `npm run ocr:prepare`。脚本由现有 `@paddleocr/paddleocr-js` 和 esbuild 打包浏览器 SDK，复制实测用到的 ONNX Runtime JSEP `.mjs` / `.wasm`，从 PaddlePaddle 官方 Hugging Face 项目下载公开模型并封装标准 tar。资源位于 `public/ocr/xhh/`，浏览器模型使用 SDK 支持的 `fetch` 回调读 CacheStorage，保留原始同源 URL，符合 `connect-src 'self'`；WASM 使用普通 HTTP 缓存。没有新增依赖，全部运行资源约 57.5 MB。

- 检测：`PP-OCRv6_tiny_det`，约 1.7 MB。
- 识别：`PP-OCRv6_small_rec`，约 20.3 MB。
- 引擎：`paddleocr.mjs`，包含 PaddleOCR、OpenCV 与 ONNX Runtime；只由 Worker 延迟导入。
- 实测 WASM：`wasm/ort-wasm-simd-threaded.jsep.wasm`，同目录保留配套 `.mjs`。

公开资源源站：<https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det_onnx>、<https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx>。PaddleOCR.js 为 Apache-2.0，OpenCV 为 Apache-2.0，ONNX Runtime 为 MIT；资源重新分发应保留这些许可证。

如果本机 Node 报系统代理证书错误，可在 Node 支持该参数时运行 `node --use-system-ca src/features/data-workbench/xhh/prepareResources.mjs`，不需要关闭 TLS 校验。构建、预览、部署必须携带上述 public 资源，或在其准备阶段执行 `ocr:prepare`。

## 验证

```text
npm run test:unit -- src/features/data-workbench/xhh/__tests__
npm run ocr:verify
node src/features/data-workbench/xhh/verifyBrowser.mjs "--image=D:/Learning/Endfield Gacha/_docs/小黑盒/heybox_1781028771181_-679236595（常驻池）.png"
node src/features/data-workbench/xhh/verifyBrowser.mjs "--origin=http://127.0.0.1:5183" "--pool-id=standard" "--image=D:/Learning/Endfield Gacha/_docs/小黑盒/heybox_1781028771181_-679236595（常驻池）.png"
```

`ocr:verify` 在随机本机端口启动专属短期静态服务，关闭所有外部浏览器请求，实际初始化模型并识别合成中文图，验证真实 WASM 与两个模型请求。可选 `--image` 仅原位读取 `_docs` 样例，不复制原图、不输出识别到的私人文字、不调用保存 API；运行结束关闭浏览器与专属服务。浏览器临时目录位于 D 盘工作区 `_tmp/ocr-browser-temp`。

`--origin` 使用已运行的本机预览服务，验证页面 CSP，并对 Worker 强制追加 `connect-src 'self'` 进行回归。配合 `--pool-id` 后仅 GET 读取本地预览目录，额外运行真实图到语义、裁图、头像候选的整链。专属脚本不会终止或修改现有预览服务。

已验证 2304×3606 常驻基准图：47 个文字块，1 个池段，2 条高星候选，识别到当前垫抽；所有候选未确认，完整覆盖标记为 false，2 条记录均保留原图裁图。5183 示例目录只有测试实体且头像缺失，身份保持未知。该证据证明模型、WASM、坐标、语义链可运行，不能据此声称真实身份准确率。武器十连角标和免费区等能力由合成 tokens 回归覆盖，其他真实布局仍需逐图人工校对。

OpenCV.js 现有包包含动态 JavaScript 函数生成。当前已验证的限制是 `connect-src 'self'`；如果部署未来对脚本额外设置禁止 JavaScript 动态执行的 CSP，需重新验证引擎兼容性。

专属测试使用合成 OCR tokens 与坐标，不包含用户图片。现有 `_docs/小黑盒/xhh-demo` 原件没有修改。
