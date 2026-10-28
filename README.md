# KenSei Workshop

以浏览器工具为主的平台，目前提供 **28 个工具**，并有独立的 **12 款小游戏**栏目；其中 9 款支持公开榜及 30 项成就。四子棋、黑白棋为私人游戏，Pong 为好友在线邀请房。

- 正式网站：https://kensei-workshop.vercel.app/
- GitHub 分支：`KenSei-Workshop`
- 发布方式：push GitHub，由现有 Vercel 集成自动构建；无需另外手动部署。

白板另提供邀请制共享房间：最多四个已登录账号共同绘画，与私人白板分开保存，并与 Pong 共用两间同时活跃房间的容量。

## 进阶工具

28 个工具按文件数据、学习写作、音视频、日常工具四批升级。兼容结果可通过本机 `Send to` 在同站标签页之间传递；文件只留在内存，不上传或进入恢复记录。

各页扩展集中在 `src/tools/advanced-<tool>.js`，由 `advanced-bootstrap.js` 按路由加载；纯计算、日历、编码和数据校验逻辑独立为小模块。原有路由、存档及 Ranked 接口继续保留。

分批验收命令：`pnpm test:advanced-p1`、`pnpm test:advanced-p2`、`pnpm test:advanced-p3`、`pnpm test:advanced-p4`。数据库测试使用隔离的 PostgreSQL 环境；详细边界与验收记录见 `docs/validation/`。

## 六个专业工作区

Image Studio 批处理配方、PDF Fill & Annotate、Data Analyze、OCR Review & PDF、Markdown 数学/图表及 Audio Mix 已接入。入口、工具数量与文件容量边界保持兼容。

配方复用现有私有 `preset`，带独立版本和参数白名单；不含文件、查询结果、PDF 表单/批注/签名或音频。Data 与 Audio 恢复配方后必须确认来源槽位映射。旧图片预设仍可读取；文字草稿继续手动保存。

- `pnpm test:studios`：纯逻辑、现有 RLS schema 与三个阶段的真实下载验收。
- `pnpm vendor:studios`：开发时重建固定版本 SQL/公式/图表资源；字体来源及兼容约束见 `src/vendor/pdf-fonts/manifest.json`。
- 部署仍只执行 Python 标准库静态构建，不安装浏览器运行依赖，不需要 Supabase 迁移。

## 文件夹怎么找

```text
KenSei Workshop/
├─ src/                 网站源码
│  ├─ app.js            公共界面、登录和原有工作区
│  ├─ config.js         可公开的站点与 Supabase 配置
│  ├─ assets/           图片、图标
│  ├─ styles/           网站及工具样式
│  ├─ games/            十二款游戏、共享规则、成就和账号存档界面
│  ├─ tools/            各工具脚本、worker、同步模块
│  ├─ templates/        可直接阅读的 HTML 布局、页面与工具片段
│  ├─ views/            Python 页面组合、工具说明与模板参数
│  └─ vendor/           固定版本第三方脚本、OCR 模型、WASM、许可证
├─ data/                工具、游戏目录、正式网址、站点验证配置和 OCR 模型版本锁定
├─ scripts/             构建、预览、依赖打包和测试入口
├─ tests/               unit / database / browser / support
├─ supabase/            数据库 schema / migrations / checks
├─ docs/                结构说明、验收记录和研究资料
├─ projects/3A3D/       独立汽车项目，使用自己的 Git 和部署
├─ dist/                本机构建结果；自动生成，不提交 Git
├─ _qa/                 本机截图、测试报告；不提交 Git
└─ build.py             保留的兼容构建入口
```

## 常用操作

构建和本机预览只需要 Python 3.10 或以上版本，无需安装 Python 第三方库：

```powershell
python build.py
python scripts/serve.py 8769
```

打开 http://127.0.0.1:8769 。`python scripts/build.py` 也可以构建，`--output <目录>` 可以指定独立输出位置。

开发或运行自动测试时安装 Node.js / pnpm 依赖：

