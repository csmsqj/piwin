# piwin 扩展仓库接入

扩展目录：[piwin-extensions](https://mimimaster.github.io/piwin-extensions/#/)。它发布 `index.json`，每条记录指向扩展作者仓库里的固定 Git commit。Host 读取索引，安装时核对实际检出的 commit，并将源码放入不可变扩展目录。市场不可用时，内置精选目录仍可用。

首次上架的是 [Command Code for piwin](https://github.com/mimimaster/piwin-commandcode-provider/tree/main/piwin)，改编自 `patlux/pi-commandcode-provider`，保留 MIT 许可。在桌面端「扩展市场」搜索名称并点击安装，piwin 随即启用扩展、应用到当前 Agent；若有任务正在运行，会在该任务结束后热加载。然后在「设置 → OAuth → Command Code」连接自己的账号，在「设置 → 模型」启用或选择 Command Code 模型。CLI 暂不使用。

自建索引可以在 Host 环境中设置 `PIWIN_EXTENSION_REGISTRY_URL`。条目格式、发布和改装规则见扩展仓库的 [CONTRIBUTING](https://github.com/mimimaster/piwin-extensions/blob/main/CONTRIBUTING.md)。

Command Code 扩展的 `piwin.json` 声明 `authProvider: "commandcode"`。只有已安装且启用的选中版本能让 Host 显示该授权入口；它仍以 Host 用户权限运行。当前此声明只支持 Command Code，不能用它添加任意 OAuth 提供商。
