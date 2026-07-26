// 经 chrome.scripting.executeScript({ func }) 注入页面执行的纯函数。
// 硬性约束：注入时 Chrome 只序列化函数体本身——
//   1. 函数不能引用本模块作用域里的任何变量/辅助函数（所有辅助都写在函数体内部）；
//   2. 参数只能经 executeScript 的 args 传入（必须可 JSON 序列化）；
//   3. 失败用 { error: '中文原因' } 返回（handlers.js 会转成异常回给桥）。
// 因为上述约束，click/fill 里的 locate/describe 辅助存在少量刻意重复，不要提取共享。

// 读取页面：正文分块（≤1400 字符/块、≤40 块）、meta 描述、链接（≤40 条去重）、
// 可选的可交互元素清单（打 data-designecho-ref 标记 + 简短 CSS selector 兜底）。
export function readPageScript(maxChars, includeElements) {
  const CHUNK_LIMIT = 1400;
  const MAX_CHUNKS = 40;
  const HARD_LIMIT = CHUNK_LIMIT * MAX_CHUNKS; // 56000
  const limit =
    typeof maxChars === 'number' && maxChars > 0
      ? Math.min(Math.floor(maxChars), HARD_LIMIT)
      : HARD_LIMIT;

  function collapseText(value, maxLen) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLen);
  }

  // 按 ≤1400 字符分块；尽量在换行/句号等边界切，避免硬切断词。
  function splitChunks(text) {
    const chunks = [];
    let pos = 0;
    while (pos < text.length && chunks.length < MAX_CHUNKS) {
      let end = Math.min(pos + CHUNK_LIMIT, text.length);
      if (end < text.length) {
        const windowText = text.slice(pos, end);
        const boundary = Math.max(
          windowText.lastIndexOf('\n'),
          windowText.lastIndexOf('。'),
          windowText.lastIndexOf('！'),
          windowText.lastIndexOf('？'),
          windowText.lastIndexOf('. ')
        );
        // 边界太靠前（不足半块）就放弃对齐，直接在 1400 处切，避免产生大量小碎块。
        if (boundary >= Math.floor(CHUNK_LIMIT * 0.5)) {
          end = pos + boundary + 1;
        }
      }
      chunks.push(text.slice(pos, end));
      pos = end;
    }
    return chunks;
  }

  const rawText = document.body ? document.body.innerText || '' : '';
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const totalChars = normalized.length;
  const truncated = totalChars > limit;
  const textChunks = splitChunks(normalized.slice(0, limit));

  const metaDescription = document.querySelector('meta[name="description"]');
  const description = collapseText(
    metaDescription ? metaDescription.getAttribute('content') : '',
    300
  );

  const links = [];
  const seenHrefs = new Set();
  for (const anchor of Array.from(document.links)) {
    if (links.length >= 40) {
      break;
    }
    const href = anchor.href || '';
    if (!/^https?:\/\//i.test(href) || seenHrefs.has(href)) {
      continue;
    }
    const text = collapseText(
      anchor.innerText || anchor.getAttribute('aria-label') || anchor.title,
      80
    );
    if (!text) {
      continue;
    }
    seenHrefs.add(href);
    links.push({ text, url: href });
  }

  let elements;
  if (includeElements) {
    // 先清掉上一次读取留下的 ref 标记，避免旧编号指向错误元素。
    for (const stale of Array.from(document.querySelectorAll('[data-designecho-ref]'))) {
      stale.removeAttribute('data-designecho-ref');
    }

    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
      // offsetParent 为 null 通常意味着元素不参与布局；position:fixed 的元素
      // offsetParent 也是 null 但确实可见（如固定导航栏），单独放行。
      if (el.offsetParent === null && style.position !== 'fixed') {
        return false;
      }
      return true;
    }

    function isInViewport(el) {
      const rect = el.getBoundingClientRect();
      return (
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth
      );
    }

    function elementText(el) {
      const text =
        el.innerText ||
        el.getAttribute('placeholder') ||
        el.value ||
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        '';
      return String(text).replace(/\s+/g, ' ').trim().slice(0, 60);
    }

    // 生成简短 CSS 路径：优先 #id，其次 tag.class:nth-of-type 链，最多 4 层。
    function shortSelector(el) {
      const parts = [];
      let node = el;
      while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
        if (node.id) {
          parts.unshift('#' + CSS.escape(node.id));
          break;
        }
        const tag = node.tagName.toLowerCase();
        let part = tag;
        const stableClass = Array.from(node.classList).find((name) =>
          /^[A-Za-z_][\w-]{0,40}$/.test(name)
        );
        if (stableClass) {
          part += '.' + CSS.escape(stableClass);
        }
        let index = 1;
        let sibling = node;
        while ((sibling = sibling.previousElementSibling)) {
          if (sibling.tagName === node.tagName) {
            index += 1;
          }
        }
        part += ':nth-of-type(' + index + ')';
        parts.unshift(part);
        node = node.parentElement;
      }
      return parts.join(' > ');
    }

    const candidates = Array.from(
      document.querySelectorAll('a, button, input, select, textarea, [role="button"], [onclick]')
    ).filter(isVisible);
    // 上限 40 个，视口内的优先。
    const inViewport = candidates.filter(isInViewport);
    const outOfViewport = candidates.filter((el) => !isInViewport(el));
    const picked = inViewport.concat(outOfViewport).slice(0, 40);

    elements = picked.map((el, index) => {
      const ref = index + 1;
      el.setAttribute('data-designecho-ref', String(ref));
      return {
        ref,
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        text: elementText(el),
        selector: shortSelector(el),
      };
    });
  }

  const result = {
    url: window.location.href,
    title: document.title || '',
    description,
    textChunks,
    links,
    truncated,
    totalChars,
  };
  if (includeElements) {
    result.elements = elements || [];
  }
  return result;
}

