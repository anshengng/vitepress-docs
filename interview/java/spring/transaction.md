# Spring 事务失效场景

## 题目

> @Transactional 在哪些情况下会失效？事务传播行为了解哪些？REQUIRES_NEW 和 NESTED 有什么区别？

## 原理先行：一句话

**@Transactional 靠 AOP 代理包裹方法实现**：代理先开启事务 → 调目标方法 → 正常返回则提交、抛出符合条件的异常则回滚。**失效只归两类：① 代理没生效（调用绕过了代理）；② 回滚条件不满足。**

```
调用方 ──► 代理对象 ──► 原始对象（你的业务代码）
             ├─ ① 开启事务：取连接、setAutoCommit(false)，事务上下文绑定 ThreadLocal
             ├─ ② 执行目标方法
             ├─ ③a 正常返回 → commit
             └─ ③b 抛出"默认回滚"的异常 → rollback
```

## 核心要点

### 失效场景逐条清单

#### ① 方法不是 public

```java
@Transactional
private void doSave() ...   // ❌ JDK 代理拦不到，CGLIB 无法重写 private
// 修复：改成 public
```

#### ② 同类内部 this 调用（最高频考点）

事务逻辑长在**代理对象**身上，`this.b()` 走的是原始对象，绕过了代理：

```
调用方 ──► 代理对象.a() ✅ 事务在这里开启
              │
              ▼
          原始对象.a()
              │  this.b()  ◄── this 是【原始对象】，不是代理！
              ▼
          原始对象.b() ❌ 绕过代理，事务逻辑完全没执行
```

```java
@Service
public class OrderService {
    public void a() { this.b(); }   // ❌ this 是原始对象，等价于绕过代理直接调 b()
    @Transactional public void b() ...
}
```

修复三选一：**注入自身代理**（`@Autowired @Lazy` 注入 self 后调 `self.b()`，推荐）/ **AopContext.currentProxy()**（需开启 `exposeProxy = true`）/ **把 b() 拆到另一个 Bean**（结构最清晰）。

#### ③ 异常被 try-catch 吞掉

```java
@Transactional
public void save() {
    try { dao.update(); }
    catch (Exception e) { log.error("失败", e); }  // ❌ 异常没传到代理手里 → commit
}   // 修复：重新抛出；或手动 setRollbackOnly() 标记回滚
```

#### ④ 抛 checked 异常默认不回滚

```java
@Transactional
public void save() throws Exception {
    dao.update();
    throw new Exception();   // ❌ 默认只回滚 RuntimeException / Error
}
// 修复：@Transactional(rollbackFor = Exception.class)
```

#### ⑤ 多线程内执行（事务上下文绑定 ThreadLocal）

```
事务上下文（连接 + 事务状态）绑定 ThreadLocal，只对当前线程可见
时刻   主线程（有事务上下文）              子线程（全新 ThreadLocal，为空）
 t1    代理开启事务 T                      ─
 t2    save() 开始执行
 t3    提交任务到线程池 ──────────────►   子线程执行 dao.update()
                                           ↓ 从连接池另拿一个连接（自动提交）
 t4    save() 正常返回
 t5    代理 commit ✅                      子线程的操作根本不在 T 里
（子线程抛异常也只打在线程栈里，主线程的代理感知不到）
```

```java
@Transactional
public void save() {
    new Thread(() -> dao.update()).start();   // ❌ 子线程不在当前事务
}   // 修复：子线程单独开事务；或改串行执行；跨线程一致性用编程式事务/补偿
```

#### ⑥ 传播行为配错

```java
@Transactional
public void save() { b(); }   // b 配了 NOT_SUPPORTED → 非事务方式运行，b 出错不会回滚 save
@Transactional(propagation = Propagation.NOT_SUPPORTED)
public void b() ...
```

#### ⑦ 类没被 Spring 管理　⑧ 数据库引擎不支持

```java
OrderService svc = new OrderService();  // ❌ new 出来的是原始对象，压根没有代理层
                                         //    @Transactional 只是普通注解，无人处理
```

顺带：final / static 方法 CGLIB 无法重写，同样代理不了；MyISAM 不支持事务（rollback 是空操作）→ 建表用 InnoDB。

### 传播行为 7 种速查表

| 传播行为 | 外层有事务时 | 外层没事务时 |
| --- | --- | --- |
| REQUIRED（默认） | 加入当前事务 | 新建事务 |
| REQUIRES_NEW | 挂起当前，另开独立事务 | 新建事务 |
| NESTED | 当前事务内建 savepoint 嵌套 | 新建事务 |
| SUPPORTS | 加入当前 | 非事务运行 |
| NOT_SUPPORTED | 挂起当前，非事务运行 | 非事务运行 |
| MANDATORY | 加入当前 | 抛异常 |
| NEVER | 抛异常 | 非事务运行 |

