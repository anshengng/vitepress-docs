# Spring AOP 底层原理

## 题目

> Spring AOP 的实现原理？代理对象是什么时候生成的？五种通知的执行顺序？JDK 和 CGLIB 怎么选？和 AspectJ 什么区别？

## 为什么需要 AOP（一句话）

日志、事务、权限、限流这类逻辑**横跨所有业务方法**，逐个方法手写就是复制粘贴地狱。AOP 把"横切关注点"抽成切面，运行时由容器自动织入代理，业务代码零侵入。

## 核心要点

### 三个核心概念图解

```
Aspect 切面 = 一个 @Aspect 类 = 【切点 + 通知】的清单
             回答两个问题：在哪些方法（WHERE）？什么时候干什么（WHEN + WHAT）？

Pointcut 切点 = 筛子，圈定"哪些方法"（如 execution(* com.x.service.*.*(..))）
Advice  通知  = 动作，规定"什么时候干什么"（方法前 / 后 / 环绕）

              全部方法（一片稻草堆）
 ┌──────────────────────────────────────┐
 │   ◎ 被切点筛中的目标方法 ◎            │ ← Pointcut 负责"筛"
 │      @Before          进门之前干…     │
 │      @Around          前后整个包住…   │ ← Advice 负责"干"
 │      @AfterReturning  出门之后干…     │
 └──────────────────────────────────────┘
```

| 通知 | 时机 | 典型用途 |
| --- | --- | --- |
| @Before | 目标方法前 | 权限校验、参数检查 |
| @AfterReturning | 正常返回后（能拿返回值） | 结果加工、审计日志 |
| @AfterThrowing | 抛异常后（能拿异常） | 异常告警、兜底 |
| @After | 类似 finally，成败都执行 | 资源清理 |
| @Around | 整个包裹（手动决定是否放行） | 事务、耗时统计、限流 |

### 洋葱模型：五种通知的执行顺序

```
方法调用
  │
  ├─ ① @Around 前半段（proceed 之前）
  │     ├─ ② @Before
  │     │     ├─ ③ 目标方法执行 ─┬─ 正常返回 ──► ④  @AfterReturning（拿到返回值）
  │     │     │                  └─ 抛出异常 ──► ④' @AfterThrowing（拿到异常）
  │     │     └─ ⑤ @After（无论成败都执行，finally 语义）
  └─ ⑥ @Around 后半段（proceed 之后，计时在这里 stop）

多个切面作用于同一方法：按 @Order 从小到大由外到内嵌套（外层切面的 Around 包住内层全部）。
版本差异一句：Spring 5.2.7 之前 @After 先于 AfterReturning/AfterThrowing 执行；
5.2.7 起对齐 finally 直觉 —— 先 AfterReturning/AfterThrowing，再 After。
```

### 代理对象什么时候生成

发生在 Bean 初始化后的 BPP 阶段（生命周期完整流程详见 Bean 生命周期篇）：

```
某个 Bean 初始化完成（生命周期⑥ BPP-After）
   ▼
AbstractAutoProxyCreator#postProcessAfterInitialization
   ▼
① 收集所有 Advisor（切面被解析后的标准产物 = 切点 + 通知）
   ▼
② 拿切点当筛子逐个问：这个类 / 它的方法你匹配吗？
   ├─ AspectJExpressionPointcut → 按 execution 表达式匹配
   └─ AnnotationMatchingPointcut → 按注解匹配（如"方法上有没有 @Transactional"）
   ▼
③ 一个都不匹配 → 返回原对象（大多数 Bean 到这就结束了）
   任意一个匹配 → 生成代理（JDK / CGLIB）→ 放进容器的是【代理】
```

一句话：**切点是筛子，每个 Bean 在初始化 after 阶段过一遍筛子，被筛中的才包代理**。

### 运行时拦截：拦截器链逐层 proceed

```
调用方 ──► 代理对象.method()
              │
              ▼
        代理入口（JDK: invoke / CGLIB: intercept）→ 转成拦截器链 MethodInterceptor 数组
        ┌──────────────────────────────────────────┐
        │ [0] Around 通知拦截器                      │
        │     └─ [1] Before 及其他拦截器             │
        │           └─ [n] 反射调用目标方法           │
        └──────────────────────────────────────────┘

4 层洋葱调用时间线：

t1 代理入口 ─► t2 拦截器[0].invoke ─► t3 拦截器[1].invoke ─► t4 目标方法执行
                                                                    │
t8 返回调用方 ◄─ t7 拦截器[0]收尾 ◄─ t6 拦截器[1]收尾 ◄──────────────┘ t5 目标方法返回

每层 invoke 里调 chain.proceed() 放行下一层；不再 proceed = 直接拦截
（限流直接返回、缓存命中直返，走的都是这条路）。
```

