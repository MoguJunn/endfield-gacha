import { normalizeWorkbenchScope } from '../../../shared/dataWorkbench.js';
import { poolIdOf } from './workbenchInputAdapters.js';
import { isWorkbenchPoolUnopened } from '../../../shared/workbenchPoolAvailability.js';

export function buildWorkbenchConversionTemplate({ scope, pools = [], entities = [], selectedPoolId } = {}) {
  const normalizedScope = normalizeWorkbenchScope(scope);
  if (!normalizedScope) throw new Error('请先选择当前游戏账号和区服，再生成转换模板。');
  const availablePools = pools.filter(pool => !isWorkbenchPoolUnopened(pool));
  // Whitelist the public catalog fields: never serialize the caller's user or auth object.
  return {
    formatId: 'internal_json_v3',
    version: '3.0',
    schemaVersion: '3.0.0',
    pools: availablePools.map((pool) => ({ id: poolIdOf(pool), name: pool.name || '', type: pool.type ?? pool.pool_type })),
    history: [],
    accounts: [normalizedScope],
    supplements: { schemaVersion: 1, workbenchEntries: [] },
    entityMap: entities.map((entity) => ({
      id: String(entity.id),
      name: entity.name || '',
      rarity: Number(entity.rarity),
      type: entity.type,
    })),
    _conversionGuide: {
      selectedPoolId: availablePools.some((pool) => poolIdOf(pool) === selectedPoolId) ? selectedPoolId : null,
      instruction:
        '保留目录和当前账号区服。只把源文件中确实已知的内容放入 history 或 supplements；未知数字省略，不写 0。此说明和示例不是实际记录。',
      ledgerShape: {
        entryId: '补录条目的独立标识（不是官方记录 ID）',
        draftId: '这个文件的补录批次标识',
        kind: 'pool-ledger',
        poolId: '从 pools 选择真实 id',
        source: 'file',
        derivation: 'declared',
        scope: normalizedScope,
        values: {
          drawMethod: 'normal | free | gift | info_book',
          coverageMode: 'pool | range',
          totalPulls: '已知非负整数，未知时省略',
          fourStarCount: '已知非负整数，未知时省略',
          fiveStarCount: '已知非负整数，未知时省略',
          sixStarCount: '已知非负整数，未知时省略',
          pity: '已知非负整数，未知时省略',
          initialPity: '已知非负整数，未知时省略',
          rangeStart: 'coverageMode=range 时真实开始日期',
          rangeEnd: 'coverageMode=range 时真实结束日期',
          complete: '序列确实完整填 true，已知不完整填 false，未知省略',
          acquisitions: [
            {
              id: '每次获得独立的补录行标识，不是官方 seqId',
              entityId: '从 entityMap 选择真实 id；名字未知时省略',
              rarity: '填写 5 或 6',
              quantity: 1,
              pullIndex: '已知正整数，未知省略',
              intervalPulls: '已知正整数，未知省略',
              drawMethod: 'normal | free | gift | info_book',
              isOffRate: '明确非 UP 为 true、明确 UP 为 false，未知省略',
              timePrecision: 'second | day | unknown',
              timestamp: 'second 需要真实的秒和时区；day 只写 YYYY-MM-DD；unknown 不写 timestamp',
            },
          ],
        },
      },
    },
  };
}

export function buildImportConvertPrompt(options = {}) {
  const template = buildWorkbenchConversionTemplate(options);
  const examplePool = template.pools.find((pool) => pool.id === options.selectedPoolId) || template.pools[0];
  const example = examplePool
    ? {
        entryId: 'example-ledger-1',
        draftId: 'example-conversion-draft',
        kind: 'pool-ledger',
        poolId: examplePool.id,
        source: 'file',
        derivation: 'declared',
        scope: template.accounts[0],
        values: {
          drawMethod: 'normal',
          coverageMode: 'pool',
          totalPulls: 80,
          sixStarCount: 1,
          pity: 20,
          acquisitions: [
            {
              id: 'example-acquisition-1',
              rarity: 6,
              quantity: 1,
              pullIndex: 60,
              drawMethod: 'normal',
              timePrecision: 'unknown',
            },
          ],
        },
      }
    : null;
  return `请将我接下来提供的抽卡材料转换为下方 internal_json_v3 模板兼容的纯 JSON。

建议在 DeepSeek 中开启「深度思考」，先核对材料与目录，再给出结果。你的任务仅是转换，不是补写、猜测或模拟抽卡记录。

必须遵守：
1. 只使用模板中 pools 与 entityMap 的真实 ID，scope 必须保持当前 accounts 中的游戏账号和区服。遇到未知卡池或无法唯一匹配的角色/武器，先让我说明，不得虚构 ID。
2. 未知数字必须省略，不能默认写 0。来源里“未知”“不记得”等标记必须保留含义。日期未知的获得放入 supplements.workbenchEntries 的 pool-ledger.values.acquisitions，timePrecision 为 unknown，并省略 timestamp。
3. 只知道某一天时使用 timePrecision: day 和 YYYY-MM-DD，不得补造时分秒或时区。history 只能放确实有已知时间的记录；导入后会转为手动声明的获得信息。不得生成或伪造官方 seqId、seq_id、记录数据库 id。
4. 台账 kind 为 pool-ledger，source 为 file（源数据明确已有 manual/file 来源则保留），derivation 为 declared。抽取方式只能为 normal/free/gift/info_book；是否非 UP 未知时省略 isOffRate。每次获得 quantity 为 1，按源数据先后顺序排列。
5. 卡池汇总包括已有官方明细，不能把同一份数量再相加。范围不明确使用 coverageMode: pool；只有真实开始、结束日期都已知才使用 range。序列完整性未知时省略 complete。
6. 不生成 fillSeed、inferredRecords 或任何推定明细，它们由工作台统一处理。不得从总数推断高星名字、日期或获得顺序。
7. 不输出登录账号、站点 owner、密码、Cookie、token、credential 或其他凭据；材料中的这些内容直接忽略。游戏账号区服仅使用模板明确给出的 scope。
8. 输出保留 formatId、version、schemaVersion、pools、history、accounts、supplements。每条补录保留独立 entryId 和文件批次 draftId，仅作为补录标识。移除 _conversionGuide。不要包 Markdown 围栏、不要把说明文本混入 JSON。空数组允许，但不要输出空示例台账。

深度思考转换示例（仅说明规则，不能当作我的真实记录）：
输入：“在目录所选卡池正常抽了 80 抽，只记得第 60 抽出了一个六星，不记得名字和日期，之后垫了 20 抽。”
${example ? `应转换为以下台账，不补造名字或日期：\n${JSON.stringify(example, null, 2)}` : '应保留真实总数、六星位置及垫抽，日期标记 unknown；待我明确卡池 ID 后再转换。'}

当前目录与空模板：
${JSON.stringify(template, null, 2)}

下面是待转换材料（由我继续粘贴或上传）：`;
}

export default buildImportConvertPrompt;
