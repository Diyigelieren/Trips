# Trips

一个基于 **GitHub Pages + Leaflet** 的个人旅行攻略站。

项目以静态页面为主，将每次旅行独立组织为一个 Trip 页面，并提供地图路线、分日行程、关键停靠点、补能策略、住宿/景观信息以及移动端适配。公共地图能力尽量抽象到 `assets/` 下复用，新增旅行时主要维护行程页面和配置数据。

## 在线访问

- 站点首页：<https://diyigelieren.github.io/Trips/>
- 川西 4 天 3 晚：<https://diyigelieren.github.io/Trips/trips/chuanxi-4d3n/>

## 当前功能

- 多 Trip 首页：通过 `trips.json` 统一维护旅行元数据并自动生成首页卡片
- 独立旅行页面：每个旅行使用 `trips/<trip-id>/index.html` 作为唯一入口
- Leaflet 地图：支持拖动、缩放、Marker、Popup 和分日路线查看
- 分日路书：支持 `全程 / D1 / D2 / ...` 路线切换和自动适应视野
- RouteBook 路线层：统一处理路线样式、方向提示、选中高亮和道路 Geometry 增强
- 路线渐进增强：本地途经点立即显示，随后可升级为贴合实际道路的 Geometry
- 路线缓存：在线路由结果可缓存到浏览器，降低重复请求
- 行程信息：支持分日时间线、SOC/补能节奏、住宿、景点和驾驶提示
- 响应式布局：桌面、平板和手机均可使用
- 手机地图图例：默认收起，可通过左下角图层按钮展开
- 细粒度地图缩放：针对鼠标滚轮和触控板降低缩放步长
- 无构建流程：纯 HTML / CSS / JavaScript，可直接通过 GitHub Pages 发布

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 页面 | HTML / CSS / JavaScript |
| 地图 | Leaflet 1.9.4 |
| 底图 | OpenStreetMap |
| 路线增强 | RouteBookLayer |
| 道路 Geometry | OSRM（可选）/ 静态 GeoJSON |
| 托管 | GitHub Pages |

## 项目结构

```text
Trips/
├── README.md
├── index.html                    # 旅行站首页
├── trips.json                    # Trip 元数据索引
│
├── assets/
│   └── routebook/
│       ├── route-book.js         # 可复用 RouteBook 路线渲染器
│       ├── route-book.css        # RouteBook 公共样式
│       └── README.md             # RouteBook 组件说明
│
└── trips/
    └── chuanxi-4d3n/
        ├── index.html            # 川西攻略页面唯一入口
        ├── route-book.json       # 路线点位及 RouteBook 配置
        ├── premium.css           # 桌面/整体视觉样式
        ├── mobile.css            # 手机和平板响应式样式
        └── legend-toggle.css     # 手机图层展开/收起样式
```

页面采用 **单 `index.html` 入口**。Trip 内不再额外维护 iframe 或 `app.html`。

## 页面架构

一个 Trip 页面大致分为四层：

```text
Trip 页面
   │
   ├── 行程内容
   │   ├── 分日路书
   │   ├── 补能策略
   │   └── 驾驶原则
   │
   ├── Leaflet 地图
   │   ├── OSM 底图
   │   ├── 景点 / 充电 / 住宿 Marker
   │   └── Popup / Tooltip
   │
   ├── route-book.json
   │   ├── points
   │   ├── routes
   │   └── router 配置
   │
   └── assets/routebook/
       └── RouteBookLayer
```

Trip 负责“这次旅行是什么”，公共 RouteBook 负责“路线应该怎么画”。

## RouteBook 路线机制

RouteBookLayer 位于：

```text
assets/routebook/
```

它负责通用地图路线能力，包括：

- 路线主线与描边
- 方向箭头
- 分日路线选择
- 非当前路线淡化
- 地图缩放后路线装饰重新布局
- 静态 GeoJSON 加载
- 在线道路 Geometry 获取
- 浏览器 Geometry 缓存
- 在线路由失败后的本地折线兜底

路线 Geometry 使用渐进增强策略：

```text
打开页面
   ↓
使用本地 waypoint 立即绘制路线
   ↓
存在静态 GeoJSON？ ── 是 ─→ 使用 GeoJSON
   │
   否
   ↓
存在浏览器缓存？ ─── 是 ─→ 使用缓存 Geometry
   │
   否
   ↓
请求道路路由服务
   │
   ├── 成功 → 替换路线 + 写入缓存
   └── 失败 → 保留 waypoint 折线
```

因此道路路由服务不可用时，Trip 页面仍然可以正常展示。

更详细的 RouteBook 配置和 API 说明见：

[`assets/routebook/README.md`](./assets/routebook/README.md)

