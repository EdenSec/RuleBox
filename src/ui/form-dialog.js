/**
 * 共享弹窗与表单
 * 设置页（options）与面板（popup / side panel）共用同一套遮罩、字段构建与键盘行为，
 * 避免两个宿主各写一套表单逻辑，出现显示或交互不一致。
 */

import { el, uid } from '../core/utils.js';
import { icon } from './icons.js';
import { manageDialogFocus } from './components.js';

/**
 * 挂载遮罩弹窗
 * Escape 在 capture 阶段处理，且只有自己是最顶层 .rb-overlay 时才关闭；
 * 阻断事件继续传播，避免底层的 confirmDialog（bubble 级）被误触发。
 */
export function mountOverlay(dialog) {
  const overlay = el('div', { className: 'rb-overlay' }, [dialog]);
  let closed = false;
  let releaseFocus = null;

  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener('keydown', onKeydown, true);
    if (releaseFocus) releaseFocus();
  };

  const onKeydown = (event) => {
    if (event.key !== 'Escape') return;
    const overlays = document.querySelectorAll('.rb-overlay');
    if (overlays[overlays.length - 1] !== overlay) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  document.addEventListener('keydown', onKeydown, true);
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) close();
  });

  document.body.appendChild(overlay);
  // Tab 循环与关闭后的焦点归还统一复用 manageDialogFocus，
  // 不在两个宿主里各写一套。必须在弹窗内元素获得焦点之前调用。
  releaseFocus = manageDialogFocus(dialog);
  return { overlay, dialog, close };
}

/** 信息弹窗（标题 + 内容 + “知道了”） */
export function openInfoDialog(title, content) {
  const closeBtn = el('button', {
    className: 'rb-btn rb-btn--ghost rb-btn--icon',
    attrs: { type: 'button', 'aria-label': '关闭' }
  });
  closeBtn.append(icon('close'));

  const body = el('div', { className: 'rb-dialog-body' });
  for (const node of [].concat(content)) {
    if (node) body.append(node);
  }

  const know = el('button', { className: 'rb-btn rb-btn--primary', text: '知道了', attrs: { type: 'button' } });

  const handle = mountOverlay(el('div', {
    className: 'rb-dialog rb-dialog--wide',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }
  }, [
    el('div', { className: 'rb-dialog-head' }, [
      el('h2', { className: 'rb-dialog-title', text: title }),
      closeBtn
    ]),
    body,
    el('div', { className: 'rb-dialog-foot' }, [know])
  ]));

  closeBtn.addEventListener('click', () => handle.close());
  know.addEventListener('click', () => handle.close());
  know.focus();
  return handle;
}

/** 构建表单字段（供 openFormDialog 使用） */
function buildField(field, values, onChange) {
  const wrapper = el('label', {
    className: `rb-field${field.wide ? ' rb-field--wide' : ''}${field.stack ? ' rb-field--stack' : ''}`
  });

  const labelText = el('span', { className: 'rb-field-label', text: field.label });
  if (field.required) labelText.append(el('span', { className: 'rb-field-hint', text: '必填' }));

  let input;
  if (field.type === 'select') {
    input = el('select', { className: 'rb-select' });
    // 允许空值的选择框（如“请选择平台”）必须显式带一个占位项，
    // 否则浏览器会自动选中第一项，用户没点过却“被选择”了
    if (field.placeholder) {
      input.append(el('option', { text: field.placeholder, attrs: { value: '' } }));
    }
    for (const option of field.options || []) {
      input.append(el('option', { text: option.label, attrs: { value: option.value } }));
    }
    input.value = values[field.name] ?? field.defaultValue ?? '';
  } else if (field.type === 'textarea') {
    input = el('textarea', {
      className: `rb-textarea${field.mono ? ' rb-mono' : ''}`,
      attrs: {
        rows: String(field.rows || 5),
        placeholder: field.placeholder || ''
      }
    });
    input.value = values[field.name] ?? field.defaultValue ?? '';
  } else {
    input = el('input', {
      className: `rb-input${field.mono ? ' rb-mono' : ''}`,
      attrs: {
        type: 'text',
        placeholder: field.placeholder || ''
      }
    });
    if (field.maxlength) input.maxLength = field.maxlength;
    input.value = values[field.name] ?? field.defaultValue ?? '';
  }

  if (field.disabled) input.disabled = true;

  // 输入建议：分类、分组等自由文本字段用 datalist 复用已有值，减少同义碎片
  if (Array.isArray(field.datalist) && field.datalist.length) {
    const listId = `rb-dl-${uid('f')}`;
    const list = el('datalist', { attrs: { id: listId } });
    for (const value of field.datalist) {
      list.append(el('option', { attrs: { value: String(value) } }));
    }
    input.setAttribute('list', listId);
    wrapper.append(labelText, input, list);
  } else {
    wrapper.append(labelText, input);
  }

  if (field.hint) wrapper.append(el('span', { className: 'rb-field-hint', text: field.hint }));

  input.addEventListener('input', () => onChange(input.value));
  input.addEventListener('change', () => onChange(input.value));

  return { wrapper, input };
}

