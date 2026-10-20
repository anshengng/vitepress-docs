---
title: UWB 坯车定位对接方案
---

# UWB 坯车定位对接方案（沃旭引擎 + Spring Boot + WebSocket）

## 1. 需求与目标

- 场景：一个房间内多台坯车，每台坯车有号码牌，标签与号码牌绑定；
- 目标 1：**实时位置**——在房间平面图上显示每台坯车当前位置；
- 目标 2：**历史路线**——按号码牌 + 时间段查询并回放该坯车的移动轨迹；
- 技术栈：Spring Boot 3 + MySQL + WebSocket，前端 Vue/原生均可。

## 2. 总体架构

```
坯车标签(绑号码牌) ─┐
                    ├─ UWB测距 → 基站×4 → LS-1000引擎解算坐标 ─ WS/MQTT ─> Spring Boot
房间平面图标定 ─────┘                                                            │
                                                        ┌──────────────────────┼─────────────┐
                                                        │ 过滤(静止/抖动)      │ 实时转发     │ 攒批
                                                        v                      v             v
                                                  MySQL uwb_track      WebSocket推送      每秒批量INSERT
                                                                               │             │
                                                                               v             v
                                                                     前端实时位置画面    前端轨迹回放
```

## 3. 先明确三个事实（影响所有设计）

1. 引擎按**固定频率持续推送**（典型 1~10 Hz），标签静止也照推，不存在"移动才推"。轨迹抽取必须靠后端过滤。
2. 每条推送**必带标签 ID**（如 `cardId`），号码牌通过映射表关联。
3. 你拿到的是**解算好的坐标 (x,y)**，不需要接触原始测距和三边计算。

## 4. 硬件部署与验收（厂商实施，你验收）

| 项 | 要求 |
|---|---|
| 标签 | 每台坯车 1 个，安装位置固定（防与号码牌分离），登记 tagId ↔ 号码牌 |
| 基站 | 每房间 ≥4 个，高位 2.5~3 m 安装，与坯车保持视距，避开钢坯垛遮挡 |
| 基站坐标 | 现场实测录入引擎（这步精度决定上限） |
| 验收标准 | 引擎管理地图上每个标签点连续、不跳变、无长时间丢失 |

## 5. 向沃旭索取的对接材料

开工前必须拿到：

1. 《第三方系统对接文档》（开放接口文档）；
2. 接口地址：WebSocket 或 MQTT broker 的 IP/端口、topic/endpoint；
3. 鉴权方式（账号/token）；
4. **JSON 字段字典**：标签ID、x、y、时间戳对应的字段名；
5. 推送形态：一条消息一个标签，还是全场标签打包；推送频率多少 Hz；
6. 决策点：若已购 WPAS 平台的"轨迹存储与回放"模块，历史轨迹可直接调平台 HTTP 接口，本方案的自建入库可省略或并存。

## 6. 数据库设计

```sql
-- 轨迹点表：历史路线的数据源
CREATE TABLE uwb_track (
  id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tag_id  VARCHAR(32)  NOT NULL COMMENT '标签ID',
  x       DECIMAL(8,3) NOT NULL COMMENT '引擎坐标x,米',
  y       DECIMAL(8,3) NOT NULL COMMENT '引擎坐标y,米',
  ts      DATETIME(3)  NOT NULL COMMENT '定位时间戳',
  KEY idx_tag_ts (tag_id, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='坯车轨迹点';

-- 号码牌映射表
CREATE TABLE uwb_tag_bind (
  tag_id   VARCHAR(32) PRIMARY KEY,
  plate_no VARCHAR(32) NOT NULL COMMENT '坯车号码牌',
  room_id  VARCHAR(16) COMMENT '房间/区域编号'
);
```

`idx_tag_ts` 专为回放查询服务：`WHERE tag_id=? AND ts BETWEEN ? AND ?` 走索引顺序扫出轨迹。

## 7. 后端实现（Spring Boot 3）

### 7.1 依赖（pom.xml）

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-websocket</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-jdbc</artifactId>
</dependency>
<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
    <scope>runtime</scope>
