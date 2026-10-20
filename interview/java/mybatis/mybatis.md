# MyBatis 核心机制：执行链路、#{} vs ${} 与两级缓存

## 题目

> MyBatis 的整体执行流程是怎样的？#{} 和 ${} 有什么区别？MyBatis 有几级缓存，为什么生产环境常关闭二级缓存？动态 SQL 怎么写？MyBatis 和 Hibernate 有什么区别？

## 为什么需要

用原生 JDBC 写查询，等于"从养鸡开始做一顿饭"：

```
一次 JDBC 查询要亲手做：
  ① 加载驱动 ② 拿连接 ③ 拼 SQL ④ setXxx 逐个绑参 ⑤ executeQuery
  ⑥ while(rs.next()) 手动 getString 塞进对象 ⑦ finally 关三个资源
     （关漏一个 = 连接泄漏，线上半夜告警）
```

MyBatis 的定位：**不是全家桶 ORM，而是"半自动 SQL 映射器"**——SQL 仍然自己写（完全可控），连接管理、参数预编译、结果集封装这些"管道活"全交给框架。

```
你负责：  写 SQL + 定义映射规则（resultMap / 驼峰约定）
框架负责：获取释放连接 / #{} 预编译 / Executor 调度 / ResultSet → POJO
```

## 核心要点

### 一、执行链路：谁调用谁（架构位置图）

```
应用代码
   │ ① build
   ▼
SqlSessionFactory ── 重量级单例：整个应用一个（由 mybatis-config.xml 构建）
   │ ② openSession()
   ▼
SqlSession ──────── 轻量级："一次请求一个会话"，非线程安全
   │ ③ getMapper(XxxMapper.class) → 返回 JDK 动态代理对象
   ▼
Executor ────────── 调度中枢：Simple / Reuse / Caching(二级缓存装饰器)
   │ ④ createStatementHandler
   ▼
StatementHandler ── 组装 PreparedStatement
   │      ├─ ParameterHandler：把 #{} 参数 setXxx 绑进去
   │      └─ 执行 SQL
   ▼
     数据库
   │ ⑤ 返回 ResultSet
   ▼
ResultSetHandler ── 按 resultMap / 自动映射规则把行封装成 POJO
   │
   ▼
返回给调用方
```

一句话链路：**工厂造会话，会话委托执行器，执行器用 StatementHandler 管"进去"（参数），用 ResultSetHandler 管"出来"（结果）。**

### 二、#{} vs ${}：预编译与拼接

| 维度 | `#{}` | `${}` |
| --- | --- | --- |
| 本质 | JDBC 占位符 `?`，PreparedStatement 绑参 | 字符串拼接，SQL 构建期直接替换 |
| 时机 | 执行时 setXxx | 解析 XML / 生成动态 SQL 时 |
| SQL 注入 | 免疫（参数被当作纯值，不改语句结构） | **有风险** |
| 类型处理 | 自动按 JavaType/JdbcType 转换 | 无，全按字符串拼 |
| 适用场景 | 一切普通字段传值 | 动态表名、列名、ORDER BY 方向——占位符做不到的语法位 |

```java
// #{}：JDBC 最终看到 SELECT * FROM orders WHERE user_id = ?  → setLong(1, uid)
// ${}：JDBC 最终看到 SELECT * FROM orders ORDER BY create_time DESC（直接拼死）
```

注入演示——为什么 `${}` 危险：

```
正常输入：userId = 1001      → WHERE id = 1001           ✓
恶意输入：userId = 1 OR 1=1  → WHERE id = 1 OR 1=1       ✗ 整表数据泄露
（#{} 时恶意串只会作为"一个字符串值"绑进 ?，改变不了语句结构）
```

结论：**默认一律 #{}；必须用 ${} 时（如排序列名），先在代码里做白名单校验**（sortField 必须属于 {create_time, amount, id}）。

### 三、一级缓存（SqlSession 级，默认开启）

本质是 `DefaultSqlSession` 内部的一个 `HashMap`，key = `statementId + rowBounds + SQL + 参数值`。

失效场景：① 会话内发生增删改（清空整个一级缓存）；② 跨会话不共享；③ 查询条件不同（key 不同，天然不命中）。

**双会话并发时间线（演示缓存不共享与脏读）**：

```
共享状态：无 —— s1、s2 各持自己的缓存 Map，互相不可见

t1  T1: openSession → s1.selectUser(1) → s1 缓存 miss → 查库
        s1.cache = {user:1 → 张三}
t2  T2: openSession → s2.selectUser(1) → s2 缓存 miss（看不见 s1 的）→ 又查一次库
        s2.cache = {user:1 → 张三}          ← 同一条数据查了两遍
t3  T1: s1.updateUser(1, "张三Jr.") → 增删改动作 → s1.clearCache()
        s1.cache = {}                        ← 一级缓存被整体清空
t4  T1: s1.selectUser(1) → miss → 再查库，拿到"张三Jr."
t5  T2: s2.selectUser(1) → s2 缓存里还是旧值"张三" → 直接返回
        ← 脏读！会话之间无法互相通知失效，所以一级缓存只敢在会话内短暂存在
```

Spring 整合下的现实：无事务时每次 Mapper 调用各开各的 SqlSession → 一级缓存基本无效；开了事务同一事务复用同一 SqlSession → 事务内生效。

### 四、二级缓存（Namespace 级，默认关闭）

开启条件：全局开关 `cacheEnabled=true` + mapper.xml 里 `<cache/>` + POJO 实现 Serializable。架构上是 `CachingExecutor` 用**装饰器模式**包在真正的 Executor 外面。

