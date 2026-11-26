/**
 * 可复用 UI 组件
 * 所有用户数据统一通过 textContent 渲染，避免 XSS。
 */

import { el, copyText, truncate, formatBytes, downloadText, downloadBlob, base64ToBytes, sanitizeFilename } from '../core/utils.js';
import { formatCopy } from '../core/clipboard.js';
import { applyVars, describeVar, missingVars } from '../core/template.js';
import { icon } from './icons.js';

/** 条目唯一键：类型 + 原始 ID，避免语法与 Payload 的 ID 冲突 */
export function itemKey(item) {
  return `${item.kind}:${item.id}`;
}

// 风险等级值域（与内置数据、设置页自定义表单三方共用的唯一值域，新增值需同步三处并更新 docs/DEVELOPMENT.md）
const RISK_LABELS = {
  recon: { text: '信息搜集', variant: 'info' },
  safe: { text: '安全操作', variant: 'info' },
  low: { text: '低风险', variant: 'info' },
  attack: { text: '攻击载荷', variant: 'danger' },
  danger: { text: '高危', variant: 'warn' }
};

/** 风险徽标 */
export function riskBadge(risk) {
  const meta = RISK_LABELS[risk] || RISK_LABELS.low;
  return el('span', { className: `rb-badge rb-badge--${meta.variant}`, text: meta.text });
}

/** 通用徽标 */
export function badge(text, variant = '') {
  return el('span', {
    className: `rb-badge${variant ? ` rb-badge--${variant}` : ''}`,
    text
  });
}

/** 轻提示 */
export function toast(message, type = 'info', duration = 2200) {
  let holder = document.querySelector('.rb-toast-holder');
  if (!holder) {
    holder = el('div', { className: 'rb-toast-holder', attrs: { 'aria-live': 'polite' } });
    document.body.appendChild(holder);
  }

  const node = el('div', {
    className: `rb-toast rb-toast--${type}`,
    text: message,
    attrs: { role: 'status' }
  });
  holder.appendChild(node);

  requestAnimationFrame(() => node.classList.add('is-visible'));
  setTimeout(() => {
    node.classList.remove('is-visible');
    setTimeout(() => node.remove(), 220);
  }, duration);
}

/**
 * 筛选下拉：全插件唯一的筛选控件（平台 / 语法分类 / Payload 类型 / Payload 分类 /
 * AI 提示词场景）。
 *
 * 为什么不使用 chips：popup 固定 420px 宽，16 个平台排成横向滚动条后一次只能看到
 * 3 个，其余选项不可见也没有溢出提示，还会叠出两三条同权重的滚动行；换成下拉后
 * 筛选区从两行约 70px 压到一行约 32px，且所有选项都能被键盘 / 读屏完整访问。
 * 新增筛选维度必须复用本函数，禁止再引入第二套筛选控件。
 *
 * @param {HTMLSelectElement} select 下拉元素
 * @param {Array} items 条目（{id|group, name|label, count}）
 * @param {object} options
 *   - allLabel：首个“全部”选项文案；传 null 表示该组不存在“全部”概念
 *     （如 AI 提示词场景，必须始终选中某一项，不能出现无效的“全部”）
 *   - allCount：给“全部”选项追加的条数（与列表、页脚同一口径）
 *   - value：当前选中值
 * @returns {string} 校正后的有效值，调用方必须写回 state
 */
export function syncFilterSelect(select, items, { allLabel = '全部', allCount, value } = {}) {
  if (!select) return value;

  const options = [];
  if (allLabel) options.push({ id: 'all', name: allLabel, count: allCount });
  for (const item of items) {
    const id = String(item.id ?? item.group ?? '');
    if (!id) continue;
    options.push({ id, name: item.name || item.label || id, count: item.count });
  }

  // 仅在选项集合（id / 文案 / 条数）变化时重建 <option>：
  // 每次渲染都 replaceChildren 会让展开中的下拉被强制收起，键盘焦点也会丢失
  const signature = options
    .map((option) => `${option.id}\u0000${option.name}\u0000${Number.isFinite(option.count) ? option.count : ''}`)
    .join('\u0001');

  if (select.dataset.optionSignature !== signature) {
    select.replaceChildren(...options.map((option) => el('option', {
      text: Number.isFinite(option.count) ? `${option.name}（${option.count}）` : option.name,
      attrs: { value: option.id }
    })));
    select.dataset.optionSignature = signature;
  }

  // 自定义数据重载后原选中项可能已不存在，回落首个选项（有“全部”时即 all），
  // 否则会出现“下拉空白 + 列表按失效值筛成空”
  const next = options.some((option) => option.id === value) ? value : (options[0]?.id ?? '');
  select.value = next;
  return next;
}

