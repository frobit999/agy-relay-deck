# Agy Relay：Mac → Windows 搬家说明

这个文件夹包含 Antigravity CLI 的本地会话、Brain、附件、Agy Relay 房间状态，以及可在 Windows 使用的面板源码。

## 重要隐私提醒

- 会话和 Brain 可能包含提示词、代码、服务器地址、命令输出和上传文件。请把整个迁移目录视为敏感数据。
- 迁移包**故意不包含** Google OAuth token、Antigravity Tools 账号 token、Mac 安装 ID、日志、崩溃文件和 Mac 二进制。
- 不建议上传到公开网盘。若使用移动硬盘，建议使用 BitLocker 或其他加密容器。
- 在 Windows 验证完成以前，不要抹除 Mac。

## Mac 上最后一次同步

准备抹除 Mac 前：

1. 等所有 `agy` 回复和工具调用结束。
2. 正常关闭全部 `agy` 窗口。
3. 关闭 Agy Relay 面板页面即可，面板服务本身不写会话。
4. 双击 `Final-Sync-Mac.command`。
5. 看到“最终同步与校验清单已完成”后，再把整个迁移文件夹复制到 Windows。

由于 Brain 含有大量小文件，推荐随后双击 `Create-Transfer-Archive-Mac.command`，生成同目录下的 `AgyRelay-Windows-Migration.tar`。复制这一个文件通常比拖拽约 29 万个文件更快、更不容易中断。Windows 11 解包：

```powershell
tar -xf AgyRelay-Windows-Migration.tar
```

移动硬盘请使用 NTFS 或 exFAT，不要使用不支持大于 4GB 文件的 FAT32。

脚本检测到任何 `agy` 进程时会拒绝继续，不会偷偷复制正在写入的数据库。

## Windows 恢复顺序

建议使用 Windows 11，依次安装：

1. **Antigravity CLI**（官方 PowerShell 安装）：

   ```powershell
   irm https://antigravity.google/cli/install.ps1 | iex
   ```

2. **Node.js 20 或更高版本**：<https://nodejs.org/>
3. **Python 3**：<https://www.python.org/downloads/windows/>
4. **Antigravity Tools**，然后重新导入你本人有权使用的账号。

不要从迁移包寻找旧 token；Windows 上应重新登录。

接下来：

1. 右键 PowerShell，普通用户运行即可。
2. 进入迁移文件夹：

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\Restore-Windows.ps1
   ```

3. 运行完整性检查：

   ```powershell
   .\Verify-Windows.ps1
   ```

4. 运行一次 `agy`，在浏览器中重新登录 Google 账号，然后退出。
5. 启动 Antigravity Tools，导入账号并选中当前要使用的账号。
6. 将 Agy Relay 房间绑定到 Windows 当前账号：

   ```powershell
   .\Rebind-Rooms-To-Current-Account.ps1
   ```

7. 双击桌面上的 `Agy Relay.cmd`，或运行：

   ```powershell
   $HOME\AgyRelayDeck\start-windows.cmd
   ```

## 项目文件不在迁移包中

本包保存的是 agent 会话与记忆，不会自动复制 `/Users/...` 下的代码项目。`workspace-map.txt` 列出会话曾使用的 Mac 路径，需把真正需要的项目仓库另行复制或重新 clone。

恢复脚本会把面板房间的默认工作目录安全地改为 Windows 用户主目录；之后可在目标项目目录中启动 `agy --conversation <ID>`。

## 验证成功以后再抹除 Mac

至少确认以下事项：

- `Verify-Windows.ps1` 全部通过；
- Agy Relay 能显示当前房间及 A/B/C1 等窗口；
- 至少打开一条会话，确认历史与近期任务正常；
- 需要的项目代码和 SSH 密钥已另行迁移；
- Google 和 Antigravity Tools 已在 Windows 重新登录。

然后再使用 macOS 的“抹掉所有内容和设置”。

