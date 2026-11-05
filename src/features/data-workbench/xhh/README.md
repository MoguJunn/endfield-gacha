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

## 官方资源下载

首次识别由浏览器直接下载资源，网站不提供模型、运行库或转发下载，也没有站内备用地址。

- 检测与识别模型使用 SDK 自带的 PaddlePaddle 官方存储地址：`https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/`，分别为 `PP-OCRv6_tiny_det`、`PP-OCRv6_small_rec` 的 ONNX tar 包。
- PaddleOCR.js `0.4.2`、OpenCV.js `4.10.0-release.1`、ONNX Runtime Web `1.26.0` 使用各项目官方 npm 发布包，经 `https://cdn.jsdelivr.net/npm/` 分发。jsDelivr 是第三方包分发 CDN；模型直接来自 Paddle 官方源站。
- 具体运行库地址集中在 `ocrResources.js`。WASM 和模型按原始下载地址存入浏览器 CacheStorage；下载失败可重新点击识别，完整资源会复用。
- WASM 完整下载后才交给 ONNX Runtime，避免慢速网络传输占用 SDK 固定的 60 秒模型初始化时限。下载本身最多等待 180 秒，截图始终在浏览器内处理。

部署 CSP 的 `connect-src` 需要允许 `https://cdn.jsdelivr.net` 和 `https://paddle-model-ecology.bj.bcebos.com`，模块脚本加载也需允许 jsDelivr。无需准备或随部署打包 OCR 大文件。

PaddleOCR.js、模型与 OpenCV 为 Apache-2.0，ONNX Runtime 为 MIT；来源与许可说明见 `public/ocr/xhh/THIRD-PARTY-NOTICES.md`。

## 验证

```text
npm run test:unit -- src/features/data-workbench/xhh/__tests__
node src/features/data-workbench/xhh/verifyBrowser.mjs
node src/features/data-workbench/xhh/verifyBrowser.mjs "--image=D:/Learning/Endfield Gacha/_docs/小黑盒/heybox_1781028771181_-679236595（常驻池）.png"
node src/features/data-workbench/xhh/verifyBrowser.mjs "--origin=http://127.0.0.1:5183" "--pool-id=standard" "--image=D:/Learning/Endfield Gacha/_docs/小黑盒/heybox_1781028771181_-679236595（常驻池）.png"
```

验证脚本在随机本机端口启动专属短期静态服务，实际初始化模型并识别合成中文图，核对 WASM 来自发布包 CDN、两个模型来自 Paddle 官方地址、没有站内 OCR 下载。可选 `--image` 仅原位读取 `_docs` 样例，不复制原图、不输出识别到的私人文字、不调用保存 API；运行结束关闭浏览器与专属服务。浏览器临时目录位于 D 盘工作区 `_tmp/ocr-browser-temp`。

`--origin` 使用已运行的本机预览服务，验证页面 CSP，并对 Worker 强制追加仅允许本机与上述两个下载源的 `connect-src`。配合 `--pool-id` 后仅 GET 读取本地预览目录，额外运行真实图到语义、裁图、头像候选的整链。专属脚本不会终止或修改现有预览服务。

已验证 2304×3606 常驻基准图：47 个文字块，1 个池段，2 条高星候选，识别到当前垫抽；所有候选未确认，完整覆盖标记为 false，2 条记录均保留原图裁图。5183 示例目录只有测试实体且头像缺失，身份保持未知。该证据证明模型、WASM、坐标、语义链可运行，不能据此声称真实身份准确率。武器十连角标和免费区等能力由合成 tokens 回归覆盖，其他真实布局仍需逐图人工校对。

OpenCV.js 现有包包含动态 JavaScript 函数生成。如果部署未来对脚本额外设置禁止 JavaScript 动态执行的 CSP，需重新验证引擎兼容性。

专属测试使用合成 OCR tokens 与坐标，不包含用户图片。现有 `_docs/小黑盒/xhh-demo` 原件没有修改。