```powershell
pnpm install
pnpm build
pnpm test:structure
pnpm test:unit
pnpm test:database
pnpm test:experience
pnpm test:tool-motion-shared

# 浏览器测试需要先运行上面的预览服务器。
$env:TEST_BASE_URL = 'http://127.0.0.1:8769'
pnpm test:games
pnpm test:games-expansion
pnpm test:arcade-next
pnpm test:game-experience
pnpm test:browser
# 或运行所有测试：pnpm test:all
```

浏览器测试默认使用本机 Edge。可通过 `BROWSER_CHANNEL` 选择其他已安装的 Playwright 浏览器；`pnpm exec playwright install chromium` 可安装 Chromium，再设置 `BROWSER_CHANNEL=chromium`。原有的 `pnpm test`、`test:profiles` 和各批次测试命令仍然可用。

## 修改什么，去哪里

| 修改内容                         | 文件位置                                       |
| -------------------------------- | ---------------------------------------------- |
| 工具名称、分类、搜索内容         | `data/tools.json`                              |
| 某个工具的功能                   | `src/tools/<工具标识>.js`                      |
| 工具表单与游戏页面 HTML          | `src/templates/tools/`、`src/templates/games/` |
| 导航、公共布局、首页             | `src/templates/site/`、`src/templates/pages/`  |
| 页面组合、工具说明和模板参数     | `src/views/`、`scripts/build.py`               |
| 正式网址与 Search Console 验证码 | `data/site.json`                               |
| 网站和工具外观                   | `src/styles/`                                  |
| 数据库升级                       | `supabase/migrations/`                         |
| 数据库权限验证                   | `supabase/checks/`                             |
| 第三方依赖打包                   | `scripts/vendor*.mjs`                          |

修改源码后重新构建。不要直接修改 `dist`；它随时可以由源码重新生成。`src/vendor` 内的语言包和 WASM 是本机 OCR、PDF 等工具的运行依赖，源码包和许可证也需要保留。更新依赖时使用 `pnpm vendor`，并提交相应的源码产物、版本锁和许可证。

## 统一排版

HTML、CSS、JavaScript、TypeScript、JSON 和 Markdown 使用固定版本 Prettier；Python 使用固定版本 Black。开发时额外安装 Python 排版工具：

```powershell
python -m pip install -r requirements-dev.txt
pnpm format
pnpm format:check
```

排版只处理本站维护的源码、测试和文档；不会重写第三方资源、已应用的 SQL 迁移、构建产物或独立汽车项目。构建与部署仍只使用 Python 标准库。模板使用 `${name}` 占位，字面量 `$` 写作 `$$`；新增字段需在对应 Python 组合函数中传入，缺少字段会直接让构建失败。动态文本的 HTML 转义仍由调用方负责。

## Google Search Console

`data/site.json` 保存 HTML 验证码，`src/templates/site/layout.html` 将标记放在所有站点页面的 `<head>` 内。提交并等待现有 Vercel 自动部署后，在 Search Console 的 `https://kensei-workshop.vercel.app/` 网址前缀资源中点击验证；站点验证成功后仍应保留标记。`pnpm test:structure` 会检查每个页面的标记位置和内容。

`data/site.json` 的 `site_url` 指定正式站根网址。每次构建会从实际页面目录自动生成 `/sitemap.xml`，收录首页、工具、游戏、作品、隐私及开源致谢页面，排除 Workspace、Profile、登录回调和错误页；新增工具或游戏无需手动补网址。所有链接使用正式站 HTTPS 网址及尾斜线，不填写无法准确维护的更新时间。

`/robots.txt` 保留现有抓取规则并声明 Sitemap 地址。部署后，在 Search Console 的 **Sitemaps** 中提交 `sitemap.xml`，即可查看 Google 的读取状态；提交不代表已经收录。`pnpm test:structure` 同时检查 XML、公开页面覆盖、排除项、重复网址及 robots 声明。robots 规则只管理抓取，私人数据仍由登录和数据库权限保护。