</dependency>
```

### 7.2 配置（application.yml）

```yaml
spring:
  datasource:
    # rewriteBatchedStatements=true 必须加，批量插入性能差一个数量级
    url: jdbc:mysql://localhost:3306/uwb?rewriteBatchedStatements=true&serverTimezone=Asia/Shanghai
    username: root
    password: xxx

uwb:
  engine-url: ws://192.168.1.100:8080/ws/position   # 按沃旭文档填
```

启动类加 `@EnableScheduling`。

### 7.3 坐标点对象

```java
public record UwbPoint(String tagId, double x, double y, long ts) {}
```

### 7.4 引擎接入客户端（WebSocket + 断线重连）

```java
@Component
public class UwbEngineClient {

    private static final Logger log = LoggerFactory.getLogger(UwbEngineClient.class);

    private final TrackService trackService;
    private final ObjectMapper om;
    private final WebSocketClient client = new StandardWebSocketClient();
    private volatile WebSocketSession session;

    @Value("${uwb.engine-url}")
    private String engineUrl;

    public UwbEngineClient(TrackService trackService, ObjectMapper om) {
        this.trackService = trackService;
        this.om = om;
    }

    @PostConstruct
    public void connect() {
        try {
            session = client.execute(new TextWebSocketHandler() {
                @Override
                public void handleTextMessage(WebSocketMessage<?> msg) {
                    trackService.accept(parse(msg.getPayload().toString()));
                }
                @Override
                public void afterConnectionClosed(WebSocketSession s, CloseStatus status) {
                    log.warn("引擎连接断开: {}", status);
                }
            }, engineUrl).get();
            log.info("已连接引擎 {}", engineUrl);
        } catch (Exception e) {
            log.warn("连接引擎失败: {}", e.getMessage());
        }
    }

    /** 字段解析单独隔离：沃旭文档到手后只改这个方法 */
    private UwbPoint parse(String json) {
        try {
            JsonNode n = om.readTree(json);
            return new UwbPoint(
                    n.get("cardId").asText(),
                    n.get("coordX").asDouble(),
                    n.get("coordY").asDouble(),
                    n.get("timestamp").asLong());
        } catch (Exception e) {
            log.warn("解析失败: {}", json);
            return null;
        }
    }

    /** 每5秒检查连接，断开自动重连 */
    @Scheduled(fixedDelay = 5000)
    public void keepAlive() {
        if (session == null || !session.isOpen()) {
            connect();
        }
    }
}
```

### 7.5 核心处理：过滤 + 攒批入库 + 实时转发

```java
@Service
public class TrackService {

    private static final Logger log = LoggerFactory.getLogger(TrackService.class);
    private static final double MIN_MOVE = 0.15;  // 米，位移小于阈值不落库

    private final JdbcTemplate jdbc;
    private final PositionWsHandler wsHandler;
    private final ObjectMapper om;
    private final BlockingQueue<UwbPoint> queue = new LinkedBlockingQueue<>(10_000);
    private final Map<String, UwbPoint> lastSaved = new ConcurrentHashMap<>();

    public TrackService(JdbcTemplate jdbc, PositionWsHandler wsHandler, ObjectMapper om) {
        this.jdbc = jdbc;
        this.wsHandler = wsHandler;
        this.om = om;
    }

    public void accept(UwbPoint p) {
        if (p == null) return;
        wsHandler.broadcast(toJson(p));            // 1. 实时推前端，不过滤
        UwbPoint last = lastSaved.get(p.tagId());
        if (last != null && Math.hypot(p.x() - last.x(), p.y() - last.y()) < MIN_MOVE) {
            return;                                 // 2. 静止/微抖，不落库
        }
        lastSaved.put(p.tagId(), p);
        queue.offer(p);                             // 3. 进待写队列
    }

