# VISIONMAX · LED 显示屏仿真台

一个**单文件、零依赖**的 LED 显示屏高仿真页面。把文字、图片、视频、视频监控画面以逼真方式“上屏”，并支持多种分屏布局、屏体参数调节与 1920×1080 截图导出。

## 特性

- **高仿真屏体**：金属边框、四角螺丝、品牌铭牌 / 散热孔、底座与地面反光；屏幕叠加 RGB 像素点阵、扫描线、刷新亮带、玻璃眩光、暗角、坏点；带开关机动画、OSD 信号信息、鼠标视差，底部仿真状态栏（输入源 / 分辨率 / 屏温 / 运行时长）。
- **四类素材上屏**
  - 文字：内容 / 字号 / 颜色 / 对齐 / 发光 / 跑马灯滚动
  - 图片：本地上传、URL、拖放，填充 / 适应 / 拉伸，内置演示图
  - 视频：本地 mp4/webm、URL，播放 / 静音 / 循环；无素材时显示彩条测试信号
  - 监控：多路 Canvas 实时模拟画面（大厅 / 停车场 / 走廊 / 夜视周界），带 REC、时间戳、通道名、对焦框；可接入本机摄像头
- **布局**：全屏 / 左右 / 上下 / 四宫格 / 画中画，每个分区独立指定信号源。
- **屏体参数**：亮度、像素间距、扫描线、色温；沉浸预览；导出 1920×1080 PNG。
- **快捷键**：`F` 沉浸模式 / `空格` 开关机 / `S` 导出。
- **URL 预设**：例如 `?layout=single&cells=monitor` 直接进指定视图。

## 远程投送（MQTT）

页面内置 MQTT 3.1.1 over WebSocket 客户端（原生实现，无第三方库），连接后自动订阅 `led/studio/#`，外部向以下主题发消息即可远程把内容投到屏幕：

| 主题 | 载荷 | 效果 |
|---|---|---|
| `led/studio/text` | 纯文本 | 文字全屏上屏 |
| `led/studio/image` | 图片 URL / dataURL | 图片全屏上屏 |
| `led/studio/video` | 视频 URL | 视频全屏上屏 |
| `led/studio/cmd` | JSON 命令 | 见下方命令表 |

`led/studio/cmd` JSON 命令示例：

```json
{"type":"text","content":"HELLO","color":"#ffd43b","size":150,"scroll":false}
{"type":"image","url":"https://example.com/a.jpg","fit":"contain"}
{"type":"video","url":"https://example.com/a.mp4","muted":true,"loop":true}
{"type":"layout","layout":"quad"}
{"type":"source","source":"monitor","cell":0}
{"type":"bright","value":120}
{"type":"power","on":false}
```

- 默认不带 `cell` 参数时内容全屏投放；带 `"cell":n` 时投到当前布局的第 n 分区。
- URL 参数：`?mqtt=<wss地址>` 可覆盖 broker 地址，`?mqtt=off` 关闭自动连接；面板勾选「自动连接」的状态保存在 localStorage。
- 断线自动重连（3s），25s 心跳保活。

## 投送台（sender.html）

配套的可视化投送页面：连接同一 broker 后，即可把**文字 / 图片 / 视频**一键推送到大屏。

- **文字**：内容、字号、颜色、对齐、发光、跑马灯
- **图片**：URL 直推；本地图片自动压缩（最长边 ≤1280px，JPEG ~78%）后以 dataURL 投送，附预览与体积显示
- **视频**：URL 直推（静音 / 循环可选）；本地视频以 dataURL 投送（建议 ≤3MB，>25MB 拒绝并提示改用 URL）
- **屏控**：布局（全屏 / 左右 / 上下 / 四宫格 / 画中画）、亮度、电源开关
- **目标分区**：可指定投到大屏当前布局的第 n 分区，或全屏投放
- **原始发布**：可向任意 `led/studio/*` 主题手动发布 payload

