# piwin 扩展仓库接入

扩展目录：[piwin-extensions](https://extension.piwinwin.com/#/)。它发布 `index.json`，每条记录指向扩展作者仓库里的固定 Git commit。Host 读取索引，安装时核对实际检出的 commit，并将源码放入不可变扩展目录。市场不可用时，内置精选目录仍可用。

首次上架的是 [Command Code for piwin](https://github.com/mimimaster/piwin-commandcode-provider/tree/main/piwin)，改编自 `patlux/pi-commandcode-provider`，保留 MIT 许可。在桌面端「扩展市场」搜索名称并点击安装，piwin 随即启用扩展、应用到当前 Agent；若有任务正在运行，会在该任务结束后热加载。然后在「设置 → OAuth → Command Code」连接自己的账号，在「设置 → 模型」启用或选择 Command Code 模型。CLI 暂不使用。

自建索引可以在 Host 环境中设置 `PIWIN_EXTENSION_REGISTRY_URL`。条目格式、发布和改装规则见扩展仓库的 [CONTRIBUTING](https://github.com/mimimaster/piwin-extensions/blob/main/CONTRIBUTING.md)。

## 提供订阅授权的扩展

任何扩展都可以在 `piwin.json` 里声明一个订阅提供商，例如 Command Code 声明 `authProvider: "commandcode"`，Kiro 声明 `authProvider: "kiro"`：

```json
{ "authProvider": "acme-cloud", "authProviderName": "Acme Cloud" }
```

- `authProvider`：小写字母、数字和连字符，不能与 piwin 内置订阅 id（如 `openai-codex`、`anthropic`）重名。不合规的声明会被忽略；两个已启用扩展声明同一个 id 时 Host 报错。
- `authProviderName`：可选，授权卡片的显示名。省略时使用扩展在 `pi.registerProvider` 里写的 `name`。
- 扩展自己调用 `pi.registerProvider(<authProvider>, { oauth, models, ... })` 提供登录流程和模型目录。Host 只注册声明的那个 id。

只有已安装且启用的选中版本能让 Host 显示该授权入口，停用或卸载后卡片和模型随之消失。扩展以 Host 用户权限运行。piwin 源码不针对任何扩展 id 做特殊处理，新增订阅扩展无需修改 piwin。