/**
 * 表单弹窗
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.description]
 * @param {string} [options.submitText]
 * @param {Array} [options.fields] 字段定义；advanced: true 的字段收进「高级选项」
 * @param {object} [options.values] 初始值
 * @param {boolean} [options.compact] 单列布局，适合 420px 宽的弹窗面板
 * @param {(form: object) => (HTMLElement|null)} [options.preview]
 *   可选的效果预览渲染器，随表单输入实时更新
 * @param {(form: object) => string|void|Promise<string|void>} options.onSubmit
 *   返回非空字符串表示校验失败，弹窗保持打开并显示该提示
 */
export function openFormDialog({
  title,
  description = '',
  submitText = '保存',
  fields = [],
  values = {},
  onSubmit,
  compact = false,
  preview = null
}) {
  const data = { ...values };
  const entries = new Map();

  const basicFields = fields.filter((field) => !field.advanced);
  const advancedFields = fields.filter((field) => field.advanced);
  const gridClass = `rb-form-grid${compact ? ' rb-form-grid--single' : ''}`;

  const grid = el('div', { className: gridClass });
  const advGrid = advancedFields.length ? el('div', { className: `${gridClass} rb-adv-grid` }) : null;
  const error = el('p', { className: 'rb-form-error', attrs: { role: 'alert' } });
  let refreshPreview = () => {};

  const setValue = (name, value) => {
    data[name] = value;
    const entry = entries.get(name);
    if (entry) entry.input.value = value;
  };

  const refreshVisibility = () => {
    for (const entry of entries.values()) {
      if (typeof entry.field.visibleWhen !== 'function') continue;
      entry.wrapper.hidden = !entry.field.visibleWhen(data);
    }
  };

  const emitChange = (name, value) => {
    data[name] = value;
    const field = fields.find((item) => item.name === name);
    const patch = field && typeof field.onValueChange === 'function'
      ? field.onValueChange(value, data)
      : null;
    if (patch && typeof patch === 'object') {
      for (const [key, next] of Object.entries(patch)) setValue(key, next);
    }
    refreshVisibility();
    refreshPreview();
  };

  for (const field of [...basicFields, ...advancedFields]) {
    const { wrapper, input } = buildField(field, data, (value) => emitChange(field.name, value));
    entries.set(field.name, { field, wrapper, input });
    (field.advanced ? advGrid : grid).append(wrapper);
  }
  refreshVisibility();

  const children = [];
  if (description) children.push(el('p', { className: 'rb-dialog-text', text: description }));
  children.push(grid);
  if (advGrid) {
    const details = el('details', { className: 'rb-adv' });
    details.append(
      el('summary', {}, [
        el('span', { className: 'rb-adv-title', text: '高级选项' }),
        el('span', { className: 'rb-adv-hint', text: '风险等级、文件名等低频设置' })
      ]),
      advGrid
    );
    children.push(details);
  }
  if (typeof preview === 'function') {
    const node = el('div', { className: 'rb-form-preview' });
    refreshPreview = () => {
      node.replaceChildren();
      const rendered = preview(data);
      if (rendered) node.append(rendered);
    };
    refreshPreview();
    children.push(node);
  }
  children.push(error);

  const closeBtn = el('button', {
    className: 'rb-btn rb-btn--ghost rb-btn--icon',
    attrs: { type: 'button', 'aria-label': '关闭' }
  });
  closeBtn.append(icon('close'));

  const cancel = el('button', { className: 'rb-btn rb-btn--ghost', text: '取消', attrs: { type: 'button' } });
  const submit = el('button', {
    className: 'rb-btn rb-btn--primary',
    text: submitText,
    attrs: { type: 'button' }
  });

  const body = el('div', { className: 'rb-dialog-body' }, children);
  const dialog = el('div', {
    className: 'rb-dialog rb-dialog--wide',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }
  }, [
    el('div', { className: 'rb-dialog-head' }, [
      el('h2', { className: 'rb-dialog-title', text: title }),
      closeBtn
    ]),
    body,
    el('div', { className: 'rb-dialog-foot' }, [cancel, submit])
  ]);

  const handle = mountOverlay(dialog);
  const close = () => handle.close();
  closeBtn.addEventListener('click', close);
  cancel.addEventListener('click', close);

  const runSubmit = async () => {
    error.textContent = '';
    const form = {};
    for (const [name, entry] of entries) {
      if (entry.wrapper.hidden) continue;
      const raw = entry.input.value;
      const value = entry.field.type === 'textarea' ? raw : raw.trim();
      if (entry.field.required && !value) {
        error.textContent = entry.field.errorText || `请填写「${entry.field.label}」`;
        entry.input.focus();
        return;
      }
      form[name] = value;
    }

    if (typeof onSubmit !== 'function') {
      close();
      return;
    }

    submit.disabled = true;
    cancel.disabled = true;
    try {
      const message = await onSubmit(form);
      if (typeof message === 'string' && message) {
        error.textContent = message;
        return;
      }
      close();
    } catch (err) {
      console.error('[RuleBox] 表单提交失败', err);
      error.textContent = '保存失败，请重试';
    } finally {
      submit.disabled = false;
      cancel.disabled = false;
    }
  };

  submit.addEventListener('click', runSubmit);
  body.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.target.tagName === 'TEXTAREA') return;
    event.preventDefault();
    submit.click();
  });

  // 聚焦第一个可见的文本类输入，避免直接弹起软键盘覆盖下拉
  const firstInput = [...entries.values()].find((entry) => (
    !entry.wrapper.hidden && entry.input.tagName !== 'SELECT'
  ));
  if (firstInput) firstInput.input.focus();

  return handle;
}