    /** 每秒攒批插入，别一条一提交 */
    @Scheduled(fixedDelay = 1000)
    public void flush() {
        List<UwbPoint> batch = new ArrayList<>();
        queue.drainTo(batch, 500);
        if (batch.isEmpty()) return;
        jdbc.batchUpdate(
                "INSERT INTO uwb_track(tag_id,x,y,ts) VALUES (?,?,?,?)",
                batch, 200,
                (ps, p) -> {
                    ps.setString(1, p.tagId());
                    ps.setDouble(2, p.x());
                    ps.setDouble(3, p.y());
                    ps.setTimestamp(4, new Timestamp(p.ts()));
                });
    }

    private String toJson(UwbPoint p) {
        try {
            return om.writeValueAsString(Map.of(
                    "tagId", p.tagId(), "x", p.x(), "y", p.y(), "ts", p.ts()));
        } catch (Exception e) {
            return "{}";
        }
    }
}
```

### 7.6 前端实时推送的 WebSocket 服务端

```java
@Component
public class PositionWsHandler extends TextWebSocketHandler {

    private final CopyOnWriteArrayList<WebSocketSession> sessions = new CopyOnWriteArrayList<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.add(session);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session);
    }

    public void broadcast(String json) {
        TextMessage msg = new TextMessage(json);
        for (WebSocketSession s : sessions) {
            if (s.isOpen()) {
                try { s.sendMessage(msg); } catch (Exception ignore) { }
            }
        }
    }
}
```

```java
@Configuration
public class WebSocketConfig implements WebSocketConfigurer {

    private final PositionWsHandler positionWsHandler;

    public WebSocketConfig(PositionWsHandler positionWsHandler) {
        this.positionWsHandler = positionWsHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(positionWsHandler, "/ws/position").setAllowedOrigins("*");
    }
}
```

### 7.7 回放查询与映射接口

```java
@RestController
@RequiredArgsConstructor
public class TrackController {

    private final JdbcTemplate jdbc;

    /** 轨迹回放：前端拿到点列直接画 polyline */
    @GetMapping("/api/track")
    public List<Map<String, Object>> history(
            @RequestParam String tagId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime start,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime end) {
        return jdbc.queryForList(
                "SELECT tag_id,x,y,ts FROM uwb_track WHERE tag_id=? AND ts BETWEEN ? AND ? ORDER BY ts",
                tagId, Timestamp.valueOf(start), Timestamp.valueOf(end));
    }

    /** 号码牌映射，前端翻译 tagId -> 牌号的缓存数据源 */
    @GetMapping("/api/tag/list")
    public List<Map<String, Object>> tags() {
        return jdbc.queryForList("SELECT tag_id,plate_no,room_id FROM uwb_tag_bind");
    }
}
```

### 7.8 数据保留任务

```java
@Component
@RequiredArgsConstructor
public class TrackCleanJob {

    private final JdbcTemplate jdbc;

    /** 每天凌晨3点删90天前数据，分批删避免大事务 */
    @Scheduled(cron = "0 0 3 * * ?")
    public void clean() {
        int deleted;
        do {
            deleted = jdbc.update(
                    "DELETE FROM uwb_track WHERE ts < NOW() - INTERVAL 90 DAY LIMIT 5000");
        } while (deleted > 0);
    }
}
```

数据量再大改为按月分区（`PARTITION BY RANGE (TO_DAYS(ts))`），删旧数据变成 `DROP PARTITION`。

## 8. Mock 引擎（无硬件先跑通全链路）

```python
# 运行: pip install websockets && python mock_engine.py
# 模拟沃旭引擎 5Hz 推送坐标，字段名与 7.4 parse() 对应
import asyncio, json, math, time, websockets

TAGS = [f"T{i:03d}" for i in range(1, 6)]

async def handler(ws):
    while True:
        for i, tid in enumerate(TAGS):
            x = 5 + 3 * math.sin(time.time() / 5 + i)
            y = 4 + 2 * math.cos(time.time() / 5 + i)
            await ws.send(json.dumps({
                "cardId": tid,
                "coordX": round(x, 3),
                "coordY": round(y, 3),
                "timestamp": int(time.time() * 1000)}))
        await asyncio.sleep(0.2)   # 5Hz

async def main():
    async with websockets.serve(handler, "0.0.0.0", 9000):
        print("mock engine: ws://localhost:9000")
        await asyncio.Future()