## 新增一个旅行攻略

例如新增一个 `yunnan-7d`：

### 1. 创建 Trip 目录

```text
trips/yunnan-7d/
├── index.html
└── route-book.json
```

如果需要独立样式，也可以增加：

```text
premium.css
mobile.css
legend-toggle.css
```

### 2. 创建页面

每个 Trip 只使用：

```text
trips/<trip-id>/index.html
```

作为页面入口。

页面中可以继续复用公共 RouteBook：

```html
<link rel="stylesheet" href="../../assets/routebook/route-book.css">
<script src="../../assets/routebook/route-book.js"></script>
```

初始化示例：

```js
const book = await RouteBookLayer.fromConfig({
  map,
  L,
  configUrl: './route-book.json',
  baseUrl: new URL('./', location.href).href
});

await book.init();
book.setActive('all', { fit: true });
```

### 3. 配置路线

`route-book.json` 主要维护：

```json
{
  "points": {
    "起点": [30.0, 104.0],
    "终点": [31.0, 103.0]
  },
  "routes": [
    {
      "id": "d1",
      "name": "D1",
      "title": "起点 → 终点",
      "color": "#4f8cff",
      "waypoints": ["起点", "终点"]
    }
  ]
}
```

数组点位使用 Leaflet 常见的：

```text
[latitude, longitude]
```

如果使用 GeoJSON，则遵循 GeoJSON 标准：

```text
[longitude, latitude]
```

### 4. 注册到首页

在根目录 `trips.json` 中增加一条记录：

```json
{
  "id": "yunnan-7d",
  "title": "云南 7 日",
  "subtitle": "滇西自驾攻略",
  "region": "云南",
  "days": "7天6晚",
  "distance": "约 xxxx km",
  "type": "自驾",
  "route": ["昆明", "大理", "丽江"],
  "url": "./trips/yunnan-7d/"
}
```

首页会读取 `trips.json` 并自动生成 Trip 卡片，无需手动修改首页列表。

## 静态 GeoJSON

正式路线建议逐步将确认过的真实道路 Geometry 固化到仓库：

```text
trips/<trip-id>/
└── routes/
    ├── d1.geojson
    ├── d2.geojson
    └── ...
```

然后在 `route-book.json` 中指定：

```json
{
  "id": "d1",
  "geometryUrl": "./routes/d1.geojson"
}
```

这样页面可以做到：

- 打开即显示真实道路曲线
- 不依赖运行时第三方路由服务
- 路线结果可人工审核和修正
- GitHub Pages 展示更加稳定

## 本地预览

由于页面会通过 `fetch()` 加载 JSON，不建议直接使用 `file://` 打开。

在项目根目录启动一个简单 HTTP Server，例如：

```bash
python3 -m http.server 8000
```

然后访问：

```text
http://localhost:8000/
```

或直接进入某个 Trip：

```text
http://localhost:8000/trips/chuanxi-4d3n/
```

## GitHub Pages 部署

当前项目使用 GitHub Pages 直接托管 `main` 分支根目录。

仓库设置：

```text
Settings
  → Pages
  → Build and deployment
  → Deploy from a branch
  → main
  → /(root)
```

提交到 `main` 后，站点由 GitHub Pages 发布。

## 开发约定

为了让后续 Trip 可以持续复用，建议遵循以下原则：

1. **一个 Trip 一个目录**：`trips/<trip-id>/`
2. **一个 Trip 一个页面入口**：只保留 `index.html`
3. **Trip 数据与公共能力分离**：路线数据放 Trip，路线渲染逻辑放 `assets/`
4. **优先配置而不是复制代码**：新增路线尽量通过 `route-book.json` 描述
5. **移动端优先考虑地图视野**：悬浮控件保持轻量、可折叠
6. **路线展示不代替导航**：实时施工、封路、拥堵和充电状态仍以出发当天导航/车机信息为准
7. **生产路线优先静态化**：经过确认的道路 Geometry 推荐保存为 GeoJSON

## 当前 Trip

### 川西 4 天 3 晚

路线概览：

```text
成都
 → 四姑娘山
 → 丹巴
 → 八美
 → 塔公
 → 新都桥
 → 雅江
 → 理塘
 → 毛垭大草原
 → 康定
 → 成都
```

页面包含：

- 4 天分日路线
- 电车 SOC / 补能节奏
- 景观、住宿、充电 Marker
- G318 / 川西高原驾驶提示
- 桌面与手机响应式地图
- 可折叠路线图层
- RouteBook 路线增强

访问：<https://diyigelieren.github.io/Trips/trips/chuanxi-4d3n/>

---

该项目主要用于沉淀个人旅行路线与行程规划，并持续将重复能力抽象为可复用的静态 Web 组件。
