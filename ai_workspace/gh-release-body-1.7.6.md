## CraftStation v1.7.6

### Threads — 输出速度读数改为真实测量

- tok/s 读数不再在工具密集的 turn 上崩塌：decode 时间改为按流式分段累计（每条消息的首个 delta 到末个 delta），工具执行与等待不再计入生成时间——此前 52 秒带工具调用的 turn 会显示 ~2 tok/s，因为整个 turn 的墙钟时间被当成了分母。
- 分子改为真实值：每个模型调用 usage 样本中 provider 上报的 output + reasoning token 取代字符估算，估算只覆盖最近一次上报之后流出的文本。
- 速率从状态 pill 移入悬浮详情面板；仅在没有任何 provider 数据时才标注「估算」。

**下载**

- Windows 安装版：`CraftStation-Setup-1.7.6-x64.exe`
- Windows 便携版：`CraftStation-Portable-1.7.6-x64.exe`
