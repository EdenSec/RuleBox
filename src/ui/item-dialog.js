/**
 * 自定义条目表单（语法 / Payload）
 * 设置页与面板共用：两端新增、编辑都走同一个弹窗，
 * 避免面板另写一套简化表单，造成字段校验、风险等级规则不一致。
 */

import { uid, base64ToBytes, el } from '../core/utils.js';
import { extractVars } from '../core/template.js';
import { toast } from './components.js';
import { openFormDialog } from './form-dialog.js';

const RISK_VALUES = ['recon', 'safe', 'low', 'attack', 'danger'];

/** 逗号分隔的标签：去空、去重，最多 12 个 */
function splitTags(text) {
  const list = String(text || '').split(/[,，]/).map((part) => part.trim()).filter(Boolean);
  return Array.from(new Set(list)).slice(0, 12);
}

/** 收集已有条目的某个自由文本字段，用做输入建议（去重、去掉空值） */
function collectSuggestions(lists, pick, limit = 24) {
  const values = [];
  const seen = new Set();
  for (const list of lists) {
    for (const item of list || []) {
      const value = String(pick(item) || '').trim();
      if (!value || value === '未分类' || seen.has(value)) continue;
      seen.add(value);
      values.push(value);
      if (values.length >= limit) return values;
    }
  }
  return values;
}

/** 生成不与内置 / 自定义条目冲突的 ID */
function uniqueItemId(kind, builtinKeys, customItems) {
  const prefix = kind === 'payload' ? 'payload' : 'snippet';
  let id = uid(prefix);
  while (
    builtinKeys.has(`${kind}:${id}`)
    || (customItems || []).some((entry) => entry.id === id)
  ) {
    id = uid(prefix);
  }
  return id;
}

/**
 * 打开条目表单
 * @param {object} options
 * @param {object|null} options.item 编辑的条目；为空表示新增
 * @param {object} options.data 内置数据（platforms / platformMap / snippets / payloads）
 * @param {Array} options.custom 当前自定义条目列表
 * @param {Array} [options.customPlatforms] 当前自定义平台列表，提交时原样带回
 * @param {object} options.settings 设置（读取自定义条目上限）
 * @param {(next: object) => Promise<boolean>|boolean} options.commit 统一提交函数
 * @param {boolean} [options.compact] 面板内使用单列布局
 * @param {'snippet'|'payload'} [options.defaultKind] 新增时的默认类型
 */