### 重点三兄弟对比图解（REQUIRED / REQUIRES_NEW / NESTED）

```
REQUIRED 合一（同一事务）          REQUIRES_NEW 另开（两个连接）      NESTED 嵌套（同连接 savepoint）
外层A ┌─────────────────┐        外层A ┌──┐挂起┌─新B─┐┌──┐        外层A ┌─────────────────┐
      │  … 内层（同一事务）│              │  │    │    ││  │              │ … ◆savepoint◆ …  │
      └─────────────────┘              └──┘    └────┘└──┘              └─────────────────┘
```

**分别回滚时，另一个受不受影响？逐个推演：**

REQUIRED：

```
时刻   外层A                    内层（REQUIRED 加入A）     事务T1
 t1    begin                                                  开启
 t2    执行…                   执行…                       T1
 t3                              抛异常！                   T1 被标记 rollback-only
 t4    catch 住，想"只回滚内层"？  ——晚了，同一个事务         T1
 t5    提交 → UnexpectedRollbackException，整体回滚 ❌
 结论：一根绳上的蚂蚱，内层炸了外层也保不住（catch 都救不回）
```

REQUIRES_NEW：

```
时刻   外层A                    内层（REQUIRES_NEW）         事务
 t1    begin T1（连接1）                                        T1
 t2                              begin T2（挂起T1，占连接2）   T2
 t3                              内层抛异常 → T2 回滚          T2 回滚
 t4    catch 住异常，A 继续执行                                  T1 存活
 t5    A 正常提交 ✅
 结论：T2 回滚不影响 T1（外层 catch 住即可）；典型场景：操作日志，成败都要留痕
```

NESTED：

```
时刻   外层A                    内层（NESTED）               事务
 t1    begin T1                                                T1
 t2                              在 T1 内打 savepoint S        T1（同连接）
 t3                              内层抛异常 → 回滚到 S          只撤销 S 之后的操作
 t4    catch 住，A 继续执行 → 提交 T1 ✅
 若反过来外层回滚：内层的"提交"没真提交，随 T1 一起回滚
 结论：内层可单独回滚；外层回滚必带走内层（内层没有独立提交能力）
```

| | REQUIRED | REQUIRES_NEW | NESTED |
| --- | --- | --- | --- |
| 事务/连接个数 | 1 个 | 2 个 | 1 个（savepoint） |
| 内层回滚 → 外层 | 跟着回滚（rollback-only） | 不受影响（catch 即可） | 不受影响（回滚到存档点） |
| 外层回滚 → 内层 | 一起回滚 | 不受影响（内层已真提交） | 一起回滚（没真提交过） |

## 面试答法

### 30 秒版（可背诵）

> 事务失效归根结底两类原因。一是代理没生效：非 public 方法、同类 this 自调用、对象是 new 出来的而不是容器管理的 Bean、final 或 static 方法代理不了。二是回滚条件不满足：异常被 try-catch 吞了，或者抛的是 checked 异常默认不回滚，要加 rollbackFor。另外两个隐蔽的：多线程场景事务上下文绑定 ThreadLocal，子线程不在事务里；MyISAM 引擎根本不支持事务。传播行为重点记三个：REQUIRED 内外同一个事务一起死；REQUIRES_NEW 是挂起外层、另开一个连接的独立事务，内层真提交后外层回滚不影响它；NESTED 是同一个事务里打 savepoint，内层能单独回滚，但外层回滚会带走内层。

### 深入版（被追问时按这条线展开）

1. **原理定调**：@Transactional = AOP 代理包裹，失效只有"绕过代理"和"回滚条件不满足"两个根因
2. **高频场景**：画 this 自调用的代理调用图（事务在代理层，this 走原始对象），给三种修复
3. **回滚类**：吞异常、checked 异常，默认只回滚 RuntimeException / Error
4. **隐蔽场景**：ThreadLocal 隔离导致多线程失效，画两线程时间线
5. **传播行为**：报 7 种速查表，再用三兄弟"内层/外层分别回滚"的时间线讲透，收尾给对比表

### 常见追问

- **自调用为什么失效？怎么修？** → 事务逻辑在代理对象里，this 调的是原始对象；修复：注入自身代理 / AopContext / 拆类
- **REQUIRES_NEW 和 NESTED 的本质区别？** → 前者另开连接、内层是真提交；后者是同连接 savepoint，内层"提交"不作数
- **REQUIRED 内层回滚，外层 catch 了为什么还报错？** → 内层已把共享事务标记 rollback-only，外层 commit 只能回滚并抛 UnexpectedRollbackException
- **REQUIRES_NEW 有什么坑？** → 同时占两个连接，高并发下可能耗尽连接池，甚至互相持锁死锁
- **怎么避免大事务？** → 只标在必要的窄方法上；查询、RPC、文件 IO 移出事务；必要时用编程式事务精确控制边界
