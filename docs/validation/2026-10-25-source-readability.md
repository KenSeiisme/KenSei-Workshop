# Google 验证标记与源码可读性验收

本记录覆盖 2026-10-25 的本机构建与回归。基线提交为 `0fadd562fe485783075cc8b52aee39b3b4163be6`，游戏与工具数量分别保持 12 款、28 个。

## 改动

- 将 Google Search Console HTML 验证码集中放在 `data/site.json`，由共享布局直接写入 HTML 的 `<head>`，无需执行 JavaScript。
- 将长 Python HTML 字符串拆成 67 个独立模板；`src/views` 保留页面组合、说明和参数，`scripts/build.py` 保留路由与资源构建。
- 将图片批量设置、PDF 设置、隐私与开源致谢写回对应模板，移除构建时的字符串补丁及被覆盖的旧测速占位界面。
- 使用固定版本 Prettier 与 Black 统一本站源码、测试和文档；提供 `pnpm format`、`pnpm format:check`、EditorConfig 与维护说明。
- 未更改第三方库、SQL 迁移、数据库结构、API、工具与游戏规则、存档键或独立汽车项目；不需要向 Supabase 发布更新。

## 等价性与构建

| 检查               | 结果                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| 统一排版检查       | 287 个网页源码和文档文件、21 个 Python 文件通过                                                      |
| JS／TS／CSS 等价性 | 188 个原有文件经 esbuild 规范化后内容一致                                                            |
| 页面模板等价性     | 排除新增验证标记后，54 页的元素、属性及文本一致；`pre`、`textarea`、`script`、`style` 内容按原文比较 |
| 空目录构建         | 28 个工具、12 款游戏、账号与作品页面完整                                                             |
| 验证标记           | 54 个站点页面各有一份正确标记，均位于 `<head>`                                                       |
| 资源与输出隔离     | 公开资源路径及复制内容正确，构建不包含内部源码、模板或私密配置                                       |
| 纯逻辑测试         | 19／19 组通过                                                                                        |
| 隔离数据库测试     | 11／11 组通过，不连接正式数据库                                                                      |

## 浏览器回归

使用本机 Edge、独立浏览器上下文和本机预览。账号、成绩及实时房间场景使用隔离测试接口，不创建正式账号或成绩。

13 组工具回归通过：`tool-experience`、`tool-feedback`、`local-recovery`、`image-studio`、`tools`、`daily-tools`、`network-guards`、`network-dashboard`、`fourth-tools`、`fifth-tools`、`sixth-planner`、`sixth-whiteboard`、`sixth-media`。覆盖全部工具页面的 320／360／768／1440px 布局、操作反馈、恢复、图片与 ZIP 输出、PDF、QR、OCR、数据与字幕、白板、学习计划、录音录屏及测速限制。

6 组账号与游戏回归通过：`auth`、`profiles`、`games`、`games-expansion`、`arcade-next`、`game-experience`。覆盖登录返回、资料、公开榜、12 款游戏布局与操作、旧存档、Brick Breaker v2 强化、音效及 Pong 双浏览器测试接口。首次并发执行时，两个游戏测试出现初始化超时；分别带诊断重跑后通过，未修改超时时限或跳过断言，也未发现未处理的页面错误。

截图检查包含手机 Markdown 编辑页、桌面游戏舞台与公开战绩页。完整日志与截图位于本机 `_qa/readability-*` 及各测试原有输出路径，不提交到仓库。

## 发布与 Google 验证

发布继续使用现有 `KenSei-Workshop` 分支：通过本机检查后 push GitHub，由 Vercel 自动部署。发布后的独立检查需要确认正式首页无需登录即可返回验证标记，并核对站点路由和更新资源。

代码中的标记不等于 Google 账号侧已经验证成功。正式首页可读取标记后，站主仍需在 Search Console 的 `https://kensei-workshop.vercel.app/` 网址前缀资源中点击验证；成功后保留标记。
