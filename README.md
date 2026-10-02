# Agy Relay Deck

一个仅运行在 macOS 本机的 Antigravity CLI 多账号额度与长对话安全接力面板。

它把账号切换、本地对话移植和多窗口记忆汇合组合成一个有备份、验证与回滚的一键流程：账号负责额度身份，本地数据库负责上下文连续性。

> **非官方社区项目。** 本项目与 Google、Antigravity CLI 及 Antigravity Tools 的开发者没有隶属或背书关系。请仅使用你拥有或获准操作的账号，并遵守相关服务条款。本项目不绕过认证、不创建账号，也不修改服务商侧的额度。

## 适合谁

- 在 Antigravity CLI 中有很长的本地对话，不想换账号后从头解释上下文
- 已经用 [Antigravity Tools](https://github.com/lbjlaq/Antigravity-Manager) 管理多个获授权账号
- 希望在执行任何本地数据库替换前自动备份，并在异常时恢复

## 它能做什么

- 集中显示账号的 Gemini / 第三方模型周额度和 5 小时额度
- 在每条对话的 step 数旁显示本地体积（SQLite + brain + transcript/附件）
- 对缺失的周额度显示“未知”，不会拿单模型的 100% 冒充周额度
- 通过 Antigravity Tools 将 `agy` 切换到目标账号
- 用目标账号创建一个带正确身份和工作区绑定的空白对话
- 将旧对话的轨迹、模型元数据、执行器记录、父引用和 brain 移植到新对话
- 保留目标对话的身份绑定表
- 验证数据库完整性、轨迹行数和绑定表摘要
- 验证失败自动回滚，也可从接力记录中手动回滚
- 从面板直接在终端中打开接力后的对话
- 从一段母记忆创建 2–6 个独立并行窗口
- 换号时选一条完整主干，自动提取其他窗口在分裂点之后的增量
- 将超长增量自动分片吸收，生成新的唯一母会话，再进入下一轮并行

## 多窗口循环

```text
母会话 M0
  ├── 窗口 A：完整继承 M0，独立继续
  ├── 窗口 B：完整继承 M0，独立继续
  └── 窗口 C：完整继承 M0，独立继续
                    │
                    └── 换号汇合 → 新母会话 M1
                                         ├── 再开窗口 A'
                                         ├── 再开窗口 B'
                                         └── ……循环
```

使用方法：

1. 退出所有 `agy` 窗口。
2. 在“多窗口记忆房间”选择母对话、窗口数量和当前账号。
3. 创建完成后点击“打开全部窗口”。每个窗口都有独立的 conversation ID，不会同时写一个 SQLite 数据库。
4. 并行工作结束或准备换号时，先关闭所有窗口。
5. 选择一条窗口作为完整主干，再选择有额度的新账号，点击“汇合并换号”。
6. 面板只提取其他窗口在共同分裂点之后的新增记录；超长内容会分片、顺序吸收到新母会话。
7. 从新母会话继续，或者直接点击“再开一轮窗口”。

汇合不是把冲突的 SQLite 行硬拼在一起：一条窗口完整保留，其他窗口通过可审计的 transcript 增量进行语义汇合。原始窗口永远保留，因此可以回看或重新汇合。如果多个窗口同时修改同一批项目文件，代码冲突仍应通过 Git 分支或 worktree 处理。

## 一分钟开始

### 前置条件

- macOS
- Node.js 20 或更高版本
- Python 3
- 已安装并登录的 Antigravity CLI（`agy`）
- 已安装 [Antigravity Tools](https://github.com/lbjlaq/Antigravity-Manager)，且至少导入两个你有权使用的账号

本项目在 `agy 1.2.2`、Antigravity Tools `4.7.1` 上验证过。其他版本可能需要适配本地数据库或 API 变化。

### 启动

下载或克隆项目后，双击 `start.command`。浏览器会自动打开：

```text
http://127.0.0.1:7331
```

如果 macOS 第一次阻止脚本，请在 Finder 中右键 `start.command`，选择“打开”。也可以在项目目录运行：

```sh
npm start
```

### 第一次使用

1. 在 Antigravity Tools 中一次性导入并命名好账号。
2. 退出所有正在运行的 `agy` 窗口。
3. 在面板中选择要继续的旧对话。
4. 选择一个有额度的目标账号。
5. 点击“开始安全接力”，再完成二次确认。
6. 成功后点击“在终端打开新对话”。

下一次接力时，选择“最近修改、步数最多”的同名对话，它就是最新版。源对话不会被删除。

## 工作原理

```text
旧账号的长对话（只读）
          │
          ├── Antigravity Tools 切换目标账号
          ├── agy 创建空白目标对话
          ├── 备份目标 DB / brain / annotation
          ├── 复制可迁移的轨迹表和 brain
          ├── 保留目标账号与工作区绑定表
          └── 完整性 + 行数 + 绑定摘要验证
                         │
                  成功 ──┴── 失败自动回滚
```

移植工具只复制以下表：

- `steps`
- `gen_metadata`
- `executor_metadata`
- `parent_references`
- `battle_mode_infos`

它明确保留目标对话的 `trajectory_meta` 和 `trajectory_metadata_blob`，避免把旧账号/工作区身份覆盖到目标空壳。

## 本地安全设计

- 服务只监听 `127.0.0.1`，不会监听局域网或公网地址
- 每次启动生成新的随机面板令牌；修改操作同时检查本地页面来源
- Google refresh token、Tools 管理密码和 API key 永不返回浏览器
- 源对话数据库只读
- 面板检测到 `agy` 仍在运行时拒绝接力或回滚
- 所有目标替换都有时间戳备份
- 页面不加载第三方脚本、字体或远程资源
- 汇合档案保存在新母会话自己的 brain 目录，便于审计和后续接力
- 分支记录按共同分裂点的 step index 提取，不会重复灌入母记忆

更多边界与漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 常见问题

### 还需要手动操作 Antigravity Tools 吗？

日常接力不需要。Tools 作为账号与额度底座在后台运行。只有添加/删除账号、重新授权过期登录或修改账号名称时才需要打开它。

### 这会合并 Google 云端记忆吗？

不会。它迁移的是 Antigravity CLI 保存在本机的对话轨迹和 brain，并让新对话继续使用目标账号的绑定。

### 为什么需要创建一个空白目标对话？

因为目标账号必须先由 `agy` 创建自己的身份和工作区绑定。直接复制整个旧数据库会把不该迁移的绑定一起覆盖。

### 会消耗额度吗？

创建空壳需要向目标账号发送一条极短的计划模式提示。单线移植和数据库验证都在本机完成；多窗口汇合还会用新账号读取并总结增量记忆，每个约 22 万字符的分片消耗一轮模型调用。

### 找不到 Antigravity Tools.app 怎么办？

面板会检查 `/Applications`、`~/Applications`、`~/Downloads` 和 Spotlight。仍找不到时可以显式指定：

```sh
ANTIGRAVITY_TOOLS_BIN="/完整路径/Antigravity Tools.app/Contents/MacOS/antigravity-tools" npm start
```

### 7331 端口被占用怎么办？

```sh
PORT=7332 npm start
```

## 本地数据位置

- 面板记录：`~/.agy-relay-deck/`
- Antigravity CLI：`~/.gemini/antigravity-cli/`
- Antigravity Tools：`~/.antigravity_tools/`

这些目录不会被提交到仓库。

## 开发

项目无第三方运行时依赖。

```sh
npm test
PANEL_DEMO=1 npm start
```

`PANEL_DEMO=1` 使用虚构账号和对话，适合截图或前端开发，不会切换真实账号。

贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。项目使用 [MIT License](LICENSE)。
