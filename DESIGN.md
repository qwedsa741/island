---
name: Island
description: 安静、可靠的本地桌面收藏入口
colors:
  primary: "oklch(0.550 0.105 230)"
  primary-hover: "oklch(0.490 0.110 230)"
  accent: "oklch(0.700 0.145 165)"
  background: "oklch(1.000 0.000 0)"
  surface: "oklch(0.970 0.006 230)"
  surface-strong: "oklch(0.930 0.010 230)"
  ink: "oklch(0.205 0.018 230)"
  muted: "oklch(0.470 0.025 230)"
  border: "oklch(0.875 0.012 230)"
  danger: "oklch(0.560 0.180 28)"
  success: "oklch(0.570 0.130 155)"
typography:
  headline:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 550
    lineHeight: 1.35
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    rounded: "{rounded.md}"
    padding: "9px 14px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.background}"
    rounded: "{rounded.md}"
    padding: "9px 14px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
---

# Design System: Island

## Overview

**Creative North Star: "雾港信标"**

Island 面向长时间在 Windows 桌面环境中工作的用户：屏幕周围可能有办公室日光，也可能是深夜台灯。界面像雾港中的导航设施——背景保持中性清晰，冷静的港湾蓝只在当前选择和关键动作上出现，薄荷绿只负责确认“已经安全收下”。

这是一个克制的生产力工具，不是营销仪表盘。信息密度可以高，但层级、状态和操作必须熟悉；悬浮岛应融入桌面，主窗口则让资料本身占据视觉中心。

**Key Characteristics:**

- 中性表面、低干扰的单一主色。
- 紧凑但不拥挤的桌面信息密度。
- 清楚、即时、可撤销的状态反馈。
- 用分隔和色阶组织空间，阴影只用于浮层。

## Colors

港湾蓝是唯一主动作颜色，薄荷绿只表达安全完成；其余界面由无色背景与微冷中性色构成。

### Primary

- **港湾信标蓝**：用于主按钮、焦点、当前导航和选中项，不作为大面积装饰。

### Secondary

- **安全薄荷绿**：用于收藏成功、数据完整和已完成状态，不承担普通导航。

### Neutral

- **纯白底面**：主内容和输入区域。
- **雾面层**：侧栏、工具栏和悬浮岛内部层级。
- **深海墨色**：正文和关键标签，满足高对比阅读。
- **港雾灰蓝**：辅助信息、时间和次要说明。

**The One Beacon Rule.** 每个视图只有一个最明确的主动作；主色占屏幕面积不得超过 10%。

## Typography

**Display Font:** Inter（Segoe UI 与 system-ui 回退）  
**Body Font:** Inter（Segoe UI 与 system-ui 回退）

**Character:** 单一人文无衬线字体提供安静、熟悉的 Windows 工具感。标题依靠字重和间距建立层级，不使用展示字体。

### Hierarchy

- **Headline**（650，24px，1.25）：页面标题和空状态主句。
- **Title**（600，15px，1.4）：资料标题、面板标题和主要控件。
- **Body**（400，14px，1.55）：正文、描述和详情信息；长文本限制在 72ch。
- **Label**（550，12px，1.35）：字段标签、计数和辅助状态；不强制全大写。

**The Quiet Hierarchy Rule.** 相邻字号只跨一个层级；禁止用超大标题填充资料管理界面。

## Elevation

系统默认扁平，通过相邻表面色阶和一像素分隔线表达结构。只有悬浮岛、菜单、提示和对话框可以使用轻量阴影。

### Shadow Vocabulary

- **浮层阴影**（`0 8px 24px oklch(0.20 0.02 230 / 0.14)`）：仅用于脱离文档流的浮层。
- **岛体阴影**（`0 10px 28px oklch(0.20 0.02 230 / 0.18)`）：仅用于桌面悬浮岛。

**The Flat-by-Default Rule.** 常驻面板不使用阴影；如果列表看起来像一组漂浮卡片，结构就是错误的。

## Components

### Buttons

- **Shape:** 轻柔圆角（10px），高度 36px。
- **Primary:** 港湾蓝底、白字、横向内边距 14px。
- **Hover / Focus:** 150ms 色彩过渡；焦点使用 2px 外环，绝不只靠颜色。
- **Secondary / Ghost:** 中性表面或透明背景，用于同层次辅助动作。

### Chips

- **Style:** 低对比雾面背景、深色文字、完整圆角。
- **State:** 只有选中筛选项使用淡主色背景；删除动作不伪装成筛选标签。

### Cards / Containers

- **Corner Style:** 资料行不做卡片；悬浮岛和空状态容器最多 14px。
- **Background:** 主内容纯白，侧栏和工具栏使用雾面层。
- **Shadow Strategy:** 常驻容器禁止阴影。
- **Border:** 面板间使用 1px 中性分隔。
- **Internal Padding:** 16–24px；紧凑列表项为 10–12px。

### Inputs / Fields

- **Style:** 白色底、1px 中性边界、10px 圆角。
- **Focus:** 港湾蓝边界与 2px 半透明焦点环。
- **Error / Disabled:** 错误使用文字加图标；禁用状态仍须保持文本可读。

### Navigation

左侧导航使用图标、中文标签和可选计数。当前项使用淡主色底与深色文字；未选项保持透明。窄窗口下隐藏详情栏，再折叠导航栏。

### Desktop Island

岛体是唯一允许脱离主窗口的签名组件。默认紧凑，拖放进入时通过背景色、图标和文案同时表明可以接收；成功状态短暂显示后回到最近内容。

## Do's and Don'ts

### Do:

- **Do** 让资料行、搜索框和主要导航遵循同一 6/10/14px 圆角体系。
- **Do** 同时用图标、文字和颜色表达成功、失败及处理中状态。
- **Do** 为所有按钮、输入和资料行实现 hover、focus-visible、active、disabled 状态。
- **Do** 在系统要求减少动态效果时取消位移和缩放动画。

### Don't:

- **Don't** 把产品做成复杂的第二大脑、知识图谱或团队知识库。
- **Don't** 使用仪表盘卡片墙、渐变文字、装饰性玻璃拟态或彩色侧边条。
- **Don't** 使用游戏化、连续弹窗或持续动画争夺注意力。
- **Don't** 把 AI 作为主界面中心，或要求用户先配置模型才能收藏。
- **Don't** 给常驻面板同时添加描边和宽泛阴影。