/** 空状态 */
export function emptyState({ iconName = 'search', title = '没有结果', desc = '', action = null } = {}) {
  const box = el('div', { className: 'rb-empty' }, [
    el('div', { className: 'rb-empty-icon' }, [icon(iconName)]),
    el('p', { className: 'rb-empty-title', text: title }),
    desc ? el('p', { className: 'rb-empty-desc', text: desc }) : null,
    action || null
  ]);
  return box;
}

/**
 * 渲染带变量高亮的代码
 * 用文本节点拼接，避免把代码内容当成 HTML 解析。
 */
export function renderCode(code) {
  const wrap = el('code', { className: 'rb-code' });
  const text = String(code || '');
  const pattern = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
  let last = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      wrap.append(document.createTextNode(text.slice(last, match.index)));
    }
    wrap.append(el('span', { className: 'rb-var', text: match[0] }));
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    wrap.append(document.createTextNode(text.slice(last)));
  }
  if (!text) wrap.append(document.createTextNode(''));
  return wrap;
}

/** 复制按钮（带成功反馈） */
export function copyButton(onClick, { label = '复制', showLabel = true, small = true, title = '' } = {}) {
  const button = el('button', {
    className: `rb-btn rb-btn--primary${small ? ' rb-btn--sm' : ''}`,
    attrs: { type: 'button', title: title || label }
  }, [icon('copy'), showLabel ? el('span', { text: label }) : null]);

  let timer = null;
  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    const ok = await onClick?.();
    if (ok === false) return;
    button.classList.add('is-copied');
    button.replaceChildren(icon('check'), showLabel ? el('span', { text: '已复制' }) : null);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      button.classList.remove('is-copied');
      button.replaceChildren(icon('copy'), showLabel ? el('span', { text: label }) : null);
    }, 1500);
  });

  return button;
}

/**
 * 条目卡片
 * @param {object} item 规范化后的语法或 Payload
 * @param {object} options
 */