## 无人机仿真 + 控制台（GLB · MQTT）

- **`wurenji.html`** — 无人机仿真页。加载程序化生成的 **`drone.glb`**（glTF 2.0 二进制，24 节点 / 352 三角形，含 4 个可独立旋转的螺旋桨、云台相机、起落架、前后 LED）。自研 Canvas 3D 渲染器解析 GLB 并绘制：透视投影、地面网格、动态阴影、Lambert 光照、PBR 材质、螺旋桨旋转模糊、状态灯辉光；带飞行物理（起降 / 姿态 / 位移 / 电量 / 返航）与 HUD 遥测。
- **`wurenji-control.html`** — 地面控制页。双虚拟摇杆（油门 / 偏航 + 俯仰 / 横滚）、键盘控制、起飞 / 降落 / 返航 / 急停 / 拍照 / 重置、云台俯仰、灵敏度，实时姿态仪与遥测回显。
- **`mqtt-client.js`** — 共享 MQTT 3.1.1 客户端（零依赖）。**内含跨消息分帧缓冲**：该 broker 会把一个 MQTT 包拆成多个 1 字节 WebSocket 帧，不做累积会永远收不到 CONNACK（页面卡在「连接中」）。另有 8s 连接超时、3s 自动重连、25s 心跳。
- **`drone.glb` / `drone-data.js`** — 真实 GLB 模型文件 + 其 base64 副本（供 `file://` 直接打开，绕过 fetch 的 CORS 限制）。

**MQTT 主题**：

| 主题 | 方向 | 内容 |
|---|---|---|
| `uav/cmd` | 控制页 → 仿真页 | JSON：axes / takeoff / land / rtl / estop / resume / gimbal / photo / cast / reset / ping |
| `uav/telemetry` | 仿真页 → 控制页 | JSON：高度 / 速度 / 电量 / 姿态 / 坐标 / 模式 / 转速 |
| `led/studio/image` | 仿真页 → 大屏 | 开启「投屏到大屏」后周期推送 JPEG dataURL，大屏实时显示无人机画面 |

`uav/cmd` 示例：
```json
{"type":"axes","pitch":-0.7,"roll":0.4,"yaw":0.1,"throttle":0.7}
{"type":"takeoff"}
{"type":"rtl"}
{"type":"cast","on":true}
```

## 使用

直接用浏览器打开 `led-display-studio.html`（大屏）、`sender.html`（投送台）、`wurenji.html`（无人机仿真）与 `wurenji-control.html`（控制台）即可，无需构建。各页预填同一 broker，连接后即可互推；也支持 `?mqtt=<wss地址>` 覆盖、`?mqtt=off` 关闭自动连接。

在线访问（GitHub Pages）：

| 页面 | 地址 |
|---|---|
| 大屏 | `https://sn8388.github.io/led-display-studio/led-display-studio.html` |
| 投送台 | `https://sn8388.github.io/led-display-studio/sender.html` |
| 无人机仿真 | `https://sn8388.github.io/led-display-studio/wurenji.html` |
| 无人机控制台 | `https://sn8388.github.io/led-display-studio/wurenji-control.html` |

## 技术

原生 HTML + CSS + JavaScript（Canvas），无任何第三方依赖。MQTT 3.1.1 客户端为原生 WebSocket 手写实现（CONNECT / SUBSCRIBE / PUBLISH / PING，varint 剩余长度编解码）。

## 文件结构

```
led-display-studio.html   # 大屏主程序（单文件）
sender.html               # 投送台（文字/图片/视频推送）
wurenji.html              # 无人机仿真（GLB + Canvas 3D）
wurenji-control.html      # 无人机地面控制页
mqtt-client.js            # 共享 MQTT 3.1.1 客户端（含分帧缓冲）
drone.glb                 # 程序化生成的 glTF 2.0 无人机模型
drone-data.js             # GLB 的 base64 副本（file:// 兼容）
README.md                 # 本说明
.gitignore
```

## License

MIT