asyncio.run(main())
```

把 `uwb.engine-url` 指到 `ws://localhost:9000` 即可全链路自测。

## 9. 前端

### 9.1 实时位置

```javascript
const mapImg = document.getElementById('map');       // 房间平面图底图
const canvas = document.getElementById('overlay');   // 叠加绘制层
const ctx = canvas.getContext('2d');
const plates = {};                                    // tagId -> 号码牌

fetch('/api/tag/list').then(r => r.json()).then(list =>
    list.forEach(t => plates[t.tag_id] = t.plate_no));

// 引擎坐标 -> 平面图像素（标定方法见 9.3）
const cal = { sx: 40, sy: 40, ox: 60, oy: 80 };
const toPixel = p => ({ x: p.x * cal.sx + cal.ox, y: p.y * cal.sy + cal.oy });

const ws = new WebSocket(`ws://${location.hostname}:8080/ws/position`);
ws.onmessage = e => {
    const p = JSON.parse(e.data);
    const px = toPixel(p);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f6';
    ctx.beginPath();
    ctx.arc(px.x, px.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#333';
    ctx.fillText(plates[p.tagId] || p.tagId, px.x + 8, px.y);
};
```

### 9.2 历史路线回放

```javascript
async function replay(tagId, start, end) {
    const url = `/api/track?tagId=${tagId}&start=${start}&end=${end}`;
    const points = (await (await fetch(url)).json()).map(toPixel);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#e33';
    ctx.beginPath();
    points.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
    ctx.stroke();
}
```

需要动画回放时，加一个时间滑块：按 `ts` 逐点 `lineTo` 重绘即可。

### 9.3 坐标对齐平面图

引擎坐标原点和方向与图纸无关，需标定。取 2 个以上已知位置的标定点（现场把标签放到图纸上已知点，记录引擎输出）：

```javascript
// 标定点: 引擎坐标(e1,e2) 对应 平面图像素(p1,p2)，均匀缩放场景
// sx = (p2.x - p1.x) / (e2.x - e1.x)，oy 同理；取平均更稳
// ox = p1.x - e1.x * sx,  oy = p1.y - e1.y * sy
// 若两轴比例不一致或存在旋转，用三点标定做仿射变换
```

## 10. 联调步骤

1. 跑 mock 脚本 → 启动 Spring Boot → 控制台/前端能看到 5Hz 坐标流；
2. 验证落库策略：静止标签不产生新行，移动标签每秒内有少量轨迹点；
3. 调 `/api/track` 能按时间段取回有序点列，前端画出 polyline；
4. 拿到沃旭文档后：改 `engine-url` + `parse()` 字段名，切真实数据；
5. 现场部署后重点观察金属多径造成的跳点，必要时在 `accept()` 里加移动平均/Kalman 平滑后再入库。

## 11. 检查清单

- [ ] 基站全部在线，标签在引擎地图上有连续轨迹
- [ ] tagId ↔ 号码牌映射表录入完整
- [ ] JDBC URL 含 `rewriteBatchedStatements=true`
- [ ] 引擎服务器与 Spring Boot 服务器 NTP 对时（否则回放错乱）
- [ ] WebSocket 断线自动重连生效（拔网线测试）
- [ ] 平面图坐标标定完成，前端点位与实际一致
- [ ] 数据清理任务 / 分区策略已配置

## 12. 常见坑

| 坑 | 后果 | 对策 |
|---|---|---|
| 逐条 INSERT | 高频推送下数据库写爆 | 攒批 + rewriteBatchedStatements |
| 不做静止过滤 | 库里 90% 是无效重复点 | 位移阈值丢弃（实时推送不过滤，仅落库过滤） |
| 时间不对齐 | 回放时序错乱 | 全链路 NTP，统一用引擎时间戳 |
| 金属多径 | 坐标毛刺、跳变 | 基站高位视距安装 + 入库前平滑 |
| 假设"移动才推送" | 轨迹理解错误 | 引擎永远持续推送，过滤是自己的事 |