export function itemCard(item, options = {}) {
  const {
    platformMap = new Map(),
    favorite = false,
    showDesc = true,
    showRisk = true,
    onCopy,
    onDownload,
    onToggleFavorite,
    onEdit,
    onDelete,
    onHide
  } = options;

  const meta = el('div', { className: 'rb-card-meta' });

  if (item.kind === 'snippet' && item.platform) {
    const platform = platformMap.get(item.platform);
    const tag = el('span', {
      className: 'rb-badge rb-badge--platform',
      text: platform ? platform.name : item.platform
    });
    if (platform?.color) tag.style.setProperty('--rb-badge-color', platform.color);
    meta.appendChild(tag);
  }
  if (item.kind === 'payload' && item.group) {
    meta.appendChild(badge(item.group, 'accent'));
  }
  if (item.category) meta.appendChild(badge(item.category));
  if (showRisk) meta.appendChild(riskBadge(item.risk));
  if (item.custom) meta.appendChild(badge('自定义', 'warn'));
  if (item.vars?.length) meta.appendChild(badge(`变量 ${item.vars.length}`, 'warn'));

  // 「存为文件」只在条目标注了建议文件名（item.file）时出现，如 WebShell 样本
  const downloadButton = onDownload && item.file
    ? el('button', {
      className: 'rb-btn rb-btn--ghost rb-btn--icon',
      attrs: {
        type: 'button',
        title: `存为文件：${item.file}`,
        'aria-label': `存为文件：${item.file}`
      }
    }, [icon('download')])
    : null;

  // 内置条目只提供“隐藏”（不删数据，可在设置页恢复）；自定义条目走编辑 / 删除
  const hideButton = onHide && !item.custom
    ? el('button', {
      className: 'rb-btn rb-btn--ghost rb-btn--icon',
      dataset: { action: 'hide' },
      attrs: { type: 'button', title: '隐藏此条（可在设置页恢复）', 'aria-label': '隐藏此条' }
    }, [icon('eyeOff')])
    : null;

  const editButton = onEdit && item.custom
    ? el('button', {
      className: 'rb-btn rb-btn--ghost rb-btn--icon',
      dataset: { action: 'edit' },
      attrs: { type: 'button', title: '编辑条目', 'aria-label': '编辑条目' }
    }, [icon('edit')])
    : null;
  const deleteButton = onDelete && item.custom
    ? el('button', {
      className: 'rb-btn rb-btn--ghost rb-btn--danger rb-btn--icon',
      dataset: { action: 'delete' },
      attrs: { type: 'button', title: '删除条目', 'aria-label': '删除条目' }
    }, [icon('trash')])
    : null;

  const head = el('div', { className: 'rb-card-head' }, [
    el('h3', { className: 'rb-card-title', text: item.title || '未命名条目', attrs: { title: item.title || '' } }),
    el('div', { className: 'rb-card-actions' }, [
      el('button', {
        className: `rb-btn rb-btn--ghost rb-btn--icon${favorite ? ' is-favorite' : ''}`,
        dataset: { action: 'favorite' },
        attrs: {
          type: 'button',
          title: favorite ? '取消收藏' : '收藏',
          'aria-label': favorite ? '取消收藏' : '收藏',
          'aria-pressed': String(favorite)
        }
      }, [icon(favorite ? 'starFilled' : 'star')]),
      hideButton,
      editButton,
      deleteButton,
      downloadButton,
      onCopy
        ? copyButton(async () => onCopy(item), { label: '复制', showLabel: true })
        : null
    ])
  ]);

  // 收藏与「存为文件」都单独绑定，避免事件冒泡触发复制
  // 星标按钮用 data-action 精确定位：卡片操作区还有下载按钮，不能靠「第一个 ghost」猜
  const starButton = head.querySelector('.rb-card-actions [data-action="favorite"]');
  if (starButton && onToggleFavorite) {
    starButton.addEventListener('click', (event) => {
      event.stopPropagation();
      onToggleFavorite(item);
    });
  }
  downloadButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    void onDownload(item);
  });
  hideButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    void onHide(item);
  });
  editButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    onEdit(item);
  });
  deleteButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    void onDelete(item);
  });

  const preview = el('pre', { className: 'rb-card-pre' }, [renderCode(truncate(item.code, 400))]);
  preview.title = item.code || '';

  const card = el('article', {
    className: 'rb-card',
    dataset: { key: itemKey(item) }
  }, [
    head,
    meta,
    preview,
    showDesc && item.desc ? el('p', { className: 'rb-card-desc', text: item.desc }) : null,
    item.tags?.length
      ? el('div', { className: 'rb-card-tags' }, item.tags.slice(0, 8).map((tag) =>
        el('span', { className: 'rb-tag', text: `#${tag}` })
      ))
      : null,
    item.source ? el('p', { className: 'rb-card-source', text: `来源：${item.source}` }) : null
  ]);

  return card;
}

/**
 * 弹窗焦点管理（变量填写弹窗与确认弹窗共用，禁止各自再写一套）。
 * - 打开时记住触发元素，关闭后把焦点还回去，键盘用户能接着原位置继续；
 * - Tab / Shift+Tab 在弹窗内循环，避免焦点跑到被遮罩挡住的背景页面上；
 * - Esc 的关闭逻辑仍由各弹窗自己的 keydown 处理，这里只负责焦点。
 * @param {HTMLElement} dialog 弹窗根节点
 * @returns {Function} 关闭时调用：移除监听并归还焦点
 */
export function manageDialogFocus(dialog) {
  const previous = document.activeElement;
  const SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  const onKeydown = (event) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialog.querySelectorAll(SELECTOR))
      .filter((node) => !node.disabled && node.getClientRects().length > 0);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (!dialog.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  dialog.addEventListener('keydown', onKeydown);

  return () => {
    dialog.removeEventListener('keydown', onKeydown);
    // 触发元素可能已随列表重渲染被移除，失效时不要强行聚焦
    if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
  };
}

/**
 * 变量填写弹窗
 * @returns {Promise<object|null>} 确认返回变量对象，取消返回 null
 */
