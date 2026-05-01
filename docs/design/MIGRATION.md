# Conjiweb · Slate Pro 落实方案（Theme B）

本目录是把方案 B 落地到 `apps/web` 的工程交付物。建议按 **Phase 0 → Phase 4** 的顺序合入，每个 Phase 都是独立 PR、独立可验证。

---

## 文件清单

| 文件 | 用途 |
|---|---|
| `conjiweb-tokens.css` | 设计令牌（颜色/边框/阴影/半径/字体），唯一真源 |
| `conjiweb-tokens.ts` | TS 镜像，供 styled-components / 内联 style 使用 |
| `MIGRATION.md` | 本文件，5 阶段落实计划 |

---

## Phase 0 · 准备（30 min）

1. 安装字体：`apps/web/index.html` 的 `<head>` 加入：
   ```html
   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
   <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
   ```
2. 把 `conjiweb-tokens.css` 拷到 `apps/web/src/styles/tokens.css`。
3. 在 `apps/web/src/main.tsx`（或现有全局样式入口）首行导入：
   ```ts
   import "./styles/tokens.css";
   ```
4. `body` 加上：
   ```css
   body {
     font-family: var(--cj-font-sans);
     letter-spacing: var(--cj-letter-snug);
     -webkit-font-smoothing: antialiased;
     -moz-osx-font-smoothing: grayscale;
     background: var(--cj-bg);
     color: var(--cj-text);
   }
   ```

**验证**：跑 `npm run dev`，整体字体已变 Inter，背景变成 `#f7f7f8`。其他视觉应几乎不变（旧组件还有自己的 hard-coded 颜色）。

---

## Phase 1 · 颜色与边框替换（半天）

**目标**：把所有 hard-coded 的颜色、border、shadow 全部替换成 token。**不动 DOM 结构、不动布局**。

### 替换规则

| 旧值 / 含义 | 新 token |
|---|---|
| `#fff`、白色面板背景 | `var(--cj-surface)` |
| 浅灰背景（搜索框、tabs） | `var(--cj-surface-2)` |
| 列表项 hover | `var(--cj-surface-hover)` |
| 任何 `1px solid #e?e?e?` 类边框 | `1px solid var(--cj-border)` |
| 紫色主色 `#7c5ce4` 类 | `var(--cj-primary)` |
| 紫色 hover | `var(--cj-primary-hover)` |
| 浅紫底（active 列表项） | `var(--cj-primary-tint)` |
| 主色阴影 `0 1px 2px rgba(...)` | `var(--cj-shadow-1)` 或 `--cj-shadow-2` |
| 主文字 | `var(--cj-text)` |
| 次要文字、placeholder | `var(--cj-text-3)` |
| 时间戳 | `var(--cj-text-4)` |

### 关键差异（与原版 UI 对比）

1. **边框**：从模糊的 `rgba(0,0,0,0.05)` 改成具体的 `#e3e3e8`，对比度直接翻倍。
2. **会话项 active 态**：从纯紫底 → **左侧 3px 紫色竖条 + `surface-2` 灰底**（参考 B 方案）：
   ```css
   .convo[data-active="true"] {
     background: var(--cj-surface-2);
     position: relative;
   }
   .convo[data-active="true"]::before {
     content: ""; position: absolute; left: 0; top: 12px; bottom: 12px;
     width: 3px; border-radius: 0 3px 3px 0;
     background: var(--cj-primary);
   }
   ```
3. **我方气泡**：从紫色 → **`#1c1d24` 炭黑**（这是 Slate Pro 的关键差异点；紫色仅用于强调元素：badge、active 竖条、send 按钮）。

**验证**：和 `Slate Pro Preview.html` 对照，颜色应基本一致。

---

## Phase 2 · Typography 统一（2 小时）

应用全局 type scale：

