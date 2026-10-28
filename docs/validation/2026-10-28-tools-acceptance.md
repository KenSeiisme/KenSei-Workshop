# 2026-10-28：28 工具全面验收与修复

## 结论

28 个工具的自动化核心流程及文件输出回归通过；本轮修复 15 组功能、保存和易用性问题。功能测试、开发者走查、真实后端与实体设备分别记录，不构成零 Bug 保证或全部人工验收通过。

Android Chrome 为站主确认的主要手机环境。真实手机、Google 授权、设备权限和四个真实账号的联机检查仍待协助完成；不由桌面视口、模拟 SDK 或本机数据库测试替代。

## 自动化与证据

| 检查           | 结果与边界                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| 深入回归       | 69/69 套件最终通过（初次 68/69，修复后定向复验）；包括单元、PGlite 数据库、浏览器功能及文件输出                   |
| 双语与布局     | 280/280 页面案例通过；28 工具 × 2 语言 × Chromium/Firefox/WebKit/Edge/Brave；每例检查六种视口                     |
| 最终核心回归   | 11/11 组通过，覆盖全部 28 工具；最终来源指纹与跨引擎复验一致                                                      |
| 跨引擎文件输出 | Firefox、WebKit 共 8 组通过；不支持的 Web Audio 明确为不适用，不算音频输出通过                                    |
| 保存与恢复     | 慢保存、继续编辑、恢复、重复保存及账号切换夹具；7 个可选本机恢复工具沿用原机制                                    |
| 真实匿名后端   | 6 项通过：私人接口拒绝、Workspace 隔离和中英文公开榜字段；不产生正式成绩或修改私人数据                            |
| 真实测速       | 一次完成，配置请求负载 338,900,000 bytes；仅 /meta、/__down、/__up，无额外结果上报；协议开销另计                  |
| 构建与格式     | 网页、源码、文档与 24 个 Python 文件格式检查通过；干净构建验证 107 页、98 个 Sitemap 网址、验证标记及公开资源完整 |
| 易用性走查     | 28 工具手机/桌面共 56 张布局截图及任务流程；为开发者走查，不标成新用户测试                                        |

测速未在每次回归中重复执行。真实请求负载是浏览器测量请求的预算记录，不是运营商计费流量。音视频以解码样本、PCM、声道/峰值和实际媒体文件检查；人工试听及实体录制另列待验。

## 28 工具覆盖表

`通过`只表示已执行自动化的核心流程、边界及输出断言。完整人工任务与未覆盖环境仍需独立记录。

| 工具               | 核心流程与输出 | 主要证据任务                                                                                | 真实手机 |
| ------------------ | -------------- | ------------------------------------------------------------------------------------------- | -------- |
| Image Studio       | 通过           | Compress two images, compare them and download the ZIP.                                     | 待实测   |
| QR Studio          | 通过           | Generate and independently scan a Wi-Fi QR code; download a batch.                          | 待实测   |
| PDF Toolkit        | 通过           | Reorder pages, fill a form and export editable and flattened PDFs.                          | 待实测   |
| Text Toolkit       | 通过           | Preview a cleanup, apply it, undo it and save a named draft.                                | 待实测   |
| Markdown Studio    | 通过           | Preview math and diagrams and reopen the standalone HTML export.                            | 待实测   |
| Text Compare       | 通过           | Compare changes by word, navigate them and export a diff.                                   | 待实测   |
| Image to Text      | 通过           | Recognize four languages, correct a box and search the exported PDF.                        | 待实测   |
| Focus Timer        | 通过           | Start, pause, resume and restore a timer; verify the ring and single completion.            | 待实测   |
| Answer Book        | 通过           | Reveal one answer, copy it and find it in history without saving the question.              | 待实测   |
| Decision Studio    | 通过           | Save weighted options, spin, draw without repeats and form complete groups.                 | 待实测   |
| Typing Sprint      | 通过           | Finish a custom practice and check Ranked timing, scoring and retry isolation.              | 待实测   |
| Device Check       | 通过           | Start and stop keyboard, mouse and touch checks; verify listener cleanup.                   | 待实测   |
| Network Test       | 通过           | Check known speed samples, units, limits and cancellation without extra reporting.          | 待实测   |
| ZIP Studio         | 通过           | Pack a Chinese folder, inspect and extract it, then reject unsafe archives.                 | 待实测   |
| Color Studio       | 通过           | Convert a known color, lock a swatch and export an image palette.                           | 待实测   |
| Unit Converter     | 通过           | Convert temperature, binary storage and UK/US volume; save a combination.                   | 待实测   |
| Password Generator | 通过           | Generate a constrained password and six-word phrase; test copy failure without persistence. | 待实测   |
| Time Studio        | 通过           | Resolve DST, compare dates and export a meeting calendar event.                             | 待实测   |
| File Renamer       | 通过           | Apply ordered rules, resolve conflicts and compare the ZIP with its CSV mapping.            | 待实测   |
| Audio Studio       | 通过           | Trim, mix, pan and fade audio; inspect and play the actual WAV/MP3 output.                  | 待实测   |
| Data Studio        | 通过           | Keep leading zeros, join and pivot tables, cancel SQL and inspect exported results.         | 待实测   |
| Flashcards         | 通过           | Import mapped cards, review them and verify the next due date and old deck compatibility.   | 待实测   |
| Calculator Studio  | 通过           | Check DEG/RAD, operator precedence, variables and recover from an invalid expression.       | 待实测   |
| File Check         | 通过           | Verify known hashes, missing manifest entries, duplicates and the CSV report.               | 待实测   |
| Subtitle Studio    | 通过           | Import, merge and retime subtitles; verify SRT/VTT round trips and invalid intervals.       | 待实测   |
| Study Planner      | 通过           | Create repeating classes and deadlines, restore the plan and inspect its ICS time zone.     | 待实测   |
| Whiteboard         | 通过           | Draw, undo and export; verify private sync and four-member shared scene permissions.        | 待实测   |
| Screen Recorder    | 通过           | Cancel the countdown, record a synthetic stream and play the downloaded recording.          | 待实测   |