export function openItemDialog({
  item = null,
  data,
  custom = [],
  customPlatforms = [],
  settings,
  commit,
  compact = false,
  defaultKind = 'snippet'
}) {
  if (!data) {
    toast('内置数据尚未加载完成，请稍后再试', 'warn');
    return;
  }

  const platforms = data.platforms || [];
  const maxItems = Number(settings?.limits?.maxCustomItems) || 500;
  const builtinKeys = new Set([
    ...(data.snippets || []).map((entry) => `snippet:${entry.id}`),
    ...(data.payloads || []).map((entry) => `payload:${entry.id}`)
  ]);

  const initialKind = item?.kind || (defaultKind === 'payload' ? 'payload' : 'snippet');
  // 编辑已有条目视为“用户已确认过风险等级”，切换类型时不再自动改写；
  // 新增条目则由类型自动推断，风险等级收进高级选项，避免误填成高危吓人
  let riskTouched = Boolean(item);
  const defaultRisk = (kind) => (kind === 'payload' ? 'attack' : 'recon');

  const categories = collectSuggestions(
    [data.snippets, data.payloads, custom],
    (entry) => entry.category
  );
  const groups = collectSuggestions(
    [(data.payloads || []).filter((entry) => entry.kind === 'payload'), (custom || []).filter((entry) => entry.kind === 'payload')],
    (entry) => entry.group
  );

  /** 当前类型：编辑时固定原类型；面板新增由入口按钮决定，设置页仍可手选 */
  const kindOf = (form) => {
    if (item?.kind) return item.kind;
    if (compact) return initialKind;
    return form.kind === 'payload' ? 'payload' : 'snippet';
  };

  /**
   * 实时卡片预览（仅面板使用）：
   * 让用户先看到保存后的样式、会出现在哪个列表，避免“加完不知道去了哪”。
   */
  const renderPreview = (form) => {
    const kind = kindOf(form);
    const title = String(form.title || '').trim() || '未命名条目';
    const platform = data.platformMap?.get(String(form.platform || ''));
    const group = String(form.group || '').trim() || '自定义';
    const category = String(form.category || '').trim();
    const tags = splitTags(form.tags);
    const vars = extractVars(form.code || '');
    const where = kind === 'payload'
      ? `保存后出现在：Payload → ${group}`
      : `保存后出现在：语法库 → ${platform ? platform.name : '请选择平台'}`;

    const meta = el('div', { className: 'rb-card-meta' });
    if (kind === 'payload') {
      meta.append(el('span', { className: 'rb-badge rb-badge--accent', text: group }));
    } else if (platform) {
      const tag = el('span', { className: 'rb-badge rb-badge--platform', text: platform.name });
      if (platform.color) tag.style.setProperty('--rb-badge-color', platform.color);
      meta.append(tag);
    } else {
      meta.append(el('span', { className: 'rb-badge', text: '未选择平台' }));
    }
    if (category) meta.append(el('span', { className: 'rb-badge', text: category }));
    meta.append(el('span', { className: 'rb-badge rb-badge--warn', text: '自定义' }));
    if (vars.length) meta.append(el('span', { className: 'rb-badge rb-badge--warn', text: `变量 ${vars.length}` }));

    return el('div', {}, [
      el('p', { className: 'rb-form-preview-where', text: where }),
      el('article', { className: 'rb-card rb-form-preview-card' }, [
        el('div', { className: 'rb-card-head' }, [
          el('h3', { className: 'rb-card-title', text: title })
        ]),
        meta,
        el('pre', { className: 'rb-card-pre', text: String(form.code || '').slice(0, 200) || '（未填写代码）' }),
        String(form.desc || '').trim()
          ? el('p', { className: 'rb-card-desc', text: String(form.desc || '').trim() })
          : null,
        tags.length
          ? el('div', { className: 'rb-card-tags' }, tags.slice(0, 8).map((value) => el('span', { className: 'rb-tag', text: `#${value}` })))
          : null,
        el('p', {
          className: 'rb-card-source',
          text: vars.length
            ? `识别到变量：${vars.join('、')}（复制时可填写）`
            : '提示：在代码里写 {{变量名}}，复制时会弹窗让你填写'
        })
      ])
    ]);
  };

  openFormDialog({
    // 标题跟随入口：从 Payload 页进来时不显示“新增语法”，减少类型误解
    title: item
      ? '编辑自定义条目'
      : (defaultKind === 'payload' ? '新增 Payload' : '新增语法'),
    description: compact
      ? '保存后会直接出现在当前列表，可随时编辑或删除。代码里的 {{变量名}} 会在复制时弹窗让你填写。'
      : '代码中的 {{变量}} 会被自动识别，复制时可以填写具体值。',
    submitText: item ? '保存修改' : '新增',
    compact,
    preview: compact ? renderPreview : null,
    values: {
      kind: initialKind,
      title: item?.title || '',
      platform: item?.platform || '',
      group: item?.group || '',
      category: item?.category || '',
      risk: RISK_VALUES.includes(item?.risk) ? item.risk : defaultRisk(initialKind),
      code: item?.code || '',
      desc: item?.desc || '',
      tags: (item?.tags || []).join('，'),
      file: item?.file || '',
      filePrefix: item?.filePrefix || ''
    },
    fields: [
      {
        name: 'kind',
        label: '类型',
        type: 'select',
        required: true,
        // 面板用「新增语法 / 新增 Payload」两个入口区分类型，表单里不再重复问一遍
        visibleWhen: () => !compact,
        options: [
          { value: 'snippet', label: '语法条目' },
          { value: 'payload', label: 'Payload' }
        ],
        // 新增时跟着类型自动给出匹配的风险等级；用户手动改过风险后不再覆盖
        onValueChange: (value) => (riskTouched ? null : { risk: defaultRisk(value) })
      },
      {
        name: 'title',
        label: '标题',
        type: 'text',
        required: true,
        maxlength: 80,
        placeholder: '例如：排除封禁类告警',
        hint: '卡片顶部显示的名称'
      },
      {
        name: 'platform',
        label: '所属平台',
        type: 'select',
        required: true,
        placeholder: '请选择平台',
        hint: '决定它显示在语法库的哪个平台下',
        visibleWhen: (form) => kindOf(form) === 'snippet',
        options: platforms.map((platform) => ({ value: platform.id, label: platform.name }))
      },
      {
        name: 'group',
        label: '所属分组',
        type: 'text',
        datalist: groups,
        visibleWhen: (form) => kindOf(form) === 'payload',
        placeholder: '例如：自定义',
        hint: '决定它显示在 Payload 的哪个类型下，留空归入「自定义」'
      },
      {
        name: 'category',
        label: '二级分类',
        type: 'text',
        datalist: categories,
        placeholder: '未分类',
        hint: '可选。填了之后，列表顶部会多出一个同名筛选项'
      },
      {
        name: 'code',
        label: '代码 / 语法',
        type: 'textarea',
        rows: compact ? 6 : 7,
        required: true,
        placeholder: 'direction == "10" AND alarmName != "{{排除告警}}"',
        hint: '支持 {{变量名}} 占位，复制时会弹窗让你填具体值'
      },
      {
        name: 'desc',
        label: '说明',
        type: 'textarea',
        rows: 3,
        placeholder: '用途与注意事项，可留空',
        hint: '可选，显示在卡片代码下方'
      },
      {
        name: 'tags',
        label: '搜索标签',
        type: 'text',
        placeholder: '告警，排除',
        hint: '可选，逗号分隔；卡片上显示为 #标签，也会参与搜索'
      },
      {
        name: 'risk',
        label: '风险等级',
        type: 'select',
        advanced: true,
        hint: '默认按类型自动推断，仅用于卡片徽标',
        onValueChange: () => {
          riskTouched = true;
          return null;
        },
        options: [
          { value: 'recon', label: '信息搜集（查询语法）' },
          { value: 'safe', label: '安全操作' },
          { value: 'low', label: '低风险（查询 / 防御类）' },
          { value: 'attack', label: '攻击载荷' },
          { value: 'danger', label: '高危' }
        ]
      },
      {
        name: 'file',
        label: '文件名',
        type: 'text',
        advanced: true,
        maxlength: 120,
        visibleWhen: (form) => kindOf(form) === 'payload',
        placeholder: 'shell.php',
        hint: '填写后卡片多出「存为文件」按钮，下载变量填充后的成品；留空只提供复制'
      },
      {
        name: 'filePrefix',
        label: '二进制前缀（Base64）',
        type: 'textarea',
        advanced: true,
        rows: 3,
        visibleWhen: (form) => kindOf(form) === 'payload',
        placeholder: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAY...',
        hint: '图片马等二进制样本用：下载时先解码再拼接上方代码'
      }
    ],
    onSubmit: async (form) => {
      const kind = kindOf(form);
      const platformId = String(form.platform || '').trim();
      if (kind === 'snippet' && !data.platformMap?.has(platformId)) {
        return '请为语法条目选择有效的平台';
      }

      // 文件名与二进制前缀只在 Payload 表单里出现；编辑旧条目时保留原值，避免切换类型后静默丢数据
      const file = kind === 'payload' ? String(form.file || '').trim() : (item?.file || '');
      const filePrefix = kind === 'payload'
        ? String(form.filePrefix || '').replace(/\s+/g, '')
        : (item?.filePrefix || '');
      // 二进制前缀只作用于「存为文件」，没有文件名就无处落地，先拦下来避免存成无效配置
      if (filePrefix && !file) return '填写二进制前缀时必须同时填写文件名';
      if (filePrefix && !base64ToBytes(filePrefix)) return '二进制前缀不是合法的 Base64 字符串';

      const next = {
        id: item?.id || uniqueItemId(kind, builtinKeys, custom),
        kind,
        title: String(form.title || '').trim(),
        platform: kind === 'snippet' ? platformId : '',
        group: kind === 'payload' ? (String(form.group || '').trim() || '自定义') : '',
        category: String(form.category || '').trim() || '未分类',
        code: String(form.code || ''),
        desc: String(form.desc || '').trim(),
        tags: splitTags(form.tags),
        file,
        filePrefix,
        vars: extractVars(form.code),
        risk: RISK_VALUES.includes(form.risk) ? form.risk : defaultRisk(kind),
        source: '用户自定义',
        custom: true
      };

      if (!item && custom.length >= maxItems) {
        return `自定义条目已达上限（${maxItems} 条）`;
      }

      const items = item
        ? custom.map((entry) => (entry.id === item.id ? next : entry))
        : [...custom, next];

      const ok = await commit({ platforms: customPlatforms, items });
      if (!ok) return '保存失败，请重试';
      toast(item ? '条目已更新' : '条目已新增', 'success');
      return '';
    }
  });
}