```css
.text-xs    { font-size: var(--cj-fs-xs); }
.text-sm    { font-size: var(--cj-fs-sm); }
.text-md    { font-size: var(--cj-fs-md); }
.text-base  { font-size: var(--cj-fs-base); font-weight: var(--cj-fw-regular); }
.text-lg    { font-size: var(--cj-fs-lg); font-weight: var(--cj-fw-semibold); }
```

字重规则：
- **气泡正文**：`fw-regular` (450) — Slate Pro 故意比 500 轻一点，比 400 紧一点。
- **会话名、按钮标签、tab active**：`fw-semibold` (600)。
- **section 标题**（"Conversations"）：`fw-semibold` + uppercase + `letter-spacing: 0.05em` + `--cj-text-3`。

时间戳和文件名用 `var(--cj-font-mono)` + `font-variant-numeric: tabular-nums;` —— 等宽对齐让对话列表更整齐。

---

## Phase 3 · 高频组件改造（1 天）

按优先级改这 4 个：

### 3.1 IconButton（影响最大）
统一组件，全应用替换：
```tsx
// apps/web/src/components/IconButton.tsx
export function IconButton({ children, active, ...rest }) {
  return (
    <button
      data-active={active || undefined}
      className="cj-iconbtn"
      {...rest}
    >
      {children}
    </button>
  );
}
```
样式见 `chat-app.css` 中 `.iconbtn` —— 关键是 **默认 transparent border，hover 才显形**，避免按钮乱糟糟。

### 3.2 MessageBubble
- `.msg-them .bubble`：白底 + `1px solid var(--cj-border)` + 圆角 14/14/14/4。
- `.msg-me .bubble`：`#1c1d24` 炭黑底 + 白字 + 圆角 14/14/4/14。
- 元数据行（OMEMO 锁 + 时间）放在 bubble **下方**，不要塞进气泡里。

### 3.3 Composer
- 外层圆角 12 + 1px border，**focus-within 才加紫色 ring**：
  ```css
  .composer:focus-within {
    border-color: var(--cj-primary);
    box-shadow: var(--cj-ring-focus);
  }
  ```
- Send 按钮固定 36×36、紫色实底、白色 send 图标。
- 文件 hint（"Enter to send · Shift+Enter for newline"）在 composer **下方**，font-size 10.5px，颜色 `--cj-text-4`。

### 3.4 UploadCard
失败状态用 `--cj-danger` + `--cj-danger-soft`，**不要**整个变红，只改 icon 框 + 图标 + 错误文案。其他保持中性，避免视觉惊吓。

---

## Phase 4 · 最后清理（半天）

1. **跑视觉回归**：截图对比 `Slate Pro Preview.html` 与生产页面的 5 个核心页（chat、starred、settings、login、admin）。
2. **检查 dark mode**：tokens.css 已含 `prefers-color-scheme: dark` 分支，加 `<html data-theme-mode="auto">` 即可启用；逐页检查。
3. **删除死代码**：所有 hard-coded 颜色、`@import` 旧色板、styled-components 里的内联 hex —— 用 `grep -rE "#[0-9a-fA-F]{6}" apps/web/src` 扫一遍。

---

## 估时合计

| Phase | 工作量 |
|---|---|
| 0 准备 | 0.5 h |
| 1 颜色边框 | 4 h |
| 2 Typography | 2 h |
| 3 组件改造 | 8 h |
| 4 清理 | 4 h |
| **总计** | **~2.5 工日** |

可以一个人 push，也可以拆给 2 人并行（Phase 1 + Phase 3 互不冲突）。

---

## 风险点

- **Inter 字体加载失败**：fallback 链已含 system-ui，最坏情况退化到系统字体，不会破版。
- **dark mode 颜色微调**：tokens.css 里给的是基线值，落地后需要在 OMEMO 验证页、call view 这种特殊页做局部 review。
- **既有 styled-components 大量内联色值**：用 codemod 一次替换更快；脚本可以另外让我写。