**双 Namespace 脏读时间线**：

```
order 与 user 属于两个 namespace，各有一份二级缓存

t1  T1: orderNs.selectOrderDetail(7) → miss → 查库（结果里带用户名"张三"）
        orderNs 缓存 = {order:7 → 快照(张三)}
t2  T2: userNs.updateUser(1, "张三Jr.") → 只清 userNs 自己的缓存
        orderNs 缓存原封不动 ← 跨 namespace 的失效不会联动！
t3  T1: 再次 orderNs.selectOrderDetail(7) → 命中二级缓存
        返回"张三"，而库里已是"张三Jr." → 脏读
```

生产环境常关闭的三个原因：

1. **多表关联脏读**：失效粒度是整个 namespace，关联数据无法精确失效（上面时间线）。
2. **进程本地缓存**：JVM A 的二级缓存感知不到 JVM B 对库的修改，集群部署必然出现各节点缓存不一致。
3. **有更可控的替代**：Redis 集中缓存 + 统一失效策略，远比 mapper 级缓存好治理。

### 五、动态 SQL

```xml
<select id="search" resultType="com.demo.Order">
    SELECT * FROM orders
    <where>  <!-- 有内容才拼 WHERE，并自动去掉开头多余的 AND -->
        <if test="status != null">
            AND status = #{status}
        </if>
        <if test="minAmount != null">
            AND amount &gt;= #{minAmount}
        </if>
        <if test="ids != null and ids.size() > 0">
            AND id IN
            <foreach collection="ids" item="id" open="(" separator="," close=")">
                #{id}
            </foreach>
        </if>
    </where>
    <!-- 排序列名不能用占位符，只能 ${} + 代码层白名单校验 -->
    ORDER BY ${sortField} ${sortDir}
</select>
```

| 标签 | 作用 |
| --- | --- |
| `<if>` | 条件片段 |
| `<where>` | 有内容才加 WHERE，去头部 AND/OR |
| `<foreach>` | 集合遍历：IN 列表、批量 INSERT VALUES |
| `<choose>/<when>/<otherwise>` | 互斥多分支（相当于 switch-case） |
| `<set>` | UPDATE 用，自动去掉末尾逗号 |
| `<sql>/<include>` | SQL 片段复用 |

### 六、MyBatis vs Hibernate

| 维度 | MyBatis | Hibernate/JPA |
| --- | --- | --- |
| 抽象层级 | 半自动映射：SQL 自己写 | 全自动映射：对象 ↔ 表 |
| SQL 控制力 | 精确到列与执行计划，易优化 | 框架生成，干预难 |
| 上手成本 | 低（会 SQL 就行） | 高（缓存/懒加载/N+1 全是坑） |
| 可移植性 | 差（方言 SQL 绑死数据库） | 好（自动方言翻译） |
| 适用场景 | 互联网复杂查询、性能敏感系统 | 快速 CRUD、领域模型驱动的项目 |

## 面试答法

### 30 秒版（直接背诵）

> MyBatis 的执行链路是 SqlSessionFactory 造 SqlSession，SqlSession 委托 Executor，Executor 用 StatementHandler 完成参数绑定和 SQL 执行，用 ResultSetHandler 完成结果映射。#{} 是预编译占位符能防 SQL 注入，${} 是字符串拼接有注入风险，只用在动态表名、列名、ORDER BY 这种占位符做不了的语法位，且必须白名单校验。缓存分两级：一级是 SqlSession 级默认开启，增删改会清空、跨会话不共享；二级是 namespace 级默认关闭，存在多表关联脏读和跨进程不一致，生产常关掉改用 Redis。相比 Hibernate，MyBatis 是"SQL 自己写、可控性强"，更适合互联网性能敏感场景。

### 深入版（被追问时按这条线展开）

1. **定位**：半自动 SQL 映射器——SQL 归你，管道活归框架
2. **链路**：Factory → Session → Executor → StatementHandler(ParameterHandler) → ResultSetHandler，各一句话职责
3. **#{} vs ${}**：预编译 vs 拼接，给注入演示，讲清 ORDER BY 为什么只能 ${}
4. **一级缓存**：会话级 HashMap、三个失效场景、双会话时间线（不共享 + 脏读）
5. **二级缓存**：namespace 级、装饰器实现、脏读时间线、生产关闭三理由
6. **动态 SQL**：where 去头 AND、foreach 拼 IN、${} 白名单
7. **对比 Hibernate**：SQL 控制力、上手成本、可移植性

### 常见追问

- **Mapper 接口没有实现类为什么能用？** → JDK 动态代理：getMapper 返回 MapperProxy，invoke 里用"接口全名+方法名"拼出 statementId 去查 MappedStatement 执行 SQL。
- **SqlSession 为什么不是线程安全的？** → 内部缓存 HashMap 和事务状态无锁保护，并发共用会互相清缓存、脏读（见双会话时间线）；Spring 用线程安全的 SqlSessionTemplate，按线程路由会话。
- **二级缓存为什么要求对象可序列化？** → 缓存存的是序列化副本，防止调用方拿到引用后修改对象、污染缓存里的数据。
- **同一条 SQL 不同参数会命中一级缓存吗？** → 不会：缓存 key 包含参数值和 rowBounds，条件不同 key 就不同。
- **`<if test>` 传 null 会怎样？** → OGNL 表达式 `name != null` 为 false 直接跳过；注意 String 判空要写 `test="name != null and name != ''"`，只写后者遇 null 会报错。
- **增删改会清二级缓存吗？** → 只清自己 namespace 的缓存，其他 namespace 里关联的数据不受影响——这正是脏读的根源。