## 修复与复验

逐项复现、级别和修复见 [缺陷记录](tools-defects.md)。主要修复包括：

- 保存期间继续编辑或恢复副本，不再把新内容误报为已经存入 Workspace。
- CSV 多行单元格保留换行；配方防止重复保存和旧身份回执混入。
- QR 生成/扫描控件分区、密码模式设置、学习计划焦点及双语 Help 更清楚。
- 补输入名称、对话框名称及 44px 触控目标；WebKit 的 Help 焦点返回和不支持音频提示已验证。
- 初始化失败保持错误和重载入口，语言切换后入口仍可用；保留输入并说明重新选择文件。
- OCR 改为管理单层 Tesseract Worker，修复 Firefox 连续取消；实际四种语言、下载和 PDF 文字层再次验证。

部分历史测试等待旧控件、固定时延或已经改变的过滤视图。本轮修正测试前提和等待条件，保留独立输出断言；没有以删除断言换取通过。

## Android 人工短清单

按 [完整人工清单](tools-acceptance.md#人工短清单) 记录设备型号、浏览器版本、语言和通过/失败：

1. 繁中页 Google 登录：先取消再重试，正确回跳；头像与账号菜单正常，退出/换账号不串记录。
2. Text Toolkit 输入中英文：软键盘、横竖屏和语言切换保留文字，保存再打开，TXT 可在手机下载目录找到。
3. 两张非私人图片：处理、比较、ZIP 下载并解压；Send to PDF 不丢原页，目标页不自动处理。
4. QR 相机、Audio 麦克风：拒绝后重试，停止/切页释放设备，实际录音可试听和下载。手机不支持录屏时应有清楚说明。

四人共享白板、真实读屏、独立 PDF 阅读器、日历 ICS 导入和首次使用者理解仍为待验收。不得把未测记为通过。

## 复用与发布

命令、样本和证据层次见 [工具验收与维护](tools-acceptance.md)。[机器可读报告](2026-10-28-tools-acceptance.json) 保留套件状态、运行时间与来源指纹；原始日志和截图保存在本机 `_qa/tools-acceptance/`，不进入公开部署。

发布使用现有 `KenSei-Workshop` GitHub 分支和 Vercel 自动部署，不修改独立个人主页、3A3D 或 Supabase 结构。正式站复查只调用匿名只读接口和合成文件，不重复完整测速。

完整回归来源指纹：`507d91db82ed1385ecee8adef40cb42454b74d222e77a05615ca42b2a250aa96`。

后续修复及最终版本的定向复验：

完整回归最初为 68/69；Firefox OCR 连续取消问题修复后，跨引擎组重新 8/8 通过，随后 11 组（28 工具）核心回归通过。另复验 Firefox/WebKit 的保存竞态、密码模式、双语错误恢复，以及 Edge/Firefox 的连续 OCR 取消；原始失败保留，不以自动重试隐藏。

最终来源指纹：`a0258d8b713eac89063877b7144d1b0ef322559492f1dc9f6c1e645db2c06bba`。