export function openVariableDialog({ vars = [], values = {}, title = '填写变量', confirmText = '填充并复制', preview = null } = {}) {
  return new Promise((resolve) => {
    const inputs = new Map();

    const form = el('form', { className: 'rb-dialog-body' });
    for (const entry of vars) {
      // 变量既有对象写法（含 label/placeholder/example），也兼容纯字符串写法
      const name = (typeof entry === 'string' ? entry : entry?.name || '').toString().trim();
      if (!name || inputs.has(name)) continue;
      const meta = typeof entry === 'string' ? {} : entry || {};
      const hint = [meta.label || describeVar(name), meta.example ? `示例：${meta.example}` : '']
        .filter(Boolean)
        .join(' · ');
      const input = el('input', {
        className: 'rb-input',
        attrs: {
          type: 'text',
          name,
          value: values[name] || '',
          placeholder: meta.placeholder || '必填',
          autocomplete: 'off',
          spellcheck: 'false'
        }
      });
      inputs.set(name, input);
      form.appendChild(el('label', { className: 'rb-field' }, [
        el('span', { className: 'rb-field-label' }, [
          el('span', { className: 'rb-mono', text: `{{${name}}}` }),
          el('span', { className: 'rb-field-hint', text: hint })
        ]),
        input
      ]));
    }

    // 复制效果预览：变量变化时实时替换占位符，让用户在确认前看到最终文本
    let refreshPreview = null;
    if (typeof preview === 'function') {
      const previewCode = el('pre', { className: 'rb-dialog-preview-code' });
      refreshPreview = () => {
        const current = {};
        for (const [name, input] of inputs) current[name] = input.value.trim();
        const text = String(preview(current) ?? '');
        previewCode.textContent = text || '（填写变量后显示最终效果）';
        previewCode.classList.toggle('is-empty', !text);
      };
      form.appendChild(
        el('div', { className: 'rb-dialog-preview' }, [
          el('span', { className: 'rb-dialog-preview-label', text: '复制效果预览' }),
          previewCode
        ])
      );
      form.addEventListener('input', refreshPreview);
    }

    let releaseFocus = () => {};

    const close = (result) => {
      overlay.remove();
      document.removeEventListener('keydown', onKeydown);
      releaseFocus();
      resolve(result);
    };

    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      }
    };

    const confirm = el('button', {
      className: 'rb-btn rb-btn--primary',
      text: confirmText,
      attrs: { type: 'submit' }
    });
    const cancel = el('button', {
      className: 'rb-btn rb-btn--ghost',
      text: '取消',
      attrs: { type: 'button' }
    });
    cancel.addEventListener('click', () => close(null));

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const result = {};
      for (const [name, input] of inputs) result[name] = input.value.trim();
      close(result);
    });
    // 按钮必须放在 form 内部（或通过 form 属性关联），否则 type=submit 无法提交
    form.appendChild(el('div', { className: 'rb-dialog-foot' }, [cancel, confirm]));

    const dialog = el('div', {
      className: 'rb-dialog',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }
    }, [
      el('div', { className: 'rb-dialog-head' }, [
        el('h2', { className: 'rb-dialog-title', text: title }),
        el('button', {
          className: 'rb-btn rb-btn--ghost rb-btn--icon',
          attrs: { type: 'button', 'aria-label': '关闭' }
        }, [icon('close')])
      ]),
      form
    ]);

    dialog.querySelector('.rb-dialog-head button').addEventListener('click', () => close(null));

    const overlay = el('div', { className: 'rb-overlay' }, [dialog]);
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close(null);
    });

    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeydown);
    releaseFocus = manageDialogFocus(dialog);
    refreshPreview?.();

    const first = inputs.values().next().value;
    if (first) {
      first.focus();
      first.select();
    } else {
      confirm.focus();
    }
  });
}

/** 确认弹窗 */
export function confirmDialog({ title = '确认操作', message = '', confirmText = '确认', danger = false } = {}) {
  return new Promise((resolve) => {
    let releaseFocus = () => {};

    const close = (result) => {
      overlay.remove();
      document.removeEventListener('keydown', onKeydown);
      releaseFocus();
      resolve(result);
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') close(false);
    };

    const cancel = el('button', {
      className: 'rb-btn rb-btn--ghost',
      text: '取消',
      attrs: { type: 'button' }
    });
    const confirm = el('button', {
      className: `rb-btn ${danger ? 'rb-btn--danger' : 'rb-btn--primary'}`,
      text: confirmText,
      attrs: { type: 'button' }
    });
    cancel.addEventListener('click', () => close(false));
    confirm.addEventListener('click', () => close(true));

    const dialog = el('div', {
      className: 'rb-dialog rb-dialog--sm',
      attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title }
    }, [
      el('div', { className: 'rb-dialog-head' }, [el('h2', { className: 'rb-dialog-title', text: title })]),
      el('div', { className: 'rb-dialog-body' }, [el('p', { className: 'rb-dialog-text', text: message })]),
      el('div', { className: 'rb-dialog-foot' }, [cancel, confirm])
    ]);

    const overlay = el('div', { className: 'rb-overlay' }, [dialog]);
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close(false);
    });

    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeydown);
    releaseFocus = manageDialogFocus(dialog);
    confirm.focus();
  });
}