## 数据和部署

网站公开资源仍使用原来的 `/tool-scripts/`、`/vendor/`、`/assets/` 等网址。目录整理没有更改页面地址、IndexedDB 名称、本机保存键或 Supabase 数据结构。

`.env.local` 保留在本机根目录，禁止提交；`src/config.js` 只包含可公开的配置。私人草稿、学习计划和白板按账号隔离；录屏、录音和扫码内容只在浏览器处理。Google 登录、公开 Profile 和打字榜继续使用现有 Supabase 项目。

`projects/3A3D` 是独立项目，不会进入主站部署。Games 使用独立目录和 `/games/` 路由；普通私人对局保存到 Games，Pong 房间只临时保留，不进入工具搜索、Workspace 或 Continue playing。成就与个人统计只计算服务器确认的有效 Public 结果。

更多说明见 [项目结构](docs/project-structure.md)、[各批验收](docs/validation/) 和 [历史说明](docs/history/pre-organization-readme.md)。

## 统一的工具体验

2026-10-28 的工具验收、修复和人工待测项目见 [28 工具验收报告](docs/validation/2026-10-28-tools-acceptance.md)。

28 个工具的统一验收入口为 `pnpm test:tools:smoke`、`pnpm test:tools:acceptance` 和显式正式站检查 `pnpm test:tools:live`。覆盖表、合成样本、报告分类和 Android 人工短清单见 [工具验收与维护](docs/validation/tools-acceptance.md)。浏览器模拟、真实后端和真实设备分别记录，不把脚本通过称为零 Bug。

全部 28 个工具共用页头、Help、状态反馈及响应式交互；通用布局和各工具适配分别维护。手机上的编辑标签切换保留输入，长历史和进阶设置可展开。

七个文字编辑工具可自行开启 `Remember on this device`，默认关闭。恢复副本存放在独立 IndexedDB，与 Workspace 草稿和账号同步分离；每个工具、每个身份保留最近三次编辑会话，每份最多 2 MB。恢复需要主动选择，保存草稿时另存新副本；关闭开关会清除此身份在当前工具的恢复记录。

恢复不会保存密码、QR/Wi-Fi 内容、临时问题、打字输入、文件对象或媒体，也不会自动上传。验收说明见 [工具体验](docs/validation/tool-experience.md)。

## Games

游戏目录、玩法、存档及服务端验收说明见 [docs/games.md](docs/games.md)。游戏规则在浏览器和 Supabase Edge 共用，发布前运行 `pnpm test:games` 和 `pnpm test:games-expansion`；现有 Vercel 仍由 GitHub push 自动构建。

Games 使用独立的霓虹舞台与动画表现层；`Effects: Auto / Reduced / Off` 仅在本机保存偏好，Auto 遵循系统减少动态效果设置。新增的 `pnpm test:game-neon` 检查动画、节点稳定性、输入一致性及响应式布局；详情见 [霓虹游戏验收](docs/validation/2026-10-23-neon-games.md)。

12 款游戏页使用棋盘优先布局：进入后可从棋盘内 Start／Continue，开局自动收起网站导航进入专注模式；Exit focus 只改变布局。难度与 Start 位于开局卡；声音和 Help 从设置或菜单进入，排行榜在宽屏舞台旁显示。`pnpm test:game-shell` 检查首屏尺寸、触控、存档恢复及 Public 资格，详情见 [游戏舞台验收](docs/validation/2026-10-25-board-first-games.md)。

游戏页的难度与开始按钮位于同一张开局卡；桌面宽度达到 1100px 时右侧常驻排行榜，较窄屏幕在棋盘下方展示。模式不再手动选择：游客直接玩，登录后的新局自动参榜；暂停或续玩只保留本机成绩。原有自动存档、Continue playing、旧记录及提交重试继续兼容。`pnpm test:game-shell` 同时覆盖布局、榜单读取与资格恢复。