// 点击元素：优先 data-designecho-ref 标记，selector 兜底；滚到视口中央后触发 click()。
export function clickScript(elementRef, selector) {
  function locate() {
    if (elementRef !== null && elementRef !== undefined) {
      const byRef = document.querySelector(
        '[data-designecho-ref="' + String(elementRef).replace(/["\\]/g, '') + '"]'
      );
      if (byRef) {
        return { el: byRef };
      }
      if (!selector) {
        return {
          error:
            '未找到 elementRef=' + elementRef + ' 对应的元素：页面可能已导航或刷新（ref 标记会失效）。' +
            '请先用 readBrowserPage(includeElements:true) 重新获取元素清单。',
        };
      }
    }
    if (selector) {
      let bySelector = null;
      try {
        bySelector = document.querySelector(selector);
      } catch (error) {
        return { error: 'selector 语法无效：' + selector + '（' + error.message + '）' };
      }
      if (bySelector) {
        return { el: bySelector };
      }
      return {
        error:
          '未找到匹配 selector 的元素：' + selector + '。' +
          '请先用 readBrowserPage(includeElements:true) 获取元素清单和可用 selector。',
      };
    }
    return { error: '缺少 elementRef 和 selector，无法定位要点击的元素。' };
  }

  function describe(el) {
    const text = String(el.innerText || el.value || el.getAttribute('aria-label') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    return '<' + el.tagName.toLowerCase() + '>' + (text ? '「' + text + '」' : '');
  }

  const found = locate();
  if (found.error) {
    return { error: found.error };
  }
  const el = found.el;
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  el.click();
  return { detail: '已点击元素 ' + describe(el) + '。' };
}

// 填入文本：原生 value setter + input/change 事件（兼容 React/Vue 受控组件）。
// 红线：绝不派发 Enter、绝不调用 form.submit()——是否提交由 Agent/用户另行决定。
export function fillScript(elementRef, selector, value) {
  function locate() {
    if (elementRef !== null && elementRef !== undefined) {
      const byRef = document.querySelector(
        '[data-designecho-ref="' + String(elementRef).replace(/["\\]/g, '') + '"]'
      );
      if (byRef) {
        return { el: byRef };
      }
      if (!selector) {
        return {
          error:
            '未找到 elementRef=' + elementRef + ' 对应的元素：页面可能已导航或刷新（ref 标记会失效）。' +
            '请先用 readBrowserPage(includeElements:true) 重新获取元素清单。',
        };
      }
    }
    if (selector) {
      let bySelector = null;
      try {
        bySelector = document.querySelector(selector);
      } catch (error) {
        return { error: 'selector 语法无效：' + selector + '（' + error.message + '）' };
      }
      if (bySelector) {
        return { el: bySelector };
      }
      return {
        error:
          '未找到匹配 selector 的元素：' + selector + '。' +
          '请先用 readBrowserPage(includeElements:true) 获取元素清单和可用 selector。',
      };
    }
    return { error: '缺少 elementRef 和 selector，无法定位要填写的元素。' };
  }

  function describe(el) {
    const text = String(
      el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.name || el.id || ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    return '<' + el.tagName.toLowerCase() + '>' + (text ? '「' + text + '」' : '');
  }

  const found = locate();
  if (found.error) {
    return { error: found.error };
  }
  const el = found.el;
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const tag = el.tagName.toLowerCase();

  if (tag === 'input' || tag === 'textarea') {
    const proto =
      tag === 'input' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    el.focus();
    descriptor.set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      detail:
        '已向 ' + describe(el) + ' 填入 ' + value.length +
        ' 个字符（已派发 input/change 事件，未提交表单）。',
    };
  }

  if (tag === 'select') {
    const options = Array.from(el.options);
    const match =
      options.find((opt) => opt.value === value) ||
      options.find((opt) => (opt.textContent || '').trim() === value.trim());
    if (!match) {
      const available = options
        .slice(0, 10)
        .map((opt) => (opt.textContent || '').trim() || opt.value)
        .join(' / ');
      return {
        error: '下拉框中没有匹配「' + value + '」的选项。可选项（前 10 个）：' + available,
      };
    }
    el.value = match.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      detail:
        '已在下拉框 ' + describe(el) + ' 中选中「' +
        ((match.textContent || '').trim() || match.value) + '」（未提交表单）。',
    };
  }

  if (el.isContentEditable) {
    el.focus();
    el.textContent = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      detail: '已向可编辑区域 ' + describe(el) + ' 填入 ' + value.length + ' 个字符（未提交）。',
    };
  }

  return {
    error:
      '目标元素 <' + tag + '> 不是可填写元素（需要 input/textarea/select 或 contenteditable）。' +
      '请用 readBrowserPage(includeElements:true) 确认输入框的 ref/selector。',
  };
}

// 滚动：给了 selector 就滚到该元素；否则按 deltaY 滚动窗口。返回滚动后的位置信息。
export function scrollScript(selector, deltaY) {
  let detail;
  if (selector) {
    let el = null;
    try {
      el = document.querySelector(selector);
    } catch (error) {
      return { error: 'selector 语法无效：' + selector + '（' + error.message + '）' };
    }
    if (!el) {
      return { error: '未找到匹配 selector 的元素：' + selector + '，无法滚动到该元素。' };
    }
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    detail = '已滚动到元素 <' + el.tagName.toLowerCase() + '> 所在位置。';
  } else {
    window.scrollBy(0, deltaY);
    detail = '已向' + (deltaY >= 0 ? '下' : '上') + '滚动 ' + Math.abs(deltaY) + ' 像素。';
  }
  const scrollY = Math.round(window.scrollY);
  const scrollHeight = Math.max(
    document.documentElement.scrollHeight,
    document.body ? document.body.scrollHeight : 0
  );
  const atBottom = window.innerHeight + window.scrollY >= scrollHeight - 2;
  return { detail, scrollY, scrollHeight, atBottom };
}