### JDK vs CGLIB 选择规则

| 场景 | 结果 |
| --- | --- |
| 目标类实现了接口 + 原生 Spring | 默认 JDK 动态代理（基于接口反射，实现细节见反射/动态代理篇） |
| 没实现接口 | 只能 CGLIB（生成子类） |
| SpringBoot 2.x 起 | 默认 proxyTargetClass=true，**一律 CGLIB**（避免"按具体类型注入失败"的坑） |
| final 类 / final 方法 | CGLIB 无法继承重写 → final 类直接失败，final 方法被跳过增强 |

### @Transactional 本质就是一个切面

```
@Transactional ─解析为─► Advisor（切点 = 注解匹配，通知 = TransactionInterceptor）

TransactionInterceptor#invoke ≈ 一条 @Around 通知：
   ① 获取事务（开启 / 加入，按传播行为） → ② 执行目标方法
   → ③a 正常返回 commit / ③b 抛出回滚异常 rollback

所以"事务失效" ≈ "调用绕过了代理"：this 调用、private、final、内部 new（详见事务失效篇）
```

### AOP 失效场景速查表

| 场景 | 失效原因 | 补救 |
| --- | --- | --- |
| 同类 this.method() | this 是原始对象，不走代理 | 注入自身代理 / 拆到另一个 Bean |
| private 方法 | JDK 拦不到，CGLIB 无法重写 | 改 public |
| final 方法 / 类 | CGLIB 无法继承重写 | 去掉 final |
| static 方法 | 属于类不属于实例，代理管不着 | 改实例方法 |
| 自己 new 的对象 | 不是容器 Bean，根本没被代理 | 交给容器管理 |

### Spring AOP vs AspectJ（一句对比）

织入时机不同：**Spring AOP 是运行时动态代理**（只作用于容器 Bean 的方法执行），**AspectJ 是编译期 / 类加载期直接织入字节码**（能切构造器、字段、任意对象，功能更强但要配 AJC 编译器）。Spring 只是"借用"了 AspectJ 的注解和切点语法，实现是自己的动态代理。

## 面试答法

### 30 秒版（可背诵）

> Spring AOP 的本质是运行时动态代理：Bean 初始化完成后，AbstractAutoProxyCreator 这个后置处理器拿切点去筛每个 Bean，筛中的就生成 JDK 或 CGLIB 代理放回容器。方法调用时进代理的拦截器链，拦截器逐层 proceed 最终反射调目标方法，形成洋葱模型——五种通知按 Around 前、Before、目标方法、AfterReturning 或 AfterThrowing、After、Around 后的顺序进出。@Transactional 就是内置切面，通知是 TransactionInterceptor，所以绕过代理的调用事务就失效。和 AspectJ 的区别在织入时机：Spring 运行时代理，AspectJ 编译期织入。

### 深入版（按这条线展开）

1. **一句话定性**：运行时动态代理 + 拦截器链
2. **生成时机**：挂到 Bean 生命周期的 BPP-After 阶段讲，顺势讲切点匹配流程
3. **运行时**：画洋葱 / 时间线，讲 proceed 链与"不 proceed 即拦截"
4. **串联事务**：@Transactional = TransactionInterceptor 切面，呼应失效场景
5. **边界收尾**：JDK/CGLIB 选择规则 + 失效速查 + AspectJ 对比

### 常见追问

- **多个切面作用于同一方法，顺序怎么定？** → 实现 Ordered 或 @Order，值小的在外层；不指定则顺序不稳定，建议显式指定
- **@Around 里不调 proceed 会怎样？** → 目标方法不执行，直接返回——限流、缓存直返都靠这个
- **别的 Bean 注入的到底是代理还是原对象？** → 容器里放的是代理，@Autowired 拿到的也是代理；只有目标对象内部的 this 是原始对象
- **CGLIB 遇到 final 方法会报错吗？** → final 方法被跳过增强（不报错）；final 类无法生成子类，直接代理失败
- **AOP 能拦截构造器吗？** → Spring AOP 不能（只代理方法执行），要切构造器得用 AspectJ 编译期织入