/**
 * 生成条目的最终文本：含变量时先弹窗填写并替换占位符
 * 复制与「存为文件」共用这一份变量流程，避免两处实现漂移
 * @param {object} options
 * @param {object} [options.variables] 已记忆的变量值
 * @param {(filled: object) => void} [options.onRemember] 确认后回写记忆
 * @param {string} [options.confirmText] 弹窗确认按钮文案（复制 / 下载不同）
 * @returns {Promise<{text: string, hasVars: boolean}|null>} 取消或校验失败返回 null
 */
export async function resolveItemText(item, { variables, onRemember, confirmText, previewText } = {}) {
  let values = { ...(variables || {}) };

  if (item.vars?.length) {
    const filled = await openVariableDialog({
      vars: item.vars,
      values,
      title: `填写变量 · ${truncate(item.title, 28)}`,
      confirmText,
      // 实时预览：未填写的变量保留 {{name}}，填一个就替换一个
      preview: (current) => {
        const code = applyVars(item.code, { ...values, ...current });
        return typeof previewText === 'function' ? previewText(code) : code;
      }
    });
    if (!filled) return null;
    const missing = missingVars(item.code, filled);
    if (missing.length) {
      toast(`还有 ${missing.length} 个变量未填写`, 'warn');
      return null;
    }
    values = { ...values, ...filled };
    onRemember?.(filled);
  }

  return { text: applyVars(item.code, values), hasVars: Boolean(item.vars?.length) };
}

/**
 * 执行复制流程：含变量时先弹窗填写，否则直接复制
 * @returns {Promise<boolean>} 是否复制成功
 */
export async function copyWithVariables(item, { settings, variables, onRemember } = {}) {
  const copyFormat = settings?.ui?.copyFormat || 'code';
  // 预览与真正复制使用同一套格式化逻辑，避免“预览一种、复制另一种”
  const resolved = await resolveItemText(item, {
    variables,
    onRemember,
    previewText: (code) => formatCopy({ ...item, code }, copyFormat)
  });
  if (!resolved) return false;

  const text = formatCopy({ ...item, code: resolved.text }, copyFormat);
  const ok = await copyText(text);
  if (!ok) {
    toast('复制失败，请检查浏览器剪贴板权限', 'danger');
    return false;
  }

  toast(resolved.hasVars ? '已填充变量并复制' : '已复制到剪贴板', 'success');
  return true;
}

/**
 * 把条目存为文件：文件名取 item.file，内容为变量替换后的最终代码
 * 用于需要「成品文件」的场景（如上传测试用的 PHP / JSP 样本），无需再手动粘贴保存
 * 若条目声明了 filePrefix（二进制前缀），先 Base64 解码再拼接代码，产出真正的 PNG/GIF 图片马
 * @returns {Promise<boolean>} 是否已触发下载
 */
export async function downloadWithVariables(item, { variables, onRemember } = {}) {
  const resolved = await resolveItemText(item, { variables, onRemember, confirmText: '填充并下载' });
  if (!resolved) return false;

  const filename = sanitizeFilename(item.file, 'rulebox.txt');
  const head = item.filePrefix ? base64ToBytes(item.filePrefix) : null;
  if (item.filePrefix && !head) {
    toast('条目的二进制前缀不是合法 Base64，未生成文件', 'danger');
    return false;
  }

  const size = head
    ? downloadBlob(filename, [head, resolved.text])
    : downloadText(filename, resolved.text);
  if (!size) {
    toast('条目内容为空，未生成文件', 'warn');
    return false;
  }
  toast(`已保存 ${filename}（${formatBytes(size)}）`, 'success', 2600);
  return true;
}
