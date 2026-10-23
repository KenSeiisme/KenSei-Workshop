# 项目结构与维护

本次整理将源码、数据、生成产物和开发工具分开，保留网站行为和所有公开资源路径。

## 源码与公开文件的对应关系

| 源码                              | 构建到                            |
| --------------------------------- | --------------------------------- |
| `src/app.js`、`src/config.js`     | `/app.js`、`/config.js`           |
| `src/styles/*.css`                | `/<样式文件名>.css`               |
| `src/assets/`                     | `/assets/`                        |
| `src/tools/`                      | `/tool-scripts/`                  |
| `src/games/`                      | `/game-scripts/`                  |
| `data/games.json`                 | 独立 Games 目录与十二款游戏路由   |
| `src/vendor/`                     | `/vendor/`                        |
| `data/tools.json`                 | 工具卡片、路由和 `/tools-data.js` |
| `src/views/` + `scripts/build.py` | 各页面 HTML                       |

工具源码相对于 vendor 的导入继续有效，工具内的 worker、OCR/WASM 和字体均保留原来的公开路径。源文件位置不参与用户保存记录的标识。

## 页面片段

`src/views` 按用途命名：

- `file_tools.py`：QR、PDF、Markdown、文字对比和 OCR。
- `interactive_tools.py`：答案之书、选择助手、打字测速、设备测试。
- `daily_tools.py`：ZIP、颜色、换算、密码等日常工具。
- `media_data_tools.py`：网络测速展示、时间、音频、数据、批量改名。
- `study_file_tools.py`：学习卡片、计算器、文件校验、字幕。
- `planner_view.py`、`whiteboard_view.py`、`capture_views.py`：学习计划、白板和录制界面。
- `image_editor.py`、`profile_view.py`、`workspace_sections.py`：图片编辑、用户资料及新增工作区片段。
- `games_view.py`、`pong_view.py`：独立游戏目录与十二款游戏页面，不进入工具目录。

生成器位于 `scripts/build.py`。根目录 `build.py` 是兼容入口，Vercel 的 `python3 build.py` 配置可以继续使用。生成器只读取 `src` 和 `data`，不读取独立汽车项目或本机秘密文件。

## 测试与数据库资料

`tests/unit` 检查纯逻辑，`tests/database` 使用独立 PGlite 数据库运行迁移和权限检查，`tests/browser` 检查浏览器界面、下载、worker 和同步行为。公共测试支持文件位于 `tests/support`。

`scripts/test.mjs` 统一工作目录、预览地址和测试选择。`scripts/test-suites.json` 保留各批次测试分组。`pnpm test:all` 自动发现三个测试目录里的测试，并运行学习计划、白板各自的同步场景；正式站检查单独使用 `pnpm test:live`。

`supabase/migrations` 的文件名和 SQL 内容没有改变。`supabase/checks` 保存手动权限检查 SQL，`supabase/schema.sql` 保留基础 schema。文件整理不需要向在线数据库执行新迁移。

## 生成产物与本机文件

- `dist` 在本机保留，已从 Git 跟踪中移除；Vercel 从源码重建。
- `_qa` 保留截图和历史测试记录，并保存本次结构验证结果。
- `node_modules`、Python 缓存、Supabase CLI 缓存和 `.vercel` 链接信息均不提交。
- `.env.local` 不移动、不读取或提交。
- `projects/3A3D` 不纳入主站源码整理，独立仓库保持原样。

整理后先在空目录构建，逐一比较了现有 **872 个公开文件**：没有缺失、新增或内容变化。`pnpm test:structure` 可再次检查空目录构建、全部工具路由、完整的公开资源复制，以及输出中没有内部源码或私密配置文件。

十二款游戏独立于工具目录和 Workspace；其中九款支持公开榜及 30 项成就，四子棋和黑白棋仅供私人游玩，Pong 使用临时好友邀请房。共享规则、账号存档及 Edge 发布流程见 [games.md](games.md)。
